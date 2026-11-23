// SPDX-License-Identifier: AGPL-3.0-or-later
/* Time-domain CommNet simulation: where every node is, what blocks the line of sight, which paths exist.
 * No DOM access.
 *
 * Occlusion model (verified against the 1.12.5 assembly, CommNetBody.CreateOccluder): every body is a sphere of
 * radius (body radius x occlusion modifier), the atmosphere modifier for bodies with an atmosphere; atmosphere
 * height does not count (`atmosphereBlocks` can force it). Kerbol is an occluder like every other body: the Sun's
 * GameObject carries a CommNetBody in the game's scene data (all 17 stock bodies do), so `sunOccludes` is on by default;
 * the switch only exists for what-if runs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./orbits.js'), require('./core.js'), require('./trajectory.js'));
  } else root.KSPSim = factory(root.KSPData, root.KSPOrbits, root.KSPCore, root.KSPTrajectory);
})(typeof self !== 'undefined' ? self : this, function (Data, Orb, Core, Traj) {
  'use strict';

  const DEFAULTS = {
    rangeMod: 1,
    dsnPower: 50e9, // effective DSN rating (already includes the DSN modifier)
    occVac: 0.9,
    occAtm: 0.75,
    atmosphereBlocks: false,
    sunOccludes: true,
    extraStations: false, // "Enable Extra Groundstations"
    makingHistory: false, // the DLC's two permanent launch-site stations (Desert, Larkes)
    allowOtherLaunchSites: true, // difficulty option; the permanent stations need it (or extra stations)
    minSignal: 0, // a path weaker than this counts as an outage (cause "weak")
  };

  /**
   * opts: {world, lookup (antenna id -> antenna), settings, nodes}
   * node: {id, name, loc: {type:'orbit', body, orbit} | {type:'landed', body, lat, lon, alt},
   *        antennas: [{id, count}], tracked: bool}
   */
  /** A time scale for choosing scan steps: the period of a closed orbit, the periapsis passage time of an escape orbit. */
  function timeScale(p) {
    if (!p.hyper) return p.period;
    const rp = Math.abs(p.a) * (p.e - 1);
    return Orb.TAU * Math.sqrt((rp * rp * rp) / p.gm);
  }

  function createSim(opts) {
    const world = opts.world;
    const st = Object.assign({}, DEFAULTS, opts.settings || {});
    const lookup = opts.lookup;
    const nb = world.bodies.length;

    // Blocking radius^2 per body.
    const occR2 = new Float64Array(nb);
    const occInv = new Float64Array(nb);
    const occR = new Float64Array(nb);
    world.bodies.forEach((b, i) => {
      if (b.star && !st.sunOccludes) return;
      const mult = b.hasAtmo ? st.occAtm : st.occVac;
      const r = (b.radius + (st.atmosphereBlocks ? b.atmo : 0)) * mult;
      occR2[i] = r * r;
      occInv[i] = 1 / r;
      occR[i] = r;
    });

    const nodes = [];
    // Home stations first.
    const kerbin = world.index.get('Kerbin');
    if (kerbin) {
      for (const s of world.stations) {
        // Per-station override (network planning what-ifs): true forces a station on, false off.
        const ov = st.stationOverride ? st.stationOverride[s.id] : undefined;
        if (ov === false) continue;
        if (ov !== true) {
          if (s.dlc && !st.makingHistory) continue;
          // Game rule (CommNetHome.CreateNode): extra stations off -> only KSC (plus permanent launch-site stations if
          // other launch sites are allowed); on -> all stations. Permanent ones keep a small fixed antenna.
          if (s.kind === 'anomaly' && !st.extraStations) continue;
          if (s.kind === 'permanent' && !(st.extraStations || st.allowOtherLaunchSites)) continue;
        }
        const power = s.kind === 'permanent' ? s.power : st.dsnPower;
        nodes.push({
          id: 'station:' + s.id, name: s.name, home: true, tracked: false, loc: { type: 'landed', body: 'Kerbin', lat: s.lat, lon: s.lon, alt: s.alt || 0 },
          own: power, relay: power, power: power,
        });
      }
    }
    // Stations the player wants to model on top of the game's (a modded or planned station): { id, name, lat, lon, alt, power }.
    for (const c of st.customStations || []) {
      nodes.push({
        id: 'station:' + c.id, name: c.name, home: true, tracked: false, loc: { type: 'landed', body: 'Kerbin', lat: c.lat, lon: c.lon, alt: c.alt || 0 },
        own: c.power || st.dsnPower, relay: c.power || st.dsnPower, power: c.power || st.dsnPower,
      });
    }
    const homeCount = nodes.length;
    const problems = [];
    for (const n of opts.nodes || []) {
      const stats = n.powerOverride || Core.vesselStats(n.antennas || [], lookup, st.rangeMod, { relayEnabler: n.relayEnabler });
      const rec = { id: n.id, name: n.name, home: false, tracked: n.tracked !== false, loc: n.loc, own: stats.own, relay: stats.relay, source: n };
      // Optional terrain-shadow what-if for a landed node: it cannot see anything lower than `mask` degrees above its local horizon.
      // Stock CommNet has no terrain occlusion (only whole bodies block), so this is off unless a plan asks for it.
      if (n.mask > 0 && n.loc.type === 'landed') rec.mask = Math.sin(Math.min(n.mask, 89) * Math.PI / 180);
      if (n.loc.type === 'orbit') {
        const b = world.index.get(n.loc.body);
        if (!b) { problems.push('“' + n.name + '”: unknown body ' + n.loc.body); continue; }
        rec._p = Orb.prepare(n.loc.orbit, b.gm);
        rec.period = timeScale(rec._p);
        // opt-in patched conics: follow the vessel through sphere-of-influence exits and encounters (escape trajectories, transfers)
        if ((n.loc.patched || (n.loc.burns && n.loc.burns.length)) && opts.trajectory) {
          const segs = Traj.build(world, b.id, n.loc.orbit, opts.trajectory.t0, opts.trajectory.horizon, n.loc.burns, opts.trajectory.maxSegments);
          if (segs.length > 1) {
            segs.forEach((sg) => { sg.bodyIdx = sg.body.idx; });
            rec._segs = segs;
            rec.period = Math.min.apply(null, segs.map((sg) => timeScale(sg.p)));
          }
        }
      } else if (n.loc.type === 'landed') {
        if (!world.index.get(n.loc.body)) { problems.push('“' + n.name + '”: unknown body ' + n.loc.body); continue; }
      } else { problems.push('“' + n.name + '”: unknown location type'); continue; }
      nodes.push(rec);
    }
    const n = nodes.length;
    const bodyIdx = nodes.map((r) => world.index.get(r.loc.body).idx);
    const isHome = nodes.map((r) => r.home);
    const maskSin = nodes.map((r) => r.mask || 0);
    const anyMask = maskSin.some((m) => m > 0);
    const trackedIdx = [];
    nodes.forEach((r, i) => { if (!r.home && r.tracked) trackedIdx.push(i); });

    // Reusable buffers.
    const bodyPos = new Float64Array(nb * 3);
    const nodePos = new Float64Array(n * 3);
    const tmp = [0, 0, 0];
    const relSig = new Float64Array(n * n);
    const relRng = new Float64Array(n * n);
    const relBlk = new Int16Array(n * n).fill(-1);
    // Only nodes with relay power can form relay links; the rest of the matrix stays 0 / unblocked.
    const relayIdx = [];
    for (let i = 0; i < n; i++) if (nodes[i].relay > 0) relayIdx.push(i);
    const rowSig = new Float64Array(n);
    const rowRng = new Float64Array(n);
    const rowBlk = new Int16Array(n);
    const best = new Float64Array(n);
    const prev = new Int16Array(n);
    const done = new Uint8Array(n);

    /**
     * First body that blocks the line of sight a->b, or -1. This is a port of the game's own test
     * (CommNet.Occluders.OccluderHorizonCulling.Raycast, read from the 1.12.5 assembly): work in units of the
     * blocking radius with the nearer endpoint first; an endpoint inside the sphere only blocks when the other
     * end lies toward the centre.
     */
    function blocker(ax, ay, az, bx, by, bz) {
      // Cheap rejection first: a body can only matter if it touches the sphere that encloses the whole segment.
      const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
      const hx = bx - mx, hy = by - my, hz = bz - mz;
      const half = Math.sqrt(hx * hx + hy * hy + hz * hz);
      for (let i = 0; i < nb; i++) {
        const r2 = occR2[i];
        if (r2 === 0) continue;
        const cx = bodyPos[i * 3], cy = bodyPos[i * 3 + 1], cz = bodyPos[i * 3 + 2];
        const ux = cx - mx, uy = cy - my, uz = cz - mz;
        const reach = half + occR[i];
        if (ux * ux + uy * uy + uz * uz >= reach * reach) continue;
        let px = ax - cx, py = ay - cy, pz = az - cz, qx = bx - cx, qy = by - cy, qz = bz - cz;
        if (px * px + py * py + pz * pz > qx * qx + qy * qy + qz * qz) {
          const tx = px, ty = py, tz = pz;
          px = qx; py = qy; pz = qz; qx = tx; qy = ty; qz = tz;
        }
        const inv = occInv[i];
        px *= inv; py *= inv; pz *= inv; qx *= inv; qy *= inv; qz *= inv;
        const A = px * px + py * py + pz * pz - 1;
        const dx = qx - px, dy = qy - py, dz = qz - pz;
        const L = -(dx * px + dy * py + dz * pz);
        if (A < 0) { if (L > 0) return i; continue; }
        if (L > A && (L * L) / (dx * dx + dy * dy + dz * dz) > A) return i;
      }
      return -1;
    }

    function placeNodes(t) {
      world.positions(t, bodyPos);
      for (let i = 0; i < n; i++) {
        const r = nodes[i];
        let bi = bodyIdx[i];
        if (r.loc.type === 'landed') {
          world.surfacePoint(world.bodies[bi], r.loc.lat, r.loc.lon, r.loc.alt || 0, t, bodyPos, tmp);
        } else {
          let p = r._p;
          if (r._segs) { const sg = Traj.segmentAt(r._segs, t); p = sg.p; bi = sg.bodyIdx; }
          Orb.position(p, t, tmp);
          tmp[0] += bodyPos[bi * 3]; tmp[1] += bodyPos[bi * 3 + 1]; tmp[2] += bodyPos[bi * 3 + 2];
        }
        nodePos[i * 3] = tmp[0]; nodePos[i * 3 + 1] = tmp[1]; nodePos[i * 3 + 2] = tmp[2];
      }
    }

    // Link between nodes i and j with powers pa, pb -> sets sig/rng/blk at (i,j).
    function link(i, j, pa, pb, sigA, rngA, blkA, ia, ja) {
      const R = Core.linkRange(pa, pb);
      sigA[ia] = 0; rngA[ia] = 0; blkA[ia] = -1;
      if (!(R > 0)) return;
      const ax = nodePos[i * 3], ay = nodePos[i * 3 + 1], az = nodePos[i * 3 + 2];
      const dx = nodePos[j * 3] - ax, dy = nodePos[j * 3 + 1] - ay, dz = nodePos[j * 3 + 2] - az;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d >= R) return;
      const s = Core.signalStrength(d, R);
      rngA[ia] = s;
      if (anyMask) {
        const low = (a, o) => {
          if (!(maskSin[a] > 0)) return false;
          const c = bodyIdx[a] * 3;
          const ux = nodePos[a * 3] - bodyPos[c], uy = nodePos[a * 3 + 1] - bodyPos[c + 1], uz = nodePos[a * 3 + 2] - bodyPos[c + 2];
          const dot = (nodePos[o * 3] - nodePos[a * 3]) * ux + (nodePos[o * 3 + 1] - nodePos[a * 3 + 1]) * uy + (nodePos[o * 3 + 2] - nodePos[a * 3 + 2]) * uz;
          return dot < maskSin[a] * d * Math.sqrt(ux * ux + uy * uy + uz * uz);
        };
        if (low(i, j)) { blkA[ia] = bodyIdx[i]; return; }
        if (low(j, i)) { blkA[ia] = bodyIdx[j]; return; }
      }
      const bl = blocker(ax, ay, az, nodePos[j * 3], nodePos[j * 3 + 1], nodePos[j * 3 + 2]);
      blkA[ia] = bl;
      if (bl < 0) sigA[ia] = s;
    }

    function buildRelayMatrix() {
      const m = relayIdx.length;
      for (let a = 0; a < m; a++) {
        const i = relayIdx[a];
        for (let b = a + 1; b < m; b++) {
          const j = relayIdx[b];
          if (isHome[i] && isHome[j]) continue; // never written: stays 0 / -1
          link(i, j, nodes[i].relay, nodes[j].relay, relSig, relRng, relBlk, i * n + j, 0);
          relSig[j * n + i] = relSig[i * n + j];
          relRng[j * n + i] = relRng[i * n + j];
          relBlk[j * n + i] = relBlk[i * n + j];
        }
      }
    }

    /** Best path (max product of signals) from `src` to any home over a signal matrix + source row. */
    function search(src, mat, row, out) {
      best.fill(-1); prev.fill(-1); done.fill(0);
      best[src] = 1;
      for (;;) {
        let u = -1, bu = 0;
        for (let k = 0; k < n; k++) if (!done[k] && best[k] > bu) { bu = best[k]; u = k; }
        if (u < 0) return false;
        done[u] = 1;
        if (isHome[u]) {
          out.signal = best[u];
          const path = [];
          for (let k = u; k >= 0; k = prev[k]) path.push(k);
          out.path = path.reverse();
          return true;
        }
        for (let v = 0; v < n; v++) {
          if (done[v] || v === u) continue;
          const s = u === src ? row[v] : mat[u * n + v];
          if (s > 0 && bu * s > best[v]) { best[v] = bu * s; prev[v] = u; }
        }
      }
    }

    /** Connectivity of one tracked source at the current (already placed) time. */
    function evalSource(si) {
      const src = nodes[si];
      for (let k = 0; k < n; k++) {
        rowSig[k] = 0; rowRng[k] = 0; rowBlk[k] = -1;
        if (k === si) continue;
        link(si, k, src.own, nodes[k].relay, rowSig, rowRng, rowBlk, k, 0);
      }
      const out = { index: si, name: src.name, connected: false, signal: 0, path: null, cause: null };
      if (search(si, relSig, rowSig, out)) {
        if (out.signal >= st.minSignal) { out.connected = true; return out; }
        out.cause = { type: 'weak' };
        return out;
      }
      out.signal = 0;
      // Not connected: would range alone allow it? Then something is in the way.
      const alt = { signal: 0, path: null };
      if (search(si, relRng, rowRng, alt)) {
        const blockers = new Set();
        for (let e = 0; e + 1 < alt.path.length; e++) {
          const a = alt.path[e], b = alt.path[e + 1];
          const s = a === si ? rowSig[b] : relSig[a * n + b];
          if (s === 0) blockers.add(world.bodies[a === si ? rowBlk[b] : relBlk[a * n + b]].id);
        }
        out.cause = { type: 'occlusion', bodies: Array.from(blockers) };
        out.blockedPath = alt.path.slice();
      } else {
        out.cause = { type: 'range' };
      }
      return out;
    }

    /** Position of node i at time t (inertial, Kerbol-centred) into out[0..2]; for drawing trajectories. */
    function nodePositionAt(i, t, out) {
      const r = nodes[i];
      const bp = world.positions(t);
      let bi = bodyIdx[i];
      if (r.loc.type === 'landed') world.surfacePoint(world.bodies[bi], r.loc.lat, r.loc.lon, r.loc.alt || 0, t, bp, out);
      else {
        let p = r._p;
        if (r._segs) { const sg = Traj.segmentAt(r._segs, t); p = sg.p; bi = sg.bodyIdx; }
        Orb.position(p, t, out);
        out[0] += bp[bi * 3]; out[1] += bp[bi * 3 + 1]; out[2] += bp[bi * 3 + 2];
        return out;
      }
      return out;
    }

    /** Evaluate every tracked source at time t. */
    function evalAt(t) {
      placeNodes(t);
      buildRelayMatrix();
      return trackedIdx.map(evalSource);
    }

    /**
     * Who can talk to whom at time t (network view). Relay-capable nodes (relay power > 0, the ground stations included) form
     * the backbone: two of them are joined when their relay link is clear; all ground stations count as one network (the DSN).
     * Other vessels attach to the backbone with their own antennas, or reach each other directly. Returns
     * { pair: Uint8Array(n*n) (1 = a path exists between the two), home: Uint8Array(n) (1 = reaches a ground station), comp }.
     */
    function connectivityAt(t) {
      placeNodes(t);
      buildRelayMatrix();
      const comp = new Int16Array(n).fill(-1);
      let nc = 0;
      const homes = [];
      for (let i = 0; i < n; i++) if (isHome[i]) homes.push(i);
      for (const a of relayIdx) {
        if (comp[a] >= 0) continue;
        comp[a] = nc;
        const stack = [a];
        while (stack.length) {
          const u = stack.pop();
          for (const v of relayIdx) if (comp[v] < 0 && relSig[u * n + v] > 0) { comp[v] = nc; stack.push(v); }
          if (isHome[u]) for (const v of homes) if (comp[v] < 0) { comp[v] = nc; stack.push(v); }
        }
        nc++;
      }
      // the DSN is one network: merge the components of all ground stations
      if (homes.length > 1) {
        const target = comp[homes[0]];
        for (const hh of homes) if (comp[hh] !== target) { const old = comp[hh]; for (let i = 0; i < n; i++) if (comp[i] === old) comp[i] = target; }
      }
      const attach = [];
      for (let i = 0; i < n; i++) {
        const set = new Set();
        if (comp[i] >= 0) set.add(comp[i]);
        if (nodes[i].relay <= 0 || !isHome[i]) {
          for (const k of relayIdx) {
            if (k === i) continue;
            link(i, k, nodes[i].own, nodes[k].relay, rowSig, rowRng, rowBlk, k, 0);
            if (rowSig[k] > 0) set.add(comp[k]);
          }
        }
        attach.push(set);
      }
      const pair = new Uint8Array(n * n);
      const homeComp = homes.length ? comp[homes[0]] : -1;
      const hm = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        hm[i] = attach[i].has(homeComp) ? 1 : 0;
        for (let j = i + 1; j < n; j++) {
          let ok = false;
          for (const c of attach[i]) if (attach[j].has(c)) { ok = true; break; }
          if (!ok && (nodes[i].relay <= 0 || nodes[j].relay <= 0)) {
            link(i, j, nodes[i].own, nodes[j].own, rowSig, rowRng, rowBlk, j, 0);
            ok = rowSig[j] > 0;
          }
          pair[i * n + j] = pair[j * n + i] = ok ? 1 : 0;
        }
      }
      return { pair: pair, home: hm, comp: comp };
    }

    /**
     * The straight line between two nodes over time, with the real positions of vessels and stations (so a vessel hiding behind its
     * own planet counts): { samples, blocked (0..1), by: {bodyName: 0..1}, min, max, now } distances in metres.
     */
    function sightBetween(i, j, t0, horizon, samples) {
      const cnt = Math.max(2, samples | 0);
      const by = {};
      let blocked = 0, lo = Infinity, hi = 0, now = 0;
      for (let k = 0; k < cnt; k++) {
        placeNodes(t0 + (horizon * k) / (cnt - 1));
        const ax = nodePos[i * 3], ay = nodePos[i * 3 + 1], az = nodePos[i * 3 + 2];
        const bx = nodePos[j * 3], by_ = nodePos[j * 3 + 1], bz = nodePos[j * 3 + 2];
        const d = Math.sqrt((bx - ax) * (bx - ax) + (by_ - ay) * (by_ - ay) + (bz - az) * (bz - az));
        if (k === 0) now = d;
        if (d < lo) lo = d;
        if (d > hi) hi = d;
        const bl = blocker(ax, ay, az, bx, by_, bz);
        if (bl >= 0) { blocked++; const nm = world.bodies[bl].name; by[nm] = (by[nm] || 0) + 1; }
      }
      Object.keys(by).forEach((nm) => { by[nm] /= cnt; });
      return { samples: cnt, blocked: blocked / cnt, by: by, min: lo, max: hi, now: now };
    }

    /** Evaluate a single tracked source (index into trackedIdx) at time t; much cheaper than evalAt when refining edges. */
    function evalOne(t, s) {
      placeNodes(t);
      buildRelayMatrix();
      return evalSource(trackedIdx[s]);
    }

    /** Positions and link states for drawing; also evaluates sources. */
    function snapshot(t) {
      const results = evalAt(t);
      const links = [];
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (isHome[i] && isHome[j]) continue;
          const s = relSig[i * n + j], r = relRng[i * n + j];
          if (r > 0) links.push({ a: i, b: j, signal: s, blocked: s === 0, blocker: s === 0 ? world.bodies[relBlk[i * n + j]].id : null });
        }
      }
      // Source links using own power.
      for (const si of trackedIdx) {
        for (let k = 0; k < n; k++) {
          if (k === si) continue;
          link(si, k, nodes[si].own, nodes[k].relay, rowSig, rowRng, rowBlk, k, 0);
          if (rowRng[k] > 0) links.push({ a: si, b: k, signal: rowSig[k], blocked: rowSig[k] === 0, blocker: rowSig[k] === 0 ? world.bodies[rowBlk[k]].id : null, own: true });
        }
      }
      return { t: t, bodyPos: Float64Array.from(bodyPos), nodePos: Float64Array.from(nodePos), links: links, results: results };
    }

    /** Suggest a time step (s): fine enough to catch the fastest motion that matters. */
    function suggestStep(precision) {
      let minP = Infinity;
      const kb = world.index.get('Kerbin');
      if (kb && homeCount) minP = Math.min(minP, kb.rotPeriod);
      for (let i = homeCount; i < n; i++) {
        const r = nodes[i];
        if (r.period) minP = Math.min(minP, r.period);
        if (r.loc.type === 'landed') minP = Math.min(minP, world.index.get(r.loc.body).rotPeriod);
      }
      return Math.min(3600, Math.max(20, minP / (precision || 48)));
    }

    return {
      world: world, settings: st, nodes: nodes, homeCount: homeCount, trackedIdx: trackedIdx, problems: problems,
      evalAt: evalAt, evalOne: evalOne, connectivityAt: connectivityAt, sightBetween: sightBetween, nodePositionAt: nodePositionAt, snapshot: snapshot, suggestStep: suggestStep,
    };
  }

  /* ---------------- timeline scanning ---------------- */

  const causeKey = (c) => (!c ? '' : c.type === 'occlusion' ? 'occ:' + c.bodies.slice().sort().join(',') : c.type);

  /**
   * Scan [t0, t1] for connection state changes of each tracked source.
   * Returns a stepper: call `run(budgetMs)` until it returns true, then read `.result`.
   * `refineTol` (s, default 0.5) is how closely blackout edges are pinned down; the planner compares many candidates
   * and passes a coarser value, reported timelines keep the default.
   */
  function createScanner(sim, t0, t1, dt, refineTol) {
    const tol = refineTol > 0.5 ? refineTol : 0.5;
    const srcs = sim.trackedIdx.map((i) => sim.nodes[i]);
    const S = srcs.length;
    const buckets = 1200;
    const span = t1 - t0;
    const perBucket = Math.max(1, Math.ceil(span / dt / buckets));
    const data = srcs.map((r) => ({
      name: r.name, blackouts: [], connectedTime: 0, sigTime: 0, minSig: 1, cur: null,
      series: new Float32Array(Math.ceil(span / dt / perBucket) + 2).fill(1), sn: 0, bucketMin: 1, bc: 0,
    }));
    let t = t0, first = true, prevT = t0;

    function refine(idx, ta, tb, ka) {
      // Find the transition time between ta (state ka) and tb (different) by bisection.
      let lo = ta, hi = tb;
      for (let k = 0; k < 20 && hi - lo > tol; k++) {
        const mid = (lo + hi) / 2;
        const r = sim.evalOne(mid, idx);
        if (r.connected === ka) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }

    function consume(res, tNow) {
      for (let s = 0; s < S; s++) {
        const r = res[s], d = data[s];
        const step = tNow - prevT;
        if (r.connected) { d.connectedTime += step; d.sigTime += step * r.signal; if (r.signal < d.minSig) d.minSig = r.signal; }
        const key = causeKey(r.cause);
        if (d.cur === null) {
          if (!r.connected) d.cur = { start: refine(s, prevT, tNow, true), causes: new Map([[key, r.cause]]), minSig: 0 };
        } else if (r.connected) {
          const end = refine(s, prevT, tNow, false);
          d.cur.end = end; d.cur.duration = end - d.cur.start;
          d.blackouts.push(d.cur); d.cur = null;
        } else if (!d.cur.causes.has(key)) {
          d.cur.causes.set(key, r.cause);
        }
        // series bucket = minimum signal in the bucket so outages stay visible
        const v = r.connected ? r.signal : 0;
        if (v < d.bucketMin) d.bucketMin = v;
        if (++d.bc >= perBucket) { d.series[d.sn++] = d.bucketMin; d.bucketMin = 1; d.bc = 0; }
      }
    }

    function fixStart(res, tNow) {
      // A blackout already in progress at t0 starts at t0.
      for (let s = 0; s < S; s++) {
        if (!res[s].connected) data[s].cur = { start: tNow, causes: new Map([[causeKey(res[s].cause), res[s].cause]]), minSig: 0, openStart: true };
      }
    }

    const scanner = {
      progress: 0,
      done: false,
      result: null,
      run(budgetMs) {
        const stopAt = Date.now() + (budgetMs || 1e9);
        while (t <= t1) {
          const res = sim.evalAt(t);
          if (first) { first = false; fixStart(res, t); prevT = t; t += dt; continue; }
          consume(res, t);
          prevT = t;
          t += dt;
          if (Date.now() > stopAt) { scanner.progress = (t - t0) / span; return false; }
        }
        // close open blackouts at t1
        for (let s = 0; s < S; s++) {
          const d = data[s];
          if (d.cur) { d.cur.end = t1; d.cur.duration = t1 - d.cur.start; d.cur.ongoing = true; d.blackouts.push(d.cur); d.cur = null; }
        }
        scanner.progress = 1;
        scanner.done = true;
        scanner.result = {
          t0: t0, t1: t1, dt: dt,
          sources: data.map((d, s) => {
            const total = t1 - t0;
            const outage = d.blackouts.reduce((q, b) => q + b.duration, 0);
            return {
              name: d.name,
              uptime: total > 0 ? Math.max(0, 1 - outage / total) : 1,
              avgSignal: d.connectedTime > 0 ? d.sigTime / d.connectedTime : 0,
              minSignal: d.connectedTime > 0 ? d.minSig : 0,
              longestBlackout: d.blackouts.reduce((q, b) => Math.max(q, b.duration), 0),
              blackouts: d.blackouts.map((b) => ({
                start: b.start, end: b.end, duration: b.duration, ongoing: !!b.ongoing, startedBefore: !!b.openStart,
                causes: Array.from(b.causes.values()),
              })),
              series: d.series.slice(0, d.sn),
              seriesStep: dt * perBucket,
            };
          }),
        };
        return true;
      },
    };
    return scanner;
  }

  function scanSync(sim, t0, t1, dt) {
    const sc = createScanner(sim, t0, t1, dt);
    sc.run(0);
    while (!sc.done) sc.run(1e9);
    return sc.result;
  }

  return { DEFAULTS: DEFAULTS, createSim: createSim, createScanner: createScanner, scanSync: scanSync, causeKey: causeKey };
});
