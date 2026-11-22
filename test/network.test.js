// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../js/data.js');
const Orb = require('../js/orbits.js');
const { createWorld } = require('../js/world.js');
const Sim = require('../js/sim.js');
const Net = require('../js/network.js');

const world = createWorld({});
const lookup = (id) => Data.antennas.find((a) => a.id === id);
const settings = (x) => Object.assign({ dsnPower: 50e9, occVac: 0.9, occAtm: 0.75, extraStations: false, allowOtherLaunchSites: false, makingHistory: false }, x || {});
const ra100 = 'stock:RelayAntenna100', hg5 = 'stock:HighGainAntenna';
const orbit = (id, body, alt, phase, ant, extra) => Object.assign({ id, name: id, tracked: true, loc: { type: 'orbit', body, orbit: Orb.orbitFromAltitudes(world.index.get(body), alt, alt, 0, 0, 0, phase) }, antennas: ant }, extra);
const landed = (id, body, lat, lon, ant, extra) => Object.assign({ id, name: id, tracked: true, loc: { type: 'landed', body, lat, lon, alt: 0 }, antennas: ant }, extra);

test('connectivity: stations are one network, relays join the backbone, endpoints attach with their own antennas', () => {
  const nodes = [
    orbit('relay', 'Kerbin', 2863330, 0, [{ id: ra100, count: 2 }], { tracked: false }),
    landed('probe', 'Mun', 0, 47.4, [{ id: hg5, count: 1 }]),
    landed('far', 'Mun', 0, 227.4, [{ id: hg5, count: 1 }]),
  ];
  const sim = Sim.createSim({ world, lookup, settings: settings(), nodes });
  const idx = (name) => sim.nodes.findIndex((n) => n.name === name);
  const n = sim.nodes.length;
  let near = 0, far = 0, nearHome = 0, farHome = 0;
  for (let t = 0; t < 6 * Data.DAY; t += 3600) {
    const c = sim.connectivityAt(t);
    near += c.pair[idx('probe') * n + idx('relay')]; far += c.pair[idx('far') * n + idx('relay')];
    nearHome += c.home[idx('probe')]; farHome += c.home[idx('far')];
    assert.equal(c.pair[idx('probe') * n + idx('far')], c.pair[idx('far') * n + idx('probe')], 'symmetric');
  }
  assert.ok(near > far, 'the near-side lander sees the Kerbin relay more often than the far side');
  assert.ok(nearHome > farHome);
});

test('interconnect: uptimes are fractions, symmetric, and a vessel next to the KSC always reaches the DSN', () => {
  const nodes = [landed('near-ksc', 'Kerbin', -0.1, -74.6, [{ id: hg5, count: 1 }]), orbit('lko', 'Kerbin', 200000, 0, [{ id: ra100, count: 1 }])];
  const sim = Sim.createSim({ world, lookup, settings: settings(), nodes });
  const r = Net.interconnect(sim, 0, 3 * Data.DAY);
  const k = r.names.length - 1;
  assert.equal(r.names[k].startsWith('DSN'), true);
  for (let i = 0; i <= k; i++) for (let j = 0; j <= k; j++) { assert.ok(r.uptime[i][j] >= 0 && r.uptime[i][j] <= 1); assert.equal(r.uptime[i][j], r.uptime[j][i]); }
  assert.equal(r.uptime[0][k], 1);
});

test('redundancy: losing the only relay costs the lander its link; a spare relay is not critical', () => {
  const lander = landed('lander', 'Mun', 0, 47.4, [{ id: hg5, count: 1 }]);
  const relay = orbit('relay', 'Kerbin', 2863330, 0, [{ id: ra100, count: 2 }], { tracked: false });
  const r = Net.redundancy({ world, lookup, settings: settings(), nodes: [lander, relay] }, 0, 8 * Data.DAY);
  assert.equal(r.rows.length, 1);
  assert.ok(r.rows[0].lost.some((l) => l.name === 'lander' && l.after < l.before));
  assert.ok(r.rows[0].critical || r.rows[0].lost[0].before - r.rows[0].lost[0].after > 0.005);
});

test('station variants: more stations never lower the uptime; custom and overridden stations are honoured', () => {
  const nodes = [landed('far-side', 'Duna', 0, 20, [{ id: 'stock:commDish', count: 1 }])];
  const v = Net.stationVariants({ world, lookup, settings: settings(), nodes }, 0, 4 * Data.DAY);
  assert.equal(v.length, 4);
  assert.ok(v[3].mean >= v[0].mean - 1e-9 && v[2].mean >= v[0].mean - 1e-9);
  assert.ok(v[3].stations > v[0].stations);
  const off = Sim.createSim({ world, lookup, settings: settings({ stationOverride: { KSC: false } }), nodes });
  assert.equal(off.homeCount, 0);
  const custom = Sim.createSim({ world, lookup, settings: settings({ customStations: [{ id: 'x', name: 'Mine', lat: 10, lon: 20, power: 2e9 }] }), nodes });
  assert.equal(custom.homeCount, 2);
});
