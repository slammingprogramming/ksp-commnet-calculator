// SPDX-License-Identifier: AGPL-3.0-or-later
/* Parsers for KSP ConfigNode text: part .cfg files (mod antennas), Kopernicus planet-pack configs (bodies) and
 * persistent.sfs saves (difficulty, Tracking Station level, vessels). No DOM access. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KSPParsers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Generic ConfigNode parser: node = {name, vals: [[key, value, comment]], children: []}. */
  function parseConfig(text) {
    const root = { name: 'root', vals: [], children: [] };
    const stack = [root];
    let pending = null;
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
    for (const line of lines) {
      const raw = line.trim();
      if (!raw || raw.startsWith('//')) continue;
      if (raw === '{') {
        const node = { name: pending || '', vals: [], children: [] };
        stack[stack.length - 1].children.push(node);
        stack.push(node);
        pending = null;
        continue;
      }
      if (raw === '}') {
        if (stack.length > 1) stack.pop();
        pending = null;
        continue;
      }
      const eq = raw.indexOf('=');
      const brace = raw.endsWith('{');
      if (eq > 0 && !brace) {
        const key = raw.slice(0, eq).trim();
        let value = raw.slice(eq + 1);
        let comment = '';
        const c = value.indexOf('//');
        if (c >= 0) { comment = value.slice(c + 2); value = value.slice(0, c); }
        stack[stack.length - 1].vals.push([key, value.trim(), comment]);
        pending = null;
      } else if (brace) {
        const node = { name: raw.replace(/\{\s*$/, '').replace(/\s*\/\/.*$/, '').trim(), vals: [], children: [] };
        stack[stack.length - 1].children.push(node);
        stack.push(node);
        pending = null;
      } else {
        // a node name may carry a trailing comment ("ARM // Asteroid Recovery Contracts"); the name is what is before it
        pending = raw.replace(/\s*\/\/.*$/, '');
      }
    }
    return root;
  }

  const get = (node, key) => {
    const v = node.vals.find((p) => p[0] === key);
    return v ? v[1] : undefined;
  };
  const getEntry = (node, key) => node.vals.find((p) => p[0] === key);
  const num = (v) => {
    const n = parseFloat(v);
    return isFinite(n) ? n : undefined;
  };
  const bool = (v) => (v === undefined ? undefined : /^true$/i.test(String(v).trim()));

  function walk(node, fn) {
    fn(node);
    for (const c of node.children) walk(c, fn);
  }

  const TRANSMITTER_MODULES = ['ModuleDataTransmitter', 'ModuleGroundCommsPart', 'ModuleGroundExpControl'];

  function cleanTitle(entry, fallback) {
    if (!entry) return fallback;
    const value = entry[1];
    if (/^#autoLOC/i.test(value)) {
      const eq = entry[2].lastIndexOf('=');
      return eq >= 0 && entry[2].slice(eq + 1).trim() ? entry[2].slice(eq + 1).trim() : fallback;
    }
    return value || fallback;
  }

  /** Antennas defined by PART nodes in a .cfg file. Skips parts that aren't real antennas. */
  function parseAntennaCfg(text) {
    const tree = parseConfig(text);
    const found = [];
    walk(tree, (node) => {
      if (node.name !== 'PART') return;
      const partName = get(node, 'name');
      if (!partName) return;
      const mod = node.children.find((c) => c.name === 'MODULE' && TRANSMITTER_MODULES.indexOf(get(c, 'name')) >= 0);
      if (!mod) return;
      const power = num(get(mod, 'antennaPower'));
      const type = String(get(mod, 'antennaType') || 'DIRECT').trim().toLowerCase();
      if (!(power > 0) || type === 'internal') return;
      // The game's ModuleDataTransmitter starts with antennaCombinable = false (read from its constructor), so a part
      // that does not say it is combinable is not; exponent 0.75 and power 500k are the defaults for the other fields.
      const combinable = bool(get(mod, 'antennaCombinable')) === true;
      const exp = num(get(mod, 'antennaCombinableExponent'));
      found.push({
        partName: partName,
        name: cleanTitle(getEntry(node, 'title'), partName),
        type: type === 'relay' ? 'relay' : 'direct',
        power: power,
        combinable: combinable,
        exp: !combinable ? 0 : exp === undefined ? 0.75 : exp,
        mass: num(get(node, 'mass')) || 0,
        cost: num(get(node, 'cost')) || 0,
        tech: get(node, 'TechRequired') || '',
        pktSize: num(get(mod, 'packetSize')) || 0,
        pktInterval: num(get(mod, 'packetInterval')) || 0,
        pktEC: num(get(mod, 'packetResourceCost')) || 0,
        ground: get(mod, 'name') !== 'ModuleDataTransmitter',
      });
    });
    return found;
  }

  /* ---------- parts that make, store or use electric charge ---------- */

  /**
   * Power parts defined by PART nodes in a .cfg file (any mod): solar panels, generators (RTGs, fission reactors), fuel-cell style
   * converters, batteries, and the parts that draw charge (probe cores, reaction wheels, drills, converters, radiators, wheel motors,
   * electric engines). Same shape as the game data in energy-data.js, plus `parts` (title, mass, cost, tech) for each id:
   * { parts, solar {rate, tracking, fixed (share of the sun a fixed panel always gets, for spherical and cylindrical panels)}, rtg, reactors, cells {ec, lf, ox, inputs},
   * batteries, stored (charge a part carries), cores, wheels, drills, converters, radiators, motors, engines {ec, thrust, isp, fuel} }.
   * `densities` maps a resource to its density (t per unit) for the engines; `loc` maps #LOC keys to English titles.
   */
  function parsePowerCfg(text, densities, loc) {
    const tree = parseConfig(text);
    const out = { parts: {}, solar: {}, rtg: {}, reactors: {}, cells: {}, batteries: {}, stored: {}, cores: {}, wheels: {}, drills: {}, converters: {}, radiators: {}, motors: {}, engines: {} };
    const dens = densities || {};
    const nameOf = (m) => get(m, 'name');
    const isEC = (c) => /^ElectricCharge$/i.test(String(get(c, 'name') || get(c, 'ResourceName') || '').trim());
    const rateOf = (c) => num(get(c, 'rate') !== undefined ? get(c, 'rate') : get(c, 'Ratio') !== undefined ? get(c, 'Ratio') : get(c, 'ratio'));
    walk(tree, (node) => {
      if (node.name !== 'PART') return;
      const id = get(node, 'name');
      if (!id) return;
      const rawTitle = String(get(node, 'title') || '').trim();
      const title = /^#/.test(rawTitle) ? (loc && loc[rawTitle.replace(/\s.*$/, '')]) || (rawTitle.indexOf('=') >= 0 ? rawTitle.slice(rawTitle.lastIndexOf('=') + 1).trim() : '') || id : rawTitle || id;
      const cat = String(get(node, 'category') || '').trim();
      let any = false;
      const cap = node.children.find((c) => c.name === 'RESOURCE' && isEC(c));
      if (cap && num(get(cap, 'maxAmount')) > 0) {
        out.stored[id] = num(get(cap, 'maxAmount')); any = true;
        // a battery is a part that only stores charge (reactors and generators carry some too, but are not batteries)
        if (/^electrical$/i.test(cat) && !node.children.some((c) => c.name === 'MODULE' && /Fission|Generator|Reactor|Converter|SolarPanel|Radioisotope/.test(get(c, 'name') || ''))) out.batteries[id] = out.stored[id];
      }
      for (const m of node.children.filter((c) => c.name === 'MODULE')) {
        const mn = nameOf(m);
        const ecOut = m.children.find((c) => c.name === 'OUTPUT_RESOURCE' && isEC(c));
        const ecIn = m.children.find((c) => c.name === 'INPUT_RESOURCE' && isEC(c));
        const ecRes = m.children.find((c) => c.name === 'RESOURCE' && isEC(c));
        if (mn === 'ModuleDeployableSolarPanel') {
          const type = String(get(m, 'panelType') || 'FLAT').trim().toUpperCase();
          const tr = String(get(m, 'isTracking') || get(m, 'sunTracking') || 'true').trim().toLowerCase() !== 'false';
          const rate = num(get(m, 'chargeRate'));
          if (rate > 0) {
            out.solar[id] = { rate: rate, tracking: tr };
            if (type === 'SPHERICAL') out.solar[id].fixed = 0.25;                 // the game's sunAOA for a spherical panel
            else if (type === 'CYLINDRICAL') out.solar[id].fixed = 1 / (2 * Math.PI); // average of (1 - |dot|) / pi over every direction
            any = true;
          }
        } else if (mn === 'ModuleGenerator' && ecOut) {
          const r = rateOf(ecOut);
          if (r > 0 && !m.children.find((c) => c.name === 'INPUT_RESOURCE')) { out.rtg[id] = r; any = true; }
          else if (r > 0) {
            const inputs = {}; m.children.filter((c) => c.name === 'INPUT_RESOURCE').forEach((c) => { inputs[get(c, 'name') || get(c, 'ResourceName')] = rateOf(c); });
            out.cells[id] = { ec: r, lf: inputs.LiquidFuel || 0, ox: inputs.Oxidizer || 0, inputs: inputs }; any = true;
          }
        } else if (mn === 'ModuleRadioisotopeGenerator' && num(get(m, 'BasePower')) > 0) { out.rtg[id] = num(get(m, 'BasePower')); any = true; }
        else if (mn === 'FissionGenerator' && num(get(m, 'PowerGeneration')) > 0) { out.reactors[id] = num(get(m, 'PowerGeneration')); any = true; }
        else if (mn === 'ModuleSystemHeatFissionReactor') {
          // current Near Future Electrical reactors: ElectricalGeneration { key = 100 <charge per second> }, HeatGeneration { key = 100 <kW> }
          const last = (name) => { const c = m.children.find((x) => x.name === name); const k = c ? c.vals.filter((v) => v[0] === 'key').map((v) => v[1].trim().split(/\s+/).map(Number)) : []; return k.length ? k[k.length - 1][1] : undefined; };
          const ec = last('ElectricalGeneration');
          if (ec > 0) { out.reactors[id] = ec; any = true; }
        }
        else if (mn === 'ModuleResourceConverter' || mn === 'ModuleSystemHeatConverter') {
          if (ecOut) {
            const inputs = {}; m.children.filter((c) => c.name === 'INPUT_RESOURCE').forEach((c) => { inputs[get(c, 'ResourceName') || get(c, 'name')] = rateOf(c); });
            if (rateOf(ecOut) > 0) { out.cells[id] = { ec: rateOf(ecOut), lf: inputs.LiquidFuel || 0, ox: inputs.Oxidizer || 0, inputs: inputs }; any = true; }
          } else if (ecIn && rateOf(ecIn) > 0) { out.converters[id] = Math.max(out.converters[id] || 0, rateOf(ecIn)); any = true; }
        } else if (mn === 'ModuleCommand' && ecRes && rateOf(ecRes) > 0) { out.cores[id] = rateOf(ecRes); any = true; }
        else if (mn === 'ModuleReactionWheel' && ecRes && rateOf(ecRes) > 0) { out.wheels[id] = rateOf(ecRes); any = true; }
        else if (mn === 'ModuleResourceHarvester' && ecIn && rateOf(ecIn) > 0) { out.drills[id] = rateOf(ecIn); any = true; }
        else if (mn === 'ModuleActiveRadiator' && ecRes && rateOf(ecRes) > 0) { out.radiators[id] = rateOf(ecRes); any = true; }
        else if (mn === 'ModuleWheelMotor' && ecRes && rateOf(ecRes) > 0) { out.motors[id] = rateOf(ecRes); any = true; }
        else if (/^ModuleEngines/.test(mn)) {
          const props = m.children.filter((c) => c.name === 'PROPELLANT');
          const ecP = props.find(isEC);
          const thrust = num(get(m, 'maxThrust'));
          const curve = m.children.find((c) => c.name === 'atmosphereCurve');
          const key0 = curve ? curve.vals.filter((v) => v[0] === 'key').map((v) => v[1].trim().split(/\s+/).map(Number)).find((k) => k[0] === 0) : null;
          if (ecP && thrust > 0 && key0 && key0[1] > 0) {
            const mass = props.reduce((q, c) => q + (num(get(c, 'ratio')) || 0) * (dens[get(c, 'name')] || 0), 0);
            if (mass > 0) {
              out.engines[id] = { ec: (thrust / (key0[1] * 9.80665) / mass) * num(get(ecP, 'ratio')), thrust: thrust, isp: key0[1], fuel: props.filter((c) => !isEC(c)).map((c) => get(c, 'name')).join('+') };
              any = true;
            }
          }
        }
      }
      if (any) {
        out.parts[id] = { title: title, mass: num(get(node, 'mass')) || 0, cost: num(get(node, 'cost')) || 0, entry: num(get(node, 'entryCost')) || 0, tech: get(node, 'TechRequired') || '', cat: cat };
      }
    });
    return out;
  }

  /** Adds the power parts of `b` to `a` (same ids replace), both in the shape parsePowerCfg returns. */
  function mergePower(a, b) {
    const out = a || {};
    Object.keys(b || {}).forEach((k) => { out[k] = Object.assign(out[k] || {}, b[k]); });
    return out;
  }

  /** Reads rocket parts out of part .cfg files into the shape career-data.js uses for the stock ones, so a .craft that holds mod parts still gets a price,
   *  a mass and a delta-v. Reads: name, title, cost, mass, entryCost, TechRequired, category, crew capacity, fuelCrossFeed, RESOURCE nodes (tanks), engines
   *  (ModuleEngines / ModuleEnginesFX: maxThrust, atmosphereCurve keys at pressure 0 and 1, PROPELLANT) and decouplers (ModuleDecouple = inline, ModuleAnchoredDecoupler
   *  = radial, with explosiveNodeID). `@PART` patches and Module Manager operators are not applied (only plain PART nodes). Returns { id: part }. */
  function parsePartCfg(text, resources) {
    const tree = parseConfig(text), out = {}, res = resources || {};
    walk(tree, (node) => {
      if (node.name !== 'PART') return;
      const id = get(node, 'name');
      const mass = num(get(node, 'mass')), cost = num(get(node, 'cost'));
      if (!id || mass === undefined || cost === undefined) return;
      const p = { id: String(id).trim(), title: String(get(node, 'title') || id).replace(/^#.*=/, '').trim() || id, cost: cost, mass: mass, entry: num(get(node, 'entryCost')) || 0,
        tech: String(get(node, 'TechRequired') || 'unknown').trim(), cat: String(get(node, 'category') || 'none').trim(), mod: true };
      const tanks = node.children.filter((c) => c.name === 'RESOURCE' && num(get(c, 'maxAmount')) > 0);
      if (tanks.length) { p.res = {}; tanks.forEach((c) => { p.res[String(get(c, 'name')).trim()] = [num(get(c, 'amount'), num(get(c, 'maxAmount'))), num(get(c, 'maxAmount'))]; }); }
      const crew = num(get(node, 'CrewCapacity'));
      if (crew > 0) p.crew = crew;
      if (/^false$/i.test(String(get(node, 'fuelCrossFeed') || ''))) p.noXfeed = 1;
      const engines = [];
      for (const m of node.children.filter((c) => c.name === 'MODULE')) {
        const mn = get(m, 'name');
        if (mn === 'ModuleEngines' || mn === 'ModuleEnginesFX') {
          const thrust = num(get(m, 'maxThrust'));
          const curve = m.children.find((c) => c.name === 'atmosphereCurve');
          const keys = curve ? curve.vals.filter((v) => v[0] === 'key').map((v) => String(v[1]).trim().split(/\s+/).map(Number)) : [];
          const at =(x) => { const k = keys.find((q) => q[0] === x); return k ? k[1] : null; };
          const props = m.children.filter((c) => c.name === 'PROPELLANT').map((c) => [String(get(c, 'name')).trim(), num(get(c, 'ratio'), 1)]);
          if (thrust > 0 && at(0) && props.length) engines.push({ id: String(get(m, 'engineID') || 'Default').trim(), thrust: thrust, isp: [at(0), at(1)], props: props });
        } else if (mn === 'ModuleDecouple' || mn === 'ModuleAnchoredDecoupler') {
          // the game's own part list: 1 = inline (the node's far side leaves), 3 = radial (leaves with what hangs on it); an omni decoupler drops both
          const node2 = get(m, 'explosiveNodeID');
          p.dec = mn === 'ModuleAnchoredDecoupler' ? 3 : 1;
          if (node2 && p.dec === 1) p.decNode = String(node2).trim();
          if (p.dec === 3) p.noXfeed = 1;
        }
      }
      if (engines.length) p.eng = engines;
      out[p.id] = p;
    });
    return out;
  }

  /* ---------- Kopernicus planet packs ---------- */

  const stripOp = (s) => String(s).replace(/^[@%+\-!]/, '').replace(/[:\[].*$/, '').trim();
  const patchTarget = (s) => { const m = /\[([^\]|]+)/.exec(s); return m ? m[1].trim() : null; };
  const kget = (node, key) => {
    const v = node.vals.find((p) => stripOp(p[0]) === key);
    return v ? v[1] : undefined;
  };
  const kchild = (node, name) => node.children.find((c) => stripOp(c.name) === name);
  const GAS_TEMPLATES = ['Jool', 'Sarnus', 'Urlum', 'Neidon'];   // same list as Data.GAS_GIANTS (this file has no dependencies)
  const KSP_G0 = 9.80665; // GM = geeASL * 9.80665 * r^2 (exact for every stock body in the game's own data)
  const BIG_G = 6.6743e-11;

  /**
   * Bodies from Kopernicus configs. `stock(id)` returns a stock body definition (as in data.js) or null, used
   * for `Template` inheritance. Returns {bodies: [...], patches: [...], warnings: [...]}:
   *  - `Body { ... }` / `+Body { ... }` define new bodies (pack 'custom');
   *  - `@Body[Name] { ... }` / `%Body[Name]` patch an existing body (orbit, radius, rotation, atmosphere ...).
   */
  function parseKopernicus(text, stock) {
    const tree = parseConfig(text);
    const out = { bodies: [], patches: [], warnings: [] };
    const roots = [];
    walk(tree, (n) => { if (stripOp(n.name) === 'Kopernicus') roots.push(n); });
    if (!roots.length) roots.push(tree);
    for (const r of roots) {
      for (const b of r.children) {
        if (stripOp(b.name) !== 'Body') continue;
        // MM filters such as `@Body:HAS[@Atmosphere]` are not patches of one body
        if (/^[@%]Body\s*:/.test(b.name)) continue;
        const isPatch = /^[@%]/.test(b.name) && /\[/.test(b.name);
        const name = isPatch ? patchTarget(b.name) : kget(b, 'name');
        if (!name) { out.warnings.push('A Body without a name was skipped.'); continue; }
        const props = kchild(b, 'Properties');
        const orbitNode = kchild(b, 'Orbit');
        const atmoNode = kchild(b, 'Atmosphere');
        const tplName = kchild(b, 'Template') ? kget(kchild(b, 'Template'), 'name') : null;
        const tpl = !isPatch && tplName && stock ? stock(tplName) : null;
        const f = {};
        if (props) {
          const radius = num(kget(props, 'radius'));
          if (radius !== undefined) f.radius = radius;
          const gp = num(kget(props, 'gravParameter')), mass = num(kget(props, 'mass')), gee = num(kget(props, 'geeASL'));
          if (gp !== undefined) f.gm = gp;
          else if (mass !== undefined) f.gm = mass * BIG_G;
          else if (gee !== undefined) f.geeASL = gee; // resolved once the radius is known
          const locked = kget(props, 'tidallyLocked');
          const rot = num(kget(props, 'rotationPeriod'));
          if (locked !== undefined && /^true$/i.test(locked)) f.rot = 'locked';
          else if (rot !== undefined) f.rot = rot;
          // relative edits such as `@radius *= 1.0226` (RSS oblate planets)
          for (const p of props.vals) {
            const m = /^[@%]?radius\s*([*\/])$/.exec(p[0]);
            const v = m ? num(p[1]) : undefined;
            if (v > 0) f.radiusScale = (f.radiusScale || 1) * (m[1] === '*' ? v : 1 / v);
          }
          const rot0 = num(kget(props, 'initialRotation'));
          if (rot0 !== undefined) f.rot0 = rot0;
          // packs name a body for the game's own use ("Jool2") and show another name ("Jool^N"); localisation keys (#LOC_...) are no name
          const disp = kget(props, 'displayName');
          if (disp !== undefined) { const d = String(disp).replace(/\^\w$/, '').trim(); if (d && d[0] !== '#') f.display = d; }
          const soi = num(kget(props, 'sphereOfInfluence'));
          if (soi !== undefined) f.soi = soi;
        }
        if (atmoNode) {
          // the air itself (for the Reentry and Energy tabs): depth, molar mass, adiabatic index and the two curves, in the shape Data.ATMOSPHERES has
          const curve = (name) => { const c = kchild(atmoNode, name); return c ? c.vals.filter((v) => stripOp(v[0]) === 'key').map((v) => String(v[1]).trim().split(/\s+/).map(Number)).filter((k) => k.length >= 2 && k.every(isFinite)).map((k) => [k[0], k[1], k[2] || 0, k[3] || 0]) : []; };
          const temp = curve('temperatureCurve'), pres = curve('pressureCurve');
          const depth = num(kget(atmoNode, 'altitude')) ?? num(kget(atmoNode, 'maximumAltitude')), mm = num(kget(atmoNode, 'atmosphereMolarMass')), gam = num(kget(atmoNode, 'adiabaticIndex'));
          if (depth > 0 && temp.length > 1 && pres.length > 1 && mm > 0) {
            f.atmosphere = { depth: depth, molarMass: mm, gamma: gam > 0 ? gam : 1.4, shock: num(kget(atmoNode, 'shockTemperatureMultiplier')) ?? (props ? num(kget(props, 'shockTemperatureMultiplier')) : undefined) ?? 1, temp: temp, pressure: pres };
          }
          const en = kget(atmoNode, 'enabled');
          const alt = num(kget(atmoNode, 'altitude')) ?? num(kget(atmoNode, 'maximumAltitude'));
          if (en !== undefined && !/^true$/i.test(en)) f.atmo = 0;
          else if (alt !== undefined) f.atmo = alt;
        }
        if (orbitNode) {
          const o = {};
          const keys = [['a', 'semiMajorAxis'], ['e', 'eccentricity'], ['i', 'inclination'], ['lan', 'longitudeOfAscendingNode'], ['w', 'argumentOfPeriapsis'], ['m0', 'meanAnomalyAtEpoch'], ['epoch', 'epoch']];
          for (const [k, key] of keys) { const v = num(kget(orbitNode, key)); if (v !== undefined) o[k] = v; }
          // Real Solar System style packs give the mean anomaly in degrees
          const m0d = num(kget(orbitNode, 'meanAnomalyAtEpochD'));
          if (m0d !== undefined && o.m0 === undefined) o.m0 = (m0d * Math.PI) / 180;
          const ref = kget(orbitNode, 'referenceBody');
          if (ref !== undefined) f.parent = ref === 'Sun' ? 'Kerbol' : ref;
          f.orbit = o;
        }
        if (isPatch) { out.patches.push({ id: name, fields: f }); continue; }
        // A pack's own "Sun" / "Kerbol" entry has no orbit: it only changes the star (radius, mass), so treat it as a patch of Kerbol.
        if (!orbitNode && (name === 'Sun' || name === 'Kerbol')) { out.patches.push({ id: 'Kerbol', fields: f }); continue; }
        // new body: fill gaps from the template
        const def = {
          id: name, name: (kget(b, 'cbNameLater') || f.display || name), parent: f.parent || null, pack: 'custom',
          radius: f.radius !== undefined ? f.radius : tpl ? tpl.radius : undefined,
          gm: f.gm, atmo: f.atmo !== undefined ? f.atmo : tpl ? tpl.atmo : 0, atmosphere: f.atmosphere || null,
          rot: f.rot !== undefined ? f.rot : tpl ? tpl.rot : undefined,
          rot0: f.rot0 || 0, soi: f.soi || null, star: false, opm: null, subParentLon: null,
          orbit: f.orbit ? Object.assign({ a: 0, e: 0, i: 0, lan: 0, w: 0, m0: 0, epoch: 0 }, f.orbit) : null,
        };
        if (tpl && GAS_TEMPLATES.indexOf(tpl.id) >= 0) def.gas = true;           // built on a gas giant: nothing to land on
        if (def.gm === undefined) def.gm = f.geeASL !== undefined && def.radius ? f.geeASL * KSP_G0 * def.radius * def.radius : tpl ? tpl.gm : undefined;
        const missing = [];
        if (!(def.radius > 0)) missing.push('radius');
        if (!(def.gm > 0)) missing.push('mass / geeASL');
        if (def.rot === undefined) missing.push('rotationPeriod');
        if (!def.orbit || !(def.orbit.a > 0)) missing.push('Orbit.semiMajorAxis');
        if (!def.parent) missing.push('Orbit.referenceBody');
        if (missing.length) { out.warnings.push('“' + name + '” skipped: missing ' + missing.join(', ') + '.'); continue; }
        out.bodies.push(def);
      }
    }
    return out;
  }

  /** Difficulty, Tracking Station level and vessels (with part-name counts) from a persistent.sfs. */
  function parseSave(text) {
    const tree = parseConfig(text);
    const game = tree.children.find((c) => c.name === 'GAME');
    if (!game) return null;
    const out = { title: get(game, 'Title') || '', mode: get(game, 'Mode') || '', params: null, trackingStationLevel: null, ut: null, allowOtherLaunchSites: null, vessels: [] };
    walk(game, (node) => {
      const allow = get(node, 'AllowOtherLaunchSites');
      if (allow !== undefined) out.allowOtherLaunchSites = bool(allow);
      if (node.name === 'CommNetParams' && !out.params) {
        out.params = {
          rangeModifier: num(get(node, 'rangeModifier')),
          dsnModifier: num(get(node, 'DSNModifier')),
          occlusionVac: num(get(node, 'occlusionMultiplierVac')),
          occlusionAtm: num(get(node, 'occlusionMultiplierAtm')),
          requireSignalForControl: bool(get(node, 'requireSignalForControl')),
          plasmaBlackout: bool(get(node, 'plasmaBlackout')),
          enableGroundStations: bool(get(node, 'enableGroundStations')),
        };
      } else if (node.name === 'SpaceCenter/TrackingStation') {
        const lvl = num(get(node, 'lvl'));
        if (lvl !== undefined) out.trackingStationLevel = Math.round(lvl * 2) + 1;
      } else if (node.name === 'FLIGHTSTATE') {
        const ut = num(get(node, 'UT'));
        if (ut !== undefined) out.ut = ut;
      } else if (node.name === 'VESSEL') {
        const parts = {};
        for (const p of node.children) {
          if (p.name !== 'PART') continue;
          const n = get(p, 'name');
          if (n) parts[n.replace(/\./g, '_')] = (parts[n.replace(/\./g, '_')] || 0) + 1;
        }
        const orbitNode = node.children.find((c) => c.name === 'ORBIT');
        out.vessels.push({
          name: get(node, 'name') || '(unnamed)', type: get(node, 'type') || '', parts: parts, sit: get(node, 'sit') || '',
          lat: num(get(node, 'lat')), lon: num(get(node, 'lon')), alt: num(get(node, 'alt')),
          orbit: orbitNode ? {
            sma: num(get(orbitNode, 'SMA')), ecc: num(get(orbitNode, 'ECC')), inc: num(get(orbitNode, 'INC')), lpe: num(get(orbitNode, 'LPE')),
            lan: num(get(orbitNode, 'LAN')), mna: num(get(orbitNode, 'MNA')), eph: num(get(orbitNode, 'EPH')), ref: num(get(orbitNode, 'REF')),
          } : null,
        });
      }
    });
    // Sandbox saves have every facility at max level; there is no upgrade scenario to read.
    if (out.trackingStationLevel === null && /SANDBOX/i.test(out.mode)) out.trackingStationLevel = 3;
    return out;
  }

  /** Career state from a persistent.sfs: funds, science, reputation, facility levels, researched tech, bought parts,
   *  contracts, strategies and the difficulty multipliers. Fields the save does not have come back null. */
  function parseCareer(text) {
    const tree = parseConfig(text);
    const game = tree.children.find((c) => c.name === 'GAME');
    if (!game) return null;
    const out = {
      title: get(game, 'Title') || '', mode: get(game, 'Mode') || '', ut: null,
      funds: null, sci: null, rep: null,
      difficulty: null, facilities: {}, tech: [], parts: [], contracts: [], strategies: [], progress: [],
    };
    const params = game.children.find((c) => c.name === 'PARAMETERS');
    const career = params && params.children.find((c) => c.name === 'CAREER');
    if (career) {
      out.difficulty = {
        startFunds: num(get(career, 'StartingFunds')), startSci: num(get(career, 'StartingScience')), startRep: num(get(career, 'StartingReputation')),
        gain: [num(get(career, 'FundsGainMultiplier')), num(get(career, 'ScienceGainMultiplier')), num(get(career, 'RepGainMultiplier'))],
        loss: [num(get(career, 'FundsLossMultiplier')), num(get(career, 'RepLossMultiplier'))],
        repLossDeclined: num(get(career, 'RepLossDeclined')),
      };
    }
    // Kerbals on the roster that count for the hiring price (KerbalRoster.GetActiveCrewCount): crew that are not dead or missing
    const roster = game.children.find((c) => c.name === 'ROSTER');
    if (roster) out.crew = roster.children.filter((k) => k.name === 'KERBAL' && /^Crew$/i.test(get(k, 'type') || 'Crew') && !/^(Dead|Missing)$/i.test(get(k, 'state') || '')).length;
    const flight = game.children.find((c) => c.name === 'FLIGHTSTATE');
    if (flight) out.ut = num(get(flight, 'UT')) === undefined ? null : num(get(flight, 'UT'));
    for (const sc of game.children.filter((c) => c.name === 'SCENARIO')) {
      const name = get(sc, 'name');
      if (name === 'Funding') out.funds = num(get(sc, 'funds'));
      else if (name === 'Reputation') out.rep = num(get(sc, 'rep'));
      else if (name === 'ResearchAndDevelopment') {
        out.sci = num(get(sc, 'sci'));
        for (const t of sc.children.filter((c) => c.name === 'Tech')) {
          const id = get(t, 'id');
          if (!id) continue;
          if (/^Available$/i.test(get(t, 'state') || '')) out.tech.push(id);
          for (const p of t.vals.filter((v) => v[0] === 'part')) out.parts.push(p[1]);
        }
      } else if (name === 'ScenarioUpgradeableFacilities') {
        for (const f of sc.children) {
          const lvl = num(get(f, 'lvl'));
          if (lvl !== undefined) out.facilities[f.name.replace(/^SpaceCenter\//, '')] = Math.round(lvl * 2) + 1;
        }
      } else if (name === 'ContractSystem') {
        const list = sc.children.find((c) => c.name === 'CONTRACTS');
        for (const c of (list ? list.children : []).filter((x) => x.name === 'CONTRACT')) {
          const state = get(c, 'state') || '';
          if (state !== 'Active' && state !== 'Offered') continue;
          // values = expire time, deadline time, advance, reward, failure funds, science, reputation reward, reputation penalty, then four dates
          const v = String(get(c, 'values') || '').split(',').map(Number);
          out.contracts.push({
            type: (get(c, 'type') || '').replace(/Contract$/, ''), state: state, body: get(c, 'body') || '', agent: get(c, 'agentName') || '',
            prestige: num(get(c, 'prestige')), advance: v[2] || 0, reward: v[3] || 0, failure: v[4] || 0, sci: v[5] || 0, rep: v[6] || 0, repFail: v[7] || 0,
            deadline: v[10] || null,
          });
        }
      } else if (name === 'ProgressTracking') {
        // milestones already reached: top-level one-offs by name, body ones as 'Body:Node'
        const pr = sc.children.find((c) => c.name === 'Progress');
        out.records = {};
        for (const n of pr ? pr.children : []) {
          if (/^Records(Altitude|Speed|Distance|Depth)$/.test(n.name) && num(get(n, 'record')) !== undefined) out.records[n.name] = num(get(n, 'record'));
          const inner = n.children.filter((k) => k.name !== 'vessel' && k.name !== 'crew');
          if (/^(Records|POI)/.test(n.name) || !inner.length) { if (get(n, 'completed') !== undefined) out.progress.push(n.name); continue; }
          for (const k of inner) if (get(k, 'completed') !== undefined || get(k, 'completedManned') !== undefined || get(k, 'completedUnmanned') !== undefined) out.progress.push(n.name + ':' + k.name);
        }
      } else if (name === 'StrategySystem') {
        const list = sc.children.find((c) => c.name === 'STRATEGIES');
        for (const s of (list ? list.children : []).filter((x) => x.name === 'STRATEGY')) {
          if (/^false$/i.test(get(s, 'isActive') || 'true')) continue;
          out.strategies.push({ id: get(s, 'name') || '', factor: num(get(s, 'factor')) });
        }
      }
    }
    return out;
  }

  return { parseConfig: parseConfig, parseAntennaCfg: parseAntennaCfg, parsePowerCfg: parsePowerCfg, parsePartCfg: parsePartCfg, mergePower: mergePower, parseSave: parseSave, parseKopernicus: parseKopernicus, parseCareer: parseCareer };
});
