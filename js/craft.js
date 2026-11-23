// SPDX-License-Identifier: AGPL-3.0-or-later
/* Rockets: .craft import, cost, mass and a stage-by-stage delta-v estimate. Pure logic, no DOM.
 *
 * A craft is a tree of parts (the first PART is the root, `link =` lines name the children). Cost and mass come from the part
 * list in career-data.js plus each part's own tank contents. The delta-v estimate simulates the staging: stages fire from the highest
 * `istg` down, decouplers drop the subtree on their far side, engines burn the propellant they can reach (not through a part that
 * blocks crossfeed) and the burn is cut into phases at every tank that runs dry (so boosters and a core stage that burn at the same
 * time are handled). It does not model fuel lines, fuel priorities, ullage, aerodynamic losses or gravity losses: use it as the
 * rocket-equation budget it is. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./parsers.js'), require('./career-data.js'));
  else root.KSPCraft = factory(root.KSPParsers, root.KSPCareerData);
})(typeof self !== 'undefined' ? self : this, function (Parsers, CD) {
  'use strict';

  const G0 = 9.80665;
  const byId = {};
  for (const p of CD.parts) { byId[p.id] = p; byId[p.id.replace(/\./g, '_')] = p; }
  const part = (id) => byId[id] || byId[String(id).replace(/\./g, '_')];
  /** Teach the module parts read from mod .cfg files (Parsers.parsePartCfg): they are looked up like the stock ones. Stock ids are never replaced. */
  function addParts(map) {
    let n = 0;
    for (const p of Object.values(map || {})) {
      if (!p || !p.id || (byId[p.id] && !byId[p.id].mod)) continue;
      byId[p.id] = p; byId[p.id.replace(/\./g, '_')] = p; n++;
    }
    return n;
  }

  const val = (node, key) => { const v = node.vals.find((p) => p[0] === key); return v ? v[1] : undefined; };
  const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };

  /** Cost of one part's own (empty) structure: the cfg price covers a full tank, so the contents are taken out. */
  function dryCost(p) {
    let c = p.cost;
    if (p.res) for (const k of Object.keys(p.res)) c -= p.res[k][1] * ((CD.resources[k] || {}).unit || 0);
    return c;
  }
  const KERBAL_MASS = 0.094;   // the game takes the seats' crew mass out of the part mass and adds it back per kerbal on board
  const partMass = (p) => p.db.mass - (p.db.crew || 0) * KERBAL_MASS + p.modMass;

  /** Parse a .craft file. Unknown parts are kept (flagged) so the caller can say which were missing. */
  function parseCraft(text) {
    const tree = Parsers.parseConfig(text);
    const top = tree;
    const header = {};
    for (const [k, v] of top.vals) if (!(k in header)) header[k] = v;
    const nodes = top.children.filter((c) => c.name === 'PART');
    const ids = nodes.map((n) => val(n, 'part'));
    const index = {};
    ids.forEach((id, i) => { index[id] = i; });
    const parts = nodes.map((n, i) => {
      const full = ids[i] || '';
      const cut = full.lastIndexOf('_');
      const name = cut > 0 ? full.slice(0, cut) : full;
      const res = {};
      for (const r of n.children.filter((c) => c.name === 'RESOURCE')) res[val(r, 'name')] = [num(val(r, 'amount'), 0), num(val(r, 'maxAmount'), 0)];
      let thrust = 100;
      for (const m of n.children.filter((c) => c.name === 'MODULE')) {
        const t = val(m, 'thrustPercentage');
        if (t !== undefined && /^ModuleEngines/.test(val(m, 'name') || '')) thrust = num(t, 100);
      }
      const pd = n.children.find((c) => c.name === 'PARTDATA');
      return {
        pid: val(n, 'persistentId'), tpers: pd ? val(pd, 'tpersID') : undefined, sepI: num(val(n, 'sepI'), -1), resPri: num(val(n, 'resPri'), 0),
        name: name, istg: num(val(n, 'istg'), -1), dstg: num(val(n, 'dstg'), -1), res: res, thrust: thrust,
        modCost: num(val(n, 'modCost'), 0), modMass: num(val(n, 'modMass'), 0),
        links: n.vals.filter((p) => p[0] === 'link').map((p) => index[p[1]]).filter((x) => x !== undefined),
        sym: n.vals.filter((p) => p[0] === 'sym').map((p) => index[p[1]]).filter((x) => x !== undefined),
        attN: n.vals.filter((p) => p[0] === 'attN').map((p) => p[1]),
        db: part(name) || null,
      };
    });
    // parent from the links (the first part is the root; links can also point "upward" in some saves, so the walk decides)
    const parentOf = new Array(parts.length).fill(-1);
    const seen = new Array(parts.length).fill(false);
    if (parts.length) {
      const stack = [0]; seen[0] = true;
      while (stack.length) {
        const i = stack.pop();
        for (const c of parts[i].links) if (!seen[c]) { seen[c] = true; parentOf[c] = i; stack.push(c); }
      }
    }
    parts.forEach((p, i) => { p.parent = parentOf[i]; });
    // a fuel duct sits on one part (its parent) and names the part at its far end by persistent id: the parent feeds that part
    const byPid = {};
    parts.forEach((p, i) => { if (p.pid !== undefined) byPid[p.pid] = i; });
    parts.forEach((p) => { p.target = p.db && p.db.fuelLine && p.tpers !== undefined && byPid[p.tpers] !== undefined ? byPid[p.tpers] : -1; });
    // which part hangs on which attachment node: "attN = bottom,<part id>_<persistent id>_<positions...>"; part ids can contain
    // underscores, so match the longest known id that starts the value
    parts.forEach((p) => {
      p.att = {};
      for (const a of p.attN) {
        const c = a.indexOf(',');
        if (c < 0) continue;
        const rest = a.slice(c + 1);
        let best = null;
        for (const id of ids) if (id && rest.startsWith(id + '_') && (!best || id.length > best.length)) best = id;
        if (best) p.att[a.slice(0, c).trim()] = index[best];
      }
    });
    return {
      name: header.ship || '', type: header.type || '', version: header.version || '', description: header.description || '',
      size: header.size ? String(header.size).split(',').map(Number).filter((x) => isFinite(x)) : null,   // bounding box (x, y, z in metres) the game stores with the craft
      parts: parts, missing: [...new Set(parts.filter((p) => !p.db).map((p) => p.name))],
    };
  }

  /** The numbers the game stores next to a craft (cost, mass, part and stage counts), for checking the import. */
  function parseLoadMeta(text) {
    const t = Parsers.parseConfig(text);
    const v = (k) => val(t, k);
    return { name: v('shipName'), cost: num(v('totalCost')), mass: num(v('totalMass')), partCount: num(v('partCount')), stageCount: num(v('stageCount')) };
  }

  /** Total cost and mass of a craft, the dry cost, the value of the propellant and the part list with prices. */
  function summarize(craft) {
    let cost = 0, dry = 0, fuel = 0, mass = 0, dryM = 0;
    const lines = {};
    for (const p of craft.parts) {
      if (!p.db) continue;
      const d = dryCost(p.db) + p.modCost;
      let f = 0, fm = 0;
      for (const k of Object.keys(p.res)) { f += p.res[k][0] * ((CD.resources[k] || {}).unit || 0); fm += p.res[k][0] * ((CD.resources[k] || {}).density || 0); }
      dry += d; fuel += f; cost += d + f; dryM += partMass(p); mass += partMass(p) + fm;
      const l = lines[p.name] || (lines[p.name] = { id: p.name, title: p.db.title, n: 0, cost: 0 });
      l.n++; l.cost += d + f;
    }
    return { cost: cost, dryCost: dry, fuelCost: fuel, mass: mass, dryMass: dryM, parts: craft.parts.length, lines: Object.values(lines).sort((a, b) => b.cost - a.cost) };
  }

  /** Rocket equation per stage. `body` supplies the surface gravity for the thrust-to-weight ratio. */
  function stages(craft, opts) {
    opts = opts || {};
    const g = opts.gravity || 9.80665;
    const P = craft.parts;
    const n = P.length;
    const alive = P.map((p) => !!p.db);
    const amount = P.map((p) => { const o = {}; for (const k of Object.keys(p.res)) o[k] = p.res[k][0]; return o; });
    const children = P.map(() => []);
    P.forEach((p, i) => { if (p.parent >= 0) children[p.parent].push(i); });
    const subtree = (i, out) => { out = out || []; out.push(i); for (const c of children[i]) subtree(c, out); return out; };
    const active = new Set();                                   // engines that are lit
    // fuel ducts: an engine on the part a duct points at can draw from the part the duct sits on (one way: the duct hangs from its source)
    const ducts = P.map(() => []);
    P.forEach((p, i) => { if (p.target >= 0) ducts[p.target].push(i); });
    const neighbours = (i) => { const o = children[i].slice(); if (P[i].parent >= 0) o.push(P[i].parent); for (const d of ducts[i]) o.push(d); return o; };
    // tanks that drain first: the game ranks them by the stage they separate in (times ten) plus their own offset
    const priority = (i) => (P[i].sepI < 0 ? -1 : P[i].sepI) * 10 + P[i].resPri;
    const blocks = (i) => !!(P[i].db && (P[i].db.noXfeed || P[i].db.dec === 1 || P[i].db.dec === 3));   // decouplers do not pass propellant

    const massOf = (i) => {
      let m = partMass(P[i]);
      for (const k of Object.keys(amount[i])) m += amount[i][k] * ((CD.resources[k] || {}).density || 0);
      return m;
    };
    const total = () => { let m = 0; for (let i = 0; i < n; i++) if (alive[i]) m += massOf(i); return m; };

    // multi-mode engines (RAPIER): opts.mode 'atmosphere' runs the air-breathing mode, anything else the one that carries its own oxidiser
    // (the first mode that needs no intake air; modes list the intake air as a propellant with no density)
    const wantAir = opts.mode === 'atmosphere';
    const eng = (i) => {
      const list = P[i].db.eng;
      if (list.length < 2) return list[0];
      const air = list.filter((m) => m.props.some((q) => q[0] === 'IntakeAir'));
      const own = list.filter((m) => !m.props.some((q) => q[0] === 'IntakeAir'));
      return (wantAir ? air[0] : own[0]) || list[0];
    };
    const out = [];
    const stageNumbers = [...new Set(P.map((p) => p.istg).filter((s) => s >= 0))].sort((a, b) => b - a);
    for (const s of stageNumbers) {
      // fire the parts of this stage: decouplers drop their far side, engines light
      const fired = [];
      for (let i = 0; i < n; i++) if (alive[i] && P[i].istg === s) fired.push(i);
      let dropped = 0;
      for (const i of fired) {
        const d = P[i].db;
        if (d.dec === 1 || d.dec === 3) {
          // a radial decoupler leaves with what hangs on it; an inline one stays with its parent
          // an inline decoupler lets go of whatever hangs on its explosive node (all its children if the node is unknown)
          let roots = subtree(i);
          if (d.dec === 1) {
            const c = d.decNode !== undefined ? P[i].att[d.decNode] : undefined;
            roots = c !== undefined && P[c].parent === i ? subtree(c) : children[i].reduce((a, k) => a.concat(subtree(k)), []);
          }
          for (const j of roots) if (alive[j]) { dropped += massOf(j); alive[j] = false; active.delete(j); }
        } else if (d.eng) active.add(i);
      }
      const m0 = total();
      const engines = [...active].filter((i) => alive[i]);
      if (!engines.length) { out.push({ stage: s, dv: 0, dvAsl: 0, time: 0, m0: m0, m1: m0, thrust: 0, twr: 0, engines: 0, dropped: dropped }); continue; }

      // burn in phases: every phase ends when a tank that an engine uses runs out (or an engine has nothing left to burn)
      let dv = 0, dvAsl = 0, time = 0, m = m0, thrustVac = 0, thrustAsl = 0, guard = 0;
      const lit = new Set(engines);
      thrustVac = 0;
      for (const i of lit) { const e = eng(i); thrustVac += e.thrust * (P[i].thrust / 100); thrustAsl += e.thrust * (P[i].thrust / 100) * ((e.isp[1] || e.isp[0]) / e.isp[0]); }
      while (guard++ < 40) {
        const flows = [];                                       // per running engine: tank usage rates (t/s) and thrust
        let ft = 0, mdotV = 0, mdotA = 0, running = 0;
        for (const i of lit) {
          const e = eng(i);
          // intake air comes from the atmosphere, not from a tank (the jet's Isp is per unit of fuel only)
          const props = e.props.filter((q) => q[0] !== 'IntakeAir' && (CD.resources[q[0]] || {}).density > 0);
          // sources: tanks reachable without crossing a blocker
          const seen = new Set([i]), q = [i], tanks = [];
          while (q.length) {
            const x = q.pop();
            if (x !== i && alive[x] && P[x].db && Object.keys(amount[x]).length) tanks.push(x);
            if (x !== i && blocks(x)) continue;
            for (const y of neighbours(x)) if (!seen.has(y) && alive[y]) { seen.add(y); q.push(y); }
          }
          const sources = props.map((pr) => {
            // solid fuel does not cross a part boundary; the rest drains from the highest-ranked tanks that still have some
            let have = (CD.resources[pr[0]] || {}).noFlow ? [i].filter((t) => (amount[t][pr[0]] || 0) > 1e-9) : tanks.filter((t) => (amount[t][pr[0]] || 0) > 1e-9);
            if (have.length > 1) { const top = Math.max(...have.map(priority)); have = have.filter((t) => priority(t) === top); }
            return have;
          });
          if (props.length === 0 || sources.some((src) => !src.length)) continue;     // out of something it needs
          const thr = e.thrust * (P[i].thrust / 100);
          const ispV = e.isp[0], ispA = e.isp[1] || e.isp[0];
          const mdot = thr / (ispV * G0);                       // t/s (the same flow in atmosphere: thrust falls with Isp)
          const perUnit = props.reduce((a, pr) => a + pr[1] * CD.resources[pr[0]].density, 0);
          flows.push({ i: i, props: props, sources: sources, rate: mdot / perUnit, thr: thr, thrA: thr * ispA / ispV, mdot: mdot });
          ft += thr; mdotV += mdot; mdotA += mdot; running++;
        }
        if (!running) break;
        // time until the first source tank is exhausted at this flow (the unit rate is split equally between the reachable tanks)
        const use = new Map();                                  // `${tank}|${res}` -> units per second
        for (const f of flows) f.props.forEach((pr, k) => {
          const per = (f.rate * pr[1]) / f.sources[k].length;
          for (const t of f.sources[k]) use.set(t + '|' + pr[0], (use.get(t + '|' + pr[0]) || 0) + per);
        });
        let dt = Infinity;
        for (const [key, r] of use) { const [t, res] = key.split('|'); dt = Math.min(dt, amount[+t][res] / r); }
        if (!isFinite(dt) || dt <= 1e-9) break;
        const mEnd = m - mdotV * dt;
        const ve = ft / mdotV;                                  // effective exhaust speed, m/s (kN / (t/s))
        dv += ve * Math.log(m / mEnd);
        const fa = flows.reduce((a, f) => a + f.thrA, 0), ma = flows.reduce((a, f) => a + f.thrA / (f.thr / f.mdot) / ((eng(f.i).isp[1] || eng(f.i).isp[0]) / eng(f.i).isp[0]), 0);
        dvAsl += (ma > 0 ? fa / ma : ve) * Math.log(m / mEnd);
        time += dt;
        for (const [key, r] of use) { const [t, res] = key.split('|'); amount[+t][res] = Math.max(0, amount[+t][res] - r * dt); }
        m = mEnd;
        for (const f of flows) {                                // an engine that has used up its propellant goes dark
          const dead = f.props.some((pr, k) => f.sources[k].every((t) => (amount[t][pr[0]] || 0) <= 1e-9));
          if (dead) lit.delete(f.i);
        }
      }
      out.push({ stage: s, dv: dv, dvAsl: dvAsl, time: time, m0: m0, m1: m, thrust: thrustVac, thrustAsl: thrustAsl, twr: thrustAsl / (m0 * g), twrVac: thrustVac / (m0 * g), engines: engines.length, dropped: dropped });
    }
    const dv = out.reduce((a, s) => a + s.dv, 0), dvAsl = out.reduce((a, s) => a + s.dvAsl, 0);
    return { stages: out, dv: dv, dvAsl: dvAsl, alive: alive.slice(), amount: amount };
  }

  /** What is left to recover after the whole staging sequence: the parts that never separated, with the propellant left in them,
   *  valued at the cfg price. `result` is the object returned by stages(). */
  function recoverable(craft, result) {
    let value = 0, mass = 0, parts = 0;
    craft.parts.forEach((p, i) => {
      if (!p.db || !result.alive[i]) return;
      value += dryCost(p.db) + p.modCost;
      mass += partMass(p);
      parts++;
      for (const k of Object.keys(result.amount[i])) value += result.amount[i][k] * ((CD.resources[k] || {}).unit || 0);
    });
    return { value: value, mass: mass, parts: parts };
  }

  return { addParts: addParts, parseCraft: parseCraft, parseLoadMeta: parseLoadMeta, summarize: summarize, stages: stages, recoverable: recoverable, dryCost: dryCost, part: part, G0: G0 };
});
