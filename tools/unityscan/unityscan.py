# SPDX-License-Identifier: AGPL-3.0-or-later
"""unityscan: read CommNet-relevant facts out of a copy of KSP 1.12.5 that you own. Python 3.9+, standard library only.

    python unityscan.py "<KSP folder>" [facts.json]

It reads Unity serialized files (KSP_x64_Data/sharedassets*.assets, ...) and the Making History asset bundles and prints:
  * which GameObjects carry a CommNetBody (every celestial body, including the Sun, has one),
  * every CommNetHome ground station (name, isKSC, isPermanent, antennaPower) and, where the data has a type tree,
    the lat/lon/alt of its launch site,
  * each CelestialBody prefab's radius, GeeASL, initial rotation, tidal lock and orbit elements.
Optionally the body/station values are also written to a JSON file.

How it works (Unity 2019.4 serialized files, version 21): the object table is parsed; MonoBehaviour / MonoScript / GameObject
objects have a fixed prefix layout, so scripts can be matched to GameObjects without type trees. The game's own player files
carry no type trees, so field values are read at offsets derived from the C# field order (see tools/ildump: `dump <Type>`
lists fields with their types). Asset bundles do carry type trees and are read generically.

Do not redistribute the game's files or dumps of them; this tool is for interoperability research on your own copy.
"""
import collections, glob, json, lzma, os, struct, sys


class Buf:
    def __init__(s, data, pos=0, little=True): s.d = data; s.p = pos; s.le = little
    def _u(s, fmt, n): v = struct.unpack_from(('<' if s.le else '>') + fmt, s.d, s.p)[0]; s.p += n; return v
    def i32(s): return s._u('i', 4)
    def u32(s): return s._u('I', 4)
    def i64(s): return s._u('q', 8)
    def i16(s): return s._u('h', 2)
    def u8(s): v = s.d[s.p]; s.p += 1; return v
    def cstr(s):
        e = s.d.index(b'\0', s.p); v = s.d[s.p:e].decode('utf8', 'replace'); s.p = e + 1; return v
    def align(s): s.p = (s.p + 3) & ~3
    def string(s):
        n = s.i32(); v = s.d[s.p:s.p + n].decode('utf8', 'replace'); s.p += n; s.align(); return v


def pptr(b): return b.i32(), b.i64()   # (file id, path id)


# --- type trees (only present in asset bundles) -------------------------------------------------------------------------
_COMMON = ("AABB\0AnimationClip\0AnimationCurve\0AnimationState\0Array\0Base\0BitField\0bitset\0bool\0char\0ColorRGBA\0Component\0data\0deque\0double\0"
           "dynamic_array\0FastPropertyName\0first\0float\0Font\0GameObject\0Generic Mono\0GradientNEW\0GUID\0GUIStyle\0int\0list\0long long\0map\0"
           "Matrix4x4f\0MdFour\0MonoBehaviour\0MonoScript\0m_ByteSize\0m_Curve\0m_EditorClassIdentifier\0m_EditorHideFlags\0m_Enabled\0m_ExtensionPtr\0"
           "m_GameObject\0m_Index\0m_IsArray\0m_IsStatic\0m_MetaFlag\0m_Name\0m_ObjectHideFlags\0m_PrefabInternal\0m_PrefabParentObject\0m_Script\0"
           "m_StaticEditorFlags\0m_Type\0m_Version\0Object\0pair\0PPtr<Component>\0PPtr<GameObject>\0PPtr<Material>\0PPtr<MonoBehaviour>\0PPtr<MonoScript>\0"
           "PPtr<Object>\0PPtr<Prefab>\0PPtr<Sprite>\0PPtr<TextAsset>\0PPtr<Texture>\0PPtr<Texture2D>\0PPtr<Transform>\0Prefab\0Quaternionf\0Rectf\0RectInt\0"
           "RectOffset\0second\0set\0short\0size\0SInt16\0SInt32\0SInt64\0SInt8\0staticvector\0string\0TextAsset\0TextMesh\0Texture\0Texture2D\0Transform\0"
           "TypelessData\0UInt16\0UInt32\0UInt64\0UInt8\0unsigned int\0unsigned long long\0unsigned short\0vector\0Vector2f\0Vector3f\0Vector4f\0"
           "m_ScriptingClassIdentifier\0Gradient\0Type*\0int2_storage\0int3_storage\0BoundsInt\0m_CorrespondingSourceObject\0m_PrefabInstance\0"
           "m_PrefabAsset\0FileSize\0Hash128\0")
COMMON = {}
_o = 0
for _s in _COMMON.split('\0')[:-1]:
    COMMON[_o] = _s; _o += len(_s) + 1

PRIM = {'SInt8': 'b', 'UInt8': 'B', 'char': 'B', 'bool': 'B', 'short': 'h', 'SInt16': 'h', 'UInt16': 'H', 'unsigned short': 'H', 'int': 'i',
        'SInt32': 'i', 'Type*': 'i', 'UInt32': 'I', 'unsigned int': 'I', 'long long': 'q', 'SInt64': 'q', 'UInt64': 'Q',
        'unsigned long long': 'Q', 'FileSize': 'Q', 'float': 'f', 'double': 'd'}


def read_nodes(b, ver):
    n = b.i32(); sz = b.i32(); raw = []
    for _ in range(n):
        _v, lvl, _fl, to, no, bs, _idx, mf = struct.unpack_from('<HBBIIiii', b.d, b.p)
        b.p += 32 if ver >= 19 else 24
        raw.append((lvl, to, no, bs, mf))
    sb = b.d[b.p:b.p + sz]; b.p += sz
    def nm(off):
        if off & 0x80000000: return COMMON.get(off & 0x7fffffff, '?')
        return sb[off:sb.index(b'\0', off)].decode('utf8', 'replace')
    return [(lvl, nm(to), nm(no), bs, mf) for lvl, to, no, bs, mf in raw]


def build_tree(nodes):
    root = {'lvl': nodes[0][0], 'type': nodes[0][1], 'name': nodes[0][2], 'mf': nodes[0][4], 'kids': []}
    stack = [root]
    for lvl, t, n, bs, mf in nodes[1:]:
        node = {'lvl': lvl, 'type': t, 'name': n, 'mf': mf, 'kids': []}
        while stack[-1]['lvl'] >= lvl: stack.pop()
        stack[-1]['kids'].append(node); stack.append(node)
    return root


def read_value(node, d, pos):
    t = node['type']
    if t in PRIM:
        fmt = '<' + PRIM[t]; val = struct.unpack_from(fmt, d, pos)[0]; pos += struct.calcsize(fmt)
    elif t == 'string':
        n = struct.unpack_from('<i', d, pos)[0]; pos += 4; val = d[pos:pos + n].decode('utf8', 'replace'); pos += n; pos = (pos + 3) & ~3
    elif t == 'TypelessData':
        n = struct.unpack_from('<i', d, pos)[0]; pos += 4 + n; val = None
    elif node['kids'] and (node['kids'][0]['type'] == 'Array' or t in ('vector', 'staticvector', 'set', 'list', 'map')):
        arr = node['kids'][0]; elem = arr['kids'][1]
        n = struct.unpack_from('<i', d, pos)[0]; pos += 4; val = []
        for _ in range(n):
            v, pos = read_value(elem, d, pos); val.append(v)
        if arr['mf'] & 0x4000: pos = (pos + 3) & ~3
    else:
        val = {}
        for k in node['kids']:
            v, pos = read_value(k, d, pos); val[k['name']] = v
    if node['mf'] & 0x4000: pos = (pos + 3) & ~3
    return val, pos


# --- serialized files ---------------------------------------------------------------------------------------------------
def parse_file(data, label=''):
    meta, fsize, ver, doff = struct.unpack('>IIII', data[:16])
    if not 9 <= ver <= 21: return None
    little = data[16] == 0
    b = Buf(data, 20, little)
    unity = b.cstr(); b.i32()
    tt = b.u8() != 0 if ver >= 13 else False
    types, trees = [], []
    for _ in range(b.i32()):
        cid = b.i32()
        if ver >= 16: b.u8()
        if ver >= 17: b.i16()
        if ver >= 13:
            if cid == 114: b.p += 16
            b.p += 16
        if tt:
            trees.append(read_nodes(b, ver))
            if ver >= 21:
                k = b.i32(); b.p += 4 * k
        else: trees.append(None)
        types.append(cid)
    objs, objtype = [], {}
    for _ in range(b.i32()):
        if ver >= 14: b.align()
        pid = b.i64(); start = b.u32(); size = b.u32(); tid = b.i32()
        objs.append((pid, start, size, types[tid])); objtype[pid] = tid
    if ver >= 11:
        for _ in range(b.i32()):
            b.i32(); b.align(); b.i64()
    ext = []
    for _ in range(b.i32()):
        b.cstr(); b.p += 16; b.i32(); ext.append(os.path.basename(b.cstr().replace('\\', '/')))
    return {'label': label, 'unity': unity, 'typetree': tt, 'little': little, 'doff': doff, 'data': data, 'objs': objs,
            'ext': ext, 'trees': trees, 'objtype': objtype}


def lz4_block(src, usize):
    dst = bytearray(); i = 0; n = len(src)
    while i < n:
        t = src[i]; i += 1; lit = t >> 4
        if lit == 15:
            while True:
                x = src[i]; i += 1; lit += x
                if x != 255: break
        dst += src[i:i + lit]; i += lit
        if i >= n: break
        off = src[i] | (src[i + 1] << 8); i += 2; ml = t & 15
        if ml == 15:
            while True:
                x = src[i]; i += 1; ml += x
                if x != 255: break
        ml += 4; st = len(dst) - off
        for k in range(ml): dst.append(dst[st + k])
    return bytes(dst)


def load_bundle(path):
    """UnityFS (version 7) bundle -> [(node name, bytes)]. Handles LZ4/LZ4HC and LZMA blocks."""
    d = open(path, 'rb').read()
    assert d[:8] == b'UnityFS\0'
    p = 8; ver = struct.unpack_from('>I', d, p)[0]; p += 4
    for _ in range(2): p = d.index(b'\0', p) + 1
    _size, ci, ui, flags = struct.unpack_from('>qIII', d, p); p += 20
    if ver >= 7: p = (p + 15) & ~15
    assert not flags & 0x80, 'block info at end of file is not supported'
    raw = d[p:p + ci]; p += ci
    info = raw if flags & 0x3f == 0 else lz4_block(raw, ui)
    q = 16; nb = struct.unpack_from('>i', info, q)[0]; q += 4; blocks = []
    for _ in range(nb):
        us, cs, fl = struct.unpack_from('>IIH', info, q); q += 10; blocks.append((us, cs, fl))
    nn = struct.unpack_from('>i', info, q)[0]; q += 4; nodes = []
    for _ in range(nn):
        off, sz, _fl = struct.unpack_from('>qqI', info, q); q += 20
        e = info.index(b'\0', q); nodes.append((off, sz, info[q:e].decode())); q = e + 1
    out = bytearray()
    for us, cs, fl in blocks:
        c = d[p:p + cs]; p += cs; t = fl & 0x3f
        if t == 0: out += c
        elif t in (2, 3): out += lz4_block(c, us)
        elif t == 1:
            pr = c[0]; ds = struct.unpack_from('<I', c, 1)[0]
            dec = lzma.LZMADecompressor(format=lzma.FORMAT_RAW, filters=[{'id': lzma.FILTER_LZMA1, 'dict_size': max(ds, 4096), 'lc': pr % 9, 'lp': (pr // 9) % 5, 'pb': pr // 45}])
            chunk = dec.decompress(c[5:], max_length=us); assert len(chunk) == us; out += chunk
        else: raise ValueError('unknown block compression %d' % t)
    return [(nm, bytes(out[o:o + sz])) for o, sz, nm in nodes]


class Scene:
    """All MonoBehaviours of a set of serialized files, joined to their script class and GameObject name."""
    def __init__(self, files):
        self.files = files                       # name -> parsed file
        self.scripts, self.gos = {}, {}
        for name, r in files.items():
            d = r['data']; le = r['little']
            for pid, start, size, cid in r['objs']:
                o = r['doff'] + start
                try:
                    if cid == 115:
                        b = Buf(d, o, le); b.string(); b.i32(); b.p += 16; cn = b.string(); ns = b.string()
                        self.scripts[(name, pid)] = (ns + '.' if ns else '') + cn
                    elif cid == 1:
                        b = Buf(d, o, le); n = b.i32()
                        if 0 <= n < 2000: b.p += 12 * n; b.u32(); self.gos[(name, pid)] = b.string()
                except Exception: pass

    def behaviours(self, wanted):
        """Yield (file name, file, class name, GameObject name, GameObject path id, offset after the m_Name field, end offset, object path id)."""
        for name, r in self.files.items():
            d = r['data']; le = r['little']
            for pid, start, size, cid in r['objs']:
                if cid != 114: continue
                b = Buf(d, r['doff'] + start, le)
                try:
                    gf, gp = pptr(b); b.u8(); b.align(); sf, sp = pptr(b); b.string()
                except Exception: continue
                sfile = name if sf == 0 else (r['ext'][sf - 1] if 0 < sf <= len(r['ext']) else '?')
                cls = self.scripts.get((sfile, sp))
                if cls in wanted:
                    gfile = name if gf == 0 else (r['ext'][gf - 1] if 0 < gf <= len(r['ext']) else '?')
                    yield name, r, cls, self.gos.get((gfile, gp), '?'), gp, b.p, r['doff'] + start + size, pid


def _plain_files(root):
    out = {}
    for f in sorted(glob.glob(os.path.join(root, '*'))):
        if not os.path.isfile(f) or f.endswith(('.resS', '.resource', '.dll', '.json', '.info', '.config', '.dat')): continue
        try:
            r = parse_file(open(f, 'rb').read(), os.path.basename(f))
        except Exception:
            continue
        if r and r['objs']: out[os.path.basename(f)] = r
    return out


def _home_fields(d, off, le):
    b = Buf(d, off, le)
    node, display = b.string(), b.string(); b.p += 12
    ksc = b.u8(); b.align(); perm = b.u8(); b.align()
    power = struct.unpack_from('<d' if le else '>d', d, b.p)[0]
    return {'nodeName': node, 'isKSC': bool(ksc), 'isPermanent': bool(perm), 'antennaPower': power}


def _float_curves(seg):
    """FloatCurves (Unity AnimationCurve: int count, then count x 7 floats [time, value, inSlope, outSlope, weightedMode (int), inWeight, outWeight])
    found by their shape in a prefab's raw bytes: (offset of the count, [(time, value, inSlope, outSlope), ...])."""
    out, q = [], 0
    while q < len(seg) - 32:
        n = struct.unpack_from('<i', seg, q)[0]
        if 1 <= n <= 60 and q + 4 + 28 * n + 12 <= len(seg):
            keys, ok, last = [], True, None
            for k in range(n):
                t, v, a, b, _wm, wi, wo = struct.unpack_from('<fffffff', seg, q + 4 + 28 * k)
                mode = struct.unpack_from('<i', seg, q + 4 + 28 * k + 16)[0]
                if (last is not None and not t > last) or mode != 0 or abs(wi - 1 / 3) > 1e-3 or abs(wo - 1 / 3) > 1e-3 or abs(t) > 1e8 or abs(v) > 1e8:
                    ok = False; break
                last = t; keys.append((t, v, a, b))
            if ok:
                out.append((q, keys)); q += 4 + 28 * n; continue
        q += 4
    return out


def atmospheres(scene):
    """Atmosphere data of every body that has one: the temperature and pressure curves, molar mass, adiabatic index, shock
    temperature multiplier. The first curve in the atmosphere block is atmosphereTemperatureCurve and the last one
    atmospherePressureCurve (both in metres); the scalars sit directly before the first curve and the multipliers before the last."""
    res = {}
    for name, r, cls, go, gp, off, end, pid in scene.behaviours({'CelestialBody'}):
        seg = r['data'][off:end]
        cs = _float_curves(seg)
        if len(cs) < 8 or cs[0][1][0][1] < 100 or cs[-1][1][0][1] < 1:   # first key: sea-level temperature (K) / pressure (kPa)
            continue
        (q0, temp), (q1, pres) = cs[0], cs[-1]
        d = lambda p: struct.unpack_from('<d', seg, p)[0]
        res[go] = {
            'depth': d(q0 - 8 - 56),                    # atmosphereDepth, seaLevelT, seaLevelP, molarMass, adiabaticIndex, lapse, gasMassLapse (7 doubles)
            'seaLevelTemperature': d(q0 - 8 - 48), 'seaLevelPressure': d(q0 - 8 - 40),
            'molarMass': d(q0 - 8 - 32), 'adiabaticIndex': d(q0 - 8 - 24),
            'shockTemperatureMultiplier': d(q1 - 8 - 16),   # ..., emissivity, coreTemperatureOffset, convectionMultiplier, shockTemperatureMultiplier, bodyTemperature
            'temperatureCurve': [[round(x, 6) for x in k] for k in temp],
            'pressureCurve': [[round(x, 6) for x in k] for k in pres],
        }
    return res


def career_facts(scene):
    """Career facts that live in the scene/prefab files rather than in GameData configs.

    * facilities: UpgradeableFacility objects. After the id string come two ints (1, level count) and one record per level: the
      first float of each record is levelCost (record 0 is the level-1 base cost, which is not an upgrade price; records 1 and 2
      are the prices of the upgrades to level 2 and 3). Records are 56..132 bytes long, so the costs are found as whole-number floats
      >= 1000 inside the object. The KSC scene copies (levelNN files) are preferred over the shared-assets prefab copies.
    * science: CelestialBodyScienceParams are 9 consecutive floats inside the CelestialBody prefab: landed, splashed, flying low,
      flying high, in space low, in space high, recovery, flying altitude threshold, space altitude threshold."""
    fac, pref = {}, {}
    for name, r, cls, go, gp, off, end, pid in scene.behaviours({'Upgradeables.UpgradeableFacility'}):
        d = r['data']; b = Buf(d, off, r['little'])
        try: fid = b.string()
        except Exception: continue
        p = b.p
        vals = []
        for q in range(p + 8, end - 3, 4):
            f = struct.unpack_from('<f', d, q)[0]
            if f >= 1000 and f == int(f) and f < 2e6: vals.append(int(f))
        if len(vals) == 3:
            (pref if name.startswith('sharedassets') else fac)[fid.split('/')[-1]] = vals
    facilities = {k: {'base': v[0], 'level2': v[1], 'level3': v[2]} for k, v in {**pref, **fac}.items()}
    science = {}
    for name, r, cls, go, gp, off, end, pid in scene.behaviours({'CelestialBody'}):
        seg = r['data'][off:end]
        for q in range(0, len(seg) - 36, 4):
            v = struct.unpack_from('<9f', seg, q)
            if all(0 <= x <= 200 for x in v[:7]) and v[0] > 0 and 100 <= v[7] <= 1e7 and v[6] > 0 and v[4] > 0 and v[8] >= 1000 and (v[8] >= v[7] or go == 'Gilly'):
                science[go] = {'landed': v[0], 'splashed': v[1], 'flyingLow': v[2], 'flyingHigh': v[3], 'spaceLow': v[4], 'spaceHigh': v[5],
                               'recovery': v[6], 'flyingAltitude': v[7], 'spaceAltitude': v[8]}
    return {'facilities': facilities, 'science': science}


def _map_header(d, o, le):
    """A MapSO / CBAttributeMapSO body: an int, the map name, then width, height, bytes per pixel, data length and the pixels."""
    b = Buf(d, o, le)
    b.i32(); name = b.string()
    w, h, bpp, ln = b.i32(), b.i32(), b.i32(), b.i32()
    return name, w, h, bpp, b.p, ln


def terrain_facts(scene, out_dir):
    """Planet terrain maps used by the game's terrain generator (PQS): the height map of each body (with its scale and offset) and its
    biome map. Writes <out_dir>/<Body>.height (one byte per pixel, row 0 = south pole), <Body>.biome (index into the body's biome list)
    and terrain.json with the sizes, scale/offset and biome names and colours. Height in metres = offset + scale * byte / 255; a pixel
    at longitude lon, latitude lat is at u = 0.25 - lon/360 (wrapped), v = (lat + 90) / 180 (checked against the Kerbin ground
    stations: they all land on the right biomes). The generator adds noise on top of these maps, which is not read."""
    os.makedirs(out_dir, exist_ok=True)
    maps = {}            # path id -> (kind, file, header)
    for name, r, cls, go, gp, off, end, pid in scene.behaviours({'MapSO', 'CBAttributeMapSO'}):
        maps[pid] = (cls, r, off, end)
    # transforms and GameObjects of the file, to walk from a height modifier up to the body it belongs to
    trans, go_first, go_name = {}, {}, {}
    meta = {}
    for fname, r in scene.files.items():
        d, le = r['data'], r['little']
        for pid, start, size, cid in r['objs']:
            o = r['doff'] + start
            try:
                if cid == 4:
                    b = Buf(d, o, le); gf, gp = pptr(b); b.p += 40
                    n = b.i32(); b.p += 12 * n
                    ff, fp = pptr(b)
                    trans[(fname, pid)] = (gp, fp if ff == 0 else 0)
                elif cid == 1:
                    b = Buf(d, o, le); n = b.i32()
                    if 0 < n < 2000:
                        ff, fp = pptr(b); go_first[(fname, pid)] = fp
                        b.p += 12 * (n - 1); b.u32(); go_name[(fname, pid)] = b.string()
            except Exception: pass
    bodies = {}
    for fname, r, cls, go, gp, off, end, pid in scene.behaviours({'PQSMod_VertexHeightMap'}):
        d = r['data']; seg = d[off:end]
        link = None
        for k in range(0, len(seg) - 12, 4):
            fid, pv = struct.unpack_from('<iq', seg, k)
            if fid == 0 and pv in maps and maps[pv][0] == 'MapSO': link = (k, pv); break
        if not link: continue
        k, pv = link
        deform, offset = struct.unpack_from('<2d', seg, k + 12)
        chain, g = [], gp
        for _ in range(12):
            chain.append(go_name.get((fname, g), '?'))
            t = go_first.get((fname, g))
            if (fname, t) not in trans: break
            f = trans[(fname, t)][1]
            if not f or (fname, f) not in trans: break
            g = trans[(fname, f)][0]
        body = chain[-1]
        cl, mr, mo, me = maps[pv]
        mname, w, h, bpp, dp, ln = _map_header(mr['data'], mo, mr['little'])
        if mname == 'genericoffset' or not body or body in ('_Height', '_HeightNoise', '?'): continue
        if body in bodies and bodies[body]['w'] * bodies[body]['h'] >= w * h: continue
        bodies[body] = {'map': mname, 'w': w, 'h': h, 'bpp': bpp, 'scale': deform, 'offset': offset, 'dp': dp, 'ln': ln, 'file': mr}
    result = {}
    for body, m in bodies.items():
        raw = m['file']['data'][m['dp']:m['dp'] + m['ln']]
        px = bytes(raw[0::m['bpp']]) if m['bpp'] > 1 else bytes(raw)
        open(os.path.join(out_dir, body + '.height'), 'wb').write(px)
        result[body] = {'heightMap': m['map'], 'w': m['w'], 'h': m['h'], 'scale': m['scale'], 'offset': m['offset']}
    # biome maps: attribute table follows the pixels (row width, count, then colour (4 floats), name, display name and 12 bytes each)
    for pid, (cls, r, off, end) in maps.items():
        if cls != 'CBAttributeMapSO': continue
        d = r['data']
        mname, w, h, bpp, dp, ln = _map_header(d, off, r['little'])
        tail = d[dp + ln:end]
        cnt = struct.unpack_from('<i', tail, 4)[0]; p = 8; attrs = []
        for _ in range(cnt):
            col = struct.unpack_from('<4f', tail, p); p += 16
            n1 = struct.unpack_from('<i', tail, p)[0]; nm = tail[p + 4:p + 4 + n1].decode('latin1'); p += 4 + ((n1 + 3) & ~3)
            n2 = struct.unpack_from('<i', tail, p)[0]; p += 4 + ((n2 + 3) & ~3) + 12
            attrs.append((nm, tuple(round(c * 255) for c in col[:3])))
        body = mname.split('_')[0].capitalize()
        idx = {}
        out = bytearray(w * h)
        pix = d[dp:dp + ln]
        cache = {}
        step = bpp
        for i in range(w * h):
            c = (pix[i * step], pix[i * step + 1], pix[i * step + 2])
            v = cache.get(c)
            if v is None:
                v = min(range(len(attrs)), key=lambda k: sum((a - b) ** 2 for a, b in zip(attrs[k][1], c)))
                cache[c] = v
            out[i] = v
        open(os.path.join(out_dir, body + '.biome'), 'wb').write(bytes(out))
        rec = result.setdefault(body, {})
        rec['biomeMap'] = mname; rec['bw'] = w; rec['bh'] = h
        rec['biomes'] = [{'name': a[0], 'rgb': list(a[1])} for a in attrs]
    json.dump(result, open(os.path.join(out_dir, 'terrain.json'), 'w'), indent=1)
    return result


def main(ksp, out_json=None, terrain_dir=None):
    data_dir = os.path.join(ksp, 'KSP_x64_Data')
    files = _plain_files(data_dir)
    first = next(iter(files.values()))
    print('Unity %s, %d serialized files' % (first['unity'], len(files)))
    scene = Scene(files)
    facts = {'stations': [], 'bodies': {}}

    print('\n== GameObjects carrying CommNet.CommNetBody')
    names = sorted(g for _n, _r, c, g, _gp, _o, _e, _p in scene.behaviours({'CommNet.CommNetBody'}))
    print('  %d: %s' % (len(names), ', '.join(names)))

    print('\n== CommNet.CommNetHome (base game)')
    for name, r, cls, go, gp, off, end, pid in scene.behaviours({'CommNet.CommNetHome'}):
        f = _home_fields(r['data'], off, r['little']); f['object'] = go
        print('  %-16s %s' % (go, f)); facts['stations'].append(f)

    mh = os.path.join(ksp, 'GameData', 'SquadExpansion', 'MakingHistory', 'AssetBundles', 'makinghistory_assets')
    if os.path.isfile(mh):
        print('\n== CommNet.CommNetHome (Making History bundle, with launch-site coordinates)')
        bf = {}
        for nm, blob in load_bundle(mh):
            if nm.endswith(('.resS', '.resource')): continue
            r = parse_file(blob, nm)
            if r and r['objs']: bf[nm] = r
        bscene = Scene(bf)
        for name, r, cls, go, gp, off, end, pid in bscene.behaviours({'CommNet.CommNetHome'}):
            f = _home_fields(r['data'], off, r['little']); f['object'] = go
            # the PQSCity2 on the same GameObject holds lat/lon/alt (type tree available in bundles)
            for n2, r2, c2, g2, gp2, o2, e2, p2 in bscene.behaviours({'PQSCity2'}):
                if gp2 == gp and n2 == name:
                    v, _ = read_value(build_tree(r2['trees'][r2['objtype'][p2]]), r2['data'], r2['doff'] + [s for (pp, s, z, c) in r2['objs'] if pp == p2][0])
                    f.update(lat=v['lat'], lon=v['lon'], alt=v['alt'])
            print('  %-20s %s' % (go, f)); facts['stations'].append(f)

    print('\n== CelestialBody prefabs')
    orbit = {gp: (off, pid) for name, r, cls, go, gp, off, end, pid in scene.behaviours({'OrbitDriver'})}
    for name, r, cls, go, gp, off, end, pid in scene.behaviours({'CelestialBody'}):
        d = r['data']; dbl = lambda p: struct.unpack_from('<d', d, p)[0]
        b = Buf(d, off, r['little']); b.string(); b.string(); b.string(); b.string()
        rec = {'gee': dbl(b.p), 'radius': dbl(b.p + 8)}
        base = b.p + 88
        # the rotation block is found by its signature: rotates=1, rotationPeriod, 1/period and solar day (both runtime-computed, 0
        # in the prefab), initialRotation in [0, 360], tidallyLocked a bool 100 bytes on.
        for q in range(base, end - 110, 4):
            a, c, sd = dbl(q), dbl(q + 8), dbl(q + 16)
            if d[q - 4] == 1 and ((1e3 < a < 1e9) or a in (0.0, 100.0)) and c == 0.0 and sd == 0.0 and 0.0 <= dbl(q + 28) <= 360.0 and d[q + 100] in (0, 1) \
                    and (a != 0.0 and a != 100.0 or (d[q + 100] == 1 and d[q + 24] == 0)):
                rec.update(rotationPeriod=a, solarRotationPeriod=bool(d[q + 24]), initialRotation=dbl(q + 28), tidallyLocked=bool(d[q + 100]))
                break
        if gp in orbit:
            o = orbit[gp][0] + 60       # OrbitDriver: pos, vel (2 x Vector3d) then Orbit.referenceBody (PPtr), then the doubles
            rec['orbit'] = {k: dbl(o + off_) for k, off_ in (('inclination', 0), ('eccentricity', 8), ('semiMajorAxis', 16), ('LAN', 24),
                                                          ('argumentOfPeriapsis', 32), ('epoch', 40), ('meanAnomalyAtEpoch', 268))}
        print('  %-8s %s' % (go, rec)); facts['bodies'][go] = rec
    print(chr(10) + '== Atmospheres (temperature and pressure curves, gas properties, shock-temperature multiplier)')
    facts['atmospheres'] = atmospheres(scene)
    for k, v in facts['atmospheres'].items():
        print('  %-8s depth %.0f m  M %.4f  gamma %.2f  shock x%.2f  T0 %.1f K  P0 %.3f kPa  (%d + %d keys)' % (k, v['depth'], v['molarMass'], v['adiabaticIndex'], v['shockTemperatureMultiplier'], v['temperatureCurve'][0][1], v['pressureCurve'][0][1], len(v['temperatureCurve']), len(v['pressureCurve'])))
    print(chr(10) + '== Career facts (facility upgrade prices, science multipliers per body)')
    facts['career'] = career_facts(scene)
    for k, v in sorted(facts['career']['facilities'].items()): print('  %-24s %s' % (k, v))
    for k, v in sorted(facts['career']['science'].items()): print('  %-8s %s' % (k, v))
    if out_json:
        json.dump(facts, open(out_json, 'w'), indent=1); print('\nwrote', out_json)
    if terrain_dir:
        t = terrain_facts(scene, terrain_dir)
        print('\n== Terrain maps written to', terrain_dir)
        for k, v in sorted(t.items()): print('  %-8s %s' % (k, {a: b for a, b in v.items() if a != 'biomes'}), len(v.get('biomes', [])), 'biomes')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    args = [a for a in sys.argv[1:] if not a.startswith('--terrain=')]
    tdir = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--terrain=')), None)
    main(args[0], args[1] if len(args) > 1 else None, tdir)
