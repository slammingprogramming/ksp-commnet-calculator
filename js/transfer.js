// SPDX-License-Identifier: AGPL-3.0-or-later
/* Interplanetary launch windows: a Lambert solver and a porkchop-style search between two bodies that orbit the same parent
 * (planet to planet around Kerbol, or moon to moon around a planet). Pure logic, no DOM access.
 * Two-body, impulsive burns, circular parking and capture orbits: the delta-v figures are what you should budget before the
 * gravity and steering losses of a real burn.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./orbits.js'));
  else root.KSPTransfer = factory(root.KSPOrbits);
})(typeof self !== 'undefined' ? self : this, function (Orb) {
  'use strict';

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => Math.sqrt(dot(a, a));

  function stumpffC(z) {
    if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
    if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
    return 0.5 - z / 24;
  }
  function stumpffS(z) {
    if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
    if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
    return 1 / 6 - z / 120;
  }

  /** Lambert's problem (universal variables): velocities at r1 and r2 for a transfer of time tof about a body with parameter mu; prograde about +z by default. */
  function lambert(mu, r1, r2, tof, retrograde) {
    const n1 = norm(r1), n2 = norm(r2);
    const c = cross(r1, r2);
    let dth = Math.acos(Math.max(-1, Math.min(1, dot(r1, r2) / (n1 * n2))));
    if (retrograde ? c[2] >= 0 : c[2] < 0) dth = 2 * Math.PI - dth;
    const A = Math.sin(dth) * Math.sqrt((n1 * n2) / (1 - Math.cos(dth)));
    if (!isFinite(A) || A === 0) return null;
    const y = (z) => n1 + n2 + (A * (z * stumpffS(z) - 1)) / Math.sqrt(stumpffC(z));
    const F = (z) => {
      const yz = y(z);
      if (yz < 0) return NaN;
      return Math.pow(yz / stumpffC(z), 1.5) * stumpffS(z) + A * Math.sqrt(yz) - Math.sqrt(mu) * tof;
    };
    // bracket the root: F increases with z; start from a z that makes y positive
    let lo = -4 * Math.PI * Math.PI, hi = 4 * Math.PI * Math.PI - 0.05;
    while (lo < hi && !(y(lo) > 0)) lo += 0.5;
    let flo = F(lo), fhi = F(hi);
    if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2, fm = F(mid);
      if (!isFinite(fm)) { lo = mid; continue; }
      if (fm * flo < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
      if (hi - lo < 1e-10) break;
    }
    const z = (lo + hi) / 2, yz = y(z);
    if (!(yz > 0)) return null;
    const f = 1 - yz / n1, g = A * Math.sqrt(yz / mu), gdot = 1 - yz / n2;
    const v1 = [(r2[0] - f * r1[0]) / g, (r2[1] - f * r1[1]) / g, (r2[2] - f * r1[2]) / g];
    const v2 = [(gdot * r2[0] - r1[0]) / g, (gdot * r2[1] - r1[1]) / g, (gdot * r2[2] - r1[2]) / g];
    return { v1: v1, v2: v2 };
  }

  /** Burn from a circular orbit of radius r about a body to leave with hyperbolic excess speed vinf (or to capture into it). */
  const burn = (mu, r, vinf) => Math.sqrt(vinf * vinf + (2 * mu) / r) - Math.sqrt(mu / r);

  /**
   * Launch windows from body `fromId` to `toId` (siblings under one parent) searching departures in [t0, t0 + horizon].
   * o: { parkAlt, captureAlt (m, circular orbits; captureAlt null = fly-by only), maxTof }.
   * Returns { windows: [{depart, arrive, tof, vinfDepart, vinfArrive, dvDepart, dvArrive, total}], grid, synodic } with one best entry per window.
   */
  function windows(world, fromId, toId, t0, horizon, o) {
    const a = world.index.get(fromId), b = world.index.get(toId);
    if (!a || !b || a === b || !a.parentBody || a.parentBody !== b.parentBody) return null;
    const parent = a.parentBody, mu = parent.gm;
    const pa = a._p, pb = b._p;
    const Ta = pa.period, Tb = pb.period;
    const synodic = Math.abs(1 / (1 / Ta - 1 / Tb));
    const aMean = (a.orbit.a + b.orbit.a) / 2;
    const hohmann = Math.PI * Math.sqrt((aMean * aMean * aMean) / mu);
    const nd = Math.max(120, Math.min(480, Math.round(horizon / (synodic / 40))));
    const nt = 36;
    const tofLo = Math.max(0.35 * hohmann, 3600), tofHi = Math.min((o && o.maxTof) || 2.2 * hohmann, 3 * hohmann);
    const rPark = a.radius + (o && o.parkAlt != null ? o.parkAlt : 100000);
    const rCap = o && o.captureAlt != null ? b.radius + o.captureAlt : null;
    const ra = [0, 0, 0], va = [0, 0, 0], rb = [0, 0, 0], vb = [0, 0, 0];
    const grid = [];
    for (let i = 0; i < nd; i++) {
      const td = t0 + (horizon * i) / (nd - 1);
      Orb.position(pa, td, ra); Orb.velocity(pa, td, va);
      const row = [];
      for (let j = 0; j < nt; j++) {
        const tof = tofLo + ((tofHi - tofLo) * j) / (nt - 1);
        Orb.position(pb, td + tof, rb); Orb.velocity(pb, td + tof, vb);
        const l = lambert(mu, ra, rb, tof, false);
        if (!l) { row.push(null); continue; }
        const vd = norm([l.v1[0] - va[0], l.v1[1] - va[1], l.v1[2] - va[2]]);
        const vr = norm([l.v2[0] - vb[0], l.v2[1] - vb[1], l.v2[2] - vb[2]]);
        // `o.departBurn(vinf)` / `o.arriveBurn(vinf)` let a caller price the two ends itself (e.g. leaving from a moon of the departure planet)
        const dd = o && o.departBurn ? o.departBurn(vd) : burn(a.gm, rPark, vd), dr = o && o.arriveBurn ? o.arriveBurn(vr) : rCap ? burn(b.gm, rCap, vr) : 0;
        row.push({ depart: td, tof: tof, arrive: td + tof, vinfDepart: vd, vinfArrive: vr, dvDepart: dd, dvArrive: dr, total: dd + dr });
      }
      grid.push(row);
    }
    // best cell per departure, then the local minima over departure time = one entry per window
    const bestPer = grid.map((row) => row.reduce((m, c) => (c && (!m || c.total < m.total) ? c : m), null));
    const out = [];
    for (let i = 0; i < nd; i++) {
      const c = bestPer[i];
      if (!c) continue;
      const lo = i > 0 && bestPer[i - 1] ? bestPer[i - 1].total : Infinity, hi = i < nd - 1 && bestPer[i + 1] ? bestPer[i + 1].total : Infinity;
      if (c.total <= lo && c.total < hi) out.push(c);
    }
    // keep windows at least a third of a synodic period apart (the cheapest of near neighbours)
    const kept = [];
    for (const c of out.sort((x, y) => x.depart - y.depart)) {
      const last = kept[kept.length - 1];
      if (last && c.depart - last.depart < synodic / 3) { if (c.total < last.total) kept[kept.length - 1] = c; } else kept.push(c);
    }
    // a cheap window may sit at the edge of the search where only the expensive half of it fits: drop entries far above the best
    const floor = kept.reduce((m, c) => Math.min(m, c.total), Infinity);
    const good = kept.filter((c) => c.total <= 1.8 * floor);
    return { windows: good, grid: grid, synodic: synodic, hohmann: hohmann, tofRange: [tofLo, tofHi] };
  }

  /**
   * Encounter targeting: the single burn that puts a vessel in orbit about `bodyId` on a path that reaches the centre of one of that body's moons (or planets
   * about a star). For every candidate burn time over `horizon` and flight time, a Lambert arc joins the vessel's position to the target's position at arrival; the
   * burn is the difference between the arc's start velocity and the vessel's velocity, and is split into the game's manoeuvre-node axes (prograde, normal, radial) so
   * it can be entered as a burn (`loc.burns`). The best few burns are returned, one per local minimum, cheapest first; the arrival speed relative to the target
   * (and the capture burn from a circular orbit `captureAlt` above its surface, when given) is included. A centre hit is the aim: nudge the periapsis afterwards.
   * o: { captureAlt (m), maxTof (s), count (default 4) }.
   */
  function targetBurn(world, bodyId, orbit, targetId, t0, horizon, o) {
    o = o || {};
    const X = world.index.get(bodyId), T = world.index.get(targetId);
    if (!X || !T || T.parentBody !== X || !T._p) return null;
    const pv = Orb.prepare(orbit, X.gm), pt = T._p;
    const rA = orbit.a * (1 + (orbit.e || 0)), hoh = Math.PI * Math.sqrt(Math.pow((rA + T.orbit.a) / 2, 3) / X.gm);
    const tofLo = Math.max(0.25 * hoh, 1800), tofHi = Math.min(o.maxTof || 1.6 * hoh, 3 * hoh);
    const nd = Math.max(240, Math.min(1200, Math.round(horizon / (pv.period / 24))));
    const nt = 28;
    const r1 = [0, 0, 0], v1 = [0, 0, 0], r2 = [0, 0, 0], v2 = [0, 0, 0];
    const rCap = o.captureAlt == null ? null : T.radius + o.captureAlt;
    const best = [];
    for (let i = 0; i < nd; i++) {
      const td = t0 + (horizon * i) / (nd - 1);
      Orb.position(pv, td, r1); Orb.velocity(pv, td, v1);
      let top = null;
      for (let j = 0; j < nt; j++) {
        const tof = tofLo + ((tofHi - tofLo) * j) / (nt - 1);
        Orb.position(pt, td + tof, r2); Orb.velocity(pt, td + tof, v2);
        const l = lambert(X.gm, r1, r2, tof, false);
        if (!l) continue;
        const dv = [l.v1[0] - v1[0], l.v1[1] - v1[1], l.v1[2] - v1[2]];
        const mag = norm(dv), vinf = norm([l.v2[0] - v2[0], l.v2[1] - v2[1], l.v2[2] - v2[2]]);
        const cap = rCap ? burn(T.gm, rCap, vinf) : 0;
        if (!top || mag + cap < top.total) top = { t: td, tof: tof, arrive: td + tof, dv: dv, burn: mag, vinf: vinf, capture: cap, total: mag + cap, r: r1.slice(), v: v1.slice() };
      }
      best.push(top);
    }
    const out = [];
    for (let i = 0; i < nd; i++) {
      const c = best[i];
      if (!c) continue;
      const lo = i > 0 && best[i - 1] ? best[i - 1].total : Infinity, hi = i < nd - 1 && best[i + 1] ? best[i + 1].total : Infinity;
      if (c.total <= lo && c.total < hi) out.push(c);
    }
    out.sort((a, b) => a.total - b.total);
    const kept = [];
    for (const c of out) if (kept.every((k) => Math.abs(k.t - c.t) > pv.period / 2) && kept.length < (o.count || 4)) kept.push(c);
    return kept.map((c) => {
      // the game's axes: prograde along v, normal along r x v, radial = normal x prograde (see Trajectory.applyBurn)
      const vl = norm(c.v), pg = [c.v[0] / vl, c.v[1] / vl, c.v[2] / vl];
      let n = [c.r[1] * c.v[2] - c.r[2] * c.v[1], c.r[2] * c.v[0] - c.r[0] * c.v[2], c.r[0] * c.v[1] - c.r[1] * c.v[0]];
      const nl = norm(n); n = [n[0] / nl, n[1] / nl, n[2] / nl];
      const rad = [n[1] * pg[2] - n[2] * pg[1], n[2] * pg[0] - n[0] * pg[2], n[0] * pg[1] - n[1] * pg[0]];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      return { t: c.t, arrive: c.arrive, flight: c.tof, dv: c.burn, prograde: dot(c.dv, pg), normal: dot(c.dv, n), radial: dot(c.dv, rad), vinfArrive: c.vinf, captureDv: c.capture, total: c.total };
    });
  }

  return { lambert: lambert, burn: burn, windows: windows, targetBurn: targetBurn };
});
