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
    let E = e < 0.8 ? M : Math.PI * (M < 0 ? -1 : 1);
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
    const n = Math.sqrt(gm / (orbit.a * orbit.a * orbit.a));
    return {
      a: orbit.a, e: orbit.e, m0: orbit.m0, epoch: orbit.epoch || 0, n: n, period: TAU / n,
      b: orbit.a * Math.sqrt(1 - orbit.e * orbit.e),
      px: cO * cw - sO * sw * ci, py: sO * cw + cO * sw * ci, pz: sw * si,
      qx: -cO * sw - sO * cw * ci, qy: -sO * sw + cO * cw * ci, qz: cw * si,
    };
  }

  /** Position relative to the parent at time t, written into out[0..2]. */
  function position(p, t, out) {
    const M = p.m0 + p.n * (t - p.epoch);
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
