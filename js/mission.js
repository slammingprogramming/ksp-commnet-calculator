// SPDX-License-Identifier: AGPL-3.0-or-later
/* Mission planning: a mission is a list of legs (launch, transfer, land, ascent, return, plane change, custom burn). Each leg gets a
 * delta-v and, for transfers, real departure and arrival dates from the same Lambert search the Launch windows tab uses. The total is
 * compared with what a rocket has (js/craft.js). Two-body, impulsive burns from circular orbits; the launch and ascent legs add a
 * loss allowance you can change, because gravity, drag and steering losses depend on how well the ascent is flown. No DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./transfer.js'), require('./orbits.js'));
  else root.KSPMission = factory(root.KSPTransfer, root.KSPOrbits);
})(typeof self !== 'undefined' ? self : this, function (Tr, Orb) {
  'use strict';

  const vcirc = (gm, r) => Math.sqrt(gm / r);
  const visviva = (gm, r, a) => Math.sqrt(Math.max(0, gm * (2 / r - 1 / a)));
  const KM = 1000;

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
        const losses = spec.losses != null ? spec.losses : defaultLosses(body);
        if (losses === null) return { error: 'set the ascent losses for ' + body.name + ' (nothing to base a default on)' };
        const rot = body.rotPeriod && isFinite(body.rotPeriod) && !body.locked ? (2 * Math.PI * body.radius) / body.rotPeriod : 0;
        const bonus = rot * Math.cos(((spec.lat || 0) * Math.PI) / 180);
        return { label: 'Launch to ' + (spec.alt || 80) + ' km orbit of ' + body.name, dv: vcirc(body.gm, r) + losses - bonus,
          note: 'orbital speed ' + Math.round(vcirc(body.gm, r)) + ' + losses ' + losses + ' - rotation ' + Math.round(bonus), t0: ut, t1: ut + (spec.minutes || 10) * 60 };
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
        return { error: from.name + ' to ' + to.name + ': only bodies that share a parent, or a parent and its moon, are supported (chain legs for the rest)' };
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
        const losses = spec.losses != null ? spec.losses : (body.hasAtmo ? null : Math.round(0.15 * vcirc(body.gm, r)));
        if (losses === null) return { error: 'set the ascent losses for ' + body.name };
        return { label: 'Ascend from ' + body.name + ' to ' + (spec.alt || 30) + ' km', dv: vcirc(body.gm, r) + losses, note: 'orbital speed ' + Math.round(vcirc(body.gm, r)) + ' + losses ' + losses, t0: ut, t1: ut + 600 };
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

  return { plan: plan, leg: leg, defaultLosses: defaultLosses, vcirc: vcirc };
});
