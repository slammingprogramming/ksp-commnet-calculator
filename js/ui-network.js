// SPDX-License-Identifier: AGPL-3.0-or-later
/* Network tab: who can talk to whom, where the single points of failure are, and what the ground stations add. */
(function () {
  'use strict';

  const App = window.KSPApp;
  const Data = window.KSPData;
  const Core = window.KSPCore;
  const Orb = window.KSPOrbits;
  const Net = window.KSPNetwork;
  const Scn = window.KSPScenario;
  const h = App.h;

  const horizons = () => {
    const D = Data.DAY, Y = Data.YEAR;
    return [['1 month', 30 * D], ['3 months', Math.floor(Y / (4 * D)) * D], ['1 year', Y], ['2 years', 2 * Y], ['4 years', 4 * Y]];
  };
  let HORIZONS = horizons();
  const pct = (x) => (x * 100).toFixed(x > 0.99 && x < 1 ? 2 : 0) + '%';
  const KIND = { main: 'Kerbal Space Center', anomaly: 'extra ground station', permanent: 'Making History launch site' };

  function build(root) {
    HORIZONS = horizons();
    const st = App.state;
    const nw = st.network;
    const sc = st.scenario;
    const simOpts = () => ({ world: App.world, lookup: App.lookup, settings: App.simSettings(), nodes: Scn.simNodes(), trajectory: { t0: sc.ut, horizon: 25 * Data.YEAR } });

    /* ---- right now ---- */
    const nowCard = h('div', { class: 'card' });
    function renderNow() {
      const sim = Scn.getSim();
      const c = sim.connectivityAt(sc.ut);
      const groups = new Map();
      sim.nodes.forEach((n, i) => {
        const key = c.comp[i] >= 0 ? c.comp[i] : 'x' + i;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(n);
      });
      const homeComp = sim.nodes.findIndex((n) => n.home) >= 0 ? c.comp[sim.nodes.findIndex((n) => n.home)] : -1;
      const rows = [];
      for (const [key, members] of groups) {
        const vessels = members.filter((m) => !m.home);
        if (!vessels.length && key !== homeComp) continue;
        rows.push(h('li', {}, h('strong', { text: key === homeComp ? 'Connected to the ground stations: ' : 'Separate group: ' }),
          members.filter((m) => !m.home || members.length === 1).map((m) => m.name).join(', ') || 'ground stations'));
      }
      const loose = sim.nodes.filter((n, i) => !n.home && !c.home[i] && !(c.comp[i] >= 0));
      nowCard.replaceChildren(...[
        h('h3', { text: 'The network right now (' + Orb.formatUT(sc.ut) + ')' }),
        sim.nodes.length - sim.homeCount === 0 ? h('p', { class: 'hint', text: 'Add vessels on the Scenario tab first.' }) : h('ul', {}, rows),
        loose.length ? h('p', { class: 'hint', text: 'Vessels with no relay in reach: ' + loose.map((n) => n.name).join(', ') + '.' }) : null,
      ].filter(Boolean));
    }

    /* ---- ground stations ---- */
    const stationCard = h('div', { class: 'card' });
    const variantOut = h('div', {});
    function renderStations() {
      const sim = Scn.getSim();
      const active = new Set(sim.nodes.filter((n) => n.home).map((n) => n.id));
      const rows = Data.STATIONS.map((s) => {
        const sel = h('select', { 'aria-label': 'Override for ' + s.name },
          h('option', { value: '', text: 'as the game settings say' }), h('option', { value: 'on', text: 'always on' }), h('option', { value: 'off', text: 'always off' }));
        sel.value = nw.stations[s.id] === true ? 'on' : nw.stations[s.id] === false ? 'off' : '';
        sel.addEventListener('change', () => { if (sel.value === '') delete nw.stations[s.id]; else nw.stations[s.id] = sel.value === 'on'; App.commit(); renderStations(); renderNow(); });
        return h('tr', {}, h('td', { text: s.name }), h('td', { text: (KIND[s.kind] || s.kind) + (s.dlc ? ' (DLC)' : '') }), h('td', { class: 'num', text: s.lat.toFixed(1) + '°, ' + s.lon.toFixed(1) + '°' }),
          h('td', { text: active.has('station:' + s.id) ? 'active' : 'off' }), h('td', {}, sel));
      });
      const name = h('input', { type: 'text', placeholder: 'Name', 'aria-label': 'New station name', maxlength: 30 });
      const lat = h('input', { type: 'number', step: 'any', placeholder: 'Latitude °', 'aria-label': 'Latitude' });
      const lon = h('input', { type: 'number', step: 'any', placeholder: 'Longitude °', 'aria-label': 'Longitude' });
      const pow = h('input', { type: 'text', placeholder: 'Power, e.g. 2G (blank = DSN)', 'aria-label': 'Power rating', spellcheck: 'false' });
      const add = h('button', { class: 'btn small', type: 'button' }, '＋ Add a station');
      add.addEventListener('click', () => {
        const la = parseFloat(lat.value), lo = parseFloat(lon.value);
        if (!name.value.trim() || !isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 360) return;
        const p = pow.value.trim() ? Core.parsePower(pow.value) : 0;
        nw.custom.push({ id: 'c' + Date.now().toString(36), name: name.value.trim(), lat: la, lon: lo, alt: 0, power: isFinite(p) && p > 0 ? p : 0 });
        App.commit(); renderStations(); renderNow();
      });
      const custom = nw.custom.map((c, i) => h('li', {}, c.name + ' at ' + c.lat + '°, ' + c.lon + '° · ' + (c.power ? Core.formatPower(c.power) : 'DSN rating') + ' ',
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => { nw.custom.splice(i, 1); App.commit(); renderStations(); renderNow(); } }, 'Remove')));
      const compare = h('button', { class: 'btn', type: 'button' }, 'Compare station sets');
      compare.addEventListener('click', () => {
        variantOut.replaceChildren(h('p', { class: 'hint', text: 'Simulating each set over ' + Math.round(nw.horizon / Data.DAY) + ' days…' }));
        setTimeout(() => {
          const v = Net.stationVariants(simOpts(), sc.ut, nw.horizon);
          variantOut.replaceChildren(h('table', { class: 'tbl' },
            h('thead', {}, h('tr', {}, h('th', { text: 'Ground stations' }), h('th', { class: 'num', text: 'Stations' }), h('th', { class: 'num', text: 'Worst vessel' }), h('th', { class: 'num', text: 'Average' }))),
            h('tbody', {}, v.map((r) => h('tr', {}, h('td', { text: r.label }), h('td', { class: 'num', text: String(r.stations) }), h('td', { class: 'num', text: pct(r.worst) }), h('td', { class: 'num', text: pct(r.mean) }))))),
            h('p', { class: 'hint', text: 'Uptime of your tracked vessels over the analysis period with only the stations named (overrides above are ignored here). Custom stations are always included.' }));
        }, 20);
      });
      stationCard.replaceChildren(...[
        h('h3', { text: 'Ground stations' }),
        h('p', { class: 'hint', text: 'The Kerbal Space Center is always there. The extra stations come with the difficulty option Enable Extra Groundstations; the two Making History launch-site stations (weak, 40G) exist when other launch sites are allowed. Turn any of them on or off to plan, or add one of your own (for example from a mod).' }),
        h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', { text: 'Station' }), h('th', { text: 'Kind' }), h('th', { class: 'num', text: 'Position' }), h('th', { text: 'Now' }), h('th', { text: 'Override' }))), h('tbody', {}, rows)),
        custom.length ? h('ul', {}, custom) : null,
        h('div', { class: 'row', style: 'margin-top:8px' }, name, lat, lon, pow, add),
        h('div', { style: 'margin-top:10px' }, compare), variantOut].filter(Boolean));
    }

    /* ---- interconnectivity ---- */
    const horizonSel = h('select', { 'aria-label': 'Analysis length' }, HORIZONS.map((x) => h('option', { value: String(x[1]), text: x[0] })));
    if (!HORIZONS.some((x) => x[1] === nw.horizon)) nw.horizon = Data.YEAR;
    horizonSel.value = String(nw.horizon);
    horizonSel.addEventListener('change', () => { nw.horizon = parseFloat(horizonSel.value); App.saveState(); });
    const matrixOut = h('div', {});
    const redOut = h('div', {});
    const runMatrix = h('button', { class: 'btn primary', type: 'button' }, 'Analyze the network');
    runMatrix.addEventListener('click', () => {
      matrixOut.replaceChildren(h('p', { class: 'hint', text: 'Working…' }));
      setTimeout(() => {
        const sim = Scn.getSim();
        if (sim.nodes.length - sim.homeCount < 1) { matrixOut.replaceChildren(h('p', { class: 'hint', text: 'Add vessels on the Scenario tab first.' })); return; }
        const r = Net.interconnect(sim, sc.ut, nw.horizon);
        const head = h('tr', {}, h('th', {}), r.names.map((n, j) => h('th', { class: 'num', title: n, text: n.length > 12 ? n.slice(0, 11) + '…' : n })));
        const body = r.names.map((n, i) => h('tr', {}, h('th', { text: n + (r.tracked[i] ? '' : i < r.names.length - 1 ? ' (relay)' : '') }),
          r.uptime[i].map((u, j) => (i === j ? h('td', { class: 'num', text: '–' }) : h('td', { class: 'num', style: 'background:' + App.sigColor(u) + ';color:' + App.sigInk(u), text: pct(u) })))));
        matrixOut.replaceChildren(h('div', { class: 'scroll' }, h('table', { class: 'tbl' }, h('thead', {}, head), h('tbody', {}, body))),
          h('p', { class: 'hint', text: 'Share of the ' + HORIZONS.find((x) => x[1] === nw.horizon)[0] + ' (' + r.steps + ' samples) in which a path exists between the two. The last row and column are the ground stations (the DSN). Relays carry signals; other vessels only start or end a path, and may also reach each other directly with their own antennas.' }));
      }, 20);
    });
    const runRed = h('button', { class: 'btn', type: 'button' }, 'Test every relay');
    runRed.addEventListener('click', () => {
      redOut.replaceChildren(h('p', { class: 'hint', text: 'Removing each relay in turn and re-simulating…' }));
      setTimeout(() => {
        const r = Net.redundancy(simOpts(), sc.ut, nw.horizon);
        if (!r.rows.length) { redOut.replaceChildren(h('p', { class: 'hint', text: 'No vessel in the scenario has a relay antenna, so none of them carries traffic for the others.' })); return; }
        redOut.replaceChildren(h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, h('th', { text: 'If this vessel is lost' }), h('th', { class: 'num', text: 'Worst remaining uptime' }), h('th', { text: 'Who suffers' }))),
          h('tbody', {}, r.rows.map((row) => h('tr', {}, h('td', {}, row.name, row.planned ? h('span', { class: 'hint', text: ' (planned)' }) : null, row.critical ? h('strong', { class: 'bad', text: '  single point of failure' }) : null),
            h('td', { class: 'num', text: pct(row.worst) }),
            h('td', { text: row.lost.length ? row.lost.map((l) => l.name + ' ' + pct(l.before) + ' → ' + pct(l.after)).join('; ') : 'nobody: the rest of the network covers it' }))))),
          h('p', { class: 'hint', text: 'A relay is a single point of failure when losing it takes more than five points of uptime from another vessel. Add a second relay covering the same gap to remove it.' }));
      }, 20);
    });

    root.append(
      h('div', { class: 'card' },
        h('h2', { text: 'Network planner' }),
        h('p', { class: 'hint', text: 'Plan the whole CommNet, not just one vessel: see which vessels and relays can reach each other and the ground, find the relays whose loss would cut others off, and compare ground-station options (including the Making History stations). It uses the vessels and relays from the Scenario tab.' })),
      nowCard,
      h('div', { class: 'card' }, h('h3', { text: 'Interconnectivity over time' }),
        h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { text: 'Analysis length' }), horizonSel), runMatrix), matrixOut),
      h('div', { class: 'card' }, h('h3', { text: 'Redundancy: single points of failure' }),
        h('p', { class: 'hint', text: 'Takes each relay out of the network in turn and re-runs the simulation to see who loses contact.' }), runRed, redOut),
      stationCard);
    renderNow();
    renderStations();
    return { update: function () { renderNow(); renderStations(); } };
  }

  App.registerTab('network', 'Network', build, 'antennas');
})();
