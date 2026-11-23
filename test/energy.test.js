// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../js/data.js');
const Orb = require('../js/orbits.js');
const CD = require('../js/career-data.js');
const ED = require('../js/energy-data.js');
const Career = require('../js/career.js');
const En = require('../js/energy.js');
const { createWorld } = require('../js/world.js');

const world = createWorld({});
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' vs ' + b);
const orbit = (id, alt, inc) => ({ type: 'orbit', body: id, orbit: Orb.orbitFromAltitudes(world.index.get(id), alt, alt, inc || 0, 0, 0, 0) });

test('energy data: the numbers the game\'s part configs give', () => {
  assert.equal(ED.rtg.rtg, 0.75);
  assert.deepEqual(ED.cells.FuelCell, { ec: 1.5, lf: 0.0016875, ox: 0.0020625 });
  assert.equal(ED.solar.largeSolarPanel.rate, 24.4);
  assert.equal(ED.solar.solarPanels5.tracking, false, 'the OX-STAT panels are fixed');
  assert.equal(ED.solar.solarPanels2.tracking, true);
  assert.equal(ED.batteries.batteryBankLarge, 4000);
  assert.equal(ED.cores.probeCoreOcto2_v2, 0.03);
  assert.equal(ED.converters.ISRU, 30);
  for (const id of Object.keys(ED.solar)) assert.ok(CD.parts.some((p) => p.id === id), id + ' is a part the career data knows');
});

test('sunlight in a low Kerbin orbit: a third of it in the planet\'s shadow, none of it dimmer than home', () => {
  const p = En.lightProfile(world, orbit('Kerbin', 100000));
  // the shadow of a sphere of radius R seen from r: half-angle asin(R/r); the share in shadow is that over 180 degrees
  const eclipse = Math.asin(600000 / 700000) / Math.PI;
  near(1 - p.share.mean, eclipse, 0.02);
  near(p.flux.min, 1, 0.03, 'Kerbin\'s own distance, give or take its eccentricity');
  near(p.dark.max, eclipse * p.cycle, p.cycle * 0.03);
  near(p.tracking.min, p.share.min * p.flux.mean, 0.03);
  // a panel that does not track gets the orientation factor on top
  near(En.lightProfile(world, orbit('Kerbin', 100000), { orientation: 0.25 }).fixed.min / p.tracking.min, 0.25, 0.01);
});

test('a moon\'s eclipses come from its planet and from the real geometry', () => {
  const p = En.lightProfile(world, orbit('Mun', 80000));
  near(1 - p.share.max, Math.asin(200000 / 280000) / Math.PI, 0.02, 'the Mun hides the sun from an 80 km orbit');
  assert.ok(p.share.min >= 0.7 && p.dark.max > 600);
  // a polar orbit meets the shadow only in some seasons: its share spans a wider range than the equatorial one
  const polar = En.lightProfile(world, orbit('Kerbin', 100000, 90));
  assert.ok(polar.share.max - polar.share.min > 0.1, 'seasons change a polar orbit\'s eclipses: ' + polar.share.min + ' to ' + polar.share.max);
  assert.equal(polar.share.max, 1, 'in some season a polar orbit stays in the sun');
});

test('on the ground: half the time lit, a flat panel gets the sine of the sun\'s height', () => {
  const k = En.lightProfile(world, { type: 'landed', body: 'Kerbin', lat: 0, lon: 0, alt: 0 });
  near(k.share.mean, 0.5, 0.03);
  near(k.cycle, 21600, 200, 'a Kerbin solar day is its 6 hours');
  near(k.fixed.mean / k.tracking.mean, 2 / Math.PI, 0.05, 'the mean of sin over the lit half');
  const mun = En.lightProfile(world, { type: 'landed', body: 'Mun', lat: 0, lon: 0, alt: 0 });
  assert.ok(mun.cycle > 100000 && mun.dark.max > 50000, 'a long Munar night: ' + mun.dark.max + ' s');
});

test('far from the star the light follows the inverse square of the distance', () => {
  const duna = En.lightProfile(world, { type: 'space', body: 'Duna' });
  const d = world.index.get('Duna').orbit, home = world.index.get('Kerbin').orbit.a;
  near(duna.flux.min, Math.pow(home / (d.a * (1 + d.e)), 2), 0.01, 'dimmest at the far end of its orbit');
  near(duna.flux.max, Math.pow(home / (d.a * (1 - d.e)), 2), 0.01);
  assert.equal(duna.share.min, 1);
  const moho = En.lightProfile(world, { type: 'space', body: 'Moho' });
  assert.ok(moho.flux.min > 4 && moho.flux.max > 9, 'Moho gets many times Kerbin\'s light');
  const around = En.lightProfile(world, { type: 'orbit', body: 'Kerbol', orbit: { a: 20e9, e: 0, i: 0, lan: 0, w: 0, m0: 0, epoch: 0 } });
  near(around.flux.mean, Math.pow(home / 20e9, 2), 1e-3, 'a vessel orbiting the star');
});

test('the career decides which parts count', () => {
  const s = Career.newState('normal');
  assert.equal(En.partStatus(s, 'rtg').status, 'research');
  assert.equal(En.partStatus(s, 'rtg').node, 'experimentalElectrics');
  s.tech.push('electrics');
  assert.equal(En.partStatus(s, 'solarPanels5').status, 'buy');
  assert.equal(En.partStatus(s, 'solarPanels5').funds, CD.parts.find((p) => p.id === 'solarPanels5').entry);
  s.parts.push('solarPanels5');
  assert.equal(En.partStatus(s, 'solarPanels5').status, 'have');
  assert.equal(En.partStatus(null, 'rtg').status, 'have');
  assert.equal(En.partStatus({ mode: 'sandbox', tech: [], parts: [] }, 'rtg').status, 'have');
});

test('design: panels sized for the dimmest time, batteries for the longest darkness, RTG and fuel cell as alternatives', () => {
  const prof = En.lightProfile(world, orbit('Mun', 80000));
  const loads = [{ label: 'core', ec: 0.03, duty: 1 }, { label: 'wheel', ec: 0.5, duty: 0.1 }];
  const d = En.design({ profile: prof, loads: loads, state: null, margin: 0.15, burstMin: 5 });
  near(d.avg, 0.08, 1e-9);
  near(d.peak, 0.53, 1e-9);
  near(d.darkEnergy, 0.08 * prof.dark.max * 1.15, 1e-9);
  near(d.burstEnergy, 0.45 * 300, 1e-9);
  assert.ok(d.options.length >= 8);
  for (let i = 1; i < d.options.length; i++) assert.ok(d.options[i].mass >= d.options[i - 1].mass, 'lightest first');
  for (const o of d.options.filter((x) => x.kind === 'solar')) {
    assert.ok(o.generation >= d.need - 1e-9, 'the panels make at least the load with the spare');
    assert.ok(o.battery >= d.darkEnergy + d.burstEnergy - 1e-9, 'the batteries carry the darkness and the burst');
    const panel = ED.solar[o.parts[0].id];
    near(o.perPanel, panel.rate * (panel.tracking ? prof.tracking.min : prof.fixed.min), 1e-9);
  }
  const rtg = d.options.find((o) => o.kind === 'rtg');
  assert.equal(rtg.parts[0].n, Math.ceil(d.need / 0.75), 'enough RTGs for the load');
  assert.equal(rtg.battery >= d.burstEnergy, true);
  const fc = d.options.find((o) => o.kind === 'fuelcell' && o.parts[0].id === 'FuelCell');
  near(fc.fuel, (0.08 / 1.5) * (0.0016875 + 0.0020625) * 0.005 * 30 * Data.DAY, 1e-9, 'propellant by the cell\'s own rates');
});

test('design: far from the sun the dim panels need more of them, an RTG does not care', () => {
  const loads = [{ label: 'x', ec: 1, duty: 1 }];
  const near_ = En.design({ profile: En.lightProfile(world, { type: 'space', body: 'Kerbin' }), loads: loads, state: null });
  const far = En.design({ profile: En.lightProfile(world, { type: 'space', body: 'Eeloo' }), loads: loads, state: null });
  const n = (d, k, id) => d.options.find((o) => o.kind === k && o.parts[0].id === id).parts[0].n;
  assert.ok(n(far, 'solar', 'solarPanels4') >= 40 * n(near_, 'solar', 'solarPanels4'), 'Eeloo\'s dimmest light is about 1.4% of Kerbin\'s');
  assert.equal(n(far, 'rtg', 'rtg'), n(near_, 'rtg', 'rtg'));
  assert.equal(far.options[0].kind, 'rtg', 'at Eeloo the lightest answer is an RTG');
});

test('design: only what the career has, unless asked for the rest', () => {
  const prof = En.lightProfile(world, orbit('Kerbin', 100000));
  const loads = [{ label: 'core', ec: 0.03, duty: 1 }];
  const s = Career.newState('normal');
  assert.equal(En.design({ profile: prof, loads: loads, state: s }).options.length, 0, 'a new career has no panel or battery');
  s.tech.push('electrics', 'basicScience');
  s.parts.push('solarPanels5', 'batteryPack');
  const some = En.design({ profile: prof, loads: loads, state: s });
  assert.ok(some.options.length >= 1 && some.options.every((o) => o.kind === 'solar' && o.parts.every((p) => ['solarPanels5', 'batteryPack'].indexOf(p.id) >= 0)));
  const all = En.design({ profile: prof, loads: loads, state: Career.newState('normal'), allowUnlock: true });
  assert.ok(all.options.some((o) => o.kind === 'rtg' && o.needs.indexOf('experimentalElectrics') >= 0), 'the RTG needs its node researched');
  assert.ok(all.options.every((o) => o.funds >= 0));
});

test('antennas draw charge only while sending: packet cost over packet interval', () => {
  const a = Data.antennas.find((x) => x.id === 'stock:longAntenna');
  near(En.transmitEC(a), a.pktEC / a.pktInterval, 1e-12);
  assert.equal(En.transmitEC(null), 0);
  const cat = En.loadCatalogue();
  assert.ok(cat.some((c) => c.id === 'core:probeCoreOcto2_v2' && c.ec === 0.03));
  assert.ok(cat.some((c) => c.id === 'isru:ISRU' && c.ec === 30));
  assert.ok(cat.some((c) => c.id === 'drill:RadialDrill'));
});
