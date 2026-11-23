// SPDX-License-Identifier: AGPL-3.0-or-later
/* KSP CommNet Calculator UI. Plain DOM, no framework; state is saved to localStorage. */
(function () {
  'use strict';

  const Data = window.KSPData;
  const Core = window.KSPCore;
  const Parsers = window.KSPParsers;
  const Orb = window.KSPOrbits;
  const Pl = window.KSPPlanner;
  const World = window.KSPWorld;
  const STORE = 'kspcomm.v1';
  const SOURCE_URL = 'https://github.com/slammingprogramming/ksp-commnet-calculator'; // the public repository (AGPL section 13: offer the source to network users)

  /* ================= helpers ================= */

  const $ = (sel, root) => (root || document).querySelector(sel);

  function h(tag, props) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (k === 'value' || k === 'checked' || k === 'disabled') e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    append(e, Array.prototype.slice.call(arguments, 2));
    return e;
  }
  function append(e, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k === null || k === undefined || k === false) continue;
      e.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
  }

  function sigColor(s) {
    const p = Math.max(0, Math.min(1, s || 0));
    return 'hsl(' + Math.round(p * 125) + ' 72% ' + (p > 0 ? 55 : 62) + '%)';
  }
  /** Same hue as sigColor, but dark enough to read as text on the light theme (WCAG AA); the bright one is for bars and cells. */
  function sigInk(s) {
    const light = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
    if (!light) return sigColor(s);
    const p = Math.max(0, Math.min(1, s || 0));
    return 'hsl(' + Math.round(p * 125) + ' 75% 28%)';
  }
  function verdict(s) {
    if (s >= 0.9) return 'Excellent link';
    if (s >= 0.6) return 'Good link';
    if (s >= 0.3) return 'Marginal link';
    if (s > 0) return 'Weak link: transmissions will be slow/lossy';
    return 'No connection';
  }
  const fmtMass = (m) => (m >= 1 ? m.toFixed(2) : m.toFixed(3)) + ' t';
  const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
  const techName = (t) => (t ? Data.TECH[t] || t : '–');
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mod';

  /* ================= state ================= */

  function defaultState() {
    return {
      v: 1,
      settings: {
        dsnLevel: 2, dsnCustom: '50G', rangeMod: 1, dsnMod: 1, packs: {}, bodyPacks: { opm: false },
        occVac: 0.9, occAtm: 0.75, extraStations: false, makingHistory: false, allowOtherLaunchSites: true, sunOccludes: true, atmoBlocks: false,
      },
      chain: {
        vessels: [{ name: 'Probe', antennas: [{ id: 'stock:RelayAntenna100', count: 1 }] }],
        hops: [{ text: '35.383 Gm', from: 'Kerbin', to: 'Duna' }],
        direct: { on: false, text: '', from: 'Kerbin', to: 'Duna' },
      },
      finder: {
        farKind: 'dsn', farVessel: { antennas: [{ id: 'stock:RelayAntenna50', count: 1 }] }, farCustom: '50G',
        dist: { text: '35.383 Gm', from: 'Kerbin', to: 'Duna' },
        target: 50, role: 'own', maxCount: 4, sort: 'mass', includeGround: false,
      },
      reach: {
        from: 'Kerbin', farKind: 'dsn', farVessel: { antennas: [{ id: 'stock:RelayAntenna50', count: 1 }] }, farCustom: '50G',
        vessel: { antennas: [{ id: 'stock:RelayAntenna50', count: 1 }] }, role: 'own', mode: 'distance', at: 'max',
      },
      custom: { packs: [], antennas: [], bodyPacks: [] },
      scenario: { nodes: [], ut: 0, nextId: 1 },
      tracker: { focus: 'Kerbol', speed: 3600, horizon: 426 * 21600, view: 'top' },
      transfer: { from: 'Kerbin', to: 'Duna', park: '100 km', capture: '100 km', years: 4 },
      network: { horizon: 426 * 21600, stations: {}, custom: [] },
      reentry: { body: 'Kerbin', mode: 'orbit', pe: 30000, ap: 12000000, vinf: 1000, speed: 2300, angle: 6, ballistic: 400, link: 0, heat: 1 },
      planner: { horizon: 2, target: 99.5, minSignal: 20, designHard: false, robust: true, skip: {}, targets: {}, limits: { relays: 0, mass: 0, cost: 0 }, whatif: { body: 'Kerbin', n: 3, alt: '2863 km', inc: 0, antennas: [{ id: 'stock:RelayAntenna100', count: 1 }] } },
      career: { state: null, ledger: [], goals: [], body: 'Mun', nextId: 1, title: '', draft: null, open: {} },
      missions: { crafts: [], list: [], sel: 0, nextId: 1 },
      landing: { body: 'Mun', landTilt: 10, stayTilt: 5, share: 0.5, maxLat: 90, minAlt: null, maxAlt: null, dry: true, biomes: [], avoid: [], near: null, nearKm: 500, varietyKm: 100, rank: 'flat', pick: null, open: {},
        deploy: { counts: {}, level: 0, power: 1, engineer: 0, dish: 0, gain: null, impact: { mass: 5, speed: 550, km: null, done: 0 } } },
      netplan: { sites: [], nextId: 1, mode: 'stages', horizon: 1, target: 99.5, minSignal: 20, useCareer: true, lastBody: 'Mun', place: { body: 'Mun', isp: 345, dry: 5, maxLat: 90 } },
      saveInfo: null,
      ui: { tab: 'chain' },
    };
  }
  function mergeDeep(base, extra) {
    if (!extra || typeof extra !== 'object' || Array.isArray(base)) return extra === undefined ? base : extra;
    const out = Array.isArray(base) ? base : Object.assign({}, base);
    for (const k of Object.keys(extra)) {
      // Saved state is untrusted JSON: never let these keys reach the prototype chain.
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k]) ? mergeDeep(base[k], extra[k]) : extra[k];
    }
    return out;
  }
  function loadState() {
    const def = defaultState();
    try {
      const raw = window.localStorage.getItem(STORE);
      if (!raw) return def;
      const s = mergeDeep(def, JSON.parse(raw));
      // 'larkes' (v1.0.0) became 'makingHistory' once the game data showed the DLC has two stations (Desert and Larkes).
      if (s.settings.larkes) s.settings.makingHistory = true;
      delete s.settings.larkes;
      if (!Array.isArray(s.chain.vessels) || !s.chain.vessels.length) return def;
      while (s.chain.hops.length < s.chain.vessels.length) s.chain.hops.push({ text: '', from: 'Kerbin', to: 'Duna' });
      s.chain.hops.length = s.chain.vessels.length;
      return s;
    } catch (e) {
      return def;
    }
  }
  let state = loadState();
  function saveState() {
    try { window.localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  /* ================= registry ================= */

  let ANT = [];
  let byId = new Map();
  function rebuildIndex() {
    ANT = Data.antennas.concat(state.custom.antennas);
    byId = new Map(ANT.map((a) => [a.id, a]));
  }
  const lookup = (id) => byId.get(id);
  const packList = () => Data.PACKS.concat(state.custom.packs.map((p) => ({ id: p.id, name: p.name, verified: false, defaultOn: true, custom: true })));
  function packOn(id) {
    const v = state.settings.packs[id];
    if (v !== undefined) return v;
    const p = packList().find((x) => x.id === id);
    return p ? p.defaultOn : true;
  }
  let world = null;
  function rebuildWorld() {
    const packs = (state.custom.bodyPacks || []).filter((p) => p.on);
    world = World.createWorld({
      packs: state.settings.bodyPacks,
      extraBodies: packs.reduce((q, p) => q.concat(p.bodies), []),
      patches: packs.reduce((q, p) => q.concat(p.patches || []), []),
    });
    Data.setCalendar(world.calendar.day, world.calendar.daysPerYear);
    Orb.setCalendar(world.calendar.day, world.calendar.daysPerYear);
  }
  rebuildWorld();
  const enabledBodies = () => world.bodies.filter((b) => !b.star);
  const ctx = () => ({ lookup: lookup, rangeModifier: state.settings.rangeMod, dsnModifier: state.settings.dsnMod });
  const dsnNode = () => ({ kind: 'dsn', level: state.settings.dsnLevel, custom: Core.parsePower(state.settings.dsnCustom) });
  const dsnPower = () => Core.dsnPower(dsnNode(), state.settings.dsnMod);
  const defaultAntennaId = () => 'stock:RelayAntenna50';

  /* ================= update scheduling ================= */

  const instances = {};
  let pending = false;
  let revision = 0; // bumps on every edit so cached simulations know to rebuild
  function commit() {
    revision++;
    saveState();
    if (pending) return;
    pending = true;
    // A timeout rather than requestAnimationFrame: rAF is paused in background tabs.
    window.setTimeout(() => {
      pending = false;
      const t = instances[state.ui.tab];
      if (t && t.update) t.update();
    }, 0);
  }
  function rebuildAll() {
    revision++;
    saveState();
    rebuildIndex();
    for (const k of Object.keys(instances)) {
      if (instances[k].hide) instances[k].hide();
      delete instances[k];
      const panel = $('#tab-' + k);
      if (panel) panel.replaceChildren();
    }
    activate(state.ui.tab);
  }

  /* ================= shared components ================= */

  function antennaLabel(a) {
    return a.name + ' — ' + Core.formatPower(a.power) + ' ' + a.type + (a.combinable ? '' : ' (does not stack)');
  }

  function antennaSelect(value, onChange) {
    const sel = h('select', { 'aria-label': 'Antenna' });
    let found = false;
    for (const pack of packList()) {
      const list = ANT.filter((a) => a.pack === pack.id && (packOn(pack.id) || a.id === value));
      if (!list.length) continue;
      list.sort((a, b) => a.power - b.power || a.name.localeCompare(b.name));
      const g = h('optgroup', { label: pack.name + (pack.verified === false ? ' (unverified)' : '') });
      for (const a of list) {
        g.append(h('option', { value: a.id, text: antennaLabel(a) }));
        if (a.id === value) found = true;
      }
      sel.append(g);
    }
    if (!found) sel.prepend(h('option', { value: value, text: '(unknown antenna: ' + value + ')' }));
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  /** Editable list of {id, count}. Mutates `list` in place and calls onChange. */
  function antennaEditor(list, onChange) {
    const box = h('div', { class: 'ant-list' });
    function render() {
      box.replaceChildren();
      if (!list.length) box.append(h('p', { class: 'hint', text: 'No antennas: the vessel falls back to its built-in 5k antenna.' }));
      list.forEach((entry, i) => {
        const cnt = h('input', { type: 'number', min: 1, max: 99, value: entry.count, 'aria-label': 'Number of antennas' });
        cnt.addEventListener('input', () => {
          const n = parseInt(cnt.value, 10);
          if (n >= 1) { entry.count = Math.min(99, n); onChange(); }
        });
        const sel = antennaSelect(entry.id, (v) => { entry.id = v; if (!(lookup(v) || {}).feed) delete entry.reflector; render(); onChange(); });
        const rm = h('button', { class: 'btn small ghost danger', type: 'button', 'aria-label': 'Remove antenna', onclick: () => { list.splice(i, 1); render(); onChange(); } }, '✕');
        // The game ignores antennas that are not fully extended, so a retracted or broken one can be unticked.
        const ext = h('input', { type: 'checkbox', checked: !entry.retracted, 'aria-label': 'Extended and working' });
        ext.addEventListener('change', () => { if (ext.checked) delete entry.retracted; else entry.retracted = true; onChange(); });
        const extLbl = h('label', { class: 'inline', title: 'Untick for a retracted or broken antenna: the game ignores it', style: 'white-space:nowrap' }, ext, 'extended');
        // Near Future Exploration reflectors boost feeds that point at them (see docs/RESEARCH.md).
        const a = lookup(entry.id);
        let refl = null;
        if (a && a.feed && packOn('nfe')) {
          refl = h('select', { 'aria-label': 'Reflector this antenna points at' }, h('option', { value: '', text: 'no reflector' }),
            Data.REFLECTORS.map((r) => h('option', { value: r.id, text: r.name + ' (+' + Core.formatPower(r.bonus * a.feed) + ')' })));
          refl.value = entry.reflector || '';
          refl.addEventListener('change', () => { if (refl.value) entry.reflector = refl.value; else delete entry.reflector; onChange(); });
        }
        box.append(h('div', { class: 'ant-row' }, cnt, sel, extLbl, rm));
        if (refl) box.append(h('div', { class: 'ant-row', style: 'margin-left:3.2em' }, refl));
      });
      box.append(h('button', {
        class: 'btn small', type: 'button',
        onclick: () => { list.push({ id: list.length ? list[list.length - 1].id : defaultAntennaId(), count: 1 }); render(); onChange(); },
      }, '＋ Add antenna'));
    }
    render();
    return box;
  }

  function bodySelect(value, onChange, opts) {
    const sel = h('select', { 'aria-label': 'Body' });
    const list = (opts && opts.withStar ? world.bodies : enabledBodies()).slice();
    if (!list.some((b) => b.id === value)) {
      const b = world.index.get(value);
      if (b) list.push(b);
    }
    for (const b of list) sel.append(h('option', { value: b.id, text: ' '.repeat(Math.max(0, 2 * (b.depth - 1))) + (b.depth >= 2 ? '↳ ' : '') + b.name }));
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  /** Distance text box with an optional "pick two bodies" helper. model = {text, from, to}. */
  function distanceWidget(model, onChange) {
    const input = h('input', { type: 'text', class: 'dist', value: model.text, placeholder: 'e.g. 35 Gm', 'aria-label': 'Distance', autocomplete: 'off', spellcheck: 'false' });
    const note = h('small', { class: 'hint' });
    const chips = h('div', { class: 'chips' });
    const panel = h('div', { class: 'bodies' });
    const toggle = h('button', { class: 'btn small ghost', type: 'button', 'aria-expanded': 'false' }, 'Pick bodies…');

    function updateNote() {
      const v = Core.parseDistance(model.text);
      const empty = !String(model.text).trim();
      note.className = 'hint' + (!empty && !(v >= 0) ? ' bad' : '');
      note.textContent = empty ? 'Type a distance (m, km, Mm, Gm, Tm) or pick two bodies.' : v >= 0 ? '= ' + Core.formatDistance(v, 4) : 'Not a valid distance. Try "35 Gm" or "12000 km".';
    }
    const vesselPanel = h('div', { class: 'bodies', hidden: true });
    const vesselToggle = h('button', { class: 'btn small ghost', type: 'button', 'aria-expanded': 'false', title: 'Measure the distance and the line of sight between two vessels or stations of your scenario' }, 'Scenario vessels…');
    vesselToggle.addEventListener('click', () => {
      vesselPanel.hidden = !vesselPanel.hidden;
      vesselToggle.setAttribute('aria-expanded', String(!vesselPanel.hidden));
      if (!vesselPanel.hidden) buildVesselPanel();
    });
    function buildVesselPanel() {
      const Scn = window.KSPScenario;
      if (!Scn) return;
      const sim = Scn.getSim();
      const names = sim.nodes.map((n, i) => ({ i: i, name: n.name }));
      const mk = (label) => {
        const s = h('select', { 'aria-label': label }, names.map((n) => h('option', { value: String(n.i), text: n.name })));
        return s;
      };
      const a = mk('First vessel or station'), b = mk('Second vessel or station');
      if (names.length > 1) b.value = String(names[names.length - 1].i);
      const res = h('small', { class: 'hint', style: 'display:block;margin-top:6px' });
      const go = h('button', { class: 'btn small', type: 'button' }, 'Measure');
      go.addEventListener('click', () => {
        const i = parseInt(a.value, 10), j = parseInt(b.value, 10);
        if (!(i >= 0) || !(j >= 0) || i === j) { res.textContent = 'Pick two different vessels.'; return; }
        const r = sim.sightBetween(i, j, state.scenario.ut, 4 * Data.YEAR, 3000);
        model.text = Core.formatDistance(r.now, 6); input.value = model.text; updateNote(); onChange();
        const names2 = Object.keys(r.by).sort((x, y) => r.by[y] - r.by[x]).map((nm) => nm + ' ' + (r.by[nm] * 100).toFixed(1) + '%');
        res.textContent = 'Distance now ' + Core.formatDistance(r.now, 3) + ' (closest ' + Core.formatDistance(r.min, 3) + ', farthest ' + Core.formatDistance(r.max, 3) + ' over the next 4 years). ' +
          (r.blocked === 0 ? 'Nothing blocks the straight line between them, vessels hiding behind their own planet included.' : 'The line is blocked ' + (r.blocked * 100).toFixed(1) + '% of the time (' + names2.join(', ') + ').');
      });
      vesselPanel.replaceChildren(...[h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { text: 'From' }), a), h('div', { class: 'field' }, h('label', { text: 'To' }), b), go), res,
        names.length < 2 ? h('small', { class: 'hint', text: 'Add vessels on the Scenario tab to use this.' }) : null].filter(Boolean));
    }
    const sight = h('small', { class: 'hint', style: 'display:block;margin-top:6px' });
    function refreshSight() {
      const r = model.from !== model.to ? world.sightReport(model.from, model.to, {
        occVac: state.settings.occVac, occAtm: state.settings.occAtm, sunOccludes: state.settings.sunOccludes !== false, atmosphereBlocks: !!state.settings.atmoBlocks,
      }, state.scenario.ut, 8 * Data.YEAR, 4000) : null;
      if (!r) { sight.textContent = ''; return; }
      const names = Object.keys(r.by).sort((x, y) => r.by[y] - r.by[x]).map((id) => (world.index.get(id) || { name: id }).name + ' ' + (r.by[id] * 100).toFixed(1) + '%');
      sight.textContent = r.blocked === 0
        ? 'Line of sight over the next 8 years: nothing blocks the straight line between the two bodies (centre to centre; a vessel behind its own planet is not considered here, see the Tracker).'
        : 'Line of sight over the next 8 years: the straight line between the two bodies is blocked ' + (r.blocked * 100).toFixed(1) + '% of the time (' + names.join(', ') + '). Range alone says the link works; these are the windows where it does not without another route or a relay.';
    }
    function refreshChips() {
      refreshSight();
      chips.replaceChildren();
      const r = model.from !== model.to ? world.distanceRange(model.from, model.to) : null;
      if (!r) { chips.append(h('small', { class: 'hint', text: 'Pick two different bodies.' })); return; }
      const now = world.distanceAt(model.from, model.to, state.scenario.ut);
      chips.append(h('button', {
        class: 'btn small', type: 'button', title: 'Actual separation at the scenario time',
        onclick: () => { model.text = Core.formatDistance(now, 6); input.value = model.text; updateNote(); onChange(); },
      }, 'At ' + Orb.formatUT(state.scenario.ut) + ' · ' + Core.formatDistance(now, 3)));
      [['min', 'Closest'], ['mid', 'Midpoint'], ['max', 'Farthest']].forEach((p) => {
        chips.append(h('button', {
          class: 'btn small', type: 'button',
          onclick: () => { model.text = Core.formatDistance(r[p[0]], 6); input.value = model.text; updateNote(); onChange(); },
        }, p[1] + ' · ' + Core.formatDistance(r[p[0]], 3)));
      });
    }
    input.addEventListener('input', () => { model.text = input.value; updateNote(); onChange(); });
    const fromSel = bodySelect(model.from, (v) => { model.from = v; refreshChips(); onChange(); });
    const toSel = bodySelect(model.to, (v) => { model.to = v; refreshChips(); onChange(); });
    toggle.addEventListener('click', () => {
      const open = !panel.classList.contains('open');
      panel.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });
    panel.append(
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { text: 'From' }), fromSel),
        h('div', { class: 'field' }, h('label', { text: 'To' }), toSel)),
      chips,
      h('small', { class: 'hint', text: 'Closest/farthest separation over the first 10,000 years of the game (a worst/best case, not today’s positions). Moons add their own orbit.' })
    );
    refreshChips();
    updateNote();
    return { el: h('div', {}, h('div', { class: 'dist-row' }, input, toggle, vesselToggle, note), sight, panel, vesselPanel) };
  }

  /** Far-end selector shared by the finder and the reach map. model = {farKind, farVessel, farCustom}. */
  function farEndControls(model, onChange) {
    const kind = h('select', { 'aria-label': 'Far end' },
      h('option', { value: 'dsn', text: 'Kerbin DSN (uses the Tracking Station level above)' }),
      h('option', { value: 'vessel', text: 'A relay vessel (its relay antennas)' }),
      h('option', { value: 'custom', text: 'Custom power' }));
    kind.value = model.farKind;
    const vesselBox = h('div', {}, antennaEditor(model.farVessel.antennas, onChange));
    const customIn = h('input', { type: 'text', value: model.farCustom, placeholder: 'e.g. 15G', 'aria-label': 'Far-end power', spellcheck: 'false' });
    const customBox = h('div', {}, customIn, h('small', { class: 'hint', text: ' power rating, e.g. 500k, 2G, 250G (used as is, no modifiers)' }));
    function sync() {
      vesselBox.hidden = model.farKind !== 'vessel';
      customBox.hidden = model.farKind !== 'custom';
    }
    kind.addEventListener('change', () => { model.farKind = kind.value; sync(); onChange(); });
    customIn.addEventListener('input', () => { model.farCustom = customIn.value; onChange(); });
    sync();
    return {
      el: h('div', { class: 'field' }, kind, vesselBox, customBox),
      power() {
        if (model.farKind === 'dsn') return dsnPower();
        if (model.farKind === 'vessel') return Core.vesselStats(model.farVessel.antennas, lookup, state.settings.rangeMod).relay;
        return Core.parsePower(model.farCustom);
      },
    };
  }

  /** Settings for the time-domain simulator, from the current game settings. */
  function simSettings() {
    return {
      rangeMod: state.settings.rangeMod, dsnPower: dsnPower(), occVac: state.settings.occVac, occAtm: state.settings.occAtm,
      atmosphereBlocks: !!state.settings.atmoBlocks, sunOccludes: state.settings.sunOccludes !== false,
      extraStations: !!state.settings.extraStations, makingHistory: !!state.settings.makingHistory, allowOtherLaunchSites: state.settings.allowOtherLaunchSites !== false,
      stationOverride: state.network.stations, customStations: state.network.custom,
    };
  }

  const meter = (s) => h('div', { class: 'meter' }, h('i', { style: 'width:' + Math.round(s * 100) + '%;background:' + sigColor(s) }));

  /* ================= settings panel ================= */

  let settingsOpen = window.matchMedia('(min-width: 700px)').matches;

  function buildSettings() {
    const root = $('#settings');
    root.replaceChildren();
    const s = state.settings;

    // Tracking Station
    const dsnBtns = Data.DSN_LEVELS.map((l) => h('button', {
      class: 'btn small', type: 'button', 'aria-pressed': String(s.dsnLevel === l.level),
      onclick: () => { s.dsnLevel = l.level; commit(); buildSettings(); },
    }, 'Level ' + l.level + ' · ' + Core.formatPower(l.power)));
    dsnBtns.push(h('button', {
      class: 'btn small', type: 'button', 'aria-pressed': String(s.dsnLevel === 'custom'),
      onclick: () => { s.dsnLevel = 'custom'; commit(); buildSettings(); },
    }, 'Custom'));
    const custom = h('input', { type: 'text', value: s.dsnCustom, 'aria-label': 'Custom DSN power', placeholder: '50G', style: 'width:6em' });
    custom.addEventListener('input', () => { s.dsnCustom = custom.value; commit(); });
    const dsnBlock = h('div', {},
      h('h3', { text: 'Tracking Station (DSN)' }),
      h('div', { class: 'seg' }, dsnBtns),
      s.dsnLevel === 'custom' ? h('div', { class: 'inline', style: 'margin-top:6px' }, custom) : null);

    // Difficulty
    const presetBtns = [];
    const rangeIn = h('input', { type: 'number', min: 0, step: 0.05, value: s.rangeMod, 'aria-label': 'Range modifier' });
    const dsnIn = h('input', { type: 'number', min: 0, step: 0.05, value: s.dsnMod, 'aria-label': 'DSN modifier' });
    const occVacIn = h('input', { type: 'number', min: 0.1, max: 1.25, step: 0.05, value: s.occVac, 'aria-label': 'Occlusion modifier, vacuum bodies' });
    const occAtmIn = h('input', { type: 'number', min: 0.1, max: 1.25, step: 0.05, value: s.occAtm, 'aria-label': 'Occlusion modifier, atmosphere bodies' });
    function syncPresets() {
      presetBtns.forEach((b) => b.el.setAttribute('aria-pressed', String(s.rangeMod === b.p.range && s.dsnMod === b.p.dsn && s.occVac === b.p.occVac && s.occAtm === b.p.occAtm)));
    }
    Data.DIFFICULTY_PRESETS.forEach((p) => {
      const el = h('button', {
        class: 'btn small', type: 'button', title: 'Range ×' + p.range + ', DSN ×' + p.dsn,
        onclick: () => { s.rangeMod = p.range; s.dsnMod = p.dsn; s.occVac = p.occVac; s.occAtm = p.occAtm; rangeIn.value = p.range; dsnIn.value = p.dsn; occVacIn.value = p.occVac; occAtmIn.value = p.occAtm; syncPresets(); commit(); },
      }, p.name);
      presetBtns.push({ el: el, p: p });
    });
    const numInput = (input, key) => input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (v >= 0) { s[key] = v; syncPresets(); commit(); }
    });
    numInput(rangeIn, 'rangeMod');
    numInput(dsnIn, 'dsnMod');
    numInput(occVacIn, 'occVac');
    numInput(occAtmIn, 'occAtm');
    syncPresets();
    const diffBlock = h('div', {},
      h('h3', { text: 'Difficulty' }),
      h('div', { class: 'seg' }, presetBtns.map((b) => b.el)),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('div', { class: 'field' }, h('label', { text: 'Range modifier ×' }), rangeIn),
        h('div', { class: 'field' }, h('label', { text: 'DSN modifier ×' }), dsnIn),
        h('div', { class: 'field' }, h('label', { text: 'Occlusion (vacuum) ×' }), occVacIn),
        h('div', { class: 'field' }, h('label', { text: 'Occlusion (atmosphere) ×' }), occAtmIn)));

    // Systems + packs
    const opm = h('input', { type: 'checkbox', checked: !!s.bodyPacks.opm });
    opm.addEventListener('change', () => { s.bodyPacks.opm = opm.checked; rebuildWorld(); rebuildAll(); });
    const enabled = packList().filter((p) => packOn(p.id)).map((p) => p.name);
    const flag = (key, label, title) => {
      const cb = h('input', { type: 'checkbox', checked: !!s[key] });
      cb.addEventListener('change', () => { s[key] = cb.checked; commit(); });
      return h('label', { class: 'inline', style: 'color:var(--text);display:flex', title: title || '' }, cb, label);
    };
    const sysBlock = h('div', {},
      h('h3', { text: 'Systems & antennas' }),
      h('label', { class: 'inline', style: 'color:var(--text)' }, opm, 'Outer Planets Mod bodies'),
      flag('extraStations', 'Extra ground stations (difficulty option)', 'Six more Kerbin stations (five anomaly dishes and Baikerbanur) at the DSN rating. Off: they do not exist.'),
      flag('allowOtherLaunchSites', 'Other launch sites allowed (difficulty option)', 'Only matters for Making History: its two launch-site stations (Desert, Larkes) are weak fixed 40k antennas that exist when this is on, even with extra stations off.'),
      flag('makingHistory', 'Making History launch-site stations (Desert, Larkes)', 'Adds the DLC\u2019s two permanent ground stations. Positions and power are read from the DLC\u2019s own data.'),
      h('details', { style: 'margin-top:6px' }, h('summary', { class: 'hint', text: 'Simulation switches (what-if)' }),
        flag('sunOccludes', 'Kerbol blocks signals', 'On, as in the game: the Sun carries a CommNetBody like every planet and moon. Switch off only to see what conjunctions would do otherwise.'),
        flag('atmoBlocks', 'Atmosphere height counts toward blocking size', 'Off, as in the game: the occlusion modifier scales the body radius only (read from CommNetBody.CreateOccluder). Switch on only to experiment.')),
      h('p', { class: 'hint', style: 'margin-top:6px' }, 'Antenna packs: ' + enabled.join(', ') + '. ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); activate('antennas'); } }, 'Change')));

    // Save import
    const file = h('input', { type: 'file', accept: '.sfs,.txt', hidden: true, 'aria-label': 'KSP save file' });
    const status = h('div', { class: 'status' });
    if (state.saveInfo) {
      status.className = 'status ok';
      status.textContent = 'Loaded “' + state.saveInfo.title + '”: ' + state.saveInfo.vessels.filter((v) => v.antennas.length).length + ' vessel(s) with antennas; import them into a scenario on the Scenario tab.';
    } else {
      status.textContent = 'Optional: import difficulty, Tracking Station level and vessel antennas from your KSP save (stays in your browser).';
    }
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      f.text().then((text) => {
        const info = Parsers.parseSave(text);
        if (!info) { status.className = 'status bad'; status.textContent = 'That doesn’t look like a KSP persistent.sfs.'; return; }
        applySave(info);
      }, () => { status.className = 'status bad'; status.textContent = 'Couldn’t read that file.'; });
      file.value = '';
    });
    const saveBlock = h('div', { class: 'save-strip' },
      h('div', { class: 'seg' },
        h('button', { class: 'btn small', type: 'button', title: 'KSP/saves/<name>/persistent.sfs', onclick: () => file.click() }, 'Load persistent.sfs…'),
        state.saveInfo ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { state.saveInfo = null; rebuildAll(); buildSettings(); } }, 'Forget save') : null),
      file, status);

    const dsnText = s.dsnLevel === 'custom' ? 'custom DSN' : 'Level ' + s.dsnLevel + ' DSN';
    const details = h('details', {},
      h('summary', {}, 'Game settings', h('small', { class: 'hint', text: dsnText + ' · range ×' + s.rangeMod + ' · DSN ×' + s.dsnMod }), ),
      h('div', { class: 'settings-grid' }, dsnBlock, diffBlock, sysBlock, saveBlock));
    details.open = settingsOpen;
    details.addEventListener('toggle', () => { settingsOpen = details.open; });
    root.append(details);
  }

  function applySave(info) {
    const s = state.settings;
    if (info.params) {
      if (info.params.rangeModifier !== undefined) s.rangeMod = info.params.rangeModifier;
      if (info.params.dsnModifier !== undefined) s.dsnMod = info.params.dsnModifier;
      if (info.params.occlusionVac !== undefined) s.occVac = info.params.occlusionVac;
      if (info.params.occlusionAtm !== undefined) s.occAtm = info.params.occlusionAtm;
      if (info.params.enableGroundStations !== undefined) s.extraStations = info.params.enableGroundStations;
    }
    if (info.allowOtherLaunchSites !== null && info.allowOtherLaunchSites !== undefined) s.allowOtherLaunchSites = info.allowOtherLaunchSites;
    if (info.trackingStationLevel) s.dsnLevel = Math.min(3, Math.max(1, info.trackingStationLevel));
    const vessels = [];
    for (const v of info.vessels) {
      const counts = new Map();
      for (const part of Object.keys(v.parts)) {
        const a = ANT.find((x) => x.parts.indexOf(part) >= 0);
        if (a) counts.set(a.id, (counts.get(a.id) || 0) + v.parts[part]);
      }
      if (counts.size || v.orbit) vessels.push({ name: v.name, type: v.type, antennas: Array.from(counts, (e) => ({ id: e[0], count: e[1] })), sit: v.sit, lat: v.lat, lon: v.lon, alt: v.alt, orbit: v.orbit });
    }
    state.saveInfo = { title: info.title || 'save', mode: info.mode, ut: info.ut, vessels: vessels };
    saveState();
    buildSettings();
    rebuildAll();
  }

  /* ================= Tab: link & relay chain ================= */

  function buildChain(root) {
    const c = state.chain;
    const vessels = c.vessels;
    const hops = c.hops;
    const layout = h('div', { class: 'two-col' });
    const editor = h('div', { class: 'chain' });
    const results = h('aside', { class: 'card sticky', 'aria-live': 'polite' });
    layout.append(editor, results);
    root.append(layout);

    let refs = null;
    const nodeName = (i) => (i === 0 ? 'DSN' : vessels[i - 1].name || 'Vessel ' + i);

    function newRelay() {
      return { name: 'Relay ' + vessels.length, antennas: [{ id: defaultAntennaId(), count: 1 }] };
    }
    // A new relay goes at the end of hop j: that hop keeps its distance (now up to the relay) and a fresh
    // hop from the relay to the next node is added. Removing a relay undoes exactly that.
    function insertRelay(j) {
      vessels.splice(j, 0, newRelay());
      hops.splice(j + 1, 0, { text: '', from: hops[j].from, to: hops[j].to });
      saveState();
      render();
      commit();
    }
    function removeVessel(j) {
      const last = j === vessels.length - 1;
      vessels.splice(j, 1);
      hops.splice(last ? j : j + 1, 1);
      saveState();
      render();
      commit();
    }

    function hopEl(j) {
      const badge = h('span', { class: 'badge', text: '–' });
      refs.badges[j] = badge;
      const dw = distanceWidget(hops[j], commit);
      return h('div', { class: 'hop' },
        h('div', { class: 'hop-head' },
          h('span', { class: 'label', text: 'Hop ' + (j + 1) + ' distance' }), badge,
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => insertRelay(j) }, '＋ Relay here')),
        dw.el);
    }

    function vesselEl(v, j) {
      const last = j === vessels.length - 1;
      const name = h('input', { type: 'text', value: v.name, 'aria-label': 'Vessel name', maxlength: 40 });
      name.addEventListener('input', () => { v.name = name.value; commit(); });
      const stats = h('div', { class: 'stats' });
      refs.stats[j] = stats;
      const pick = state.saveInfo && state.saveInfo.vessels.some((v) => v.antennas.length) ? (function () {
        const sel = h('select', { 'aria-label': 'Copy antennas from a save vessel' }, h('option', { value: '', text: 'Copy antennas from save…' }));
        state.saveInfo.vessels.forEach((sv, i) => { if (sv.antennas.length) sel.append(h('option', { value: String(i), text: sv.name + (sv.type ? ' (' + sv.type + ')' : '') })); });
        sel.addEventListener('change', () => {
          const sv = state.saveInfo.vessels[parseInt(sel.value, 10)];
          if (!sv) return;
          v.antennas = sv.antennas.map((a) => ({ id: a.id, count: a.count }));
          if (!v.name || /^(Probe|Relay \d+)$/.test(v.name)) v.name = sv.name;
          saveState();
          render();
          commit();
        });
        return sel;
      })() : null;
      return h('div', { class: 'node ' + (last ? 'endpoint' : 'relay') },
        h('div', { class: 'node-head' },
          name,
          h('span', { class: 'tag', text: last ? 'Endpoint · all antennas count' : 'Relay · only relay antennas count' }),
          vessels.length > 1 ? h('button', { class: 'btn small ghost danger', type: 'button', onclick: () => removeVessel(j) }, 'Remove') : null),
        antennaEditor(v.antennas, commit),
        pick,
        stats);
    }

    function render() {
      refs = { dsnStats: h('div', { class: 'stats' }), badges: [], stats: [] };
      editor.replaceChildren(
        h('div', { class: 'node dsn' },
          h('div', { class: 'node-head' }, h('div', {}, h('strong', { text: 'Kerbin DSN ' }), h('span', { class: 'tag', text: 'far end of the chain' }))),
          refs.dsnStats)
      );
      vessels.forEach((v, j) => { editor.append(hopEl(j), vesselEl(v, j)); });

      const directBox = h('div', { class: 'callout' });
      if (vessels.length > 1) {
        const dw = distanceWidget(c.direct, commit);
        const box = h('div', { style: 'margin-top:8px' }, dw.el);
        box.hidden = !c.direct.on;
        const cb = h('input', { type: 'checkbox', checked: c.direct.on });
        cb.addEventListener('change', () => { c.direct.on = cb.checked; box.hidden = !cb.checked; commit(); });
        directBox.append(h('label', { class: 'inline', style: 'color:var(--text)' }, cb, 'Also check a direct link from “' + nodeName(vessels.length) + '” to the DSN'),
          h('div', {}, h('small', { class: 'hint', text: 'The game always prefers a direct link when one exists. Range only: bodies in the way are not checked here (use the Tracker for that).' })), box);
      }
      editor.append(...[
        h('div', { class: 'chain-actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => insertRelay(vessels.length - 1) }, '＋ Add relay')),
        vessels.length > 1 ? directBox : null,
      ].filter(Boolean));
    }

    function update() {
      const nodes = [dsnNode()].concat(vessels.map((v) => ({ kind: 'vessel', antennas: v.antennas })));
      const dist = hops.map((hp) => Core.parseDistance(hp.text));
      const valid = dist.map((d) => d >= 0);
      const ev = Core.evaluateChain(nodes, dist.map((d) => (d >= 0 ? d : 0)), ctx());
      const s = state.settings;

      // DSN + vessel summaries
      const lvl = s.dsnLevel === 'custom' ? 'Custom' : 'Level ' + s.dsnLevel;
      refs.dsnStats.replaceChildren(lvl + ' · rating ', h('b', { text: Core.formatPower(ev.nodes[0].power) }), s.dsnMod !== 1 ? ' (DSN modifier ×' + s.dsnMod + ')' : '');
      vessels.forEach((v, j) => {
        const st = ev.nodes[j + 1].stats;
        const last = j === vessels.length - 1;
        const parts = [];
        parts.push(h('span', {}, 'Own link power ', h('b', { text: Core.formatPower(st.own) })));
        parts.push(h('span', {}, ' · as relay ', h('b', { text: st.relay > 0 ? Core.formatPower(st.relay) : 'none' })));
        if (st.exp) parts.push(h('span', { text: ' · exponent ' + st.exp.toFixed(3) }));
        if (s.rangeMod !== 1) parts.push(h('span', { text: ' · range ×' + s.rangeMod }));
        if (st.usedBuiltin) parts.push(h('span', { class: 'warn', text: ' · using built-in 5k' }));
        if (st.unknown) parts.push(h('span', { class: 'bad', text: ' · ' + st.unknown + ' unknown antenna(s)' }));
        if (!last && st.relay === 0) parts.push(h('span', { class: 'bad', text: ' · cannot relay (no relay antenna)' }));
        refs.stats[j].replaceChildren(...parts);
      });
      ev.hops.forEach((hp, j) => {
        const b = refs.badges[j];
        b.textContent = valid[j] ? Core.formatPercent(hp.signal) : '–';
        b.style.background = valid[j] ? sigColor(hp.signal) : 'var(--muted)';
      });

      // results
      const allValid = valid.every(Boolean);
      const total = allValid ? ev.total : 0;
      const notes = [];
      const note = (t) => { if (notes.indexOf(t) < 0) notes.push(t); };
      const out = [];
      out.push(h('div', { class: 'big' },
        h('div', { class: 'pct', style: 'color:' + (allValid ? sigInk(total) : 'var(--muted)'), text: allValid ? Core.formatPercent(total) : '–' }),
        h('div', {}, h('div', { class: 'verdict', text: allValid ? verdict(total) : 'Enter every hop distance' }),
          h('small', { class: 'hint', text: nodes.map((n, i) => nodeName(i)).join('  ⇄  ') }))));
      out.push(meter(total));

      const rows = ev.hops.map((hp, j) => {
        const a = nodeName(j), b = nodeName(j + 1);
        const failing = valid[j] && hp.signal === 0;
        if (hp.noRelayA) note('“' + a + '” has no relay antenna, so it can’t pass a signal along. Direct antennas only help a vessel’s own link.');
        if (hp.noRelayB) note('“' + b + '” has no relay antenna, so it can’t pass a signal along. Direct antennas only help a vessel’s own link.');
        if (failing && hp.range > 0) note('Hop ' + (j + 1) + ' is out of range by ' + Core.formatDistance(hp.distance - hp.range) + ' (range ' + Core.formatDistance(hp.range) + ').');
        return h('tr', {},
          h('td', {}, (j + 1) + '. ' + a + ' ⇄ ' + b),
          h('td', { class: 'num' }, valid[j] ? Core.formatDistance(hp.distance) : '–'),
          h('td', { class: 'num' }, hp.range > 0 ? Core.formatDistance(hp.range) : '–'),
          h('td', { class: 'num', style: valid[j] ? 'font-weight:700;color:' + sigInk(hp.signal) : '' }, valid[j] ? Core.formatPercent(hp.signal) : '–'),
          h('td', {}, valid[j] && (hp.signal < 0.5) ? h('button', { class: 'btn small', type: 'button', onclick: () => toFinder(j, dist[j]) }, 'Find antennas') : null));
      });
      out.push(h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Hop' }), h('th', { class: 'num', text: 'Distance' }), h('th', { class: 'num', text: 'Max range' }), h('th', { class: 'num', text: 'Signal' }), h('th'))),
        h('tbody', {}, rows))));
      if (ev.hops.length > 1 && allValid && ev.connected) out.push(h('p', { class: 'hint', style: 'margin-top:8px', text: 'Path signal is the product of every hop’s signal. Weakest hop: ' + (ev.weakest.index + 1) + ' (' + Core.formatPercent(ev.weakest.signal) + ').' }));

      // direct comparison
      if (vessels.length > 1 && c.direct.on) {
        const d = Core.parseDistance(c.direct.text);
        const own = ev.nodes[ev.nodes.length - 1].stats.own;
        if (d >= 0) {
          const dr = Core.linkRange(ev.nodes[0].power, own);
          const ds = Core.signalStrength(d, dr);
          let msg;
          if (ds > 0) msg = 'A direct link exists, so the game will use it (' + Core.formatPercent(ds) + '), even if the relay path (' + (allValid ? Core.formatPercent(total) : '–') + ') were stronger.';
          else if (allValid && total > 0) msg = 'The direct link is out of range (max ' + Core.formatDistance(dr) + '), so the game falls back to the relay path: ' + Core.formatPercent(total) + '.';
          else msg = 'Neither the direct link nor the relay path connects.';
          out.push(h('div', { class: 'callout' }, h('strong', { text: 'Direct link to DSN: ' + Core.formatPercent(ds) }), h('br'), msg));
        } else {
          out.push(h('div', { class: 'callout' }, 'Enter a distance for the direct link.'));
        }
      }
      if (notes.length) out.push(h('ul', { class: 'notes' }, notes.map((n) => h('li', { text: n }))));
      results.replaceChildren(...out);
    }

    function toFinder(j, d) {
      const f = state.finder;
      const last = j === vessels.length - 1;
      const nodes = [dsnNode()].concat(vessels.map((v) => ({ kind: 'vessel', antennas: v.antennas })));
      const ev = Core.evaluateChain(nodes, hops.map((hp) => Math.max(0, Core.parseDistance(hp.text) || 0)), ctx());
      const other = ev.nodes[j];
      if (j === 0) f.farKind = 'dsn';
      else { f.farKind = 'custom'; f.farCustom = Core.formatPower(other.power, 6); }
      f.role = last ? 'own' : 'relay';
      f.dist = { text: hops[j].text, from: hops[j].from, to: hops[j].to };
      f.target = 50;
      saveState();
      delete instances.finder;
      $('#tab-finder').replaceChildren();
      activate('finder');
    }

    render();
    return { update: update, focusHop: toFinder };
  }

  /* ================= Tab: antenna finder ================= */

  function buildFinder(root) {
    const f = state.finder;
    const left = h('div', { class: 'card' });
    const right = h('div', { class: 'card', 'aria-live': 'polite' });
    root.append(h('div', { class: 'two-col' }, left, right));

    const far = farEndControls(f, commit);
    const dw = distanceWidget(f.dist, commit);
    const target = h('input', { type: 'range', min: 10, max: 100, step: 5, value: f.target, 'aria-label': 'Target signal' });
    const targetLabel = h('strong', { text: f.target + '%' });
    target.addEventListener('input', () => { f.target = parseInt(target.value, 10); targetLabel.textContent = f.target + '%'; commit(); });
    const role = h('select', { 'aria-label': 'Role of your vessel' },
      h('option', { value: 'own', text: 'Its own connection (all antennas count)' }),
      h('option', { value: 'relay', text: 'Acting as a relay (relay antennas only)' }));
    role.value = f.role;
    role.addEventListener('change', () => { f.role = role.value; commit(); });
    const maxCount = h('input', { type: 'number', min: 1, max: 12, value: f.maxCount, 'aria-label': 'Max copies of one antenna' });
    maxCount.addEventListener('input', () => { const n = parseInt(maxCount.value, 10); if (n >= 1) { f.maxCount = Math.min(12, n); commit(); } });
    const sort = h('select', { 'aria-label': 'Sort results' },
      h('option', { value: 'mass', text: 'Lightest' }), h('option', { value: 'cost', text: 'Cheapest' }),
      h('option', { value: 'parts', text: 'Fewest parts' }), h('option', { value: 'signal', text: 'Strongest signal' }));
    sort.value = f.sort;
    sort.addEventListener('change', () => { f.sort = sort.value; commit(); });
    const ground = h('input', { type: 'checkbox', checked: f.includeGround });
    ground.addEventListener('change', () => { f.includeGround = ground.checked; commit(); });

    left.append(
      h('h2', { text: 'What antennas do I need?' }),
      h('p', { class: 'hint', text: 'Enter the link you want to close. You’ll get the smallest antenna combinations that reach your target signal. Range only: a planet or moon in the way can still block the link (see the Reach map’s line-of-sight check, or the Tracker and Relay planner).' }),
      h('div', { class: 'field' }, h('label', { text: 'Other end of the link' }), far.el),
      h('div', { class: 'field', style: 'margin-top:10px' }, h('label', { text: 'Distance between the two ends' }), dw.el),
      h('div', { class: 'field', style: 'margin-top:10px' }, h('label', {}, 'Target signal: ', targetLabel), target),
      h('div', { class: 'field', style: 'margin-top:10px' }, h('label', { text: 'Your vessel is used as' }), role),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('div', { class: 'field' }, h('label', { text: 'Max copies of one antenna' }), maxCount),
        h('div', { class: 'field' }, h('label', { text: 'Sort by' }), sort)),
      h('label', { class: 'inline', style: 'color:var(--text);margin-top:10px' }, ground, 'Include Breaking Ground ground-station antennas'));

    function update() {
      const s = state.settings;
      const farPower = far.power();
      const d = Core.parseDistance(f.dist.text);
      const out = [h('h2', { text: 'Results' })];
      if (!(farPower > 0)) { out.push(h('p', { class: 'hint', text: 'Set the other end’s power (or add a relay antenna to that vessel).' })); right.replaceChildren(...out); return; }
      if (!(d >= 0)) { out.push(h('p', { class: 'hint', text: 'Enter a distance to see suggestions.' })); right.replaceChildren(...out); return; }
      const t = f.target / 100;
      const needed = Core.powerForSignal(d, t, farPower);
      out.push(h('div', { class: 'callout' },
        'For ', h('b', { text: f.target + '%' }), ' at ', h('b', { text: Core.formatDistance(d) }), ' against a ', h('b', { text: Core.formatPower(farPower) }),
        ' far end you need a vessel power of at least ', h('b', { text: Core.formatPower(needed) }),
        ' (max range ', Core.formatDistance(Core.rangeForSignal(d, t)), ')', s.rangeMod !== 1 ? ' after the range modifier' : '', '.'));
      const pool = ANT.filter((a) => packOn(a.pack) && !a.builtin && (f.includeGround || !a.ground));
      const rows = Core.findSetups({ antennas: pool, farPower: farPower, distance: d, target: t, role: f.role, maxCount: f.maxCount, rangeModifier: s.rangeMod, sort: f.sort, limit: 30 });
      if (!rows.length) {
        const best = pool.filter((a) => f.role !== 'relay' || a.type === 'relay').reduce((m, a) => (a.power > (m ? m.power : 0) ? a : m), null);
        out.push(h('p', { class: 'bad', text: 'No combination of up to ' + f.maxCount + ' copies reaches ' + f.target + '%.' }));
        if (best) {
          const p = Core.combine([{ power: best.power, exp: best.exp, count: f.maxCount }]).power * s.rangeMod;
          out.push(h('p', { class: 'hint', text: 'Best single-type stack: ' + f.maxCount + '× ' + best.name + ' gives ' + Core.formatPercent(Core.signalStrength(d, Core.linkRange(p, farPower))) + '. Try a stronger relay at the far end, more copies, or a shorter hop.' }));
        }
      } else {
        out.push(h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { text: 'Setup' }), h('th', { class: 'num', text: 'Signal' }), h('th', { class: 'num', text: 'Mass' }), h('th', { class: 'num', text: 'Cost' }), h('th', { text: 'Tech' }), h('th'))),
          h('tbody', {}, rows.map((r) => h('tr', {},
            h('td', {}, r.setup.map((c, i) => [i ? ' + ' : '', c.count + '× ' + c.name])),
            h('td', { class: 'num', style: 'font-weight:700;color:' + sigInk(r.signal) }, Core.formatPercent(r.signal)),
            h('td', { class: 'num', text: fmtMass(r.mass) }),
            h('td', { class: 'num', text: fmtInt(r.cost) }),
            h('td', { text: Array.from(new Set(r.setup.map((c) => techName(c.antenna.tech)))).join(', ') }),
            h('td', {}, h('button', {
              class: 'btn small', type: 'button', title: 'Put this on the last vessel of the chain',
              onclick: () => {
                state.chain.vessels[state.chain.vessels.length - 1].antennas = r.setup.map((c) => ({ id: c.id, count: c.count }));
                saveState();
                delete instances.chain;
                $('#tab-chain').replaceChildren();
                activate('chain');
              },
            }, 'Use'))))))));
        out.push(h('p', { class: 'hint', style: 'margin-top:8px', text: 'Only minimal setups are listed: removing any antenna would drop below the target. Mass is in tonnes, cost in funds. Assumes every antenna is deployed.' }));
      }
      right.replaceChildren(...out);
    }
    return { update: update };
  }

  /* ================= Tab: reach map ================= */

  function buildReach(root) {
    const r = state.reach;
    let los = null; // line-of-sight survey: { rev, data: Map(body -> {mean, worst, best}) }
    let losBusy = false;
    const left = h('div', { class: 'card' });
    const right = h('div', { class: 'card', 'aria-live': 'polite' });
    root.append(h('div', { class: 'two-col' }, left, right));

    const from = bodySelect(r.from, (v) => { r.from = v; commit(); });
    const far = farEndControls(r, commit);
    const role = h('select', { 'aria-label': 'Role of your vessel' },
      h('option', { value: 'own', text: 'Its own connection (all antennas)' }),
      h('option', { value: 'relay', text: 'As a relay (relay antennas only)' }));
    role.value = r.role;
    role.addEventListener('change', () => { r.role = role.value; commit(); });
    const mode = h('select', { 'aria-label': 'Columns' },
      h('option', { value: 'distance', text: 'Closest / midpoint / farthest distance' }),
      h('option', { value: 'dsn', text: 'DSN level 1 / 2 / 3 (needs DSN far end)' }));
    mode.value = r.mode;
    const at = h('select', { 'aria-label': 'Distance used for DSN columns' },
      h('option', { value: 'min', text: 'at closest distance' }), h('option', { value: 'mid', text: 'at midpoint' }), h('option', { value: 'max', text: 'at farthest distance' }));
    at.value = r.at;
    mode.addEventListener('change', () => { r.mode = mode.value; at.hidden = r.mode !== 'dsn'; commit(); });
    at.addEventListener('change', () => { r.at = at.value; commit(); });
    at.hidden = r.mode !== 'dsn';

    left.append(
      h('h2', { text: 'Which bodies can I reach?' }),
      h('p', { class: 'hint', text: 'Pick a vessel design and see the signal at every body, from best to worst case.' }),
      h('div', { class: 'field' }, h('label', { text: 'Your vessel’s antennas' }), antennaEditor(r.vessel.antennas, commit)),
      h('div', { class: 'field', style: 'margin-top:10px' }, h('label', { text: 'Used as' }), role),
      h('div', { class: 'field', style: 'margin-top:10px' }, h('label', { text: 'Other end located at' }), from),
      h('div', { class: 'field', style: 'margin-top:10px' }, h('label', { text: 'Other end is' }), far.el),
      h('div', { class: 'field', style: 'margin-top:10px' }, h('label', { text: 'Columns' }), mode, at));

    function update() {
      const s = state.settings;
      const st = Core.vesselStats(r.vessel.antennas, lookup, s.rangeMod);
      const mine = r.role === 'relay' ? st.relay : st.own;
      const farP = far.power();
      const out = [h('h2', { text: 'Signal by body' })];
      if (!(mine > 0)) { out.push(h('p', { class: 'bad', text: 'This vessel has no ' + (r.role === 'relay' ? 'relay ' : '') + 'antenna power.' })); right.replaceChildren(...out); return; }
      if (!(farP > 0)) { out.push(h('p', { class: 'hint', text: 'Set the other end’s power.' })); right.replaceChildren(...out); return; }
      const dsnMode = r.mode === 'dsn' && r.farKind === 'dsn';
      out.push(h('p', { class: 'hint', text: 'Your power ' + Core.formatPower(mine) + ' · other end ' + (dsnMode ? 'DSN levels 1–3' : Core.formatPower(farP)) + (r.farKind === 'dsn' && r.from !== 'Kerbin' ? ' (the DSN is on Kerbin, so pick a relay vessel for other bodies)' : '') }));
      const heads = dsnMode
        ? Data.DSN_LEVELS.map((l) => 'DSN ' + l.level + ' (' + Core.formatPower(l.power * s.dsnMod) + ')')
        : ['Closest', 'Midpoint', 'Farthest'];
      const rows = [];
      const losData = los && los.rev === revision ? los.data : null;
      for (const b of enabledBodies()) {
        if (b.id === r.from) continue;
        const d = world.distanceRange(r.from, b.id);
        if (!d) continue;
        const cells = dsnMode
          ? Data.DSN_LEVELS.map((l) => Core.signalStrength(d[r.at], Core.linkRange(mine, l.power * s.dsnMod)))
          : [d.min, d.mid, d.max].map((x) => Core.signalStrength(x, Core.linkRange(mine, farP)));
        rows.push(h('tr', { class: b.parent ? 'moon' : '' },
          h('td', { text: b.name }),
          h('td', { class: 'num', text: dsnMode ? Core.formatDistance(d[r.at]) : Core.formatDistance(d.min) + ' – ' + Core.formatDistance(d.max) }),
          cells.map((x) => h('td', { class: 'cell', style: 'background:' + sigColor(x), text: Core.formatPercent(x) })),
          losData ? losCells(losData.get(b.id)) : null));
      }
      out.push(h('div', { class: 'scroll' }, h('table', { class: 'heat' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Body' }), h('th', { class: 'num', text: dsnMode ? 'Distance' : 'Distance range' }), heads.map((x) => h('th', { class: 'num', text: x })), losData ? [h('th', { class: 'num', text: 'Landed: average uptime' }), h('th', { class: 'num', text: 'Worst site' })] : null)),
        h('tbody', {}, rows))));
      out.push(h('div', { class: 'legend', style: 'margin-top:10px' }, [0, 0.25, 0.5, 0.75, 1].map((x) => h('span', {}, h('i', { style: 'background:' + sigColor(x) }), Math.round(x * 100) + '%')), h('span', { text: '· distances are the game’s 10,000-year extremes' })));
      out.push(losControls(mine, dsnMode));
      right.replaceChildren(...out);
    }

    function losCells(d) {
      if (!d) return [h('td', { class: 'cell', colspan: 2, text: 'no surface' })];
      return [d.mean, d.worst].map((x) => h('td', { class: 'cell', style: 'background:' + sigColor(x), text: Core.formatPercent(x) }));
    }

    /** Optional extra: simulate real line of sight (bodies in the way, Kerbin’s rotation, orbits) over a year. */
    function losControls(mine, dsnMode) {
      const box = h('div', { class: 'hint', style: 'margin-top:12px' });
      if (r.farKind !== 'dsn' || r.from !== 'Kerbin') {
        box.append('Line-of-sight check: choose the DSN on Kerbin as the other end to unlock it. The columns above only look at range, not at bodies in the way.');
        return box;
      }
      const btn = h('button', { class: 'btn', type: 'button' }, losBusy ? 'Computing…' : (los && los.rev === revision ? 'Recompute line of sight' : 'Add line-of-sight check'));
      btn.disabled = losBusy;
      btn.addEventListener('click', () => {
        losBusy = true; btn.disabled = true;
        const myRev = revision;
        const gen = Pl.reachGen({
          world: world, lookup: lookup, settings: simSettings(), power: mine, t0: 0, horizon: Data.YEAR, minSignal: 0.05,
        }, enabledBodies().filter((b) => b.id !== r.from).map((b) => b.id));
        (function tick() {
          const stop = Date.now() + 30;
          let st;
          do { st = gen.next(); } while (!st.done && Date.now() < stop);
          if (!st.done) { btn.textContent = 'Computing… ' + Math.round(st.value * 100) + '%'; setTimeout(tick, 0); return; }
          losBusy = false;
          los = { rev: myRev, data: new Map(st.value.map((x) => [x.body, x])) };
          if (myRev === revision) update();
        })();
      });
      box.append(btn, ' ', dsnMode ? 'Uses the Kerbin DSN at the Tracking Station level you set; ' : '',
        'lands a vessel with these antennas at 8 spread-out sites per body and simulates a year of the real geometry (Kerbin’s rotation, planets and moons blocking the view). Needs a ground station in sight, so a single station caps every value near 50–70%.');
      return box;
    }
    return { update: update };
  }

  /* ================= Tab: antennas & mods ================= */

  function buildAntennas(root) {
    const filter = { q: '', type: 'all' };
    const packsBox = h('div', { class: 'packs' });
    const table = h('div', { class: 'scroll' });
    const q = h('input', { type: 'text', placeholder: 'Search antennas…', 'aria-label': 'Search antennas' });
    const type = h('select', { 'aria-label': 'Filter by type' }, h('option', { value: 'all', text: 'All types' }), h('option', { value: 'direct', text: 'Direct' }), h('option', { value: 'relay', text: 'Relay' }));

    function renderPacks() {
      packsBox.replaceChildren();
      for (const p of packList()) {
        const cb = h('input', { type: 'checkbox', checked: packOn(p.id) });
        cb.addEventListener('change', () => { state.settings.packs[p.id] = cb.checked; rebuildAll(); buildSettings(); });
        const n = ANT.filter((a) => a.pack === p.id).length;
        packsBox.append(h('label', {}, cb, p.name + ' (' + n + ')' + (p.verified === false ? ' *' : '')));
      }
    }
    function renderTable() {
      const term = filter.q.trim().toLowerCase();
      const order = packList().map((p) => p.id);
      const list = ANT.filter((a) => (filter.type === 'all' || a.type === filter.type) && (!term || (a.name + ' ' + a.parts.join(' ')).toLowerCase().indexOf(term) >= 0))
        .sort((a, b) => order.indexOf(a.pack) - order.indexOf(b.pack) || a.power - b.power);
      table.replaceChildren(h('table', {},
        h('thead', {}, h('tr', {}, ['Antenna', 'Type', 'Power', 'Exp.', 'Mass', 'Cost', 'EC/Mit', 'Tech', ''].map((x, i) => h('th', { class: i >= 2 && i <= 6 ? 'num' : '', text: x })))),
        h('tbody', {}, list.map((a) => {
          const pk = packList().find((p) => p.id === a.pack);
          const mit = a.pktSize > 0 ? (a.pktEC / a.pktSize).toFixed(1) : '–';
          return h('tr', { class: packOn(a.pack) ? '' : 'off' },
            h('td', {}, a.name, h('br'), h('small', { class: 'hint', text: (pk ? pk.name : a.pack) + (a.ground ? ' · ground station only' : '') + (a.builtin ? ' · built into a part' : '') })),
            h('td', {}, h('span', { class: 'tag-pill ' + a.type, text: a.type })),
            h('td', { class: 'num', text: Core.formatPower(a.power) }),
            h('td', { class: 'num', text: a.combinable ? String(a.exp) : 'no stack' }),
            h('td', { class: 'num', text: a.builtin ? '–' : fmtMass(a.mass) }),
            h('td', { class: 'num', text: a.builtin ? '–' : fmtInt(a.cost) }),
            h('td', { class: 'num', text: mit }),
            h('td', { text: techName(a.tech) }),
            h('td', {}, state.custom.antennas.indexOf(a) >= 0 ? h('button', {
              class: 'btn small ghost danger', type: 'button', 'aria-label': 'Delete ' + a.name,
              onclick: () => {
                state.custom.antennas = state.custom.antennas.filter((x) => x !== a);
                state.custom.packs = state.custom.packs.filter((p) => state.custom.antennas.some((x) => x.pack === p.id));
                rebuildAll();
                buildSettings();
              },
            }, 'Delete') : null));
        }))));
    }
    q.addEventListener('input', () => { filter.q = q.value; renderTable(); });
    type.addEventListener('change', () => { filter.type = type.value; renderTable(); });

    /* --- add custom antenna --- */
    const cn = h('input', { type: 'text', placeholder: 'Name', 'aria-label': 'Name' });
    const ct = h('select', { 'aria-label': 'Type' }, h('option', { value: 'direct', text: 'Direct' }), h('option', { value: 'relay', text: 'Relay' }));
    const cp = h('input', { type: 'text', placeholder: 'Power, e.g. 15G', 'aria-label': 'Power', style: 'width:9em' });
    const ce = h('input', { type: 'number', min: 0, max: 1, step: 0.05, value: 0.75, 'aria-label': 'Combinability exponent', title: '0 = does not stack, 0.75 = default' });
    const cm = h('input', { type: 'number', min: 0, step: 0.001, value: 0.1, 'aria-label': 'Mass (t)' });
    const cc = h('input', { type: 'number', min: 0, step: 10, value: 1000, 'aria-label': 'Cost' });
    const cmsg = h('small', { class: 'hint' });
    const addCustom = h('button', {
      class: 'btn primary', type: 'button',
      onclick: () => {
        const power = Core.parsePower(cp.value);
        if (!cn.value.trim() || !(power > 0)) { cmsg.className = 'bad'; cmsg.textContent = 'Give it a name and a power like 15G.'; return; }
        addAntennas('custom', 'My antennas', [{
          partName: 'custom-' + slug(cn.value) + '-' + Date.now().toString(36), name: cn.value.trim(), type: ct.value, power: power,
          combinable: parseFloat(ce.value) > 0, exp: parseFloat(ce.value) || 0, mass: parseFloat(cm.value) || 0, cost: parseFloat(cc.value) || 0,
          tech: '', pktSize: 0, pktInterval: 0, pktEC: 0, ground: false,
        }]);
      },
    }, 'Add antenna');

    /* --- import cfg --- */
    const impName = h('input', { type: 'text', value: 'Imported mod', 'aria-label': 'Pack name', style: 'width:14em' });
    const impFiles = h('input', { type: 'file', accept: '.cfg,.txt', multiple: true, 'aria-label': 'Part cfg files' });
    const impText = h('textarea', { placeholder: 'Or paste part .cfg text here…', 'aria-label': 'Pasted cfg text' });
    const impOut = h('div', { class: 'hint', style: 'margin-top:8px' });
    let parsed = [];
    function showParsed() {
      impOut.replaceChildren();
      if (!parsed.length) { impOut.textContent = 'No transmitting antennas found.'; return; }
      impOut.append(h('p', { style: 'color:var(--text)', text: 'Found ' + parsed.length + ' antenna(s): ' + parsed.map((a) => a.name + ' (' + Core.formatPower(a.power) + ')').join(', ') }),
        h('button', { class: 'btn primary', type: 'button', onclick: () => addAntennas('imp-' + slug(impName.value), impName.value.trim() || 'Imported mod', parsed) }, 'Add ' + parsed.length + ' to the calculator'));
    }
    const readBtn = h('button', {
      class: 'btn', type: 'button',
      onclick: async () => {
        const texts = [impText.value];
        for (const file of Array.from(impFiles.files || [])) texts.push(await file.text());
        parsed = [];
        for (const t of texts) if (t.trim()) parsed = parsed.concat(Parsers.parseAntennaCfg(t));
        showParsed();
      },
    }, 'Read antennas');

    function addAntennas(packId, packName, list) {
      if (!state.custom.packs.some((p) => p.id === packId)) state.custom.packs.push({ id: packId, name: packName });
      for (const a of list) {
        const rec = Object.assign({ parts: [a.partName], pack: packId, id: packId + ':' + a.partName, builtin: false, verified: false }, a);
        rec.parts = [a.partName];
        state.custom.antennas = state.custom.antennas.filter((x) => x.id !== rec.id).concat([rec]);
      }
      state.settings.packs[packId] = true;
      rebuildAll();
      buildSettings();
    }


    /* --- import a planet pack (Kopernicus configs) --- */
    const ppName = h('input', { type: 'text', value: 'My planet pack', 'aria-label': 'Planet pack name', style: 'width:14em' });
    const ppFiles = h('input', { type: 'file', accept: '.cfg,.txt', multiple: true, 'aria-label': 'Kopernicus cfg files' });
    const ppText = h('textarea', { placeholder: 'Or paste Kopernicus body configs here…', 'aria-label': 'Pasted Kopernicus text' });
    const ppOut = h('div', { class: 'hint', style: 'margin-top:8px' });
    const ppList = h('div', { style: 'margin-top:10px' });
    let ppParsed = null;
    const stockBody = (id) => Data.bodies.find((b) => b.id === id) || null;
    function renderPackList() {
      const packs = state.custom.bodyPacks || [];
      ppList.replaceChildren(...packs.map((p, i) => {
        const cb = h('input', { type: 'checkbox', checked: p.on });
        cb.addEventListener('change', () => { p.on = cb.checked; rebuildWorld(); rebuildAll(); buildSettings(); });
        return h('div', { class: 'inline', style: 'display:flex;gap:10px;margin-top:4px' },
          h('label', { style: 'color:var(--text)' }, cb, ' ' + p.name + ' (' + p.bodies.length + ' bod' + (p.bodies.length === 1 ? 'y' : 'ies') + (p.patches && p.patches.length ? ', ' + p.patches.length + ' patch' + (p.patches.length === 1 ? '' : 'es') : '') + ')'),
          h('button', { class: 'btn small ghost danger', type: 'button', onclick: () => { state.custom.bodyPacks.splice(i, 1); rebuildWorld(); rebuildAll(); buildSettings(); } }, 'Remove'));
      }));
    }
    const ppRead = h('button', {
      class: 'btn', type: 'button',
      onclick: async () => {
        const texts = [ppText.value];
        for (const file of Array.from(ppFiles.files || [])) texts.push(await file.text());
        const res = { bodies: [], patches: [], warnings: [] };
        for (const t of texts) {
          if (!t.trim()) continue;
          const r = Parsers.parseKopernicus(t, stockBody);
          res.bodies = res.bodies.concat(r.bodies); res.patches = res.patches.concat(r.patches); res.warnings = res.warnings.concat(r.warnings);
        }
        ppParsed = res;
        ppOut.replaceChildren(...[
          h('p', { style: 'color:var(--text)', text: res.bodies.length ? 'Found ' + res.bodies.length + ' bod' + (res.bodies.length === 1 ? 'y' : 'ies') + ': ' + res.bodies.map((b) => b.name + ' (orbits ' + b.parent + ')').join(', ') + '.' : 'No complete bodies found.' }),
          res.patches.length ? h('p', { style: 'color:var(--text)', text: res.patches.length + ' patch' + (res.patches.length === 1 ? '' : 'es') + ' to existing bodies: ' + res.patches.map((x) => x.id).join(', ') + '.' }) : null,
          res.warnings.length ? h('ul', { class: 'notes' }, res.warnings.map((w) => h('li', { class: 'warn', text: w }))) : null,
          (res.bodies.length || res.patches.length) ? h('button', {
            class: 'btn primary', type: 'button',
            onclick: () => {
              const name = ppName.value.trim() || 'Planet pack';
              const packs = state.custom.bodyPacks || (state.custom.bodyPacks = []);
              const at = packs.findIndex((p) => p.name === name);
              const rec = { id: 'kop-' + slug(name), name: name, on: true, bodies: ppParsed.bodies, patches: ppParsed.patches };
              if (at >= 0) packs[at] = rec; else packs.push(rec);
              rebuildWorld(); rebuildAll(); buildSettings();
            },
          }, 'Add to the world') : null,
        ].filter(Boolean));
      },
    }, 'Read bodies');
    renderPackList();

    root.append(
      h('div', { class: 'card' },
        h('h2', { text: 'Antenna packs' }),
        h('p', { class: 'hint', text: 'Turn packs on to make them appear in every antenna picker. * = community data, may be out of date. Stock and Breaking Ground values were read from KSP ' + Data.GAME_VERSION + '.' }),
        packsBox),
      h('details', { class: 'card' },
        h('summary', { text: 'Add your own antenna' }),
        h('div', { class: 'row', style: 'margin-top:10px' },
          h('div', { class: 'field' }, h('label', { text: 'Name' }), cn),
          h('div', { class: 'field' }, h('label', { text: 'Type' }), ct),
          h('div', { class: 'field' }, h('label', { text: 'Power' }), cp),
          h('div', { class: 'field' }, h('label', { text: 'Exponent' }), ce),
          h('div', { class: 'field' }, h('label', { text: 'Mass (t)' }), cm),
          h('div', { class: 'field' }, h('label', { text: 'Cost' }), cc),
          addCustom),
        cmsg),
      h('details', { class: 'card' },
        h('summary', { text: 'Import a mod’s antennas from its .cfg files' }),
        h('p', { class: 'hint', style: 'margin-top:8px' }, 'Open the mod’s part folders in ', h('code', { text: 'GameData' }), ', select the antenna .cfg files (or paste one). Anything with a ', h('code', { text: 'ModuleDataTransmitter' }), ' is picked up: power, relay/direct, combinability, mass and cost.'),
        h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { text: 'Pack name' }), impName), h('div', { class: 'field' }, h('label', { text: 'Files' }), impFiles)),
        impText, h('div', { style: 'margin-top:8px' }, readBtn), impOut),
      h('details', { class: 'card' },
        h('summary', { text: 'Import a planet pack (Kopernicus configs)' }),
        h('p', { class: 'hint', style: 'margin-top:8px' }, 'Select the pack’s body .cfg files from ', h('code', { text: 'GameData/<pack>/…' }), ' (or paste one). Bodies with a complete ', h('code', { text: 'Properties' }), ' and ', h('code', { text: 'Orbit' }), ' are added to the distance pickers, the scenario and the simulation; ', h('code', { text: 'Template' }), ' inheritance and ', h('code', { text: '@Body[…]' }), ' patches are handled. Vessels in saves can only be imported for the stock bodies (their body index is unknown for added planets).'),
        h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { text: 'Pack name' }), ppName), h('div', { class: 'field' }, h('label', { text: 'Files' }), ppFiles)),
        ppText, h('div', { style: 'margin-top:8px' }, ppRead), ppOut, ppList),
      h('div', { class: 'card' },
        h('div', { class: 'row', style: 'margin-bottom:10px' }, q, type),
        table));
    renderPacks();
    renderTable();
    return { update: function () {} };
  }

  /* ================= Tab: help ================= */

  /** "Contact and support" card. Data comes from Data.SUPPORT (the README carries the same values; a test keeps them equal). */
  function supportCard() {
    const S = Data.SUPPORT;
    function copy(text, btn) {
      const done = function () { const old = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = old; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copy the address:', text); });
      else window.prompt('Copy the address:', text);
    }
    return h('div', { class: 'card', id: 'support' },
      h('h3', { text: 'Contact and support' }),
      h('p', {}, 'Bugs and ideas go in the repository’s issues. For anything private, and for every security problem, ',
        h('a', { href: S.contact, rel: 'noopener noreferrer', text: 'contact the maintainer over SimpleX' }), ' (no account needed).'),
      h('p', {}, 'This is free software made in spare time. If it is useful to you, you can support it, but you never have to: ',
        h('a', { href: S.kofi, rel: 'noopener noreferrer', text: 'Ko-fi (card / PayPal)' }), ' or crypto:'),
      h('div', { class: 'support-list' }, S.crypto.map(function (c) {
        const btn = h('button', { class: 'btn small', type: 'button', text: 'Copy', 'aria-label': 'Copy the ' + c.coin + ' address' });
        btn.addEventListener('click', function () { copy(c.address, btn); });
        return h('div', { class: 'support-row' },
          h('b', { text: c.coin + ' (' + c.symbol + ')' }), c.note ? h('span', { class: 'hint', text: ' ' + c.note }) : null,
          h('div', { class: 'support-addr' }, h('code', { text: c.address }), btn));
      })),
      h('p', { class: 'hint', text: 'Compare an address with the one in the official repository’s README before you send anything. Crypto transfers cannot be undone.' }));
  }

  function buildHelp(root) {
    root.append(h('div', { class: 'help' },
      h('div', { class: 'card' },
        h('h3', { text: 'How the numbers work' }),
        h('p', {}, 'Every antenna has a ', h('b', { text: 'power rating' }), ' (e.g. RA-15 = 15G = 15 billion). A vessel’s rating combines its antennas with diminishing returns, and two ends of a link reach as far as the geometric mean of their ratings:'),
        h('div', { class: 'formula' }, 'vessel power = strongest × (sum of powers ÷ strongest) ^ exponent', h('br'), 'range = √(power A × power B)', h('br'), 'x = 1 − distance ÷ range,  signal = 3x² − 2x³', h('br'), 'multi-hop signal = signal of hop 1 × signal of hop 2 × …'),
        h('ul', {},
          h('li', {}, 'The exponent is 0.75 for almost everything. The Communotron 16 uses 1.0; the 16-S doesn’t combine at all. Mixed vessels use a power-weighted average.'),
          h('li', {}, 'A vessel’s ', h('b', { text: 'own link' }), ' uses all its antennas. When it acts as a ', h('b', { text: 'relay' }), ' for another vessel, only its relay-type antennas count (RA-2/15/100, HG-5).'),
          h('li', {}, 'The DSN is rated 2G / 50G / 250G for Tracking Station levels 1 / 2 / 3.'),
          h('li', {}, 'Difficulty: ', h('i', { text: 'Range modifier' }), ' scales every vessel, ', h('i', { text: 'DSN modifier' }), ' scales the DSN. Presets are Normal ×1, Moderate ×0.8, Hard ×0.65.'),
          h('li', {}, 'The game connects directly to the DSN whenever a direct link exists, even if a relay path would be stronger.'))),
      h('div', { class: 'card' },
        h('h3', { text: 'Occlusion, orbits and the planner' }),
        h('p', {}, 'The Scenario, Tracker and Relay planner tabs simulate real orbits (two-body Kepler motion for every body and vessel, Kerbin’s rotation for the ground stations). Every body is a sphere of radius (body radius × occlusion modifier), using the atmosphere modifier for bodies with an atmosphere; a link is blocked when its straight line touches a sphere. Kerbol is included, which is what causes conjunction blackouts.'),
        h('ul', {},
          h('li', {}, 'With only the Kerbal Space Center as a DSN station, Kerbin’s own night side cuts a distant link for hours every day. The six extra ground stations (a difficulty option) fix that; the planner tells you what that alone would achieve.'),
          h('li', {}, 'The planner attributes every outage to the body that blocked it, fixes the cause (relay ring around that body, or solar relays 60° ahead/behind Kerbin for conjunctions), re-simulates, drops fixes made redundant by later ones, and stress-tests the result on every difficulty preset.'),
          h('li', {}, 'Solar relays in Kerbin’s orbit keep their position relative to Kerbin forever, so that fix does not expire; local rings are verified over the look-ahead period you choose.'))),
      h('div', { class: 'card' },
        h('h3', { text: 'Assumptions and limits' }),
        h('ul', {},
          h('li', {}, 'The occlusion test and the radius rule (body radius × the occlusion modifier, no atmosphere height) are ported from the game’s own code. Kerbol blocks signals like every other body (read from the game’s scene data: the Sun carries a CommNet body too), and signals take the path with the best product of link strengths (also read from the game’s code). The Kerbol switch in the game settings is only for what-if runs.'),
          h('li', {}, 'Orbits are two-body, as in the game (stock KSP has no perturbations). Tick “Follow patched conics” on a vessel to carry it out of a sphere of influence (escape trajectories, transfers); without it a vessel stays on one orbit about its body. Add burns to a vessel to plan a transfer (the Launch windows tab finds when). Plasma blackout only affects vessels re-entering an atmosphere, so the orbit simulation ignores it; the Reentry tab covers landings with the game’s own rules. Mark an antenna as not extended to leave it out, and pick a Near Future reflector for the antennas that point at one.'),
          h('li', {}, 'The Antenna finder and the Link & relay chain are range calculators. Under the distance picker they also say how often the line between the two bodies is blocked; a vessel behind its own planet is only shown in the Tracker.'),
          h('li', {}, 'Which side of a tidally locked moon faces its parent, and where the Making History launch-site stations sit, come from the game’s own data files. Bodies from planet packs that don’t state a starting rotation use an approximation.'),
          h('li', {}, 'The distance pickers give the closest and farthest separations two bodies ever reach, a worst/best case rather than today’s distance.'))),
      h('div', { class: 'card' },
        h('h3', { text: 'Tips' }),
        h('ul', {},
          h('li', {}, 'Type distances with units: 35 Gm, 12000 km, 700 Mm, 1.5e10.'),
          h('li', {}, 'The Network tab shows who can reach whom over time and which relay everything depends on; the Reentry tab shows where a landing loses signal to plasma; Launch windows finds when to leave for another planet. The Career tab plans money, research, milestones and facility upgrades from your save; the Missions tab checks a rocket (import its .craft file) against a route; the Landing tab finds landing sites by tilt, latitude, height and biome and lists the science to do there.'),
          h('li', {}, 'The tracker moves by dragging and zooms by scrolling or pinching; on a keyboard use + − 0 and W A S D.'),
          h('li', {}, 'A “Find antennas” button appears beside any weak hop; it opens the finder with that hop filled in.'),
          h('li', {}, 'Load your persistent.sfs to copy your real difficulty, Tracking Station level, and (on the Scenario tab) your actual vessels with their orbits and antennas.'),
          h('li', {}, 'Using a mod that isn’t listed? Import its part .cfg files on the Antennas tab.'))),
      h('div', { class: 'card' },
        h('h3', { text: 'Sources and credits' }),
        h('ul', {},
          h('li', {}, 'Inspired by Poodmund’s “CommNet Signal Strength Calculator & Antenna Selector” spreadsheet, which showed how useful a CommNet calculator is. No data was copied from it: antenna values come from the games’ and mods’ own part configs, and body distances are computed from the orbits.'),
          h('li', {}, 'Formulas, DSN levels and the difficulty table: KSP Wiki “CommNet” page.'),
          h('li', {}, 'Stock and Breaking Ground antennas: KSP ' + Data.GAME_VERSION + ' part configs. Mod antennas: the mods’ current GitHub part configs (ReStock+, Near Future Exploration, CommNet Antennas Extension, DMagic Orbital Science, JX2Antenna, ProbesPlus), checked by script 2026-11-21.'),
          h('li', {}, 'Bodies: KSP Wiki infoboxes; Outer Planets Mod configs (Poodmund/Outer-Planets-Mod). Ground stations: KSP Wiki “List of bases on Kerbin”.'),
          h('li', {}, 'Licensed AGPL-3.0-or-later. The source is available from the link in the page footer.'))),
      supportCard()));
    return { update: function () {} };
  }

  /* ================= tabs ================= */

  const TABS = [
    { id: 'chain', label: 'Link & relay chain', build: buildChain },
    { id: 'finder', label: 'Antenna finder', build: buildFinder },
    { id: 'reach', label: 'Reach map', build: buildReach },
    { id: 'antennas', label: 'Antennas & mods', build: buildAntennas },
    { id: 'help', label: 'How it works', build: buildHelp },
  ];

  /** Other modules add their tabs here, before `start()`. `before` is the id of the tab to insert in front of. */
  function registerTab(id, label, build, before) {
    const tab = { id: id, label: label, build: build };
    const at = before ? TABS.findIndex((t) => t.id === before) : -1;
    if (at >= 0) TABS.splice(at, 0, tab); else TABS.push(tab);
  }

  function activate(id) {
    if (!TABS.some((t) => t.id === id)) id = 'chain';
    const prev = instances[state.ui.tab];
    if (prev && state.ui.tab !== id && prev.hide) prev.hide();
    state.ui.tab = id;
    saveState();
    for (const t of TABS) {
      const btn = $('#tabbtn-' + t.id);
      const panel = $('#tab-' + t.id);
      const on = t.id === id;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    }
    if (!instances[id]) instances[id] = TABS.find((t) => t.id === id).build($('#tab-' + id));
    if (instances[id].update) instances[id].update();
  }

  function buildTabs() {
    const nav = $('#tabs');
    nav.replaceChildren();
    for (const t of TABS) {
      if (!$('#tab-' + t.id)) $('#main').append(h('section', { id: 'tab-' + t.id, class: 'panel', role: 'tabpanel', hidden: true }));
    }
    TABS.forEach((t, i) => {
      const btn = h('button', { class: 'tab', role: 'tab', id: 'tabbtn-' + t.id, 'aria-controls': 'tab-' + t.id, type: 'button', onclick: () => activate(t.id) }, t.label);
      btn.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        activate(next.id);
        $('#tabbtn-' + next.id).focus();
      });
      nav.append(btn);
    });
  }

  /* ================= init ================= */

  function init() {
    $('#gv').textContent = Data.GAME_VERSION;
    $('#app-version').textContent = 'v' + Data.APP_VERSION;
    $('#reset').addEventListener('click', () => {
      if (!window.confirm('Reset all settings, chains and custom antennas?')) return;
      try { window.localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
      state = defaultState();
      rebuildIndex();
      rebuildWorld();
      buildSettings();
      rebuildAll();
    });
    const src = $('#source-link');
    if (src && SOURCE_URL) { src.href = SOURCE_URL; src.textContent = SOURCE_URL.replace(/^https?:\/\//, ''); }
    rebuildIndex();
    buildSettings();
    buildTabs();
    activate(state.ui.tab);
  }

  /* ================= shared API for the other UI modules ================= */

  window.KSPApp = {
    h: h, $: $, sigColor: sigColor, sigInk: sigInk, fmtMass: fmtMass, fmtInt: fmtInt, techName: techName,
    get state() { return state; },
    get world() { return world; },
    lookup: lookup,
    rev: () => revision,
    enabledAntennas: () => ANT.filter((a) => packOn(a.pack)),
    packOn: packOn,
    commit: commit,
    saveState: saveState,
    rebuildAll: rebuildAll,
    buildSettings: buildSettings,
    activate: activate,
    registerTab: registerTab,
    antennaEditor: antennaEditor,
    bodySelect: bodySelect,
    meter: meter,
    simSettings: simSettings,
    start: init,
  };
})();
