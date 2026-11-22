// SPDX-License-Identifier: AGPL-3.0-or-later
/* Patched-conic trajectories for vessels that leave or enter spheres of influence (escape trajectories, transfers).
 * Pure logic, no DOM access.
 *
 * KSP moves a vessel along one conic at a time. When it crosses the edge of a body's sphere of influence the game
 * re-expresses the state in the new parent and continues on a new conic ("patch"). `build` does the same on a fixed
 * orbit: starting from the orbit the vessel is on now it finds the next SOI exit or entry, converts the state vector
 * there, and repeats. Two-body conics, no manoeuvres: it shows where the vessel goes if it burns no more.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./orbits.js'));
  else root.KSPTrajectory = factory(root.KSPOrbits);
})(typeof self !== 'undefined' ? self : this, function (Orb) {
  'use strict';

  const MAX_SEGMENTS = 16;
  const MAX_STEPS = 400000;

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  /** Smallest and largest distance from the centre over the orbit (Infinity for an escape orbit). */
  function radialRange(el) {
    const a = Math.abs(el.a);
    return el.e > 1 ? { lo: a * (el.e - 1), hi: Infinity } : { lo: a * (1 - el.e), hi: a * (1 + el.e) };
  }

  /**
   * Segments { from, to, body, orbit, p } covering (-inf, +inf); the first one is the given orbit. Search for events
   * runs from t0 to t0 + horizon; after the last event (or the horizon) the final conic simply continues.
   * `body` is the world body the segment is measured about.
   */
  function build(world, bodyId, orbit, t0, horizon, burns) {
    let body = world.index.get(bodyId);
    if (!body) return [];
    const tEnd = t0 + horizon;
    const segs = [];
    let el = orbit;
    let from = -Infinity;
    let tScan = t0;
    const r1 = [0, 0, 0], v1 = [0, 0, 0], r2 = [0, 0, 0], v2 = [0, 0, 0];
    // Impulsive burns { t, prograde, normal, radial } (m/s in the vessel's orbital frame), applied in time order.
    const plan = (burns || []).filter((b) => b && isFinite(b.t) && b.t >= t0 && b.t < tEnd).sort((a, b) => a.t - b.t);
    let nextBurn = 0;

    for (let k = 0; k < MAX_SEGMENTS; k++) {
      const p = Orb.prepare(el, body.gm);
      const rr = radialRange(el);
      const canExit = !!body.parentBody && (el.e > 1 || rr.hi > body.soiRadius);
      const kids = (body.moons || []).map((m) => (typeof m === 'string' ? world.index.get(m) : m)).filter((c) => c && c._p && isFinite(c.soiRadius))
        .filter((c) => {
          const cr = radialRange(c.orbit);
          return rr.hi >= cr.lo - c.soiRadius && rr.lo <= cr.hi + c.soiRadius;
        });
      while (nextBurn < plan.length && plan[nextBurn].t < tScan) nextBurn++;
      const burn = nextBurn < plan.length ? plan[nextBurn] : null;
      const limit = burn ? Math.min(tEnd, burn.t) : tEnd;
      let ev = null;
      if ((canExit || kids.length) && tScan < limit) ev = nextEvent(body, p, el, canExit, kids, tScan, limit);
      if (!ev && burn) ev = { kind: 'burn', t: burn.t, burn: burn };
      if (!ev) { segs.push({ from: from, to: Infinity, body: body, orbit: el, p: p }); break; }
      segs.push({ from: from, to: ev.t, body: body, orbit: el, p: p });

      // state at the event, relative to the old body
      Orb.position(p, ev.t, r1); Orb.velocity(p, ev.t, v1);
      let next, nextEl;
      if (ev.kind === 'burn') {
        nextBurn++;
        next = body;
        const dv = applyBurn(r1, v1, ev.burn);
        nextEl = Orb.elementsFromState(r1, dv, body.gm, ev.t);
      } else if (ev.kind === 'exit') {
        next = body.parentBody;
        Orb.position(body._p, ev.t, r2); Orb.velocity(body._p, ev.t, v2);
        nextEl = Orb.elementsFromState([r1[0] + r2[0], r1[1] + r2[1], r1[2] + r2[2]], [v1[0] + v2[0], v1[1] + v2[1], v1[2] + v2[2]], next.gm, ev.t);
      } else {
        next = ev.child;
        Orb.position(next._p, ev.t, r2); Orb.velocity(next._p, ev.t, v2);
        nextEl = Orb.elementsFromState([r1[0] - r2[0], r1[1] - r2[1], r1[2] - r2[2]], [v1[0] - v2[0], v1[1] - v2[1], v1[2] - v2[2]], next.gm, ev.t);
      }
      if (!nextEl) { segs[segs.length - 1].to = Infinity; break; }
      body = next; el = nextEl; from = ev.t;
      tScan = ev.t + 1; // step off the boundary so the same crossing is not found twice
    }
    return segs;
  }

  /** Velocity after an impulsive burn: prograde along v, normal along r x v, radial out completing the right-handed set. */
  function applyBurn(r, v, b) {
    const vl = Math.hypot(v[0], v[1], v[2]);
    const pg = [v[0] / vl, v[1] / vl, v[2] / vl];
    let n = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
    const nl = Math.hypot(n[0], n[1], n[2]);
    n = [n[0] / nl, n[1] / nl, n[2] / nl];
    const rad = [n[1] * pg[2] - n[2] * pg[1], n[2] * pg[0] - n[0] * pg[2], n[0] * pg[1] - n[1] * pg[0]];
    const a = b.prograde || 0, c = b.normal || 0, d = b.radial || 0;
    return [v[0] + a * pg[0] + c * n[0] + d * rad[0], v[1] + a * pg[1] + c * n[1] + d * rad[1], v[2] + a * pg[2] + c * n[2] + d * rad[2]];
  }

  function nextEvent(body, p, el, canExit, kids, tScan, tEnd) {
    const soi = body.soiRadius;
    const rv = [0, 0, 0], vv = [0, 0, 0], cp = [0, 0, 0], cv = [0, 0, 0];
    // step: fine enough not to skip over a child's sphere of influence or an exit
    Orb.position(p, tScan, rv); Orb.velocity(p, tScan, vv);
    const floor = Math.max((tEnd - tScan) / MAX_STEPS, 1);
    let dt = Infinity;
    const speed = Math.hypot(vv[0], vv[1], vv[2]);
    for (const c of kids) {
      Orb.velocity(c._p, tScan, cv);
      dt = Math.min(dt, c.soiRadius / (2 * (speed + Math.hypot(cv[0], cv[1], cv[2]))));
    }
    dt = Math.min(dt, el.e < 1 ? p.period / 100 : 3600);
    dt = Math.max(dt, floor);

    const state = (t) => {
      Orb.position(p, t, rv);
      const out = { exit: canExit ? Math.hypot(rv[0], rv[1], rv[2]) - soi : -1, kid: null };
      for (const c of kids) {
        Orb.position(c._p, t, cp);
        const d = dist(rv, cp) - c.soiRadius;
        if (d < 0 && (!out.kid || d < out.kid.d)) out.kid = { c: c, d: d };
      }
      return out;
    };
    let prev = state(tScan);
    if (prev.kid) return null; // already inside a child's sphere at the start: stay on the given conic
    for (let t = tScan + dt; t <= tEnd + dt; t += dt) {
      const cur = state(Math.min(t, tEnd));
      const tNow = Math.min(t, tEnd);
      if (canExit && prev.exit < 0 && cur.exit >= 0) return { kind: 'exit', t: bisect((x) => state(x).exit >= 0, tNow - dt, tNow) };
      if (cur.kid && !prev.kid) return { kind: 'enter', child: cur.kid.c, t: bisect((x) => !!state(x).kid, tNow - dt, tNow) };
      prev = cur;
      if (tNow >= tEnd) break;
    }
    return null;
  }

  /** First time in (lo, hi] at which `test` becomes true, assuming it is false at lo and true at hi. */
  function bisect(test, lo, hi) {
    for (let i = 0; i < 60 && hi - lo > 0.01; i++) {
      const mid = (lo + hi) / 2;
      if (test(mid)) hi = mid; else lo = mid;
    }
    return hi;
  }

  /** The segment valid at time t (segments are sorted; the first starts at -Infinity, the last ends at Infinity). */
  function segmentAt(segs, t) {
    for (let i = 0; i < segs.length; i++) if (t < segs[i].to) return segs[i];
    return segs[segs.length - 1];
  }

  return { build: build, segmentAt: segmentAt, applyBurn: applyBurn, MAX_SEGMENTS: MAX_SEGMENTS };
});
