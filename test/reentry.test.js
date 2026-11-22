// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../js/data.js');
const R = require('../js/reentry.js');

const kerbin = Data.bodies.find((b) => b.id === 'Kerbin');

test('atmosphere curves reproduce the game: Kerbin sea-level density 1.225 and the pressure/temperature at the top', () => {
  const a = R.air('Kerbin', 0);
  assert.ok(Math.abs(a.density - 1.225) < 0.002, 'density ' + a.density);
  assert.equal(a.pressure, 101.325);
  assert.equal(a.temperature, 288.15);
  assert.ok(Math.abs(a.sound - 340.3) < 0.5, 'speed of sound ' + a.sound);
  assert.equal(R.air('Kerbin', 70000).density, 0);
  assert.ok(R.air('Kerbin', 10000).density < R.air('Kerbin', 5000).density);
  assert.ok(R.air('Eve', 0).density > 5 && R.air('Duna', 0).density < 0.2);
});

test('plasma rules: nothing below the 1100 K / 500 thresholds, full at 2500, partial in between', () => {
  assert.equal(R.plasma('Kerbin', 30000, 500), 0);            // far too cool
  assert.equal(R.plasma('Kerbin', 65000, 3000), 0);           // hot but the air is too thin (qv < 500)
  assert.ok(R.plasma('Kerbin', 20000, 2000) > 0);
  assert.equal(R.plasma('Kerbin', 10000, 3000), 1);
  assert.equal(R.signalModifier(0, 0), 1);
  assert.equal(R.signalModifier(0.5, 0), 0);                  // plasma > 0.5 blacks the link out
  assert.ok(R.signalModifier(0.25, 0) > 0 && R.signalModifier(0.25, 0) < 1);
  assert.equal(R.signalModifier(1, 160), 1);                  // link behind the vessel: unaffected
  assert.equal(R.signalModifier(1, 90), 0);
});

test('a typical low-orbit return blacks out between roughly 25 and 55 km, and a slow entry never does', () => {
  const e = R.entry(kerbin, { speed: 2250, angle: 6, ballistic: 400 });
  assert.ok(e.landed && e.blackout);
  assert.ok(e.blackout.start.alt > 35000 && e.blackout.start.alt < 65000, 'start ' + e.blackout.start.alt);
  assert.ok(e.blackout.end.alt > 15000 && e.blackout.end.alt < 35000, 'end ' + e.blackout.end.alt);
  assert.ok(e.blackout.duration > 20 && e.blackout.duration < 300);
  const slow = R.entry(kerbin, { speed: 400, angle: 30, ballistic: 400 });
  assert.equal(slow.plasma, null);
  const behind = R.entry(kerbin, { speed: 2250, angle: 6, ballistic: 400, link: 160 });
  assert.equal(behind.blackout, null);
  const cool = R.entry(kerbin, { speed: 2250, angle: 6, ballistic: 400, heat: 0.3 });
  assert.ok(!cool.blackout || cool.blackout.duration < e.blackout.duration);
});

test('entry from an orbit: periapsis above the atmosphere never enters; the angle follows angular momentum', () => {
  assert.equal(R.entryFromOrbit(kerbin, 80000, 200000), null);
  const e = R.entryFromOrbit(kerbin, 30000, 100000);
  assert.ok(e.angle > 0 && e.angle < 10 && e.speed > 2200 && e.speed < 2500);
  const f = R.entryFromOrbit(kerbin, 30000, null, 1000);
  assert.ok(f.speed > 3000 && f.angle > e.angle);
});

test('minimum plasma speed is a few hundred to a couple of thousand m/s and the speed limit is consistent with the trajectory', () => {
  for (const id of ['Kerbin', 'Eve', 'Duna', 'Laythe', 'Jool']) {
    const m = R.minimumPlasmaSpeed(id);
    assert.ok(m.speed > 400 && m.speed < 3000, id + ' ' + m.speed);
  }
  const o = { angle: 6, ballistic: 400 };
  const lim = R.speedLimit(kerbin, o, 'full');
  assert.ok(lim.limit > 0 && lim.limit < lim.feasibleMax);
  assert.equal(R.entry(kerbin, Object.assign({ speed: lim.limit * 0.98 }, o)).blackout, null);
  assert.ok(R.entry(kerbin, Object.assign({ speed: lim.limit * 1.1 }, o)).blackout);
});

test('the altitude-speed map marks the blacked-out region', () => {
  const m = R.map('Kerbin', { maxSpeed: 6000 });
  const flat = [].concat(...m.grid);
  assert.ok(flat.some((x) => x === 0) && flat.some((x) => x === 1));
});
