// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Share = require('../js/share.js');

const sample = {
  ut: 1234,
  nodes: [
    { id: 'n1', name: 'Duna probe', tracked: true, loc: { type: 'orbit', body: 'Duna', pe: 150000, ap: 150000, i: 0, lan: 0, w: 0, phase: 10 }, antennas: [{ id: 'stock:RelayAntenna100', count: 2 }] },
    { id: 'n2', name: 'Lander', tracked: true, loc: { type: 'landed', body: 'Mun', lat: 10, lon: 227.4, alt: 0 }, antennas: [{ id: 'stock:HighGainAntenna', count: 1 }] },
    { id: 'n3', name: 'Relay', tracked: false, planned: true, group: 'ring:Mun', loc: { type: 'orbit', body: 'Mun', pe: 500000, ap: 500000, i: 90, lan: 0, w: 0, phase: 0 }, antennas: [] },
  ],
};

test('export then parse round-trips and drops internal ids', () => {
  const json = JSON.stringify(Share.exportScenario(sample, { dsnLevel: 3, extraStations: true, junk: 1 }, '1.1.0'));
  const r = Share.parseScenario(json);
  assert.ok(!r.error, r.error);
  assert.equal(r.scenario.ut, 1234);
  assert.equal(r.scenario.nodes.length, 3);
  assert.deepEqual(r.scenario.nodes[0].loc, sample.nodes[0].loc);
  assert.deepEqual(r.scenario.nodes[0].antennas, [{ id: 'stock:RelayAntenna100', count: 2 }]);
  assert.equal(r.scenario.nodes[2].planned, true);
  assert.equal(r.scenario.nodes[2].group, 'ring:Mun');
  assert.deepEqual(r.settings, { dsnLevel: 3, extraStations: true });
  assert.ok(!('id' in r.scenario.nodes[0]));
});

test('base64url round-trips arbitrary bytes and text with non-ASCII characters', () => {
  for (const len of [0, 1, 2, 3, 4, 5, 100, 1001]) {
    const b = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 255);
    assert.deepEqual(Array.from(Share.fromBase64Url(Share.toBase64Url(b))), Array.from(b), 'len ' + len);
  }
  const s = JSON.stringify({ n: 'Kerbal ✦ Ünïcode' });
  assert.equal(Share.unutf8(Share.fromBase64Url(Share.toBase64Url(Share.utf8(s)))), s);
  assert.equal(Share.fromBase64Url('abc$'), null);
  assert.equal(Share.fromBase64Url('a'), null);
});

test('hostile or malformed input is rejected or sanitised', () => {
  assert.ok(Share.parseScenario('{').error);
  assert.ok(Share.parseScenario('[]').error);
  assert.ok(Share.parseScenario('{"format":"other","version":1,"nodes":[]}').error);
  assert.ok(Share.parseScenario('{"format":"kspcomm-scenario","version":99,"nodes":[]}').error);
  assert.ok(Share.parseScenario('x'.repeat(Share.MAX_TEXT_BYTES + 1)).error);
  const evil = {
    format: 'kspcomm-scenario', version: 1, ut: 'abc', __proto__: { polluted: true },
    nodes: [
      { name: '<img src=x onerror=alert(1)>\u0007' + 'A'.repeat(500), loc: { type: 'orbit', body: 'Kerbin', pe: 1e99, ap: -5, i: 'x', extra: 1 }, antennas: [{ id: 'bad id<script>', count: 5 }, { id: 'stock:ok', count: 1e9 }], constructor: 'x' },
      { name: 'no body', loc: { type: 'landed', body: '../../etc', lat: 0, lon: 0 } },
      { name: 'bad type', loc: { type: 'teleport', body: 'Kerbin' } },
      null, 7,
    ],
    settings: { dsnLevel: 99, rangeMod: 'NaN', sunOccludes: 'yes', evil: 1 },
  };
  const r = Share.parseScenario(JSON.stringify(evil));
  assert.ok(!r.error);
  assert.equal(r.scenario.nodes.length, 1);
  const n = r.scenario.nodes[0];
  assert.ok(n.name.length <= 60);
  assert.ok(!/[\u0000-\u001f]/.test(n.name));
  assert.equal(n.loc.pe, 1e13);
  assert.equal(n.loc.ap, 0);
  assert.equal(n.loc.i, 0);
  assert.ok(!('extra' in n.loc));
  assert.deepEqual(n.antennas, [{ id: 'stock:ok', count: 99 }]);
  assert.equal(r.scenario.ut, 0);
  assert.deepEqual(r.settings, { dsnLevel: 3, rangeMod: 1, sunOccludes: false }); // unparseable numbers fall back to a neutral value
  assert.equal(({}).polluted, undefined);
  assert.ok(r.warnings.length >= 2);
});

test('the node count is capped and unknown antennas are flagged', () => {
  const nodes = Array.from({ length: 500 }, (_, i) => ({ name: 'n' + i, loc: { type: 'landed', body: 'Kerbin', lat: 0, lon: i }, antennas: [{ id: 'mod:nope', count: 1 }] }));
  const r = Share.parseScenario({ format: 'kspcomm-scenario', version: 1, nodes: nodes }, (id) => id !== 'mod:nope');
  assert.equal(r.scenario.nodes.length, Share.MAX_NODES);
  assert.ok(r.warnings.some((w) => /not available/.test(w)));
});
