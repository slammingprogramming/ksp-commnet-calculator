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
          gm: f.gm, atmo: f.atmo !== undefined ? f.atmo : tpl ? tpl.atmo : 0,
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
        for (const n of pr ? pr.children : []) {
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

  return { parseConfig: parseConfig, parseAntennaCfg: parseAntennaCfg, parseSave: parseSave, parseKopernicus: parseKopernicus, parseCareer: parseCareer };
});
