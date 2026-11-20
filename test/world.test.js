// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Orb = require('../js/orbits.js');
const { createWorld } = require('../js/world.js');
const Data = require('../js/data.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} !~ ${b}`);
const stock = createWorld({});
const opm = createWorld({ packs: { opm: true } });

test('Kepler solver inverts Kepler\'s equation, including high eccentricity', () => {
  for (const e of [0, 0.1, 0.55, 0.9, 0.99]) {
    for (const M of [-3, -1, 0, 0.5, 2, 3.1, 6.0]) {
      const E = Orb.solveKepler(M, e);
      const back = E - e * Math.sin(E);
      const wrapped = ((M + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      near(back, wrapped, 1e-9);
    }
  }
});

test('orbital periods match the wiki (Kerbin 9,203,545 s; Mun 138,984 s; Duna 17,315,400 s)', () => {
  near(stock.index.get('Kerbin').orbitalPeriod, 9203545, 2e-6);
  near(stock.index.get('Mun').orbitalPeriod, 138984, 1e-5);
  near(stock.index.get('Duna').orbitalPeriod, 17315400, 1e-5);
  near(stock.index.get('Jool').orbitalPeriod, 104661432, 1e-5);
});

test('spheres of influence match the wiki within rounding', () => {
  near(stock.index.get('Kerbin').soiRadius, 84159286, 1e-4);
  near(stock.index.get('Mun').soiRadius, 2429559, 1e-4);
  near(stock.index.get('Duna').soiRadius, 47921949, 1e-4);
  near(stock.index.get('Jool').soiRadius, 2455985200, 1e-4);
});

test('a circular orbit keeps a constant distance; an eccentric one stays within pe/ap', () => {
  const pos = new Float64Array(stock.bodies.length * 3);
  const k = stock.index.get('Kerbin').idx, m = stock.index.get('Mun').idx, mm = stock.index.get('Minmus').idx;
  const dist = (i, j) => Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 1] - pos[j * 3 + 1], pos[i * 3 + 2] - pos[j * 3 + 2]);
  for (const t of [0, 12345, 5e6, 2e7]) {
    stock.positions(t, pos);
    near(dist(k, m), 12e6, 1e-9);
    near(dist(k, mm), 47e6, 1e-9);
  }
  const gilly = stock.index.get('Gilly'), e = stock.index.get('Eve').idx;
  let lo = Infinity, hi = 0;
  for (let t = 0; t < 400000; t += 2000) {
    stock.positions(t, pos);
    const d = dist(gilly.idx, e);
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  assert.ok(lo >= 14175000 - 1 && hi <= 48825000 + 1, `${lo} ${hi}`);
  assert.ok(lo < 16e6 && hi > 46e6);
});

test('the Mun\'s sub-Kerbin point stays at 47.44 E (tidal lock)', () => {
  const mun = stock.index.get('Mun'), k = stock.index.get('Kerbin');
  const pos = new Float64Array(stock.bodies.length * 3), p = [0, 0, 0];
  for (const t of [0, 40000, 1e6, 8.8e6]) {
    stock.positions(t, pos);
    let bestLon = 0, bestD = Infinity;
    for (let lon = -180; lon < 180; lon += 0.25) {
      stock.surfacePoint(mun, 0, lon, 0, t, pos, p);
      const d = Math.hypot(p[0] - pos[k.idx * 3], p[1] - pos[k.idx * 3 + 1], p[2] - pos[k.idx * 3 + 2]);
      if (d < bestD) { bestD = d; bestLon = lon; }
    }
    assert.ok(Math.abs(bestLon - 47.436) < 0.6, `t=${t} lon=${bestLon}`);
  }
});

test('Kerbin spins once per sidereal day', () => {
  const kb = stock.index.get('Kerbin');
  near(stock.rotationAngle(kb, 21549.425) - stock.rotationAngle(kb, 0), 2 * Math.PI, 1e-9);
});

test('geometric distance extremes reproduce the values the community sheet lists', () => {
  const chk = (a, b, min, max) => {
    const d = stock.distanceRange(a, b);
    near(d.min, min, 2e-3);
    near(d.max, max, 2e-3);
  };
  chk('Kerbin', 'Duna', 6069283350, 35383028257);
  chk('Kerbin', 'Jool', 51735042066, 85812077664);
  chk('Kerbin', 'Eeloo', 53183306389, 127081753657);
  chk('Kerbin', 'Eve', 3668828971, 23530851543);
  assert.equal(stock.distanceRange('Kerbin', 'Mun').max, 12000000);
  near(stock.distanceRange('Kerbin', 'Gilly').max, 23579676543, 2e-3); // Eve max + Gilly Ap
  const lt = stock.distanceRange('Laythe', 'Tylo');
  assert.equal(lt.max, 27184000 + 68500000);
  assert.equal(lt.min, 68500000 - 27184000);
});

test('OPM: Eeloo moves to orbit Sarnus; extra bodies only appear when enabled', () => {
  assert.equal(stock.index.get('Eeloo').parent, 'Kerbol');
  assert.equal(stock.index.get('Sarnus'), undefined);
  assert.equal(opm.index.get('Eeloo').parent, 'Sarnus');
  assert.ok(opm.index.get('Plock') && opm.index.get('Tal').depth === 3);
  near(opm.distanceRange('Kerbin', 'Tal').max, 279487929474, 2e-3);
});

test('every pair of bodies has a valid distance range', () => {
  for (const w of [stock, opm]) {
    for (const a of w.bodies) for (const b of w.bodies) {
      const d = w.distanceRange(a.id, b.id);
      assert.ok(d && d.max >= d.min && d.min >= 0, `${a.id}-${b.id}`);
    }
  }
});

test('altitude limits: above the atmosphere, or 25 km on airless bodies', () => {
  assert.equal(stock.altitudeLimits('Kerbin').min, 75000);
  assert.equal(stock.altitudeLimits('Mun').min, 25000);
});

test('calendar helpers round-trip', () => {
  assert.equal(Orb.formatUT(0), 'Y1 D1 00:00:00');
  assert.equal(Orb.formatUT(Data.YEAR + Data.DAY * 2 + 3661), 'Y2 D3 01:01:01');
  assert.equal(Orb.parseUT('Y2 D3 01:01:01'), Data.YEAR + Data.DAY * 2 + 3661);
  assert.equal(Orb.parseUT('D30'), 29 * Data.DAY);
  assert.equal(Orb.parseUT('12345'), 12345);
  assert.ok(Number.isNaN(Orb.parseUT('nonsense')));
  assert.equal(Orb.formatDuration(3700), '1h 1m 40s');
});

test('actual separation at a time lies between the closest and farthest ever', () => {
  for (const t of [0, 3e6, 2e7, 9e7]) {
    const d = stock.distanceAt('Kerbin', 'Duna', t);
    const r = stock.distanceRange('Kerbin', 'Duna');
    assert.ok(d >= r.min * 0.999 && d <= r.max * 1.001, `t=${t} d=${d}`);
  }
  near(stock.distanceAt('Kerbin', 'Mun', 12345), 12e6, 1e-9);
});
