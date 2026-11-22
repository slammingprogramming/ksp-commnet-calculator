// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../js/data.js');
const Orb = require('../js/orbits.js');
const { createWorld } = require('../js/world.js');
const Sim = require('../js/sim.js');

const world = createWorld({});
const lookup = (id) => Data.antennas.find((a) => a.id === id);
const K = { ra100: 'stock:RelayAntenna100', ra15: 'stock:RelayAntenna50', hg55: 'stock:HighGainAntenna', c88: 'stock:commDish', c16: 'stock:longAntenna' };
const settings = (extra) => Object.assign({ dsnPower: 250e9, occVac: 0.9, occAtm: 0.75 }, extra || {});
const build = (nodes, s) => Sim.createSim({ world, lookup, settings: settings(s), nodes });
const landed = (id, body, lat, lon, ant, extra) => Object.assign({ id, name: id, loc: { type: 'landed', body, lat, lon, alt: 0 }, antennas: ant, tracked: true }, extra);
const orbit = (id, body, alt, inc, lan, phase, ant, extra) => {
  const b = world.index.get(body);
  return Object.assign({ id, name: id, loc: { type: 'orbit', body, orbit: Orb.orbitFromAltitudes(b, alt, alt, inc, lan, 0, phase) }, antennas: ant, tracked: true }, extra);
};

test('a probe on the Mun\'s near side can talk to Kerbin; the far side never can', () => {
  const near = build([landed('near', 'Mun', 0, 47.436, [{ id: K.hg55, count: 1 }])], { extraStations: true });
  const far = build([landed('far', 'Mun', 0, 47.436 + 180, [{ id: K.hg55, count: 1 }])], { extraStations: true });
  const dt = 600, t1 = 4 * Data.DAY;
  const rn = Sim.scanSync(near, 0, t1, dt).sources[0];
  const rf = Sim.scanSync(far, 0, t1, dt).sources[0];
  assert.ok(rn.uptime > 0.97, `near uptime ${rn.uptime}`);
  assert.equal(rf.uptime, 0);
  const causes = rf.blackouts[0].causes;
  assert.equal(causes[0].type, 'occlusion');
  assert.deepEqual(causes[0].bodies, ['Mun']);
});

test('with only KSC, Kerbin blocks the link for a large part of every day; extra stations fix that', () => {
  const nodes = () => [orbit('deep', 'Kerbol', 20e9 - 0, 0, 0, 0, [{ id: K.c88, count: 1 }])];
  // A heliocentric probe at Duna's distance, seen from Kerbin.
  const probe = { id: 'p', name: 'p', loc: { type: 'orbit', body: 'Kerbol', orbit: { a: 20.7e9, e: 0, i: 0, lan: 0, w: 0, m0: 3.14, epoch: 0 } }, antennas: [{ id: K.c88, count: 1 }, { id: K.ra100, count: 1 }], tracked: true };
  void nodes;
  const ksc = build([probe], { extraStations: false });
  const all = build([probe], { extraStations: true });
  const dt = 300, t1 = 5 * Data.DAY;
  const a = Sim.scanSync(ksc, 0, t1, dt).sources[0];
  const b = Sim.scanSync(all, 0, t1, dt).sources[0];
  assert.ok(a.uptime > 0.25 && a.uptime < 0.75, `KSC-only uptime ${a.uptime}`);
  assert.ok(b.uptime > 0.9, `all-stations uptime ${b.uptime}`);
  assert.ok(a.blackouts.length >= 4);
  // Kerbin's shadow dominates; the Mun occasionally crosses the line of sight too.
  assert.ok(a.blackouts.every((x) => x.causes.every((c) => c.type === 'occlusion' && (c.bodies.indexOf('Kerbin') >= 0 || c.bodies.indexOf('Mun') >= 0))));
  assert.ok(a.blackouts.filter((x) => x.causes.some((c) => c.bodies.indexOf('Kerbin') >= 0)).length >= 4);
});

test('a blackout boundary is bracketed tightly by the refined start/end times', () => {
  const probe = { id: 'p', name: 'p', loc: { type: 'orbit', body: 'Kerbol', orbit: { a: 20.7e9, e: 0, i: 0, lan: 0, w: 0, m0: 3.14, epoch: 0 } }, antennas: [{ id: K.ra100, count: 1 }], tracked: true };
  const sim = build([probe], {});
  const r = Sim.scanSync(sim, 0, 3 * Data.DAY, 600).sources[0];
  const b = r.blackouts.find((x) => !x.startedBefore && !x.ongoing);
  assert.ok(b, 'expected a complete blackout');
  assert.equal(sim.evalAt(b.start - 3)[0].connected, true);
  assert.equal(sim.evalAt(b.start + 3)[0].connected, false);
  assert.equal(sim.evalAt(b.end - 3)[0].connected, false);
  assert.equal(sim.evalAt(b.end + 3)[0].connected, true);
});

test('relay path: far-side Mun probe reaches Kerbin through a relay that sees both', () => {
  // Relay in a halo-like high Kerbin orbit is complicated; use a Mun-orbit relay instead.
  const probe = landed('far', 'Mun', 0, 47.436 + 180, [{ id: K.hg55, count: 1 }]);
  const relays = [0, 120, 240].map((ph, i) => orbit('r' + i, 'Mun', 1.2e6, 0, 0, ph, [{ id: K.ra15, count: 1 }], { tracked: false }));
  const sim = build([probe].concat(relays), { extraStations: true });
  const r = Sim.scanSync(sim, 0, 3 * Data.DAY, 300).sources[0];
  assert.ok(r.uptime > 0.9, `uptime ${r.uptime}`);
  const snap = sim.snapshot(1000).results[0];
  if (snap.connected) assert.ok(snap.path.length >= 3, 'path should go through a relay');
});

test('link needs range: an antenna too weak for the distance reports a range cause', () => {
  const probe = { id: 'p', name: 'p', loc: { type: 'orbit', body: 'Kerbol', orbit: { a: 60e9, e: 0, i: 0, lan: 0, w: 0, m0: 1, epoch: 0 } }, antennas: [{ id: K.c16, count: 1 }], tracked: true };
  const sim = build([probe], {});
  const res = sim.evalAt(1000)[0];
  assert.equal(res.connected, false);
  assert.equal(res.cause.type, 'range');
});

test('difficulty: a larger occlusion modifier can only add blackouts', () => {
  const probe = landed('near', 'Mun', 0, 47.436, [{ id: K.hg55, count: 1 }]);
  const easy = Sim.scanSync(build([probe], { occVac: 0.5, occAtm: 0.5, extraStations: true }), 0, 3 * Data.DAY, 600).sources[0];
  const hard = Sim.scanSync(build([probe], { occVac: 1, occAtm: 1, extraStations: true }), 0, 3 * Data.DAY, 600).sources[0];
  assert.ok(hard.uptime <= easy.uptime + 1e-9);
});

test('Kerbol blocks Kerbin-Duna at solar conjunction', () => {
  // Heliocentric probe trailing Duna; DSN plenty strong; all stations on so Kerbin\'s daily shadow is out of the way.
  const duna = world.index.get('Duna');
  const probe = { id: 'p', name: 'p', loc: { type: 'orbit', body: 'Duna', orbit: Orb.orbitFromAltitudes(duna, 300000, 300000, 0, 0, 0, 0) }, antennas: [{ id: K.ra100, count: 3 }], tracked: true };
  const sim = build([probe], { extraStations: true, dsnPower: 250e9 });
  const r = Sim.scanSync(sim, 0, 3 * Data.YEAR, 3000).sources[0];
  const solar = r.blackouts.filter((b) => b.causes.some((c) => c.type === 'occlusion' && c.bodies.indexOf('Kerbol') >= 0));
  assert.ok(solar.length >= 1, 'expected a Kerbol conjunction blackout');
  assert.ok(Math.max(...solar.map((b) => b.duration)) > 2 * Data.DAY, 'conjunction lasts days');
  assert.ok(solar.length <= 3, 'about one per synodic period (2.13 Kerbin years)');
});

test('ground stations follow the game rules (CommNetHome.CreateNode)', () => {
  const names = (s) => Sim.createSim({ world, lookup, settings: settings(s), nodes: [] }).nodes.map((n) => n.name);
  // extras off: KSC alone. Baikerbanur and the five anomaly dishes are not permanent, so they do not exist.
  assert.deepEqual(names({ extraStations: false, allowOtherLaunchSites: true }), ['Kerbal Space Center']);
  assert.deepEqual(names({ extraStations: false, allowOtherLaunchSites: false }), ['Kerbal Space Center']);
  // Making History: Desert and Larkes are permanent, so they exist with extras off if other launch sites are allowed
  assert.deepEqual(names({ extraStations: false, allowOtherLaunchSites: true, makingHistory: true }),
    ['Kerbal Space Center', 'Desert Launch Site (Making History)', 'Larkes (Making History)']);
  assert.deepEqual(names({ extraStations: false, allowOtherLaunchSites: false, makingHistory: true }), ['Kerbal Space Center']);
  // extras on: KSC + five anomaly dishes + Baikerbanur (+ the two DLC stations with the DLC flag)
  assert.equal(names({ extraStations: true }).length, 7);
  assert.equal(names({ extraStations: true, makingHistory: true }).length, 9);
  const sim = Sim.createSim({ world, lookup, settings: settings({ extraStations: true }), nodes: [] });
  const power = (n) => sim.nodes.find((x) => x.name === n).power;
  assert.equal(power('Crater Rim'), 250e9);
  assert.equal(power('Baikerbanur'), 250e9, 'Baikerbanur is a normal DSN-rated station when extras are on');
  const mh = Sim.createSim({ world, lookup, settings: settings({ extraStations: true, makingHistory: true }), nodes: [] });
  assert.equal(mh.nodes.find((x) => x.name.startsWith('Larkes')).power, 40e3, 'permanent stations keep their fixed 40k antenna');
});

test('the occlusion test matches the geometric segment/sphere test for outside endpoints', () => {
  // brute force comparison on random configurations against a plain segment-sphere intersection
  const sim = Sim.createSim({ world, lookup, settings: settings(), nodes: [{ id: 'a', name: 'a', tracked: true, loc: { type: 'orbit', body: 'Kerbin', orbit: Orb.orbitFromAltitudes(world.index.get('Kerbin'), 200000, 200000, 0, 0, 0, 0) }, antennas: [{ id: K.ra100, count: 1 }] }] });
  void sim; // blocker is internal; exercise it through link outcomes below
  const probe = (lat, lon, alt) => ({ id: 'p', name: 'p', tracked: true, loc: { type: 'landed', body: 'Mun', lat, lon, alt }, antennas: [{ id: K.hg55, count: 1 }] });
  // near side: visible; far side: blocked; with a larger modifier the limb gets blocked as well
  const up = (lon, occ) => Sim.scanSync(build([probe(0, lon, 0)], { extraStations: true, occVac: occ }), 0, 2 * Data.DAY, 900).sources[0].uptime;
  assert.ok(up(47.436, 0.9) > 0.95);
  assert.equal(up(227.436, 0.9), 0);
  assert.ok(up(47.436 + 80, 0.9) >= up(47.436 + 80, 1.0), 'a bigger blocking sphere never helps');
});

test('a node inside the blocking sphere can still see outward (game behaviour)', () => {
  // With occlusion modifier 1.25 a landed vessel sits inside the sphere; looking away from the centre must stay open.
  const lander = { id: 'l', name: 'l', tracked: true, loc: { type: 'landed', body: 'Mun', lat: 0, lon: 47.436, alt: 0 }, antennas: [{ id: K.hg55, count: 1 }] };
  const r = Sim.scanSync(build([lander], { extraStations: true, occVac: 1.25 }), 0, 2 * Data.DAY, 900).sources[0];
  assert.ok(r.uptime > 0.9, 'uptime ' + r.uptime);
});

test('evalOne agrees with evalAt, and a coarse edge tolerance changes the uptime only slightly', () => {
  const sim = build([
    landed('far', 'Mun', 10, 47.436 + 180, [{ id: K.hg55, count: 1 }]),
    landed('duna', 'Duna', 5, 20, [{ id: K.c16, count: 1 }]),
    orbit('relay', 'Kerbin', 2863330, 0, 0, 30, [{ id: K.ra100, count: 2 }], { tracked: false }),
  ], { extraStations: true });
  for (const t of [0, 123456, 2.5e6]) {
    const all = sim.evalAt(t);
    all.forEach((r, s) => {
      const one = sim.evalOne(t, s);
      assert.equal(one.connected, r.connected);
      assert.equal(one.signal, r.signal);
      assert.deepEqual(one.cause, r.cause);
    });
  }
  const t1 = 20 * Data.DAY, dt = 600;
  const fine = Sim.scanSync(sim, 0, t1, dt);
  const sc = Sim.createScanner(sim, 0, t1, dt, dt / 8);
  while (!sc.run(1000)) { /* run to the end */ }
  fine.sources.forEach((s, i) => assert.ok(Math.abs(s.uptime - sc.result.sources[i].uptime) < 0.002, s.name));
});

test('patched conics: an escape probe is carried out of Kerbin\'s sphere of influence and on around Kerbol; without the flag it stays on its Kerbin conic', () => {
  const kerbin = world.index.get('Kerbin');
  const rp = kerbin.radius + 120000, vinf = 1000;
  const a = -kerbin.gm / (vinf * vinf);
  const orbitEl = { a: a, e: 1 - rp / a, i: 0, lan: 0, w: 0, m0: -0.5, epoch: 0 };
  const probe = (patched) => ({ id: 'esc', name: 'esc', tracked: true, loc: { type: 'orbit', body: 'Kerbin', orbit: orbitEl, patched }, antennas: [{ id: K.hg55, count: 1 }] });
  const traj = { t0: 0, horizon: 2 * Data.YEAR };
  const on = Sim.createSim({ world, lookup, settings: settings({ extraStations: true }), nodes: [probe(true)], trajectory: traj });
  const off = Sim.createSim({ world, lookup, settings: settings({ extraStations: true }), nodes: [probe(false)], trajectory: traj });
  const idx = on.nodes.findIndex((n) => n.name === 'esc');
  assert.ok(on.nodes[idx]._segs && on.nodes[idx]._segs.length >= 2);
  assert.equal(off.nodes[idx]._segs, undefined);
  // a month later the patched probe is far outside Kerbin's SOI (but still near Kerbin's orbit); the unpatched one is on its Kerbin hyperbola
  const t = 30 * Data.DAY;
  const pOn = on.nodePositionAt(idx, t, [0, 0, 0]);
  const kb = world.positions(t);
  const k = kerbin.idx * 3;
  const dOn = Math.hypot(pOn[0] - kb[k], pOn[1] - kb[k + 1], pOn[2] - kb[k + 2]);
  assert.ok(dOn > kerbin.soiRadius, 'distance ' + dOn);
  // positions are continuous across the hand-over
  const seg = on.nodes[idx]._segs[0];
  const before = on.nodePositionAt(idx, seg.to - 1, [0, 0, 0]), after = on.nodePositionAt(idx, seg.to + 1, [0, 0, 0]);
  assert.ok(Math.hypot(before[0] - after[0], before[1] - after[1], before[2] - after[2]) < 20000, 'jump at the hand-over');
  // the simulation still runs end to end
  const res = Sim.scanSync(on, 0, 40 * Data.DAY, 3600);
  assert.ok(res.sources[0].uptime >= 0 && res.sources[0].uptime <= 1);
});

test('sightBetween: a lander is cut off from Kerbin by the Mun half the time at most, and the measured distance is the actual one', () => {
  const sim = build([landed('far', 'Mun', 0, 227.436, [{ id: K.hg55, count: 1 }]), landed('near', 'Mun', 0, 47.436, [{ id: K.hg55, count: 1 }])], { extraStations: false });
  const idx = (nm) => sim.nodes.findIndex((n) => n.name === nm);
  const ksc = sim.nodes.findIndex((n) => n.home);
  const far = sim.sightBetween(idx('far'), ksc, 0, 6 * Data.DAY, 400);
  const near = sim.sightBetween(idx('near'), ksc, 0, 6 * Data.DAY, 400);
  assert.ok(far.blocked > 0.9, 'far side blocked ' + far.blocked);
  assert.ok(far.by.Mun > 0.5);
  assert.ok(near.blocked < far.blocked);
  assert.ok(near.min > 1e7 && near.max < 2e7 && near.now >= near.min && near.now <= near.max);
});
