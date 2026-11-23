// SPDX-License-Identifier: AGPL-3.0-or-later
/* Energy tab: where a vessel or base is (orbit, on the ground, in deep space), what it draws, and what generation and batteries cover it:
 * solar panels, RTGs, fuel cells. The sunlight comes from real positions over the planet's year (js/energy.js). */
(function () {
  'use strict';

  const App = window.KSPApp;
  const Data = window.KSPData;
  const Orb = window.KSPOrbits;
  const En = window.KSPEnergy;
  const Career = window.KSPCareer;
  const h = App.h;

  const num = (value, onChange, o) => {
    const i = h('input', { type: 'number', value: value === null || value === undefined ? '' : String(value), step: (o && o.step) || 'any', size: (o && o.size) || 6, 'aria-label': (o && o.label) || 'number' });
    if (o && o.min !== undefined) i.min = o.min;
    if (o && o.max !== undefined) i.max = o.max;
    i.addEventListener('change', () => { const v = parseFloat(i.value); onChange(isFinite(v) ? v : null); });
    return i;
  };
  const field = (label, el, hint) => h('div', { class: 'field' }, h('label', { text: label }), el, hint ? h('span', { class: 'hint', text: hint }) : null);
  const select = (options, value, onChange, label) => {
    const s = h('select', { 'aria-label': label || 'choice' }, options.map((o) => h('option', { value: o[0], text: o[1] })));
    s.value = String(value);
    s.addEventListener('change', () => onChange(s.value));
    return s;
  };
  const fmt = (x, d) => (x === null || x === undefined || !isFinite(x) ? '—' : String(Math.round(x * Math.pow(10, d || 0)) / Math.pow(10, d || 0)));
  const pct = (x) => Math.round(x * 100) + '%';
  const money = (x) => Math.round(x).toLocaleString('en-US');
  const dur = (s) => Orb.formatDuration(s);

  function build(root) {
    const st = App.state, s = st.energy;
    const where = h('div', { class: 'card' });
    const loadsCard = h('div', { class: 'card' });
    const out = h('div', {});
    root.append(where, loadsCard, out);
    const saved = () => App.saveState();

    const career = () => (s.useCareer && st.career && st.career.state ? st.career.state : null);
    const catalogue = () => {
      const c = En.loadCatalogue();
      App.enabledAntennas().filter((a) => !a.builtin && !a.ground && a.pktInterval > 0).forEach((a) => c.push({ id: 'ant:' + a.id, label: a.name + ' (sending data)', ec: En.transmitEC(a), group: 'Antennas' }));
      c.push({ id: 'custom', label: 'Something else: enter the charge per second', ec: 1, group: 'Other' });
      return c;
    };

    /* ---------- where ---------- */

    function renderWhere() {
      const w = App.world;
      const body = w.index.get(s.body) || w.index.get('Kerbin');
      const lim = w.altitudeLimits(body.id);
      const ch = (fn) => (v) => { fn(v); saved(); render(); };
      const kids = [
        field('Where', select([['orbit', 'In orbit'], ['landed', 'On the ground'], ['space', 'In deep space (flying about the planet’s orbit)']], s.where, ch((v) => { s.where = v; }), 'Where')),
        field('Body', App.bodySelect(s.body, ch((v) => { s.body = v; }), {}))];
      if (s.where === 'orbit') {
        kids.push(field('Altitude (km)', num(Math.round(s.alt / 100) / 10, ch((v) => { s.alt = v === null ? 80000 : Math.max(lim.min, v * 1000); }), { size: 7, label: 'altitude in km' }), 'at least ' + fmt(lim.min / 1000) + ' km'));
        kids.push(field('Inclination (°)', num(s.inc, ch((v) => { s.inc = v === null ? 0 : v; }), { size: 5, label: 'inclination' }), 'a polar orbit can stay in sun'));
      } else if (s.where === 'landed') {
        kids.push(field('Latitude (°)', num(s.lat, ch((v) => { s.lat = v === null ? 0 : Math.max(-90, Math.min(90, v)); }), { size: 6, label: 'latitude' })));
        kids.push(field('Longitude (°)', num(s.lon, ch((v) => { s.lon = v === null ? 0 : v; }), { size: 6, label: 'longitude' })));
      }
      where.replaceChildren(...[
        h('h2', { text: 'Energy planning' }),
        h('p', { class: 'hint', text: 'Works out how much sunlight the place really gets over the planet’s whole year (distance from the star, eclipses by planets and moons, night on the ground), then what solar panels, RTGs or fuel cells and batteries it takes to carry your loads.' }),
        h('div', { class: 'row' }, ...kids),
        h('div', { class: 'row' },
          field('Fixed panels facing the sun (%)', num(s.orientation, ch((v) => { s.orientation = v === null ? 50 : Math.max(5, Math.min(100, v)); }), { size: 4, label: 'fixed panel orientation' }), 'in orbit; on the ground they lie flat'),
          field('Light reaching the ground (%)', num(s.atmosphere, ch((v) => { s.atmosphere = v === null ? 100 : Math.max(5, Math.min(100, v)); }), { size: 4, label: 'light through the air' }), 'thick air dims the sun; the game’s curve is not modelled')),
        h('div', { class: 'row' },
          field('Spare power (%)', num(s.margin, ch((v) => { s.margin = v === null ? 15 : Math.max(0, v); }), { size: 4, label: 'spare power' })),
          field('Everything on at once for (min)', num(s.burstMin, ch((v) => { s.burstMin = v === null ? 0 : Math.max(0, v); }), { size: 4, label: 'burst minutes' }), 'batteries cover it'),
          field('Fuel cell days', num(s.days, ch((v) => { s.days = v === null ? 30 : Math.max(1, v); }), { size: 4, label: 'fuel cell days' }))),
        h('label', { class: 'inline', style: 'color:var(--text);display:flex' }, chk(s.useCareer, (v) => { s.useCareer = v; saved(); render(); }, 'only parts my career has'), 'Only what my career has unlocked' + (st.career && st.career.state ? '' : ' (no career loaded: everything counts)')),
        h('label', { class: 'inline', style: 'color:var(--text);display:flex' }, chk(s.allowUnlock, (v) => { s.allowUnlock = v; saved(); render(); }, 'also parts I have to unlock'), 'Also show parts I would have to research or buy (with the price)')]);
    }
    const chk = (v, f, label) => { const i = h('input', { type: 'checkbox', 'aria-label': label }); i.checked = !!v; i.addEventListener('change', () => f(i.checked)); return i; };

    /* ---------- loads ---------- */

    function renderLoads() {
      const cat = catalogue();
      const groups = {};
      cat.forEach((c) => { (groups[c.group] = groups[c.group] || []).push(c); });
      const rows = s.loads.map((l, i) => {
        const sel = h('select', { 'aria-label': 'What draws power' }, Object.keys(groups).map((g) => h('optgroup', { label: g }, groups[g].map((c) => h('option', { value: c.id, text: c.label })))));
        sel.value = l.pre;
        sel.addEventListener('change', () => { const c = cat.find((x) => x.id === sel.value); l.pre = sel.value; if (c && c.id !== 'custom') { l.ec = c.ec; l.label = c.label; } saved(); render(); });
        return h('div', { class: 'row' }, field('Load', sel),
          field('Number', num(l.n, (v) => { l.n = v === null ? 1 : Math.max(1, Math.round(v)); saved(); render(); }, { size: 3, min: 1, label: 'number of these' })),
          field('Charge per second', num(l.ec, (v) => { l.ec = v === null ? 0 : Math.max(0, v); saved(); render(); }, { size: 6, label: 'charge per second' })),
          field('Running (% of the time)', num(l.duty, (v) => { l.duty = v === null ? 100 : Math.max(0, Math.min(100, v)); saved(); render(); }, { size: 4, label: 'duty cycle' })),
          h('button', { class: 'btn small', type: 'button', onclick: () => { s.loads.splice(i, 1); saved(); render(); } }, 'Remove'));
      });
      loadsCard.replaceChildren(...[
        h('h3', { text: 'What it draws' }),
        h('p', { class: 'hint', text: 'A probe core draws a trickle, a reaction wheel more while it turns, a drill, a converter or a rover wheel a lot while working. Antennas draw only while they send data (the game’s packet cost over the packet interval); relaying costs nothing. Ion engines and anything the list lacks: enter the figure from the part’s info in the game.' }),
        ...rows,
        h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => { s.loads.push({ pre: 'custom', label: 'Something else', n: 1, ec: 1, duty: 100 }); saved(); render(); } }, '+ Add a load'))].filter(Boolean));
    }

    /* ---------- result ---------- */

    function location() {
      const w = App.world;
      const b = w.index.get(s.body);
      if (!b || b.star) return null;
      if (s.where === 'orbit') {
        const alt = Math.max(s.alt, w.altitudeLimits(b.id).min);
        return { type: 'orbit', body: b.id, orbit: Orb.orbitFromAltitudes(b, alt, alt, s.inc || 0, 0, 0, 0) };
      }
      if (s.where === 'landed') return { type: 'landed', body: b.id, lat: s.lat, lon: s.lon, alt: 0 };
      return { type: 'space', body: b.id };
    }

    function renderResult() {
      const loc = location();
      if (!loc) { out.replaceChildren(h('div', { class: 'card' }, h('p', { text: 'Pick a body that is not the star.' }))); return; }
      const prof = En.lightProfile(App.world, loc, { t0: st.scenario.ut, orientation: s.orientation / 100 });
      const loads = s.loads.map((l) => ({ label: l.label, ec: l.ec * l.n, duty: l.duty / 100 }));
      const d = En.design({ profile: prof, loads: loads, state: career(), margin: s.margin / 100, burstMin: s.burstMin, days: s.days, atmosphere: s.atmosphere / 100, allowUnlock: s.allowUnlock, orientation: s.orientation / 100 });
      const bodyName = App.world.index.get(s.body).name;
      const lightCard = h('div', { class: 'card' },
        h('h3', { text: 'Sunlight' + (loc.type === 'space' ? ' about ' + bodyName + '’s orbit' : ' at ' + bodyName) }),
        loc.type === 'space'
          ? h('p', { text: 'The star’s light here is ' + fmt(prof.flux.min, 2) + '× to ' + fmt(prof.flux.max, 2) + '× what Kerbin gets over the planet’s year (never hidden). A panel gives its charge rate times that, so at the dim end it gives ' + pct(prof.flux.min) + ' and at the bright end ' + pct(prof.flux.max) + '.' })
          : h('p', { text: 'In sunlight ' + pct(prof.share.min) + ' to ' + pct(prof.share.max) + ' of the time (' + pct(prof.share.mean) + ' on average over the year), the longest darkness ' + dur(prof.dark.max) + ' in a ' + dur(prof.cycle) + ' ' + (loc.type === 'orbit' ? 'orbit' : 'day') + '. Light strength ' + fmt(prof.flux.min, 2) + '× to ' + fmt(prof.flux.max, 2) + '× Kerbin’s. Average output per unit of charge rate: ' + fmt(prof.tracking.min * (s.where === 'landed' ? s.atmosphere / 100 : 1), 2) + ' for a sun-tracking panel and ' + fmt(prof.fixed.min * (s.where === 'landed' ? s.atmosphere / 100 : 1), 2) + ' for a fixed one, at the worst time of year.' }),
        loc.type === 'orbit' && prof.share.min < prof.share.max - 0.05 ? h('p', { class: 'hint', text: 'This orbit’s eclipses change with the season (the planet’s year turns the sun around it), so the design uses the worst season.' }) : null);
      const status = (o) => {
        const bits = [];
        if (o.funds) bits.push(money(o.funds) + ' funds to buy');
        if (o.needs && o.needs.length) bits.push('research ' + Array.from(new Set(o.needs)).map((n) => (Career.nodes[n] ? Career.nodes[n].title : n)).join(', '));
        return bits.length ? bits.join('; ') : 'ready';
      };
      const rows = d.options.map((o, i) => h('tr', {},
        h('td', { text: { solar: 'Solar', rtg: 'RTG', fuelcell: 'Fuel cell' }[o.kind] + (i === 0 ? ' · lightest' : '') }),
        h('td', { text: o.parts.map((p) => p.n + '× ' + En.partOf(p.id).title).join(' + ') }),
        h('td', { text: fmt(o.generation, 2) + ' /s' }), h('td', { text: o.battery ? fmt(o.battery) + ' EC' : '—' }),
        h('td', { text: fmt(o.mass, 3) + ' t' }), h('td', { text: money(o.cost) }), h('td', { text: status(o) }), h('td', { text: o.notes })));
      const need = h('p', { text: 'The loads average ' + fmt(d.avg, 3) + ' charge per second (' + fmt(d.need, 3) + ' with the spare), at most ' + fmt(d.peak, 2) + ' when everything runs.' +
        (d.dark > 0 ? ' The batteries have to carry ' + fmt(d.darkEnergy, 1) + ' through the longest darkness' + (d.burstEnergy ? ' and ' + fmt(d.burstEnergy, 1) + ' for the burst' : '') + '.' : '') });
      const best = d.options[0];
      const rtgBest = d.options.find((o) => o.kind === 'rtg');
      out.replaceChildren(lightCard, h('div', { class: 'card' },
        h('h3', { text: 'What covers it' }), need,
        d.options.length ? h('table', {}, h('thead', {}, h('tr', {}, ...['Kind', 'Parts', 'Makes', 'Battery', 'Mass', 'Cost', 'To unlock', 'Notes'].map((t) => h('th', { text: t })))), h('tbody', {}, ...rows))
          : h('p', { class: 'warn', text: 'Nothing the career has unlocked can carry this. Tick “Also show parts I would have to research or buy”.' }),
        best && rtgBest && best.kind === 'solar' && prof.share.min < 0.3 ? h('p', { class: 'hint', text: 'With this little sun, panels need a lot of battery; an RTG makes the same power all the time.' }) : null,
        h('p', { class: 'hint', text: 'Panels are sized for the dimmest, darkest time of year; batteries for the longest darkness at the average load. Battery parts that come with probe cores and pods are not counted, so a small probe may need less. Panel heating, damage and the dimming of light through an atmosphere (set above) are not modelled.' })));
    }

    function render() { renderWhere(); renderLoads(); renderResult(); }
    render();
    return { update: render };
  }

  App.registerTab('energy', 'Energy', build, 'network');
})();
