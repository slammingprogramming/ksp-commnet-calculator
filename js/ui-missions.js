// SPDX-License-Identifier: AGPL-3.0-or-later
/* Missions tab: import rockets (.craft), build a mission out of legs, compare the delta-v it needs with what the rocket has, check
 * the facilities and research it needs, and see what it does to the money. Uses js/craft.js, js/mission.js and js/career.js. */
(function () {
  'use strict';

  const App = window.KSPApp;
  const Data = window.KSPData;
  const Orb = window.KSPOrbits;
  const CD = window.KSPCareerData;
  const Craft = window.KSPCraft;
  const Parsers = window.KSPParsers;
  const Career = window.KSPCareer;
  const Mission = window.KSPMission;
  const h = App.h;

  const money = (x) => (x < 0 ? '−' : '') + Math.round(Math.abs(x)).toLocaleString('en-US');
  const field = (label, el) => h('div', { class: 'field' }, h('label', { text: label }), el);
  const select = (options, value, onChange, label) => {
    const s = h('select', { 'aria-label': label || 'choice' }, options.map((o) => h('option', { value: o[0], text: o[1] })));
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return s;
  };
  const num = (value, onChange, o) => {
    const i = h('input', { type: 'number', value: value === null || value === undefined ? '' : String(value), step: 'any', size: (o && o.size) || 6, 'aria-label': (o && o.label) || 'number', placeholder: (o && o.placeholder) || '' });
    i.addEventListener('change', () => { const v = parseFloat(i.value); onChange(isFinite(v) ? v : null); });
    return i;
  };
  const text = (value, onChange, o) => {
    const i = h('input', { type: 'text', value: value || '', size: (o && o.size) || 18, 'aria-label': (o && o.label) || 'text' });
    i.addEventListener('change', () => onChange(i.value));
    return i;
  };
  const bodiesOpt = () => App.world.bodies.filter((b) => b.depth >= 1).map((b) => [b.id, b.name]);
  const fmtDays = (s) => (s / Data.DAY).toFixed(s > 20 * Data.DAY ? 0 : 1) + ' d';

  const TEMPLATES = [
    ['Reach orbit', 'Kerbin orbit', [{ type: 'launch', body: 'Kerbin', alt: 80 }]],
    ['Mun landing and return', 'Mun landing and return', [
      { type: 'launch', body: 'Kerbin', alt: 80 }, { type: 'transfer', from: 'Kerbin', to: 'Mun', park: 80, capture: 30 },
      { type: 'land', body: 'Mun', alt: 30, margin: 0.15 }, { type: 'ascent', body: 'Mun', alt: 30 }, { type: 'return', body: 'Mun', alt: 30, pe: 35 }]],
    ['Minmus landing and return', 'Minmus landing and return', [
      { type: 'launch', body: 'Kerbin', alt: 80 }, { type: 'transfer', from: 'Kerbin', to: 'Minmus', park: 80, capture: 30 },
      { type: 'land', body: 'Minmus', alt: 30, margin: 0.15 }, { type: 'ascent', body: 'Minmus', alt: 30 }, { type: 'return', body: 'Minmus', alt: 30, pe: 35 }]],
    ['Duna orbit probe', 'Duna orbiter', [
      { type: 'launch', body: 'Kerbin', alt: 80 }, { type: 'transfer', from: 'Kerbin', to: 'Duna', park: 80, capture: 100, pick: 'cheapest' }]],
    ['Duna landing and return', 'Duna landing and return', [
      { type: 'launch', body: 'Kerbin', alt: 80 }, { type: 'transfer', from: 'Kerbin', to: 'Duna', park: 80, capture: 100, pick: 'cheapest' },
      { type: 'land', body: 'Duna', alt: 100, chutes: true }, { type: 'ascent', body: 'Duna', alt: 100, losses: 900 },
      { type: 'transfer', from: 'Duna', to: 'Kerbin', park: 100, capture: null, pick: 'cheapest', after: 20 }]],
  ];
  const DEFAULT_LEG = {
    launch: { type: 'launch', body: 'Kerbin', alt: 80 }, transfer: { type: 'transfer', from: 'Kerbin', to: 'Mun', park: 80, capture: 30 },
    land: { type: 'land', body: 'Mun', alt: 30, margin: 0.15 }, ascent: { type: 'ascent', body: 'Mun', alt: 30 }, return: { type: 'return', body: 'Mun', alt: 30, pe: 35 },
    plane: { type: 'plane', body: 'Kerbin', alt: 100, degrees: 10 }, custom: { type: 'custom', label: 'Burn', dv: 100 },
  };
  const LEG_NAMES = [['launch', 'Launch to orbit'], ['transfer', 'Transfer to another body'], ['land', 'Land from orbit'], ['ascent', 'Ascend to orbit'], ['return', 'Return from a moon'], ['plane', 'Plane change'], ['custom', 'Other burn']];

  function build(root) {
    const out = h('div', {});
    root.append(out);
    const status = h('div', { class: 'status' });
    const st = () => App.state;
    const M = () => st().missions;
    const careerState = () => { const c = st().career; if (!c.state) c.state = Career.newState('normal'); return c; };
    const changed = () => { App.saveState(); render(); };
    // mod rocket parts the player imported earlier are known again before any .craft is read
    const knownParts = () => { st().custom.parts = st().custom.parts || {}; return st().custom.parts; };
    Craft.addParts(knownParts());

    // ---- rockets ----------------------------------------------------------------------------------------------
    function addCrafts(files) {
      const jobs = Array.from(files).filter((f) => /\.craft$/i.test(f.name)).map((f) => f.text().then((t) => ({ name: f.name.replace(/\.craft$/i, ''), text: t })));
      if (!jobs.length) { status.className = 'status bad'; status.textContent = 'Pick one or more .craft files (KSP/saves/<save>/Ships/VAB or SPH).'; return; }
      Promise.all(jobs).then((list) => {
        let added = 0, missing = new Set();
        for (const j of list) {
          const c = Craft.parseCraft(j.text);
          if (!c.parts.length) continue;
          const sum = Craft.summarize(c), r = Craft.stages(c), rec = Craft.recoverable(c, r);
          const names = {};
          let crew = 0;
          for (const p of c.parts) { names[p.name] = (names[p.name] || 0) + 1; if (p.db && p.db.crew) crew += p.db.crew; }
          c.missing.forEach((m) => missing.add(m));
          const entry = {
            id: M().nextId++, name: c.name || j.name, type: c.type || 'VAB', cost: sum.cost, dryCost: sum.dryCost, fuelCost: sum.fuelCost, mass: sum.mass, dryMass: sum.dryMass,
            size: c.size, parts: sum.parts, crew: crew, missing: c.missing, names: names, dv: r.dv, dvAsl: r.dvAsl, dvAir: c.parts.some((p) => p.db && p.db.eng && p.db.eng.length > 1) ? Craft.stages(c, { mode: 'atmosphere' }).dv : null, recover: rec.value, recoverMass: rec.mass,
            stages: r.stages.filter((s) => s.engines || s.dropped).map((s) => ({ stage: s.stage, dv: s.dv, dvAsl: s.dvAsl, time: s.time, m0: s.m0, m1: s.m1, twr: s.twr, thrust: s.thrust, engines: s.engines })),
          };
          M().crafts.push(entry);
          if (M().list.length && M().list[M().sel] && M().list[M().sel].craft === null) M().list[M().sel].craft = entry.id;
          added++;
        }
        if (M().crafts.length > 40) M().crafts = M().crafts.slice(-40);
        status.className = 'status ok';
        status.textContent = added + ' rocket(s) read.' + (missing.size ? ' Not in the part list (so left out of the cost, mass and delta-v): ' + [...missing].join(', ') + '.' : '');
        changed();
      }, () => { status.className = 'status bad'; status.textContent = 'Could not read those files.'; });
    }

    function newMission(tpl) {
      const m = M();
      const mission = {
        id: m.nextId++, name: tpl ? tpl[1] : 'New mission', craft: m.crafts.length ? m.crafts[m.crafts.length - 1].id : null,
        start: Math.floor((careerState().state.ut || 0) / Data.DAY), legs: tpl ? JSON.parse(JSON.stringify(tpl[2])) : [{ type: 'launch', body: 'Kerbin', alt: 80 }],
        recover: { where: 'ksc', km: 0 }, contracts: [], margin: 10, science: 0,
      };
      m.list.push(mission); m.sel = m.list.length - 1;
      changed();
    }

    // ---- one leg row -----------------------------------------------------------------------------------------
    function legFields(leg, edit) {
      const set = (k, v) => { leg[k] = v; edit(); };
      const body = (k, label) => field(label || 'Body', select(bodiesOpt(), leg[k] || 'Kerbin', (v) => set(k, v), label || 'Body'));
      const km = (k, label, ph) => field(label, num(leg[k], (v) => set(k, v), { size: 5, label: label, placeholder: ph || '' }));
      switch (leg.type) {
        case 'launch': return [body('body'), km('alt', 'Orbit km'), field('Losses m/s', num(leg.losses, (v) => set('losses', v), { size: 5, label: 'losses', placeholder: 'default' })), field('or simulate: thrust-to-weight', num(leg.twr, (v) => set('twr', v), { size: 4, label: 'thrust to weight', placeholder: 'off' }))];
        case 'transfer': return [body('from', 'From'), body('to', 'To'), km('park', 'Parking km'), km('capture', 'Capture km', 'fly-by'),
          field('Wait days', num(leg.after, (v) => set('after', v), { size: 4, label: 'wait', placeholder: '0' })),
          field('Window', select([['earliest', 'Earliest'], ['cheapest', 'Cheapest']], leg.pick || 'earliest', (v) => set('pick', v), 'Window'))];
        case 'land': return [body('body'), km('alt', 'From km'), field('Margin %', num(Math.round((leg.margin === undefined ? 0.15 : leg.margin) * 100), (v) => set('margin', (v || 0) / 100), { size: 4, label: 'margin' })),
          field('Parachutes', h('input', { type: 'checkbox', checked: !!leg.chutes, 'aria-label': 'Parachutes', onchange: (e) => set('chutes', e.target.checked) }))];
        case 'ascent': return [body('body'), km('alt', 'To km'), field('Losses m/s', num(leg.losses, (v) => set('losses', v), { size: 5, label: 'losses', placeholder: 'default' })), field('or simulate: thrust-to-weight', num(leg.twr, (v) => set('twr', v), { size: 4, label: 'thrust to weight', placeholder: 'off' }))];
        case 'return': return [body('body', 'Moon'), km('alt', 'From km'), km('pe', 'Periapsis km')];
        case 'plane': return [body('body'), km('alt', 'Orbit km'), km('degrees', 'Degrees')];
        case 'custom': return [field('Name', text(leg.label, (v) => set('label', v), { size: 14, label: 'Name' })), km('dv', 'Δv m/s'), km('days', 'Days')];
        default: return [];
      }
    }

    // ---- the page ---------------------------------------------------------------------------------------------
    function render() {
      const m = M();
      const cards = [rocketCard(m)];
      const mission = m.list[m.sel];
      cards.push(missionPicker(m));
      if (mission) cards.push(...missionCards(m, mission));
      out.replaceChildren(...cards.filter(Boolean));
    }

    function rocketCard(m) {
      const partFile = h('input', { type: 'file', accept: '.cfg,.txt', multiple: true, hidden: true, 'aria-label': 'Mod part files' });
      partFile.addEventListener('change', async () => {
        const dens = {}; Object.keys(CD.resources).forEach((k) => { dens[k] = CD.resources[k]; });
        let n = 0;
        for (const f of Array.from(partFile.files || [])) { try { const got = Parsers.parsePartCfg(await f.text(), dens); Object.assign(knownParts(), got); n += Craft.addParts(got); } catch (e) { /* unreadable file: skipped */ } }
        status.className = n ? 'status ok' : 'status bad';
        status.textContent = n ? n + ' mod parts read. Import the rockets that use them (again, if they were listed as missing parts).' : 'No tanks, engines or other parts with a price and a mass found in those files.';
        partFile.value = ''; changed();
      });
      const file = h('input', { type: 'file', accept: '.craft', multiple: true, hidden: true, 'aria-label': 'Rocket files' });
      file.addEventListener('change', () => { addCrafts(file.files || []); file.value = ''; });
      return h('div', { class: 'card' },
        h('h2', { text: 'Rockets' }),
        h('p', { class: 'hint', text: 'Import the .craft files you built (KSP/saves/<save>/Ships/VAB or SPH). The app reads each part with its price and mass, and works out the delta-v stage by stage from your staging. Nothing is uploaded.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => file.click() }, 'Import .craft files…'), file,
          h('button', { class: 'btn small ghost', type: 'button', title: 'Pick the part .cfg files of a mod so rockets that use its tanks, engines and decouplers get a price, a mass and a delta-v', onclick: () => partFile.click() }, 'Import mod parts (.cfg)…'), partFile,
          Object.keys(knownParts()).length ? h('button', { class: 'btn small ghost danger', type: 'button', onclick: () => { st().custom.parts = {}; changed(); } }, 'Forget ' + Object.keys(knownParts()).length + ' mod parts (needs a reload)') : null,
          m.crafts.length ? h('button', { class: 'btn small ghost danger', type: 'button', onclick: () => { m.crafts = []; m.list.forEach((x) => { x.craft = null; }); changed(); } }, 'Forget all rockets') : null),
        status,
        m.crafts.length ? h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Rocket', 'Parts', 'Mass', 'Cost', 'Δv vacuum', 'Δv sea level', 'Recoverable', ''].map((t, i) => h('th', { class: i > 0 && i < 7 ? 'num' : '', text: t })))),
          h('tbody', {}, m.crafts.map((c) => h('tr', {},
            h('td', { text: c.name + (c.type ? ' (' + c.type + ')' : ''), title: c.missing.length ? 'Unknown parts: ' + c.missing.join(', ') : '' }), h('td', { class: 'num', text: String(c.parts) }),
            h('td', { class: 'num', text: c.mass.toFixed(1) + ' t' }), h('td', { class: 'num', text: money(c.cost) }), h('td', { class: 'num', text: Math.round(c.dv) + ' m/s' }),
            h('td', { class: 'num', text: Math.round(c.dvAsl) + ' m/s', title: c.dvAir ? 'With the air-breathing mode of its multi-mode engines (R.A.P.I.E.R. or Panther) the same rocket gives ' + Math.round(c.dvAir) + ' m/s; the closed-cycle or first mode is used for the other columns.' : '' }), h('td', { class: 'num', text: money(c.recover) }),
            h('td', {}, h('button', { class: 'btn small ghost danger', type: 'button', 'aria-label': 'Remove ' + c.name, onclick: () => { m.crafts = m.crafts.filter((x) => x !== c); m.list.forEach((x) => { if (x.craft === c.id) x.craft = null; }); changed(); } }, '×'))))))) : null);
    }

    function missionPicker(m) {
      return h('div', { class: 'card' },
        h('h2', { text: 'Missions' }),
        m.list.length ? h('div', { class: 'row' },
          field('Mission', select(m.list.map((x, i) => [String(i), x.name]), String(m.sel), (v) => { m.sel = +v; changed(); }, 'Mission')),
          h('button', { class: 'btn small ghost danger', type: 'button', onclick: () => { m.list.splice(m.sel, 1); m.sel = Math.max(0, m.sel - 1); changed(); } }, 'Delete this mission')) : h('p', { class: 'hint', text: 'No missions yet. Start from one of the templates and change the legs.' }),
        h('div', { class: 'row', style: 'margin-top:8px' }, TEMPLATES.map((t) => h('button', { class: 'btn small', type: 'button', onclick: () => newMission(t) }, '+ ' + t[0])),
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => newMission(null) }, '+ Empty mission')));
    }

    function missionCards(m, mission) {
      const cs = careerState().state;
      const craft = m.crafts.find((c) => c.id === mission.craft) || null;
      const ut0 = mission.start * Data.DAY;
      const plan = Mission.plan(App.world, mission.legs, ut0);
      const need = plan.total * (1 + (mission.margin || 0) / 100);

      // what the rocket has: the first burning stage works in the atmosphere, so count it between its sea-level and vacuum figures
      let have = null, first = null;
      if (craft) {
        first = craft.stages.find((s) => s.dv > 0);
        have = craft.dv - (first ? 0.5 * (first.dv - first.dvAsl) : 0);
      }
      const verdict = craft ? (have >= need ? 'good' : 'bad') : '';

      const legRows = plan.legs.map((l, i) => {
        const leg = mission.legs[i];
        const edit = () => changed();
        return h('div', { class: 'card' + (l.error ? ' bad' : ''), style: 'padding:8px 12px;margin-top:6px' },
          h('div', { class: 'row' },
            h('strong', { text: (i + 1) + '. ' }),
            select(LEG_NAMES, leg.type, (v) => { mission.legs[i] = JSON.parse(JSON.stringify(DEFAULT_LEG[v])); edit(); }, 'Leg type'),
            ...legFields(leg, edit),
            h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { mission.legs.splice(i - 1, 0, mission.legs.splice(i, 1)[0]); edit(); } }, '↑'),
            h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Move down', disabled: i === mission.legs.length - 1, onclick: () => { mission.legs.splice(i + 1, 0, mission.legs.splice(i, 1)[0]); edit(); } }, '↓'),
            h('button', { class: 'btn small ghost danger', type: 'button', 'aria-label': 'Remove leg', onclick: () => { mission.legs.splice(i, 1); edit(); } }, '×')),
          h('div', { class: l.error ? 'bad' : 'hint', text: l.error ? l.note : l.label + ' — ' + Math.round(l.dv) + ' m/s · ' + l.note + (l.t1 > l.t0 ? ' · ' + Orb.formatUT(l.t0) + ' → ' + Orb.formatUT(l.t1) : '') }));
      });
      const add = select([['', '+ Add a leg…']].concat(LEG_NAMES), '', (v) => { if (v) { mission.legs.push(JSON.parse(JSON.stringify(DEFAULT_LEG[v]))); changed(); } }, 'Add leg');

      const route = h('div', { class: 'card' },
        h('h2', { text: 'Route' }),
        h('div', { class: 'row' },
          field('Name', text(mission.name, (v) => { mission.name = v || 'Mission'; changed(); }, { label: 'Mission name' })),
          field('Rocket', select([['', '(none)']].concat(m.crafts.map((c) => [String(c.id), c.name])), mission.craft ? String(mission.craft) : '', (v) => { mission.craft = v ? +v : null; changed(); }, 'Rocket')),
          field('Start on day', num(mission.start, (v) => { mission.start = Math.max(0, Math.round(v || 0)); changed(); }, { size: 6, label: 'start day' })),
          field('Margin %', num(mission.margin, (v) => { mission.margin = Math.max(0, v || 0); changed(); }, { size: 4, label: 'margin' }))),
        h('p', { class: 'hint', text: 'Each leg is a two-body, impulsive estimate. Transfers between planets (or between moons of one planet) use the real positions from the start date, the same search as the Launch windows tab; a parent to its own moon is a Hohmann transfer. “Losses” are the gravity, drag and steering allowance on the way up: the default for Kerbin (1300 m/s) gives the usual ≈3400 m/s to a low orbit; thick atmospheres need your own figure.' }),
        ...legRows, h('div', { class: 'row', style: 'margin-top:8px' }, add),
        h('p', { class: plan.error ? 'bad' : 'hint', text: plan.error ? plan.error : 'The mission lasts ' + fmtDays(plan.duration) + ' and ends ' + Orb.formatUT(plan.end) + '.' }));

      // verdict
      const budget = h('div', { class: 'card ' + verdict },
        h('h2', { text: 'Delta-v budget' }),
        h('div', { class: 'row' },
          h('div', {}, h('div', { class: 'hint', text: 'Needed' }), h('strong', { text: Math.round(plan.total) + ' m/s' })),
          h('div', {}, h('div', { class: 'hint', text: 'With ' + (mission.margin || 0) + '% margin' }), h('strong', { text: Math.round(need) + ' m/s' })),
          craft ? h('div', {}, h('div', { class: 'hint', text: 'Rocket has' }), h('strong', { text: Math.round(have) + ' m/s' })) : null,
          craft ? h('div', {}, h('div', { class: 'hint', text: craft.dv.toFixed(0) + ' vacuum / ' + craft.dvAsl.toFixed(0) + ' sea level' }), h('strong', { class: verdict, text: have >= need ? 'Enough (' + Math.round(have - need) + ' to spare)' : 'Short by ' + Math.round(need - have) + ' m/s' })) : null),
        craft ? h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Stage', 'Δv vacuum', 'Δv sea level', 'Burn', 'Start mass', 'End mass', 'Thrust/weight'].map((t, i) => h('th', { class: i ? 'num' : '', text: t })))),
          h('tbody', {}, craft.stages.map((s) => h('tr', {}, h('td', { text: String(s.stage) }), h('td', { class: 'num', text: Math.round(s.dv) }), h('td', { class: 'num', text: Math.round(s.dvAsl) }),
            h('td', { class: 'num', text: s.time ? Math.round(s.time) + ' s' : '' }), h('td', { class: 'num', text: s.m0.toFixed(1) + ' t' }), h('td', { class: 'num', text: s.m1.toFixed(1) + ' t' }), h('td', { class: 'num', text: s.twr ? s.twr.toFixed(2) : '' })))))) : h('p', { class: 'hint', text: 'Import a rocket above and choose it here to compare.' }),
        craft ? h('p', { class: 'hint', text: 'Per stage: fuel is drawn from the tanks an engine can reach without crossing a decoupler; a burn runs until its tanks are empty. Fuel ducts feed the part at their far end, tanks drain in order of the stage they separate in, and solid fuel stays in its own part, so asparagus staging works; gimbal, ullage and hand-set fuel flow are not modelled. A stage’s thrust-to-weight is at sea level against Kerbin’s gravity.' }) : null);

      // requirements
      const lvl = (id) => cs.facilities[id] || 1;
      const checks = [];
      if (craft) {
        const padLimit = (CD.facilities.LaunchPad.massLimit || [])[lvl('LaunchPad') - 1];
        const isPlane = /SPH/i.test(craft.type);
        const partLimit = ((CD.facilities[isPlane ? 'SpaceplaneHangar' : 'VehicleAssemblyBuilding'] || {}).partLimit || [])[lvl(isPlane ? 'SpaceplaneHangar' : 'VehicleAssemblyBuilding') - 1];
        const site = isPlane ? 'Runway' : 'LaunchPad', siteName = isPlane ? 'Runway' : 'Launch Pad';
        const lim = Career.CRAFT_LIMITS.size[Math.max(0, Math.min(2, lvl(site) - 1))];
        if (craft.size && craft.size.length >= 3) checks.push([Career.fitsSize(craft.size, lvl(site)), 'Size ' + craft.size.map((x) => x.toFixed(1)).join(' × ') + ' m, the ' + siteName + ' (level ' + lvl(site) + ') allows ' + (lim ? lim.join(' × ') + ' m' : 'any size'), Career.fitsSize(craft.size, lvl(site)) ? null : { id: site }]);
        const runwayLimit = Career.CRAFT_LIMITS.mass[Math.max(0, Math.min(2, lvl('Runway') - 1))];
        if (isPlane) checks.push([runwayLimit === null || craft.mass <= runwayLimit, 'Launch mass ' + craft.mass.toFixed(1) + ' t, the Runway (level ' + lvl('Runway') + ') allows ' + (runwayLimit === null ? 'any mass' : runwayLimit + ' t'), runwayLimit !== null && craft.mass > runwayLimit ? { id: 'Runway' } : null]);
        if (!isPlane && padLimit !== null && padLimit !== undefined) checks.push([craft.mass <= padLimit, 'Launch mass ' + craft.mass.toFixed(1) + ' t, the Launch Pad (level ' + lvl('LaunchPad') + ') allows ' + padLimit + ' t', craft.mass > padLimit ? { id: 'LaunchPad' } : null]);
        else if (!isPlane) checks.push([true, 'Launch mass ' + craft.mass.toFixed(1) + ' t, no limit at this Launch Pad level', null]);
        if (partLimit !== null && partLimit !== undefined) checks.push([craft.parts <= partLimit, craft.parts + ' parts, the ' + (isPlane ? 'Spaceplane Hangar' : 'Vehicle Assembly Building') + ' (level ' + lvl(isPlane ? 'SpaceplaneHangar' : 'VehicleAssemblyBuilding') + ') allows ' + partLimit, craft.parts > partLimit ? { id: isPlane ? 'SpaceplaneHangar' : 'VehicleAssemblyBuilding' } : null]);
        const pseudo = { parts: Object.keys(craft.names).flatMap((n) => Array(craft.names[n]).fill(0).map(() => ({ db: Craft.part(n) }))) };
        const needs = Career.craftNeeds(cs, pseudo);
        if (cs.mode === 'career') {
          checks.push([!needs.nodes.length, needs.nodes.length ? 'Research still needed: ' + needs.nodes.map((n) => Career.nodes[n] ? Career.nodes[n].title : n).join(', ') : 'All the research this rocket needs is done', null]);
          if (needs.buyFunds) checks.push([null, 'Parts to buy (entry cost): ' + money(needs.buyFunds) + ' funds (' + needs.buy.map((p) => p.title).slice(0, 6).join(', ') + (needs.buy.length > 6 ? '…' : '') + ')', null]);
          if (needs.unresearchable.length) checks.push([false, 'Parts that cannot be unlocked in career: ' + needs.unresearchable.join(', '), null]);
        }
        if (craft.missing.length) checks.push([false, 'Parts not in the data (left out): ' + craft.missing.join(', '), null]);
      }
      const transfers = mission.legs.some((l) => l.type === 'transfer' || l.type === 'return');
      if (transfers && cs.mode === 'career') {
        checks.push([lvl('MissionControl') >= 2, 'Planning manoeuvres in flight needs Mission Control level 2 (now ' + lvl('MissionControl') + ')', lvl('MissionControl') < 2 ? { id: 'MissionControl' } : null]);
        checks.push([lvl('TrackingStation') >= 2, 'Seeing the trajectory ahead needs Tracking Station level 2 (now ' + lvl('TrackingStation') + ')', lvl('TrackingStation') < 2 ? { id: 'TrackingStation' } : null]);
      }
      const needCrew = craft && craft.crew > 0;
      if (needCrew) checks.push([null, craft.crew + ' seat(s): the Astronaut Complex (level ' + lvl('AstronautComplex') + ') allows ' + (Career.effects('AstronautComplex', lvl('AstronautComplex'))[0][1]) + ' active kerbals in total', null]);
      const reqCard = checks.length ? h('div', { class: 'card' }, h('h2', { text: 'What it needs' }),
        h('ul', { class: 'plain' }, checks.map((c) => { const fix = c[2], fid = fix ? fix.id : null; return h('li', { class: c[0] === null ? 'hint' : c[0] ? 'good' : 'bad' },
          (c[0] === null ? 'ℹ ' : c[0] ? '✓ ' : '✗ ') + c[1], fix ? [' ', h('button', { class: 'btn small', type: 'button', onclick: () => {
            const cc = st().career, id = fid, level = lvl(id), cost = Career.upgradeCost(id, level);
            if (!cost) return;
            cc.ledger.push({ id: cc.nextId++, day: Math.max(0, mission.start - 7), label: 'Upgrade ' + Career.facName(id) + ' to level ' + (level + 1), kind: 'facility', funds: -cost });
            App.saveState();
            status.className = 'status ok'; status.textContent = 'Added the ' + Career.facName(id) + ' upgrade (' + money(cost) + ') to the money list on the Career tab, a week before the mission.';
            render();
          } }, 'Plan the upgrade (' + money(fix ? Career.upgradeCost(fid, lvl(fid)) || 0 : 0) + ')')] : null); }))) : null;

      // money
      const rec = mission.recover;
      const factor = Career.recoveryFactor(rec.where, rec.km || 0);
      const recovery = craft ? craft.recover * factor : 0;
      const fin = Career.missionFinance(cs, {
        cost: craft ? craft.cost : 0, recovery: recovery, day: mission.start, duration: Math.ceil(plan.duration / Data.DAY),
        contracts: mission.contracts.map((c) => ({ label: c.label || 'Contract', advance: c.advance || 0, reward: c.reward || 0, sci: c.sci || 0, rep: c.rep || 0, acceptDay: Math.max(0, mission.start - 1) })),
      });
      const typeSel = select([['', 'Estimate a contract…']].concat(Object.keys(CD.contracts).filter((k) => CD.contracts[k].funds.reward > 0).map((k) => [k, k.replace(/([a-z])([A-Z])/g, '$1 $2')])), '', (v) => {
        if (!v) return;
        const legs = mission.legs || [], last = legs.slice().reverse().find((l) => l.type === 'transfer' || l.type === 'land' || l.type === 'ascent');
        const dest = last ? (last.type === 'transfer' ? last.to : last.body) : null;
        const e = Career.contractEstimate(cs, v, 'trivial', dest);
        mission.contracts.push({ label: v + (dest && dest !== 'Kerbin' ? ' (' + dest + ')' : ''), advance: e.advance, reward: e.reward, sci: e.sci, rep: e.rep });
        changed();
      }, 'Contract type');
      const savedSel = cs.contracts.length ? select([['', 'Use one from the save…']].concat(cs.contracts.map((x, i) => [String(i), x.type + (x.body ? ' ' + x.body : '') + ' (' + money(x.reward) + ')'])), '', (v) => {
        if (v === '') return;
        const x = cs.contracts[+v];
        mission.contracts.push({ label: x.type + (x.body ? ' ' + x.body : ''), advance: x.state === 'Active' ? 0 : x.advance, reward: x.reward, sci: x.sci, rep: x.rep });
        changed();
      }, 'Contract from the save') : null;
      const finCard = h('div', { class: 'card' },
        h('h2', { text: 'What it does to the money' }),
        craft ? null : h('p', { class: 'hint', text: 'Choose a rocket to count its price.' }),
        h('div', { class: 'row' },
          field('Landing', select([['pad', 'Launch pad or runway (100%)'], ['ksc', 'Elsewhere at the space centre (98%)'], ['away', 'Away from the space centre']], rec.where, (v) => { rec.where = v; changed(); }, 'Landing place')),
          rec.where === 'away' ? field('Distance km', num(rec.km, (v) => { rec.km = v || 0; changed(); }, { size: 7, label: 'distance from the space centre' })) : null,
          h('div', {}, h('div', { class: 'hint', text: 'Recovery share' }), h('strong', { text: Math.round(factor * 100) + '%' }))),
        h('p', { class: 'hint', text: 'Recovery returns the price of what is left of the rocket (' + (craft ? craft.recoverMass.toFixed(1) + ' t of parts that never separated, with their remaining fuel' : 'parts that never separate') + ') by that share. Spent stages and anything lost in space return nothing.' }),
        mission.contracts.length ? h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Contract', 'Advance', 'Reward', 'Science', 'Rep', ''].map((t, i) => h('th', { class: i > 0 && i < 5 ? 'num' : '', text: t })))),
          h('tbody', {}, mission.contracts.map((c, i) => h('tr', {},
            h('td', {}, text(c.label, (v) => { c.label = v; changed(); }, { size: 22, label: 'contract name' })),
            ['advance', 'reward', 'sci', 'rep'].map((k) => h('td', { class: 'num' }, num(c[k] || 0, (v) => { c[k] = v || 0; changed(); }, { size: 7, label: k }))),
            h('td', {}, h('button', { class: 'btn small ghost danger', type: 'button', 'aria-label': 'Remove contract', onclick: () => { mission.contracts.splice(i, 1); changed(); } }, '×'))))))) : null,
        h('div', { class: 'row', style: 'margin-top:6px' }, field('Contracts for this mission', typeSel), savedSel ? field('', savedSel) : null),
        h('p', { class: 'hint', text: 'Estimates use the base values from the game’s contract settings times the difficulty gain; real offers change with the body and how far along you are, so overwrite them with the figures on the contract card. An advance is paid when the contract is accepted (the day before launch is assumed), the reward when it is done.' }),
        h('div', { class: 'row', style: 'margin-top:6px' },
          h('div', {}, h('div', { class: 'hint', text: 'Rocket' }), h('strong', { text: '−' + money(craft ? craft.cost : 0) })),
          h('div', {}, h('div', { class: 'hint', text: 'Recovered' }), h('strong', { text: '+' + money(recovery) })),
          h('div', {}, h('div', { class: 'hint', text: 'Contracts' }), h('strong', { text: '+' + money(mission.contracts.reduce((a, c) => a + (c.advance || 0) + (c.reward || 0), 0)) })),
          h('div', {}, h('div', { class: 'hint', text: 'Net' }), h('strong', { class: fin.net >= 0 ? 'good' : 'bad', text: money(fin.net) })),
          h('div', { style: 'margin-left:auto' }, h('button', { class: 'btn primary', type: 'button', onclick: () => {
            const c = st().career;
            for (const it of fin.items) c.ledger.push({ id: c.nextId++, day: Math.round(it.day), label: mission.name + ': ' + it.label, kind: it.kind, funds: it.funds, sci: it.sci || 0, rep: it.rep || 0 });
            App.saveState();
            status.className = 'status ok'; status.textContent = 'Added ' + fin.items.length + ' items to the money list on the Career tab.';
            render();
          } }, 'Add to the money list'))));
      return [route, budget, reqCard, finCard];
    }

    render();
    return { update: render };
  }

  App.registerTab('missions', 'Missions', build, 'antennas');
})();
