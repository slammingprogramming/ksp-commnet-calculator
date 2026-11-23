// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../js/data.js');
const CD = require('../js/career-data.js');
const Career = require('../js/career.js');
const Craft = require('../js/craft.js');
const Sim = require('../js/sim.js');
const Pl = require('../js/planner.js');
const Net = require('../js/netplan.js');
const { createWorld } = require('../js/world.js');

const world = createWorld({});
const lookup = (id) => Data.antennas.find((a) => a.id === id);
const stock = Data.antennas.filter((a) => a.pack === 'stock');
const settings = { dsnPower: 250e9, extraStations: true, occVac: 0.9, occAtm: 0.75, rangeMod: 1 };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' vs ' + b);
const FAR = { id: 'b', name: 'Far base', kind: 'base', body: 'Mun', lat: 5, lon: 227, stage: 1 };
const MUNSTA = { id: 'a', name: 'Mun station', kind: 'station', body: 'Mun', alt: 80000, inc: 0, stage: 1 };
const base = { world, lookup, settings, t0: 0, horizon: 5 * Data.DAY, target: 0.995, minSignal: 0.1, antennas: stock, dsnLevel: 3 };

test('default antennas: the lightest setup that reaches the class, the strongest when none does', () => {
  const rover = Net.loadout('rover', stock, 1), baseL = Net.loadout('base', stock, 1), station = Net.loadout('station', stock, 1);
  const own = (s) => require('../js/core.js').vesselStats(s, lookup, 1).own;
  assert.ok(own(rover) >= Net.POWER_NEED.light && own(baseL) >= Net.POWER_NEED.medium && own(station) >= Net.POWER_NEED.heavy);
  // nothing lighter does it: every other single antenna that reaches the class is at least as heavy
  const mass = (s) => s.reduce((q, e) => q + lookup(e.id).mass * e.count, 0);
  for (const a of stock) {
    if (a.builtin || a.ground || !(a.power >= Net.POWER_NEED.medium)) continue;
    assert.ok(mass([{ id: a.id, count: 1 }]) >= mass(baseL) - 1e-9, a.id);
  }
  // a pool of only a weak antenna still gives that antenna, not nothing
  const weak = stock.filter((a) => a.id === 'stock:longAntenna');
  assert.equal(Net.loadout('station', weak, 1)[0].id, 'stock:longAntenna');
  // hard difficulty (range 0.65) pushes the rover from one Communotron to two
  assert.equal(Net.loadout('rover', weak, 0.65)[0].count, 2);
});

test('sites become nodes: orbit, landed, and roaming points with a terrain mask and a cruise altitude', () => {
  const sites = [MUNSTA, FAR, { id: 'r', name: 'Rovers', kind: 'rover', body: 'Mun', samples: 4, latMax: 30, terrain: 'rugged' },
    { id: 'p', name: 'Drones', kind: 'aircraft', body: 'Kerbin', samples: 3, cruise: 7000, antennas: [{ id: 'stock:longAntenna', count: 1 }] }];
  const ns = Net.siteNodes(world, sites, stock, 1);
  assert.equal(ns.length, 1 + 1 + 4 + 3);
  assert.ok(ns.every((n) => n.tracked));
  const sta = ns.find((n) => n.id === 'a');
  assert.equal(sta.loc.type, 'orbit');
  near(sta.loc.orbit.a - 200000, 80000, 1);
  const rovers = ns.filter((n) => n.siteId === 'r');
  assert.ok(rovers.every((n) => n.mask === 15 && Math.abs(n.loc.lat) <= 30.001 && n.loc.alt === 0));
  const drones = ns.filter((n) => n.siteId === 'p');
  assert.ok(drones.every((n) => n.loc.alt === 7000 && n.antennas[0].id === 'stock:longAntenna'));
  assert.equal(new Set(ns.map((n) => n.name)).size, ns.length, 'names are unique (the planner finds goals by name)');
  assert.deepEqual(Net.siteNodes(world, [{ id: 'x', name: 'x', kind: 'base', body: 'Nowhere' }], stock, 1), []);
});

test('terrain mask: a site that must see 60 degrees above its horizon loses the low relay it could see before', () => {
  const ring = Pl.ringNodes(world, 'Mun', 3, 700000, 0, 0, 0, [{ id: 'stock:RelayAntenna100', count: 3 }], 'ring', 'r');
  const at = (mask) => {
    const node = { id: 's', name: 's', tracked: true, mask: mask, loc: { type: 'landed', body: 'Mun', lat: 0, lon: 0, alt: 0 }, antennas: [{ id: 'stock:HighGainAntenna', count: 1 }] };
    const sim = Sim.createSim({ world, lookup, settings: Object.assign({ minSignal: 0.05 }, settings), nodes: ring.concat([node]) });
    return Sim.scanSync(sim, 0, 4 * Data.DAY, sim.suggestStep(24)).sources[0].uptime;
  };
  const open = at(0), shadow = at(60);
  assert.ok(open > 0.99, 'open ground ' + open);
  assert.ok(shadow < open - 0.05, 'a 60 degree mask costs coverage: ' + shadow);
});

test('antenna status follows the save: research missing, bought or not, sandbox, mods', () => {
  const s = Career.newState('normal');
  const st = (state, id) => Net.antennaStatus(state, stock).find((r) => r.ant.id === id);
  assert.equal(st(s, 'stock:builtin').status, 'have');
  assert.equal(st(s, 'stock:longAntenna').status, 'research');
  assert.equal(st(null, 'stock:RelayAntenna100').status, 'have', 'no career: everything counts');
  s.tech.push('engineering101');
  const buy = st(s, 'stock:longAntenna');
  assert.equal(buy.status, 'buy');
  assert.equal(buy.funds, CD.parts.find((p) => p.id === 'longAntenna').entry);
  s.parts.push('longAntenna');
  assert.equal(st(s, 'stock:longAntenna').status, 'have');
  assert.equal(st({ mode: 'sandbox', tech: [], parts: [] }, 'stock:RelayAntenna100').status, 'have');
  assert.equal(Net.antennaStatus(s, [{ id: 'x:mod', pack: 'cae', name: 'm', parts: ['m'], tech: '' }])[0].status, 'mod');
});

test('part names with dots in the save match the part configs (the old pattern turned every letter into an underscore)', () => {
  const s = Career.newState('normal');
  s.tech = ['start', 'basicScience']; s.parts = ['HighGainAntenna5.v2'];
  const hg5 = Net.antennaStatus(s, stock).find((r) => r.ant.id === 'stock:HighGainAntenna5');
  assert.equal(hg5.status, 'have', 'bought HighGainAntenna5_v2 counts for the antenna');
  s.parts = [];
  assert.equal(Net.antennaStatus(s, stock).find((r) => r.ant.id === 'stock:HighGainAntenna5').status, 'buy');
  // a craft file names the part with a dot (the save writes delta.small); the cost of a part not yet bought comes back only if the name really differs
  const c = Craft.parseCraft(['ship = a', 'version = 1.12.5', 'PART', '{', '\tpart = delta_small_100', '\tpos = 0,0,0', '\tattPos = 0,0,0', '\tattPos0 = 0,0,0', '\trot = 0,0,0,1', '\tistg = 0', '\tdstg = 0', '\tsqor = 0', '\tsidx = -1', '\tattm = 0', '\tmodCost = 0', '\tmodMass = 0', '\tmodSize = 0,0,0', '}', ''].join('\n'));
  const t = Career.newState('normal'); t.tech = CD.tech.map((x) => x.id); t.parts = ['delta.small'];
  assert.equal(Career.craftNeeds(t, c).buy.length, 0, 'a bought delta.small is not asked for again');
  t.parts = ['delta.smell'];
  assert.equal(Career.craftNeeds(t, c).buy.length, 1, 'a different part of the same length does not stand in for it');
});

test('unlock cost: research in order with the science it takes, and the entry price of the parts', () => {
  const s = Career.newState('normal');
  const u = Net.unlockCost(s, ['stock:RelayAntenna100', 'stock:HighGainAntenna'], stock);
  assert.deepEqual(u.antennas.sort(), ['stock:HighGainAntenna', 'stock:RelayAntenna100']);
  const plan = Career.techPlan(s, ['automation', 'electronics']);
  assert.equal(u.science, plan.total);
  assert.deepEqual(u.nodes.map((n) => n.id), plan.rows.map((r) => r.id));
  const entry = (id) => CD.parts.find((p) => p.id === id).entry;
  assert.equal(u.funds, entry('RelayAntenna100') + entry('HighGainAntenna'));
  s.tech.push('engineering101', 'survivability', 'basicScience', 'miniaturization', 'precisionEngineering', 'electronics', 'automation');
  assert.equal(Net.unlockCost(s, ['stock:RelayAntenna100'], stock).science, 0);
});

test('network plan: a station and a far-side base on the Mun get a relay ring and meet the goal', () => {
  const r = Net.runSync(Net.planGen(Object.assign({}, base, { sites: [MUNSTA, FAR], mode: 'all', career: null })));
  assert.equal(r.stages.length, 1);
  const g = r.stages[0];
  assert.ok(g.ok && g.worst >= 0.995, 'worst ' + g.worst);
  assert.ok(g.planned.length >= 2 && g.planned.every((n) => n.loc.body === 'Mun' || n.loc.body === 'Kerbin' || n.loc.body === 'Kerbol'));
  assert.deepEqual(g.per.map((p) => p.site.id), ['a', 'b']);
  assert.ok(g.per.every((p) => p.met && p.uptime >= 0.995));
  assert.equal(g.upgrade, null);
  assert.equal(r.totals.relays, g.planned.length);
  assert.ok(r.totals.funds > g.planned.length * r.bus, 'funds include the antennas on top of the bus');
  assert.equal(r.totals.science, 0);
});

test('network plan with a young career: it says what to unlock, in research order, with the science and the price', () => {
  const s = Career.newState('normal');                                 // a new career: only the built-in antennas
  const r = Net.runSync(Net.planGen(Object.assign({}, base, { sites: [FAR, MUNSTA], mode: 'all', career: s })));
  const g = r.stages[0];
  assert.ok(g.upgrade, 'nothing but built-in antennas: every antenna the plan uses has to be unlocked');
  assert.ok(g.upgrade.antennas.length >= 2 && g.upgrade.science > 0 && g.upgrade.funds > 0);
  assert.ok(g.upgrade.antennas.every((id) => lookup(id).tech));
  const have = new Set(s.tech);
  g.upgrade.nodes.forEach((n) => { assert.ok(!have.has(n.id)); const parents = CD.tech.find((t) => t.id === n.id).parents; assert.ok(parents.every((p) => have.has(p)) || parents.some((p) => have.has(p)), n.id + ' comes after its parents'); have.add(n.id); });
  assert.equal(r.totals.science, g.upgrade.science);
  assert.ok(g.ok, 'and with them the goal is met');
  // the same plan in a sandbox needs nothing unlocked
  const box = Net.runSync(Net.planGen(Object.assign({}, base, { sites: [FAR, MUNSTA], mode: 'all', career: { mode: 'sandbox', tech: [], parts: [], funds: 0, sci: 0, facilities: {} } })));
  assert.equal(box.stages[0].upgrade, null);
  // the input state is left alone
  assert.deepEqual(s.tech, ['start']);
  assert.deepEqual(s.parts, []);
});

test('network plan with antennas already bought: no upgrade is asked for what the career can build', () => {
  const s = Career.newState('normal');
  s.tech = ['start', 'engineering101', 'survivability', 'basicScience'];                 // Communotron 16 and HG-5
  s.parts = ['longAntenna', 'HighGainAntenna5'];
  const r = Net.runSync(Net.planGen(Object.assign({}, base, { sites: [MUNSTA], mode: 'all', career: s })));
  const g = r.stages[0];
  assert.ok(g.planned.every((n) => n.antennas.every((a) => ['stock:HighGainAntenna5', 'stock:longAntenna'].indexOf(a.id) >= 0)), 'only what the career owns');
  assert.ok(g.upgrade === null || g.upgrade.antennas.every((id) => lookup(id).tech));
});

test('network plan in stages: the second stage keeps the first stage\'s relays and adds its own', () => {
  const sites = [{ id: 'k', name: 'Kerbin station', kind: 'station', body: 'Kerbin', alt: 300000, inc: 0, stage: 1 }, Object.assign({}, FAR, { stage: 2 })];
  const r = Net.runSync(Net.planGen(Object.assign({}, base, { sites: sites, mode: 'stages', career: null })));
  assert.deepEqual(r.stages.map((g) => g.stage), [1, 2]);
  const names1 = new Set(r.stages[0].planned.map((n) => n.name));
  assert.ok(r.stages[1].planned.every((n) => !names1.has(n.name)), 'no relay is planned twice');
  assert.ok(r.stages[1].planned.length >= 1, 'the Mun base needs relays of its own');
  assert.equal(r.relays.length, r.stages[0].planned.length + r.stages[1].planned.length);
  assert.equal(r.stages[1].per.length, 2, 'stage 2 holds both sites to their goal');
  assert.ok(r.stages.every((g) => g.ok));
  assert.equal(Net.autoStage(world, 'Kerbin'), 1);
  assert.equal(Net.autoStage(world, 'Mun'), 1);
  assert.equal(Net.autoStage(world, 'Duna'), 2);
  assert.equal(Net.autoStage(world, 'Ike'), 2);
  assert.equal(Net.autoStage(world, 'Eeloo'), 3);
  assert.equal(Net.autoStage(world, 'Laythe'), 3);
});

test('network plan: nothing to do is said, and no sites is an error', () => {
  const r = Net.runSync(Net.planGen(Object.assign({}, base, { sites: [], mode: 'all' })));
  assert.ok(r.error && r.stages.length === 0);
});

test('station orbits: the body\'s low and high space bands with their science multipliers and landing delta-v', () => {
  const o = Net.stationOptions(world, 'Mun', [10]);
  const low = o.filter((x) => x.band === 'low'), high = o.filter((x) => x.band === 'high');
  assert.ok(low.length === 3 && high.length === 3, 'low and high band, each with the base inclination, equatorial and polar');
  assert.ok(low.every((x) => x.multiplier === CD.bodyScience.Mun.spaceLow) && high.every((x) => x.multiplier === CD.bodyScience.Mun.spaceHigh));
  assert.ok(low[0].alt >= 25000 * 1.2 - 1 && low[0].alt < CD.bodyScience.Mun.spaceAltitude);
  assert.ok(high[0].alt > CD.bodyScience.Mun.spaceAltitude);
  assert.deepEqual(o.slice(0, 3).map((x) => x.inc), [10, 0, 90]);
  assert.ok(o.every((x) => x.dvDown > 300 && x.dvUp > 300 && x.period > 1000));
  assert.ok(o.every((x) => x.dvDown > 0 && x.dvUp > 0), 'both legs priced like the Missions tab');
  const k = Net.stationOptions(world, 'Kerbin', []);
  assert.ok(k.every((x) => x.dvUp > 3000), 'Kerbin ascent to a station orbit is the simulated gravity turn (thrust-to-weight 1.5)');
  assert.deepEqual(Net.stationOptions(world, 'Nowhere', []), []);
});

test('lander budget: Tsiolkovsky for the trip, and the ore that refills the ascent weighs what the propellant weighs', () => {
  const b = Net.landerBudget(world, 'Mun', 30000, { isp: 345, dry: 5 });
  near(b.dvTrip, b.dvDown + b.dvUp, 1e-6);
  const prop = (dv) => 5 * (Math.exp(dv / (345 * Data.G0)) - 1);
  near(b.propUp, prop(b.dvUp), 1e-9);
  near(b.propTrip, prop(b.dvTrip), 1e-9);
  near(b.oreForUp * CD.resources.Ore.density, b.propUp, 1e-9, 'tonnes of ore = tonnes of propellant');
  near(b.refuelHours, b.oreForUp / 0.5 / 3600, 1e-9);
  const duna = Net.landerBudget(world, 'Duna', 30000);
  assert.ok(!duna.error && duna.dvUp > 1000 && duna.dvUp < 2500, 'Duna ascent comes from the simulated gravity turn: ' + duna.dvUp);
});

test('base candidates: flat ground scored by how well it sees the network; near side beats far side with no relays', () => {
  const gen = Net.baseCandidates({ world, lookup, settings, relays: [], t0: 0, minSignal: 0.1, power: 2e9 }, 'Mun', { maxLat: 40 });
  const r = Net.runSync(gen);
  assert.ok(r.rows.length >= 4);
  for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i - 1].score >= r.rows[i].score);
  assert.ok(r.rows.every((x) => x.link >= 0 && x.link <= 1 && Math.abs(x.lat) <= 40));
  const lonDist = (x) => Math.abs(((x.lon - 47.4 + 540) % 360) - 180);       // 0 = the side that faces Kerbin
  const facing = r.rows.filter((x) => lonDist(x) > 100 ? false : true), away = r.rows.filter((x) => lonDist(x) > 140);
  if (facing.length && away.length) assert.ok(Math.max(...facing.map((x) => x.link)) > Math.max(...away.map((x) => x.link)), 'the Kerbin-facing side sees the ground station');
  assert.ok(Net.runSync(Net.baseCandidates({ world, lookup, settings, relays: [], t0: 0 }, 'Jool')).error);
});

test('where to earn: moons and planets ranked by science per delta-v; thick atmospheres are priced without the ascent', () => {
  const e = Net.earnTable(world, ['Mun', 'Minmus', 'Duna', 'Ike', 'Kerbol', 'Nowhere'], 0);
  assert.deepEqual(new Set(e.map((x) => x.body)), new Set(['Mun', 'Minmus', 'Duna', 'Ike']));
  for (let i = 1; i < e.length; i++) {
    assert.ok(!(e[i - 1].partial && !e[i].partial), 'complete trips come before the ones priced without an ascent');
    if (!!e[i - 1].partial === !!e[i].partial) assert.ok((e[i - 1].perKms || 0) >= (e[i].perKms || 0));
  }
  const mun = e.find((x) => x.body === 'Mun'), duna = e.find((x) => x.body === 'Duna');
  assert.ok(mun.dv > 2000 && mun.dv < 3500 && mun.first > 0 && mun.total >= mun.first);
  assert.equal(duna.partial, false, 'Duna is priced with the simulated ascent now');
  assert.ok(duna.dv > 0);
  assert.equal(mun.partial, false);
});

test('funding check: what the plan costs against the career\'s funds and science', () => {
  const f = Net.fundingCheck({ funds: 1000, sci: 10 }, { totals: { funds: 1500, science: 4 } });
  assert.deepEqual([f.shortFunds, f.shortScience], [500, 0]);
  assert.deepEqual([Net.fundingCheck(null, { totals: { funds: 5, science: 1 } }).shortFunds, Net.fundingCheck(null, { totals: { funds: 5, science: 1 } }).shortScience], [5, 1]);
  assert.ok(Net.busCost() > 1000, 'the bus price comes from the game\'s probe core, battery and panels');
  const c = Net.relayCost([{ antennas: [{ id: 'stock:RelayAntenna100', count: 3 }] }], lookup, 1000);
  assert.equal(c.funds, 3 * 3000 + 1000);
  near(c.antennaMass, 3 * 0.65, 1e-9);
});

test('high ground near a site is offered for a relay lander', () => {
  const g = Net.highGround('Mun', 0, 0, 400);
  assert.ok(g.length >= 1 && g.length <= 3);
  assert.ok(g.every((x) => typeof x.lat === 'number' && typeof x.biome === 'string'));
  assert.deepEqual(Net.highGround('Jool', 0, 0, 100), []);
});

/* ---------- seismometer crash planning ---------- */

const mun = Data.bodies.find((b) => b.id === 'Mun');

test('impact speeds from orbit: de-orbit from circular, and escape speed', () => {
  const sp = Career.impactSpeeds(mun, [30, 100]);
  assert.equal(sp.length, 3);
  near(sp[2].speed, Math.sqrt(2 * mun.gm / mun.radius), 1e-6);
  assert.ok(sp[0].speed < sp[1].speed && sp[1].speed < sp[2].speed);
  near(sp[0].speed, Math.sqrt(mun.gm * (2 / mun.radius - 2 / (2 * mun.radius + 30000))), 1e-6);   // vis-viva at the periapsis of the de-orbit ellipse
});

test('crash plan: the distance band, the mass for one crash and for several, and a far crash costs twice the energy', () => {
  const sp = Career.impactSpeeds(mun, [30]);
  const p = Career.seismicPlan('Mun', { radius: mun.radius, speeds: sp, units: [{ level: 5 }] });
  assert.ok(p.ok);
  near(p.best, 0.02 * mun.radius, 1e-6);
  assert.ok(p.bandFrom < p.best && p.bandTo > p.best && p.bandFrom > 0);
  near(p.far, 0.3 * mun.radius, 1);
  near(p.farShare, 0.5, 1e-9);
  const sp0 = p.speeds[0];
  const check = Career.seismicImpact('Mun', { mass: sp0.massOne, speed: sp0.speed, distance: p.best, radius: mun.radius, units: [{ level: 5 }] });
  near(check.perImpact, p.cap, 1e-6, 'that mass fills the cap');
  near(sp0.massFar / sp0.massOne, 2, 1e-9);
  for (let n = 1; n <= 6; n++) {
    near(sp0.rows[n - 1].each * n, sp0.massOne, 1e-9);
    assert.ok(sp0.rows[n - 1].fills);
  }
  // already holding part of the cap: less to drop
  const half = Career.seismicPlan('Mun', { radius: mun.radius, speeds: sp, units: [{ level: 5 }], done: p.cap / 2 });
  near(half.speeds[0].massOne, sp0.massOne / 2, 1e-6);
  // a gain of 2 does not change the mass (the cap is credited, not the energy) but a full subject needs nothing
  const full = Career.seismicPlan('Mun', { radius: mun.radius, speeds: sp, units: [{ level: 5 }], done: p.cap });
  assert.equal(full.full, true);
  assert.deepEqual(full.speeds, []);
  // slower crashes need more mass; every row stays above the 3000 J floor
  const slow = Career.seismicPlan('Mun', { radius: mun.radius, speeds: [{ label: 'slow', speed: 100 }], units: [{ level: 5 }], maxImpacts: 6 });
  assert.ok(slow.speeds[0].massOne > sp0.massOne);
  assert.ok(slow.speeds[0].rows.every((r) => 0.5 * r.each * 1000 * 100 * 100 >= 3000 - 1e-6));
});

test('crash plan: two sensors close together share one best impact point; a body with no energy scale gives nothing', () => {
  const sp = Career.impactSpeeds(mun, [30]);
  const deg = (m) => m / mun.radius * 180 / Math.PI;
  const two = Career.seismicPlan('Mun', { radius: mun.radius, speeds: sp, units: [{ level: 5, lat: 0, lon: 0 }, { level: 5, lat: 0, lon: deg(3000) }] });
  assert.ok(two.point && two.point.share > 0.99, 'one point at the peak of both: ' + (two.point && two.point.share));
  near(two.point.distances[0], two.best, 400);
  near(two.point.distances[1], two.best, 400);
  assert.ok(two.speeds[0].massOne > 0);
  const apart = Career.seismicPlan('Mun', { radius: mun.radius, speeds: sp, units: [{ level: 5, lat: 0, lon: 0 }, { level: 5, lat: 0, lon: deg(60000) }] });
  assert.ok(apart.point.share < two.point.share - 0.05, 'sensors 60 km apart cannot both sit at the peak: ' + apart.point.share + ' vs ' + two.point.share);
  assert.ok(apart.speeds[0].massOne > two.speeds[0].massOne, 'and so need more mass');
  assert.equal(Career.seismicPlan('Jool', { radius: 6e6, speeds: sp }).ok, false);
  // the impact distance field of seismicImpact: a sensor can carry its own distance
  const a = Career.seismicImpact('Mun', { mass: 1, speed: 800, radius: mun.radius, distance: 4000, units: [{ level: 5 }, { level: 5 }] });
  const b = Career.seismicImpact('Mun', { mass: 1, speed: 800, radius: mun.radius, units: [{ level: 5, distance: 4000 }, { level: 5, distance: 4000 }] });
  near(a.perImpact, b.perImpact, 1e-9);
});

test('great circle and aim point agree', () => {
  const R = mun.radius;
  const p = Career.greatCircle(10, 20, 10, 20, R);
  assert.equal(p, 0);
  near(Career.greatCircle(0, 0, 0, 90, R), Math.PI / 2 * R, 1e-6);
  near(Career.greatCircle(0, 0, 90, 0, R), Math.PI / 2 * R, 1e-6);
});

test('mining: drills dig efficiency x abundance, crew bonus per star, converter is the cap, Jool has no ore', () => {
  const m = Net.mining('Mun', { abundance: 10, drills: [{ id: 'RadialDrill', n: 6 }], engineer: 0, isru: 'ISRU', propTonnes: 10 });
  assert.equal(m.error, undefined);
  near(m.drillOre, 6 * 1.5 * 0.1 * (0.05 + 1 * 0.2), 1e-12, 'six Drill-O-Matics at 10% with a zero-star engineer');
  near(m.converterOre, 0.5 * 0.25, 1e-12);
  assert.equal(m.at.limit, 'converter', 'the Convert-O-Tron 250 eats less than six drills dig here');
  assert.equal(Net.mining('Mun', { abundance: 10, drills: [{ id: 'RadialDrill', n: 2 }], engineer: 0 }).at.limit, 'drills');
  near(m.at.tonnesPerHour, 0.5 * 0.25 * (0.45 + 0.55) / 0.5 * 0.005 * 3600, 1e-9);
  assert.ok(m.at.hours > 0 && isFinite(m.at.hours));
  const none = Net.mining('Mun', { abundance: 10, drills: [{ id: 'RadialDrill', n: 6 }], engineer: null });
  assert.ok(none.at.rate < m.at.rate / 4, 'with no engineer on board everything runs at 5%');
  const star = Net.mining('Mun', { drills: [{ id: 'RadialDrill', n: 1 }], engineer: 5 });
  assert.equal(star.abundance, 8, 'default is the middle of the 1-15% range');
  assert.ok(Net.mining('Jool', {}).error);
  assert.ok(Net.mining('Mun', { isru: 'nope' }).error);
});

test('funding: launch cost per relay is added, and expected income counts toward what the career can pay', () => {
  const nodes = [{ antennas: [] }, { antennas: [] }];
  const c = Net.relayCost(nodes, () => null, 1000, 5000);
  assert.equal(c.launchFunds, 10000);
  assert.equal(c.funds, 2000 + 10000);
  const f = Net.fundingCheck({ funds: 1000, sci: 10 }, { totals: { funds: 5000, science: 20 } }, { income: 3000, sci: 15 });
  assert.equal(f.haveFunds, 4000);
  assert.equal(f.shortFunds, 1000);
  assert.equal(f.shortScience, 0);
});
