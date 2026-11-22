// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../js/data.js');
const Orb = require('../js/orbits.js');
const { createWorld } = require('../js/world.js');
const Sim = require('../js/sim.js');
const Pl = require('../js/planner.js');

const world = createWorld({});
const lookup = (id) => Data.antennas.find((a) => a.id === id);
const stock = Data.antennas.filter((a) => a.pack === 'stock');
const settings = { dsnPower: 250e9, extraStations: true, occVac: 0.9, occAtm: 0.75 };

test('relay tiers are ascending in power and each is the lightest way to get there', () => {
  const tiers = Pl.relayTiers(stock, 1);
  assert.ok(tiers.length >= 4);
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(tiers[i].power >= tiers[i - 1].power);
    assert.ok(tiers[i].mass > tiers[i - 1].mass, 'heavier for more power');
  }
  for (const t of tiers) assert.ok(t.setup[0].id.indexOf('Relay') > 0 || t.setup[0].id.indexOf('HighGainAntenna5') > 0);
});

test('surface samples are near-uniform and cover both hemispheres', () => {
  const pts = Pl.surfaceSamples(20);
  assert.equal(pts.length, 20);
  assert.ok(pts.some((p) => p.lat > 60) && pts.some((p) => p.lat < -60));
  assert.ok(pts.every((p) => p.lon >= -180 && p.lon <= 180));
});

test('keostationary altitude matches Kerbin\'s known value (~2,863 km)', () => {
  const alt = Pl.keoAltitude(world);
  assert.ok(Math.abs(alt - 2863330) < 3000, String(alt));
});

test('a single relay leaves gaps around a body; three equally spaced relays give continuous coverage', () => {
  const ant = [{ id: 'stock:RelayAntenna100', count: 3 }];
  const samples = Pl.surfaceSamples(8).map((p, i) => ({ id: 's' + i, name: 's' + i, tracked: true, loc: { type: 'landed', body: 'Duna', lat: p.lat, lon: p.lon, alt: 0 }, antennas: [{ id: 'stock:longAntenna', count: 1 }] }));
  const uptime = (n) => {
    const ring = Pl.ringNodes(world, 'Duna', n, 600000, 0, 0, 0, ant, 'ring', 'r');
    const sim = Sim.createSim({ world, lookup, settings: Object.assign({ minSignal: 0.1 }, settings), nodes: ring.concat(samples) });
    const r = Sim.scanSync(sim, 1e6, 1e6 + 3 * Data.DAY, sim.suggestStep(24));
    return Math.min(...r.sources.map((s) => s.uptime));
  };
  const u1 = uptime(1), u3 = uptime(3);
  assert.ok(u1 < 0.85, 'one relay: ' + u1);
  assert.ok(u3 > 0.999, 'three relays: ' + u3);
});

test('planner diagnoses a far-side Mun lander and fixes it with a relay ring around the Mun', () => {
  const probe = { id: 'lander', name: 'Far-side lander', tracked: true, loc: { type: 'landed', body: 'Mun', lat: 10, lon: 47.436 + 180, alt: 0 }, antennas: [{ id: 'stock:HighGainAntenna', count: 1 }] };
  const plan = Pl.runSync(Pl.planGen({
    world, lookup, settings, nodes: [probe], t0: 0, horizon: 6 * Data.DAY, target: 0.995, minSignal: 0.1, pool: stock, robust: true,
  }));
  assert.equal(plan.baseline.sources[0].uptime, 0);
  assert.equal(plan.baselineCauses.causes[0].id, 'occ:Mun');
  assert.ok(plan.steps.length >= 1);
  const ring = plan.steps.find((s) => s.proposal.family === 'ring' && s.proposal.body === 'Mun');
  assert.ok(ring, 'expected a Mun relay ring');
  assert.ok(plan.final.sources[0].uptime > 0.99, 'final uptime ' + plan.final.sources[0].uptime);
  assert.ok(plan.planned.length >= 2);
  assert.equal(plan.stress.length, 3);
  for (const n of plan.planned) assert.ok(n.antennas.length && n.antennas[0].count >= 1);
});

test('with only KSC, a far-side Mun lander needs both a Mun ring and a Kerbin-side fix; the planner finds both', () => {
  const probe = { id: 'lander', name: 'Far-side lander', tracked: true, loc: { type: 'landed', body: 'Mun', lat: 10, lon: 47.436 + 180, alt: 0 }, antennas: [{ id: 'stock:HighGainAntenna', count: 1 }] };
  const plan = Pl.runSync(Pl.planGen({
    world, lookup, settings: Object.assign({}, settings, { extraStations: false }), nodes: [probe], t0: 0, horizon: 6 * Data.DAY,
    target: 0.995, minSignal: 0.1, pool: stock, robust: true,
  }));
  const bodies = plan.steps.map((s) => s.proposal.body);
  assert.ok(bodies.indexOf('Mun') >= 0, 'Mun ring');
  assert.ok(bodies.indexOf('Kerbin') >= 0, 'Kerbin fix after the Mun ring: ' + bodies.join(','));
  assert.ok(plan.final.sources[0].uptime > 0.98, 'final uptime ' + plan.final.sources[0].uptime);
});

test('reachGen: far-side Mun sites are blocked, near-side ones are not; gas giants are skipped', () => {
  const Core = require('../js/core.js');
  const st = Core.vesselStats([{ id: 'stock:HighGainAntenna', count: 1 }], lookup, 1);
  const P = { world, lookup, settings: { dsnPower: 250e9, extraStations: false, occVac: 0.9, occAtm: 0.75 }, power: st.own, t0: 0, horizon: 30 * Data.DAY, minSignal: 0.05 };
  const res = Pl.runSync(Pl.reachGen(P, ['Mun', 'Jool']));
  assert.equal(res.length, 1);
  assert.equal(res[0].body, 'Mun');
  assert.ok(res[0].best > 0.5 && res[0].best > res[0].worst + 0.4, 'best site ' + res[0].best);
  assert.ok(res[0].worst < 0.2, 'worst site ' + res[0].worst);
  assert.ok(res[0].mean > 0.15 && res[0].mean < 0.6, 'mean ' + res[0].mean);
});

test('deployHint: three keostationary relays are 1/3 of a day apart and phase with a ~170 m/s lowering', () => {
  const alt = Pl.keoAltitude(world);
  const ring = Pl.ringNodes(world, 'Kerbin', 3, alt, 0, 0, 0, [{ id: 'stock:RelayAntenna100', count: 1 }], 'ring:Kerbin', 'r');
  const hint = Pl.deployHint(world, ring);
  assert.equal(hint.n, 3);
  assert.ok(Math.abs(hint.period - 21549) < 20, 'period ' + hint.period);
  assert.ok(Math.abs(hint.spacing - hint.period / 3) < 1e-6);
  assert.equal(hint.phasing.laps, 1);
  assert.ok(hint.phasing.dv > 140 && hint.phasing.dv < 200, 'dv ' + hint.phasing.dv);
  assert.ok(hint.phasing.otherAltitude > 1.0e6 && hint.phasing.otherAltitude < 1.5e6, 'periapsis ' + hint.phasing.otherAltitude);
  const lines = Pl.deployText(hint, (x) => Math.round(x / 1000) + ' km', (x) => Math.round(x) + ' s');
  assert.ok(lines.length === 2 && /release relay 1/.test(lines[1]));
  assert.equal(Pl.deployHint(world, []), null);
});

test('deployHint: a low ring with many relays needs several laps to keep periapsis above the atmosphere', () => {
  const ring = Pl.ringNodes(world, 'Kerbin', 4, 100000, 90, 0, 0, [{ id: 'stock:RelayAntenna100', count: 1 }], 'ring:Kerbin', 'r');
  const hint = Pl.deployHint(world, ring);
  assert.ok(hint.phasing.laps > 1, 'laps ' + hint.phasing.laps);
  assert.ok(hint.phasing.otherAltitude >= hint.minAltitude);
});

test('deployHint: solar relays get a heliocentric phasing estimate', () => {
  const k = world.index.get('Kerbin');
  const nodes = [60, -60].map((off, i) => ({ id: 's' + i, loc: { type: 'orbit', body: 'Kerbol', orbit: { a: k.orbit.a, e: 0, i: 0, lan: 0, w: 0, m0: k.orbit.m0 + off * Math.PI / 180, epoch: 0 } } }));
  const hint = Pl.deployHint(world, nodes);
  assert.ok(hint.solar);
  assert.ok(hint.phasing.dv > 500 && hint.phasing.dv < 3000, 'dv ' + hint.phasing.dv);
});

test('evaluateGen reports per-vessel uptime and causes for a what-if node set', () => {
  const probe = { id: 'lander', name: 'Far-side lander', tracked: true, loc: { type: 'landed', body: 'Mun', lat: 10, lon: 47.436 + 180, alt: 0 }, antennas: [{ id: 'stock:HighGainAntenna', count: 1 }] };
  const base = Pl.runSync(Pl.evaluateGen({ world, lookup, settings, nodes: [probe], t0: 0, horizon: 4 * Data.DAY, minSignal: 0.1 }));
  assert.equal(base.worst, 0);
  assert.equal(base.causes.causes[0].id, 'occ:Mun');
  const ring = Pl.ringNodes(world, 'Mun', 3, 300000, 0, 0, 0, [{ id: 'stock:RelayAntenna100', count: 2 }], 'ring:Mun', 'm').map((n) => Object.assign(n, { tracked: false }));
  const fixed = Pl.runSync(Pl.evaluateGen({ world, lookup, settings, nodes: [probe].concat(ring), t0: 0, horizon: 4 * Data.DAY, minSignal: 0.1 }));
  assert.ok(fixed.worst > 0.9, 'with relays ' + fixed.worst);
});

test('budget: a relay cap drops the least valuable fixes and reports it; per-vessel targets are checked', () => {
  const world = createWorld({});
  const lookup = (id) => Data.antennas.find((a) => a.id === id);
  const node = { id: 'l', name: 'Far-side lander', tracked: true, loc: { type: 'landed', body: 'Mun', lat: 10, lon: 227.436, alt: 0 }, antennas: [{ id: 'stock:HighGainAntenna', count: 1 }] };
  const base = { world, lookup, settings: { dsnPower: 50e9, occVac: 0.9, occAtm: 0.75 }, nodes: [node], t0: 0, horizon: 20 * Data.DAY, target: 0.99, robust: false };
  const full = Pl.runSync(Pl.planGen(Object.assign({}, base, { targets: { 'Far-side lander': 0.5 } })));
  const nFull = full.planned.length;
  assert.ok(nFull >= 3);
  assert.equal(full.budget, null);
  assert.equal(full.targets.length, 1);
  const capped = Pl.runSync(Pl.planGen(Object.assign({}, base, { limits: { maxRelays: nFull - 1 } })));
  assert.ok(capped.planned.length <= nFull - 1);
  assert.ok(capped.budget && capped.budget.dropped.length >= 1 && capped.budget.satisfied);
  const none = Pl.runSync(Pl.planGen(Object.assign({}, base, { limits: { maxRelays: 1 } })));
  assert.ok(none.planned.length <= 1 && none.budget.satisfied);
});

test('ringNodes can build elliptical relay orbits: periapsis at the low altitude, apoapsis at the high one', () => {
  const mun = world.index.get('Mun');
  const nodes = Pl.ringNodes(world, 'Mun', 2, 100e3, 90, 0, 0, [{ id: 'stock:RelayAntenna50', count: 1 }], 'ring:Mun', 'Mun relay', 400e3);
  assert.equal(nodes.length, 2);
  const o = nodes[0].loc.orbit;
  assert.ok(o.e > 0.2, 'eccentric ' + o.e);
  assert.ok(Math.abs(o.a * (1 - o.e) - (mun.radius + 100e3)) < 1);
  assert.ok(Math.abs(o.a * (1 + o.e) - (mun.radius + 400e3)) < 1);
});
