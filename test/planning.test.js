// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Milestone rewards, strategies, fuel ducts, the terrain summary and the landing-site finder. */
const test = require('node:test');
const assert = require('node:assert/strict');
const CD = require('../js/career-data.js');
const Craft = require('../js/craft.js');
const Career = require('../js/career.js');
const Parsers = require('../js/parsers.js');
const Land = require('../js/landing.js');
const TD = require('../js/terrain-data.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' vs ' + b);

// ---- milestones ------------------------------------------------------------------------------------------------
test('milestone rewards follow the game formula: base x passive share x score x prestige x body weight', () => {
  const g = [1, 1, 1];
  // Kerbin orbit: 80000 x 0.2 x score 1 x exceptional 1.5 = 24000 funds; 8 x 0.2 x 1 x 1.5 = 2.4 -> 2 science; 16 -> 4.8 -> 5 reputation
  const k = Career.milestoneReward('ORBIT', 'Kerbin', g, []);
  assert.deepEqual([k.base.funds, k.base.sci, k.base.rep], [24000, 2, 5]);
  assert.equal(k.prestige, 'exceptional');
  // a landing elsewhere scores 1.5 (0.1 at home) and funds also scale with the body's recovery value
  const w = CD.bodyScience.Mun.recovery;
  const m = Career.milestoneReward('LANDING', 'Mun', g, []);
  assert.equal(m.base.funds, Math.round(80000 * 0.2 * 1.5 * 1 * (1 + (w - 1) * 0.3)));
  assert.equal(m.prestige, 'trivial');
  // the difficulty gain multiplies all three; Easy doubles
  const e = Career.milestoneReward('ORBIT', 'Kerbin', [2, 2, 2], []);
  assert.equal(e.base.funds, 48000);
  // outliers: a base and a station get the bonus and the top tier; a return from a world with air too
  assert.equal(Career.milestonePrestige('BASECONSTRUCTION'), 2);
  assert.equal(Career.milestoneReward('LANDINGRETURN', 'Duna', g, []).outlier, true);
  assert.equal(Career.milestoneReward('LANDINGRETURN', 'Mun', g, []).outlier, false);
  assert.deepEqual(['FLYBY', 'LANDING', 'ORBIT', 'REACHSPACE'].map(Career.milestonePrestige), [1, 0, 2, 1]);
});

test('milestone list: one-offs and per-body rows, marks the ones the save already has, gas giants have no surface rows', () => {
  const st = Career.newState('normal');
  st.progress = ['FirstLaunch', 'Kerbin:Orbit'];
  const rows = Career.milestoneList(st);
  assert.ok(rows.find((r) => r.key === 'FirstLaunch').done);
  assert.ok(rows.find((r) => r.key === 'Kerbin:Orbit').done);
  assert.ok(!rows.find((r) => r.key === 'Mun:Landing').done);
  assert.ok(!rows.find((r) => r.key === 'Jool:Landing'));
  assert.ok(rows.find((r) => r.key === 'Kerbin:Splashdown') && !rows.find((r) => r.key === 'Mun:Splashdown'));
  assert.ok(rows.length > 200);
});

test('milestones from a save: the ProgressTracking node is read, records and one-offs by name, bodies as Body:Node', () => {
  const sfs = 'GAME\n{\n\tMode = CAREER\n\tSCENARIO\n\t{\n\t\tname = ProgressTracking\n\t\tProgress\n\t\t{\n\t\t\tFirstLaunch\n\t\t\t{\n\t\t\t\tcompleted = 74.5\n\t\t\t}\n\t\t\tKerbin\n\t\t\t{\n\t\t\t\treached = 44\n\t\t\t\tOrbit\n\t\t\t\t{\n\t\t\t\t\tcompleted = 8899\n\t\t\t\t}\n\t\t\t\tEscape\n\t\t\t\t{\n\t\t\t\t\tcompletedManned = 1470196\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n';
  const c = Parsers.parseCareer(sfs);
  assert.deepEqual(c.progress.sort(), ['FirstLaunch', 'Kerbin:Escape', 'Kerbin:Orbit']);
  assert.deepEqual(Career.fromSave(c).progress.sort(), ['FirstLaunch', 'Kerbin:Escape', 'Kerbin:Orbit']);
});

// ---- strategies ------------------------------------------------------------------------------------------------
test('strategies: converters take a share of the input and pay at the rate; operations multiply; reasons decide what is touched', () => {
  const base = { funds: 24000, sci: 2, rep: 5 };
  // Leadership Initiative at full commitment: milestone funds and reputation x2.5, science x1.5
  const li = Career.strategyEffect([{ id: 'LeadershipInitiative', factor: 1 }], 'Progression', base);
  near(li.total.funds, 60000, 1e-6); near(li.total.rep, 12.5, 1e-9); near(li.total.sci, 3, 1e-9);
  // ... and it does not touch contracts' reasons it does not list (it cuts them instead)
  const lc = Career.strategyEffect([{ id: 'LeadershipInitiative', factor: 1 }], 'ContractReward', { funds: 1000, sci: 0, rep: 0 });
  near(lc.total.funds, 250, 1e-6);
  // Fundraising at half commitment: half the reputation becomes funds at the half-way rate
  const f = Career.strategyEffect([{ id: 'FundraisingCampaignCfg', factor: 0.5 }], 'Progression', base);
  near(f.delta.rep, -2.5, 1e-9);
  near(f.delta.funds, 2.5 * (1002.5522398575451 + 1253.1902998219313) / 2, 1e-3);
  // nothing active: nothing changes
  assert.deepEqual(Career.strategyEffect([], 'Progression', base).total, base);
  // the price grows with the commitment
  assert.ok(Career.strategyCost('AppreciationCampaignCfg', 1).funds > Career.strategyCost('AppreciationCampaignCfg', 0).funds);
  // milestones include the strategies
  const rows = Career.milestoneReward('ORBIT', 'Kerbin', [1, 1, 1], [{ id: 'LeadershipInitiative', factor: 1 }]);
  near(rows.total.funds, 60000, 1e-6);
});

// ---- fuel ducts ------------------------------------------------------------------------------------------------
function part(name, i, o) {
  o = o || {};
  let t = 'PART\n{\n\tpart = ' + name + '_' + (1000 + i) + '\n\tpersistentId = ' + (5000 + i) + '\n\tistg = ' + (o.istg === undefined ? -1 : o.istg) + '\n\tsepI = ' + (o.sepI === undefined ? -1 : o.sepI) + '\n\tmodCost = 0\n\tmodMass = 0\n';
  for (const l of o.links || []) t += '\tlink = ' + l + '\n';
  for (const a of o.att || []) t += '\tattN = ' + a + '\n';
  for (const k of Object.keys(o.res || {})) t += '\tRESOURCE\n\t{\n\t\tname = ' + k + '\n\t\tamount = ' + o.res[k] + '\n\t\tmaxAmount = ' + o.res[k] + '\n\t}\n';
  if (o.target !== undefined) t += '\tPARTDATA\n\t{\n\t\ttpersID = ' + (5000 + o.target) + '\n\t}\n';
  return t + '}\n';
}
function rocket(withDucts) {
  const tank = { LiquidFuel: 360, Oxidizer: 440 };
  const rd = 'radialDecoupler_', ft = 'fuelTank_', eng = 'liquidEngine_';
  // 0 pod, 1 core tank, 2 core engine (stage 1), 3 and 4 radial decouplers (stage 0), 5 and 6 booster tanks, 7 and 8 booster engines,
  // 9 and 10 ducts (hang on the booster tanks and point at the core tank)
  let t = 'ship = Duct test\nversion = 1.12.5\ntype = VAB\n';
  t += part('mk1pod.v2', 0, { links: [ft + 1001] });
  t += part('fuelTank', 1, { res: tank, links: [eng + 1002, rd + 1003, rd + 1004] });
  t += part('liquidEngine', 2, { istg: 1 });
  t += part('radialDecoupler', 3, { istg: 0, sepI: 0, links: [ft + 1005] });
  t += part('radialDecoupler', 4, { istg: 0, sepI: 0, links: [ft + 1006] });
  t += part('fuelTank', 5, { res: tank, sepI: 0, links: [eng + 1007].concat(withDucts ? ['fuelLine_1009'] : []) });
  t += part('fuelTank', 6, { res: tank, sepI: 0, links: [eng + 1008].concat(withDucts ? ['fuelLine_1010'] : []) });
  t += part('liquidEngine', 7, { istg: 1, sepI: 0 });
  t += part('liquidEngine', 8, { istg: 1, sepI: 0 });
  if (withDucts) { t += part('fuelLine', 9, { sepI: 0, target: 1 }); t += part('fuelLine', 10, { sepI: 0, target: 1 }); }
  return t;
}
test('fuel ducts: boosters feed the core first, so the core is full when they drop (more delta-v than without ducts)', () => {
  const plain = Craft.stages(Craft.parseCraft(rocket(false)));
  const ducted = Craft.stages(Craft.parseCraft(rocket(true)));
  const c = Craft.parseCraft(rocket(true));
  assert.equal(c.parts.filter((p) => p.target >= 0).length, 2);
  assert.equal(c.parts[9].target, 1);
  assert.ok(ducted.dv > plain.dv * 1.02, 'with ducts ' + ducted.dv + ' vs ' + plain.dv);
  // the core engine alone after separation has the full core tank
  const lastStage = ducted.stages.filter((s) => s.dv > 0).pop();
  assert.ok(lastStage.dv > 0);
});

test('solid fuel does not cross a part boundary', () => {
  assert.equal(CD.resources.SolidFuel.noFlow, 1);
  assert.ok(!CD.resources.LiquidFuel.noFlow);
});

// ---- the terrain summary ---------------------------------------------------------------------------------------
test('terrain data: biome counts match the game for every body with a map', () => {
  const want = { Bop: 5, Dres: 8, Duna: 14, Eeloo: 11, Eve: 15, Gilly: 3, Ike: 8, Kerbin: 11, Laythe: 10, Minmus: 9, Moho: 12, Mun: 17, Pol: 4, Tylo: 9, Vall: 9 };
  for (const [b, n] of Object.entries(want)) assert.equal(Land.biomeCount(b), n, b);
  assert.deepEqual(Land.bodies().sort(), Object.keys(want).sort());
  assert.deepEqual(TD.grid, [128, 64]);
});

test('terrain maps are placed right: the Kerbin ground stations fall on the biomes they belong to', () => {
  const b = Land.body('Kerbin');
  const at = (lat, lon) => { const c = Land.cellAt(lat, lon); return b.biomes[b.bio[c.cy * Land.GW + c.cx]]; };
  const either = (lat, lon) => { const c = Land.cellAt(lat, lon), i = c.cy * Land.GW + c.cx; return [b.biomes[b.bio[i]], b.biomes[b.bio2[i]]]; };   // a cell is 29 km wide
  assert.equal(at(-6.56, -143.95), 'Deserts');                  // Desert launch site
  assert.ok(either(9.45, -172.11).includes('Mountains'));       // Crater Rim
  assert.ok(either(-11.95, 33.74).includes('Mountains'));       // Harvester Massif
  assert.ok(either(-0.0972, -74.5577).includes('Shores'));      // Space Center (on the coast: water and shore share the cell)
  assert.equal(at(-89.5, 0), 'Southern Ice Shelf');
  assert.equal(at(89.5, 0), 'Northern Ice Shelf');
  // and the round trip cell -> position -> cell
  for (const [cx, cy] of [[0, 0], [58, 31], [127, 63], [64, 10]]) { const p = Land.cellPos(cx, cy); assert.deepEqual(Land.cellAt(p.lat, p.lon), { cx: cx, cy: cy }); }
});

test('flat share: rises with the allowed tilt from 0 to 1 and respects the percentiles', () => {
  const s = { q25: 1, q50: 2, q90: 6 };
  assert.equal(Land.flatShare(s, 0), 0);
  near(Land.flatShare(s, 1), 0.25, 1e-9); near(Land.flatShare(s, 2), 0.5, 1e-9); near(Land.flatShare(s, 6), 0.9, 1e-9);
  assert.equal(Land.flatShare(s, 500), 1);
  let prev = -1;
  for (let t = 0; t <= 40; t += 0.5) { const v = Land.flatShare(s, t); assert.ok(v >= prev - 1e-12); prev = v; }
  assert.equal(Land.flatShare(null, 5), null);
  // a cell whose 90th percentile is flat: at least 90% passes any limit
  assert.ok(Land.flatShare({ q25: 0, q50: 0, q90: 0 }, 0) >= 0.9);
});

// ---- the finder ------------------------------------------------------------------------------------------------
test('finder: every result satisfies the filters; a stricter tilt only removes candidates', () => {
  const loose = Land.find('Duna', { landTilt: 15, stayTilt: 10, share: 0.5, count: 200, spacingKm: 1 });
  const strict = Land.find('Duna', { landTilt: 4, stayTilt: 2, share: 0.9, count: 200, spacingKm: 1 });
  assert.ok(loose.matches > strict.matches && strict.matches > 0, loose.matches + ' vs ' + strict.matches);
  for (const r of strict.rows) { assert.ok(r.landShare >= 0.9 - 1e-9 && r.stayShare >= 0.9 - 1e-9); }
  const lat = Land.find('Duna', { maxLat: 20, count: 200, spacingKm: 1 });
  for (const r of lat.rows) assert.ok(Math.abs(r.lat) <= 20);
  const alt = Land.find('Duna', { minAlt: 2000, maxAlt: 3000, count: 200, spacingKm: 1 });
  for (const r of alt.rows) assert.ok(r.alt >= 2000 && r.alt <= 3000);
  const only = Land.find('Duna', { biomes: ['Midlands'], count: 200, spacingKm: 1 });
  for (const r of only.rows) assert.equal(r.biome, 'Midlands');
  const not = Land.find('Duna', { avoid: ['Midlands', 'Poles'], count: 200, spacingKm: 1 });
  for (const r of not.rows) assert.ok(r.biome !== 'Midlands' && r.biome !== 'Poles');
});

test('finder: dry land only on bodies with liquid; reference point, spacing and ranking', () => {
  const dry = Land.find('Kerbin', { count: 300, spacingKm: 1 });
  for (const r of dry.rows) assert.ok(r.alt > 0, r.alt);
  const ksc = { lat: -0.0972, lon: -74.5577, km: 400 };
  const close = Land.find('Kerbin', { near: ksc, rank: 'close', landTilt: 10, stayTilt: 6, count: 10 });
  assert.ok(close.rows.length > 1);
  for (const r of close.rows) assert.ok(r.distanceKm <= 400);
  for (let i = 1; i < close.rows.length; i++) assert.ok(close.rows[i].distanceKm >= close.rows[i - 1].distanceKm);
  const spaced = Land.find('Mun', { count: 12, spacingKm: 300 });
  for (let i = 0; i < spaced.rows.length; i++) for (let j = i + 1; j < spaced.rows.length; j++) assert.ok(Land.distanceKm('Mun', spaced.rows[i], spaced.rows[j]) >= 300);
  const rich = Land.find('Kerbin', { rank: 'variety', count: 5, landTilt: 15, stayTilt: 10, varietyKm: 300 });
  assert.ok(rich.rows[0].variety >= rich.rows[rich.rows.length - 1].variety);
});

test('finder: bodies without a height map have biomes only and still answer', () => {
  const r = Land.find('Minmus', { rank: 'variety', count: 3 });
  assert.equal(r.hasHeight, false);
  assert.ok(r.rows.length === 3 && r.rows[0].slope === null && r.rows[0].variety >= 1);
  assert.equal(Land.find('Jool', {}).rows.length, 0);
  assert.ok(Land.biomeTable('Mun').length === 17);
  near(Land.biomeTable('Kerbin').reduce((a, b) => a + b.share, 0), 1, 1e-9);
});

// ---- Breaking Ground data --------------------------------------------------------------------------------------
test('Breaking Ground data: four deployed instruments, their parts, the rock list and the diminishing-returns table', () => {
  const D = CD.deployed;
  assert.deepEqual(Object.keys(D.instruments).sort(), ['deployedGooObservation', 'deployedIONCollector', 'deployedSeismicSensor', 'deployedWeatherReport']);
  assert.ok(D.instruments.deployedWeatherReport.atmo && D.instruments.deployedIONCollector.vacuum);
  assert.deepEqual(D.returns, [[1, 1], [2, 0.2], [3, 0.35], [4, 0.45], [5, 0.5]]);
  assert.equal(CD.parts.filter((p) => p.ground).length, 4);
  assert.ok(D.rocs.length >= 30);
  const bao = D.rocs.find((r) => r.type === 'KerbinBaobabTree');
  assert.deepEqual(bao.bodies[0].biomes, ['Grasslands', 'Highlands']);
  assert.ok(D.rocScience.KerbinBaobabTree.cap === 60);
});

test('science table: biome-dependent experiments are flagged and comet or asteroid samples are left out', () => {
  const rows = Career.scienceTable('Mun', 17);
  assert.ok(!rows.some((r) => /^(asteroid|comet)/.test(r.id)));
  const goo = rows.find((r) => r.id === 'mysteryGoo' && r.key === 'landed');
  assert.equal(goo.biomeDependent, true); assert.equal(goo.subjects, 17);
  const seis = rows.find((r) => r.id === 'seismicScan' && r.key === 'landed');
  assert.equal(seis.biomeDependent, true);
});
