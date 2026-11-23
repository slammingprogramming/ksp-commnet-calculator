// SPDX-License-Identifier: AGPL-3.0-or-later
/* Launch windows tab: when to leave for another planet (or moon), and what it costs. Uses js/transfer.js. */
(function () {
  'use strict';

  const App = window.KSPApp;
  const Data = window.KSPData;
  const Core = window.KSPCore;
  const Orb = window.KSPOrbits;
  const Tr = window.KSPTransfer;
  const h = App.h;

  function build(root) {
    const st = App.state;
    const tf = st.transfer;
    const out = h('div', {});
    const siblings = (id) => { const b = App.world.index.get(id); return b && b.parentBody ? App.world.bodies.filter((x) => x.parentBody === b.parentBody && x !== b) : []; };
    const fromSel = App.bodySelect(tf.from, (v) => { tf.from = v; App.saveState(); fillTo(); }, {});
    const toSel = h('select', { 'aria-label': 'Destination' });
    function fillTo() {
      const list = siblings(tf.from);
      toSel.replaceChildren(...list.map((b) => h('option', { value: b.id, text: b.name })));
      if (!list.some((b) => b.id === tf.to)) tf.to = list.length ? list[0].id : '';
      toSel.value = tf.to;
    }
    toSel.addEventListener('change', () => { tf.to = toSel.value; App.saveState(); });
    const dist = (label, key, hint) => {
      const i = h('input', { type: 'text', value: tf[key], size: 10, spellcheck: 'false', 'aria-label': label, placeholder: hint });
      i.addEventListener('input', () => { tf[key] = i.value; App.saveState(); });
      return i;
    };
    const parkIn = dist('Parking orbit altitude', 'park', '100 km'), capIn = dist('Capture orbit altitude', 'capture', 'blank = fly-by');
    const yearsSel = h('select', { 'aria-label': 'Search length' }, [1, 2, 4, 8].map((y) => h('option', { value: String(y), text: y + (y === 1 ? ' year' : ' years') })));
    yearsSel.value = String(tf.years);
    yearsSel.addEventListener('change', () => { tf.years = parseFloat(yearsSel.value); App.saveState(); });
    const go = h('button', { class: 'btn primary', type: 'button' }, 'Find launch windows');
    go.addEventListener('click', () => {
      const park = Core.parseDistance(tf.park), cap = String(tf.capture).trim() ? Core.parseDistance(tf.capture) : null;
      if (!tf.to) { out.replaceChildren(h('p', { class: 'bad', text: 'Pick a body that shares a parent with the departure body (planet to planet, or moon to moon).' })); return; }
      if (!(park > 0) || (cap !== null && !(cap > 0))) { out.replaceChildren(h('p', { class: 'bad', text: 'Enter altitudes such as 100 km.' })); return; }
      out.replaceChildren(h('p', { class: 'hint', text: 'Searching…' }));
      setTimeout(() => {
        const r = Tr.windows(App.world, tf.from, tf.to, st.scenario.ut, tf.years * Data.YEAR, { parkAlt: park, captureAlt: cap });
        if (!r || !r.windows.length) { out.replaceChildren(h('p', { class: 'hint', text: 'No transfer found in that period. Try a longer search.' })); return; }
        const best = r.windows.reduce((m, w) => (w.total < m.total ? w : m), r.windows[0]);
        const day = Data.DAY;
        out.replaceChildren(
          h('div', { class: 'scroll' }, h('table', {},
            h('thead', {}, h('tr', {}, ['Leave', 'Arrive', 'Flight', 'Leaving burn', 'Arrival burn', 'Total'].map((t, i) => h('th', { class: i > 1 ? 'num' : '', text: t })))),
            h('tbody', {}, r.windows.map((w) => h('tr', { class: w === best ? 'best' : '' },
              h('td', { text: Orb.formatUT(w.depart) }), h('td', { text: Orb.formatUT(w.arrive) }),
              h('td', { class: 'num', text: (w.tof / day).toFixed(0) + ' days' }),
              h('td', { class: 'num', text: w.dvDepart.toFixed(0) + ' m/s' }),
              h('td', { class: 'num', text: cap === null ? 'fly-by' : w.dvArrive.toFixed(0) + ' m/s' }),
              h('td', { class: 'num', text: w.total.toFixed(0) + ' m/s' })))))),
          h('p', { class: 'hint', text: 'Windows repeat about every ' + (r.synodic / day).toFixed(0) + ' days (the synodic period). The cheapest in this search is highlighted. Each row is the best of its window: a two-body, impulsive estimate with circular parking and capture orbits, so add some margin for gravity losses and steering. “Leaving burn” is the speed to add from the parking orbit, at the right place, a few hours before the date shown.' }),
          h('p', { class: 'hint', text: 'To follow a relay out to its target, put it on its parking orbit in the Scenario tab, add a burn there and watch it with patched conics in the Tracker.' }));
      }, 20);
    });
    root.append(h('div', { class: 'card' },
      h('h2', { text: 'Launch windows' }),
      h('p', { class: 'hint', text: 'When to leave to reach another planet (or moon), and how much speed it takes, so relays and probes reach their orbit when the network needs them. The search starts at the scenario time.' }),
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { text: 'From' }), fromSel), h('div', { class: 'field' }, h('label', { text: 'To' }), toSel),
        h('div', { class: 'field' }, h('label', { text: 'Parking orbit altitude' }), parkIn), h('div', { class: 'field' }, h('label', { text: 'Capture orbit altitude' }), capIn),
        h('div', { class: 'field' }, h('label', { text: 'Search' }), yearsSel)),
      h('div', { style: 'margin-top:10px' }, go)), out);
    // ---- encounter targeting: the one burn from a circular orbit that reaches a moon ----
    const enc = tf.enc || (tf.enc = { body: 'Kerbin', target: 'Mun', alt: '100 km', capture: '30 km', days: 2 });
    const encOut = h('div', {});
    const encTarget = h('select', { 'aria-label': 'Moon to reach' });
    const moonsOf = (id) => App.world.bodies.filter((x) => x.parentBody && x.parentBody.id === id);
    function fillEnc() {
      const list = moonsOf(enc.body);
      encTarget.replaceChildren(...list.map((b) => h('option', { value: b.id, text: b.name })));
      if (!list.some((b) => b.id === enc.target)) enc.target = list.length ? list[0].id : '';
      encTarget.value = enc.target;
    }
    encTarget.addEventListener('change', () => { enc.target = encTarget.value; App.saveState(); });
    const encBody = App.bodySelect(enc.body, (v) => { enc.body = v; App.saveState(); fillEnc(); }, {});
    const encField = (label, key, hint) => { const i = h('input', { type: 'text', value: enc[key], size: 9, spellcheck: 'false', 'aria-label': label, placeholder: hint }); i.addEventListener('input', () => { enc[key] = i.value; App.saveState(); }); return i; };
    const encGo = h('button', { class: 'btn', type: 'button' }, 'Find the burn');
    encGo.addEventListener('click', () => {
      const body = App.world.index.get(enc.body), alt = Core.parseDistance(enc.alt), cap = String(enc.capture).trim() ? Core.parseDistance(enc.capture) : null;
      if (!body || !enc.target || !(alt > 0) || (cap !== null && !(cap > 0))) { encOut.replaceChildren(h('p', { class: 'bad', text: 'Pick a body with moons and enter altitudes such as 100 km.' })); return; }
      const orbit = Orb.orbitFromAltitudes(body, alt, alt, 0, 0, 0, 0);
      const days = Math.max(0.25, Math.min(40, parseFloat(enc.days) || 2));
      const rows = Tr.targetBurn(App.world, enc.body, orbit, enc.target, st.scenario.ut, days * Data.DAY, { captureAlt: cap });
      if (!rows || !rows.length) { encOut.replaceChildren(h('p', { class: 'hint', text: 'No burn found in that search. Try more days.' })); return; }
      encOut.replaceChildren(
        h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Burn at', 'Prograde', 'Normal', 'Radial', 'Burn', 'Flight', 'Arrives at', 'Arrival speed', 'Capture burn'].map((t, i) => h('th', { class: i > 0 ? 'num' : '', text: t })))),
          h('tbody', {}, rows.map((r, i) => h('tr', { class: i === 0 ? 'best' : '' },
            h('td', { text: Orb.formatUT(r.t) }), h('td', { class: 'num', text: r.prograde.toFixed(0) + ' m/s' }), h('td', { class: 'num', text: r.normal.toFixed(0) + ' m/s' }), h('td', { class: 'num', text: r.radial.toFixed(0) + ' m/s' }),
            h('td', { class: 'num', text: r.dv.toFixed(0) + ' m/s' }), h('td', { class: 'num', text: Orb.formatDuration(r.flight) }), h('td', { text: Orb.formatUT(r.arrive) }),
            h('td', { class: 'num', text: r.vinfArrive.toFixed(0) + ' m/s' }), h('td', { class: 'num', text: cap === null ? 'fly-by' : r.captureDv.toFixed(0) + ' m/s' })))))),
        h('p', { class: 'hint', text: 'A single impulsive burn (a Lambert arc from your orbit to the centre of the moon at arrival), split into the manoeuvre node axes. Enter it in the Scenario tab as a burn at that time (prograde, normal, radial) and the Tracker shows the path with patched conics. It aims at the centre of the moon, so expect to trim the periapsis with a small correction; the circular parking orbit is assumed equatorial and in the moon’s direction of travel.' }));
    });
    root.append(h('div', { class: 'card' },
      h('h2', { text: 'Encounter burn' }),
      h('p', { class: 'hint', text: 'From a circular parking orbit, the burn that sends you to a moon of the same body: when to light it and how much prograde, normal and radial it needs.' }),
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { text: 'Orbiting' }), encBody), h('div', { class: 'field' }, h('label', { text: 'Parking orbit altitude' }), encField('Parking orbit altitude for the encounter burn', 'alt', '100 km')),
        h('div', { class: 'field' }, h('label', { text: 'Moon to reach' }), encTarget), h('div', { class: 'field' }, h('label', { text: 'Capture altitude' }), encField('Capture altitude at the moon', 'capture', 'blank = fly-by')),
        h('div', { class: 'field' }, h('label', { text: 'Search days' }), encField('Days to search for the burn', 'days', '2'))),
      h('div', { style: 'margin-top:10px' }, encGo)), encOut);
    fillTo(); fillEnc();
    return { update: function () {} };
  }

  App.registerTab('transfer', 'Launch windows', build, 'antennas');
})();
