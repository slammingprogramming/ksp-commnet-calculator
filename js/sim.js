// SPDX-License-Identifier: AGPL-3.0-or-later
/* Time-domain CommNet simulation: where every node is, what blocks the line of sight, which paths exist.
 * No DOM access.
 *
 * Occlusion model (verified against the 1.12.5 assembly, CommNetBody.CreateOccluder): every body is a sphere of
 * radius (body radius x occlusion modifier), the atmosphere modifier for bodies with an atmosphere; atmosphere
 * height does not count (`atmosphereBlocks` can force it). Whether Kerbol carries an occluder is scene data that
 * can't be read from the code, so `sunOccludes` stays an assumption (default on).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./orbits.js'), require('./core.js'));
  } else root.KSPSim = factory(root.KSPData, root.KSPOrbits, root.KSPCore);
})(typeof self !== 'undefined' ? self : this, function (Data, Orb, Core) {
  'use strict';

  const DEFAULTS = {
    rangeMod: 1,
    dsnPower: 50e9, // effective DSN rating (already includes the DSN modifier)
    occVac: 0.9,
    occAtm: 0.75,
    atmosphereBlocks: false,
    sunOccludes: true,
    extraStations: false, // "Enable Extra Groundstations"
    larkes: false, // Making History station
    allowOtherLaunchSites: true, // difficulty option; the permanent stations need it (or extra stations)
    minSignal: 0, // a path weaker than this counts as an outage (cause "weak")
  };

  /**
   * opts: {world, lookup (antenna id -> antenna), settings, nodes}
   * node: {id, name, loc: {type:'orbit', body, orbit} | {type:'landed', body, lat, lon, alt},
   *        antennas: [{id, count}], tracked: bool}
   */
  function createSim(opts) {
    const world = opts.world;
    const st = Object.assign({}, DEFAULTS, opts.settings || {});
    const lookup = opts.lookup;
    const nb = world.bodies.length;

    // Blocking radius^2 per body.
    const occR2 = new Float64Array(nb);
    const occInv = new Float64Array(nb);
    world.bodies.forEach((b, i) => {
      if (b.star && !st.sunOccludes) return;
      const mult = b.hasAtmo ? st.occAtm : st.occVac;
      const r = (b.radius + (st.atmosphereBlocks ? b.atmo : 0)) * mult;
      occR2[i] = r * r;
      occInv[i] = 1 / r;
    });

    const nodes = [];
    // Home stations first.
    const kerbin = world.index.get('Kerbin');
    if (kerbin) {
      for (const s of world.stations) {
        if (s.dlc && !st.larkes) continue;
        // Game rule (CommNetHome.CreateNode): extra stations off -> only KSC (plus permanent launch-site stations if
        // other launch sites are allowed); on -> all stations. Permanent ones keep a small fixed antenna.
        if (s.kind === 'anomaly' && !st.extraStations) continue;
        if (s.kind === 'permanent' && !(st.extraStations || st.allowOtherLaunchSites)) continue;
        const power = s.kind === 'permanent' ? Data.DISCONNECTED_STATION_POWER : st.dsnPower;
        nodes.push({
          id: 'station:' + s.id, name: s.name, home: true, tracked: false, loc: { type: 'landed', body: 'Kerbin', lat: s.lat, lon: s.lon, alt: 0 },
          own: power, relay: power, power: power,
        });
      }
    }
    const homeCount = nodes.length;
    const problems = [];
    for (const n of opts.nodes || []) {
      const stats = n.powerOverride || Core.vesselStats(n.antennas || [], lookup, st.rangeMod);
      const rec = { id: n.id, name: n.name, home: false, tracked: n.tracked !== false, loc: n.loc, own: stats.own, relay: stats.relay, source: n };
      if (n.loc.type === 'orbit') {
        const b = world.index.get(n.loc.body);
        if (!b) { problems.push('“' + n.name + '”: unknown body ' + n.loc.body); continue; }
        rec._p = Orb.prepare(n.loc.orbit, b.gm);
        rec.period = rec._p.period;
      } else if (n.loc.type === 'landed') {
        if (!world.index.get(n.loc.body)) { problems.push('“' + n.name + '”: unknown body ' + n.loc.body); continue; }
      } else { problems.push('“' + n.name + '”: unknown location type'); continue; }
      nodes.push(rec);
    }
    const n = nodes.length;
    const bodyIdx = nodes.map((r) => world.index.get(r.loc.body).idx);
    const isHome = nodes.map((r) => r.home);
    const trackedIdx = [];
    nodes.forEach((r, i) => { if (!r.home && r.tracked) trackedIdx.push(i); });

    // Reusable buffers.
    const bodyPos = new Float64Array(nb * 3);
    const nodePos = new Float64Array(n * 3);
    const tmp = [0, 0, 0];
    const relSig = new Float64Array(n * n);
    const relRng = new Float64Array(n * n);
    const relBlk = new Int16Array(n * n);
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
      for (let i = 0; i < nb; i++) {
        const r2 = occR2[i];
        if (r2 === 0) continue;
        const cx = bodyPos[i * 3], cy = bodyPos[i * 3 + 1], cz = bodyPos[i * 3 + 2];
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
        const bi = bodyIdx[i];
        if (r.loc.type === 'landed') {
          world.surfacePoint(world.bodies[bi], r.loc.lat, r.loc.lon, r.loc.alt || 0, t, bodyPos, tmp);
        } else {
          Orb.position(r._p, t, tmp);
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
      const bl = blocker(ax, ay, az, nodePos[j * 3], nodePos[j * 3 + 1], nodePos[j * 3 + 2]);
      blkA[ia] = bl;
      if (bl < 0) sigA[ia] = s;
    }

    function buildRelayMatrix() {
      for (let i = 0; i < n; i++) {
        relSig[i * n + i] = 0; relRng[i * n + i] = 0; relBlk[i * n + i] = -1;
        for (let j = i + 1; j < n; j++) {
          if (isHome[i] && isHome[j]) { relSig[i * n + j] = relSig[j * n + i] = 0; relRng[i * n + j] = relRng[j * n + i] = 0; relBlk[i * n + j] = relBlk[j * n + i] = -1; continue; }
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

    /** Evaluate every tracked source at time t. */
    function evalAt(t) {
      placeNodes(t);
      buildRelayMatrix();
      return trackedIdx.map(evalSource);
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
      evalAt: evalAt, snapshot: snapshot, suggestStep: suggestStep,
    };
  }

  /* ---------------- timeline scanning ---------------- */

  const causeKey = (c) => (!c ? '' : c.type === 'occlusion' ? 'occ:' + c.bodies.slice().sort().join(',') : c.type);

  /**
   * Scan [t0, t1] for connection state changes of each tracked source.
   * Returns a stepper: call `run(budgetMs)` until it returns true, then read `.result`.
   */
  function createScanner(sim, t0, t1, dt) {
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
      for (let k = 0; k < 14 && hi - lo > 0.5; k++) {
        const mid = (lo + hi) / 2;
        const r = sim.evalAt(mid)[idx];
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
