// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Orb = require('../js/orbits.js');
const Tr = require('../js/transfer.js');
const { createWorld } = require('../js/world.js');

const world = createWorld({});

test('Lambert: a transfer along a circular orbit returns the circular speed at both ends', () => {
  const mu = 3.986004418e14, R = 7000e3, th = 1.0, n = Math.sqrt(mu / (R * R * R));
  const l = Tr.lambert(mu, [R, 0, 0], [R * Math.cos(th), R * Math.sin(th), 0], th / n, false);
  assert.ok(l);
  const vc = Math.sqrt(mu / R);
  assert.ok(Math.abs(Math.hypot(l.v1[0], l.v1[1], l.v1[2]) - vc) / vc < 1e-4);
  assert.ok(Math.abs(Math.hypot(l.v2[0], l.v2[1], l.v2[2]) - vc) / vc < 1e-4);
  assert.ok(l.v1[1] > 0, 'prograde about +z');
});

test('Kerbin to Duna: windows come about one synodic period apart and the cheapest total delta-v is a plausible interplanetary budget', () => {
  const r = Tr.windows(world, 'Kerbin', 'Duna', 0, 6 * Orb.YEAR, { parkAlt: 100000, captureAlt: 100000 });
  assert.ok(r.windows.length >= 2, 'windows ' + r.windows.length);
  for (let i = 1; i < r.windows.length; i++) assert.ok(Math.abs(r.windows[i].depart - r.windows[i - 1].depart - r.synodic) < 0.25 * r.synodic);
  const best = r.windows.reduce((m, w) => (w.total < m.total ? w : m));
  assert.ok(best.dvDepart > 900 && best.dvDepart < 1500, 'departure dv ' + best.dvDepart);
  assert.ok(best.total > 1100 && best.total < 2600, 'total ' + best.total);
  assert.ok(best.tof > 0.3 * r.hohmann && best.tof < 2.2 * r.hohmann);
});

test('windows are only offered between bodies with the same parent', () => {
  assert.equal(Tr.windows(world, 'Kerbin', 'Mun', 0, Orb.YEAR, {}), null);
  assert.equal(Tr.windows(world, 'Kerbin', 'Kerbin', 0, Orb.YEAR, {}), null);
});
