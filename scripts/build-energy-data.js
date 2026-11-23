// SPDX-License-Identifier: AGPL-3.0-or-later
/* Builds js/energy-data.js (what makes and what uses electric charge) from a copy of KSP 1.12.5 that you own.
 *
 *   node scripts/build-energy-data.js "<KSP folder>"
 *
 * Numbers only, for the parts already listed in js/career-data.js (so titles, prices, masses and tech nodes come from there):
 * solar panels (charge rate and whether they track the sun), generators (RTG), fuel cells (charge made, propellant burnt),
 * batteries (capacity), probe cores and reaction wheels (what they draw), and the other big consumers (drills, converters,
 * radiators, rover wheels). How a panel's output follows distance and angle was read from the game's code with tools/ildump
 * (docs/RESEARCH.md, section 8). */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseConfig } = require('../js/parsers.js');
const CD = require('../js/career-data.js');

const ksp = process.argv[2] || process.env.KSP_DIR;
if (!ksp || !fs.existsSync(path.join(ksp, 'GameData', 'Squad'))) {
  console.error('usage: node scripts/build-energy-data.js "<KSP folder>"');
  process.exit(2);
}
const known = new Set(CD.parts.map((p) => p.id));
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.cfg$/.test(e.name)) files.push(p);
  }
})(path.join(ksp, 'GameData'));

const kv = (n, k) => { const v = n.vals.find((x) => x[0] === k); return v ? v[1] : undefined; };
const num = (v) => { const x = parseFloat(v); return isFinite(x) ? x : undefined; };
const out = { game: CD.game, solar: {}, rtg: {}, cells: {}, batteries: {}, cores: {}, wheels: {}, drills: {}, converters: {}, radiators: {}, motors: {}, stored: {}, engines: {}, ore: { bodies: {}, drills: {}, isru: {} } };
const ecIn = (m) => {                                                   // INPUT_RESOURCE ElectricCharge ratio inside a module
  const c = m.children.find((x) => x.name === 'INPUT_RESOURCE' && kv(x, 'ResourceName') === 'ElectricCharge');
  return c ? num(kv(c, 'Ratio')) : undefined;
};
const ecRate = (m) => {                                                 // RESOURCE ElectricCharge rate inside a module
  const c = m.children.find((x) => x.name === 'RESOURCE' && kv(x, 'name') === 'ElectricCharge');
  return c ? num(kv(c, 'rate')) : undefined;
};

for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  if (!/ElectricCharge|ModuleDeployableSolarPanel/.test(text)) continue;
  let tree;
  try { tree = parseConfig(text); } catch (e) { continue; }
  (function visit(n) {
    if (n.name === 'PART') {
      const id = kv(n, 'name');
      if (known.has(id)) {
        const cap = n.children.find((c) => c.name === 'RESOURCE' && kv(c, 'name') === 'ElectricCharge');
        const cat = (CD.parts.find((p) => p.id === id) || {}).cat;
        if (cap && cat === 'Electrical') out.batteries[id] = num(kv(cap, 'maxAmount'));
        if (cap && num(kv(cap, 'maxAmount')) > 0) out.stored[id] = num(kv(cap, 'maxAmount'));          // charge a part carries (probe cores, pods and batteries alike)
        for (const m of n.children.filter((c) => c.name === 'MODULE')) {
          const mn = kv(m, 'name');
          if (mn === 'ModuleDeployableSolarPanel') out.solar[id] = { rate: num(kv(m, 'chargeRate')), tracking: kv(m, 'isTracking') !== 'false' };
          else if (mn === 'ModuleGenerator' && cat === 'Electrical') {
            const o = m.children.find((c) => c.name === 'OUTPUT_RESOURCE' && (kv(c, 'ResourceName') === 'ElectricCharge' || kv(c, 'name') === 'ElectricCharge'));
            if (o) out.rtg[id] = num(kv(o, 'rate') !== undefined ? kv(o, 'rate') : kv(o, 'Ratio'));
          } else if (mn === 'ModuleResourceConverter') {
            const outEc = m.children.find((c) => c.name === 'OUTPUT_RESOURCE' && kv(c, 'ResourceName') === 'ElectricCharge');
            if (outEc) {
              const inp = (r) => { const c = m.children.find((x) => x.name === 'INPUT_RESOURCE' && kv(x, 'ResourceName') === r); return c ? num(kv(c, 'Ratio')) : 0; };
              out.cells[id] = { ec: num(kv(outEc, 'Ratio')), lf: inp('LiquidFuel'), ox: inp('Oxidizer') };
            } else if (ecIn(m) !== undefined) out.converters[id] = Math.max(out.converters[id] || 0, ecIn(m));
            // a converter that eats ore (the Convert-O-Trons): ore per second, propellant made per second, charge per second, and the crew bonus numbers
            const oreIn = m.children.find((x) => x.name === 'INPUT_RESOURCE' && kv(x, 'ResourceName') === 'Ore');
            const lfOut = m.children.find((x) => x.name === 'OUTPUT_RESOURCE' && kv(x, 'ResourceName') === 'LiquidFuel');
            const oxOut = m.children.find((x) => x.name === 'OUTPUT_RESOURCE' && kv(x, 'ResourceName') === 'Oxidizer');
            if (oreIn && lfOut && oxOut) out.ore.isru[id] = { ore: num(kv(oreIn, 'Ratio')), lf: num(kv(lfOut, 'Ratio')), ox: num(kv(oxOut, 'Ratio')), ec: ecIn(m) || 0, bonus: num(kv(m, 'SpecialistBonusBase')), factor: num(kv(m, 'SpecialistEfficiencyFactor')) };
          } else if (mn === 'ModuleCommand' && ecRate(m) !== undefined) out.cores[id] = ecRate(m);
          else if (mn === 'ModuleReactionWheel' && ecRate(m) !== undefined) out.wheels[id] = ecRate(m);
          else if (mn === 'ModuleResourceHarvester' && ecIn(m) !== undefined) {
            out.drills[id] = ecIn(m);
            // a surface drill (HarvesterType 0) digs Efficiency x abundance units of its resource per second (ModuleResourceHarvester.PrepareRecipe), times the crew bonus
            if (num(kv(m, 'HarvesterType')) === 0 && kv(m, 'ResourceName') === 'Ore') out.ore.drills[id] = { eff: num(kv(m, 'Efficiency')), ec: ecIn(m), bonus: num(kv(m, 'SpecialistBonusBase')), factor: num(kv(m, 'SpecialistEfficiencyFactor')) };
          }
          else if (mn === 'ModuleActiveRadiator' && ecRate(m) !== undefined) out.radiators[id] = ecRate(m);
          else if (mn === 'ModuleWheelMotor' && ecRate(m) !== undefined) out.motors[id] = ecRate(m);
          else if (/^ModuleEngines/.test(mn)) {
            // electric engines: charge per second at full thrust = mass flow x the charge's share of the propellant mix (the charge itself has no mass)
            const props = m.children.filter((c) => c.name === 'PROPELLANT');
            const ecP = props.find((c) => kv(c, 'name') === 'ElectricCharge');
            const thrust = num(kv(m, 'maxThrust'));
            const curve = m.children.find((c) => c.name === 'atmosphereCurve');
            const key0 = curve ? curve.vals.filter((v) => v[0] === 'key').map((v) => v[1].split(/\s+/).map(Number)).find((k) => k[0] === 0) : null;
            if (ecP && thrust > 0 && key0 && key0[1] > 0) {
              const mass = props.reduce((q, c) => q + (num(kv(c, 'ratio')) || 0) * ((CD.resources[kv(c, 'name')] || {}).density || 0), 0);
              const flow = thrust / (key0[1] * 9.80665);                                                  // tonnes per second (thrust in kN)
              if (mass > 0) out.engines[id] = { ec: (flow / mass) * num(kv(ecP, 'ratio')), thrust: thrust, isp: key0[1], fuel: props.filter((c) => kv(c, 'name') !== 'ElectricCharge').map((c) => kv(c, 'name')).join('+') };
            }
          }
        }
      }
    }
    n.children.forEach(visit);
  })(tree);
}

// Ore distribution per body (GameData/Squad/Resources/Ore.cfg): abundance range in percent and the share of the ground that has any
{
  const oreCfg = path.join(ksp, 'GameData', 'Squad', 'Resources', 'Ore.cfg');
  if (fs.existsSync(oreCfg)) {
    const tree = parseConfig(fs.readFileSync(oreCfg, 'utf8'));
    for (const n of tree.children) {
      if (n.name !== 'GLOBAL_RESOURCE' && n.name !== 'PLANETARY_RESOURCE') continue;
      if (kv(n, 'ResourceName') !== 'Ore') continue;
      const d = n.children.find((c) => c.name === 'Distribution');
      if (!d) continue;
      out.ore.bodies[n.name === 'GLOBAL_RESOURCE' ? 'default' : kv(n, 'PlanetName')] = { chance: num(kv(d, 'PresenceChance')), min: num(kv(d, 'MinAbundance')), max: num(kv(d, 'MaxAbundance')), variance: num(kv(d, 'Variance')), dispersal: num(kv(d, 'Dispersal')) };
    }
  }
}

const header = '// SPDX-License-Identifier: AGPL-3.0-or-later\n/* GENERATED by scripts/build-energy-data.js from a KSP 1.12.5 install (numbers only). Do not edit by hand. */\n' +
  '(function (root, factory) {\n  if (typeof module === \'object\' && module.exports) module.exports = factory();\n  else root.KSPEnergyData = factory();\n})(typeof self !== \'undefined\' ? self : this, function () {\n  \'use strict\';\n  return ';
const dst = path.join(__dirname, '..', 'js', 'energy-data.js');
fs.writeFileSync(dst, header + JSON.stringify(out) + ';\n});\n');
console.log('wrote ' + dst + ': ' + Object.keys(out).filter((k) => k !== 'game').map((k) => k + ' ' + Object.keys(out[k]).length).join(', '));
