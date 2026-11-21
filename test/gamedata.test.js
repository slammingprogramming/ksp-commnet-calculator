// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
// Regression test: the built-in body, spin and ground-station data against values read from the game's own data files.
// The numbers below were read from KSP 1.12.5 (build 03190): the body prefabs in KSP_x64_Data/sharedassets9.assets and the
// Making History asset bundle, with tools/unityscan. They are facts about the game, kept here so edits can't drift from it.
const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../js/data.js');
const World = require('../js/world.js');

// radius (m), GeeASL, orbit [inc deg, ecc, sma m, LAN deg, argPe deg, mean anomaly at epoch rad], initialRotation (deg at UT 0), tidallyLocked
const PREFAB = {
  Pol:     { radius: 44000, gee: 0.03801298, orbit: [4.25, 0.17085, 1.7989e+08, 2, 15, 0.9], rot0: 25, locked: true },
  Bop:     { radius: 65000, gee: 0.06002049, orbit: [15, 0.235, 1.285e+08, 10, 25, 0.9], rot0: 230, locked: true },
  Tylo:    { radius: 600000, gee: 0.8002733, orbit: [0.025, 0, 6.85e+07, 0, 0, 3.14], rot0: 0, locked: true },
  Vall:    { radius: 300000, gee: 0.2350803, orbit: [0, 0, 4.3152e+07, 0, 0, 0.9], rot0: 0, locked: true },
  Laythe:  { radius: 500000, gee: 0.8002733, orbit: [0, 0, 2.7184e+07, 0, 0, 3.14], rot0: 90, locked: true },
  Ike:     { radius: 130000, gee: 0.1120383, orbit: [0.2, 0.03, 3200000, 0, 0, 1.7], rot0: 0, locked: true },
  Minmus:  { radius: 60000, gee: 0.05001708, orbit: [6, 0, 4.7e+07, 78, 38, 0.9], rot0: 230, locked: false },
  Mun:     { radius: 200000, gee: 0.1660567, orbit: [0, 0, 1.2e+07, 0, 0, 1.7], rot0: 230, locked: true },
  Gilly:   { radius: 13000, gee: 0.005001708, orbit: [12, 0.55, 3.15e+07, 80, 10, 0.9], rot0: 5, locked: false },
  Eeloo:   { radius: 210000, gee: 0.1720588, orbit: [6.15, 0.26, 9.011882e+10, 50, 260, 3.14], rot0: 25, locked: false },
  Jool:    { radius: 6000000, gee: 0.8002733, orbit: [1.304, 0.05, 6.877356e+10, 52, 0, 0.1], rot0: 0, locked: false },
  Dres:    { radius: 138000, gee: 0.1150393, orbit: [5, 0.145, 4.083935e+10, 280, 90, 3.14], rot0: 25, locked: false },
  Duna:    { radius: 320000, gee: 0.3001025, orbit: [0.06, 0.051, 2.072616e+10, 135.5, 0, 3.14], rot0: 90, locked: false },
  Kerbin:  { radius: 600000, gee: 1.000342, orbit: [0, 0, 1.359984e+10, 0, 0, 3.14], rot0: 90, locked: false },
  Eve:     { radius: 700000, gee: 1.700581, orbit: [2.1, 0.01, 9.832685e+09, 15, 0, 3.14], rot0: 0, locked: false },
  Moho:    { radius: 250000, gee: 0.2750939, orbit: [7, 0.2, 5.263138e+09, 70, 15, 3.14], rot0: 190, locked: false },
};

test("stock bodies match the game's prefabs: radius, orbit elements, initial rotation, lock", () => {
  const byId = new Map(Data.bodies.filter((b) => b.pack === 'stock').map((b) => [b.id, b]));
  for (const [id, p] of Object.entries(PREFAB)) {
    const b = byId.get(id);
    assert.ok(b, id + ' missing');
    assert.equal(b.radius, p.radius, id + ' radius');
    // GM = GeeASL * 9.80665 * r^2 holds for every stock body (to the precision of the stored GeeASL float)
    assert.ok(Math.abs(b.gm / (p.gee * p.radius * p.radius) - 9.80665) < 1e-4, id + ' GM vs GeeASL');
    const o = b.orbit, q = p.orbit;
    const same = (x, y, what) => assert.ok(Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(y)), id + ' ' + what + ' ' + x + ' vs ' + y);
    same(o.i, q[0], 'inclination'); same(o.e, q[1], 'eccentricity'); same(o.a, q[2], 'sma');
    same(o.lan, q[3], 'LAN'); same(o.w, q[4], 'argPe'); same(o.m0, q[5], 'mean anomaly');
    assert.equal(b.rot0, p.rot0, id + ' initialRotation');
    assert.equal(b.rot === 'locked', p.locked, id + ' tidally locked');
  }
});

test("every stock body has the game's initial rotation, so no spin phase is a guess", () => {
  const w = World.createWorld({ packs: {} });
  for (const b of w.bodies) assert.equal(b.approxSpin, false, b.id);
  assert.equal(w.index.get('Kerbin').rot0, 90);
  assert.equal(w.index.get('Mun').rot0, 230);
});

test("the permanent ground stations come from Making History's data (fixed 40k, not DSN-rated)", () => {
  const st = (id) => Data.STATIONS.find((s) => s.id === id);
  assert.deepEqual([st('Desert').kind, st('Desert').power, st('Desert').lat, st('Desert').lon, st('Desert').alt], ['permanent', 40000, -6.56, -143.95, 820]);
  assert.deepEqual([st('Larkes').kind, st('Larkes').power, st('Larkes').lat, st('Larkes').lon], ['permanent', 40000, 44.72, 137.03]);
  // Baikerbanur ("KSC2") is not permanent in the game data: DSN-rated, present only with extra ground stations
  assert.equal(st('Baikerbanur').kind, 'anomaly');
  assert.equal(Data.STATIONS.filter((s) => s.kind === 'permanent').length, 2);
});
