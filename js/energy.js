// SPDX-License-Identifier: AGPL-3.0-or-later
/* Energy planning: how much sunlight a vessel or base really gets, and what generation and batteries cover its load. Pure logic.
 *
 * Sunlight (all of it from the game's own rules, docs/RESEARCH.md section 8):
 *   - a panel's output = chargeRate x (flux where it is / flux at home) x sun angle factor. Flux falls with the square of the distance to
 *     the star (luminosity / 4 pi d^2), and "at home" is the flux at the home planet's orbit. A tracking panel has factor 1 whenever
 *     the sun is in view; a fixed one depends on how it points (a flat panel on the ground: the sine of the sun's elevation).
 *   - the sun is hidden when a body is in the way. This module samples real positions over the planet's year and tests every body as
 *     a sphere of its radius, so eclipses by a planet or a moon, night on the ground, and the changing distance of an eccentric orbit
 *     all come out of the same world the rest of the app uses.
 *   - RTGs give a fixed 0.75 charge per second; fuel cells burn liquid fuel and oxidizer (1.5 charge per second for the Fuel Cell, 18 for the array).
 * Not modelled: the atmosphere dimming the sun on the ground (a factor you can set), panel heating, and power use that changes
 * with what the crew does (give each load a duty cycle). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./orbits.js'), require('./career-data.js'), require('./energy-data.js'));
  } else root.KSPEnergy = factory(root.KSPData, root.KSPOrbits, root.KSPCareerData, root.KSPEnergyData);
})(typeof self !== 'undefined' ? self : this, function (Data, Orb, CD, ED) {
  'use strict';

  const norm = (id) => String(id).replace(/\./g, '_');
  const partOf = (id) => CD.parts.find((p) => p.id === id) || { id: id, title: id, cost: 0, mass: 0, entry: 0, tech: '' };

  /** The planet a body belongs to (the body whose parent is the star), or the body itself. */
  function planetOf(b) {
    let x = b;
    while (x.parentBody && !x.parentBody.star) x = x.parentBody;
    return x;
  }
  const synodic = (a, b) => (a && b && a !== b ? 1 / Math.abs(1 / a - 1 / b) : a || b);

  /**
   * Sunlight at a place over the planet's year. loc: {type:'orbit', body, orbit} | {type:'landed', body, lat, lon, alt} |
   * {type:'space', body} (in deep space about the orbit of that planet: always lit). opts: t0, epochs (8), cycles (2),
   * orientation (0..1, how well a fixed panel faces the sun while orbiting, default 0.5).
   * Returns {cycle (s), share {min, mean, max} (fraction of time in sunlight), dark {max, mean} (longest unbroken darkness, s),
   * flux {min, mean, max} (relative to home, while lit), tracking {min, mean} and fixed {min, mean} (time-average flux a panel
   * of that kind sees, darkness counted as zero: multiply by a panel's charge rate), epochs: [...]}.
   */
  function lightProfile(world, loc, opts) {
    opts = opts || {};
    const star = world.bodies.find((b) => b.star);
    const nb = world.bodies.length, buf = new Float64Array(nb * 3), tmp = [0, 0, 0];
    const home = world.index.get('Kerbin') || planetOf(world.bodies.find((b) => !b.star));
    const aHome = home.orbit ? home.orbit.a : 1;
    const body = world.index.get(loc.body);
    const planet = planetOf(body);
    let year = planet.orbitalPeriod || 1;
    const nEp = loc.type === 'space' ? 1 : (opts.epochs || 8);
    const orient = opts.orientation == null ? 0.5 : opts.orientation;
    const t0 = opts.t0 || 0;
    const sunIdx = star.idx;
    const perEpoch = [];
    let cycle, prep = null;
    if (loc.type === 'orbit') { prep = Orb.prepare(loc.orbit, body.gm); cycle = prep.period; if (body.star) year = prep.period; }   // a vessel orbiting the star sees its own year
    else if (loc.type === 'landed') {
      const rot = body.locked ? body.orbitalPeriod : body.rotPeriod;
      cycle = body.id === planet.id ? synodic(rot, year) : synodic(rot, year);   // a solar day: the spin against the planet's year (a locked moon spins once per orbit)
    } else cycle = year;
    cycle = Math.max(60, cycle);

    const sample = (t, stat) => {
      world.positions(t, buf);
      const sx = buf[sunIdx * 3], sy = buf[sunIdx * 3 + 1], sz = buf[sunIdx * 3 + 2];
      if (loc.type === 'landed') world.surfacePoint(body, loc.lat, loc.lon, loc.alt || 0, t, buf, tmp);
      else if (loc.type === 'orbit') { Orb.position(prep, t, tmp); tmp[0] += buf[body.idx * 3]; tmp[1] += buf[body.idx * 3 + 1]; tmp[2] += buf[body.idx * 3 + 2]; }
      else { tmp[0] = buf[body.idx * 3]; tmp[1] = buf[body.idx * 3 + 1]; tmp[2] = buf[body.idx * 3 + 2]; }
      const vx = tmp[0], vy = tmp[1], vz = tmp[2];
      const dx = sx - vx, dy = sy - vy, dz = sz - vz, d2 = dx * dx + dy * dy + dz * dz;
      const flux = (aHome * aHome) / d2;
      let lit = true, sinElev = 1;
      if (loc.type !== 'space') {
        for (const b of world.bodies) {
          if (b.star) continue;
          const cx = buf[b.idx * 3], cy = buf[b.idx * 3 + 1], cz = buf[b.idx * 3 + 2];
          if (loc.type === 'landed' && b.id === body.id) {
            const ux = vx - cx, uy = vy - cy, uz = vz - cz, ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
            sinElev = (ux * dx + uy * dy + uz * dz) / (ul * Math.sqrt(d2));
            if (sinElev <= 0) { lit = false; break; }
            continue;
          }
          // does the sphere of this body touch the segment vessel -> sun?
          const wx = cx - vx, wy = cy - vy, wz = cz - vz;
          let u = (wx * dx + wy * dy + wz * dz) / d2;
          if (u <= 0 || u >= 1) continue;
          const px = vx + u * dx - cx, py = vy + u * dy - cy, pz = vz + u * dz - cz;
          if (px * px + py * py + pz * pz < b.radius * b.radius) { lit = false; break; }
        }
      }
      stat.n++;
      if (lit) {
        stat.lit++; stat.flux += flux; stat.fmin = Math.min(stat.fmin, flux); stat.fmax = Math.max(stat.fmax, flux);
        stat.trk += flux; stat.fix += flux * (loc.type === 'landed' ? Math.max(0, sinElev) : orient);
        stat.run = 0;
      } else { stat.run++; stat.dark = Math.max(stat.dark, stat.run); }
      return lit;
    };

    const steps = loc.type === 'space' ? 24 : 120;
    for (let k = 0; k < nEp; k++) {
      const stat = { n: 0, lit: 0, flux: 0, fmin: Infinity, fmax: 0, trk: 0, fix: 0, run: 0, dark: 0 };
      const span = loc.type === 'space' ? year : (opts.cycles || 2) * cycle;
      const dt = span / steps;
      const start = t0 + (k * year) / nEp;
      for (let i = 0; i < steps; i++) sample(start + i * dt, stat);
      perEpoch.push({
        share: stat.lit / stat.n, dark: stat.dark * dt, flux: stat.lit ? stat.flux / stat.lit : 0, fmin: stat.lit ? stat.fmin : 0, fmax: stat.fmax,
        tracking: stat.trk / stat.n, fixed: stat.fix / stat.n,
      });
    }
    const agg = (f) => ({ min: Math.min.apply(null, perEpoch.map(f)), mean: perEpoch.reduce((q, e) => q + f(e), 0) / perEpoch.length, max: Math.max.apply(null, perEpoch.map(f)) });
    const out = {
      loc: loc, cycle: cycle, year: year, share: agg((e) => e.share), dark: { max: Math.max.apply(null, perEpoch.map((e) => e.dark)), mean: perEpoch.reduce((q, e) => q + e.dark, 0) / perEpoch.length },
      flux: { min: Math.min.apply(null, perEpoch.map((e) => e.fmin)), mean: perEpoch.reduce((q, e) => q + e.flux, 0) / perEpoch.length, max: Math.max.apply(null, perEpoch.map((e) => e.fmax)) },
      tracking: agg((e) => e.tracking), fixed: agg((e) => e.fixed), epochs: perEpoch,
    };
    // Out in space there is one sample of the whole year, so its "min" would be the year's mean: a panel has to cope with the dimmest point of an eccentric orbit
    if (loc.type === 'space') { out.tracking.min = out.flux.min; out.fixed.min = out.flux.min * orient; }
    return out;
  }

  /* ---------- what the career can build ---------- */

  /** have / buy (tech done, not bought: entry price) / research (tech missing: the node) for a part. state null = everything. */
  function partStatus(state, id) {
    const p = partOf(id);
    if (!state || state.mode === 'sandbox') return { status: 'have', part: p };
    if (!p.tech || p.tech === 'Unresearchable') return { status: 'have', part: p };
    if (state.tech.indexOf(p.tech) < 0) return { status: 'research', node: p.tech, part: p };
    const bought = state.mode === 'science' || p.entry === 0 || state.parts.map(norm).indexOf(norm(id)) >= 0;
    return bought ? { status: 'have', part: p } : { status: 'buy', funds: p.entry, part: p };
  }

  /* ---------- loads ---------- */

  /** Charge per second an antenna uses while it sends (the game's packet cost over the packet interval). */
  const transmitEC = (a) => (a && a.pktInterval > 0 ? a.pktEC / a.pktInterval : 0);

  /** The standing choices for the load list: [{id, label, ec, group}]. */
  function loadCatalogue() {
    const t = (id) => partOf(id).title;
    const out = [];
    for (const id of Object.keys(ED.cores)) if (ED.cores[id] > 0) out.push({ id: 'core:' + id, label: t(id) + ' (control)', ec: ED.cores[id], group: 'Probe cores' });
    for (const id of Object.keys(ED.wheels)) { const p = partOf(id); if (p.cat === 'Control') out.push({ id: 'wheel:' + id, label: t(id) + ' (turning)', ec: ED.wheels[id], group: 'Reaction wheels' }); }
    for (const id of Object.keys(ED.drills)) out.push({ id: 'drill:' + id, label: t(id) + ' (drilling)', ec: ED.drills[id], group: 'Mining and processing' });
    for (const id of Object.keys(ED.converters)) out.push({ id: 'isru:' + id, label: t(id) + ' (one converter running)', ec: ED.converters[id], group: 'Mining and processing' });
    for (const id of Object.keys(ED.radiators)) out.push({ id: 'rad:' + id, label: t(id) + ' (cooling)', ec: ED.radiators[id], group: 'Cooling' });
    for (const id of Object.keys(ED.motors)) out.push({ id: 'motor:' + id, label: t(id) + ' (driving)', ec: ED.motors[id], group: 'Rovers' });
    return out;
  }

  /* ---------- design ---------- */

  const sum = (a, f) => a.reduce((q, x) => q + f(x), 0);

  /**
   * What covers a load. P: { profile (lightProfile), loads [{label, ec, duty (0..1)}], state (career or null), margin (0.15), burstMin (0: minutes of
   * everything on at once the batteries must carry), days (30: for the fuel cell), atmosphere (1: factor for dimmed light on a world with air),
   * panels/batteries (lists of part ids to consider, default every one the career can build) }.
   * Returns { avg, peak, options: [...] } with each option {kind, parts: [{id, n}], mass, cost, funds (to unlock), notes, status}.
   */
  function design(P) {
    const prof = P.profile, margin = P.margin == null ? 0.15 : P.margin, atmo = P.atmosphere == null ? 1 : P.atmosphere;
    const avg = sum(P.loads, (l) => l.ec * (l.duty == null ? 1 : l.duty)), peak = sum(P.loads, (l) => l.ec);
    const need = avg * (1 + margin);
    const burst = Math.max(0, peak - avg) * (P.burstMin || 0) * 60;
    const dark = prof.dark.max;
    const eDark = avg * dark * (1 + margin);
    const status = (id) => partStatus(P.state, id);
    const batteryFor = (energy) => {
      if (!(energy > 0)) return { parts: [], mass: 0, cost: 0, funds: 0, energy: 0 };
      let best = null;
      for (const id of Object.keys(ED.batteries)) {
        const p = partOf(id);
        if (p.cat !== 'Electrical' || /FuelCell/.test(id)) continue;
        const st = status(id);
        if (st.status !== 'have' && !P.allowUnlock) continue;
        const n = Math.ceil(energy / ED.batteries[id]);
        const o = { parts: [{ id: id, n: n }], mass: n * p.mass, cost: n * p.cost, funds: st.status === 'buy' ? st.funds : 0, needs: st.status === 'research' ? [st.node] : [], energy: n * ED.batteries[id] };
        if (!best || o.mass < best.mass - 1e-9 || (Math.abs(o.mass - best.mass) < 1e-9 && o.cost < best.cost)) best = o;
      }
      return best;
    };
    const options = [];
    const add = (o) => { o.funds = (o.funds || 0); options.push(o); };

    // solar panels: enough average output, plus batteries for the longest darkness and any burst
    for (const id of Object.keys(ED.solar)) {
      const sp = ED.solar[id], p = partOf(id), st = status(id);
      if (st.status !== 'have' && !P.allowUnlock) continue;
      const eff = (sp.tracking ? prof.tracking.min : prof.fixed.min) * atmo;
      const per = sp.rate * eff;
      if (!(per > 0)) continue;
      const n = Math.max(1, Math.ceil(need / per));
      const bat = batteryFor(eDark + burst);
      if (!bat) continue;
      add({
        kind: 'solar', parts: [{ id: id, n: n }].concat(bat.parts), mass: n * p.mass + bat.mass, cost: n * p.cost + bat.cost,
        funds: (st.status === 'buy' ? st.funds : 0) + bat.funds, needs: (st.status === 'research' ? [st.node] : []).concat(bat.needs), perPanel: per, generation: n * per,
        battery: bat.energy, notes: (sp.tracking ? 'tracks the sun' : 'fixed panel (' + (prof.loc.type === 'landed' ? 'lying flat' : Math.round((P.orientation == null ? 0.5 : P.orientation) * 100) + '% facing the sun') + ')'),
      });
    }
    // RTG: the same output day and night, anywhere
    for (const id of Object.keys(ED.rtg)) {
      const p = partOf(id), st = status(id);
      if (st.status !== 'have' && !P.allowUnlock) continue;
      const n = Math.max(1, Math.ceil(need / ED.rtg[id]));
      const bat = batteryFor(burst);
      if (!bat) continue;
      add({
        kind: 'rtg', parts: [{ id: id, n: n }].concat(bat.parts), mass: n * p.mass + bat.mass, cost: n * p.cost + bat.cost,
        funds: (st.status === 'buy' ? st.funds : 0) + bat.funds, needs: (st.status === 'research' ? [st.node] : []).concat(bat.needs), perPanel: ED.rtg[id], generation: n * ED.rtg[id],
        battery: bat.energy, notes: 'the same in darkness and far from the sun; never runs out in a game year',
      });
    }
    // fuel cells: independent of light, burn propellant
    const dens = (CD.resources.LiquidFuel || { density: 0.005 }).density;
    for (const id of Object.keys(ED.cells)) {
      if (!/^FuelCell/.test(id) || !ED.cells[id].ec) continue;
      const c = ED.cells[id], p = partOf(id), st = status(id);
      if (st.status !== 'have' && !P.allowUnlock) continue;
      const n = Math.max(1, Math.ceil(need / c.ec));
      const days = P.days || 30, secs = days * (Data.DAY || 21600);
      const fuel = (avg / c.ec) * (c.lf + c.ox) * dens * secs;
      add({
        kind: 'fuelcell', parts: [{ id: id, n: n }], mass: n * p.mass + fuel, cost: n * p.cost, funds: st.status === 'buy' ? st.funds : 0, needs: st.status === 'research' ? [st.node] : [],
        perPanel: c.ec, generation: n * c.ec, fuel: fuel, days: days, notes: fuel.toFixed(2) + ' t of liquid fuel and oxidizer for ' + days + ' days (tanks not counted)',
      });
    }
    options.sort((a, b) => a.mass - b.mass);
    return { avg: avg, peak: peak, need: need, dark: dark, darkEnergy: eDark, burstEnergy: burst, options: options };
  }

  return { lightProfile: lightProfile, partStatus: partStatus, design: design, transmitEC: transmitEC, loadCatalogue: loadCatalogue, planetOf: planetOf, partOf: partOf };
});
