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
  near(En.lightProfile(world, orbit('Kerbin', 100000), { orientation: 0.25, heat: false }).fixed.min / En.lightProfile(world, orbit('Kerbin', 100000), { heat: false }).tracking.min, 0.25, 0.01);
  // a panel turned away from the sun runs cooler, so it keeps a little more of its output than the angle alone says
  assert.ok(En.lightProfile(world, orbit('Kerbin', 100000), { orientation: 0.25 }).fixed.min / p.tracking.min > 0.25);
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
  // on a world without air the flat panel gets the plain mean of the sine of the sun's height over the lit half
  const vac = En.lightProfile(world, { type: 'landed', body: 'Mun', lat: 0, lon: 0, alt: 0 }, { heat: false });
  near(vac.fixed.mean / vac.tracking.mean, 2 / Math.PI, 0.05, 'the mean of sin over the lit half');
  // with air the low sun is dimmed more than the high sun, so the high sun counts for more in the average
  assert.ok(k.fixed.mean / k.tracking.mean > 2 / Math.PI + 0.01);
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

test('light through the air: the game\'s rule (k / (k + density x air mass x 0.15))', () => {
  const kerbin = world.index.get('Kerbin'), rho = 1.2230948;
  near(En.atmosphereFactor(kerbin, 0, 1, rho), 0.85, 0.001, 'overhead sun at sea level: 1 - solarInsolationAtHome');
  near(En.atmosphereFactor(kerbin, 0, 0.5, rho), 0.7412, 0.002, 'sun 30 degrees up');
  near(En.atmosphereFactor(kerbin, 0, 0.05, rho), 0.348, 0.01, 'sun near the horizon');
  assert.ok(En.atmosphereFactor(kerbin, 20000, 1, rho) > 0.99, 'thin air higher up');
  assert.equal(En.atmosphereFactor(world.index.get('Mun'), 0, 1, rho), 1, 'no air, no dimming');
  const k = En.lightProfile(world, { type: 'landed', body: 'Kerbin', lat: 0, lon: 0, alt: 0 });
  assert.ok(k.air.dense && k.air.factor.mean > 0.7 && k.air.factor.mean < 0.8, 'average over the lit day: ' + k.air.factor.mean);
  const m = En.lightProfile(world, { type: 'landed', body: 'Mun', lat: 0, lon: 0, alt: 0 });
  assert.ok(!m.air.dense && m.air.factor.mean === 1);
  assert.ok(En.lightProfile(world, orbit('Kerbin', 100000)).air.factor.mean === 1, 'in orbit the air is not in the way');
});

test('panel heat: the game\'s temperature curve and a plate estimate', () => {
  near(En.heatEfficiency(300), 1, 1e-6);
  near(En.heatEfficiency(4), 1.2, 1e-6, 'colder than 300 K gives more');
  assert.ok(En.heatEfficiency(600) < 0.75 && En.heatEfficiency(600) > 0.65);
  assert.ok(En.heatEfficiency(2600) <= 0.01 + 1e-9);
  near(En.plateTemperature(1, 1, 2), 331, 2, 'a sun-facing plate at Kerbin\'s distance, two faces radiating');
  near(En.plateTemperature(12, 1, 2) / En.plateTemperature(1, 1, 2), Math.pow(12, 0.25), 0.01);
  const moho = En.lightProfile(world, { type: 'space', body: 'Moho' });
  const cool = En.lightProfile(world, { type: 'space', body: 'Moho' }, { heat: false });
  assert.ok(moho.tracking.min < cool.tracking.min * 0.9, 'panels lose output near Moho: ' + moho.tracking.min + ' vs ' + cool.tracking.min);
  assert.ok(moho.heat.tmax > 500);
  const eeloo = En.lightProfile(world, { type: 'space', body: 'Eeloo' });
  assert.ok(eeloo.tracking.min > En.lightProfile(world, { type: 'space', body: 'Eeloo' }, { heat: false }).tracking.min, 'a cold panel makes a little more');
});

test('charge a part already carries, and electric engines', () => {
  assert.equal(ED.stored.probeCoreOcto2_v2, 5);
  assert.ok(ED.stored.mk1pod_v2 > 0, 'command pods carry charge');
  near(ED.engines.ionEngine.ec, 8.74, 0.01, 'the ion engine draws about 8.7 charge a second at full thrust, as the game says');
  const cat = En.loadCatalogue();
  assert.ok(cat.some((c) => c.id === 'eng:ionEngine' && Math.abs(c.ec - 8.74) < 0.01));
  assert.ok(En.storedCatalogue().some((c) => c.id === 'mk1pod_v2'));
  const prof = En.lightProfile(world, orbit('Kerbin', 100000));
  const loads = [{ label: 'x', ec: 5, duty: 1 }];
  const plain = En.design({ profile: prof, loads: loads, state: null });
  const withPod = En.design({ profile: prof, loads: loads, state: null, stored: 5000 });
  const batCount = (d) => d.options.find((o) => o.kind === 'solar').parts.slice(1).reduce((q, p) => q + p.n, 0);
  assert.ok(batCount(plain) > 0 && batCount(withPod) === 0, 'batteries already on board replace parts');
});

const { parsePowerCfg, mergePower } = require('../js/parsers.js');
const dens = { XenonGas: 0.0001, LiquidFuel: 0.005, Oxidizer: 0.005 };

test('importing a mod\'s power parts', () => {
  const cfg = [
    'PART',
    '{',
    '  name = modPanel',
    '  title = Mod Panel',
    '  mass = 0.02',
    '  cost = 95',
    '  category = Electrical',
    '  TechRequired = x',
    '  entryCost = 240',
    '  MODULE',
    '  {',
    '    name = ModuleDeployableSolarPanel',
    '    sunTracking = false',
    '    chargeRate = 0.7',
    '  }',
    '}',
    'PART',
    '{',
    '  name = modSphere',
    '  title = Round',
    '  mass = 0.01',
    '  category = Electrical',
    '  MODULE',
    '  {',
    '    name = ModuleDeployableSolarPanel',
    '    panelType = SPHERICAL',
    '    chargeRate = 0.3',
    '  }',
    '}',
    'PART',
    '{',
    '  name = modRtg',
    '  title = Mod RTG',
    '  mass = 0.1',
    '  cost = 1000',
    '  MODULE',
    '  {',
    '    name = ModuleRadioisotopeGenerator',
    '    BasePower = 2.0',
    '    HalfLife = 8',
    '  }',
    '}',
    'PART',
    '{',
    '  name = modReactor',
    '  title = Mod Reactor',
    '  mass = 1',
    '  category = Electrical',
    '  MODULE',
    '  {',
    '    name = ModuleSystemHeatFissionReactor',
    '    ElectricalGeneration',
    '    {',
    '      key = 0 0',
    '      key = 100 60',
    '    }',
    '  }',
    '  RESOURCE',
    '  {',
    '    name = ElectricCharge',
    '    amount = 10',
    '    maxAmount = 10',
    '  }',
    '}',
    'PART',
    '{',
    '  name = modBattery',
    '  title = Mod Battery',
    '  mass = 0.05',
    '  category = Electrical',
    '  RESOURCE',
    '  {',
    '    name = ElectricCharge',
    '    amount = 500',
    '    maxAmount = 500',
    '  }',
    '}',
    'PART',
    '{',
    '  name = modIon',
    '  title = Mod Ion',
    '  mass = 0.25',
    '  MODULE',
    '  {',
    '    name = ModuleEnginesFX',
    '    maxThrust = 2',
    '    PROPELLANT',
    '    {',
    '      name = ElectricCharge',
    '      ratio = 1.8',
    '    }',
    '    PROPELLANT',
    '    {',
    '      name = XenonGas',
    '      ratio = 0.1',
    '    }',
    '    atmosphereCurve',
    '    {',
    '      key = 0 4200',
    '      key = 1 100',
    '    }',
    '  }',
    '}',
    'PART',
    '{',
    '  name = modCell',
    '  title = Mod Cell',
    '  mass = 0.05',
    '  MODULE',
    '  {',
    '    name = ModuleResourceConverter',
    '    INPUT_RESOURCE',
    '    {',
    '      ResourceName = LiquidFuel',
    '      Ratio = 0.002',
    '    }',
    '    OUTPUT_RESOURCE',
    '    {',
    '      ResourceName = ElectricCharge',
    '      Ratio = 2',
    '    }',
    '  }',
    '}',
  ].join('\n');
  const r = parsePowerCfg(cfg, dens);
  assert.deepEqual(r.solar.modPanel, { rate: 0.7, tracking: false });
  assert.equal(r.solar.modSphere.fixed, 0.25, 'the game gives a spherical panel a fixed 0.25');
  assert.equal(r.rtg.modRtg, 2);
  assert.equal(r.reactors.modReactor, 60);
  assert.ok(!('modReactor' in r.batteries), 'a reactor that carries a little charge is not a battery');
  assert.equal(r.batteries.modBattery, 500);
  assert.equal(r.stored.modReactor, 10);
  near(r.engines.modIon.ec, 8.74, 0.01);
  assert.equal(r.cells.modCell.ec, 2);
  assert.equal(r.parts.modPanel.title, 'Mod Panel');
  assert.equal(r.parts.modPanel.entry, 240);
  // used by the design: the mod's parts show up as options and a mod RTG sizes like a stock one
  const prof = En.lightProfile(world, orbit('Kerbin', 100000));
  const d = En.design({ profile: prof, loads: [{ label: 'x', ec: 4, duty: 1 }], state: null, extra: mergePower({}, r) });
  const ids = d.options.map((o) => o.parts[0].id);
  ['modPanel', 'modRtg', 'modReactor', 'modCell'].forEach((id) => assert.ok(ids.includes(id), id + ' is offered'));
  assert.ok(d.options.find((o) => o.parts[0].id === 'modPanel').notes.includes('mod part'));
  assert.ok(En.loadCatalogue(mergePower({}, r)).some((c) => c.id === 'eng:modIon'));
  // and nothing leaks into later calls without the extra parts
  assert.ok(!En.design({ profile: prof, loads: [{ label: 'x', ec: 4, duty: 1 }], state: null }).options.some((o) => o.parts[0].id === 'modPanel'));
});
