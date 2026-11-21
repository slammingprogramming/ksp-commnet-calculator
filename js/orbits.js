// SPDX-License-Identifier: AGPL-3.0-or-later
/* Two-body orbital mechanics. No DOM access.
 *
 * All positions are in one right-handed inertial frame with +z along every body's spin axis (KSP has no
 * axial tilt) and +x toward the reference direction. Orbits are prograde about +z. The frame's handedness
 * doesn't matter for line-of-sight geometry; it only has to be consistent.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KSPOrbits = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEG = Math.PI / 180;
  const TAU = 2 * Math.PI;
  const DAY = 21600;
  const YEAR = 426 * DAY;

  /** Solve Kepler's equation M = E - e sin E for E (elliptical orbits). */
  function solveKepler(M, e) {
    M = M % TAU;
    if (M > Math.PI) M -= TAU;
    else if (M < -Math.PI) M += TAU;
    if (e < 1e-12) return M; // circular: E = M exactly (most relay rings)
    // Start from the first-order solution; Newton then needs 2-4 steps instead of 5-8.
    let E = e < 0.8 ? M + e * Math.sin(M) : Math.PI * (M < 0 ? -1 : 1);
    for (let i = 0; i < 40; i++) {
      const f = E - e * Math.sin(E) - M;
      const d = f / (1 - e * Math.cos(E));
      E -= d;
      if (Math.abs(d) < 1e-13) break;
    }
    return E;
  }

  /**
   * Precompute what's needed to propagate an orbit about a body with gravitational parameter `gm`.
   * orbit: {a, e, i, lan, w (degrees), m0 (rad at epoch), epoch (s)}.
   */
  function prepare(orbit, gm) {
    const O = orbit.lan * DEG, w = orbit.w * DEG, i = orbit.i * DEG;
    const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
    // Escape trajectories have a < 0 and e > 1 (as in KSP's save files); their "period" is only a time scale.
    const hyper = orbit.e > 1;
    const aa = Math.abs(orbit.a);
    const n = Math.sqrt(gm / (aa * aa * aa));
    return {
      a: orbit.a, e: orbit.e, m0: orbit.m0, epoch: orbit.epoch || 0, n: n, period: TAU / n, hyper: hyper, gm: gm,
      b: aa * Math.sqrt(Math.abs(1 - orbit.e * orbit.e)),
      px: cO * cw - sO * sw * ci, py: sO * cw + cO * sw * ci, pz: sw * si,
      qx: -cO * sw - sO * cw * ci, qy: -sO * sw + cO * cw * ci, qz: cw * si,
    };
  }

  /** Solve M = e sinh H - H for H (hyperbolic orbits). */
  function solveHyperbolic(M, e) {
    let H = Math.asinh(M / e);
    if (!isFinite(H)) H = 0;
    for (let i = 0; i < 60; i++) {
      const f = e * Math.sinh(H) - H - M;
      const d = f / (e * Math.cosh(H) - 1);
      H -= d;
      if (Math.abs(d) < 1e-13 * Math.max(1, Math.abs(H))) break;
    }
    return H;
  }

  /** Velocity relative to the parent at time t (m/s), written into out[0..2]. */
  function velocity(p, t, out) {
    const M = p.m0 + p.n * (t - p.epoch);
    let vx, vy;
    if (p.hyper) {
      const H = solveHyperbolic(M, p.e);
      const dH = p.n / (p.e * Math.cosh(H) - 1);
      vx = -Math.abs(p.a) * Math.sinh(H) * dH;
      vy = p.b * Math.cosh(H) * dH;
    } else {
      const E = solveKepler(M, p.e);
      const dE = p.n / (1 - p.e * Math.cos(E));
      vx = -p.a * Math.sin(E) * dE;
      vy = p.b * Math.cos(E) * dE;
    }
    out[0] = p.px * vx + p.qx * vy;
    out[1] = p.py * vx + p.qy * vy;
    out[2] = p.pz * vx + p.qz * vy;
    return out;
  }

  /**
   * Orbit elements (same shape as `orbit` in prepare()) from a position/velocity state about a body with parameter gm,
   * valid at time t. Works for ellipses and hyperbolas; returns null for a (near) parabola or a degenerate state.
   */
  function elementsFromState(r, v, gm, t) {
    const rl = Math.hypot(r[0], r[1], r[2]);
    const v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    const hx = r[1] * v[2] - r[2] * v[1], hy = r[2] * v[0] - r[0] * v[2], hz = r[0] * v[1] - r[1] * v[0];
    const hl = Math.hypot(hx, hy, hz);
    if (!(rl > 0) || !(hl > 0)) return null;
    const rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
    // eccentricity vector
    const ex = ((v2 - gm / rl) * r[0] - rv * v[0]) / gm, ey = ((v2 - gm / rl) * r[1] - rv * v[1]) / gm, ez = ((v2 - gm / rl) * r[2] - rv * v[2]) / gm;
    const e = Math.hypot(ex, ey, ez);
    const energy = v2 / 2 - gm / rl;
    if (Math.abs(energy) < 1e-12 * gm / rl) return null;
    const a = -gm / (2 * energy);
    if (e < 1e-10) return null; // exactly circular: callers nudge e (their orbit is the same to any useful precision)
    const P = [ex / e, ey / e, ez / e];
    const hh = [hx / hl, hy / hl, hz / hl];
    const Q = [hh[1] * P[2] - hh[2] * P[1], hh[2] * P[0] - hh[0] * P[2], hh[0] * P[1] - hh[1] * P[0]];
    const ci = hh[2];
    const si = Math.hypot(P[2], Q[2]);
    let inc, lan, w;
    if (si > 1e-9) {
      inc = Math.atan2(si, ci);
      lan = Math.atan2(hh[0], -hh[1]);
      w = Math.atan2(P[2], Q[2]);
    } else {
      inc = ci > 0 ? 0 : Math.PI;
      lan = 0;
      w = ci > 0 ? Math.atan2(P[1], P[0]) : Math.atan2(-P[1], P[0]);
    }
    // true anomaly from the position in the perifocal frame
    const xp = r[0] * P[0] + r[1] * P[1] + r[2] * P[2];
    const yp = r[0] * Q[0] + r[1] * Q[1] + r[2] * Q[2];
    const nu = Math.atan2(yp, xp);
    let M;
    if (e < 1) {
      const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
      M = E - e * Math.sin(E);
    } else {
      const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
      M = e * Math.sinh(H) - H;
    }
    return { a: a, e: e, i: inc / DEG, lan: lan / DEG, w: w / DEG, m0: M, epoch: t };
  }

  /** Position relative to the parent at time t, written into out[0..2]. */
  function position(p, t, out) {
    const M = p.m0 + p.n * (t - p.epoch);
    if (p.hyper) {
      const H = solveHyperbolic(M, p.e);
      const x = Math.abs(p.a) * (p.e - Math.cosh(H));
      const y = p.b * Math.sinh(H);
      out[0] = p.px * x + p.qx * y;
      out[1] = p.py * x + p.qy * y;
      out[2] = p.pz * x + p.qz * y;
      return out;
    }
    const E = solveKepler(M, p.e);
    const x = p.a * (Math.cos(E) - p.e);
    const y = p.b * Math.sin(E);
    out[0] = p.px * x + p.qx * y;
    out[1] = p.py * x + p.qy * y;
    out[2] = p.pz * x + p.qz * y;
    return out;
  }

  /** Position on an orbit at a given eccentric anomaly (used for geometric extremes). */
  function positionAtE(p, E, out) {
    const x = p.a * (Math.cos(E) - p.e);
    const y = p.b * Math.sin(E);
    out[0] = p.px * x + p.qx * y;
    out[1] = p.py * x + p.qy * y;
    out[2] = p.pz * x + p.qz * y;
    return out;
  }

  /** Orbit built from a periapsis/apoapsis altitude pair or a single circular altitude. */
  function orbitFromAltitudes(body, peAlt, apAlt, i, lan, w, phaseDeg) {
    const rp = body.radius + Math.min(peAlt, apAlt);
    const ra = body.radius + Math.max(peAlt, apAlt);
    const a = (rp + ra) / 2;
    const e = (ra - rp) / (ra + rp);
    return { a: a, e: e, i: i || 0, lan: lan || 0, w: w || 0, m0: (phaseDeg || 0) * DEG, epoch: 0 };
  }

  /** Circular orbit period for a given radius about a body. */
  const circularPeriod = (radius, gm) => TAU * Math.sqrt((radius * radius * radius) / gm);

  /** Semi-major axis of the orbit whose period equals `period`. */
  const smaForPeriod = (period, gm) => Math.cbrt((gm * period * period) / (TAU * TAU));

  /** Radius of the sphere of influence of a body about its parent. */
  const sphereOfInfluence = (a, gmBody, gmParent) => a * Math.pow(gmBody / gmParent, 0.4);

  /* ---------- KSP calendar ---------- */

  function formatUT(ut) {
    if (!isFinite(ut)) return '–';
    const neg = ut < 0;
    let s = Math.abs(Math.round(ut));
    const year = Math.floor(s / YEAR) + 1;
    s -= (year - 1) * YEAR;
    const day = Math.floor(s / DAY) + 1;
    s -= (day - 1) * DAY;
    const hh = Math.floor(s / 3600);
    s -= hh * 3600;
    const mm = Math.floor(s / 60);
    const ss = s - mm * 60;
    const p2 = (n) => (n < 10 ? '0' : '') + n;
    return (neg ? '-' : '') + 'Y' + year + ' D' + day + ' ' + p2(hh) + ':' + p2(mm) + ':' + p2(ss);
  }

  function formatDuration(sec) {
    if (!isFinite(sec)) return '–';
    let s = Math.round(Math.abs(sec));
    if (s < 60) return s + 's';
    const y = Math.floor(s / YEAR); s -= y * YEAR;
    const d = Math.floor(s / DAY); s -= d * DAY;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const parts = [];
    if (y) parts.push(y + 'y');
    if (d) parts.push(d + 'd');
    if (h) parts.push(h + 'h');
    if (m && parts.length < 3) parts.push(m + 'm');
    if (s && !y && !d && parts.length < 3) parts.push(s + 's');
    return parts.slice(0, 3).join(' ');
  }

  /** Parse "Y2 D30 04:00:00", "Y2 D30", "D30" (year 1) or plain seconds. Returns NaN if invalid. */
  function parseUT(text) {
    const s = String(text).trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    const m = /^(?:y(?:ear)?\s*(\d+))?[\s,]*(?:d(?:ay)?\s*(\d+))?[\s,]*(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/i.exec(s);
    if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return NaN;
    const y = m[1] ? parseInt(m[1], 10) : 1;
    const d = m[2] ? parseInt(m[2], 10) : 1;
    if (y < 1 || d < 1 || d > 426) return NaN;
    return (y - 1) * YEAR + (d - 1) * DAY + (m[3] ? parseInt(m[3], 10) * 3600 + parseInt(m[4], 10) * 60 + (m[5] ? parseInt(m[5], 10) : 0) : 0);
  }

  return {
    DEG: DEG, TAU: TAU, DAY: DAY, YEAR: YEAR,
    solveKepler: solveKepler,
    prepare: prepare,
    position: position,
    velocity: velocity,
    solveHyperbolic: solveHyperbolic,
    elementsFromState: elementsFromState,
    positionAtE: positionAtE,
    orbitFromAltitudes: orbitFromAltitudes,
    circularPeriod: circularPeriod,
    smaForPeriod: smaForPeriod,
    sphereOfInfluence: sphereOfInfluence,
    formatUT: formatUT,
    formatDuration: formatDuration,
    parseUT: parseUT,
  };
});
