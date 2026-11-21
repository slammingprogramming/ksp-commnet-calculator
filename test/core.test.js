// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/core.js');
const Data = require('../js/data.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} !~ ${b}`);
const byName = (n) => Data.antennas.find((a) => a.name.startsWith(n));
const lookup = (id) => Data.antennas.find((a) => a.id === id);
const id = (n) => byName(n).id;

test('signal curve endpoints and midpoint', () => {
  assert.equal(Core.signalStrength(0, 100), 1);
  assert.equal(Core.signalStrength(100, 100), 0);
  assert.equal(Core.signalStrength(150, 100), 0);
  near(Core.signalStrength(50, 100), 0.5); // x = 0.5 -> 3/4 - 2/8 = 0.5
});

test('link range is the geometric mean (wiki max-range table)', () => {
  near(Core.linkRange(100e9, 100e9), 100e9);
  near(Core.linkRange(2e9, 100e9), 14.142e9, 1e-4); // RA-100 to DSN level 1: 14.14 Gm
  near(Core.linkRange(250e9, 15e9), 61.237e9, 1e-4); // HG-55 to DSN level 3: 61.24 Gm
  near(Core.linkRange(50e9, 5e6), 500e6, 1e-6); // HG-5 to DSN level 2: 500 Mm
});

test('100% signal range is ~0.0414 x range (wiki approximation)', () => {
  const r = 100e9;
  const d = 0.0414 * r;
  assert.ok(Core.signalStrength(d, r) >= 0.995);
});

test('combined power reproduces the wiki example (two 88-88, DSN level 3, Jool at 73.4 Gm = 71%)', () => {
  const stats = Core.vesselStats([{ id: id('Communotron 88-88'), count: 2 }], lookup, 1);
  near(stats.own, 1.68179283051e11, 1e-9);
  const range = Core.linkRange(250e9, stats.own);
  near(range, 205048337625, 1e-6);
  near(Core.signalStrength(73.4e9, range), 0.707, 1e-2);
});

test('weighted exponent (wiki example: 88-88 + Communotron 16)', () => {
  const c = Core.combine([{ power: 100e9, exp: 0.75, count: 1 }, { power: 5e5, exp: 1, count: 1 }]);
  near(c.exp, 0.75000125, 1e-9);
});

test('a single antenna is not changed by combining', () => {
  near(Core.combine([{ power: 15e9, exp: 0.75, count: 1 }]).power, 15e9);
});

test('two identical combinable antennas give 2^0.75', () => {
  near(Core.combine([{ power: 15e9, exp: 0.75, count: 2 }]).power, 15e9 * Math.pow(2, 0.75));
  // old sheet's example: HG-55 + RA-15 = 25,226,892,458
  near(Core.combine([{ power: 15e9, exp: 0.75, count: 1 }, { power: 15e9, exp: 0.75, count: 1 }]).power, 25226892458, 1e-8);
});

test('Communotron 16-S (not combinable) does not stack', () => {
  const one = Core.vesselStats([{ id: id('Communotron 16-S'), count: 1 }], lookup, 1).own;
  const four = Core.vesselStats([{ id: id('Communotron 16-S'), count: 4 }], lookup, 1).own;
  near(one, 5e5);
  near(four, 5e5);
});

test('relay power counts relay antennas only; own power counts everything', () => {
  const s = Core.vesselStats([{ id: id('Communotron 88-88'), count: 1 }, { id: id('RA-100'), count: 1 }], lookup, 1);
  near(s.own, 100e9 * Math.pow(2, 0.75), 1e-9);
  near(s.relay, 100e9, 1e-9);
  const direct = Core.vesselStats([{ id: id('Communotron 88-88'), count: 1 }], lookup, 1);
  assert.equal(direct.relay, 0);
});

test('empty vessel falls back to the 5k built-in antenna', () => {
  assert.equal(Core.vesselStats([], lookup, 1).own, 5000);
});

test('difficulty modifiers: range scales vessels, DSN modifier scales the DSN only', () => {
  const s = Core.vesselStats([{ id: id('RA-15'), count: 1 }], lookup, 0.65);
  near(s.own, 15e9 * 0.65);
  near(Core.dsnPower({ level: 2 }, 0.5), 25e9);
});

test('multi-hop chain: product of hop signals, interior nodes only relay', () => {
  const nodes = [
    { kind: 'dsn', level: 3 },
    { kind: 'vessel', antennas: [{ id: id('RA-100'), count: 1 }, { id: id('Communotron 88-88'), count: 1 }] },
    { kind: 'vessel', antennas: [{ id: id('Communotron 16'), count: 1 }] },
  ];
  const res = Core.evaluateChain(nodes, [105e9, 1e6], { lookup, rangeModifier: 1, dsnModifier: 1 });
  // relay vessel contributes only its RA-100 (100 G) when relaying
  near(res.nodes[1].power, 100e9);
  near(res.hops[0].range, Math.sqrt(250e9 * 100e9));
  near(res.total, res.hops[0].signal * res.hops[1].signal);
  assert.ok(res.connected);
});

test('an interior vessel with no relay antenna cannot relay', () => {
  const nodes = [
    { kind: 'dsn', level: 3 },
    { kind: 'vessel', antennas: [{ id: id('Communotron 88-88'), count: 1 }] },
    { kind: 'vessel', antennas: [{ id: id('Communotron 16'), count: 1 }] },
  ];
  const res = Core.evaluateChain(nodes, [1e9, 1e6], { lookup, rangeModifier: 1, dsnModifier: 1 });
  assert.equal(res.connected, false);
  assert.ok(res.hops[0].noRelayB);
});

test('inverse: range for a target signal', () => {
  for (const t of [0.1, 0.5, 0.9]) {
    const r = Core.rangeForSignal(1e9, t);
    near(Core.signalStrength(1e9, r), t, 1e-6);
  }
  near(Core.rangeForSignal(1e9, 0.5), 2e9); // 50% signal <-> x = 0.5
});

test('inverse: power needed against a far end', () => {
  const p = Core.powerForSignal(20e9, 0.8, 50e9);
  const r = Core.linkRange(p, 50e9);
  near(Core.signalStrength(20e9, r), 0.8, 1e-6);
  assert.equal(Core.powerForSignal(1, 0.5, 0), Infinity);
});

test('finder returns minimal setups only, lightest first', () => {
  const antennas = Data.antennas.filter((a) => a.pack === 'stock' && !a.builtin);
  const rows = Core.findSetups({ antennas, farPower: 50e9, distance: 35e9, target: 0.5, role: 'own', maxCount: 4, sort: 'mass' });
  assert.ok(rows.length > 0);
  for (const r of rows) assert.ok(r.signal >= 0.5);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].mass <= rows[i].mass);
  // an antenna list whose reduced setup already qualifies must have been dropped
  for (const r of rows) {
    if (r.setup.length === 2) {
      const single = r.setup.some((c) => {
        const alone = Core.combine([{ power: c.antenna.power, exp: c.antenna.exp, count: c.count }]).power;
        return Core.signalStrength(35e9, Core.linkRange(alone, 50e9)) >= 0.5;
      });
      assert.equal(single, false);
    }
  }
});

test('relay-role finder only proposes relay antennas', () => {
  const antennas = Data.antennas.filter((a) => a.pack === 'stock' && !a.builtin);
  const rows = Core.findSetups({ antennas, farPower: 50e9, distance: 20e9, target: 0.5, role: 'relay', maxCount: 4 });
  assert.ok(rows.length > 0);
  for (const r of rows) for (const c of r.setup) assert.equal(c.antenna.type, 'relay');
});

test('distance and power parsing / formatting', () => {
  assert.equal(Core.parseDistance('35.4 Gm'), 35.4e9);
  assert.equal(Core.parseDistance('12,000 km'), 12e6);
  assert.equal(Core.parseDistance('1.5e10'), 1.5e10);
  assert.equal(Core.parseDistance('700 mm'), 700e6); // people mean megametres
  assert.equal(Core.parseDistance('5 Tm'), 5e12);
  assert.ok(Number.isNaN(Core.parseDistance('abc')));
  assert.ok(Number.isNaN(Core.parseDistance('12 parsecs')));
  assert.equal(Core.parsePower('15G'), 15e9);
  assert.equal(Core.parsePower('500k'), 5e5);
  assert.equal(Core.formatPower(15e9), '15G');
  assert.equal(Core.formatPower(2.5e11), '250G');
  assert.equal(Core.formatPower(5e5), '500k');
  assert.equal(Core.formatDistance(35383028257), '35.4 Gm');
  assert.equal(Core.formatDistance(500), '500 m');
  assert.equal(Core.formatPercent(0.999), '100%');
  assert.equal(Core.formatPercent(0.004), '<1%');
  assert.equal(Core.formatPercent(0), '0%');
});

test('stock antenna data matches the values read from the KSP 1.12.5 part configs', () => {
  const p = (n) => byName(n).power;
  assert.equal(p('Communotron 16'), 5e5);
  assert.equal(p('HG-5'), 5e6);
  assert.equal(p('Communotron DTS-M1'), 2e9);
  assert.equal(p('RA-2'), 2e9);
  assert.equal(p('Communotron HG-55'), 15e9);
  assert.equal(p('RA-15'), 15e9);
  assert.equal(p('Communotron 88-88'), 100e9);
  assert.equal(p('RA-100'), 100e9);
  assert.equal(byName('Communotron 16').exp, 1);
  assert.equal(byName('Communotron 16-S').combinable, false);
  assert.equal(byName('HG-5').type, 'relay');
  assert.equal(byName('Communotron HG-55').type, 'direct');
});

test('antenna ids are unique', () => {
  const ids = Data.antennas.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('antennaPowers follows the game\'s UpdateComm logic', () => {
  const A = (power, type, combinable, exp, count) => ({ power, type, combinable, exp, count });
  // a non-combinable antenna never adds, even next to combinable ones
  const mix = Core.antennaPowers([A(1e9, 'direct', false, 0, 1), A(1e9, 'direct', true, 0.75, 2)]);
  near(mix.own, 1e9 * Math.pow(2, 0.75), 1e-9); // only the two combinable ones stack
  // relay-only vessel: transmit falls back to the built-in 5k, own = relay power
  const r = Core.antennaPowers([A(5e3, 'internal', false, 0, 1), A(15e9, 'relay', true, 0.75, 2)]);
  assert.equal(r.transmit, 5e3);
  near(r.relay, 15e9 * Math.pow(2, 0.75), 1e-9);
  near(r.own, r.relay, 1e-12);
  // direct combinable + relay: everything combinable stacks for the vessel's own link, relays alone for others
  const both = Core.antennaPowers([A(100e9, 'direct', true, 0.75, 1), A(100e9, 'relay', true, 0.75, 1)]);
  near(both.transmit, 100e9 * Math.pow(2, 0.75), 1e-9);
  near(both.relay, 100e9, 1e-12);
  // a lone strong direct antenna beats a weak stack
  assert.equal(Core.antennaPowers([A(2e9, 'direct', true, 0.75, 1), A(5e6, 'relay', true, 0.75, 1)]).own > 2e9, true);
});

test('retracted antennas are ignored and an NFE reflector adds AddedRange x FeedScale to a feed', () => {
  const lk = (id) => Data.antennas.find((a) => a.id === id);
  const ra = (extra) => Object.assign({ id: 'stock:RelayAntenna100', count: 2 }, extra);
  assert.equal(Core.vesselStats([ra()], lk, 1).relay, Core.vesselStats([ra({ retracted: false })], lk, 1).relay);
  const none = Core.vesselStats([ra({ retracted: true })], lk, 1);
  assert.equal(none.own, 5000, 'only the built-in antenna is left');
  assert.equal(none.relay, 0);
  // feed relay antenna: 5k base + 9 G (large reflector) x feed scale 1
  const feed = Core.vesselStats([{ id: 'nfe:nfex-antenna-feeder-relay-1', count: 1, reflector: 'nfe:reflector-large-1' }], lk, 1);
  assert.equal(feed.relay, 5000 + 9e9);
  // a stock RA-100 has feed scale 0.9 (NFE patch); an antenna without a feed ignores the reflector
  const ra100 = Core.vesselStats([{ id: 'stock:RelayAntenna100', count: 1, reflector: 'nfe:reflector-huge-1' }], lk, 1);
  assert.equal(ra100.relay, 100e9 + 0.9 * 100e9);
  const nofeed = Core.vesselStats([{ id: 'stock:HighGainAntenna', count: 1, reflector: 'nfe:reflector-huge-1' }], lk, 1);
  assert.equal(nofeed.own, 15e9);
});
