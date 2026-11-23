// SPDX-License-Identifier: AGPL-3.0-or-later
/* Career tab: where the save stands (funds, science, reputation, facilities, tech), the money ledger and forecast, facility upgrade
 * planning, the tech tree plan and the science tables. Uses js/career.js; the Missions tab (ui-missions.js) feeds the ledger. */
(function () {
  'use strict';

  const App = window.KSPApp;
  const Data = window.KSPData;
  const Orb = window.KSPOrbits;
  const Parsers = window.KSPParsers;
  const CD = window.KSPCareerData;
  const Career = window.KSPCareer;
  const h = App.h;

  const money = (x) => (x < 0 ? '−' : '') + Math.round(Math.abs(x)).toLocaleString('en-US');
  const sgn = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + (Math.abs(x) >= 100 ? Math.round(Math.abs(x)).toLocaleString('en-US') : String(Math.round(Math.abs(x) * 10) / 10));
  const num = (value, onChange, o) => {
    const i = h('input', { type: 'number', value: String(value), step: (o && o.step) || 'any', size: (o && o.size) || 9, 'aria-label': (o && o.label) || 'number' });
    if (o && o.min !== undefined) i.min = o.min;
    i.addEventListener('change', () => { const v = parseFloat(i.value); onChange(isFinite(v) ? v : 0); });
    return i;
  };
  const field = (label, el) => h('div', { class: 'field' }, h('label', { text: label }), el);
  const select = (options, value, onChange, label) => {
    const s = h('select', { 'aria-label': label || 'choice' }, options.map((o) => h('option', { value: o[0], text: o[1] })));
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return s;
  };
  const dayOf = (st) => Math.floor((st.ut || 0) / Data.DAY);

  /** The career object kept in the app state; created on first use. */
  function career() {
    const c = App.state.career;
    if (!c.state) c.state = Career.newState('normal');
    return c;
  }

  function build(root) {
    const out = h('div', {});
    root.append(out);
    const status = h('div', { class: 'status' });

    function render() {
      const c = career(), s = c.state;
      out.replaceChildren(...[stateCard(c, s), financeCard(c, s), facilityCard(c, s), techCard(c, s), milestoneCard(c, s), strategyCard(c, s), scienceCard(c, s), contractCard(c, s)].filter(Boolean));
      keepOpen(out, c);
    }
    /** A card the user opened or closed stays that way when the tab redraws after an edit. */
    function keepOpen(box, c) {
      const open = c.open || (c.open = {});
      for (const d of box.querySelectorAll('details')) {
        const key = d.querySelector('summary').textContent.split(/[(:]/)[0].trim();
        if (open[key] !== undefined) d.open = open[key];
        d.addEventListener('toggle', () => { open[key] = d.open; });
      }
    }
    const changed = () => { App.saveState(); render(); };

    // ---- where the career stands ------------------------------------------------------------------------------
    function stateCard(c, s) {
      const file = h('input', { type: 'file', accept: '.sfs,.txt', hidden: true, 'aria-label': 'KSP career save file' });
      file.addEventListener('change', () => {
        const f = file.files && file.files[0];
        if (!f) return;
        f.text().then((text) => {
          const parsed = Parsers.parseCareer(text);
          if (!parsed) { status.className = 'status bad'; status.textContent = 'That does not look like a KSP persistent.sfs.'; return; }
          c.state = Career.fromSave(parsed);
          c.title = parsed.title;
          status.className = 'status ok';
          status.textContent = 'Loaded “' + parsed.title + '”: ' + c.state.tech.length + ' tech nodes, ' + c.state.contracts.length + ' open contracts.' + (c.state.mode !== 'career' ? ' This is a ' + c.state.mode + ' save, so funds and research are not limited in the game.' : '');
          changed();
        }, () => { status.className = 'status bad'; status.textContent = 'Could not read that file.'; });
        file.value = '';
      });
      const presets = Object.keys(CD.difficulty).map((k) => [k, k[0].toUpperCase() + k.slice(1) + ' (' + money(CD.difficulty[k].startFunds) + ' funds, ×' + CD.difficulty[k].gain[0] + ' gain)']);
      presets.push(['custom', 'Custom (from a save)']);
      const presetSel = select(presets, s.preset, (v) => {
        if (v === 'custom') return;
        const n = Career.newState(v);
        s.preset = v; s.diff = n.diff;
        changed();
      }, 'Difficulty');
      const gain = h('div', { class: 'row' },
        field('Funds gain ×', num(s.diff.gain[0], (v) => { s.diff.gain[0] = v; s.preset = 'custom'; changed(); }, { size: 5, step: 0.05, label: 'funds gain' })),
        field('Science gain ×', num(s.diff.gain[1], (v) => { s.diff.gain[1] = v; s.preset = 'custom'; changed(); }, { size: 5, step: 0.05, label: 'science gain' })),
        field('Reputation gain ×', num(s.diff.gain[2], (v) => { s.diff.gain[2] = v; s.preset = 'custom'; changed(); }, { size: 5, step: 0.05, label: 'reputation gain' })),
        field('Funds loss ×', num(s.diff.loss[0], (v) => { s.diff.loss[0] = v; s.preset = 'custom'; changed(); }, { size: 5, step: 0.05, label: 'funds loss' })));
      return h('div', { class: 'card' },
        h('h2', { text: 'Career' }),
        h('p', { class: 'hint', text: 'Start from a save to plan from your real position, or set the numbers by hand. Everything here stays in your browser. Funds, science and reputation are what you have now; the ledger below says what you will spend and earn.' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', onclick: () => file.click() }, 'Load career from persistent.sfs…'),
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => { c.state = Career.newState(s.preset === 'custom' ? 'normal' : s.preset); c.ledger = []; c.goals = []; changed(); } }, 'Start a new career'),
          file),
        status,
        h('div', { class: 'row', style: 'margin-top:10px' },
          field('Difficulty', presetSel),
          field('Funds', num(Math.round(s.funds), (v) => { s.funds = v; changed(); }, { label: 'funds' })),
          field('Science', num(Math.round(s.sci * 10) / 10, (v) => { s.sci = v; changed(); }, { size: 7, label: 'science' })),
          field('Reputation', num(Math.round(s.rep), (v) => { s.rep = v; changed(); }, { size: 7, label: 'reputation' })),
          field('Day now', num(dayOf(s), (v) => { s.ut = Math.max(0, v) * Data.DAY; changed(); }, { size: 7, label: 'current day' }))),
        gain,
        h('p', { class: 'hint', text: (c.title ? 'From “' + c.title + '”. ' : '') + 'Mode: ' + s.mode + '. Facility levels are in the table below. ' + s.tech.length + ' of ' + CD.tech.length + ' tech nodes researched.' }));
    }

    // ---- ledger and forecast ----------------------------------------------------------------------------------
    function financeCard(c, s) {
      const now = dayOf(s);
      const f = Career.forecast(s, c.ledger.map((x) => ({ day: x.day, label: x.label, funds: x.funds || 0, sci: x.sci || 0, rep: x.rep || 0, kind: x.kind, id: x.id })));
      const draft = c.draft || (c.draft = { label: '', kind: 'other', in: 0, funds: 0, sci: 0, rep: 0 });
      const rows = f.rows.map((r) => h('tr', { class: r.balance < 0 ? 'bad' : '' },
        h('td', { text: 'Day ' + Math.round(r.day) }), h('td', { text: r.label }), h('td', { text: r.kind || '' }),
        h('td', { class: 'num', text: r.funds ? sgn(r.funds) : '' }), h('td', { class: 'num', text: r.sci ? sgn(r.sci) : '' }), h('td', { class: 'num', text: r.rep ? sgn(r.rep) : '' }),
        h('td', { class: 'num', text: money(r.balance) }),
        h('td', {}, h('button', { class: 'btn small ghost danger', type: 'button', 'aria-label': 'Remove ' + r.label, onclick: () => { c.ledger = c.ledger.filter((x) => x.id !== r.id); changed(); } }, '×'))));
      const chart = h('canvas', { width: 640, height: 150, 'aria-label': 'Funds over time', style: 'width:100%;max-width:640px;height:150px' });
      setTimeout(() => drawChart(chart, s, f, now), 0);
      const add = () => {
        if (!draft.label.trim() && !draft.funds && !draft.sci && !draft.rep) return;
        c.ledger.push({ id: c.nextId++, day: now + draft.in, label: draft.label.trim() || 'Item', kind: draft.kind, funds: draft.funds, sci: draft.sci, rep: draft.rep });
        draft.label = ''; draft.funds = 0; draft.sci = 0; draft.rep = 0;
        changed();
      };
      const lbl = h('input', { type: 'text', value: draft.label, size: 22, placeholder: 'What it is', 'aria-label': 'Item label' });
      lbl.addEventListener('input', () => { draft.label = lbl.value; });
      lbl.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      const summary = c.ledger.length
        ? 'After the last item: ' + money(f.end.funds) + ' funds, ' + (Math.round(f.end.sci * 10) / 10) + ' science, ' + Math.round(f.end.rep) + ' reputation. Lowest balance ' + money(f.low) + (f.low < s.funds ? ' on day ' + Math.round(f.lowDay) : '') + '.'
        : 'Nothing planned yet. Add launches, contract rewards, upgrades and research below, or add a mission from the Missions tab.';
      return h('div', { class: 'card' + (f.firstShort !== null ? ' warn' : '') },
        h('h2', { text: 'Money, science and reputation over time' }),
        h('p', { class: 'hint', text: 'A list of things that will happen on given days: costs are negative, rewards positive. The balance after each one is worked out from what you have now. A red row means you could not afford that step on that day (with “allow negative funds” off, the game would not let you).' }),
        f.firstShort !== null ? h('p', { class: 'bad', text: 'Short of funds from day ' + Math.round(f.firstShort) + ': reorder, add income before it, or cut the cost.' }) : null,
        c.ledger.length ? h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Day', 'Item', 'Kind', 'Funds', 'Science', 'Rep', 'Balance', ''].map((t, i) => h('th', { class: i >= 3 && i < 7 ? 'num' : '', text: t })))),
          h('tbody', {}, rows))) : null,
        c.ledger.length ? chart : null,
        h('p', { class: 'hint', text: summary }),
        h('div', { class: 'row' },
          field('Add item', lbl),
          field('Kind', select([['launch', 'Launch'], ['recovery', 'Recovery'], ['contract', 'Contract'], ['facility', 'Facility'], ['tech', 'Research'], ['other', 'Other']], draft.kind, (v) => { draft.kind = v; }, 'Kind')),
          field('In days', num(draft.in, (v) => { draft.in = v; }, { size: 5, label: 'days from now' })),
          field('Funds ±', num(draft.funds, (v) => { draft.funds = v; }, { label: 'funds change' })),
          field('Science ±', num(draft.sci, (v) => { draft.sci = v; }, { size: 6, label: 'science change' })),
          field('Rep ±', num(draft.rep, (v) => { draft.rep = v; }, { size: 6, label: 'reputation change' })),
          h('button', { class: 'btn primary', type: 'button', onclick: add }, 'Add'),
          c.ledger.length ? h('button', { class: 'btn ghost danger', type: 'button', onclick: () => { c.ledger = []; changed(); } }, 'Clear list') : null));
    }
    function drawChart(cv, s, f, now) {
      if (!cv.getContext) return;
      const g = cv.getContext('2d');
      if (!g) return;
      const cs = getComputedStyle(document.documentElement);
      const ink = cs.getPropertyValue('--muted').trim() || '#888', acc = cs.getPropertyValue('--accent').trim() || '#06c', bad = cs.getPropertyValue('--bad').trim() || '#c33';
      const pts = [[now, s.funds]].concat(f.rows.map((r) => [r.day, r.balance]));
      const x0 = pts[0][0], x1 = Math.max(x0 + 1, pts[pts.length - 1][0]);
      let lo = Math.min(0, ...pts.map((p) => p[1])), hi = Math.max(1, ...pts.map((p) => p[1]));
      if (hi === lo) hi = lo + 1;
      const W = cv.width, H = cv.height, L = 52, R = 10, T = 10, B = 20;
      const X = (d) => L + ((d - x0) / (x1 - x0)) * (W - L - R), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
      g.clearRect(0, 0, W, H);
      g.font = '11px sans-serif'; g.fillStyle = ink; g.strokeStyle = ink; g.lineWidth = 1;
      g.beginPath(); g.moveTo(L, Y(0)); g.lineTo(W - R, Y(0)); g.globalAlpha = 0.5; g.stroke(); g.globalAlpha = 1;
      g.fillText(money(hi), 2, T + 8); g.fillText(money(lo), 2, H - B);
      g.fillText('day ' + Math.round(x0), L, H - 4); g.textAlign = 'right'; g.fillText('day ' + Math.round(x1), W - R, H - 4); g.textAlign = 'left';
      g.lineWidth = 2; g.strokeStyle = acc; g.beginPath();
      pts.forEach((p, i) => {
        if (i === 0) { g.moveTo(X(p[0]), Y(p[1])); return; }
        g.lineTo(X(p[0]), Y(pts[i - 1][1])); g.lineTo(X(p[0]), Y(p[1]));          // balances are steps
      });
      g.stroke();
      g.fillStyle = bad;
      for (const p of pts) if (p[1] < 0) { g.beginPath(); g.arc(X(p[0]), Y(p[1]), 3.5, 0, 6.3); g.fill(); }
    }

    // ---- facilities -------------------------------------------------------------------------------------------
    function facilityCard(c, s) {
      const table = Career.facilityTable(s);
      const total = table.reduce((a, f) => a + f.toMax, 0);
      return h('details', { class: 'card', open: true },
        h('summary', { text: 'Facility upgrades' }),
        h('p', { class: 'hint', text: 'Upgrade prices and what each level allows, read from the game. “Plan” puts the upgrade on the money list on the day you choose. All nine to level 3 costs ' + money(total) + ' funds from where you are.' }),
        h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Facility', 'Level', 'Allows now', 'Next level', 'Price', ''].map((t, i) => h('th', { class: i === 4 ? 'num' : '', text: t })))),
          h('tbody', {}, table.map((f) => h('tr', {},
            h('td', { text: f.name }),
            h('td', {}, select([['1', '1'], ['2', '2'], ['3', '3']], String(f.level), (v) => { s.facilities[f.id] = +v; changed(); }, f.name + ' level')),
            h('td', { text: f.now.length ? f.now.map((e) => e[0] + ': ' + e[1]).join(' · ') : '—' }),
            h('td', { text: f.after ? (f.after.length ? f.after.map((e) => e[0] + ': ' + e[1]).join(' · ') : '—') : 'maximum' }),
            h('td', { class: 'num', text: f.nextCost ? money(f.nextCost) : '' }),
            h('td', {}, f.nextCost ? h('button', { class: 'btn small', type: 'button', onclick: () => {
              c.ledger.push({ id: c.nextId++, day: dayOf(s) + 7, label: 'Upgrade ' + f.name + ' to level ' + (f.level + 1), kind: 'facility', funds: -f.nextCost });
              changed();
            } }, 'Plan') : null)))))),
        h('p', { class: 'hint', text: 'The Administration Building decides how many strategies and contracts you may hold; Mission Control level 2 unlocks manoeuvre planning in flight; the Tracking Station shows more of a trajectory as it levels up. Upgrades apply to the buildings in the game at once; the app does not know which a mission needs until you add a rocket on the Missions tab.' }));
    }

    // ---- tech tree --------------------------------------------------------------------------------------------
    function techCard(c, s) {
      const goals = c.goals.filter((g) => Career.nodes[g] && !s.tech.includes(g));
      const plan = Career.techPlan(s, goals, { rdLevel: s.facilities.ResearchAndDevelopment || 1 });
      const now = Career.researchable(s);
      const all = CD.tech.filter((t) => !s.tech.includes(t.id)).sort((a, b) => a.tier - b.tier || a.cost - b.cost);
      const sel = select([['', 'Pick a tech node to aim for…']].concat(all.map((t) => [t.id, t.title + ' (' + t.cost + ')'])), '', (v) => { if (v && !c.goals.includes(v)) { c.goals.push(v); changed(); } }, 'Goal node');
      const partList = (id) => (Career.partsByTech[id] || []).map((p) => p.title).join(', ');
      return h('details', { class: 'card', open: true },
        h('summary', { text: 'Tech tree plan' }),
        h('p', { class: 'hint', text: 'Choose the nodes you are working towards. The plan lists everything missing in the order to research it, the science it takes, and what the new parts cost to buy. Nodes that need more science than your Research & Development level allows are marked.' }),
        h('div', { class: 'row' }, field('Goal', sel),
          goals.length ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { c.goals = []; changed(); } }, 'Clear goals') : null),
        goals.length ? h('div', { class: 'row', style: 'margin:6px 0' }, goals.map((g) => h('button', { class: 'btn small on', type: 'button', title: 'Remove goal', onclick: () => { c.goals = c.goals.filter((x) => x !== g); changed(); } }, Career.nodes[g].title + ' ×'))) : null,
        goals.length ? h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['#', 'Research', 'Science', 'Running total', 'New parts', 'Parts to buy', ''].map((t, i) => h('th', { class: i >= 2 && i <= 3 || i === 5 ? 'num' : '', text: t })))),
          h('tbody', {}, plan.rows.map((r, i) => h('tr', { class: r.blocked ? 'bad' : '' },
            h('td', { text: String(i + 1) }), h('td', { text: r.title + (s.facilities.ResearchAndDevelopment < 2 && r.blocked ? ' (needs a better R&D)' : r.blocked ? ' (needs R&D level 3)' : ''), title: partList(r.id) }),
            h('td', { class: 'num', text: String(r.cost) }), h('td', { class: 'num', text: String(r.cum) }),
            h('td', { text: String(r.parts) }), h('td', { class: 'num', text: r.partFunds ? money(r.partFunds) : '' }), h('td', {}))),
            h('tr', {}, h('td', {}), h('td', { text: 'Total' }), h('td', { class: 'num', text: String(plan.total) }), h('td', {}), h('td', {}), h('td', { class: 'num', text: money(plan.funds) }), h('td', {}))))) : null,
        goals.length ? h('p', { class: s.sci >= plan.total ? 'good' : 'hint', text: 'You have ' + (Math.round(s.sci * 10) / 10) + ' science; the plan needs ' + plan.total + (s.sci >= plan.total ? ': enough already.' : ', so ' + Math.round((plan.total - s.sci) * 10) / 10 + ' more.') + ' Part prices total ' + money(plan.funds) + ' funds.' }) : null,
        goals.length ? h('button', { class: 'btn small', type: 'button', onclick: () => {
          const day = dayOf(s) + 7;
          for (const r of plan.rows) c.ledger.push({ id: c.nextId++, day: day, label: 'Research ' + r.title, kind: 'tech', funds: -r.partFunds, sci: -r.cost });
          changed();
        } }, 'Add the plan to the money list') : null,
        h('details', {}, h('summary', { text: 'Researchable right now (' + now.length + ')' }),
          h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Node', 'Science', 'Parts', ''].map((t, i) => h('th', { class: i === 1 ? 'num' : '', text: t })))),
            h('tbody', {}, now.sort((a, b) => a.cost - b.cost).map((n) => h('tr', {}, h('td', { text: n.title, title: partList(n.id) }), h('td', { class: 'num', text: String(n.cost) }), h('td', { text: String(n.parts) }),
              h('td', {}, h('button', { class: 'btn small ghost', type: 'button', onclick: () => { if (!c.goals.includes(n.id)) c.goals.push(n.id); changed(); } }, 'Aim for')))))))));
    }

    // ---- science ----------------------------------------------------------------------------------------------
    function scienceCard(c, s) {
      const body = c.body && CD.bodyScience[c.body] ? c.body : 'Mun';
      const rows = Career.scienceTable(body).slice(0, 40);
      const bodySel = select(Object.keys(CD.bodyScience).map((b) => [b, b]), body, (v) => { c.body = v; changed(); }, 'Body');
      const b = CD.bodyScience[body];
      return h('details', { class: 'card' },
        h('summary', { text: 'Science worth at a body' }),
        h('p', { class: 'hint', text: 'What an experiment is worth in each situation: the first time you bring or send it back, and the most that subject can ever give. Every biome is its own subject, so the same experiment in a new biome pays again (the Landing tab shows the biomes of each body). Sending data home instead of recovering it gives only a fraction of the first return (the part’s transmit efficiency). Recovering a vessel from this body is worth ×' + b.recovery + '.' }),
        h('div', { class: 'row' }, field('Body', bodySel)),
        h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Experiment', 'Situation', 'Multiplier', 'First return', 'Subject cap', 'If transmitted'].map((t, i) => h('th', { class: i >= 2 ? 'num' : '', text: t })))),
          h('tbody', {}, rows.map((r) => h('tr', {}, h('td', { text: r.title }), h('td', { text: r.situation }), h('td', { class: 'num', text: '×' + r.multiplier }),
            h('td', { class: 'num', text: (Math.round(r.first * 10) / 10) + '' }), h('td', { class: 'num', text: (Math.round(r.cap * 10) / 10) + '' }),
            h('td', { class: 'num', text: (Math.round(r.first * (CD.experiments[r.id].xmit || 0.5) * 10) / 10) + '' })))))),
        h('p', { class: 'hint', text: 'Gain multiplier ×' + s.diff.gain[1] + ' on this career is not applied to the table (it applies when the science is credited). The science report in the game can show a smaller number once you have already returned that subject.' }));
    }

    // ---- milestones ("World First") ---------------------------------------------------------------------------
    function milestoneCard(c, s) {
      const ui = c.ms || (c.ms = { body: 'all', onlyNew: true, sort: 'funds' });
      const all = Career.milestoneList(s);
      const rows = all.filter((r) => (ui.body === 'all' || r.body === ui.body || (ui.body === 'single' && !r.body)) && (!ui.onlyNew || !r.done));
      rows.sort((a, b) => (ui.sort === 'funds' ? b.reward.funds - a.reward.funds : ui.sort === 'rep' ? b.reward.rep - a.reward.rep : b.reward.sci - a.reward.sci));
      const left = all.filter((r) => !r.done);
      const sum = (k) => left.reduce((a, r) => a + r.reward[k], 0);
      const bodySel = select([['all', 'All bodies'], ['single', 'One-off milestones']].concat(Object.keys(CD.bodyScience).map((b) => [b, b])), ui.body, (v) => { ui.body = v; changed(); }, 'Milestone body');
      const sortSel = select([['funds', 'Funds'], ['rep', 'Reputation'], ['sci', 'Science']], ui.sort, (v) => { ui.sort = v; changed(); }, 'Milestone sort');
      const only = h('input', { type: 'checkbox', 'aria-label': 'Only milestones not yet reached' });
      only.checked = !!ui.onlyNew;
      only.addEventListener('change', () => { ui.onlyNew = only.checked; changed(); });
      return h('details', { class: 'card' },
        h('summary', { text: 'Milestones ("World First"): what each first is worth' }),
        h('p', { class: 'hint', text: 'The game pays a reward the first time you reach each milestone (first orbit, first landing, first flag and so on), per body. The figures follow the game’s own formula (see the Research notes), include your difficulty gain (×' + s.diff.gain.join(', ×') + ') and your active strategies. ' + left.length + ' milestones in this list are still open: together ' + money(sum('funds')) + ' funds, ' + money(sum('sci')) + ' science and ' + money(sum('rep')) + ' reputation. Records (altitude, speed, distance, depth) pay by interval and are not listed. A save loaded from persistent.sfs marks the ones already reached.' }),
        h('div', { class: 'row' }, field('Body', bodySel), field('Best first by', sortSel), h('label', { class: 'inline' }, only, ' Only the ones not reached yet')),
        h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Milestone', 'Body', 'Tier', 'Funds', 'Science', 'Reputation', ''].map((t, i) => h('th', { class: i >= 3 && i < 6 ? 'num' : '', text: t })))),
          h('tbody', {}, rows.slice(0, 80).map((r) => h('tr', { class: r.done ? 'dim' : '' },
            h('td', { text: r.label + (r.done ? ' (reached)' : '') }), h('td', { text: r.body || '—' }), h('td', { text: r.prestige + (r.outlier ? ', bonus ×1.5' : '') }),
            h('td', { class: 'num', text: money(r.reward.funds) }), h('td', { class: 'num', text: String(r.reward.sci) }), h('td', { class: 'num', text: String(r.reward.rep) }),
            h('td', {}, r.done ? null : h('button', { class: 'btn small', type: 'button', onclick: () => {
              c.ledger.push({ id: c.nextId++, day: dayOf(s) + 30, label: 'Milestone: ' + r.label + (r.body ? ' (' + r.body + ')' : ''), kind: 'milestone', funds: r.reward.funds, sci: r.reward.sci, rep: r.reward.rep });
              changed();
            } }, 'Plan reward'))))))),
        rows.length > 80 ? h('p', { class: 'hint', text: 'Showing the first 80 of ' + rows.length + '. Pick a body to narrow the list.' }) : null);
    }

    // ---- strategies -------------------------------------------------------------------------------------------
    function strategyCard(c, s) {
      const t = Career.strategyTable(s);
      const act = (id) => (s.strategies || []).find((x) => x.id === id);
      const sample = { funds: 100000, sci: 10, rep: 10 };
      const examples = [['a 100,000 contract reward', 'ContractReward'], ['a milestone of the same size', 'Progression'], ['10 science transmitted', 'ScienceTransmission']];
      const effect = (reason) => Career.strategyEffect(s.strategies || [], reason, sample).delta;
      const say = (d) => ['funds', 'sci', 'rep'].map((k) => (Math.abs(d[k]) > 1e-9 ? sgn(d[k]) + ' ' + (k === 'sci' ? 'science' : k === 'rep' ? 'reputation' : 'funds') : '')).filter(Boolean).join(', ') || 'nothing';
      return h('details', { class: 'card' },
        h('summary', { text: 'Strategies (' + t.used + ' of ' + t.slots + ' slots in use)' }),
        h('p', { class: 'hint', text: 'Strategies trade one kind of income for another while they last. Your Administration level allows ' + t.slots + ' at a time and a commitment of up to ' + Math.round(t.maxCommit * 100) + '%. Turn one on to see what it does to the income in the milestone list and below. The size of the effect follows the commitment slider; the starting price (funds, reputation or science) scales with it too. Conversion rates and prices are the game’s; how each effect combines with the others was read from the code but not compared with a played save.' }),
        h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Strategy', 'Department', 'What it does', 'On', 'Commitment', 'Starting price'].map((x) => h('th', { text: x })))),
          h('tbody', {}, t.rows.map((r) => {
            const a = act(r.id);
            const on = h('input', { type: 'checkbox', 'aria-label': r.title + ' active' });
            on.checked = !!a;
            on.addEventListener('change', () => {
              s.strategies = (s.strategies || []).filter((x) => x.id !== r.id);
              if (on.checked) s.strategies.push({ id: r.id, factor: Math.min(0.05, t.maxCommit) });
              changed();
            });
            const f = a ? num(Math.round(a.factor * 100), (v) => { a.factor = Math.max(0, Math.min(t.maxCommit, v / 100)); changed(); }, { min: 0, step: 5, size: 4, label: r.title + ' commitment percent' }) : null;
            const cost = Career.strategyCost(r.id, a ? a.factor : 0);
            const priceText = [cost.funds ? money(cost.funds) + ' funds' : '', cost.rep ? cost.rep + ' reputation' : '', cost.sci ? cost.sci + ' science' : ''].filter(Boolean).join(', ') || 'free';
            return h('tr', {},
              h('td', { text: r.title + (r.allowed ? '' : ' (not offered at your reputation)') }), h('td', { text: r.dept }),
              h('td', { text: r.effects.map((e) => e.note).filter(Boolean).join('; ') }), h('td', {}, on), h('td', {}, f, f ? ' %' : null), h('td', { text: priceText }));
          })))),
        h('p', { class: 'hint', text: (s.strategies || []).length ? 'With your active strategies: ' + examples.map((e) => e[0] + ' changes by ' + say(effect(e[1]))).join('; ') + '.' : 'No strategy is active.' }));
    }

    // ---- contracts from the save ------------------------------------------------------------------------------
    function contractCard(c, s) {
      if (!s.contracts.length) return null;
      const adv = s.contracts.reduce((a, x) => a + x.advance, 0), rew = s.contracts.reduce((a, x) => a + x.reward, 0);
      const act = s.contracts.filter((x) => x.state === 'Active');
      return h('details', { class: 'card', open: true },
        h('summary', { text: 'Contracts in the save (' + s.contracts.length + ')' }),
        h('p', { class: 'hint', text: act.length + ' active, ' + (s.contracts.length - act.length) + ' offered. Rewards of the active ones add up to ' + money(act.reduce((a, x) => a + x.reward, 0)) + ' funds. Mission Control level ' + (s.facilities.MissionControl || 1) + ' allows ' + (Career.effects('MissionControl', s.facilities.MissionControl || 1)[0][1]) + ' at a time.' }),
        h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['State', 'Contract', 'Body', 'Advance', 'Reward', 'Penalty', 'Science', 'Rep', ''].map((t, i) => h('th', { class: i >= 3 && i < 8 ? 'num' : '', text: t })))),
          h('tbody', {}, s.contracts.map((x) => h('tr', {},
            h('td', { text: x.state }), h('td', { text: x.type.replace(/([a-z])([A-Z])/g, '$1 $2') }), h('td', { text: x.body }),
            h('td', { class: 'num', text: money(x.advance) }), h('td', { class: 'num', text: money(x.reward) }), h('td', { class: 'num', text: money(x.failure) }),
            h('td', { class: 'num', text: String(Math.round(x.sci * 10) / 10) }), h('td', { class: 'num', text: String(Math.round(x.rep * 10) / 10) }),
            h('td', {}, h('button', { class: 'btn small', type: 'button', onclick: () => {
              const d = dayOf(s);
              c.ledger.push({ id: c.nextId++, day: d + 20, label: x.type + (x.body ? ' ' + x.body : '') + ' contract reward', kind: 'contract', funds: x.reward, sci: x.sci, rep: x.rep });
              changed();
            } }, 'Plan reward'))))))),
        h('p', { class: 'hint', text: 'Advances (' + money(adv) + ' in total) were already paid when you accepted the active ones.' }));
    }

    render();
    return { update: render };
  }

  App.registerTab('career', 'Career', build, 'antennas');
})();
