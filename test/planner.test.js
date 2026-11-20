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
