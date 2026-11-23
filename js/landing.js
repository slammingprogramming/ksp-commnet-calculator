// SPDX-License-Identifier: AGPL-3.0-or-later
/* Landing-site finder. Pure logic, no DOM.
 *
 * Works on terrain-data.js: for every body a grid of cells (128 x 64) with the main and second biome, mean height, relief and the 25th,
 * 50th and 90th percentile of the slope, measured on the game's own height map. The map is what the game's terrain generator starts
 * from; it then adds noise on top (hills, craters, small rocks) that is not in these numbers. So slopes here are the regional
 * lie of the land (about 0.3 to 0.9 km per map pixel); the ground right under a lander can be steeper. Bodies without a height
 * map (Minmus, Ike, Gilly, Bop, Pol: pure noise terrain) have biomes only.
 *
 * Longitude and latitude to the map: u = 0.25 - lon / 360 (wrapped), v = (lat + 90) / 180, row 0 at the south pole (checked against
 * the Kerbin ground stations: they fall on the biomes they should). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./terrain-data.js'), require('./data.js'));
  else root.KSPLanding = factory(root.KSPTerrainData, root.KSPData);
})(typeof self !== 'undefined' ? self : this, function (TD, Data) {
  'use strict';

  const GW = TD.grid[0], GH = TD.grid[1];
  const STEP = TD.slopeStep;
  const cache = {};
  const OCEAN = ['Kerbin', 'Eve', 'Laythe'];          // bodies whose terrain below 0 m is under liquid

  function unb64(s) {
    if (typeof Buffer !== 'undefined') { const b = Buffer.from(s, 'base64'); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); }
    const bin = atob(s), a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function radiusOf(name) { const b = Data.bodies.find((x) => x.id === name); return b ? b.radius : 0; }
  const bodies = () => Object.keys(TD.bodies).sort();
  const has = (name) => !!TD.bodies[name];

  /** A body's decoded grid. */
  function body(name) {
    if (cache[name]) return cache[name];
    const t = TD.bodies[name];
    if (!t) return null;
    const o = { name: name, biomes: t.biomes, colors: t.colors, bio: unb64(t.bio), bio2: unb64(t.bio2), hasHeight: !!t.hMean, radius: radiusOf(name) };
    if (t.hMean) {
      const raw = unb64(t.hMean);
      o.hMean = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      o.relief = unb64(t.relief); o.s25 = unb64(t.s25); o.s50 = unb64(t.s50); o.s90 = unb64(t.s90);
      o.hMin = t.hMin; o.hMax = t.hMax;
    }
    o.cellKm = [2 * Math.PI * o.radius / GW / 1000, Math.PI * o.radius / GH / 1000];     // east-west at the equator, north-south
    cache[name] = o;
    return o;
  }

  /** Longitude and latitude (degrees) of the centre of a cell. */
  function cellPos(cx, cy) {
    const u = (cx + 0.5) / GW;
    let lon = (0.25 - u) * 360;
    lon = ((lon + 540) % 360) - 180;
    return { lat: (cy + 0.5) / GH * 180 - 90, lon: lon };
  }
  /** The cell that holds a point. */
  function cellAt(lat, lon) {
    let u = (0.25 - lon / 360) % 1; if (u < 0) u += 1;
    return { cx: Math.min(GW - 1, Math.floor(u * GW)), cy: Math.max(0, Math.min(GH - 1, Math.floor((lat + 90) / 180 * GH))) };
  }
  /** Great-circle distance in km between two points on a body. */
  function distanceKm(name, a, b) {
    const R = radiusOf(name) / 1000, r = Math.PI / 180;
    const d = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(d)));
  }

  /** Slope percentiles of a cell in degrees, or null for a body with no height map. */
  function slopes(b, i) { return b.hasHeight ? { q25: b.s25[i] * STEP, q50: b.s50[i] * STEP, q90: b.s90[i] * STEP } : null; }
  /** Share (0..1) of the ground in a cell at or below a slope, by interpolating its three percentiles. */
  function flatShare(s, limit) {
    if (!s) return null;
    const pts = [[0, 0], [s.q25, 0.25], [s.q50, 0.5], [s.q90, 0.9], [Math.max(s.q90 * 2, s.q90 + 20), 1]];
    if (limit >= pts[4][0]) return 1;
    let share = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], c = pts[k + 1];
      if (limit < a[0]) break;
      share = c[0] > a[0] ? (limit >= c[0] ? c[1] : a[1] + (c[1] - a[1]) * (limit - a[0]) / (c[0] - a[0])) : c[1];
      if (limit < c[0]) break;
    }
    return share;
  }

  /** Candidate landing sites.
   *  opt: { landTilt: max tilt for touching down (deg), stayTilt: max tilt to stay parked on (deg), share: how much of the cell must
   *  be within those tilts (0..1), minLat, maxLat (degrees, of the absolute latitude), minAlt, maxAlt (m, map height), dry: leave out
   *  ground below sea level on bodies with liquid, biomes: [names to allow] (empty = any), avoid: [names to leave out],
   *  near: {lat, lon, km}, varietyKm: radius in which the biomes are counted, count: how many to return, spacingKm: minimum distance
   *  between candidates, rank: 'flat' | 'variety' | 'close' | 'low' | 'high' } */
  function find(name, opt) {
    opt = opt || {};
    const b = body(name);
    if (!b) return { error: 'No terrain data for ' + name, rows: [] };
    const o = Object.assign({ landTilt: 10, stayTilt: 5, share: 0.5, minLat: 0, maxLat: 90, dry: true, biomes: [], avoid: [], varietyKm: 100, count: 20, spacingKm: 0, rank: 'flat' }, opt);
    const allow = new Set(o.biomes.map((x) => b.biomes.indexOf(x)).filter((x) => x >= 0));
    const deny = new Set(o.avoid.map((x) => b.biomes.indexOf(x)).filter((x) => x >= 0));
    const spacing = o.spacingKm || Math.max(b.cellKm[0], b.cellKm[1]) * 2;
    const reach = Math.ceil(o.varietyKm / Math.max(1, b.cellKm[1]));
    const stride = Math.max(1, Math.round(reach / 8));              // look at every few cells when the radius spans many
    const ocean = OCEAN.indexOf(name) >= 0;
    const rows = [];
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
      const i = cy * GW + cx;
      const pos = cellPos(cx, cy);
      if (Math.abs(pos.lat) < o.minLat || Math.abs(pos.lat) > o.maxLat) continue;
      const bi = b.bio[i];
      if (allow.size && !allow.has(bi)) continue;
      if (deny.has(bi)) continue;
      const alt = b.hasHeight ? b.hMean[i] : null;
      if (alt !== null) {
        if (o.dry && ocean && alt <= 0) continue;
        if (o.minAlt !== undefined && alt < o.minAlt) continue;
        if (o.maxAlt !== undefined && alt > o.maxAlt) continue;
      }
      const sl = slopes(b, i);
      const land = flatShare(sl, o.landTilt), stay = flatShare(sl, o.stayTilt);
      if (sl && (land < o.share || stay < o.share)) continue;
      let dist = null;
      if (o.near) { dist = distanceKm(name, pos, o.near); if (dist > o.near.km) continue; }
      // biomes within reach: the main and second biome of every cell nearby
      const seen = new Set();
      const rx = Math.ceil(reach / Math.max(0.05, Math.cos(pos.lat * Math.PI / 180)));
      for (let dy = -reach; dy <= reach; dy += stride) {
        const yy = cy + dy; if (yy < 0 || yy >= GH) continue;
        for (let dx = -Math.min(rx, GW / 2); dx <= Math.min(rx, GW / 2); dx += stride) {
          const j = yy * GW + ((cx + dx + GW) % GW);
          if (distanceKm(name, pos, cellPos((cx + dx + GW) % GW, yy)) <= o.varietyKm) { seen.add(b.bio[j]); if (b.bio2[j] !== b.bio[j]) seen.add(b.bio2[j]); }
        }
      }
      rows.push({
        cx: cx, cy: cy, lat: pos.lat, lon: pos.lon, biome: b.biomes[bi], second: b.biomes[b.bio2[i]], alt: alt, relief: b.hasHeight ? b.relief[i] * 32 : null,
        slope: sl, landShare: land, stayShare: stay, variety: seen.size, nearby: [...seen].map((k) => b.biomes[k]), distanceKm: dist,
      });
    }
    const key = {
      flat: (r) => (r.stayShare === null ? 0 : -(r.stayShare * 2 + r.landShare + (r.slope ? -r.slope.q50 / 90 : 0))),
      variety: (r) => -r.variety * 10 - (r.stayShare || 0),
      close: (r) => (r.distanceKm === null ? 0 : r.distanceKm),
      low: (r) => (r.alt === null ? 0 : r.alt),
      high: (r) => (r.alt === null ? 0 : -r.alt),
    }[o.rank] || ((r) => 0);
    rows.sort((a, c) => key(a) - key(c) || (c.variety - a.variety));
    // keep the best of each neighbourhood
    const out = [];
    for (const r of rows) {
      if (out.every((q) => distanceKm(name, q, r) >= spacing)) out.push(r);
      if (out.length >= o.count) break;
    }
    return { rows: out, matches: rows.length, cells: rows.map((r) => r.cy * GW + r.cx), cellKm: b.cellKm, hasHeight: b.hasHeight };
  }

  /** Biomes of a body with the share of the surface each covers (by its main biome per cell). */
  function biomeTable(name) {
    const b = body(name);
    if (!b) return [];
    const cnt = new Array(b.biomes.length).fill(0);
    for (let cy = 0; cy < GH; cy++) {
      const w = Math.cos((cy + 0.5) / GH * Math.PI - Math.PI / 2);
      for (let cx = 0; cx < GW; cx++) cnt[b.bio[cy * GW + cx]] += w;
    }
    const tot = cnt.reduce((a, x) => a + x, 0) || 1;
    return b.biomes.map((n, k) => ({ name: n, rgb: b.colors[k], share: cnt[k] / tot })).sort((a, c) => c.share - a.share);
  }
  const biomeCount = (name) => (TD.bodies[name] ? TD.bodies[name].biomes.length : 0);

  return {
    GW: GW, GH: GH, OCEAN: OCEAN, bodies: bodies, has: has, body: body, cellPos: cellPos, cellAt: cellAt, distanceKm: distanceKm,
    slopes: slopes, flatShare: flatShare, find: find, biomeTable: biomeTable, biomeCount: biomeCount,
  };
});
