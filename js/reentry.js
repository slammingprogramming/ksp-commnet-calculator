// SPDX-License-Identifier: AGPL-3.0-or-later
/* Plasma blackout on atmospheric entry. Pure logic, no DOM access.
 *
 * The game blacks out CommNet when a loaded vessel re-enters an atmosphere (difficulty option "Plasma Blackout"). The rules,
 * read from CommNetVessel.CalculatePlasmaMult / GetSignalStrengthModifier and Physics.cfg (docs/RESEARCH.md section 2):
 *
 *   shock temperature  T = speed x 1 (low Mach) blended to 21 x speed^0.75 (high Mach) between Mach 2 and 5 (cubed blend),
 *                      x ReentryHeatScale x the body's shockTemperatureMultiplier; external temperature = max(air, shock)
 *   dynamic pressure   q = 0.0005 x density x speed^2   (kPa)
 *   plasma             only if external T > 1100 K and density > 5e-5 and q x speed > 500;  plasma = InverseLerp(500, 2500, q x speed)
 *   per link           f = InverseLerp(-0.866, -0.5, dot)  with dot = (direction to the other node) . (surface velocity direction)
 *                      x = 1 - f x plasma;  signal x (x < 0.5 ? 0 : (x - 0.5) / 0.5)
 *
 * so a link blacks out completely when f x plasma > 0.5, i.e. q x speed > 1500 for a link that does not point behind the
 * vessel. Atmosphere curves (Data.ATMOSPHERES) come from the game's CelestialBody prefabs.
 *
 * Not modelled: the sun/latitude temperature bias of the air (a few percent of density), lift, and the vessel's real drag
 * (a constant ballistic coefficient stands in for it), so trajectories are estimates; the blackout rules themselves are exact.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.KSPReentry = factory(root.KSPData);
})(typeof self !== 'undefined' ? self : this, function (Data) {
  'use strict';

  // Physics.cfg and PhysicsGlobals defaults
  const K = {
    qvMin: 500, qvMax: 2500, temp: 1100, density: 5e-5,
    dotMin: -0.866, dotMax: -0.5, threshold: 0.5,
    newtonFactor: 1, machStart: 2, machEnd: 5, machExp: 3, machScalar: 21, machVelExp: 0.75,
    gas: 8.31447,
  };
  const G0 = 9.80665;

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const invLerp = (a, b, x) => clamp01((x - a) / (b - a));

  /** Unity AnimationCurve (cubic Hermite, clamped at both ends) over keys [t, value, inSlope, outSlope]. */
  function curve(keys, x) {
    const n = keys.length;
    if (x <= keys[0][0]) return keys[0][1];
    if (x >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (i + 2 < n && x >= keys[i + 1][0]) i++;
    const a = keys[i], b = keys[i + 1];
    const dt = b[0] - a[0], t = (x - a[0]) / dt;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a[1] + (t3 - 2 * t2 + t) * dt * a[3] + (-2 * t3 + 3 * t2) * b[1] + (t3 - t2) * dt * b[2];
  }

  const hasAtmosphere = (bodyId) => !!Data.ATMOSPHERES[bodyId];

  /** Air at an altitude (m): { pressure kPa, temperature K, density kg/m^3, sound m/s }; zeros above the atmosphere. */
  function air(bodyId, alt) {
    const at = Data.ATMOSPHERES[bodyId];
    if (!at || alt >= at.depth) return { pressure: 0, temperature: 0, density: 0, sound: 0 };
    const p = Math.max(0, curve(at.pressure, alt)), t = curve(at.temp, alt);
    const rho = p > 0 && t > 0 ? (p * 1000 * at.molarMass) / (K.gas * t) : 0;
    return { pressure: p, temperature: t, density: rho, sound: rho > 0 ? Math.sqrt((at.gamma * p * 1000) / rho) : 0 };
  }

  /** Shock temperature (K) at an altitude and speed (m/s); heat = the difficulty's Reentry Heating scale (default 1). */
  function shockTemperature(bodyId, alt, speed, heat) {
    const at = Data.ATMOSPHERES[bodyId];
    const a = air(bodyId, alt);
    const mach = a.sound > 0 ? speed / a.sound : 0;
    const lerp = Math.pow(clamp01((mach - K.machStart) / (K.machEnd - K.machStart)), K.machExp);
    let t = speed * K.newtonFactor;
    if (lerp > 0) t += (K.machScalar * Math.pow(speed, K.machVelExp) - t) * lerp;
    return t * (heat === undefined ? 1 : heat) * at.shock;
  }

  /** Strength of the plasma around the vessel, 0..1 (CalculatePlasmaMult). */
  function plasma(bodyId, alt, speed, heat) {
    const a = air(bodyId, alt);
    const external = Math.max(a.temperature, shockTemperature(bodyId, alt, speed, heat));
    const qv = 0.0005 * a.density * speed * speed * speed;
    if (!(external > K.temp) || !(a.density > K.density) || !(qv > K.qvMin)) return 0;
    return invLerp(K.qvMin, K.qvMax, qv);
  }

  /** Fraction of the plasma felt by a link, from the angle between the link and the velocity (0 = straight ahead, 180 = straight back). */
  function linkFactor(angleDeg) {
    return invLerp(K.dotMin, K.dotMax, Math.cos((angleDeg * Math.PI) / 180));
  }

  /** Signal multiplier for a link (GetSignalStrengthModifier): 1 = untouched, 0 = blacked out. */
  function signalModifier(plasmaMult, angleDeg) {
    const x = 1 - linkFactor(angleDeg) * plasmaMult;
    if (x < K.threshold) return 0;
    return Math.min(1, (x - K.threshold) / (1 - K.threshold));
  }

  /** Speed and angle at the top of the atmosphere for an arriving orbit about the body (periapsis altitude and apoapsis altitude or null for an escape with speed vinf). */
  function entryFromOrbit(body, peAlt, apAlt, vinf) {
    const at = Data.ATMOSPHERES[body.id];
    const r = body.radius + at.depth, rp = body.radius + peAlt;
    if (!(rp < r)) return null;                    // periapsis above the atmosphere: no entry
    let a, vp;
    if (apAlt === null || apAlt === undefined) {
      const e2 = vinf * vinf;                       // hyperbola: v^2 = vinf^2 + 2 GM / r
      vp = Math.sqrt(e2 + (2 * body.gm) / rp);
      a = null;
    } else {
      const ra = body.radius + apAlt;
      a = (ra + rp) / 2;
      vp = Math.sqrt(body.gm * (2 / rp - 1 / a));
    }
    const v = a === null ? Math.sqrt(vinf * vinf + (2 * body.gm) / r) : Math.sqrt(body.gm * (2 / r - 1 / a));
    const cosg = Math.min(1, (rp * vp) / (r * v));  // angular momentum: r v cos(gamma) = rp vp
    return { speed: v, angle: (Math.acos(cosg) * 180) / Math.PI };
  }

  /**
   * Fly a vessel into the atmosphere (point mass, constant ballistic coefficient beta = mass / (Cd x area) in kg/m^2, no lift, non-rotating body).
   * o: { speed (surface speed at the top, m/s), angle (deg below the horizon), ballistic, heat (default 1), link (deg, default 0) }.
   * Returns { samples, blackout: {start, end, ...} | null, partial, peak..., landed }.
   */
  function entry(body, o) {
    const at = Data.ATMOSPHERES[body.id];
    const heat = o.heat === undefined ? 1 : o.heat, link = o.link || 0;
    const beta = Math.max(1, o.ballistic || 300);
    const dt = 0.05, sampleEvery = 10;
    let r = body.radius + at.depth, v = o.speed, g = (Math.max(0.05, o.angle) * Math.PI) / 180, s = 0, t = 0;
    const samples = [];
    let first = null, last = null, firstPartial = null, lastPartial = null, firstPlasma = null, lastPlasma = null;
    let peakShock = 0, peakG = 0, peakQV = 0, steps = 0, landed = false, wasMod = 1;
    const snap = () => {
      const alt = r - body.radius, a = air(body.id, alt);
      const pl = plasma(body.id, alt, v, heat);
      const mod = signalModifier(pl, link);
      const shock = shockTemperature(body.id, alt, v, heat);
      const qv = 0.0005 * a.density * v * v * v;
      return { t: t, alt: alt, speed: v, angle: (g * 180) / Math.PI, range: s, density: a.density, shock: shock, qv: qv, plasma: pl, mod: mod, decel: (a.density * v * v) / (2 * beta) / G0 };
    };
    while (steps < 400000) {
      const sn = snap();
      if (steps % sampleEvery === 0) samples.push(sn);
      if (sn.shock > peakShock && sn.density > K.density) peakShock = sn.shock;
      if (sn.decel > peakG) peakG = sn.decel;
      if (sn.qv > peakQV) peakQV = sn.qv;
      if (sn.plasma > 0) { if (!firstPlasma) firstPlasma = sn; lastPlasma = sn; }
      if (sn.mod < 1) { if (!firstPartial) firstPartial = sn; lastPartial = sn; }
      if (sn.mod === 0) { if (!first) first = sn; last = sn; }
      wasMod = sn.mod;
      if (sn.alt <= 0) { landed = true; break; }
      if (v < 60 || t > 4000) break;
      // Euler-Cromer in polar coordinates about the body's centre
      const grav = body.gm / (r * r), rho = air(body.id, r - body.radius).density;
      const dv = (-rho * v * v) / (2 * beta) + grav * Math.sin(g);
      const dg = ((grav / v - v / r) * Math.cos(g));
      v += dv * dt; g += dg * dt;
      r -= v * Math.sin(g) * dt;
      s += ((v * Math.cos(g) * body.radius) / r) * dt;
      t += dt; steps++;
    }
    void wasMod;
    const pt = (p) => (p ? { t: p.t, alt: p.alt, speed: p.speed, range: p.range } : null);
    return {
      samples: samples,
      blackout: first ? { start: pt(first), end: pt(last), duration: last.t - first.t } : null,
      partial: firstPartial ? { start: pt(firstPartial), end: pt(lastPartial), duration: lastPartial.t - firstPartial.t } : null,
      plasma: firstPlasma ? { start: pt(firstPlasma), end: pt(lastPlasma), duration: lastPlasma.t - firstPlasma.t } : null,
      peakShock: peakShock, peakDecel: peakG, peakQV: peakQV, landed: landed, flightTime: t,
      final: pt(snap()), skipped: !landed && r - body.radius > at.depth * 0.9,
    };
  }

  /**
   * Fastest entry speed that causes no blackout at all (level 'full': the link never reaches 0; 'any': no plasma whatsoever),
   * for the given angle, ballistic coefficient and link direction: { limit (m/s, Infinity if every speed that still enters is fine,
   * null if even a slow entry blacks out), feasibleMax (fastest speed that still enters rather than skipping out at this angle) }.
   */
  function speedLimit(body, o, level) {
    const run = (v) => entry(body, Object.assign({}, o, { speed: v }));
    // entries faster than some speed skip back out of the atmosphere at this angle: only speeds that really enter count
    let vMax = 300;
    while (vMax < 14000 && run(vMax + 100).landed) vMax += 100;
    const ok = (v) => { const e = run(v); return level === 'any' ? !e.plasma : !e.blackout; };
    if (!run(300).landed || !ok(300)) return { limit: null, feasibleMax: vMax };
    if (ok(vMax)) return { limit: Infinity, feasibleMax: vMax };
    let lo = 300, hi = vMax;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
    return { limit: lo, feasibleMax: vMax };
  }

  /**
   * Blackout map over altitude and speed for a steady speed: grid[j][i] = signal multiplier at alt[j], speed[i].
   * (Real entries slow down with altitude; the entry() trajectory is the line through this map.)
   */
  function map(bodyId, o) {
    const at = Data.ATMOSPHERES[bodyId];
    const nA = o.altSteps || 70, nV = o.speedSteps || 90;
    const vMax = o.maxSpeed || 8000, link = o.link || 0, heat = o.heat === undefined ? 1 : o.heat;
    const alts = [], speeds = [], grid = [];
    for (let i = 0; i < nV; i++) speeds.push((vMax * (i + 0.5)) / nV);
    for (let j = 0; j < nA; j++) {
      const alt = (at.depth * (nA - 1 - j + 0.5)) / nA; alts.push(alt);
      grid.push(speeds.map((v) => signalModifier(plasma(bodyId, alt, v, heat), link)));
    }
    return { alts: alts, speeds: speeds, grid: grid, depth: at.depth, maxSpeed: vMax };
  }

  /** Slowest steady speed at which any plasma can form on the body (the lowest speed at which the shock temperature passes 1100 K at an altitude where the air is thick enough). */
  function minimumPlasmaSpeed(bodyId, heat) {
    const at = Data.ATMOSPHERES[bodyId];
    let best = Infinity, bestAlt = null;
    for (let alt = 0; alt < at.depth; alt += at.depth / 400) {
      if (!(air(bodyId, alt).density > K.density)) continue;
      let lo = 100, hi = 30000;
      if (plasma(bodyId, alt, hi, heat) === 0) continue;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (plasma(bodyId, alt, mid, heat) > 0) hi = mid; else lo = mid; }
      if (hi < best) { best = hi; bestAlt = alt; }
    }
    return { speed: best, altitude: bestAlt };
  }

  return {
    CONSTANTS: K, curve: curve, hasAtmosphere: hasAtmosphere, air: air, shockTemperature: shockTemperature, plasma: plasma,
    linkFactor: linkFactor, signalModifier: signalModifier, entryFromOrbit: entryFromOrbit, entry: entry, speedLimit: speedLimit,
    map: map, minimumPlasmaSpeed: minimumPlasmaSpeed,
  };
});
