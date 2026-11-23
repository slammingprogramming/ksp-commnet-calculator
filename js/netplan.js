// SPDX-License-Identifier: AGPL-3.0-or-later
/* Network generator: describe what you want connected (stations, labs, bases, mines, rovers, aircraft), and it designs the relay
 * network, stage by stage if you like, with what your career has unlocked. Pure logic, no DOM.
 *
 * It does not simulate anything itself. Each stage is a call to the relay planner (js/planner.js) on a scenario made from the sites
 * plus the relays of the earlier stages, so every number is the same simulation the Relay planner tab runs. What this module adds:
 *   - which antennas the save has (tech researched + part bought), what the plan would need on top, and what that costs;
 *   - sites of several kinds, with a default antenna for each, roaming sites (rovers, aircraft) as spread-out sample points,
 *     and an optional terrain-shadow mask (the stock game has none; see sim.js);
 *   - placement advice: station orbits, base sites (terrain + how well they see the network), lander delta-v;
 *   - the money and science the network costs, and where to earn them. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./orbits.js'), require('./core.js'), require('./sim.js'), require('./planner.js'), require('./career.js'),
      require('./career-data.js'), require('./landing.js'), require('./mission.js'));
  } else root.KSPNetPlan = factory(root.KSPData, root.KSPOrbits, root.KSPCore, root.KSPSim, root.KSPPlanner, root.KSPCareer, root.KSPCareerData, root.KSPLanding, root.KSPMission);
})(typeof self !== 'undefined' ? self : this, function (Data, Orb, Core, Sim, Pl, Career, CD, Landing, Mission) {
  'use strict';

  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------- what a site is ---------- */

  /** where: orbit (a fixed orbit), landed (a fixed spot), roam (spread-out sample points: it moves). power: the antenna class it needs. */
  const KINDS = {
    orbiter: { label: 'Satellite or probe in orbit', where: 'orbit', power: 'heavy' },
    station: { label: 'Space station', where: 'orbit', power: 'heavy', crew: true },
    lab: { label: 'Orbital science lab', where: 'orbit', power: 'heavy', crew: true },
    base: { label: 'Land base', where: 'landed', power: 'medium', crew: true },
    mine: { label: 'Mining or refinery site', where: 'landed', power: 'medium' },
    lander: { label: 'Parked lander or science station', where: 'landed', power: 'medium' },
    rover: { label: 'Surface vehicles (they roam)', where: 'roam', power: 'light' },
    aircraft: { label: 'Aircraft and drones (they roam)', where: 'roam', power: 'light', flying: true },
  };
  /** Degrees above the local horizon a site needs to see its relay. Stock CommNet has no terrain occlusion at all (only whole bodies
   *  block, read from the game's code), so "open" is what the game does; the others design for mods and for margin. */
  const TERRAIN = { open: 0, rolling: 5, rugged: 15, crater: 30 };
  /** Weakest own antenna power (W) a class of vessel is given when the player does not choose one. */
  const POWER_NEED = { light: 5e5, medium: 2e9, heavy: 15e9 };

  /** The lightest antenna setup (one or two of one antenna) from `pool` whose own power reaches the class; the strongest if none does. */
  function loadout(kind, pool, rangeMod) {
    const need = POWER_NEED[(KINDS[kind] || KINDS.lander).power];
    const find = (id) => pool.find((a) => a.id === id);
    const cands = [];
    for (const a of pool) {
      if (a.builtin || a.ground || !(a.power > 0)) continue;
      for (let n = 1; n <= 2; n++) {
        if (n > 1 && !a.combinable) break;
        const setup = [{ id: a.id, count: n }];
        cands.push({ setup: setup, own: Core.vesselStats(setup, find, rangeMod).own, mass: a.mass * n, cost: a.cost * n });
      }
    }
    const ok = cands.filter((c) => c.own >= need).sort((x, y) => x.mass - y.mass || x.cost - y.cost);
    if (ok.length) return ok[0].setup;
    cands.sort((x, y) => y.own - x.own);
    return cands.length ? cands[0].setup : [];
  }

  /**
   * Sites -> simulator nodes (tracked). A site is {id, name, kind, body, stage, target (0..1, optional), antennas (optional),
   * terrain, and by kind: alt/inc/lan/phase (orbit) | lat/lon/alt (landed) | samples/latMax/cruise (roam)}.
   */
  function siteNodes(world, sites, pool, rangeMod, fallback) {
    const out = [];
    for (const s of sites) {
      const k = KINDS[s.kind], b = world.index.get(s.body);
      if (!k || !b || (k.where !== 'orbit' && Pl.isGas(b))) continue;       // nothing to stand on at a gas giant
      let ants = s.antennas && s.antennas.length ? clone(s.antennas) : loadout(s.kind, pool, rangeMod);
      if (!ants.length && fallback) ants = loadout(s.kind, fallback, rangeMod);          // nothing usable yet: the plan will say what to unlock
      const mask = TERRAIN[s.terrain] || 0;
      const base = { siteId: s.id, kind: s.kind, stage: s.stage || 1, tracked: true, antennas: ants };
      if (k.where === 'orbit') {
        const alt = s.alt > 0 ? s.alt : Math.max(world.altitudeLimits(s.body).min * 1.2, 50000);
        out.push(Object.assign({}, base, { id: s.id, name: s.name, loc: { type: 'orbit', body: s.body, orbit: Orb.orbitFromAltitudes(b, alt, alt, s.inc || 0, s.lan || 0, 0, s.phase || 0) } }));
      } else if (k.where === 'landed') {
        out.push(Object.assign({}, base, { id: s.id, name: s.name, mask: mask, loc: { type: 'landed', body: s.body, lat: s.lat || 0, lon: s.lon || 0, alt: s.alt || 0 } }));
      } else {
        const n = Math.max(2, Math.min(16, s.samples || 8)), lim = s.latMax == null ? 90 : s.latMax;
        Pl.surfaceSamples(n).forEach((p, i) => out.push(Object.assign({}, base, {
          id: s.id + ':' + (i + 1), name: s.name + ' ' + (i + 1) + '/' + n, mask: mask,
          loc: { type: 'landed', body: s.body, lat: (p.lat * lim) / 90, lon: p.lon, alt: k.flying ? (s.cruise || 5000) : 0 },
        })));
      }
    }
    return out;
  }

  /** Stage numbers by distance from home when the player has not chosen: the Kerbin system first, the inner and nearby planets next, the rest last. */
  function autoStage(world, bodyId) {
    let b = world.index.get(bodyId);
    if (!b) return 1;
    while (b.parentBody && b.parentBody.parentBody && !b.parentBody.star) b = b.parentBody;      // up to the planet
    if (b.id === 'Kerbin') return 1;
    const kerbin = world.index.get('Kerbin');
    const a = b.orbit ? b.orbit.a : 0, ak = kerbin && kerbin.orbit ? kerbin.orbit.a : 1;
    return a > 0 && a < ak * 2.3 ? 2 : 3;
  }

  /* ---------- what the career has ---------- */

  const norm = (id) => String(id).replace(/\./g, '_');
  const partOf = (a) => (a.parts || []).map((p) => CD.parts.find((x) => norm(x.id) === norm(p))).find(Boolean) || null;

  /**
   * For every antenna: have (usable now), buy (researched, not bought: entry price), research (tech node missing), or mod (no
   * stock tech: the player's own choice). state = Career state or null (everything counts as had).
   */
  function antennaStatus(state, antennas) {
    const done = state ? new Set(state.tech) : null, bought = state ? new Set(state.parts.map(norm)) : null;
    return antennas.map((a) => {
      if (!state || state.mode === 'sandbox' || a.builtin || a.ground) return { ant: a, status: 'have' };
      if (!a.tech) return { ant: a, status: a.pack === 'stock' || a.pack === 'bg' ? 'have' : 'mod' };
      if (!done.has(a.tech)) return { ant: a, status: 'research', node: a.tech };
      const part = partOf(a);
      const have = state.mode === 'science' || !part || (a.parts || []).some((p) => bought.has(norm(p)));
      return have ? { ant: a, status: 'have' } : { ant: a, status: 'buy', funds: part ? part.entry : 0 };
    });
  }

  /** What it takes to get these antennas: the tech nodes (research order, science) and the entry price of the parts not yet bought. */
  function unlockCost(state, antIds, antennas) {
    const sts = antennaStatus(state, antennas).filter((r) => antIds.indexOf(r.ant.id) >= 0 && (r.status === 'research' || r.status === 'buy'));
    const nodes = Array.from(new Set(sts.filter((r) => r.status === 'research').map((r) => r.node)));
    const plan = nodes.length ? Career.techPlan(state, nodes) : { rows: [], total: 0 };
    let funds = 0;
    for (const r of sts) { const part = partOf(r.ant); if (part) funds += part.entry; }
    return { antennas: sts.map((r) => r.ant.id), nodes: plan.rows.map((x) => ({ id: x.id, title: x.title, cost: x.cost })), science: plan.total, funds: funds };
  }

  /* ---------- cost of the relays ---------- */

  /** A plain relay satellite: a small probe core, a battery and two panels. Named parts from the game's data; the price is theirs,
   *  not a guess, but it leaves out the launch vehicle and fuel, which depend on how the player builds. */
  function busCost() {
    let sum = 0;
    for (const id of ['probeCoreOcto2_v2', 'batteryBankMini', 'solarPanels5', 'solarPanels5']) { const p = CD.parts.find((x) => x.id === id); sum += p ? p.cost : 0; }
    return sum || 2400;
  }
  function relayCost(nodes, lookup, bus) {
    let mass = 0, antenna = 0;
    for (const n of nodes) for (const a of n.antennas || []) { const r = lookup(a.id); if (r) { mass += (r.mass || 0) * a.count; antenna += (r.cost || 0) * a.count; } }
    return { count: nodes.length, antennaMass: mass, antennaFunds: antenna, busFunds: nodes.length * bus, funds: antenna + nodes.length * bus };
  }

  /* ---------- the generator ---------- */

  const worst = (res, names) => (res.sources.filter((s) => !names || names.has(s.name)).reduce((m, s) => Math.min(m, s.uptime), 1));
  const mean = (res) => (res.sources.length ? res.sources.reduce((q, s) => q + s.uptime, 0) / res.sources.length : 1);

  /**
   * P: { world, lookup, settings (sim settings), sites, mode: 'all' | 'stages', t0, horizon (s), target (0..1), minSignal (0..1),
   *      antennas (all antennas the user has switched on), career (state | null), dsnLevel (1..3), robust, limits, onPhase }
   * Generator: yields progress numbers; returns { stages: [...], totals, notes }.
   * Per stage: plan with what is unlocked; if tracked sites miss the target, plan again with every antenna and report what the plan
   * needs unlocked; if that is still short, try the next Tracking Station level.
   */
  function* planGen(P) {
    const world = P.world, lookup = P.lookup;
    const phase = (t) => { if (P.onPhase) P.onPhase(t); };
    const sites = (P.sites || []).filter((s) => KINDS[s.kind] && world.index.get(s.body) && (KINDS[s.kind].where === 'orbit' || !Pl.isGas(world.index.get(s.body))));
    if (!sites.length) return { error: 'Add at least one site.', stages: [], totals: null };
    const maxStage = P.mode === 'stages' ? Math.max.apply(null, sites.map((s) => s.stage || 1)) : 1;
    const target = P.target == null ? 0.995 : P.target;
    const bus = busCost();
    const career = P.career ? clone(P.career) : null;
    const rangeMod = P.settings.rangeMod == null ? 1 : P.settings.rangeMod;
    const all = P.antennas || Data.antennas.filter((a) => a.pack === 'stock');
    let built = [];                                      // relays of earlier stages, kept as they are
    let dsnLevel = P.dsnLevel || 1;
    const stages = [];
    const unlocked = new Set();
    let spentFunds = 0, spentScience = 0;

    for (let st = 1; st <= maxStage; st++) {
      const active = P.mode === 'stages' ? sites.filter((s) => (s.stage || 1) <= st) : sites;
      if (P.mode === 'stages' && !sites.some((s) => (s.stage || 1) === st)) continue;
      phase('Stage ' + st + ': working out what you can use');
      const stat = antennaStatus(career, all);
      const have = stat.filter((r) => r.status === 'have' || r.status === 'mod' || unlocked.has(r.ant.id)).map((r) => r.ant);
      const nodes = siteNodes(world, active, have, rangeMod, all)
        .concat(built.map((n) => Object.assign(clone(n), { planned: false, tracked: false, existing: true, group: 'built:' + n.group })));
      const names = new Set(nodes.filter((n) => n.tracked).map((n) => n.name));
      const targets = {};
      for (const s of active) {
        if (s.target > 0) for (const n of nodes) if (n.siteId === s.id) targets[n.name] = s.target;
      }
      const run = (pool, settings) => Pl.planGen({
        world: world, lookup: lookup, settings: settings, nodes: nodes, t0: P.t0, horizon: P.horizon, target: target, minSignal: P.minSignal,
        pool: pool, robust: P.robust !== false, limits: P.limits || {}, targets: targets, onPhase: (t) => phase('Stage ' + st + ': ' + t),
      });
      const met = (plan) => plan.final.sources.every((s) => !names.has(s.name) || s.uptime >= (targets[s.name] || target) - 0.002);
      let plan = yield* run(have, P.settings);
      if (plan.error) return { error: plan.error, stages: stages, totals: null };
      let usedPool = have, settings = P.settings, upgrade = null, dsn = null, ok = met(plan);
      // antennas the plan (or a site the player gave an antenna) uses that the career cannot build yet; the relay planner falls back
      // to a heavy relay when the pool holds none, so a plan can be "met" and still be unbuildable
      const outside = (pl) => Array.from(new Set(pl.planned.concat(nodes.filter((n) => n.tracked)).reduce((q, n) => q.concat((n.antennas || []).map((a) => a.id)), []))).filter((id) => !have.some((a) => a.id === id) && !lookup(id).builtin);

      if (career && have.length < all.length && (!ok || outside(plan).length)) {
        phase('Stage ' + st + ': checking what unlocking more would give');
        const richer = yield* run(all, settings);
        if (!richer.error && (outside(plan).length || met(richer) || worst(richer.final) > worst(plan.final) + 0.001)) {
          upgrade = unlockCost(career, outside(richer), all);
          if (!upgrade.antennas.length) upgrade = null;
          plan = richer; usedPool = all; ok = met(plan);
        }
      }
      if (!ok && dsnLevel < 3) {
        const next = Data.DSN_LEVELS.find((l) => l.level === dsnLevel + 1);
        if (next) {
          phase('Stage ' + st + ': checking a Tracking Station upgrade');
          const s2 = Object.assign({}, P.settings, { dsnPower: P.settings.dsnPower * (next.power / (Data.DSN_LEVELS.find((l) => l.level === dsnLevel).power || next.power)) });
          const better = yield* run(usedPool, s2);
          if (!better.error && (met(better) || worst(better.final) > worst(plan.final) + 0.001)) {
            dsn = { from: dsnLevel, to: dsnLevel + 1, funds: career ? Career.upgradeCost('TrackingStation', dsnLevel) : null };
            plan = better; settings = s2; ok = met(plan);
          }
        }
      }
      if (dsn) dsnLevel = dsn.to;
      if (upgrade) {
        upgrade.antennas.forEach((id) => unlocked.add(id));
        if (career) {
          upgrade.nodes.forEach((n) => { if (career.tech.indexOf(n.id) < 0) career.tech.push(n.id); });
          partsOfAntennas(upgrade.antennas, all).forEach((p) => { if (career.parts.indexOf(p) < 0) career.parts.push(p); });
        }
      }
      const planned = plan.planned.map((n) => Object.assign(clone(n), { stage: st }));
      const cost = relayCost(planned, lookup, bus);
      const unlockFunds = (upgrade ? upgrade.funds : 0) + (dsn && dsn.funds ? dsn.funds : 0);
      spentFunds += cost.funds + unlockFunds; spentScience += upgrade ? upgrade.science : 0;
      const per = active.map((s) => {
        const ns = nodes.filter((n) => n.siteId === s.id);
        const ups = plan.final.sources.filter((x) => ns.some((n) => n.name === x.name));
        const goal = s.target > 0 ? s.target : target;
        const u = ups.length ? Math.min.apply(null, ups.map((x) => x.uptime)) : null;
        return { site: s, uptime: u, mean: ups.length ? ups.reduce((q, x) => q + x.uptime, 0) / ups.length : null, goal: goal, met: u !== null && u >= goal - 0.002,
          longest: ups.reduce((m, x) => Math.max(m, x.longestBlackout || 0), 0) };
      });
      stages.push({
        stage: st, sites: active.filter((s) => P.mode !== 'stages' || (s.stage || 1) === st).map((s) => s.id), plan: plan, planned: planned, cost: cost, upgrade: upgrade, dsn: dsn,
        ok: ok, worst: worst(plan.final, names), mean: mean(plan.final), per: per, usedAll: usedPool === all && career !== null && have.length < all.length,
        funds: cost.funds + unlockFunds, science: upgrade ? upgrade.science : 0, causes: plan.baselineCauses, advice: plan.advice,
      });
      built = built.concat(planned.map((n) => Object.assign(clone(n), { stage: st })));
      yield st / maxStage;
    }
    return { stages: stages, totals: { funds: spentFunds, science: spentScience, relays: built.length, worstStage: Math.min.apply(null, stages.map((x) => x.worst)) }, relays: built, bus: bus };
  }

  function partsOfAntennas(ids, antennas) {
    const out = [];
    for (const id of ids) { const a = antennas.find((x) => x.id === id); if (a) (a.parts || []).forEach((p) => out.push(p)); }
    return out;
  }

  /** Surface relays: for sites that still miss their target because of the terrain mask, high ground nearby where a relay lander would see more sky. */
  function highGround(bodyId, lat, lon, km) {
    if (!Landing.has(bodyId)) return [];
    const r = Landing.find(bodyId, { landTilt: 15, stayTilt: 8, share: 0.3, rank: 'high', count: 3, near: { lat: lat, lon: lon, km: km || 150 }, spacingKm: 40 });
    return r.rows.map((x) => ({ lat: x.lat, lon: x.lon, alt: x.alt, biome: x.biome }));
  }

  /* ---------- placement advice ---------- */

  /**
   * Orbits worth putting a station or lab on around a body. For each: altitude, inclination, the body's science multiplier there
   * (low space vs high space differ per body), the orbital period, and the delta-v of landing from it and getting back up (null where
   * there is no default: thick atmospheres). baseLats: latitudes (degrees) of the bases to serve, to match the inclination.
   */
  function stationOptions(world, bodyId, baseLats) {
    const b = world.index.get(bodyId);
    if (!b) return [];
    const lim = world.altitudeLimits(bodyId), sc = CD.bodyScience[bodyId];
    const spaceAlt = sc ? sc.spaceAltitude : null;
    const round5 = (x) => Math.ceil(x / 5000) * 5000;
    const alts = [];
    if (spaceAlt === null || lim.min * 1.2 < spaceAlt) alts.push({ alt: round5(lim.min * 1.2), band: 'low' });
    if (spaceAlt !== null && spaceAlt * 1.05 < lim.max * 0.5) alts.push({ alt: round5(spaceAlt * 1.05), band: 'high' });
    const lat = (baseLats || []).reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    const incs = [];
    if (lat > 3) incs.push({ inc: Math.round(lat), why: 'passes over your base latitude: no plane change to land there' });
    incs.push({ inc: 0, why: 'equatorial: cheapest to reach from a low-latitude launch and to meet' });
    incs.push({ inc: 90, why: 'polar: the whole surface passes below, so every biome can be reached' });
    const out = [];
    for (const a of alts) for (const i of incs) {
      const km = a.alt / 1000;
      const down = Mission.leg(world, { type: 'land', body: bodyId, alt: km, chutes: b.hasAtmo }, 0), up = Mission.leg(world, { type: 'ascent', body: bodyId, alt: km }, 0);
      out.push({
        body: bodyId, alt: a.alt, inc: i.inc, band: a.band, multiplier: sc ? (a.band === 'low' ? sc.spaceLow : sc.spaceHigh) : null, why: i.why,
        period: 2 * Math.PI * Math.sqrt(Math.pow(b.radius + a.alt, 3) / b.gm), dvDown: down.error ? null : down.dv, dvUp: up.error ? null : up.dv,
      });
    }
    return out;
  }

  /** Delta-v and propellant for a reusable lander from a station orbit: down, back up, the propellant share of its mass, and the ore
   *  that refills it (ISRU: 0.5 ore/s make 0.45 liquid fuel + 0.55 oxidizer, both read from the game's ISRU part; ore, fuel and oxidizer
   *  weigh the same per unit pair, so a tonne of ore makes a tonne of propellant). */
  function landerBudget(world, bodyId, altM, opts) {
    opts = opts || {};
    const km = altM / 1000, isp = opts.isp || 345, g0 = Data.G0;
    const b = world.index.get(bodyId);
    const down = Mission.leg(world, { type: 'land', body: bodyId, alt: km, chutes: b && b.hasAtmo }, 0), up = Mission.leg(world, { type: 'ascent', body: bodyId, alt: km }, 0);
    if (down.error || up.error) return { error: down.error || up.error };
    const frac = (dv) => 1 - Math.exp(-dv / (isp * g0));
    const upProp = frac(up.dv), tripProp = frac(down.dv + up.dv);
    const dry = opts.dry == null ? 5 : opts.dry;                                   // tonnes
    const propFor = (dv) => dry * (Math.exp(dv / (isp * g0)) - 1);                 // tonnes of propellant for a lander with that dry mass
    return {
      dvDown: down.dv, dvUp: up.dv, dvTrip: down.dv + up.dv, isp: isp, dry: dry,
      propDown: propFor(down.dv), propUp: propFor(up.dv), propTrip: propFor(down.dv + up.dv), shareUp: upProp, shareTrip: tripProp,
      oreForUp: propFor(up.dv) / CD.resources.Ore.density,                             // ore units (0.01 t each)
      refuelHours: propFor(up.dv) / CD.resources.Ore.density / (0.5 * 3600),            // one large ISRU running at 0.5 ore/s, with enough ore
    };
  }

  /**
   * Candidate base or mine sites on a body: the flattest ground with biome variety (Landing.find), each scored for how well it sees
   * the network with the relays you give (or none: just the DSN), and for how cheap it is to reach from orbit (low latitude).
   * Generator. P: {world, lookup, settings, relays (nodes), t0, minSignal, power (own antenna power), purpose: 'base'|'mine'|'rover'}
   */
  function* baseCandidates(P, bodyId, opt) {
    opt = opt || {};
    if (!Landing.has(bodyId)) return { error: 'No terrain data for ' + bodyId, rows: [] };
    const found = Landing.find(bodyId, { landTilt: opt.landTilt == null ? 10 : opt.landTilt, stayTilt: opt.stayTilt == null ? 5 : opt.stayTilt, share: 0.5, rank: 'flat', count: 14, varietyKm: opt.varietyKm || 80, spacingKm: opt.spacingKm || 0, maxLat: opt.maxLat == null ? 90 : opt.maxLat, biomes: opt.biomes || [], avoid: opt.avoid || [] });
    if (!found.rows.length) return { rows: [], matches: 0 };
    const b = P.world.index.get(bodyId);
    const nodes = (P.relays || []).map((n) => Object.assign(clone(n), { tracked: false, planned: false }));
    found.rows.forEach((r, i) => nodes.push({
      id: 'cand:' + i, name: 'candidate ' + i, tracked: true, loc: { type: 'landed', body: bodyId, lat: r.lat, lon: r.lon, alt: 0 }, antennas: [], powerOverride: { own: P.power || 2e9, relay: P.power || 2e9 },
    }));
    const sim = Sim.createSim({ world: P.world, lookup: P.lookup, settings: Object.assign({}, P.settings, { minSignal: P.minSignal || 0 }), nodes: nodes, trajectory: { t0: P.t0, horizon: 30 * Data.DAY } });
    const dt = Math.max(60, sim.suggestStep(12));
    const span = Math.min(20 * Data.DAY, Math.max(2 * Data.DAY, (b.rotPeriod || Data.DAY) * 1.05));
    const res = yield* Pl.runScan(sim, P.t0, P.t0 + span, dt, true);
    const rows = found.rows.map((r, i) => {
      const link = (res.sources.find((s) => s.name === 'candidate ' + i) || { uptime: 0 }).uptime;
      const flat = r.stayShare === null ? 0.5 : r.stayShare;
      const access = 1 - Math.min(1, Math.abs(r.lat) / 90);
      const variety = Math.min(1, r.variety / 6);
      const w = opt.weights || { link: 0.35, flat: 0.3, access: 0.15, variety: 0.2 };
      return Object.assign({}, r, { link: link, access: access, score: w.link * link + w.flat * flat + w.access * access + w.variety * variety });
    }).sort((x, y) => y.score - x.score);
    return { rows: rows, matches: found.matches, hasHeight: found.hasHeight };
  }

  /* ---------- earning the money and the science ---------- */

  /**
   * Bodies ranked by the science a landing there is worth against the delta-v it takes (arrive in orbit, land, get back up).
   * state: Career state (for the bodies' multipliers it needs none; it marks nothing). Synchronous; the planets run a real window search.
   */
  function earnTable(world, bodyIds, ut) {
    const rows = [];
    for (const id of bodyIds) {
      const b = world.index.get(id);
      if (!b || b.star || !CD.bodyScience[id]) continue;
      const sci = Career.scienceTable(id, Landing.biomeCount(id) || 1);
      if (!sci.length) continue;
      const total = sci.reduce((q, r) => q + r.cap * r.subjects, 0);
      const first = sci.reduce((q, r) => q + r.first * r.subjects, 0);
      const parent = b.parentBody;
      const legs = [];
      if (parent && parent.id === 'Kerbin') legs.push({ type: 'transfer', from: 'Kerbin', to: id, park: 100, capture: 30 });
      else if (parent && parent.parentBody && parent.parentBody.star) {
        legs.push({ type: 'transfer', from: 'Kerbin', to: parent.id, park: 100, capture: 100 });
        legs.push({ type: 'transfer', from: parent.id, to: id, park: 100, capture: 30 });
      } else if (parent && parent.star) legs.push({ type: 'transfer', from: 'Kerbin', to: id, park: 100, capture: 30 });
      else continue;
      legs.push({ type: 'land', body: id, alt: 30, chutes: b.hasAtmo });
      // thick atmospheres have no default ascent allowance (nobody can say without flying it): price the trip down only and say so
      const withUp = legs.concat([{ type: 'ascent', body: id, alt: 30 }]);
      let plan = Mission.plan(world, withUp, ut || 0), partial = false;
      if (plan.error && /ascent/.test(plan.error)) { plan = Mission.plan(world, legs, ut || 0); partial = true; }
      if (plan.error) { rows.push({ body: id, first: first, total: total, dv: null, error: plan.error, subjects: sci.length }); continue; }
      rows.push({ body: id, first: first, total: total, dv: plan.total, days: plan.duration / Data.DAY, perKms: first / (plan.total / 1000), subjects: sci.length, legs: plan.legs, partial: partial });
    }
    // trips priced without the ascent (thick atmospheres) cost less than they should, so they rank after the complete ones
    return rows.sort((a, c) => (a.partial ? 1 : 0) - (c.partial ? 1 : 0) || (c.perKms || 0) - (a.perKms || 0));
  }

  /** What a plan costs against what the career holds: funds and science, and what is short. */
  function fundingCheck(state, result) {
    const have = state || { funds: 0, sci: 0 };
    const funds = result.totals.funds, sci = result.totals.science;
    return { funds: funds, science: sci, haveFunds: have.funds, haveScience: have.sci, shortFunds: Math.max(0, funds - have.funds), shortScience: Math.max(0, sci - have.sci) };
  }

  return {
    KINDS: KINDS, TERRAIN: TERRAIN, POWER_NEED: POWER_NEED, loadout: loadout, siteNodes: siteNodes, autoStage: autoStage,
    antennaStatus: antennaStatus, unlockCost: unlockCost, busCost: busCost, relayCost: relayCost, planGen: planGen, runSync: Pl.runSync,
    highGround: highGround, stationOptions: stationOptions, landerBudget: landerBudget, baseCandidates: baseCandidates, earnTable: earnTable, fundingCheck: fundingCheck,
  };
});
