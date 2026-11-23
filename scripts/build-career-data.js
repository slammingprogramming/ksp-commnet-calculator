// SPDX-License-Identifier: AGPL-3.0-or-later
/* Builds js/career-data.js (the tech tree, part list, science and strategy tables, contract base values and the facility rules
 * the career and mission planners use) from a copy of KSP 1.12.5 that you own, plus the facts file written by
 * tools/unityscan (facility prices and per-body science multipliers live in the game's scene files, not in GameData).
 *
 *   python tools/unityscan/unityscan.py "<KSP folder>" facts.json
 *   node scripts/build-career-data.js "<KSP folder>" facts.json
 *
 * It copies numbers only (names, costs, masses, thrust, Isp, tank contents, tech nodes). No part models, text or images. The
 * constants in LEVELS and GAME_VARIABLES were read from Assembly-CSharp.dll with tools/ildump (see docs/RESEARCH.md, section 8). */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseConfig } = require('../js/parsers.js');

const ksp = process.argv[2] || process.env.KSP_DIR;
const factsFile = process.argv[3];
if (!ksp || !fs.existsSync(path.join(ksp, 'GameData', 'Squad'))) {
  console.error('usage: node scripts/build-career-data.js "<KSP folder>" [facts.json]');
  process.exit(2);
}
const facts = factsFile ? JSON.parse(fs.readFileSync(factsFile, 'utf8')) : null;

const read = (p) => fs.readFileSync(p, 'utf8');
function files(dir, ext, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) files(p, ext, out); else if (p.toLowerCase().endsWith(ext)) out.push(p);
  }
  return out;
}
const val = (node, key) => { const v = node.vals.find((p) => p[0] === key); return v ? v[1] : undefined; };
const vals = (node, key) => node.vals.filter((p) => p[0] === key).map((p) => p[1]);
const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
const round = (x, d) => { const k = Math.pow(10, d === undefined ? 4 : d); return Math.round(x * k) / k; };
const kids = (node, name) => node.children.filter((c) => c.name === name);
const kid = (node, name) => node.children.find((c) => c.name === name);
function title(node, key) {
  const e = node.vals.find((p) => p[0] === (key || 'title'));
  if (!e) return '';
  if (/^#autoLOC/i.test(e[1])) { const eq = e[2].lastIndexOf('='); return eq >= 0 ? e[2].slice(eq + 1).trim() : ''; }
  return e[1];
}

// ---- resources -------------------------------------------------------------------------------------------------
const resources = {};
for (const n of parseConfig(read(path.join(ksp, 'GameData/Squad/Resources/ResourcesGeneric.cfg'))).children) {
  if (n.name !== 'RESOURCE_DEFINITION') continue;
  resources[val(n, 'name')] = { density: num(val(n, 'density')) || 0, unit: num(val(n, 'unitCost')) || 0 };
    if (/^NO_FLOW$/i.test(val(n, 'flowMode') || '')) resources[val(n, 'name')].noFlow = 1;   // solid fuel only feeds the engine in the same part
}

// ---- tech tree -------------------------------------------------------------------------------------------------
const tech = [];
for (const n of parseConfig(read(path.join(ksp, 'GameData/Squad/Resources/TechTree.cfg'))).children[0].children) {
  if (n.name !== 'RDNode') continue;
  const pos = (val(n, 'pos') || '0,0,0').split(',').map(Number);
  const tier = /^node(\d+)_/.exec(val(n, 'nodeName') || '');
  tech.push({
    id: val(n, 'id'), title: title(n), cost: num(val(n, 'cost')) || 0, tier: tier ? +tier[1] : 0,
    any: /^true$/i.test(val(n, 'anyToUnlock') || ''), pos: [Math.round(pos[0]), Math.round(pos[1])],
    parents: kids(n, 'Parent').map((p) => val(p, 'parentID')),
  });
}

// ---- parts -----------------------------------------------------------------------------------------------------
const partDirs = [['', 'GameData/Squad/Parts']];
for (const dlc of ['MakingHistory', 'Serenity']) partDirs.push([dlc, 'GameData/SquadExpansion/' + dlc + '/Parts']);
const xmit = {};                       // transmit efficiency per experiment (the module default is 0.5)
const parts = [];
const seen = new Set();
for (const [dlc, dir] of partDirs) {
  for (const f of files(path.join(ksp, dir), '.cfg')) {
    if (/deprecated/i.test(f)) continue;
    let tree;
    try { tree = parseConfig(read(f)); } catch (e) { continue; }
    for (const p of tree.children) {
      if (p.name !== 'PART') continue;
      const name = val(p, 'name');
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const rec = {
        id: name, title: title(p) || name, cost: num(val(p, 'cost')) || 0, mass: num(val(p, 'mass')) || 0,
        entry: num(val(p, 'entryCost')) || 0, tech: val(p, 'TechRequired') || '', cat: val(p, 'category') || '',
      };
      if (dlc) rec.dlc = dlc;
      const res = {};
      for (const r of kids(p, 'RESOURCE')) res[val(r, 'name')] = [num(val(r, 'amount')) || 0, num(val(r, 'maxAmount')) || 0];
      if (Object.keys(res).length) rec.res = res;
      const crew = num(val(p, 'CrewCapacity'));
      if (crew) rec.crew = crew;
      const engines = [];
      for (const m of kids(p, 'MODULE')) {
        const mn = val(m, 'name');
        if (mn === 'ModuleEngines' || mn === 'ModuleEnginesFX') {
          const curve = kid(m, 'atmosphereCurve');
          const keys = curve ? vals(curve, 'key').map((k) => k.split(/\s+/).map(Number)) : [];
          const at = (pressure) => { const k = keys.find((x) => x[0] === pressure); return k ? k[1] : undefined; };
          const e = { id: val(m, 'engineID') || 'Default', thrust: num(val(m, 'maxThrust')) || 0, isp: [at(0), at(1)],
            props: kids(m, 'PROPELLANT').map((q) => [val(q, 'name'), num(val(q, 'ratio')) || 1]) };
          if (e.isp[0] === undefined && keys.length) e.isp = [keys[0][1], keys[keys.length - 1][1]];
          const minT = num(val(m, 'minThrust'));
          if (minT) e.min = minT;
          engines.push(e);
        } else if (mn === 'ModuleDecouple' || mn === 'ModuleAnchoredDecoupler') {
          // explosiveNodeID says which attachment separates: a surface attachment ('srf', radial boosters) takes the part away with
          // what hangs on it (dec 3); a stack node leaves the part with its parent and drops what hangs below it (dec 1)
          const node = val(m, 'explosiveNodeID') || '';
          rec.dec = node.toLowerCase() === 'srf' ? 3 : 1;
          if (rec.dec === 1 && node) rec.decNode = node;
        } else if (mn === 'ModuleGroundExperiment' || mn === 'ModuleGroundExpControl' || mn === 'ModuleGroundSciencePart' || mn === 'ModuleGroundCommsPart') {
          if (mn === 'ModuleGroundExperiment') rec.ground = val(m, 'experimentId');   // Breaking Ground deployed instrument
          // power units the deployed part makes and needs (a station only runs when what its parts make covers what they need)
          rec.pu = [num(val(m, 'powerUnitsProduced'), 0), num(val(m, 'powerUnitsRequired'), 0)];
        } else if (mn === 'CModuleFuelLine') {
          rec.fuelLine = 1;                                // a fuel duct: the part it sits on feeds the part at its far end
        } else if (mn === 'ModuleProceduralFairing') {
          rec.dec = 2;
        } else if (mn === 'ModuleCommand') {
          rec.cmd = 1;
        } else if (mn === 'ModuleScienceExperiment') {
          (rec.sci = rec.sci || []).push(val(m, 'experimentID'));
          xmit[val(m, 'experimentID')] = num(val(m, 'xmitDataScalar'), 0.5);
        } else if (mn === 'ModuleRCS' || mn === 'ModuleRCSFX') {
          const curve = kid(m, 'atmosphereCurve');
          const keys = curve ? vals(curve, 'key').map((k) => k.split(/\s+/).map(Number)) : [];
          rec.rcs = { thrust: num(val(m, 'thrusterPower')) || 0, isp: keys.length ? keys[0][1] : 240, prop: (kid(m, 'PROPELLANT') ? val(kid(m, 'PROPELLANT'), 'name') : 'MonoPropellant') };
        }
      }
      if (engines.length) rec.eng = engines;
      if (/^false$/i.test(val(p, 'fuelCrossFeed') || '')) rec.noXfeed = 1;
      parts.push(rec);
    }
  }
}

// the game's own typo ("Unresearcheable") and any other value that is not a node mean: not obtainable by research
const nodeIds = new Set(tech.map((t) => t.id));
for (const p of parts) if (p.tech && !nodeIds.has(p.tech)) p.tech = 'Unresearchable';

// ---- science experiments ---------------------------------------------------------------------------------------
const experiments = {};
const sd = parseConfig(read(path.join(ksp, 'GameData/Squad/Resources/ScienceDefs.cfg')));
for (const n of sd.children.length === 1 && sd.children[0].children.length ? sd.children[0].children : sd.children) {
  if (n.name !== 'EXPERIMENT_DEFINITION') continue;
  experiments[val(n, 'id')] = {
    title: title(n), base: num(val(n, 'baseValue')) || 0, cap: num(val(n, 'scienceCap')) || 0, scale: num(val(n, 'dataScale')) || 1,
    atmo: /^true$/i.test(val(n, 'requireAtmosphere') || ''), sit: num(val(n, 'situationMask')) || 0, biome: num(val(n, 'biomeMask')) || 0,
  };
}

for (const id of Object.keys(experiments)) if (xmit[id] !== undefined) experiments[id].xmit = xmit[id];

// ---- Breaking Ground (Serenity): deployed instruments and surface rocks ------------------------------------------
const dlcSerenity = path.join(ksp, 'GameData/SquadExpansion/Serenity');
const deployed = { instruments: {}, rocScience: {}, rocs: [], returns: [], timeDelay: 60 };
if (fs.existsSync(path.join(dlcSerenity, 'Resources/ScienceDefs.cfg'))) {
  const sdd = parseConfig(read(path.join(dlcSerenity, 'Resources/ScienceDefs.cfg')));
  for (const n of sdd.children.length === 1 && sdd.children[0].children.length ? sdd.children[0].children : sdd.children) {
    if (n.name !== 'EXPERIMENT_DEFINITION') continue;
    const id = val(n, 'id');
    const rec = { title: title(n), base: num(val(n, 'baseValue')) || 0, cap: num(val(n, 'scienceCap')) || 0, atmo: /^true$/i.test(val(n, 'requireAtmosphere') || ''), vacuum: /^true$/i.test(val(n, 'requireNoAtmosphere') || '') };
    if (/^deployed/.test(id)) deployed.instruments[id] = rec;
    else if (/^ROCScience_/.test(id)) deployed.rocScience[id.slice('ROCScience_'.length)] = { title: rec.title, base: rec.base, cap: rec.cap };
  }
  const dsCfg = parseConfig(read(path.join(dlcSerenity, 'Resources/DeployedScience.cfg')));
  const root = dsCfg.children.find((c) => c.name === 'DEPLOYEDSCIENCE') || dsCfg;
  deployed.timeDelay = num(val(root, 'ScienceTimeDelay'), 60);
  const dr = kid(root, 'DIMINSHINGRETURNS');
  if (dr) deployed.returns = kids(dr, 'ENTRY').map((e) => [num(val(e, 'ExpCount')), num(val(e, 'Rate'))]);
  const se = kid(root, 'SEISMICENERGY');
  if (se) { deployed.seismicMin = num(val(se, 'MinimumEnergyRequired')); deployed.seismicEnergy = {}; for (const e of kids(se, 'ENTRY')) deployed.seismicEnergy[val(e, 'BodyName')] = num(val(e, 'Energy')); }
  // crew skills: the scientist who sets an instrument down fixes its rate, an engineer adds power units to solar panels and RTGs
  const traitsFile = path.join(dlcSerenity, 'Experience/Traits.cfg');
  if (fs.existsSync(traitsFile)) {
    for (const t of parseConfig(read(traitsFile)).children) {
      for (const e of kids(t, 'EFFECT')) {
        const mods = (val(e, 'modifiers') || '').split(',').map((x) => num(x.trim())).filter((x) => x !== undefined && !isNaN(x));
        if (val(e, 'name') === 'DeployedScienceExpSkill') deployed.expSkill = mods;
        if (val(e, 'name') === 'DeployedSciencePowerSkill') deployed.powerSkill = mods;
      }
    }
  }
  const rocs = parseConfig(read(path.join(dlcSerenity, 'Resources/rocsdef.cfg')));
  for (const n of rocs.children) {
    if (n.name !== 'ROC_DEFINITION') continue;
    deployed.rocs.push({
      type: val(n, 'Type'), name: title(n, 'displayName'), freq: num(val(n, 'Frequency')), small: /^true$/i.test(val(n, 'SmallROC') || ''), take: /^true$/i.test(val(n, 'CanBeTaken') || ''),
      bodies: kids(n, 'CELESTIALBODY').map((c) => ({ body: val(c, 'Name'), biomes: c.vals.filter((v) => v[0] === 'Biome').map((v) => v[1]) })),
    });
  }
}

// ---- strategies ------------------------------------------------------------------------------------------------
const strategies = [];
for (const f of [path.join(ksp, 'GameData/Squad/Strategies/Strategies.cfg')]) {
  for (const n of parseConfig(read(f)).children) {
    if (n.name !== 'STRATEGY') continue;
    const eff = kids(n, 'EFFECT').map((e) => {
      const o = { name: val(e, 'name'), note: title(e, 'effectDescription') };
      for (const k of ['input', 'output', 'currency', 'operation', 'valueId']) if (val(e, k)) o[k] = val(e, k);
      for (const k of ['minRate', 'maxRate', 'minShare', 'maxShare', 'minValue', 'maxValue']) if (val(e, k) !== undefined && val(e, k) !== '') o[k] = num(val(e, k));
      if (val(e, 'AffectReasons')) o.affect = val(e, 'AffectReasons').split(',').map((x) => x.trim()).filter(Boolean);
      return o;
    });
    strategies.push({
      id: val(n, 'name'), title: title(n), dept: val(n, 'department'), repMin: num(val(n, 'requiredReputationMin')), repMax: num(val(n, 'requiredReputationMax')),
      costFunds: [num(val(n, 'initialCostFundsMin')) || 0, num(val(n, 'initialCostFundsMax')) || 0],
      costRep: [num(val(n, 'initialCostReputationMin')) || num(val(n, 'initialCostReputation')) || 0, num(val(n, 'initialCostReputationMax')) || num(val(n, 'initialCostReputation')) || 0],
      costSci: [num(val(n, 'initialCostScienceMin')) || num(val(n, 'initialCostScience')) || 0, num(val(n, 'initialCostScienceMax')) || num(val(n, 'initialCostScience')) || 0],
      days: [num(val(n, 'minLeastDuration')), num(val(n, 'maxLeastDuration')), num(val(n, 'minLongestDuration')), num(val(n, 'maxLongestDuration'))],
      slider: /^true$/i.test(val(n, 'hasFactorSlider') || ''), effects: eff,
    });
  }
}

// ---- contracts (base values before the planet and difficulty modifiers) ----------------------------------------
const contracts = {};
const ct = parseConfig(read(path.join(ksp, 'GameData/Squad/Contracts/Contracts.cfg')));
const ctRoot = ct.children.find((c) => c.name === 'Contracts') || ct;
for (const n of ctRoot.children) {
  const f = kid(n, 'Funds'), s = kid(n, 'Science'), r = kid(n, 'Reputation'), x = kid(n, 'Expiration');
  if (!f && !s && !r) continue;
  const rec = {};
  if (f) rec.funds = { advance: num(val(f, 'BaseAdvance')) || 0, reward: num(val(f, 'BaseReward')) || 0, failure: num(val(f, 'BaseFailure')) || 0 };
  if (s) rec.sci = num(val(s, 'BaseReward')) || 0;
  if (r) rec.rep = { reward: num(val(r, 'BaseReward')) || 0, failure: num(val(r, 'BaseFailure')) || 0 };
  if (x) rec.days = { min: num(val(x, 'MinimumExpireDays')), max: num(val(x, 'MaximumExpireDays')), deadline: num(val(x, 'DeadlineDays')) };
  contracts[n.name] = rec;
}

// ---- constants read from the game's code (tools/ildump, GameVariables and CareerParams) ------------------------------
/* Facility levels are normalised 0, 0.5, 1 for the three levels. Each GameVariables method compares the value with thresholds,
 * so the numbers below are the result for level 1, 2 and 3 (Infinity = no limit; JSON stores it as null). */
const LEVELS = {
  LaunchPad: { massLimit: [18, 140, null] },                                  // GetCraftMassLimit (tonnes)
  VehicleAssemblyBuilding: { partLimit: [30, 255, null] },                    // GetPartCountLimit
  SpaceplaneHangar: { partLimit: [30, 255, null] },
  Administration: { strategies: [1, 3, 5], commit: [0.25, 0.6, 1] },         // GetActiveStrategyLimit, GetStrategyCommitRange
  MissionControl: { contracts: [2, 7, null], flightPlanning: [false, true, true] },   // GetActiveContractsLimit, UnlockedFlightPlanning (> 0.4)
  AstronautComplex: { crew: [5, 12, null] },                                  // GetActiveCrewLimit
  TrackingStation: { tracked: [0, 8, null], patches: [0, 2, 'all'], maneuverTool: [false, false, true] },   // GetTrackedObjectLimit, GetPatchesAheadLimit, ManeuverToolAvailable (> 0.75)
  ResearchAndDevelopment: { scienceCostLimit: [100, 500, null], dataRatio: [0.4, 0.8, 1] },   // GetScienceCostLimit, GetDataToScienceRatio
};
const GAME_VARIABLES = {
  recovery: { max: 0.98, min: 0.1, pad: 1.0, ksc: 0.98 },                     // VesselRecovery.OnVesselRecovered: lerp(0.98, 0.1, distance / (pi R))
  resourceRecovery: 1,                                                        // fuel left in recovered tanks is refunded at the same factor
  prestige: { trivial: 1, significant: 1.25, exceptional: 1.5 },              // contractPrestige*
  mentality: { trivial: 1.1, significant: 1.2, exceptional: 1.3 },            // mentality*  (funds, rep, science, expiry, deadline)
  reputation: { kerbalDeath: 10, kerbalRecovery: 25 },
};
/* World First milestones (ProgressUtilities.ScoreProgressType / ProgressTypePrestige / OutlierWorldFirstContract and
 * WorldFirstStandardReward, read with tools/ildump). score = [at the home planet, elsewhere]; the type numbers are the ProgressType enum. */
const MILESTONE_TYPES = {
  ORBIT: { n: 16, score: [1, 0.8], label: 'Reach orbit' }, FLYBY: { n: 12, score: [0.8, 1], label: 'Fly by' },
  LANDING: { n: 14, score: [0.1, 1.5], label: 'Land' }, ESCAPE: { n: 8, score: [1.1, 0.6], label: 'Escape' },
  SPLASHDOWN: { n: 24, score: [0.3, 1.5], label: 'Splash down' }, SUBORBIT: { n: 27, score: [0.8, 1], label: 'Suborbital flight' },
  FLIGHT: { n: 11, score: [0.5, 1.2], label: 'Fly in the atmosphere' }, SCIENCE: { n: 21, score: [0.2, 0.6], label: 'Do science' },
  FLAGPLANT: { n: 10, score: [0.2, 0.6], label: 'Plant a flag' }, SURFACEEVA: { n: 28, score: [0.2, 0.6], label: 'Walk on the surface' },
  SPACEWALK: { n: 22, score: [0.6, 0.6], label: 'Spacewalk' }, ORBITRETURN: { n: 17, score: [1, 0.8], label: 'Return from orbit' },
  FLYBYRETURN: { n: 13, score: [0.8, 1], label: 'Return from a fly-by' }, LANDINGRETURN: { n: 15, score: [0.1, 1.5], label: 'Return from the surface' },
  DOCKING: { n: 7, score: [0.3, 0.8], label: 'Dock' }, RENDEZVOUS: { n: 20, score: [1, 0.8], label: 'Rendezvous' },
  CREWTRANSFER: { n: 3, score: [0.3, 0.8], label: 'Transfer crew' }, BASECONSTRUCTION: { n: 2, score: [0.3, 0.8], label: 'Build a base' },
  STATIONCONSTRUCTION: { n: 25, score: [0.8, 0.8], label: 'Build a station' },
  FIRSTLAUNCH: { n: 9, score: [0.1, 0.1], label: 'First launch' }, REACHSPACE: { n: 19, score: [0.8, 0.8], label: 'Reach space' },
  CREWRECOVERY: { n: 4, score: [0.1, 0.1], label: 'Recover a crew' }, POINTOFINTEREST: { n: 18, score: [0.3, 0.8], label: 'Visit a point of interest' },
  STUNT: { n: 26, score: [0.3, 0.8], label: 'Tower buzz' },
};
const MILESTONES = {
  types: MILESTONE_TYPES,
  outlier: ['BASECONSTRUCTION', 'STATIONCONSTRUCTION'],       // OutlierWorldFirstContract; LANDINGRETURN on a body with an atmosphere is one too
  outlierMultiplier: 1.5, passiveBase: 0.2, passiveBody: 0.3,  // Progression config
  base: { funds: 80000, sci: 8, rep: 16 },                     // Progression BaseReward in Contracts.cfg (overwritten below when the file is read)
};
const DIFFICULTY = {                                                          // GameParameters.SetDifficultyPresets
  easy: { startFunds: 250000, gain: [2, 2, 2], loss: [0.5, 0.5], repLossDeclined: 0 },
  normal: { startFunds: 25000, gain: [1, 1, 1], loss: [1, 1], repLossDeclined: 1 },
  moderate: { startFunds: 15000, gain: [0.9, 0.9, 0.9], loss: [1.5, 1.5], repLossDeclined: 2 },
  hard: { startFunds: 10000, gain: [0.6, 0.6, 0.6], loss: [2, 2], repLossDeclined: 3 },
};

const facilities = {};
if (facts && facts.career) {
  for (const [k, v] of Object.entries(facts.career.facilities)) facilities[k] = { base: v.base, up: [v.level2, v.level3], ...(LEVELS[k] || {}) };
}
const bodyScience = {};
if (facts && facts.career) {
  for (const [k, v] of Object.entries(facts.career.science)) {
    const o = {}; for (const [a, b] of Object.entries(v)) o[a] = round(b, 4);
    bodyScience[k === 'Sun' ? 'Kerbol' : k === 'Eloo' ? 'Eeloo' : k] = o;
  }
}

const prog = ctRoot.children.find((c) => c.name === 'Progression');
if (prog) {
  MILESTONES.base = { funds: num(val(kid(prog, 'Funds'), 'BaseReward')), sci: num(val(kid(prog, 'Science'), 'BaseReward')), rep: num(val(kid(prog, 'Reputation'), 'BaseReward')) };
  MILESTONES.outlierMultiplier = num(val(prog, 'OutlierMilestoneMultiplier')); MILESTONES.passiveBase = num(val(prog, 'PassiveBaseRatio')); MILESTONES.passiveBody = num(val(prog, 'PassiveBodyRatio'));
}
const out = {
  game: '1.12.5', resources, tech, parts, experiments, strategies, contracts, facilities, bodyScience, milestones: MILESTONES, deployed,
  levels: LEVELS, vars: GAME_VARIABLES, difficulty: DIFFICULTY,
};
const json = JSON.stringify(out, (k, v) => (v === Infinity ? null : v));
const header = '// SPDX-License-Identifier: AGPL-3.0-or-later\n/* GENERATED by scripts/build-career-data.js from a KSP 1.12.5 install (numbers only). Do not edit by hand. */\n';
const body = '(function (root, factory) {\n  if (typeof module === \'object\' && module.exports) module.exports = factory();\n  else root.KSPCareerData = factory();\n})(typeof self !== \'undefined\' ? self : this, function () {\n  \'use strict\';\n  return ' + json + ';\n});\n';
fs.writeFileSync(path.join(__dirname, '..', 'js', 'career-data.js'), header + body);
console.log('tech nodes %d, parts %d, experiments %d, strategies %d, contract types %d, facilities %d, bodies %d, %d KB',
  tech.length, parts.length, Object.keys(experiments).length, strategies.length, Object.keys(contracts).length,
  Object.keys(facilities).length, Object.keys(bodyScience).length, Math.round((header + body).length / 1024));
