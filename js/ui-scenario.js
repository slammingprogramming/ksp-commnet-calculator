// SPDX-License-Identifier: AGPL-3.0-or-later
/* Scenario tab: the assets (vessels, bases, relays) the tracker and planner work with. */
(function () {
  'use strict';

  const App = window.KSPApp;
  const Data = window.KSPData;
  const Core = window.KSPCore;
  const Orb = window.KSPOrbits;
  const Pl = window.KSPPlanner;
  const Share = window.KSPShare;
  const h = App.h;

  /* ---------- data model ---------- */

  const BODY_BY_REF = ['Kerbol', 'Kerbin', 'Mun', 'Minmus', 'Moho', 'Eve', 'Duna', 'Ike', 'Jool', 'Laythe', 'Vall', 'Bop', 'Tylo', 'Gilly', 'Pol', 'Dres', 'Eeloo'];

  function newId() {
    const sc = App.state.scenario;
    return 'n' + sc.nextId++;
  }

  function newNode(partial) {
    return Object.assign({
      id: newId(), name: 'Vessel', tracked: true,
      loc: { type: 'orbit', body: 'Kerbin', pe: 100000, ap: 100000, i: 0, lan: 0, w: 0, phase: 0 },
      antennas: [{ id: 'stock:RelayAntenna50', count: 1 }],
    }, partial);
  }

  /** Scenario node (UI shape) -> simulator node. Returns null if it can't be placed. */
  function toSimNode(n) {
    const w = App.world;
    const b = w.index.get(n.loc.body);
    if (!b) return null;
    if (n.loc.type === 'landed') {
      return { id: n.id, name: n.name, tracked: n.tracked, planned: n.planned, group: n.group, antennas: n.antennas, loc: { type: 'landed', body: b.id, lat: n.loc.lat, lon: n.loc.lon, alt: n.loc.alt || 0 } };
    }
    // An imported conic (escape trajectory, transfer) carries its elements; otherwise they come from altitudes.
    const orbit = n.loc.elements ? n.loc.elements : Orb.orbitFromAltitudes(b, n.loc.pe, n.loc.ap, n.loc.i, n.loc.lan, n.loc.w, n.loc.phase);
    return {
      id: n.id, name: n.name, tracked: n.tracked, planned: n.planned, group: n.group, antennas: n.antennas,
      loc: { type: 'orbit', body: b.id, orbit: orbit, patched: !!n.loc.patched },
    };
  }

  /** Sanity messages for one node. */
  function checkNode(n) {
    const msgs = [];
    const w = App.world;
    const b = w.index.get(n.loc.body);
    if (!b) return [{ level: 'bad', text: 'Body “' + n.loc.body + '” is not available (enable its system in the game settings).' }];
    if (n.loc.type === 'orbit' && n.loc.elements) {
      msgs.push({ level: 'hint', text: n.loc.patched ? 'Imported conic. With patched conics on, the vessel follows its sphere-of-influence exits and encounters (no further burns).' : 'Imported conic, drawn about ' + b.name + ' only: tick patched conics to follow it out of the sphere of influence.' });
    } else if (n.loc.type === 'orbit') {
      const lo = Math.min(n.loc.pe, n.loc.ap), hi = Math.max(n.loc.pe, n.loc.ap);
      if (lo < 0) msgs.push({ level: 'bad', text: 'Periapsis is below the surface.' });
      else if (b.hasAtmo && lo < b.atmo) msgs.push({ level: 'warn', text: 'Periapsis is inside the atmosphere (' + Core.formatDistance(b.atmo) + ' tall).' });
      if (b.radius + hi > b.soiRadius) msgs.push(n.loc.patched ? { level: 'hint', text: 'Apoapsis is outside ' + b.name + '\u2019s sphere of influence: the vessel is followed onto its next orbit (patched conics).' } : { level: 'bad', text: 'Apoapsis is outside the sphere of influence (' + Core.formatDistance(b.soiRadius - b.radius) + ' altitude). Tick patched conics to follow it out.' });
    } else if (b.approxSpin) {
      msgs.push({ level: 'warn', text: b.name + ' is tidally locked; its near/far side longitudes are approximate here.' });
    }
    if (!n.antennas.length) msgs.push({ level: 'hint', text: 'No antennas: only the 5k built-in antenna is assumed.' });
    return msgs;
  }

  function orbitSummary(n) {
    const b = App.world.index.get(n.loc.body);
    if (!b) return '';
    const o = n.loc.elements ? n.loc.elements : Orb.orbitFromAltitudes(b, n.loc.pe, n.loc.ap, n.loc.i, n.loc.lan, n.loc.w, n.loc.phase);
    if (!o.a) return '';
    const p = Orb.prepare(o, b.gm);
    if (o.e > 1) return 'escape trajectory · eccentricity ' + o.e.toFixed(3) + ' · periapsis altitude ' + Core.formatDistance(Math.abs(o.a) * (o.e - 1) - b.radius) + ' · excess speed ' + Math.round(Math.sqrt(b.gm / Math.abs(o.a))) + ' m/s';
    return 'period ' + Orb.formatDuration(p.period) + ' · eccentricity ' + o.e.toFixed(3) + ' · SMA ' + Core.formatDistance(o.a);
  }

  /* ---------- quick placements ---------- */

  function keoNode() {
    const k = App.world.index.get('Kerbin');
    const ksc = Data.STATIONS[0];
    const alt = Pl.keoAltitude(App.world);
    return { body: 'Kerbin', pe: alt, ap: alt, i: 0, lan: 0, w: 0, phase: (((k.rot0 || 0) + ksc.lon) % 360 + 360) % 360 };
  }

  const TEMPLATES = [
    ['Low Kerbin orbit (100 km)', () => ({ type: 'orbit', body: 'Kerbin', pe: 100000, ap: 100000, i: 0, lan: 0, w: 0, phase: 0 })],
    ['Keostationary orbit (parked over KSC)', () => Object.assign({ type: 'orbit' }, keoNode())],
    ['Munar orbit (100 km)', () => ({ type: 'orbit', body: 'Mun', pe: 100000, ap: 100000, i: 0, lan: 0, w: 0, phase: 0 })],
    ['Kerbin-like solar orbit, 60° ahead', () => solar(60)],
    ['Kerbin-like solar orbit, 60° behind', () => solar(-60)],
    ['Landed at KSC', () => ({ type: 'landed', body: 'Kerbin', lat: Data.STATIONS[0].lat, lon: Data.STATIONS[0].lon, alt: 0 })],
    ['Landed on the Mun, near side', () => ({ type: 'landed', body: 'Mun', lat: 0, lon: 47.436, alt: 0 })],
    ['Landed on the Mun, far side', () => ({ type: 'landed', body: 'Mun', lat: 0, lon: 227.436, alt: 0 })],
  ];
  function solar(offset) {
    const k = App.world.index.get('Kerbin');
    const a = k.orbit.a - App.world.root.radius;
    return { type: 'orbit', body: 'Kerbol', pe: a, ap: a, i: 0, lan: 0, w: 0, phase: ((k.orbit.m0 / Orb.DEG + offset) % 360 + 360) % 360 };
  }

  /* ---------- example scenarios ---------- */

  const EXAMPLES = [
    ['Duna orbiter (KSC only)', () => [
      newNode({ name: 'Duna orbiter', loc: { type: 'orbit', body: 'Duna', pe: 300000, ap: 300000, i: 0, lan: 0, w: 0, phase: 0 }, antennas: [{ id: 'stock:RelayAntenna100', count: 2 }] }),
    ]],
    ['Far-side Mun lander', () => [
      newNode({ name: 'Far-side lander', loc: { type: 'landed', body: 'Mun', lat: 10, lon: 227.436, alt: 0 }, antennas: [{ id: 'stock:HighGainAntenna', count: 1 }] }),
    ]],
    ['Laythe base + Jool relay', () => [
      newNode({ name: 'Laythe base', loc: { type: 'landed', body: 'Laythe', lat: 0, lon: 0, alt: 0 }, antennas: [{ id: 'stock:commDish', count: 1 }] }),
      newNode({ name: 'Jool relay', tracked: false, loc: { type: 'orbit', body: 'Jool', pe: 20000000, ap: 20000000, i: 0, lan: 0, w: 0, phase: 0 }, antennas: [{ id: 'stock:RelayAntenna100', count: 2 }] }),
    ]],
  ];

  /* ---------- import from a KSP save ---------- */

  /** Save vessel -> scenario node, or null if it has no usable position. */
  function fromSaveVessel(v, world) {
    const antennas = v.antennas.map((a) => ({ id: a.id, count: a.count }));
    const body = v.orbit ? BODY_BY_REF[v.orbit.ref] : null;
    const b = body ? world.index.get(body) : null;
    if (!b) return { error: v.orbit ? 'unknown body index ' + v.orbit.ref : 'no orbit data' };
    if (/LANDED|SPLASHED|PRELAUNCH/.test(v.sit) && isFinite(v.lat) && isFinite(v.lon)) {
      return { node: newNode({ name: v.name, antennas: antennas, loc: { type: 'landed', body: b.id, lat: v.lat, lon: v.lon, alt: Math.max(0, v.alt || 0) } }) };
    }
    const o = v.orbit;
    if (!isFinite(o.sma) || !isFinite(o.ecc) || o.sma === 0) return { error: 'no usable orbit' };
    if (o.ecc >= 1 || o.sma < 0) {
      // escape trajectory: keep the exact conic and follow it through sphere-of-influence changes
      const na = Math.sqrt(b.gm / Math.pow(Math.abs(o.sma), 3));
      return {
        node: newNode({
          name: v.name, antennas: antennas,
          loc: { type: 'orbit', body: b.id, patched: true, elements: { a: -Math.abs(o.sma), e: Math.max(1.000001, o.ecc), i: o.inc, lan: o.lan, w: o.lpe, m0: o.mna - na * o.eph, epoch: 0 } },
        }),
      };
    }
    const n = Math.sqrt(b.gm / (o.sma * o.sma * o.sma));
    const m0 = (((o.mna - n * o.eph) % Orb.TAU) + Orb.TAU) % Orb.TAU; // mean anomaly at UT 0
    const leaves = b.soiRadius < o.sma * (1 + o.ecc); // a transfer orbit that crosses the sphere-of-influence edge
    return {
      node: newNode({
        name: v.name, antennas: antennas,
        loc: { type: 'orbit', body: b.id, pe: o.sma * (1 - o.ecc) - b.radius, ap: o.sma * (1 + o.ecc) - b.radius, i: o.inc, lan: o.lan, w: o.lpe, phase: m0 / Orb.DEG, patched: leaves },
      }),
    };
  }

  /* ---------- tab ---------- */

  function build(root) {
    const sc = App.state.scenario;
    const listBox = h('div', { class: 'scn-list' });
    const head = h('div', { class: 'card' });
    root.append(head, listBox);

    function changed() { App.commit(); }
    function rerender() { App.saveState(); render(); App.commit(); }

    /* ---------- export / import / share link ---------- */

    const note = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
    const say = (t, bad) => { note.textContent = t; note.classList.toggle('bad', !!bad); };
    const settingsOf = () => Object.fromEntries(Object.keys(Share.SETTING_KEYS).map((k) => [k, App.state.settings[k]]));

    async function pack(obj) {
      const bytes = Share.utf8(JSON.stringify(obj));
      if (typeof CompressionStream === 'function') {
        try {
          const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
          return 'z.' + Share.toBase64Url(new Uint8Array(buf));
        } catch (e) { /* fall through to the plain form */ }
      }
      return 'j.' + Share.toBase64Url(bytes);
    }

    async function unpack(code) {
      const kind = code.slice(0, 2), bytes = Share.fromBase64Url(code.slice(2));
      if (!bytes || (kind !== 'z.' && kind !== 'j.')) throw new Error('The link is damaged.');
      if (kind === 'j.') return Share.unutf8(bytes);
      if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open compressed links.');
      const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const parts = [];
      let total = 0;
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        total += r.value.length;
        if (total > Share.MAX_TEXT_BYTES) { reader.cancel(); throw new Error('The link expands to something too large.'); }
        parts.push(r.value);
      }
      const all = new Uint8Array(total);
      let o = 0;
      parts.forEach((p) => { all.set(p, o); o += p.length; });
      return Share.unutf8(all);
    }

    /** Validate untrusted text, ask the user, then replace the scenario. */
    function adopt(textIn, origin) {
      const res = Share.parseScenario(textIn, (id) => !!App.lookup(id));
      if (res.error) { say(res.error, true); return; }
      const n = res.scenario.nodes.length;
      const msg = 'Replace your scenario with ' + n + ' vessel' + (n === 1 ? '' : 's') + ' from ' + origin + (res.settings ? ' and change your game settings to the ones it carries' : '') + '?';
      if (!window.confirm(msg)) { say('Import cancelled.'); return; }
      sc.nodes = res.scenario.nodes.map((x) => newNode(x));
      sc.ut = res.scenario.ut;
      if (res.settings) { Object.assign(App.state.settings, res.settings); App.buildSettings(); }
      App.saveState();
      App.rebuildAll();
      say('Loaded ' + n + ' vessel' + (n === 1 ? '' : 's') + '.' + (res.warnings.length ? ' ' + res.warnings.slice(0, 3).join(' ') : ''));
    }

    function exportFile() {
      const json = JSON.stringify(Share.exportScenario(sc, settingsOf(), Data.APP_VERSION), null, 1);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = h('a', { href: url, download: 'ksp-commnet-scenario.json' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      say('Saved ksp-commnet-scenario.json (vessels, antennas, time and game settings).');
    }

    const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-label': 'Scenario file to import' });
    fileIn.addEventListener('change', () => {
      const f = fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      if (f.size > Share.MAX_TEXT_BYTES) { say('That file is too large to be a scenario.', true); return; }
      f.text().then((t) => adopt(t, 'the file “' + f.name.slice(0, 40) + '”'), () => say('Could not read the file.', true));
    });

    async function shareLink() {
      try {
        const code = await pack(Share.exportScenario(sc, settingsOf(), Data.APP_VERSION));
        const link = location.origin + location.pathname + '#s=' + code;
        let copied = false;
        try { await navigator.clipboard.writeText(link); copied = true; } catch (e) { /* no clipboard permission */ }
        if (!copied) window.prompt('Copy this link:', link);
        say((copied ? 'Link copied. ' : '') + 'It holds the whole scenario (' + link.length.toLocaleString('en-US') + ' characters) and nothing is uploaded.' + (link.length > 8000 ? ' Very long: some chat apps cut links, so send the file instead.' : ''));
      } catch (e) { say('Could not build the link.', true); }
    }

    // A link like …#s=z.xxxx was opened: offer to load it (never silently).
    setTimeout(() => {
      const m = /^#s=([A-Za-z0-9._-]+)$/.exec(location.hash);
      if (!m) return;
      App.activate('scenario');
      unpack(m[1]).then((t) => { history.replaceState(null, '', location.pathname + location.search); adopt(t, 'the shared link'); }, (e) => say(e.message, true));
    }, 0);

    function numField(label, get, set, opts) {
      opts = opts || {};
      const input = h('input', { type: 'text', value: opts.fmt ? opts.fmt(get()) : String(get()), 'aria-label': label, size: 9, spellcheck: 'false' });
      input.addEventListener('input', () => {
        const v = opts.parse ? opts.parse(input.value) : parseFloat(input.value);
        if (isFinite(v)) { set(v); changed(); input.classList.remove('bad'); } else input.classList.add('bad');
      });
      return h('div', { class: 'field' }, h('label', { text: label }), input);
    }

    function nodeCard(n, idx) {
      const b = App.world.index.get(n.loc.body);
      const name = h('input', { type: 'text', value: n.name, maxlength: 40, 'aria-label': 'Name' });
      name.addEventListener('input', () => { n.name = name.value; changed(); });
      const tracked = h('input', { type: 'checkbox', checked: n.tracked });
      tracked.addEventListener('change', () => { n.tracked = tracked.checked; changed(); });
      const type = h('select', { 'aria-label': 'Location type' }, h('option', { value: 'orbit', text: 'In orbit' }), h('option', { value: 'landed', text: 'Landed / on a surface' }));
      type.value = n.loc.type;
      type.addEventListener('change', () => {
        if (type.value === 'landed') n.loc = { type: 'landed', body: n.loc.body === 'Kerbol' ? 'Kerbin' : n.loc.body, lat: 0, lon: 0, alt: 0 };
        else n.loc = { type: 'orbit', body: n.loc.body, pe: 100000, ap: 100000, i: 0, lan: 0, w: 0, phase: 0 };
        rerender();
      });
      const body = App.bodySelect(n.loc.body, (v) => { n.loc.body = v; rerender(); }, { withStar: n.loc.type === 'orbit' });
      const tpl = h('select', { 'aria-label': 'Quick placement' }, h('option', { value: '', text: 'Quick placement…' }));
      TEMPLATES.forEach((t, i) => tpl.append(h('option', { value: String(i), text: t[0] })));
      tpl.addEventListener('change', () => {
        const t = TEMPLATES[parseInt(tpl.value, 10)];
        if (!t) return;
        n.loc = t[1]();
        rerender();
      });

      const dist = { fmt: (v) => Core.formatDistance(v, 5), parse: Core.parseDistance };
      let fields;
      if (n.loc.type === 'orbit' && n.loc.elements) {
        fields = [h('div', { class: 'hint', text: 'Orbit imported from the save (exact conic elements). Remove and re-add to change it, or use the quick placements for a new one.' })];
      } else if (n.loc.type === 'orbit') {
        fields = [
          numField('Periapsis altitude', () => n.loc.pe, (v) => { n.loc.pe = v; }, dist),
          numField('Apoapsis altitude', () => n.loc.ap, (v) => { n.loc.ap = v; }, dist),
          numField('Inclination °', () => n.loc.i, (v) => { n.loc.i = v; }),
          numField('LAN °', () => n.loc.lan, (v) => { n.loc.lan = v; }),
          numField('Arg. of periapsis °', () => n.loc.w, (v) => { n.loc.w = v; }),
          numField('Phase at UT 0 °', () => n.loc.phase, (v) => { n.loc.phase = v; }),
        ];
      } else {
        fields = [
          numField('Latitude °', () => n.loc.lat, (v) => { n.loc.lat = v; }),
          numField('Longitude °', () => n.loc.lon, (v) => { n.loc.lon = v; }),
          numField('Altitude m', () => n.loc.alt || 0, (v) => { n.loc.alt = v; }),
        ];
      }
      const summary = h('div', { class: 'stats', text: n.loc.type === 'orbit' ? orbitSummary(n) : '' });
      const patched = n.loc.type === 'orbit' ? h('label', { class: 'inline', style: 'color:var(--text);display:flex;margin-top:6px', title: 'Follow the vessel when it leaves a body\u2019s sphere of influence or enters another (patched conics, no further burns)' },
        h('input', { type: 'checkbox', checked: !!n.loc.patched, onchange: (e) => { if (e.target.checked) n.loc.patched = true; else delete n.loc.patched; rerender(); } }), 'Follow patched conics (escape and encounter, no more burns)') : null;
      const msgs = checkNode(n).map((m) => h('div', { class: m.level === 'bad' ? 'bad' : m.level === 'warn' ? 'warn' : 'hint', style: 'font-size:0.85rem', text: m.text }));

      return h('div', { class: 'node ' + (n.planned ? 'relay' : n.tracked ? 'endpoint' : 'dsn') },
        h('div', { class: 'node-head' }, name,
          h('label', { class: 'inline', style: 'color:var(--text)', title: 'Track this node’s connection to the DSN' }, tracked, 'Track'),
          n.planned ? h('span', { class: 'tag', text: 'planned relay' }) : null,
          h('span', { style: 'margin-left:auto;display:inline-flex;gap:6px' },
            h('button', { class: 'btn small ghost', type: 'button', onclick: () => { const c = JSON.parse(JSON.stringify(n)); c.id = newId(); c.name = n.name + ' copy'; sc.nodes.splice(idx + 1, 0, c); rerender(); } }, 'Duplicate'),
            h('button', { class: 'btn small ghost danger', type: 'button', onclick: () => { sc.nodes.splice(idx, 1); rerender(); } }, 'Remove'))),
        h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { text: 'Location' }), type), h('div', { class: 'field' }, h('label', { text: n.loc.type === 'orbit' ? 'Orbits' : 'On' }), body), h('div', { class: 'field' }, h('label', { text: 'Or' }), tpl)),
        h('div', { class: 'row', style: 'margin-top:8px' }, fields),
        summary, patched, msgs.length ? h('div', {}, msgs) : null,
        h('div', { class: 'field', style: 'margin-top:8px' }, h('label', { text: 'Antennas' }), App.antennaEditor(n.antennas, changed)));
    }

    function render() {
      // header card
      const utIn = h('input', { type: 'text', value: Orb.formatUT(sc.ut), 'aria-label': 'Simulation time', size: 18, spellcheck: 'false' });
      utIn.addEventListener('change', () => {
        const v = Orb.parseUT(utIn.value);
        if (isFinite(v)) { sc.ut = v; App.saveState(); }
        utIn.value = Orb.formatUT(sc.ut);
        App.commit();
      });
      const exSel = h('select', { 'aria-label': 'Load an example' }, h('option', { value: '', text: 'Load an example…' }));
      EXAMPLES.forEach((e, i) => exSel.append(h('option', { value: String(i), text: e[0] })));
      exSel.addEventListener('change', () => {
        const e = EXAMPLES[parseInt(exSel.value, 10)];
        if (!e) return;
        if (sc.nodes.length && !window.confirm('Replace the current scenario?')) { exSel.value = ''; return; }
        sc.nodes = e[1]();
        rerender();
      });

      let saveRow = null;
      const info = App.state.saveInfo;
      if (info) {
        const sel = h('select', { 'aria-label': 'Add a vessel from the save' }, h('option', { value: '', text: 'Add a vessel from “' + info.title + '”…' }));
        info.vessels.forEach((v, i) => {
          if (!v.orbit) return;
          const res = fromSaveVessel(v, App.world);
          sel.append(h('option', { value: String(i), disabled: !!res.error, text: v.name + (v.type ? ' (' + v.type + ')' : '') + (v.antennas.length ? '' : ' · no antennas') + (res.error ? ' — ' + res.error : '') }));
        });
        sel.addEventListener('change', () => {
          const v = info.vessels[parseInt(sel.value, 10)];
          if (!v) return;
          const res = fromSaveVessel(v, App.world);
          if (res.node) { sc.nodes.push(res.node); rerender(); }
        });
        const all = h('button', {
          class: 'btn small', type: 'button', title: 'Add every vessel that has a relay or direct antenna',
          onclick: () => {
            let added = 0;
            info.vessels.forEach((v) => {
              if (!v.antennas.length || !v.orbit || /Debris|Flag|Object|Unknown/i.test(v.type)) return;
              const res = fromSaveVessel(v, App.world);
              if (res.node) { sc.nodes.push(res.node); added++; }
            });
            if (added) rerender();
          },
        }, 'Add all vessels with antennas');
        const useUT = info.ut ? h('button', { class: 'btn small', type: 'button', onclick: () => { sc.ut = info.ut; rerender(); } }, 'Use the save’s current time') : null;
        saveRow = h('div', { class: 'row', style: 'margin-top:10px' }, sel, all, useUT);
      }

      head.replaceChildren(...[
        h('h2', { text: 'Scenario' }),
        h('p', { class: 'hint', text: 'The vessels, bases and relays to track. Every orbit is followed through time; the tracker shows the links live and the planner designs relays for them. Home is the Kerbal Space Center (plus the extra ground stations if enabled).' }),
        h('div', { class: 'row' },
          h('div', { class: 'field' }, h('label', { text: 'Simulation time' }), utIn),
          h('button', { class: 'btn primary', type: 'button', onclick: () => { sc.nodes.push(newNode({ name: 'Vessel ' + (sc.nodes.length + 1) })); rerender(); } }, '＋ Add a vessel'),
          exSel,
          h('button', { class: 'btn small', type: 'button', title: 'Download the scenario as a file', onclick: exportFile }, 'Export file'),
          h('button', { class: 'btn small', type: 'button', title: 'Load a scenario file', onclick: () => fileIn.click() }, 'Import file'),
          sc.nodes.length ? h('button', { class: 'btn small', type: 'button', title: 'Copy a link that contains the whole scenario', onclick: shareLink }, 'Copy share link') : null,
          sc.nodes.length ? h('button', { class: 'btn ghost danger', type: 'button', onclick: () => { if (window.confirm('Remove all scenario nodes?')) { sc.nodes = []; rerender(); } } }, 'Clear') : null),
        saveRow, note, fileIn,
      ].filter(Boolean));

      listBox.replaceChildren(...(sc.nodes.length
        ? sc.nodes.map((n, i) => nodeCard(n, i))
        : [h('div', { class: 'card' }, h('p', { class: 'hint', text: 'No vessels yet. Add one, load an example, or import your fleet from a save (Load persistent.sfs in the game settings).' }))]));
    }

    render();
    return { update: function () {} };
  }

  /* ---------- shared simulation access (rebuilt whenever anything is edited) ---------- */

  const Sim = window.KSPSim;
  let cacheRev = -1, cacheSim = null;
  const simNodes = () => App.state.scenario.nodes.map(toSimNode).filter(Boolean);
  function getSim() {
    if (cacheRev !== App.rev() || !cacheSim) {
      cacheSim = Sim.createSim({ world: App.world, lookup: App.lookup, settings: App.simSettings(), nodes: simNodes(), trajectory: { t0: App.state.scenario.ut, horizon: 25 * Data.YEAR } });
      cacheRev = App.rev();
    }
    return cacheSim;
  }

  /** Human-readable explanation of an outage cause (see sim.js). */
  function describeCause(c) {
    if (!c) return '';
    if (c.type === 'range') return 'out of range';
    if (c.type === 'weak') return 'signal below the minimum';
    const names = c.bodies.map((id) => {
      if (id === 'Kerbol') return 'Kerbol (solar conjunction)';
      return id;
    });
    return 'blocked by ' + names.join(' + ');
  }

  /** One line for a blackout's causes: unique blockers merged, e.g. "blocked by Jool, Kerbin". */
  function describeCauses(causes) {
    const bodies = [], other = [];
    for (const c of causes) {
      if (c.type === 'occlusion') c.bodies.forEach((b) => { if (bodies.indexOf(b) < 0) bodies.push(b); });
      else if (other.indexOf(describeCause(c)) < 0) other.push(describeCause(c));
    }
    const parts = [];
    if (bodies.length) parts.push('blocked by ' + bodies.map((b) => (b === 'Kerbol' ? 'Kerbol (solar conjunction)' : b)).join(', '));
    return parts.concat(other).join('; ');
  }

  window.KSPScenario = { describeCauses: describeCauses, toSimNode: toSimNode, newNode: newNode, checkNode: checkNode, fromSaveVessel: fromSaveVessel, getSim: getSim, simNodes: simNodes, describeCause: describeCause };
  App.registerTab('scenario', 'Scenario', build, 'antennas');
})();
