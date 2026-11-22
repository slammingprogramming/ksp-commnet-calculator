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
    fillTo();
    return { update: function () {} };
  }

  App.registerTab('transfer', 'Launch windows', build, 'antennas');
})();
