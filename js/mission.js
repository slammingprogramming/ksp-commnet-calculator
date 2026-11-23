// SPDX-License-Identifier: AGPL-3.0-or-later
/* Mission planning: a mission is a list of legs (launch, transfer, land, ascent, return, plane change, custom burn). Each leg gets a
 * delta-v and, for transfers, real departure and arrival dates from the same Lambert search the Launch windows tab uses. The total is
 * compared with what a rocket has (js/craft.js). Two-body, impulsive burns from circular orbits; the launch and ascent legs add a
 * loss allowance you can change, because gravity, drag and steering losses depend on how well the ascent is flown. No DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./transfer.js'), require('./orbits.js'), require('./reentry.js'));
  else root.KSPMission = factory(root.KSPTransfer, root.KSPOrbits, root.KSPReentry);
})(typeof self !== 'undefined' ? self : this, function (Tr, Orb, Re) {
  'use strict';

  const vcirc = (gm, r) => Math.sqrt(gm / r);
  const visviva = (gm, r, a) => Math.sqrt(Math.max(0, gm * (2 / r - 1 / a)));
  const KM = 1000;

  /** Delta-v of a gravity-turn ascent from the surface to a circular orbit, by integrating the flight in the orbital plane (point mass, thrust-to-weight
   *  constant in fuel terms, drag from the body's air curves). Straight up to 250 m, a kick of k degrees, then the nose follows the air-relative velocity;
   *  the burn ends when the orbit's apoapsis reaches the target, the rocket coasts to it and circularises there. The kick is searched for the least delta-v
   *  that does not hit the ground. Returns { dv, losses (= dv - circular speed + rotation speed, what the leg's "losses" field means), kick, burn, circ }
   *  or null when no kick works (TWR too low). opts: twr (at the surface, default 1.5), isp (s, 320), beta (ballistic coefficient m/(Cd A), kg/m^2, 20000),
   *  alt (m, 80000), lat (deg, 0). Not the game's own flight model: a guide for "how much worse is this ascent than the bare orbital speed". */
  function ascent(body, opts) {
    opts = opts || {};
    const gm = body.gm, R = body.radius, g0 = gm / (R * R);
    const twr = opts.twr || 1.5, ve = (opts.isp || 320) * 9.80665, beta = opts.beta || 20000;
    const rT = R + (opts.alt || 80000);
    const spin = body.rotPeriod && isFinite(body.rotPeriod) && !body.locked ? (2 * Math.PI) / body.rotPeriod : 0;
    const w0 = spin * R * Math.cos(((opts.lat || 0) * Math.PI) / 180);
    const air = (h) => (Re && body.hasAtmo ? Re.air(body.id, h).density : 0);
    const run = (kickDeg) => {
      const kick = (kickDeg * Math.PI) / 180, dt = 0.25;
      let r = R, vr = 0, vt = w0, spent = 0, t = 0, burning = true;
      for (let n = 0; n < 6000; n++) {
        const m = Math.exp(-spent / ve);                       // mass relative to launch
        const v2 = vr * vr + vt * vt;
        // steering: straight up first, then the kick, then along the air-relative velocity
        const vtRel = vt - spin * r * Math.cos(((opts.lat || 0) * Math.PI) / 180), vrel = Math.hypot(vr, vtRel);
        let pitch = 0;                                         // angle from vertical
        if (r - R > 250) pitch = vrel < 100 ? kick : Math.max(0, Math.atan2(vtRel, Math.max(vr, 1e-6)));
        // thrust acceleration (m/s^2): thrust per launch mass is twr*g0
        const aT = burning ? (twr * g0) / m : 0;
        const rho = air(r - R), aD = rho > 0 ? (rho * vrel * vrel) / (2 * beta) : 0;
        const dr = vrel > 0 ? vr / vrel : 0, dtn = vrel > 0 ? vtRel / vrel : 0;
        const ar = vt * vt / r - gm / (r * r) + aT * Math.cos(pitch) - aD * dr;
        const at = -vr * vt / r + aT * Math.sin(pitch) - aD * dtn;
        vr += ar * dt; vt += at * dt; r += vr * dt; t += dt;
        if (burning) spent += aT * dt;
        if (r < R - 1) return null;
        const E = 0.5 * (vr * vr + vt * vt) - gm / r, a = -gm / (2 * E);
        const h = r * vt, e = Math.sqrt(Math.max(0, 1 + (2 * E * h * h) / (gm * gm)));
        if (burning && E < 0 && a * (1 + e) >= rT) burning = false;
        if (!burning && vr <= 0) {
          if (r < R + (body.atmo || 0) * 0.5 && air(r - R) > 1e-4) return null;   // stuck low in the air
          if (r - R < 0.9 * (rT - R)) return null;                                  // never got up to the target orbit
          const circ = Math.max(0, Math.sqrt(gm / r) - vt);
          return { dv: spent + circ, burn: spent, circ: circ, apo: r - R };
        }
        if (!burning && r < R + 1000) return null;
      }
      return null;
    };
    let best = null;
    for (const k of [0.5, 1, 1.5, 2, 3, 4, 5, 7, 10, 14, 20]) {
      const o = run(k);
      if (o && (!best || o.dv < best.dv)) best = Object.assign({ kick: k }, o);
    }
    if (!best) return null;
    best.losses = Math.round(best.dv - Math.sqrt(gm / rT) + w0);
    return best;
  }

  /** Default allowance (m/s) for the ascent from a body's surface, on top of the circular-orbit speed. Kerbin's 1300 gives the
   *  community figure of about 3400 m/s from the space centre; null where nobody can say without flying it (thick atmospheres). */
  function defaultLosses(body) {
    if (body.id === 'Kerbin') return 1300;
    if (!body.hasAtmo) return Math.round(0.15 * vcirc(body.gm, body.radius + 15000));
    return null;
  }

  /** One leg. Returns { label, dv, note, t0, t1 } (UT in seconds) or { error }. `ut` is where the previous leg ended. */
  function leg(world, spec, ut) {
    const b = (id) => world.index.get(id);
    switch (spec.type) {
      case 'launch': {
        const body = b(spec.body || 'Kerbin');
        if (!body) return { error: 'unknown body' };
        const r = body.radius + (spec.alt || 80) * KM;
        const sim = spec.losses == null && (spec.twr || defaultLosses(body) === null) ? ascent(body, { twr: spec.twr || 1.5, alt: (spec.alt || 80) * KM, lat: spec.lat || 0, isp: spec.isp, beta: spec.beta }) : null;
        const losses = spec.losses != null ? spec.losses : sim ? sim.losses : defaultLosses(body);
        if (losses === null || losses === undefined) return { error: 'set the ascent losses for ' + body.name + ' (the simulated ascent found no way up: raise the thrust-to-weight ratio)' };
        const rot = body.rotPeriod && isFinite(body.rotPeriod) && !body.locked ? (2 * Math.PI * body.radius) / body.rotPeriod : 0;
        const bonus = rot * Math.cos(((spec.lat || 0) * Math.PI) / 180);
        return { label: 'Launch to ' + (spec.alt || 80) + ' km orbit of ' + body.name, dv: vcirc(body.gm, r) + losses - bonus,
          note: 'orbital speed ' + Math.round(vcirc(body.gm, r)) + ' + losses ' + losses + ' - rotation ' + Math.round(bonus) + (sim ? ' (simulated gravity turn at thrust-to-weight ' + (spec.twr || 1.5) + ', kick ' + sim.kick + '°)' : ''), t0: ut, t1: ut + (spec.minutes || 10) * 60 };
      }
      case 'transfer': {
        const from = b(spec.from), to = b(spec.to);
        if (!from || !to || from === to) return { error: 'pick two different bodies' };
        const park = (spec.park != null ? spec.park : 100) * KM;
        const cap = spec.capture == null || spec.capture === '' ? null : spec.capture * KM;
        if (to.parentBody === from) {
          // parent to moon: a Hohmann transfer between the parking orbit and the moon's orbit, then capture at the moon
          const r1 = from.radius + park, r2 = to.orbit.a, at = (r1 + r2) / 2;
          const dv1 = visviva(from.gm, r1, at) - vcirc(from.gm, r1);
          const vinf = Math.abs(vcirc(from.gm, r2) - visviva(from.gm, r2, at));
          const dv2 = cap === null ? 0 : Tr.burn(to.gm, to.radius + cap, vinf);
          const tof = Math.PI * Math.sqrt((at * at * at) / from.gm);
          return { label: 'Transfer ' + from.name + ' to ' + to.name + (cap === null ? ' (fly-by)' : ' and capture'), dv: dv1 + dv2,
            note: 'leave ' + Math.round(dv1) + ' + arrive ' + Math.round(dv2) + ' m/s, flight ' + (tof / Orb.DAY).toFixed(1) + ' days (Hohmann, any time)', t0: ut, t1: ut + tof, flight: tof };
        }
        if (to.parentBody && to.parentBody === from.parentBody) {
          const synodic = Math.abs(1 / (1 / from._p.period - 1 / to._p.period));
          const horizon = Math.max(synodic * 1.15, 30 * Orb.DAY);
          const start = ut + (spec.after || 0) * Orb.DAY;
          const r = Tr.windows(world, from.id, to.id, start, horizon, { parkAlt: park, captureAlt: cap });
          if (!r || !r.windows.length) return { error: 'no transfer window found in the next ' + Math.round(horizon / Orb.DAY) + ' days' };
          const w = spec.pick === 'cheapest' ? r.windows.reduce((m, x) => (x.total < m.total ? x : m)) : r.windows[0];
          return { label: 'Transfer ' + from.name + ' to ' + to.name + (cap === null ? ' (fly-by)' : ' and capture'), dv: w.total,
            note: 'leave ' + Math.round(w.dvDepart) + ' + arrive ' + Math.round(w.dvArrive) + ' m/s, flight ' + (w.tof / Orb.DAY).toFixed(0) + ' days',
            t0: w.depart, t1: w.arrive, flight: w.tof, windows: r.windows };
        }
        // between two different planets' systems (Kerbin to Laythe, Mun to Duna, Ike to Laythe): the planets' own Lambert window decides the dates; leaving or
        // entering a moon is priced as the escape from (or capture at) the moon with the speed the planet-centred burn needs at the moon's orbit, assuming the
        // moon is on the right side at the right time (the best case: the moon's phase is not searched)
        const planetOf = (x) => { while (x && x.depth > 1) x = x.parentBody; return x; };
        const A = planetOf(from), B = planetOf(to);
        if (A && B && A !== B && A.parentBody && A.parentBody === B.parentBody && from.depth <= 2 && to.depth <= 2) {
          const side = (x, planet, vinf, alt) => {
            if (x === planet) return Tr.burn(x.gm, x.radius + alt, vinf);
            const rm = x.orbit.a, vp = Math.sqrt(vinf * vinf + (2 * planet.gm) / rm), vMoon = Math.max(0, vp - vcirc(planet.gm, rm));
            return Tr.burn(x.gm, x.radius + alt, vMoon);
          };
          const synodic = Math.abs(1 / (1 / A._p.period - 1 / B._p.period));
          const horizon = Math.max(synodic * 1.15, 30 * Orb.DAY);
          const start = ut + (spec.after || 0) * Orb.DAY;
          const r = Tr.windows(world, A.id, B.id, start, horizon, { parkAlt: park, captureAlt: cap, departBurn: (v) => side(from, A, v, park), arriveBurn: (v) => (cap === null ? 0 : side(to, B, v, cap)) });
          if (!r || !r.windows.length) return { error: 'no transfer window found in the next ' + Math.round(horizon / Orb.DAY) + ' days' };
          const w = spec.pick === 'cheapest' ? r.windows.reduce((m, x) => (x.total < m.total ? x : m)) : r.windows[0];
          return { label: 'Transfer ' + from.name + ' to ' + to.name + (cap === null ? ' (fly-by)' : ' and capture'), dv: w.total,
            note: 'leave ' + Math.round(w.dvDepart) + ' + arrive ' + Math.round(w.dvArrive) + ' m/s, flight ' + (w.tof / Orb.DAY).toFixed(0) + ' days (' + A.name + ' to ' + B.name + ' window' + (from !== A || to !== B ? '; the moon phase at each end is assumed right, the best case' : '') + ')',
            t0: w.depart, t1: w.arrive, flight: w.tof, windows: r.windows };
        }
        return { error: from.name + ' to ' + to.name + ': pick bodies of one planet system, a planet and its moon, or two planets (or their moons) around the same star' };
      }
      case 'land': {
        const body = b(spec.body);
        if (!body) return { error: 'unknown body' };
        const r0 = body.radius + (spec.alt || 30) * KM, rs = body.radius, a = (r0 + rs) / 2;
        const deorbit = vcirc(body.gm, r0) - visviva(body.gm, r0, a);
        const vp = visviva(body.gm, rs, a);
        const chutes = spec.chutes && body.hasAtmo;
        const burn = chutes ? (spec.powered != null ? spec.powered : 100) : vp * (1 + (spec.margin != null ? spec.margin : 0.15));
        return { label: 'Land on ' + body.name + (chutes ? ' (parachutes)' : ''), dv: deorbit + burn,
          note: chutes ? 'de-orbit ' + Math.round(deorbit) + ' + powered allowance ' + Math.round(burn) : 'de-orbit ' + Math.round(deorbit) + ' + landing burn ' + Math.round(vp) + ' + ' + Math.round((spec.margin != null ? spec.margin : 0.15) * 100) + '% margin',
          t0: ut, t1: ut + (spec.stayDays || 0) * Orb.DAY };
      }
      case 'ascent': {
        const body = b(spec.body);
        if (!body) return { error: 'unknown body' };
        const r = body.radius + (spec.alt || 30) * KM;
        const sim = spec.losses == null && (spec.twr || body.hasAtmo) ? ascent(body, { twr: spec.twr || 1.5, alt: (spec.alt || 30) * KM, isp: spec.isp, beta: spec.beta }) : null;
        const losses = spec.losses != null ? spec.losses : sim ? sim.losses : (body.hasAtmo ? null : Math.round(0.15 * vcirc(body.gm, r)));
        if (losses === null || losses === undefined) return { error: 'set the ascent losses for ' + body.name };
        return { label: 'Ascend from ' + body.name + ' to ' + (spec.alt || 30) + ' km', dv: vcirc(body.gm, r) + losses, note: 'orbital speed ' + Math.round(vcirc(body.gm, r)) + ' + losses ' + losses + (sim ? ' (simulated gravity turn at thrust-to-weight ' + (spec.twr || 1.5) + ')' : ''), t0: ut, t1: ut + 600 };
      }
      case 'return': {
        // a moon back to its parent: leave a low orbit on a hyperbola that drops to the parent's periapsis `pe`
        const moon = b(spec.body);
        if (!moon || !moon.parentBody) return { error: 'pick a moon' };
        const P = moon.parentBody;
        const rm = moon.orbit.a, rp = P.radius + (spec.pe != null ? spec.pe : 35) * KM, at = (rm + rp) / 2;
        const vinf = Math.abs(vcirc(P.gm, rm) - visviva(P.gm, rm, at));
        const dv = Tr.burn(moon.gm, moon.radius + (spec.alt || 30) * KM, vinf);
        const tof = Math.PI * Math.sqrt((at * at * at) / P.gm);
        return { label: 'Return from ' + moon.name + ' toward ' + P.name + ' (periapsis ' + (spec.pe != null ? spec.pe : 35) + ' km)', dv: dv,
          note: 'escape speed excess ' + Math.round(vinf) + ' m/s, flight ' + (tof / Orb.DAY).toFixed(1) + ' days', t0: ut, t1: ut + tof, flight: tof };
      }
      case 'plane': {
        const body = b(spec.body);
        if (!body) return { error: 'unknown body' };
        const v = vcirc(body.gm, body.radius + (spec.alt || 100) * KM);
        return { label: 'Plane change of ' + (spec.degrees || 0) + ' degrees at ' + (spec.alt || 100) + ' km above ' + body.name, dv: 2 * v * Math.sin((((spec.degrees || 0) * Math.PI) / 180) / 2), note: 'circular orbit, at a node', t0: ut, t1: ut };
      }
      case 'custom':
        return { label: spec.label || 'Burn', dv: spec.dv || 0, note: 'entered by hand', t0: ut, t1: ut + (spec.days || 0) * Orb.DAY };
      default:
        return { error: 'unknown leg type ' + spec.type };
    }
  }

  /** Run the legs in order from `startUT`; stops listing dates after the first error. total = sum of dv. */
  function plan(world, specs, startUT) {
    let ut = startUT || 0;
    const legs = [];
    let total = 0, error = null;
    for (const spec of specs) {
      const r = leg(world, spec, ut);
      if (r.error) { error = r.error; legs.push({ label: spec.type, dv: 0, note: r.error, error: true, t0: ut, t1: ut }); continue; }
      legs.push(r);
      total += r.dv;
      ut = r.t1;
    }
    return { legs: legs, total: total, end: ut, duration: ut - (startUT || 0), error: error };
  }

  return { plan: plan, leg: leg, ascent: ascent, defaultLosses: defaultLosses, vcirc: vcirc };
});
