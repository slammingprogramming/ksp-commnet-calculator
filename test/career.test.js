// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CD = require('../js/career-data.js');
const Craft = require('../js/craft.js');
const Career = require('../js/career.js');
const Mission = require('../js/mission.js');
const Parsers = require('../js/parsers.js');
const Orb = require('../js/orbits.js');
const { createWorld } = require('../js/world.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' vs ' + b);
const part = (id) => Craft.part(id);

// ---- data ------------------------------------------------------------------------------------------------------
test('career data: tech tree is closed, every part names a known node, facilities and bodies are complete', () => {
  assert.equal(CD.tech.length, 63);
  const ids = new Set(CD.tech.map((t) => t.id));
  for (const t of CD.tech) for (const p of t.parents) assert.ok(ids.has(p), t.id + ' parent ' + p);
  for (const p of CD.parts) assert.ok(!p.tech || p.tech === 'Unresearchable' || ids.has(p.tech), p.id + ' tech ' + p.tech);
  assert.equal(Object.keys(CD.facilities).length, 9);
  for (const f of Object.values(CD.facilities)) assert.ok(f.up[0] > 0 && f.up[1] > f.up[0]);
  assert.equal(Object.keys(CD.bodyScience).length, 17);
  assert.deepEqual([CD.bodyScience.Kerbin.landed, CD.bodyScience.Kerbin.spaceHigh, CD.bodyScience.Mun.landed], [0.3, 1.5, 4]);
  assert.equal(CD.difficulty.hard.startFunds, 10000);
});

test('part prices: the cfg price is the full-tank price, so dry cost = cost minus the contents', () => {
  const tank = part('fuelTank');
  assert.equal(tank.cost, 500);
  near(Craft.dryCost(tank), 500 - 180 * 0.8 - 220 * 0.18, 1e-6);
  assert.equal(part('liquidEngine').eng[0].thrust, 240);
  assert.deepEqual(part('liquidEngine').eng[0].isp, [310, 265]);
});

// ---- craft -----------------------------------------------------------------------------------------------------
function craftText(parts) {
  let s = 'ship = Test\nversion = 1.12.5\ntype = VAB\n';
  parts.forEach((p, i) => {
    s += 'PART\n{\n\tpart = ' + p.id + '_' + (1000 + i) + '\n\tistg = ' + (p.istg === undefined ? -1 : p.istg) + '\n\tmodCost = 0\n\tmodMass = 0\n';
    for (const l of p.links || []) s += '\tlink = ' + parts[l].id + '_' + (1000 + l) + '\n';
    for (const [node, j] of Object.entries(p.att || {})) s += '\tattN = ' + node + ',' + parts[j].id + '_' + (1000 + j) + '_0|0|0\n';
    for (const [k, v] of Object.entries(p.res || {})) s += '\tRESOURCE\n\t{\n\t\tname = ' + k + '\n\t\tamount = ' + v[0] + '\n\t\tmaxAmount = ' + v[1] + '\n\t}\n';
    s += '}\n';
  });
  return s;
}
const full = (id) => { const o = {}; for (const [k, v] of Object.entries(part(id).res || {})) o[k] = [v[1], v[1]]; return o; };

test('craft: a fully fuelled craft costs the sum of the cfg prices and weighs dry mass plus propellant', () => {
  const c = Craft.parseCraft(craftText([
    { id: 'mk1pod.v2', istg: -1, links: [1], res: full('mk1pod.v2') },
    { id: 'fuelTank', istg: -1, links: [2], res: full('fuelTank') },
    { id: 'liquidEngine', istg: 0, res: {} },
  ]));
  assert.equal(c.parts.length, 3);
  assert.deepEqual(c.parts.map((p) => p.parent), [-1, 0, 1]);
  const s = Craft.summarize(c);
  assert.equal(Math.round(s.cost), 600 + 500 + 1100);
  // tank: 180 LF + 220 Ox, density 0.005 t/unit; the pod loses the crew mass the game takes out of the part mass
  near(s.mass, part('mk1pod.v2').mass - 0.094 + 0.04 + part('fuelTank').mass + 400 * 0.005 + part('liquidEngine').mass, 1e-6);
  assert.deepEqual(c.missing, []);
});

test('craft: a single-stage rocket gets the rocket-equation delta-v and the right burn time', () => {
  const c = Craft.parseCraft(craftText([
    { id: 'mk1pod.v2', istg: -1, links: [1], res: {} },
    { id: 'fuelTank', istg: -1, links: [2], res: full('fuelTank') },
    { id: 'liquidEngine', istg: 0, res: {} },
  ]));
  const r = Craft.stages(c);
  const m0 = part('mk1pod.v2').mass - 0.094 + part('fuelTank').mass + 400 * 0.005 + part('liquidEngine').mass;
  const m1 = m0 - 400 * 0.005;
  const st = r.stages.find((s) => s.engines);
  near(st.dv, 310 * Craft.G0 * Math.log(m0 / m1), 1, 'vacuum dv');
  near(st.dvAsl, 265 * Craft.G0 * Math.log(m0 / m1), 1, 'sea level dv');
  // flow = thrust / (Isp g0) = 240 / (310 g0) t/s
  near(st.time, (400 * 0.005) / (240 / (310 * Craft.G0)), 0.5, 'burn time');
  near(st.m0, m0, 1e-9);
});

test('craft: a decoupler drops what hangs on its node, and the dropped stage no longer counts', () => {
  const c = Craft.parseCraft(craftText([
    { id: 'mk1pod.v2', istg: -1, links: [1], res: {} },
    { id: 'fuelTank', istg: -1, links: [2], res: full('fuelTank') },
    { id: 'liquidEngine', istg: 0, links: [3] },
    { id: 'Decoupler_1', istg: 0, links: [4], att: { bottom: 4, top: 4 } },
    { id: 'fuelTank', istg: -1, links: [5], res: full('fuelTank') },
    { id: 'liquidEngine', istg: 1 },
  ]));
  const r = Craft.stages(c);
  const burns = r.stages.filter((s) => s.dv > 0);
  assert.equal(burns.length, 2, 'two burns: first engine until its tank is empty, then the second after separation');
  assert.ok(burns[0].stage === 1 && burns[1].stage === 0, 'lower stage first, then the upper one');
  const rec = Craft.recoverable(c, r);
  assert.ok(rec.parts >= 3 && rec.value > 600, 'the pod and the upper stage survive');
});

test('loadmeta: the game stored totals are read', () => {
  const m = Craft.parseLoadMeta('shipName = X\ntotalCost = 1234.5\ntotalMass = 3.25\npartCount = 7\nstageCount = 2\n');
  assert.deepEqual([m.cost, m.mass, m.partCount, m.stageCount], [1234.5, 3.25, 7, 2]);
});

// ---- career state ---------------------------------------------------------------------------------------------
const SAVE = `GAME
{
  Title = Test (CAREER)
  Mode = CAREER
  PARAMETERS
  {
    CAREER
    {
      StartingFunds = 15000
      StartingScience = 0
      StartingReputation = 0
      FundsGainMultiplier = 0.9
      RepGainMultiplier = 0.9
      ScienceGainMultiplier = 0.9
      FundsLossMultiplier = 1.5
      RepLossMultiplier = 1.5
      RepLossDeclined = 2
    }
  }
  SCENARIO
  {
    name = Funding
    funds = 123456.5
  }
  SCENARIO
  {
    name = Reputation
    rep = 77.5
  }
  SCENARIO
  {
    name = ResearchAndDevelopment
    sci = 42
    Tech
    {
      id = start
      state = Available
      part = mk1pod.v2
    }
    Tech
    {
      id = basicRocketry
      state = Available
      part = liquidEngine
    }
    Tech
    {
      id = survivability
      state = Unavailable
    }
  }
  SCENARIO
  {
    name = ScenarioUpgradeableFacilities
    SpaceCenter/LaunchPad
    {
      lvl = 0.5
    }
    SpaceCenter/TrackingStation
    {
      lvl = 1
    }
  }
  SCENARIO
  {
    name = ContractSystem
    CONTRACTS
    {
      CONTRACT
      {
        type = SatelliteContract
        state = Active
        body = Kerbin
        values = 1,2,16000,41000,12000,3,10,5,0,0,999,0
      }
      CONTRACT
      {
        type = BaseContract
        state = Completed
        values = 1,2,1,1,1,1,1,1,0,0,0,0
      }
    }
  }
}
`;

test('parseCareer reads funds, science, reputation, difficulty, tech, facilities and live contracts', () => {
  const c = Parsers.parseCareer(SAVE);
  assert.deepEqual([c.funds, c.sci, c.rep], [123456.5, 42, 77.5]);
  assert.deepEqual(c.tech, ['start', 'basicRocketry']);
  assert.deepEqual(c.parts, ['mk1pod.v2', 'liquidEngine']);
  assert.deepEqual(c.facilities, { LaunchPad: 2, TrackingStation: 3 });
  assert.equal(c.contracts.length, 1, 'only active and offered contracts');
  assert.deepEqual([c.contracts[0].type, c.contracts[0].advance, c.contracts[0].reward, c.contracts[0].failure, c.contracts[0].sci, c.contracts[0].rep], ['Satellite', 16000, 41000, 12000, 3, 10]);
  const s = Career.fromSave(c);
  assert.equal(s.preset, 'moderate', 'the multipliers match the Moderate preset');
  assert.equal(s.facilities.LaunchPad, 2);
  assert.equal(s.facilities.VehicleAssemblyBuilding, 1);
});

test('new states follow the difficulty presets', () => {
  assert.equal(Career.newState('hard').funds, 10000);
  assert.equal(Career.newState('easy').funds, 250000);
  assert.deepEqual(Career.newState('normal').diff.gain, [1, 1, 1]);
});

// ---- facilities ------------------------------------------------------------------------------------------------
test('facility upgrades: prices and what each level allows', () => {
  const s = Career.newState('normal');
  const t = Career.facilityTable(s);
  const pad = t.find((f) => f.id === 'LaunchPad');
  assert.equal(pad.nextCost, 75000);
  assert.equal(pad.toMax, 75000 + 282000);
  assert.deepEqual(Career.effects('LaunchPad', 1), [['Launch mass limit', '18 t'], ['Craft size limit', '15 × 20 × 15 m']]);
  assert.deepEqual(Career.effects('LaunchPad', 3), [['Launch mass limit', 'unlimited'], ['Craft size limit', 'unlimited']]);
  assert.deepEqual(Career.effects('MissionControl', 2).map((e) => e[1]), ['7', 'yes']);
  assert.equal(Career.effects('Administration', 2)[0][1], '3');
  s.facilities.LaunchPad = 3;
  assert.equal(Career.facilityTable(s).find((f) => f.id === 'LaunchPad').nextCost, null);
});

// ---- tech ------------------------------------------------------------------------------------------------------
test('tech plan: prerequisites are listed first, cumulative cost adds up, the R&D limit is flagged', () => {
  const s = Career.newState('normal');
  const goal = 'advRocketry';
  const p = Career.techPlan(s, [goal], { rdLevel: 1 });
  const ids = p.rows.map((r) => r.id);
  assert.equal(ids[ids.length - 1], goal);
  for (const r of p.rows) {
    const n = Career.nodes[r.id];
    const before = new Set(['start'].concat(ids.slice(0, ids.indexOf(r.id))));
    assert.ok(n.any ? n.parents.some((x) => before.has(x)) : n.parents.every((x) => before.has(x)), r.id + ' after its parents');
  }
  assert.equal(p.total, p.rows.reduce((a, r) => a + r.cost, 0));
  assert.equal(p.rows[p.rows.length - 1].cum, p.total);
  const hi = Career.techPlan(s, ['experimentalScience'], { rdLevel: 1 });
  assert.ok(hi.rows.some((r) => r.blocked), 'a 300+ science node cannot be researched with a level 1 R&D');
  const none = Career.techPlan(s, ['experimentalScience'], { rdLevel: 3 });
  assert.ok(none.rows.every((r) => !r.blocked));
  // researched nodes are not planned again
  s.tech.push('basicRocketry');
  assert.ok(!Career.techPlan(s, [goal]).rows.some((r) => r.id === 'basicRocketry'));
});

test('craft needs: unresearched nodes and the entry price of parts not yet bought', () => {
  const s = Career.newState('normal');
  const c = Craft.parseCraft(craftText([
    { id: 'mk1pod.v2', links: [1] }, { id: 'fuelTank', links: [2] }, { id: 'liquidEngine' },
  ]));
  const n = Career.craftNeeds(s, c);
  assert.ok(n.nodes.length >= 1 && n.buyFunds >= 0);
  assert.ok(n.buy.every((p) => p.entry > 0));
  s.tech = CD.tech.map((t) => t.id); s.parts = CD.parts.map((p) => p.id);
  const none = Career.craftNeeds(s, c);
  assert.deepEqual([none.nodes.length, none.buyFunds], [0, 0]);
});

// ---- finance ---------------------------------------------------------------------------------------------------
test('recovery: pad and runway return everything, the space centre 98%, far landings down to 10%', () => {
  assert.equal(Career.recoveryFactor('pad'), 1);
  assert.equal(Career.recoveryFactor('ksc'), 0.98);
  near(Career.recoveryFactor('away', 0), 0.98, 1e-9);
  near(Career.recoveryFactor('away', (Math.PI * 600000) / 1000), 0.1, 1e-9);
  near(Career.recoveryFactor('away', (Math.PI * 600000) / 2000), 0.54, 1e-9);
});

test('forecast: running balance, lowest point and the first day the money is short', () => {
  const s = Career.newState('normal');
  const f = Career.forecast(s, [
    { day: 5, label: 'Launch', funds: -20000 }, { day: 1, label: 'Contract advance', funds: 9000 }, { day: 9, label: 'Reward', funds: 30000, sci: 4 },
  ]);
  assert.deepEqual(f.rows.map((r) => r.balance), [34000, 14000, 44000]);
  assert.equal(f.low, 14000);
  assert.equal(f.firstShort, null);
  const g = Career.forecast(s, [{ day: 2, label: 'Big launch', funds: -30000 }]);
  assert.equal(g.firstShort, 2);
  assert.equal(g.low, -5000);
  const m = Career.missionFinance(s, { cost: 10000, recovery: 4000, contracts: [{ label: 'C', advance: 1000, reward: 5000, sci: 2 }], duration: 3 });
  assert.equal(m.net, -10000 + 4000 + 1000 + 5000);
});

test('contract estimate scales with prestige and the difficulty gain', () => {
  const s = Career.newState('hard');
  const e = Career.contractEstimate(s, 'Satellite', 'significant');
  assert.equal(e.reward, Math.round(41000 * 1.25 * 0.6));
});

// ---- science ---------------------------------------------------------------------------------------------------
test('science: the same experiment is worth the body multiplier of the situation', () => {
  const g = Career.experimentValue('mysteryGoo', 'Kerbin', 'landed');
  assert.ok(g, 'goo works on the ground at Kerbin');
  near(g.first, CD.experiments.mysteryGoo.base * 0.3, 1e-9);
  near(g.cap, CD.experiments.mysteryGoo.cap * 0.3, 1e-9);
  const m = Career.experimentValue('mysteryGoo', 'Mun', 'landed');
  assert.ok(m.cap > g.cap * 10);
  assert.ok(Career.experimentValue('mysteryGoo', 'Kerbin', 'spaceHigh'), 'goo works in high space too');
  assert.equal(Career.experimentValue('atmosphereAnalysis', 'Mun', 'landed'), null, 'no air at the Mun');
  assert.ok(Career.experimentValue('atmosphereAnalysis', 'Kerbin', 'flyingLow'));
  assert.equal(CD.experiments.mysteryGoo.xmit, 0.3);
  const table = Career.scienceTable('Mun');
  assert.ok(table.length > 5 && table[0].cap >= table[table.length - 1].cap);
});

// ---- mission ---------------------------------------------------------------------------------------------------
const world = createWorld({});
test('mission legs: launch, Mun transfer and landing are in the known delta-v ranges', () => {
  const launch = Mission.leg(world, { type: 'launch', alt: 80 }, 0);
  near(launch.dv, 3400, 80, 'launch');
  const mun = Mission.leg(world, { type: 'transfer', from: 'Kerbin', to: 'Mun', park: 80, capture: 30 }, 0);
  assert.ok(mun.dv > 1000 && mun.dv < 1500, 'Mun transfer + capture ' + mun.dv);
  assert.ok(mun.flight > 4 * 3600 && mun.flight < 8 * 3600, 'flight ' + mun.flight);
  const land = Mission.leg(world, { type: 'land', body: 'Mun', alt: 14, margin: 0 }, 0);
  near(land.dv, 590, 15, 'Mun landing');
  const back = Mission.leg(world, { type: 'return', body: 'Mun', alt: 14, pe: 35 }, 0);
  assert.ok(back.dv > 250 && back.dv < 500, 'Mun return ' + back.dv);
  const plane = Mission.leg(world, { type: 'plane', body: 'Kerbin', alt: 100, degrees: 90 }, 0);
  near(plane.dv, Math.SQRT2 * Mission.vcirc(world.index.get('Kerbin').gm, 700000), 1e-6);
});

test('mission plan: a Duna trip finds a real window, dates move forward and legs add up', () => {
  const p = Mission.plan(world, [
    { type: 'launch', alt: 80 }, { type: 'transfer', from: 'Kerbin', to: 'Duna', park: 80, capture: 100 }, { type: 'land', body: 'Duna', alt: 100, chutes: true },
  ], 0);
  assert.equal(p.error, null);
  assert.equal(p.legs.length, 3);
  near(p.total, p.legs.reduce((a, l) => a + l.dv, 0), 1e-9);
  assert.ok(p.legs[1].t0 >= p.legs[0].t1 && p.legs[1].t1 > p.legs[1].t0);
  assert.ok(p.legs[1].flight > 100 * Orb.DAY && p.legs[1].flight < 400 * Orb.DAY);
  assert.ok(p.total > 4500 && p.total < 6500, 'total ' + p.total);
  const eve = Mission.plan(world, [{ type: 'launch', body: 'Eve', alt: 100 }], 0);
  assert.ok(!eve.error && eve.total > 5000, 'thick atmospheres are simulated at a default thrust-to-weight of 1.5: ' + eve.total);
  const bad = Mission.plan(world, [{ type: 'launch', body: 'Eve', alt: 100, twr: 0.6 }], 0);
  assert.ok(bad.error && /losses/.test(bad.error), 'a rocket that cannot lift off gets an error asking for a loss figure');
});

test('science by signal strength: the transmitter\'s science curve adds up to 40% and never exceeds the full value', () => {
  assert.equal(Career.transmitBonus(0), 0);
  assert.ok(Math.abs(Career.transmitBonus(0.45) - 0.08) < 1e-9);
  assert.ok(Math.abs(Career.transmitBonus(1) - 0.4) < 1e-9);
  assert.ok(Career.transmitBonus(0.7) > Career.transmitBonus(0.45) && Career.transmitBonus(0.7) < Career.transmitBonus(0.81));
  assert.ok(Math.abs(Career.transmitValue(10, 0.5, 1) - 7) < 1e-9, 'half-efficiency data at full signal pays 70%');
  assert.equal(Career.transmitValue(10, 1, 1), 10, 'capped at the full value');
  assert.equal(Career.transmitValue(10, 0.5, 0), 5);
});

test('launch pad and runway limits: mass 18 / 140 / none, size 15x20x15 / 28x36x28 / none, compared axis by axis', () => {
  assert.deepEqual(Career.CRAFT_LIMITS.mass, [18, 140, null]);
  assert.ok(Career.fitsSize([4.2, 8.1, 4.2], 1));
  assert.ok(!Career.fitsSize([4.2, 21, 4.2], 1), 'too tall for level 1');
  assert.ok(Career.fitsSize([4.2, 21, 4.2], 2));
  assert.ok(Career.fitsSize([200, 200, 200], 3), 'no limit at the top level');
  assert.ok(Career.fitsSize(null, 1), 'unknown size is not a failure');
  const fx = Career.effects('Runway', 1).map((r) => r[0]);
  assert.ok(fx.includes('Launch mass limit') && fx.includes('Craft size limit'));
});

test('hiring a Kerbal: the game\'s formula gives the prices players report with the original four on the roster', () => {
  assert.equal(Career.hireCost(4, 1), 62113);
  assert.equal(Career.hireCost(5, 1), 71031);
  assert.ok(Math.abs(Career.hireCost(6, 1) - 79054) <= 1);
  assert.equal(Career.hireCost(4, 0.5), 31056.5, 'the funds loss multiplier scales it');
  const parsed = Parsers.parseCareer('GAME\n{\n  Mode = CAREER\n  ROSTER\n  {\n    KERBAL\n    {\n      name = A\n      type = Crew\n      state = Available\n    }\n    KERBAL\n    {\n      name = B\n      type = Crew\n      state = Dead\n    }\n    KERBAL\n    {\n      name = C\n      type = Applicant\n      state = Available\n    }\n  }\n}\n');
  assert.equal(parsed.crew, 1, 'only living crew count');
});

test('records pay in five steps at the game\'s thresholds, and a save\'s best marks the ones passed', () => {
  const s = Career.newState('normal');
  const t = Career.recordTable(s);
  const alt = t.find((r) => r.id === 'ALTITUDERECORD');
  assert.deepEqual(alt.steps.map((x) => x.threshold), [500, 2000, 7000, 22000, 70000]);
  assert.deepEqual(t.find((r) => r.id === 'SPEEDRECORD').steps.map((x) => x.threshold), [25, 80, 250, 790, 2500]);
  assert.equal(alt.total.funds, 48000, '80000 x 0.2 x score 2 x exceptional 1.5');
  assert.equal(alt.steps[0].funds, 9600, 'a fifth of it per step');
  assert.equal(alt.steps[0].sci, 1, 'a unit of science per step when the share is one or less');
  assert.equal(Career.intervalReward(3, 1, 5) + Career.intervalReward(3, 2, 5) + Career.intervalReward(3, 3, 5) + Career.intervalReward(3, 4, 5) + Career.intervalReward(3, 5, 5), 3, 'three units spread over five steps');
  const parsed = Parsers.parseCareer('GAME\n{\n  Mode = CAREER\n  SCENARIO\n  {\n    name = ProgressTracking\n    Progress\n    {\n      RecordsAltitude\n      {\n        record = 9000\n      }\n    }\n  }\n}\n');
  assert.equal(parsed.records.RecordsAltitude, 9000);
  const st = Career.fromSave(parsed);
  assert.deepEqual(Career.recordTable(st).find((r) => r.id === 'ALTITUDERECORD').steps.map((x) => x.reached), [true, true, true, false, false]);
});

test('strategies change the money a mission brings in, by the game\'s reasons', () => {
  const s = Career.newState('normal');
  s.strategies = [{ id: 'AppreciationCampaignCfg', factor: 1 }];
  const base = Career.missionFinance(Career.newState('normal'), { cost: 10000, recovery: 6000, contracts: [{ label: 'c', advance: 5000, reward: 20000, sci: 2, rep: 3 }] });
  const withS = Career.missionFinance(s, { cost: 10000, recovery: 6000, contracts: [{ label: 'c', advance: 5000, reward: 20000, sci: 2, rep: 3 }] });
  assert.equal(base.net, 21000);
  assert.ok(withS.net < base.net, 'the strategy turns funds into reputation');
  assert.ok(withS.items.some((i) => i.rep > 3 && /strategies/.test(i.label)));
  assert.equal(withS.items[0].funds, -10000, 'a cost is not converted');
});

test('contract estimates scale with the destination body\'s weight, as Contract.SetFunds does', () => {
  const s = Career.newState('normal');
  const type = Object.keys(CD.contracts).find((k) => CD.contracts[k].funds.reward > 0);
  const home = Career.contractEstimate(s, type, 'trivial');
  const far = Career.contractEstimate(s, type, 'trivial', 'Eve');
  assert.ok(far.weight > 1 && far.reward > home.reward);
  assert.equal(far.reward, Math.round(home.reward * far.weight), 'the weight is a plain multiplier');
});

test('craft: a multi-mode engine burns its closed-cycle mode by default and the air-breathing one on request', () => {
  const c = Craft.parseCraft(craftText([
    { id: 'mk1pod.v2', istg: -1, links: [1], res: {} },
    { id: 'fuelTank', istg: -1, links: [2], res: full('fuelTank') },
    { id: 'RAPIER', istg: 0, res: {} },
  ]));
  const closed = Craft.stages(c).stages.find((s) => s.engines);
  const air = Craft.stages(c, { mode: 'atmosphere' }).stages.find((s) => s.engines);
  assert.ok(Math.abs(closed.thrust - 180) < 1e-6, 'closed cycle thrust 180 kN');
  assert.ok(Math.abs(air.thrust - 105) < 1e-6, 'air-breathing thrust 105 kN');
  assert.ok(air.dv > closed.dv * 3, 'the air-breathing mode (Isp 3200) goes much further on the same fuel: ' + air.dv + ' vs ' + closed.dv);
});

test('craft: mod parts read from .cfg files get a price, a mass and a delta-v like the stock ones', () => {
  const P = require('../js/parsers.js');
  const cfg = [
    'PART', '{', '  name = modTank', '  title = Mod Tank', '  mass = 1', '  cost = 3000', '  category = Propulsion', '  TechRequired = advRocketry',
    '  RESOURCE', '  {', '    name = LiquidFuel', '    amount = 400', '    maxAmount = 400', '  }',
    '  RESOURCE', '  {', '    name = Oxidizer', '    amount = 400', '    maxAmount = 400', '  }', '}',
    'PART', '{', '  name = modEngine', '  title = Mod Engine', '  mass = 0.5', '  cost = 1000',
    '  MODULE', '  {', '    name = ModuleEnginesFX', '    maxThrust = 100', '    PROPELLANT', '    {', '      name = LiquidFuel', '      ratio = 0.9', '    }',
    '    PROPELLANT', '    {', '      name = Oxidizer', '      ratio = 1.1', '    }',
    '    atmosphereCurve', '    {', '      key = 0 400', '      key = 1 300', '    }', '  }', '}',
  ].join('\n');
  const parts = P.parsePartCfg(cfg, {});
  assert.deepEqual(Object.keys(parts).sort(), ['modEngine', 'modTank']);
  assert.deepEqual(parts.modEngine.eng[0].isp, [400, 300]);
  assert.equal(parts.modTank.res.LiquidFuel[1], 400);
  assert.equal(Craft.addParts(parts), 2);
  assert.equal(Craft.addParts({ liquidEngine: { id: 'liquidEngine', mass: 99 } }), 0, 'a stock part is never replaced');
  const c = Craft.parseCraft(craftText([
    { id: 'mk1pod.v2', istg: -1, links: [1], res: {} },
    { id: 'modTank', istg: -1, links: [2], res: { LiquidFuel: [400, 400], Oxidizer: [400, 400] } },
    { id: 'modEngine', istg: 0, res: {} },
  ]));
  assert.deepEqual(c.missing, []);
  const st = Craft.stages(c).stages.find((s) => s.engines);
  assert.ok(st.dv > 1500 && st.dv < 4000, 'mod rocket has a plausible delta-v: ' + st.dv);
  assert.ok(Math.abs(st.thrust - 100) < 1e-9);
});

test('mission: transfers between different planet systems (Kerbin to Laythe, Mun to Duna) use the planets\' window and price the moon ends', () => {
  const opmWorld = require('../js/world.js').createWorld({});
  const laythe = Mission.leg(opmWorld, { type: 'transfer', from: 'Kerbin', to: 'Laythe', park: 100, capture: 100 }, 0);
  assert.ok(!laythe.error, laythe.error);
  assert.ok(laythe.dv > 2500 && laythe.dv < 9000, 'Kerbin to Laythe Δv ' + laythe.dv);
  assert.ok(laythe.flight > 500 * Orb.DAY, 'a Jool trip takes more than a year of Kerbin days: ' + laythe.flight / Orb.DAY);
  const jool = Mission.leg(opmWorld, { type: 'transfer', from: 'Kerbin', to: 'Jool', park: 100, capture: 100 }, 0);
  assert.ok(laythe.dv > jool.dv * 0.5);
  const fromMun = Mission.leg(opmWorld, { type: 'transfer', from: 'Mun', to: 'Duna', park: 30, capture: 100 }, 0);
  const fromKerbin = Mission.leg(opmWorld, { type: 'transfer', from: 'Kerbin', to: 'Duna', park: 100, capture: 100 }, 0);
  assert.ok(!fromMun.error && fromMun.dv > 0);
  assert.ok(Math.abs(fromMun.dv - fromKerbin.dv) < 1500, 'leaving from the Mun is within a km/s of leaving from Kerbin orbit');
});
