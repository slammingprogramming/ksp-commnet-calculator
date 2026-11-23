// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Orb = require('../js/orbits.js');
const Traj = require('../js/trajectory.js');
const { createWorld } = require('../js/world.js');

const world = createWorld({});
const kerbin = world.index.get('Kerbin');
const duna = world.index.get('Duna');
const kerbol = world.index.get('Kerbol');

/** Absolute (Kerbol-frame) state of a segment's vessel at time t, built from body states up the tree. */
function absState(seg, t) {
  const r = Orb.position(seg.p, t, [0, 0, 0]), v = Orb.velocity(seg.p, t, [0, 0, 0]);
  for (let b = seg.body; b.parentBody; b = b.parentBody) {
    const br = Orb.position(b._p, t, [0, 0, 0]), bv = Orb.velocity(b._p, t, [0, 0, 0]);
    for (let k = 0; k < 3; k++) { r[k] += br[k]; v[k] += bv[k]; }
  }
  return { r, v };
}

test('a bound low Kerbin orbit has a single segment', () => {
  const segs = Traj.build(world, 'Kerbin', Orb.orbitFromAltitudes(kerbin, 100000, 100000, 0, 0, 0, 0), 0, 5 * Orb.YEAR);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].from, -Infinity);
  assert.equal(segs[0].to, Infinity);
});

test('an escape trajectory leaves Kerbin\'s sphere of influence and continues around Kerbol with continuous position and velocity', () => {
  // periapsis 120 km above Kerbin, v_inf ~ 1 km/s
  const rp = kerbin.radius + 120000;
  const vinf = 1000;
  const a = -kerbin.gm / (vinf * vinf);
  const e = 1 - rp / a;
  const orbit = { a: a, e: e, i: 0, lan: 0, w: 0, m0: -0.5, epoch: 0 };
  const segs = Traj.build(world, 'Kerbin', orbit, 0, 2 * Orb.YEAR);
  assert.ok(segs.length >= 2, 'segments ' + segs.length);
  assert.equal(segs[0].body.id, 'Kerbin');
  assert.equal(segs[1].body.id, 'Kerbol');
  const t = segs[0].to;
  const r = Orb.position(segs[0].p, t, [0, 0, 0]);
  assert.ok(Math.abs(Math.hypot(...r) - kerbin.soiRadius) < 50, 'exit at the SOI radius');
  const s1 = absState(segs[0], t), s2 = absState(segs[1], t);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(s1.r[k] - s2.r[k]) < 10, 'position ' + k);
    assert.ok(Math.abs(s1.v[k] - s2.v[k]) < 1e-2, 'velocity ' + k);
  }
  assert.ok(segs[1].orbit.e < 1 && segs[1].orbit.a > 0, 'bound heliocentric orbit');
});

test('a heliocentric orbit that drifts into Duna\'s sphere of influence is handed over to Duna at the SOI edge', () => {
  const o = duna.orbit;
  // same orbit, slightly larger, a little ahead of Duna on a slower orbit: Duna catches up and it slides past Duna over the next years
  const orbit = { a: o.a * 1.001, e: o.e, i: o.i, lan: o.lan, w: o.w, m0: o.m0 + 0.0075, epoch: o.epoch };
  const segs = Traj.build(world, 'Kerbol', orbit, 0, 4 * Orb.YEAR);
  const enc = segs.find((s) => s.body.id === 'Duna');
  assert.ok(enc, 'bodies: ' + segs.map((s) => s.body.id).join(','));
  // such a slow encounter is captured (relative speed below Duna's escape speed at the SOI edge), a fast one is not
  assert.ok(isFinite(enc.orbit.a) && enc.orbit.e > 0);
  const t = enc.from;
  const r = Orb.position(enc.p, t, [0, 0, 0]);
  assert.ok(Math.abs(Math.hypot(...r) - duna.soiRadius) < 50, 'enters at the SOI radius');
  const i = segs.indexOf(enc);
  const s1 = absState(segs[i - 1], t), s2 = absState(enc, t);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(s1.r[k] - s2.r[k]) < 10);
    assert.ok(Math.abs(s1.v[k] - s2.v[k]) < 1e-2);
  }
  if (enc.orbit.e > 1 || enc.orbit.a * (1 + enc.orbit.e) > duna.soiRadius) assert.ok(segs[i + 1] && segs[i + 1].body.id === 'Kerbol');
  assert.equal(Traj.segmentAt(segs, t - 100), segs[i - 1]);
  assert.equal(Traj.segmentAt(segs, t + 100), enc);
});

test('a Kerbol orbit far from every planet stays one segment', () => {
  const segs = Traj.build(world, 'Kerbol', { a: 4e12, e: 0.05, i: 3, lan: 0, w: 0, m0: 1, epoch: 0 }, 0, 20 * Orb.YEAR);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].body, kerbol);
});

test('burns: a prograde burn from low Kerbin orbit raises the apoapsis; a big one escapes to a Kerbol orbit', () => {
  const orbit = Orb.orbitFromAltitudes(kerbin, 100000, 100000, 0, 0, 0, 0);
  const t = 5000;
  const small = Traj.build(world, 'Kerbin', orbit, 0, 2 * Orb.YEAR, [{ t: t, prograde: 200, normal: 0, radial: 0 }]);
  assert.equal(small.length, 2);
  assert.ok(Math.abs(small[0].to - t) < 1e-6);
  assert.ok(small[1].orbit.a > small[0].orbit.a && small[1].orbit.e > 0.01 && small[1].orbit.e < 1);
  // position and velocity are continuous across the burn except for the delta-v
  const before = absState(small[0], t), after = absState(small[1], t);
  assert.ok(Math.hypot(before.r[0] - after.r[0], before.r[1] - after.r[1], before.r[2] - after.r[2]) < 1);
  assert.ok(Math.abs(Math.hypot(after.v[0] - before.v[0], after.v[1] - before.v[1], after.v[2] - before.v[2]) - 200) < 1e-3);
  const big = Traj.build(world, 'Kerbin', orbit, 0, 2 * Orb.YEAR, [{ t: t, prograde: 1000, normal: 0, radial: 0 }]);
  assert.ok(big.length >= 3 && big[big.length - 1].body.id === 'Kerbol', 'segments ' + big.map((s) => s.body.id).join('>'));
  // a normal burn tilts the plane
  const tilt = Traj.build(world, 'Kerbin', orbit, 0, Orb.YEAR, [{ t: t, prograde: 0, normal: 500, radial: 0 }]);
  assert.ok(Math.abs(tilt[1].orbit.i) > 5);
  // burns outside the horizon are ignored
  assert.equal(Traj.build(world, 'Kerbin', orbit, 0, 1000, [{ t: 5000, prograde: 100 }]).length, 1);
});

test('finite burn: a burn spread over its duration reaches nearly the same orbit as the impulse, a little less efficiently', () => {
  const Traj2 = require('../js/trajectory.js'), W2 = require('../js/world.js'), Orb3 = require('../js/orbits.js');
  const w = W2.createWorld({});
  const kerbin = w.index.get('Kerbin');
  const orbit = Orb3.orbitFromAltitudes(kerbin, 100000, 100000, 0, 0, 0, 0);
  const imp = Traj2.build(w, 'Kerbin', orbit, 0, 40000, [{ t: 5000, prograde: 400 }]);
  const fin = Traj2.build(w, 'Kerbin', orbit, 0, 40000, [{ t: 5000, prograde: 400, duration: 300 }]);
  assert.ok(fin.length > imp.length, 'a finite burn is several pulses');
  const last = (s) => s[s.length - 1].orbit;
  const apoImp = last(imp).a * (1 + last(imp).e), apoFin = last(fin).a * (1 + last(fin).e);
  assert.ok(apoFin < apoImp * 1.0001 && apoFin > apoImp * 0.9, 'same ballpark, not higher than the impulse: ' + apoFin + ' vs ' + apoImp);
});
