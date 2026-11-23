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
 *   - on a world with air the light that reaches the ground is dimmed by the game's own rule (CelestialBody.GetSolarAtmosphericEffects:
 *     airmass along the sun's direction x local density, factor = k / (k + density x airmass x 0.15) with k = 0.85 x the home world's
 *     sea-level density), and a panel's output is scaled by the game's temperature curve (hotter panels give less). The panel
 *     temperature is an estimate for a plate facing the sun (the game's value depends on the whole vessel).
 * Not modelled: power use that changes with what the crew does (give each load a duty cycle). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./orbits.js'), require('./career-data.js'), require('./energy-data.js'), require('./reentry.js'));
  } else root.KSPEnergy = factory(root.KSPData, root.KSPOrbits, root.KSPCareerData, root.KSPEnergyData, root.KSPReentry);
})(typeof self !== 'undefined' ? self : this, function (Data, Orb, CD, ED, Re) {
  'use strict';

  // Physics: PhysicsGlobals defaults (solarLuminosityAtHome 1360 W/m2, solarInsolationAtHome 0.15) and the panel module's default temperature curve
  const K = {
    sunHome: 1360, insolation: 0.15, sigma: 5.670374e-8, ln: 13.815510557964274,    // ln = -ln(1e-6): CelestialBody.radiusAtmoFactor = radius / depth x ln
    heat: [[4, 1.2, 0, -0.0006], [300, 1, -0.0008, -0.0008], [1200, 0.134, -0.00035, -0.00035], [1900, 0.02, -3.72e-5, -3.72e-5], [2500, 0.01, 0, 0]],
  };
  /** Share of a panel's output left at a skin temperature (K): the game's temperatureEfficCurve. */
  const heatEfficiency = (T) => Re.curve(K.heat, T);
  /** Temperature (K) of a plate facing the sun at a flux (relative to home): absorbs one face, radiates one or both (the game's value depends on the whole vessel). */
  function plateTemperature(flux, cos, faces) {
    const q = K.sunHome * Math.max(0, flux) * Math.max(0, cos);
    return Math.pow(q / ((faces || 2) * K.sigma) + 4 * 4 * 4 * 4, 0.25);
  }
  /**
   * The factor the game applies to sunlight on a world with air (1 = none). sunDot: sine of the sun's elevation (dot of the sun direction with "up").
   * Out of the way for orbits and for bodies without air. homeDensity: sea-level density of the home world.
   */
  function atmosphereFactor(body, alt, sunDot, homeDensity) {
    const at = Re.atmosphere(body.id);
    if (!at || !(at.depth > 0) || !body.radius) return 1;
    const rho = Re.air(body.id, alt || 0).density;
    if (!(rho > 0)) return 1;
    const raf = (body.radius / at.depth) * K.ln, x = raf * sunDot;
    const mass = x < 0 ? Math.sqrt(2 * raf + 1) : Math.sqrt(x * x + 2 * raf + 1) - x;
    const k = (1 - K.insolation) * homeDensity;
    return k / (k + rho * mass * K.insolation);
  }

  const norm = (id) => String(id).replace(/\./g, '_');
  let EXTRA = null;   // mod power parts the user imported (Parsers.parsePowerCfg shape); set per call by design()/loadCatalogue()
  const partOf = (id) => (EXTRA && EXTRA.parts && EXTRA.parts[id] ? Object.assign({ id: id }, EXTRA.parts[id], { mod: true }) : CD.parts.find((p) => p.id === id)) || { id: id, title: id, cost: 0, mass: 0, entry: 0, tech: '' };
  /** The game's power parts plus the imported ones, section by section. */
  const sec = (name) => Object.assign({}, ED[name] || {}, (EXTRA && EXTRA[name]) || {});

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
    const homeDensity = (Re.hasAtmosphere(home.id) ? Re.air(home.id, 0).density : 0) || 1.225;
    const heat = opts.heat !== false;
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
        // light left after the air (on the ground), and what the panel's temperature does to its output
        const fa = loc.type === 'landed' ? atmosphereFactor(body, loc.alt, sinElev, homeDensity) : 1;
        const cosFix = loc.type === 'landed' ? Math.max(0, sinElev) : orient;
        let etaT = 1, etaF = 1, tT = 0;
        if (heat) {
          const air = loc.type === 'landed' && fa < 1 ? Re.air(body.id, loc.alt || 0) : null;     // on the ground in air: the air carries the heat away
          tT = air ? air.temperature : plateTemperature(flux * fa, 1, loc.type === 'landed' ? 1 : 2);
          etaT = heatEfficiency(tT);
          etaF = air ? etaT : heatEfficiency(plateTemperature(flux * fa, cosFix, loc.type === 'landed' ? 1 : 2));
        }
        stat.lit++; stat.flux += flux; stat.fmin = Math.min(stat.fmin, flux); stat.fmax = Math.max(stat.fmax, flux);
        stat.trk += flux * fa * etaT; stat.fix += flux * fa * cosFix * etaF;
        stat.atm += fa; stat.eta += etaT; stat.tmax = Math.max(stat.tmax, tT); stat.tmin = Math.min(stat.tmin, tT);
        stat.run = 0;
      } else { stat.run++; stat.dark = Math.max(stat.dark, stat.run); }
      return lit;
    };

    const steps = loc.type === 'space' ? 24 : 120;
    for (let k = 0; k < nEp; k++) {
      const stat = { n: 0, lit: 0, flux: 0, fmin: Infinity, fmax: 0, trk: 0, fix: 0, run: 0, dark: 0, atm: 0, eta: 0, tmax: 0, tmin: Infinity };
      const span = loc.type === 'space' ? year : (opts.cycles || 2) * cycle;
      const dt = span / steps;
      const start = t0 + (k * year) / nEp;
      for (let i = 0; i < steps; i++) sample(start + i * dt, stat);
      perEpoch.push({
        share: stat.lit / stat.n, dark: stat.dark * dt, flux: stat.lit ? stat.flux / stat.lit : 0, fmin: stat.lit ? stat.fmin : 0, fmax: stat.fmax,
        tracking: stat.trk / stat.n, fixed: stat.fix / stat.n,
        atm: stat.lit ? stat.atm / stat.lit : 1, eta: stat.lit ? stat.eta / stat.lit : 1, tmax: stat.tmax, tmin: stat.lit ? stat.tmin : 0,
      });
    }
    const agg = (f) => ({ min: Math.min.apply(null, perEpoch.map(f)), mean: perEpoch.reduce((q, e) => q + f(e), 0) / perEpoch.length, max: Math.max.apply(null, perEpoch.map(f)) });
    const out = {
      loc: loc, cycle: cycle, year: year, share: agg((e) => e.share), dark: { max: Math.max.apply(null, perEpoch.map((e) => e.dark)), mean: perEpoch.reduce((q, e) => q + e.dark, 0) / perEpoch.length },
      flux: { min: Math.min.apply(null, perEpoch.map((e) => e.fmin)), mean: perEpoch.reduce((q, e) => q + e.flux, 0) / perEpoch.length, max: Math.max.apply(null, perEpoch.map((e) => e.fmax)) },
      tracking: agg((e) => e.tracking), fixed: agg((e) => e.fixed), epochs: perEpoch,
      air: { factor: agg((e) => e.atm), dense: loc.type === 'landed' && Re.hasAtmosphere(body.id) },
      heat: { efficiency: agg((e) => e.eta), tmax: Math.max.apply(null, perEpoch.map((e) => e.tmax)), tmin: Math.min.apply(null, perEpoch.map((e) => e.tmin)) },
    };
    // Out in space there is one sample of the whole year, so its "min" would be the year's mean: a panel has to cope with the dimmest point of an eccentric orbit
    if (loc.type === 'space') {
      const lo = heat ? heatEfficiency(plateTemperature(out.flux.min, 1, 2)) : 1, loF = heat ? heatEfficiency(plateTemperature(out.flux.min, orient, 2)) : 1;
      out.tracking.min = out.flux.min * lo; out.fixed.min = out.flux.min * orient * loF;
    }
    return out;
  }

  /* ---------- what the career can build ---------- */

  /** have / buy (tech done, not bought: entry price) / research (tech missing: the node) for a part. state null = everything. */
  function partStatus(state, id) {
    const p = partOf(id);
    if (!state || state.mode === 'sandbox' || p.mod) return { status: 'have', part: p };   // a mod's part cannot be tied to the stock tech tree
    if (!p.tech || p.tech === 'Unresearchable') return { status: 'have', part: p };
    if (state.tech.indexOf(p.tech) < 0) return { status: 'research', node: p.tech, part: p };
    const bought = state.mode === 'science' || p.entry === 0 || state.parts.map(norm).indexOf(norm(id)) >= 0;
    return bought ? { status: 'have', part: p } : { status: 'buy', funds: p.entry, part: p };
  }

  /* ---------- loads ---------- */

  /** Charge per second an antenna uses while it sends (the game's packet cost over the packet interval). */
  const transmitEC = (a) => (a && a.pktInterval > 0 ? a.pktEC / a.pktInterval : 0);

  /** The standing choices for the load list: [{id, label, ec, group}]. */
  function loadCatalogue(extra) {
    EXTRA = extra || null;
    const t = (id) => partOf(id).title;
    const out = [];
    const cores = sec('cores'), wheels = sec('wheels'), drills = sec('drills'), conv = sec('converters'), rads = sec('radiators'), motors = sec('motors'), engines = sec('engines');
    for (const id of Object.keys(cores)) if (cores[id] > 0) out.push({ id: 'core:' + id, label: t(id) + ' (control)', ec: cores[id], group: 'Probe cores' });
    for (const id of Object.keys(wheels)) { const p = partOf(id); if (p.cat === 'Control' || p.mod) out.push({ id: 'wheel:' + id, label: t(id) + ' (turning)', ec: wheels[id], group: 'Reaction wheels' }); }
    for (const id of Object.keys(drills)) out.push({ id: 'drill:' + id, label: t(id) + ' (drilling)', ec: drills[id], group: 'Mining and processing' });
    for (const id of Object.keys(conv)) out.push({ id: 'isru:' + id, label: t(id) + ' (one converter running)', ec: conv[id], group: 'Mining and processing' });
    for (const id of Object.keys(rads)) out.push({ id: 'rad:' + id, label: t(id) + ' (cooling)', ec: rads[id], group: 'Cooling' });
    for (const id of Object.keys(motors)) out.push({ id: 'motor:' + id, label: t(id) + ' (driving)', ec: motors[id], group: 'Rovers' });
    for (const id of Object.keys(engines)) out.push({ id: 'eng:' + id, label: t(id) + ' (full thrust, ' + Math.round(engines[id].thrust * 100) / 100 + ' kN)', ec: engines[id].ec, group: 'Electric engines' });
    return out;
  }

  /** The parts that carry charge: [{id, title, ec (capacity)}], for the "already on board" list. */
  function storedCatalogue(extra) {
    EXTRA = extra || null;
    const st = sec('stored');
    return Object.keys(st).map((id) => ({ id: id, title: partOf(id).title, ec: st[id] })).sort((a, b) => a.title.localeCompare(b.title));
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
    EXTRA = P.extra || null;
    const SOLAR = sec('solar'), RTG = sec('rtg'), BAT = sec('batteries'), CELLS = sec('cells'), REACT = sec('reactors');
    const prof = P.profile, margin = P.margin == null ? 0.15 : P.margin, atmo = P.atmosphere == null ? 1 : P.atmosphere;
    const avg = sum(P.loads, (l) => l.ec * (l.duty == null ? 1 : l.duty)), peak = sum(P.loads, (l) => l.ec);
    const need = avg * (1 + margin);
    const burst = Math.max(0, peak - avg) * (P.burstMin || 0) * 60;
    const dark = prof.dark.max;
    const eDark = avg * dark * (1 + margin);
    const status = (id) => partStatus(P.state, id);
    const onBoard = Math.max(0, P.stored || 0);                       // charge the parts already on the vessel carry (probe cores, pods)
    const batteryFor = (energy0) => {
      const energy = energy0 - onBoard;
      if (!(energy > 0)) return { parts: [], mass: 0, cost: 0, funds: 0, energy: 0, needs: [] };
      let best = null;
      for (const id of Object.keys(BAT)) {
        const p = partOf(id);
        if ((p.cat !== 'Electrical' && !p.mod) || /FuelCell/.test(id)) continue;
        const st = status(id);
        if (st.status !== 'have' && !P.allowUnlock) continue;
        const n = Math.ceil(energy / BAT[id]);
        const o = { parts: [{ id: id, n: n }], mass: n * p.mass, cost: n * p.cost, funds: st.status === 'buy' ? st.funds : 0, needs: st.status === 'research' ? [st.node] : [], energy: n * BAT[id] };
        if (!best || o.mass < best.mass - 1e-9 || (Math.abs(o.mass - best.mass) < 1e-9 && o.cost < best.cost)) best = o;
      }
      return best;
    };
    const options = [];
    const add = (o) => { o.funds = (o.funds || 0); options.push(o); };

    // solar panels: enough average output, plus batteries for the longest darkness and any burst
    for (const id of Object.keys(SOLAR)) {
      const sp = SOLAR[id], p = partOf(id), st = status(id);
      if (st.status !== 'have' && !P.allowUnlock) continue;
      // tracking panels always face the sun; spherical and cylindrical ones get a fixed share; flat fixed ones use the orientation set
      const eff = (sp.tracking ? prof.tracking.min : sp.fixed ? prof.tracking.min * sp.fixed : prof.fixed.min) * atmo;
      const per = sp.rate * eff;
      if (!(per > 0)) continue;
      const n = Math.max(1, Math.ceil(need / per));
      const bat = batteryFor(eDark + burst);
      if (!bat) continue;
      add({
        kind: 'solar', parts: [{ id: id, n: n }].concat(bat.parts), mass: n * p.mass + bat.mass, cost: n * p.cost + bat.cost,
        funds: (st.status === 'buy' ? st.funds : 0) + bat.funds, needs: (st.status === 'research' ? [st.node] : []).concat(bat.needs), perPanel: per, generation: n * per,
        battery: bat.energy, notes: (sp.tracking ? 'tracks the sun' : sp.fixed ? 'fixed panel that gets ' + Math.round(sp.fixed * 100) + '% of the sun whichever way it points' : 'fixed panel (' + (prof.loc.type === 'landed' ? 'lying flat' : Math.round((P.orientation == null ? 0.5 : P.orientation) * 100) + '% facing the sun') + ')') + (p.mod ? '; mod part' : ''),
      });
    }
    // RTG: the same output day and night, anywhere
    for (const id of Object.keys(RTG)) {
      const p = partOf(id), st = status(id);
      if (st.status !== 'have' && !P.allowUnlock) continue;
      const n = Math.max(1, Math.ceil(need / RTG[id]));
      const bat = batteryFor(burst);
      if (!bat) continue;
      add({
        kind: 'rtg', parts: [{ id: id, n: n }].concat(bat.parts), mass: n * p.mass + bat.mass, cost: n * p.cost + bat.cost,
        funds: (st.status === 'buy' ? st.funds : 0) + bat.funds, needs: (st.status === 'research' ? [st.node] : []).concat(bat.needs), perPanel: RTG[id], generation: n * RTG[id],
        battery: bat.energy, notes: 'the same in darkness and far from the sun; never runs out in a game year' + (p.mod ? '; mod part (some mods let it decay over its half-life)' : ''),
      });
    }
    // fuel cells: independent of light, burn propellant
    const dens = (CD.resources.LiquidFuel || { density: 0.005 }).density;
    for (const id of Object.keys(CELLS)) {
      if ((!/^FuelCell/.test(id) && !(EXTRA && EXTRA.cells && EXTRA.cells[id])) || !CELLS[id].ec) continue;
      const c = CELLS[id], p = partOf(id), st = status(id);
      if (st.status !== 'have' && !P.allowUnlock) continue;
      const n = Math.max(1, Math.ceil(need / c.ec));
      const days = P.days || 30, secs = days * (Data.DAY || 21600);
      // mass of what burns: every input resource at its own density (the stock cells burn liquid fuel and oxidizer)
      const perSec = c.inputs ? Object.keys(c.inputs).reduce((q, r) => q + c.inputs[r] * ((CD.resources[r] || {}).density || 0), 0) : (c.lf + c.ox) * dens;
      const fuel = (avg / c.ec) * perSec * secs;
      add({
        kind: 'fuelcell', parts: [{ id: id, n: n }], mass: n * p.mass + fuel, cost: n * p.cost, funds: st.status === 'buy' ? st.funds : 0, needs: st.status === 'research' ? [st.node] : [],
        perPanel: c.ec, generation: n * c.ec, fuel: fuel, days: days, notes: fuel.toFixed(2) + ' t of ' + (c.inputs ? Object.keys(c.inputs).join(' + ') : 'liquid fuel and oxidizer') + ' for ' + days + ' days (tanks not counted)',
      });
    }
    // fission reactors (mods): output at full power; cooling and fuel are the mod's business
    for (const id of Object.keys(REACT)) {
      const p = partOf(id), st = status(id);
      if (st.status !== 'have' && !P.allowUnlock) continue;
      const n = Math.max(1, Math.ceil(need / REACT[id]));
      const bat = batteryFor(burst);
      if (!bat) continue;
      add({
        kind: 'reactor', parts: [{ id: id, n: n }].concat(bat.parts), mass: n * p.mass + bat.mass, cost: n * p.cost + bat.cost, funds: bat.funds, needs: bat.needs,
        perPanel: REACT[id], generation: n * REACT[id], battery: bat.energy, notes: 'mod reactor at full power; it needs its cooling system and fuel, which are not sized here',
      });
    }
    options.sort((a, b) => a.mass - b.mass);
    return { avg: avg, peak: peak, need: need, dark: dark, darkEnergy: eDark, burstEnergy: burst, options: options };
  }

  return { storedCatalogue: storedCatalogue, lightProfile: lightProfile, atmosphereFactor: atmosphereFactor, plateTemperature: plateTemperature, heatEfficiency: heatEfficiency, CONSTANTS: K, partStatus: partStatus, design: design, transmitEC: transmitEC, loadCatalogue: loadCatalogue, planetOf: planetOf, partOf: partOf };
});
