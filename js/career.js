// SPDX-License-Identifier: AGPL-3.0-or-later
/* Career planning: state, facilities, tech tree, finance and science. Pure logic, no DOM.
 *
 * Numbers come from career-data.js (read from KSP 1.12.5: tech tree, part prices, facility upgrade prices and limits, difficulty
 * presets, recovery rules, body science multipliers). A career state is a plain object so it can live in localStorage:
 *   { mode, preset, diff:{startFunds, gain:[funds, science, rep], loss:[funds, rep], repLossDeclined}, funds, sci, rep,
 *     facilities:{LaunchPad:1..3, ...}, tech:[node ids], parts:[bought part ids], contracts:[], strategies:[], ut } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./career-data.js'));
  else root.KSPCareer = factory(root.KSPCareerData);
})(typeof self !== 'undefined' ? self : this, function (CD) {
  'use strict';

  const FACILITIES = [
    { id: 'LaunchPad', name: 'Launch Pad' }, { id: 'Runway', name: 'Runway' },
    { id: 'VehicleAssemblyBuilding', name: 'Vehicle Assembly Building' }, { id: 'SpaceplaneHangar', name: 'Spaceplane Hangar' },
    { id: 'TrackingStation', name: 'Tracking Station' }, { id: 'AstronautComplex', name: 'Astronaut Complex' },
    { id: 'MissionControl', name: 'Mission Control' }, { id: 'ResearchAndDevelopment', name: 'Research & Development' },
    { id: 'Administration', name: 'Administration' },
  ];
  const facName = (id) => (FACILITIES.find((f) => f.id === id) || { name: id }).name;
  const nodes = {};
  for (const t of CD.tech) nodes[t.id] = t;
  const children = {};
  for (const t of CD.tech) for (const p of t.parents) (children[p] = children[p] || []).push(t.id);
  const partById = {};
  for (const p of CD.parts) partById[p.id] = p;
  const partsByTech = {};
  for (const p of CD.parts) if (p.tech) (partsByTech[p.tech] = partsByTech[p.tech] || []).push(p);

  // ---- state ---------------------------------------------------------------------------------------------------
  function newState(preset) {
    const d = CD.difficulty[preset] || CD.difficulty.normal;
    const fac = {};
    for (const f of FACILITIES) fac[f.id] = 1;
    return {
      mode: 'career', preset: CD.difficulty[preset] ? preset : 'normal',
      diff: { startFunds: d.startFunds, gain: d.gain.slice(), loss: d.loss.slice(), repLossDeclined: d.repLossDeclined },
      funds: d.startFunds, sci: 0, rep: 0, facilities: fac, tech: ['start'], parts: [], contracts: [], strategies: [], progress: [], ut: 0,
    };
  }

  /** State from Parsers.parseCareer(). Sandbox saves have everything unlocked and no money. */
  function fromSave(c) {
    const s = newState('normal');
    s.mode = /SANDBOX/i.test(c.mode) ? (/SCIENCE/i.test(c.mode) ? 'science' : 'sandbox') : 'career';
    if (c.difficulty) {
      s.diff = { startFunds: c.difficulty.startFunds, gain: c.difficulty.gain.map((x) => (x === undefined ? 1 : x)), loss: c.difficulty.loss.map((x) => (x === undefined ? 1 : x)), repLossDeclined: c.difficulty.repLossDeclined === undefined ? 1 : c.difficulty.repLossDeclined };
      s.preset = 'custom';
      for (const k of Object.keys(CD.difficulty)) {
        const d = CD.difficulty[k];
        if (d.startFunds === s.diff.startFunds && d.gain.every((x, i) => x === s.diff.gain[i]) && d.loss.every((x, i) => x === s.diff.loss[i])) s.preset = k;
      }
    }
    if (c.funds !== null) s.funds = c.funds;
    if (c.sci !== null) s.sci = c.sci;
    if (c.rep !== null) s.rep = c.rep;
    for (const f of FACILITIES) s.facilities[f.id] = s.mode === 'sandbox' ? 3 : (c.facilities[f.id] || 1);
    s.tech = c.tech.length ? c.tech.slice() : (s.mode === 'sandbox' ? CD.tech.map((t) => t.id) : ['start']);
    s.parts = c.parts.slice();
    s.contracts = c.contracts.slice();
    s.strategies = c.strategies.slice();
    s.progress = (c.progress || []).slice();
    if (c.ut !== null) s.ut = c.ut;
    return s;
  }

  // ---- facilities ----------------------------------------------------------------------------------------------
  const INF = 'unlimited';
  const fmtN = (x, unit) => (x === null ? INF : x + (unit || ''));
  /** What a facility allows at a level (1..3): list of [label, value]. */
  function effects(id, level) {
    const f = CD.facilities[id] || {};
    const i = Math.max(0, Math.min(2, level - 1));
    const out = [];
    if (f.massLimit) out.push(['Launch mass limit', fmtN(f.massLimit[i], ' t')]);
    if (f.partLimit) out.push(['Parts per vessel', fmtN(f.partLimit[i])]);
    if (f.contracts) out.push(['Active contracts', fmtN(f.contracts[i])]);
    if (f.flightPlanning) out.push(['Flight planning', f.flightPlanning[i] ? 'yes' : 'no']);
    if (f.strategies) out.push(['Active strategies', fmtN(f.strategies[i])]);
    if (f.commit) out.push(['Strategy commitment up to', Math.round(f.commit[i] * 100) + '%']);
    if (f.crew) out.push(['Active kerbals', fmtN(f.crew[i])]);
    if (f.tracked) out.push(['Tracked objects', f.tracked[i] === 0 ? 'none' : fmtN(f.tracked[i])]);
    if (f.patches) out.push(['Conic patches shown', f.patches[i] === 0 ? 'none' : f.patches[i] === 'all' ? 'all' : String(f.patches[i])]);
    if (f.maneuverTool) out.push(['Maneuver tool', f.maneuverTool[i] ? 'yes' : 'no']);
    if (f.scienceCostLimit) out.push(['Research nodes up to', fmtN(f.scienceCostLimit[i], ' science')]);
    if (f.dataRatio) out.push(['Data-to-science ratio', Math.round(f.dataRatio[i] * 100) + '%']);
    return out;
  }
  const upgradeCost = (id, level) => ((CD.facilities[id] || {}).up || [])[level - 1] || null;     // price of the step level -> level + 1
  function facilityTable(state) {
    return FACILITIES.map((f) => {
      const level = state.facilities[f.id] || 1;
      const next = level < 3 ? upgradeCost(f.id, level) : null;
      let toMax = 0;
      for (let l = level; l < 3; l++) toMax += upgradeCost(f.id, l) || 0;
      return { id: f.id, name: f.name, level: level, nextCost: next, toMax: toMax, now: effects(f.id, level), after: level < 3 ? effects(f.id, level + 1) : null };
    });
  }

  // ---- tech tree -----------------------------------------------------------------------------------------------
  const done = (state) => new Set(state.tech);
  /** Can this node be researched right now (parents done: all of them, or any one if the node says so)? */
  function available(state, id) {
    const n = nodes[id], have = done(state);
    if (!n || have.has(id)) return false;
    if (!n.parents.length) return true;
    return n.any ? n.parents.some((p) => have.has(p)) : n.parents.every((p) => have.has(p));
  }
  /** Research order to reach the goal nodes: every missing prerequisite, cheapest route when a node needs only one of several
   *  parents, listed so that each node comes after its parents. */
  function techPlan(state, goals, opts) {
    opts = opts || {};
    const have = done(state);
    const need = new Set();
    const costToReach = (id, seen) => {
      if (have.has(id)) return 0;
      const n = nodes[id];
      if (!n) return 0;
      if (!n.parents.length) return n.cost;
      const sub = n.parents.map((p) => costToReach(p, seen));
      return n.cost + (n.any ? Math.min.apply(null, sub) : sub.reduce((a, b) => a + b, 0));
    };
    const add = (id) => {
      if (have.has(id) || need.has(id) || !nodes[id]) return;
      need.add(id);
      const n = nodes[id];
      if (!n.parents.length) return;
      if (n.any && !n.parents.some((p) => have.has(p) || need.has(p))) {
        let best = null, bc = Infinity;
        for (const p of n.parents) { const c = costToReach(p); if (c < bc) { bc = c; best = p; } }
        add(best);
      } else if (!n.any) for (const p of n.parents) add(p);
    };
    for (const g of goals) add(g);
    // order: repeatedly take the cheapest node whose needed parents are done
    const order = [];
    const left = new Set(need);
    const got = new Set(have);
    while (left.size) {
      let pick = null;
      for (const id of left) {
        const n = nodes[id];
        const ok = n.any ? (!n.parents.length || n.parents.some((p) => got.has(p))) : n.parents.every((p) => got.has(p));
        if (ok && (!pick || n.cost < nodes[pick].cost || (n.cost === nodes[pick].cost && n.tier < nodes[pick].tier))) pick = id;
      }
      if (!pick) break;
      left.delete(pick); got.add(pick); order.push(pick);
    }
    const cap = (CD.facilities.ResearchAndDevelopment || {}).scienceCostLimit;
    const limit = opts.rdLevel && cap ? cap[opts.rdLevel - 1] : null;
    let cum = 0;
    const rows = order.map((id) => {
      cum += nodes[id].cost;
      const parts = partsByTech[id] || [];
      return {
        id: id, title: nodes[id].title, cost: nodes[id].cost, cum: cum, parts: parts.length, partFunds: parts.reduce((a, p) => a + p.entry, 0),
        blocked: limit !== null && limit !== undefined && nodes[id].cost > limit,
      };
    });
    return { rows: rows, total: cum, funds: rows.reduce((a, r) => a + r.partFunds, 0), missing: left.size };
  }
  /** Nodes that can be researched now. */
  function researchable(state) {
    return CD.tech.filter((t) => available(state, t.id)).map((t) => ({ id: t.id, title: t.title, cost: t.cost, parts: (partsByTech[t.id] || []).length }));
  }
  /** The research and purchases a craft needs: tech nodes not yet done and the entry price of every part not yet bought. */
  function craftNeeds(state, craft) {
    const norm = (id) => String(id).replace(/./g, '_');      // saves write mk1pod.v2, the part configs mk1pod_v2
    const have = done(state), bought = new Set(state.parts.map(norm));
    const nodesNeeded = new Set(), buy = {};
    let funds = 0;
    const unknown = [];
    for (const p of craft.parts) {
      if (!p.db) continue;
      if (p.db.tech && p.db.tech !== 'Unresearchable' && !have.has(p.db.tech)) nodesNeeded.add(p.db.tech);
      if (!bought.has(norm(p.db.id)) && p.db.entry > 0 && !buy[p.db.id]) { buy[p.db.id] = p.db; funds += p.db.entry; }
      if (p.db.tech === 'Unresearchable') unknown.push(p.db.id);
    }
    return { nodes: [...nodesNeeded], buy: Object.values(buy), buyFunds: funds, unresearchable: unknown };
  }

  // ---- finance -------------------------------------------------------------------------------------------------
  const KERBIN_RADIUS = 600000;
  /** Share of a recovered vessel's value that comes back: 100% on the pad or runway, 98% elsewhere at the space centre, and between
   *  98% and 10% by how far (great-circle, metres) the landing is from it (VesselRecovery.OnVesselRecovered). */
  function recoveryFactor(where, distanceKm) {
    const v = CD.vars.recovery;
    if (where === 'pad') return v.pad;
    if (where === 'ksc') return v.ksc;
    const t = Math.max(0, Math.min(1, (distanceKm * 1000) / (Math.PI * KERBIN_RADIUS)));
    return v.max + (v.min - v.max) * t;
  }
  /** Funds change of a mission from the plan: launch cost out, recovery, contract advances and rewards in. */
  function missionFinance(state, m) {
    const out = [];
    const loss = state.diff.loss[0];
    if (m.cost) out.push({ label: 'Launch (rocket)', funds: -m.cost, kind: 'launch', day: m.day || 0 });
    if (m.recovery) out.push({ label: 'Recovery', funds: m.recovery, kind: 'recovery', day: (m.day || 0) + (m.duration || 0) });
    for (const c of m.contracts || []) {
      if (c.advance) out.push({ label: c.label + ' (advance)', funds: c.advance, kind: 'contract', day: c.acceptDay === undefined ? (m.day || 0) : c.acceptDay });
      out.push({ label: c.label + ' (reward)', funds: c.reward, sci: c.sci || 0, rep: c.rep || 0, kind: 'contract', day: (m.day || 0) + (m.duration || 0) });
    }
    return { items: out, net: out.reduce((a, x) => a + x.funds, 0), loss: loss };
  }
  /** Running balance of a list of dated items; where the money runs out; the lowest point. */
  function forecast(state, items) {
    const sorted = items.slice().sort((a, b) => a.day - b.day);
    let funds = state.funds, sci = state.sci, rep = state.rep, low = funds, lowDay = 0, firstShort = null;
    const rows = sorted.map((x) => {
      funds += x.funds || 0; sci += x.sci || 0; rep += x.rep || 0;
      if (funds < low) { low = funds; lowDay = x.day; }
      if (funds < 0 && firstShort === null) firstShort = x.day;
      return Object.assign({}, x, { balance: funds, sciBalance: sci, repBalance: rep });
    });
    return { rows: rows, end: { funds: funds, sci: sci, rep: rep }, low: low, lowDay: lowDay, firstShort: firstShort };
  }
  /** Rough contract value from the base table: base x prestige x the difficulty gain (the real offer varies with the target body). */
  function contractEstimate(state, type, prestige) {
    const c = CD.contracts[type];
    if (!c) return null;
    const p = CD.vars.prestige[prestige || 'trivial'] || 1;
    const g = state.diff.gain;
    return { advance: Math.round(c.funds.advance * p * g[0]), reward: Math.round(c.funds.reward * p * g[0]), sci: Math.round(c.sci * g[1] * 10) / 10, rep: Math.round(c.rep.reward * g[2] * 10) / 10 };
  }

  // ---- science -------------------------------------------------------------------------------------------------
  const SITUATIONS = [
    ['landed', 'Landed', 1], ['splashed', 'Splashed', 2], ['flyingLow', 'Flying low', 4], ['flyingHigh', 'Flying high', 8],
    ['spaceLow', 'In space, low', 16], ['spaceHigh', 'In space, high', 32],
  ];
  /** Science one experiment is worth in a situation at a body: the first return and the cap for that subject (a biome counts as its own subject). */
  function experimentValue(expId, body, situation) {
    const e = CD.experiments[expId], b = CD.bodyScience[body];
    if (!e || !b) return null;
    const s = SITUATIONS.find((x) => x[0] === situation);
    if (!s || !(e.sit & s[2])) return null;
    if (e.atmo && (!hasAtmosphere(body) || situation === 'spaceLow' || situation === 'spaceHigh')) return null;
    const mult = b[situation];
    return { first: e.base * mult, cap: e.cap * mult, multiplier: mult, title: e.title };
  }
  const hasAtmosphere = (body) => ['Kerbin', 'Eve', 'Duna', 'Jool', 'Laythe'].indexOf(body) >= 0;
  /** Every (experiment, situation) at a body with its value, best first. */
  function scienceTable(body, nBiomes) {
    const rows = [];
    for (const id of Object.keys(CD.experiments)) {
      if (/^(asteroid|comet)/.test(id)) continue;                  // samples of asteroids and comets, not of a planet
      for (const s of SITUATIONS) {
        const v = experimentValue(id, body, s[0]);
        if (v && v.cap > 0) {
          const bio = !!(CD.experiments[id].biome & s[2]);
          rows.push({ id: id, title: v.title || id, situation: s[1], key: s[0], first: v.first, cap: v.cap, multiplier: v.multiplier, biomeDependent: bio, subjects: bio && nBiomes ? nBiomes : 1 });
        }
      }
    }
    return rows.sort((a, b) => b.cap - a.cap);
  }

  // ---- Breaking Ground deployed science ---------------------------------------------------------------------------
  // Read from the game (Expansions.Serenity.DeployedScience, ModuleGroundExperiment, ModuleInventoryPart; docs/RESEARCH.md
  // section 8). Every instrument of one kind on one body feeds ONE subject (no biome, situation landed), worth the body's landed
  // multiplier; per hour an instrument makes base x multiplier x rate/100 x share x power, until the subject holds its cap
  // (instrument cap x multiplier). R&D credits it times the difficulty's science gain.
  const DEPLOY_RATE_DEFAULT = 5;   // ModuleGroundExperiment's constructor: ScienceModifierRate = 5 unless a scientist set it down
  const pick = (list, level) => list[Math.min(Math.max(0, level), list.length - 1)];   // ExperienceTrait.CrewMemberExperienceLevel
  /** ScienceModifierRate (per cent) of an instrument set down by a scientist of `level` 0..5 on EVA, or by anyone else (null or < 0). */
  function deployRate(level) {
    const m = CD.deployed && CD.deployed.expSkill;
    return level === null || level === undefined || level < 0 || !m || !m.length ? DEPLOY_RATE_DEFAULT : pick(m, level) * 100;
  }
  /** Extra power units a solar panel or RTG makes when an engineer of `level` sets it down (0 for level 0 or anyone else). */
  function engineerBonus(level) {
    const m = CD.deployed && CD.deployed.powerSkill;
    return level > 0 && m && m.length ? pick(m, level) : 0;
  }
  /** The diminishing-returns share for n instruments of one kind on one body (DeployedScience.GetDiminishingReturnsMultiplier):
   *  the exact entry for n, else the last entry below n, else 1. */
  function diminishing(n) {
    let v = 1, exact = false;
    for (const e of (CD.deployed && CD.deployed.returns) || []) {
      if (e[0] > n) continue;
      if (e[0] === n) { exact = true; v = e[1]; } else if (!exact) v = e[1];
    }
    return v;
  }
  /** Science from deployed instruments on a body. `units` lists every instrument: [{id, level}] (level = the scientist who set it
   *  down, null for anyone else). `opts.power`: 1 = power covers the need, 0.5 = solar panels only while the station is not
   *  loaded (the game halves the rate then), 0 = not enough power. `opts.gain` = the difficulty's science gain.
   *  In each kind the instrument with the highest rate runs at full share and every other one at diminishing(count)
   *  (DeployedScience.SetDiminishingScienceRate). The seismometer earns from impacts (seismicImpact), so here it has a cap but no hourly rate. */
  function deployedScience(body, units, opts) {
    const D = CD.deployed, b = CD.bodyScience[body];
    opts = opts || {};
    const power = opts.power === undefined ? 1 : opts.power, gain = opts.gain === undefined ? 1 : opts.gain;
    const mult = b ? b.landed : 1, atmo = hasAtmosphere(body);
    const rows = [];
    let perHour = 0, total = 0;
    for (const id of Object.keys((D && D.instruments) || {})) {
      const e = D.instruments[id];
      const ok = !(e.atmo && !atmo) && !(e.vacuum && atmo);
      const impact = id === 'deployedSeismicSensor';
      const mine = (units || []).filter((u) => u.id === id).map((u) => ({ level: u.level, rate: deployRate(u.level) }));
      mine.sort((x, y) => y.rate - x.rate);
      const n = mine.length, share = diminishing(n);
      let hour = 0;
      mine.forEach((u, k) => {
        u.share = k === 0 ? 1 : share;
        u.perHour = impact || !ok ? 0 : e.base * mult * u.rate / 100 * u.share * power;
        hour += u.perHour;
      });
      const cap = e.cap * mult;
      rows.push({
        id: id, title: e.title, ok: ok, impact: impact, count: n, share: share, units: mine, multiplier: mult,
        perHour: hour * gain, cap: cap * gain, hours: hour > 0 ? cap / hour : null,
        // one full-rate instrument, for comparing kinds
        bestPerHour: impact || !ok ? 0 : e.base * mult * gain,
      });
      perHour += hour * gain;
      if (ok && n) total += cap * gain;
    }
    return { body: body, multiplier: mult, rows: rows, perHour: perHour, total: total };
  }
  /** A Unity/KSP FloatCurve (Hermite keys [time, value, inTangent, outTangent]), clamped to the end values outside the keys. */
  function floatCurve(keys, x) {
    if (!keys || !keys.length) return 1;
    if (x <= keys[0][0]) return keys[0][1];
    const last = keys[keys.length - 1];
    if (x >= last[0]) return last[1];
    let k = 1;
    while (keys[k][0] < x) k++;
    const a = keys[k - 1], b = keys[k], dt = b[0] - a[0], s = (x - a[0]) / dt, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * a[1] + (s3 - 2 * s2 + s) * dt * a[3] + (-2 * s3 + 3 * s2) * b[1] + (s3 - s2) * dt * b[2];
  }
  /** The seismometer's share of an impact by distance: its distanceCurve at the angle (great-circle distance / body radius),
   *  clamped to 0..1. A missing distance counts as one radius (the game's fallback when the impact has no controlling vessel). */
  function seismicDistance(distance, radius) {
    const keys = CD.deployed && CD.deployed.seismicCurve;
    const angle = distance === null || distance === undefined || !(radius > 0) ? 1 : distance / radius;
    return clamp01(floatCurve(keys, angle));
  }
  /** Science from one impact near the seismometers on a body (DeployedScienceExperiment.ProcessSeismicEvent):
   *  energy = sum of 1/2 x mass(kg) x speed^2 over what hits (the vessel's surface speed); impacts under the minimum energy are
   *  ignored; each sensor makes share x power x cap x (energy / the body's energy scale) x rate/100 x distance share, and the
   *  subject never holds more than its cap (cap = 80 x the body's landed multiplier). R&D credits it times the science gain.
   *  opts: mass (t), speed (m/s), distance (m, great circle), radius (m, the body's), units [{level}] (the seismometers, default
   *  one set down by a non-scientist), power (1, 0.5 solar-only while away, 0), gain, done (science already in the subject). */
  function seismicImpact(body, opts) {
    const D = CD.deployed || {}, e = (D.instruments || {}).deployedSeismicSensor, b = CD.bodyScience[body];
    opts = opts || {};
    const mult = b ? b.landed : 1, cap = e ? e.cap * mult : 0;
    const power = opts.power === undefined ? 1 : opts.power, gain = opts.gain === undefined ? 1 : opts.gain;
    const mass = opts.mass || 0, speed = opts.speed || 0, done = Math.max(0, opts.done || 0);
    const joules = 0.5 * mass * 1000 * speed * speed;
    const scale = D.seismicEnergy && D.seismicEnergy[body] ? D.seismicEnergy[body] : null;   // no entry: float.MaxValue, nothing
    const dist = seismicDistance(opts.distance, opts.radius);
    const sensors = (opts.units && opts.units.length ? opts.units : [{ level: null }]).map((u) => ({ level: u.level, rate: deployRate(u.level) }));
    sensors.sort((x, y) => y.rate - x.rate);
    const share = diminishing(sensors.length);
    // science per joule of all sensors together, before the cap
    let perJoule = 0;
    sensors.forEach((u, k) => { u.share = k === 0 ? 1 : share; perJoule += scale ? u.share * power * cap / scale * u.rate / 100 * dist : 0; });
    const below = joules < (D.seismicMin || 0);
    const raw = below ? 0 : joules * perJoule, left = Math.max(0, cap - done);
    const got = Math.min(raw, left);
    const full = perJoule > 0 ? left / perJoule : null;   // joules one impact needs to fill what is left
    const curve = D.seismicCurve || [];
    const peak = curve.reduce((m, k) => (k[1] > m[1] ? k : m), [1, 0]);
    const flat = curve.length ? curve.find((k) => k[0] > peak[0] && k[1] === curve[curve.length - 1][1]) : null;   // where it levels off
    return {
      body: body, ok: !!(e && scale), joules: joules, scale: scale, ratio: scale ? joules / scale : 0, minimum: D.seismicMin || 0, below: below,
      distanceShare: dist, sensors: sensors, multiplier: mult, cap: cap * gain, left: left * gain,
      perImpact: raw * gain, science: got * gain, impactsToFill: raw > 0 ? Math.ceil(left / raw - 1e-9) : null,
      joulesToFill: full, massToFill: full !== null && speed > 0 ? Math.max(full, D.seismicMin || 0) * 2 / (speed * speed) / 1000 : null,
      bestDistance: opts.radius > 0 ? peak[0] * opts.radius : null, farDistance: opts.radius > 0 && flat ? flat[0] * opts.radius : null, farShare: flat ? flat[1] : null,
    };
  }
  /** Power units a station needs and what its panels/RTGs give: the control station, every instrument and a ground dish each need
   *  their part's powerUnitsRequired; each solar panel or RTG gives its powerUnitsProduced plus the engineer bonus. */
  function deployPower(instruments, dishes, makers, engineerLevel) {
    const pu = (id, k) => { const p = partById[id]; return p && p.pu ? p.pu[k] : 0; };
    const need = pu('DeployedCentralStation', 1) + instruments * pu('DeployedGoExOb', 1) + dishes * pu('DeployedSatDish', 1);
    const each = pu('DeployedSolarPanel', 0) + engineerBonus(engineerLevel);
    return { need: need, each: each, have: makers * each, makers: each > 0 ? Math.ceil(need / each) : null };
  }

  // ---- strategies ------------------------------------------------------------------------------------------------
  const KEY = { Funds: 'funds', Science: 'sci', Reputation: 'rep' };
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  /** What a set of active strategies adds to an income or cost. `reason` is the game's name for where the money comes from
   *  (ContractReward, ContractAdvance, Progression, ScienceTransmission, VesselRecovery, VesselRollout, RnDPartPurchase, ...),
   *  `amounts` {funds, sci, rep} what it would be without strategies. Each effect works on the original amounts and adds its change
   *  (CurrencyConverter: the share is taken from the input and paid out at the rate; CurrencyOperation: multiply or add), the way the
   *  game's modifier query does. `active` is [{id, factor 0..1}]. Returns the changes and the totals. */
  function strategyEffect(active, reason, amounts) {
    const d = { funds: 0, sci: 0, rep: 0 };
    for (const a of active || []) {
      const st = CD.strategies.find((s) => s.id === a.id);
      if (!st) continue;
      const f = clamp01(a.factor === undefined ? 0 : a.factor);
      for (const e of st.effects) {
        if (!e.affect || e.affect.indexOf(reason) < 0) continue;
        if (e.name === 'CurrencyConverter') {
          const k = KEY[e.input], take = (amounts[k] || 0) * lerp(e.minShare, e.maxShare, f);
          d[k] -= take; d[KEY[e.output]] += take * lerp(e.minRate, e.maxRate, f);
        } else if (e.name === 'CurrencyOperation') {
          const k = KEY[e.currency], v = lerp(e.minValue, e.maxValue, f);
          d[k] += e.operation === 'Multiply' ? (amounts[k] || 0) * (v - 1) : v;
        }
      }
    }
    return { delta: d, total: { funds: (amounts.funds || 0) + d.funds, sci: (amounts.sci || 0) + d.sci, rep: (amounts.rep || 0) + d.rep } };
  }
  /** Strategy facts for the list: price at a commitment, what it does in words, whether the Administration level allows it. */
  function strategyTable(state) {
    const adm = (CD.facilities.Administration || {});
    const lvl = (state.facilities && state.facilities.Administration) || 1;
    const maxCommit = adm.commit ? adm.commit[lvl - 1] : 1;
    const slots = adm.strategies ? adm.strategies[lvl - 1] : 1;
    return {
      slots: slots, maxCommit: maxCommit, used: (state.strategies || []).length,
      rows: CD.strategies.map((s) => ({
        id: s.id, title: s.title, dept: s.dept, effects: s.effects, slider: s.slider,
        costFunds: s.costFunds, costRep: s.costRep, costSci: s.costSci, repMin: s.repMin, repMax: s.repMax, days: s.days,
        allowed: state.rep >= s.repMin && state.rep <= s.repMax,
      })),
    };
  }
  /** What a strategy costs to start: the game scales the cost between its minimum and maximum with the commitment. */
  function strategyCost(id, factor) {
    const s = CD.strategies.find((x) => x.id === id);
    if (!s) return null;
    const f = clamp01(factor);
    return { funds: Math.round(lerp(s.costFunds[0], s.costFunds[1], f)), rep: Math.round(lerp(s.costRep[0], s.costRep[1], f)), sci: Math.round(lerp(s.costSci[0], s.costSci[1], f)) };
  }

  // ---- milestones ("World First" rewards) -------------------------------------------------------------------------
  /* Read from the game's code (ProgressUtilities.WorldFirstStandardReward and what it calls); see docs/RESEARCH.md section 8.
   * The reward a milestone gives when you reach it for the first time is
   *   base x PassiveBaseRatio x score(type, home or elsewhere) x (1.5 if outlier) x prestige factor x difficulty gain
   *   and, for funds on a body, x (1 + (body recovery value - 1) x PassiveBodyRatio), rounded. */
  const M = CD.milestones;
  const NODE_TYPE = {
    Orbit: 'ORBIT', Flyby: 'FLYBY', Landing: 'LANDING', Escape: 'ESCAPE', Splashdown: 'SPLASHDOWN', Suborbit: 'SUBORBIT', Flight: 'FLIGHT',
    Science: 'SCIENCE', FlagPlant: 'FLAGPLANT', SurfaceEVA: 'SURFACEEVA', Spacewalk: 'SPACEWALK', ReturnFromOrbit: 'ORBITRETURN',
    ReturnFromFlyBy: 'FLYBYRETURN', ReturnFromSurface: 'LANDINGRETURN', Docking: 'DOCKING', Rendezvous: 'RENDEZVOUS',
    CelestialBodyTransfer: 'CREWTRANSFER', BaseConstruction: 'BASECONSTRUCTION', StationConstruction: 'STATIONCONSTRUCTION',
  };
  const SINGLE_NODE = { FirstLaunch: 'FIRSTLAUNCH', ReachedSpace: 'REACHSPACE', FirstCrewToSurvive: 'CREWRECOVERY', TowerBuzz: 'STUNT' };
  const HOME = 'Kerbin';
  const GAS_GIANTS = ['Jool', 'Sarnus', 'Urlum', 'Neidon', 'Kerbol'];
  const OCEAN_BODIES = ['Kerbin', 'Eve', 'Laythe'];
  const isHome = (body) => !body || body === HOME;
  const score = (type, body) => M.types[type].score[isHome(body) ? 0 : 1];
  const outlier = (type, body) => M.outlier.indexOf(type) >= 0 || (type === 'LANDINGRETURN' && !!body && hasAtmosphere(body));
  /** 0 trivial, 1 significant, 2 exceptional: ProgressTypePrestige scores the type as at the home planet (it passes no body). */
  function prestigeOf(type) {
    if (M.outlier.indexOf(type) >= 0) return 2;
    const sc = score(type, null);
    if (sc <= score('FLIGHT', null)) return 0;
    return sc < score('ORBIT', null) ? 1 : 2;
  }
  const roundEven = (x) => { const f = Math.floor(x), r = x - f; return r > 0.5 ? f + 1 : r < 0.5 ? f : (f % 2 === 0 ? f : f + 1); };
  /** The reward for the first time a milestone is reached. `gain` [funds, sci, rep] = the difficulty gain multipliers. */
  function milestoneReward(type, body, gain, active) {
    const g = gain || [1, 1, 1];
    const t = M.types[type];
    if (!t) return null;
    const pf = [CD.vars.prestige.trivial, CD.vars.prestige.significant, CD.vars.prestige.exceptional][prestigeOf(type)];
    let m = M.passiveBase * score(type, body) * (outlier(type, body) ? M.outlierMultiplier : 1) * pf;
    const w = body && CD.bodyScience[body] ? CD.bodyScience[body].recovery : 1;
    const bodyFactor = body ? 1 + (w - 1) * M.passiveBody : 1;
    const base = {
      funds: roundEven(M.base.funds * m * g[0] * bodyFactor), sci: roundEven(M.base.sci * m * g[1]), rep: roundEven(M.base.rep * m * g[2]),
    };
    const s = strategyEffect(active, 'Progression', base);
    return { base: base, total: s.total, delta: s.delta, prestige: ['trivial', 'significant', 'exceptional'][prestigeOf(type)], score: score(type, body), outlier: outlier(type, body) };
  }
  /** Every milestone worth a reward on the stock bodies (and the one-off ones), with reward and whether the save already has it. */
  function milestoneList(state, bodies) {
    const done = new Set(state.progress || []);
    const gain = (state.diff && state.diff.gain) || [1, 1, 1];
    const names = bodies || Object.keys(CD.bodyScience);
    const rows = [];
    const add = (type, body, key) => {
      const r = milestoneReward(type, body, gain, state.strategies);
      rows.push({ type: type, body: body || null, label: M.types[type].label, key: key, done: done.has(key), reward: r.total, base: r.base, prestige: r.prestige, outlier: r.outlier });
    };
    for (const [node, type] of Object.entries(SINGLE_NODE)) add(type, null, node);
    for (const body of names) {
      const surface = GAS_GIANTS.indexOf(body) < 0;
      const types = ['ORBIT', 'FLYBY', 'ESCAPE', 'SCIENCE', 'SUBORBIT', 'SPACEWALK', 'ORBITRETURN', 'FLYBYRETURN', 'RENDEZVOUS', 'DOCKING', 'CREWTRANSFER', 'STATIONCONSTRUCTION'];
      if (surface) types.push('LANDING', 'FLAGPLANT', 'SURFACEEVA', 'LANDINGRETURN', 'BASECONSTRUCTION');
      if (hasAtmosphere(body)) types.push('FLIGHT');
      if (OCEAN_BODIES.indexOf(body) >= 0) types.push('SPLASHDOWN');
      if (body === 'Kerbol') { types.length = 0; types.push('ORBIT', 'FLYBY', 'ESCAPE', 'SCIENCE'); }
      for (const type of types) {
        const node = Object.keys(NODE_TYPE).find((k) => NODE_TYPE[k] === type);
        add(type, body, body + ':' + node);
      }
    }
    return rows;
  }

  return {
    strategyEffect: strategyEffect, strategyTable: strategyTable, strategyCost: strategyCost,
    milestoneReward: milestoneReward, milestoneList: milestoneList, milestonePrestige: prestigeOf, NODE_TYPE: NODE_TYPE, SINGLE_NODE: SINGLE_NODE,
    FACILITIES: FACILITIES, facName: facName, SITUATIONS: SITUATIONS, nodes: nodes, partsByTech: partsByTech, partById: partById,
    newState: newState, fromSave: fromSave, effects: effects, upgradeCost: upgradeCost, facilityTable: facilityTable,
    available: available, techPlan: techPlan, researchable: researchable, craftNeeds: craftNeeds,
    recoveryFactor: recoveryFactor, missionFinance: missionFinance, forecast: forecast, contractEstimate: contractEstimate,
    experimentValue: experimentValue, scienceTable: scienceTable, hasAtmosphere: hasAtmosphere,
    deployRate: deployRate, engineerBonus: engineerBonus, diminishing: diminishing, deployedScience: deployedScience, deployPower: deployPower,
    floatCurve: floatCurve, seismicDistance: seismicDistance, seismicImpact: seismicImpact,
  };
});
