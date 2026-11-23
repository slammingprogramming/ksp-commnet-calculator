// SPDX-License-Identifier: AGPL-3.0-or-later
/* Network plan tab: list what you want connected (stations, labs, bases, mines, rovers, aircraft), pick all-at-once or in stages, and
 * get a relay network that meets your uptime goal with what your career has unlocked, what it needs unlocking, and what it costs.
 * Also placement advice (station orbits, base sites, lander budgets) and where to earn the science and funds. Uses js/netplan.js. */
(function () {
  'use strict';

  const App = window.KSPApp;
  const Data = window.KSPData;
  const Core = window.KSPCore;
  const Orb = window.KSPOrbits;
  const Net = window.KSPNetPlan;
  const Career = window.KSPCareer;
  const Scn = window.KSPScenario;
  const h = App.h;

  const num = (value, onChange, o) => {
    const i = h('input', { type: 'number', value: value === null || value === undefined ? '' : String(value), step: (o && o.step) || 'any', size: (o && o.size) || 6, 'aria-label': (o && o.label) || 'number' });
    if (o && o.min !== undefined) i.min = o.min;
    if (o && o.max !== undefined) i.max = o.max;
    i.addEventListener('change', () => { const v = parseFloat(i.value); onChange(isFinite(v) ? v : null); });
    return i;
  };
  const text = (value, onChange, label) => {
    const i = h('input', { type: 'text', value: value || '', size: 16, 'aria-label': label || 'text' });
    i.addEventListener('change', () => onChange(i.value));
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
  const money = (x) => (x === null || x === undefined ? '—' : Math.round(x).toLocaleString('en-US'));
  const pc = (x) => (x === null || x === undefined ? '—' : (x * 100).toFixed(x > 0.99 ? 2 : 1) + '%');
  const km = (m) => Core.formatDistance(m);

  const ORBIT = (k) => Net.KINDS[k] && Net.KINDS[k].where === 'orbit';
  const LANDED = (k) => Net.KINDS[k] && Net.KINDS[k].where === 'landed';
  const ROAM = (k) => Net.KINDS[k] && Net.KINDS[k].where === 'roam';

  function build(root) {
    const st = App.state;
    const s = st.netplan;
    let job = null, result = null, cands = null;
    const sitesCard = h('div', { class: 'card' });
    const optsCard = h('div', { class: 'card' });
    const out = h('div', {});
    const placeCard = h('div', { class: 'card' });
    const earnCard = h('div', { class: 'card' });
    root.append(sitesCard, optsCard, out, placeCard, earnCard);

    const careerState = () => (s.useCareer && st.career && st.career.state ? st.career.state : null);
    const pool = () => App.enabledAntennas();
    const newId = () => 'site' + (s.nextId++);
    const saved = () => { App.saveState(); };

    function addSite(kind, extra) {
      const k = Net.KINDS[kind];
      const body = (extra && extra.body) || s.lastBody || 'Mun';
      const site = Object.assign({ id: newId(), name: k.label.split(' (')[0] + ' ' + s.nextId, kind: kind, body: body, stage: Net.autoStage(App.world, body), terrain: 'open', target: null, antennas: [] }, extra || {});
      if (k.where === 'orbit') Object.assign(site, { alt: site.alt || 80000, inc: site.inc || 0 }, extra || {});
      if (k.where === 'landed') Object.assign(site, { lat: 0, lon: 0 }, extra || {});
      if (k.where === 'roam') Object.assign(site, { samples: 8, latMax: 90, cruise: 5000 }, extra || {});
      s.sites.push(site);
      s.lastBody = body;
      saved();
      renderSites();
    }

    /* ---------- sites ---------- */

    function siteRow(site, i) {
      const k = Net.KINDS[site.kind];
      const ch = () => { saved(); result = null; out.replaceChildren(); };
      const bodySel = App.bodySelect(site.body, (v) => { site.body = v; site.stage = Net.autoStage(App.world, v); s.lastBody = v; ch(); renderSites(); });
      const kindSel = select(Object.keys(Net.KINDS).map((q) => [q, Net.KINDS[q].label]), site.kind, (v) => {
        site.kind = v;
        const w = Net.KINDS[v].where;
        if (w === 'orbit') Object.assign(site, { alt: site.alt || 80000, inc: site.inc || 0 });
        if (w === 'landed') Object.assign(site, { lat: site.lat || 0, lon: site.lon || 0 });
        if (w === 'roam') Object.assign(site, { samples: site.samples || 8, latMax: site.latMax == null ? 90 : site.latMax, cruise: site.cruise || 5000 });
        ch(); renderSites();
      }, 'Kind of site');
      const antSel = select([['', 'Automatic: the lightest that reaches']].concat(pool().filter((a) => !a.builtin && !a.ground).map((a) => [a.id, a.name])), (site.antennas && site.antennas[0] && site.antennas[0].id) || '',
        (v) => { site.antennas = v ? [{ id: v, count: Math.max(1, (site.antennas[0] && site.antennas[0].count) || 1) }] : []; ch(); }, 'Antenna');
      const where = [];
      if (ORBIT(site.kind)) {
        where.push(field('Altitude (km)', num(Math.round((site.alt || 0) / 100) / 10, (v) => { site.alt = v === null ? 80000 : Math.max(1, v) * 1000; ch(); }, { size: 6, min: 1, label: 'orbit altitude in km' })));
        where.push(field('Inclination (°)', num(site.inc || 0, (v) => { site.inc = v === null ? 0 : v; ch(); }, { size: 5, label: 'inclination' })));
      } else if (LANDED(site.kind)) {
        where.push(field('Latitude (°)', num(site.lat, (v) => { site.lat = v === null ? 0 : Math.max(-90, Math.min(90, v)); ch(); }, { size: 6, label: 'latitude' })));
        where.push(field('Longitude (°)', num(site.lon, (v) => { site.lon = v === null ? 0 : v; ch(); }, { size: 6, label: 'longitude' })));
      } else if (ROAM(site.kind)) {
        where.push(field('Points to cover', num(site.samples, (v) => { site.samples = v === null ? 8 : Math.max(2, Math.min(16, Math.round(v))); ch(); }, { size: 4, min: 2, max: 16, label: 'sample points' }), 'spread over the body'));
        where.push(field('Stay within latitude (°)', num(site.latMax, (v) => { site.latMax = v === null ? 90 : Math.max(5, Math.min(90, v)); ch(); }, { size: 4, label: 'latitude limit' })));
        if (k.flying) where.push(field('Cruise altitude (m)', num(site.cruise, (v) => { site.cruise = v === null ? 5000 : Math.max(0, v); ch(); }, { size: 6, label: 'cruise altitude' })));
      }
      return h('div', { class: 'siterow', style: 'border-top:1px solid var(--line, #8884);padding:8px 0' },
        h('div', { class: 'row' },
          field('Name', text(site.name, (v) => { site.name = v || site.name; ch(); }, 'site name')),
          field('Kind', kindSel), field('Body', bodySel),
          s.mode === 'stages' ? field('Stage', num(site.stage, (v) => { site.stage = v === null ? 1 : Math.max(1, Math.min(4, Math.round(v))); ch(); }, { size: 3, min: 1, max: 4, label: 'stage' })) : null),
        h('div', { class: 'row' }, ...where,
          (LANDED(site.kind) || ROAM(site.kind)) ? field('Terrain', select([['open', 'Open ground (the game’s rule)'], ['rolling', 'Rolling hills (5° mask)'], ['rugged', 'Rugged, cliffs (15° mask)'], ['crater', 'Inside a crater (30° mask)']], site.terrain || 'open', (v) => { site.terrain = v; ch(); }, 'Terrain'), 'the stock game ignores terrain') : null,
          field('Uptime goal %', num(site.target ? site.target * 100 : null, (v) => { site.target = v === null ? null : Math.max(1, Math.min(100, v)) / 100; ch(); }, { size: 5, label: 'uptime goal' }), 'blank = the global goal'),
          field('Antenna', antSel),
          h('button', { class: 'btn small', type: 'button', onclick: () => { s.sites.splice(i, 1); ch(); renderSites(); } }, 'Remove')));
    }

    function renderSites() {
      const adds = Object.keys(Net.KINDS).map((k) => h('button', { class: 'btn small', type: 'button', onclick: () => addSite(k) }, '+ ' + Net.KINDS[k].label.split(' (')[0]));
      sitesCard.replaceChildren(...[
        h('h2', { text: 'Network plan' }),
        h('p', { class: 'hint', text: 'List what has to stay connected. The generator designs the relays that keep every site above its uptime goal, using the same simulation as the Relay planner, then checks what your career has unlocked and what the plan needs on top. Stock CommNet only blocks signals with whole bodies, so the terrain setting is a margin for mods and for caution, not a game rule.' }),
        h('div', { class: 'row' }, ...adds),
        h('div', { class: 'row', style: 'margin-top:6px' },
          h('button', { class: 'btn small', type: 'button', onclick: exampleSites }, 'Example: Mun station, far-side base, rover'),
          s.sites.length ? h('button', { class: 'btn small', type: 'button', onclick: () => { s.sites = []; saved(); result = null; out.replaceChildren(); renderSites(); } }, 'Clear the list') : null),
        s.sites.length ? h('div', {}, ...s.sites.map(siteRow)) : h('p', { class: 'hint', text: 'No sites yet. Add one above, or load the example.' })].filter(Boolean));
    }

    function exampleSites() {
      s.sites = []; s.nextId = 1;
      addSite('station', { name: 'Mun station', body: 'Mun', alt: 80000, inc: 0, stage: 1 });
      addSite('base', { name: 'Far-side base', body: 'Mun', lat: 5, lon: 227, stage: 1 });
      addSite('rover', { name: 'Mun rovers', body: 'Mun', latMax: 40, terrain: 'rolling', stage: 1, samples: 6 });
    }

    /* ---------- options ---------- */

    function renderOptions() {
      const c = st.career && st.career.state;
      const stat = Net.antennaStatus(careerState(), pool());
      const have = stat.filter((r) => r.status === 'have' || r.status === 'mod').length;
      optsCard.replaceChildren(...[
        h('div', { class: 'row' },
          field('Build', select([['stages', 'In stages (each stage keeps the last one’s relays)'], ['all', 'All at once']], s.mode, (v) => { s.mode = v; saved(); renderSites(); }, 'Build mode')),
          field('Look ahead', select([['0.25', '3 months'], ['1', '1 year'], ['2', '2 years'], ['4', '4 years']], String(s.horizon), (v) => { s.horizon = parseFloat(v); saved(); }, 'Look ahead')),
          field('Uptime goal %', num(s.target, (v) => { s.target = v === null ? 99.5 : Math.max(50, Math.min(100, v)); saved(); }, { size: 5, label: 'global uptime goal' })),
          field('Weakest usable signal %', num(s.minSignal, (v) => { s.minSignal = v === null ? 20 : Math.max(0, Math.min(100, v)); saved(); }, { size: 5, label: 'weakest signal' }))),
        h('label', { class: 'inline', style: 'color:var(--text);display:flex' },
          (() => { const i = h('input', { type: 'checkbox', 'aria-label': 'use the career unlocks' }); i.checked = !!s.useCareer; i.addEventListener('change', () => { s.useCareer = i.checked; saved(); renderOptions(); }); return i; })(),
          'Use what my career has unlocked' + (c ? '' : ' (no career loaded on the Career tab: everything counts as unlocked)')),
        c && s.useCareer ? h('p', { class: 'hint', text: have + ' of ' + stat.length + ' antennas are usable now. Anything better the plan needs is listed with its research and price. The Tracking Station is level ' + (c.facilities.TrackingStation || 1) + (c.facilities.TrackingStation !== st.settings.dsnLevel ? '; the game settings use DSN level ' + st.settings.dsnLevel + ' (the plan uses the settings).' : '.') }) : null,
        h('div', { class: 'row', style: 'margin-top:8px' }, runBtn(), cancelBtn()), bar(), prog,
        h('p', { class: 'hint', text: 'A plan is one relay-planner run per stage (more if it has to check what unlocking would give), so several stages can take a few minutes. It all runs here, in the page.' })].filter(Boolean));
    }
    const prog = h('div', { class: 'hint', role: 'status', 'aria-live': 'polite' });
    const barEl = h('div', { class: 'meter', hidden: true }, h('i', { style: 'width:100%;background:var(--accent);opacity:0.6' }));
    const bar = () => barEl;
    const runB = h('button', { class: 'btn primary', type: 'button' }, 'Generate the network');
    const cancelB = h('button', { class: 'btn', type: 'button', hidden: true }, 'Cancel');
    const runBtn = () => runB;
    const cancelBtn = () => cancelB;

    function problem() {
      return {
        world: App.world, lookup: App.lookup, settings: App.simSettings(), sites: JSON.parse(JSON.stringify(s.sites)), mode: s.mode, t0: st.scenario.ut,
        horizon: s.horizon * Data.YEAR, target: s.target / 100, minSignal: s.minSignal / 100, antennas: pool(), career: careerState(), dsnLevel: st.settings.dsnLevel, robust: true,
      };
    }

    runB.addEventListener('click', () => {
      if (!s.sites.length) { prog.textContent = 'Add at least one site first.'; return; }
      const P = problem();
      result = null; out.replaceChildren();
      runB.disabled = true; cancelB.hidden = false; barEl.hidden = false;
      const started = Date.now();
      let phaseText = 'Starting';
      P.onPhase = (t) => { phaseText = t; };
      const gen = Net.planGen(P);
      job = gen;
      (function tick() {
        if (job !== gen) return;
        const stop = Date.now() + 30;
        let r;
        do { r = gen.next(); } while (!r.done && Date.now() < stop);
        prog.textContent = phaseText + '… ' + Math.round((Date.now() - started) / 1000) + ' s';
        if (!r.done) { setTimeout(tick, 0); return; }
        job = null;
        runB.disabled = false; cancelB.hidden = true; barEl.hidden = true; prog.textContent = '';
        result = { res: r.value, P: P, rev: App.rev() };
        renderResult();
      })();
    });
    cancelB.addEventListener('click', () => { job = null; runB.disabled = false; cancelB.hidden = true; barEl.hidden = true; prog.textContent = 'Cancelled.'; });

    /* ---------- result ---------- */

    function orbitText(n) {
      const w = App.world, b = w.index.get(n.loc.body), o = n.loc.orbit;
      const phase = (((o.m0 / Orb.DEG) % 360) + 360) % 360;
      return b.name + ' ' + km(o.a * (1 - o.e) - b.radius) + (o.e > 1e-4 ? ' × ' + km(o.a * (1 + o.e) - b.radius) : '') + ', inc ' + o.i.toFixed(1) + '°, LAN ' + o.lan.toFixed(1) + '°, phase ' + phase.toFixed(1) + '°';
    }
    const antText = (n) => n.antennas.map((a) => a.count + '× ' + (App.lookup(a.id) ? App.lookup(a.id).name : a.id)).join(' + ');

    function planText(r) {
      const lines = ['KSP CommNet Workbench network plan', 'Sites: ' + s.sites.map((x) => x.name + ' (' + Net.KINDS[x.kind].label.split(' (')[0].toLowerCase() + ', ' + x.body + ')').join('; '), ''];
      for (const g of r.res.stages) {
        lines.push('Stage ' + g.stage + (g.ok ? ': goal met' : ': goal NOT met (worst ' + pc(g.worst) + ')') + ', worst site ' + pc(g.worst) + ', ' + g.planned.length + ' new relay' + (g.planned.length === 1 ? '' : 's') + ', ' + money(g.funds) + ' funds' + (g.science ? ', ' + money(g.science) + ' science' : ''));
        g.per.forEach((p) => lines.push('  - ' + p.site.name + ': ' + pc(p.uptime) + ' (goal ' + pc(p.goal) + ')'));
        g.planned.forEach((n) => lines.push('  + ' + n.name + ': ' + orbitText(n) + '; ' + antText(n)));
        if (g.upgrade) lines.push('  Unlock: ' + g.upgrade.antennas.map((id) => (App.lookup(id) || { name: id }).name).join(', ') + ' (research ' + g.upgrade.nodes.map((n) => n.title).join(', ') + '; ' + money(g.upgrade.science) + ' science, ' + money(g.upgrade.funds) + ' funds for the parts)');
        if (g.dsn) lines.push('  Upgrade the Tracking Station to level ' + g.dsn.to + (g.dsn.funds ? ' (' + money(g.dsn.funds) + ' funds)' : ''));
        lines.push('');
      }
      lines.push('Total: ' + r.res.totals.relays + ' relays, ' + money(r.res.totals.funds) + ' funds (relay antennas plus a ' + money(r.res.bus) + '-fund bus each, no launch), ' + money(r.res.totals.science) + ' science');
      return lines.join('\n');
    }
    function copyText(t, btn) {
      const done = () => { const old = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = old; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => window.prompt('Copy the plan:', t));
      else window.prompt('Copy the plan:', t);
    }

    function toScenario(r) {
      const w = App.world;
      const sc = st.scenario;
      const orbitLoc = (n) => { const b = w.index.get(n.loc.body), o = n.loc.orbit; return { type: 'orbit', body: b.id, pe: o.a * (1 - o.e) - b.radius, ap: o.a * (1 + o.e) - b.radius, i: o.i, lan: o.lan, w: o.w, phase: (((o.m0 / Orb.DEG) % 360) + 360) % 360 }; };
      const nodes = [];
      for (const n of r.res.relays) nodes.push(Scn.newNode({ name: n.name, tracked: false, planned: true, group: n.group, antennas: JSON.parse(JSON.stringify(n.antennas)), loc: orbitLoc(n) }));
      const sn = Net.siteNodes(w, s.sites, pool(), st.settings.rangeMod);
      for (const n of sn) nodes.push(Scn.newNode({ name: n.name, tracked: true, antennas: JSON.parse(JSON.stringify(n.antennas)), loc: n.loc.type === 'orbit' ? orbitLoc(n) : { type: 'landed', body: n.loc.body, lat: n.loc.lat, lon: n.loc.lon, alt: n.loc.alt || 0 } }));
      sc.nodes = sc.nodes.filter((n) => !n.planned).concat(nodes);
      App.saveState();
      App.rebuildAll();
    }

    function renderResult() {
      if (!result) { out.replaceChildren(); return; }
      const r = result.res;
      if (r.error) { out.replaceChildren(h('div', { class: 'card' }, h('p', { text: r.error }))); return; }
      const cs = careerState();
      const fund = Net.fundingCheck(cs, r);
      const cards = [h('div', { class: 'card' },
        h('h2', { text: 'Your network' }),
        h('p', { text: r.stages.length + ' stage' + (r.stages.length === 1 ? '' : 's') + ', ' + r.totals.relays + ' new relays, about ' + money(r.totals.funds) + ' funds' + (r.totals.science ? ' and ' + money(r.totals.science) + ' science of research' : '') + ' (relay antennas, a small relay bus each, and what has to be unlocked; launches are not included).' }),
        cs ? h('p', { class: fund.shortFunds || fund.shortScience ? 'warn' : 'hint', text: 'Your career holds ' + money(fund.haveFunds) + ' funds and ' + money(fund.haveScience) + ' science' + (fund.shortFunds || fund.shortScience ? ': short by ' + (fund.shortFunds ? money(fund.shortFunds) + ' funds' : '') + (fund.shortFunds && fund.shortScience ? ' and ' : '') + (fund.shortScience ? money(fund.shortScience) + ' science' : '') + '. See “Where to earn it” below.' : ': enough for the whole plan.') }) : null,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => toScenario(result) }, 'Put the sites and relays in the Scenario'),
          h('button', { class: 'btn', type: 'button', onclick: (e) => copyText(planText(result), e.target) }, 'Copy the plan as text')))];
      for (const g of r.stages) {
        const rows = g.per.map((p) => h('tr', {}, h('td', { text: p.site.name }), h('td', { text: Net.KINDS[p.site.kind].label.split(' (')[0] + ' · ' + p.site.body }), h('td', { text: pc(p.uptime) }), h('td', { text: pc(p.goal) }),
          h('td', { text: p.met ? 'met' : 'not met' }), h('td', { text: p.longest ? Orb.formatDuration(p.longest) : '—' })));
        const relayRows = g.planned.map((n) => h('tr', {}, h('td', { text: n.name }), h('td', { text: orbitText(n) }), h('td', { text: antText(n) })));
        const miss = g.per.filter((p) => !p.met && p.site.terrain && p.site.terrain !== 'open' && Net.KINDS[p.site.kind].where === 'landed');
        const high = miss.map((p) => ({ p: p, spots: Net.highGround(p.site.body, p.site.lat, p.site.lon, 150) })).filter((x) => x.spots.length);
        cards.push(h('div', { class: 'card' },
          h('h3', { text: (r.stages.length > 1 || s.mode === 'stages' ? 'Stage ' + g.stage + ': ' : '') + (g.ok ? 'goal met' : 'goal not met') }),
          h('p', { class: 'hint', text: 'Worst site ' + pc(g.worst) + ', mean ' + pc(g.mean) + '. ' + g.planned.length + ' new relay' + (g.planned.length === 1 ? '' : 's') + ', ' + money(g.cost.funds) + ' funds in relay hardware' + (g.funds > g.cost.funds ? ' + ' + money(g.funds - g.cost.funds) + ' to unlock' : '') + '.' }),
          h('table', {}, h('thead', {}, h('tr', {}, ...['Site', 'Kind · body', 'Uptime', 'Goal', 'Result', 'Longest outage'].map((t) => h('th', { text: t })))), h('tbody', {}, ...rows)),
          relayRows.length ? h('table', { style: 'margin-top:8px' }, h('thead', {}, h('tr', {}, ...['New relay', 'Orbit', 'Antennas'].map((t) => h('th', { text: t })))), h('tbody', {}, ...relayRows)) : h('p', { class: 'hint', text: 'No new relays needed for this stage.' }),
          g.upgrade ? h('p', { text: 'To build this stage you need to unlock ' + g.upgrade.antennas.map((id) => (App.lookup(id) || { name: id }).name).join(', ') + ': research ' + g.upgrade.nodes.map((n) => n.title + ' (' + n.cost + ')').join(', ') + ' for ' + money(g.upgrade.science) + ' science, and buy the parts for ' + money(g.upgrade.funds) + ' funds.' }) : null,
          g.dsn ? h('p', { text: 'The goal also needs the Tracking Station at level ' + g.dsn.to + (g.dsn.funds ? ' (' + money(g.dsn.funds) + ' funds)' : '') + ': the stronger ground link carries the far relays.' }) : null,
          !g.ok && g.advice && g.advice.length ? h('p', { class: 'hint', text: 'What the relay planner could not fix: ' + g.advice.filter((a) => a.kind === 'nofix').map((a) => a.cause.id).join(', ') + '. See the Relay planner tab for each cause.' }) : null,
          high.length ? h('p', { text: 'Terrain shadow is what holds ' + high.map((x) => x.p.site.name).join(', ') + ' back. A relay lander on high ground nearby sees more sky: ' + high[0].spots.map((q) => fmt(q.lat, 1) + '°, ' + fmt(q.lon, 1) + '° (' + fmt(q.alt) + ' m, ' + q.biome + ')').join('; ') + '.' }) : null));
      }
      out.replaceChildren(...cards);
    }

    /* ---------- placement ---------- */

    function renderPlace() {
      const pl = s.place;
      const body = App.world.index.get(pl.body);
      const lats = s.sites.filter((x) => x.body === pl.body && LANDED(x.kind)).map((x) => x.lat);
      const opts = body ? Net.stationOptions(App.world, pl.body, lats) : [];
      const lander = opts.length ? Net.landerBudget(App.world, pl.body, opts[0].alt, { isp: pl.isp, dry: pl.dry }) : null;
      const tbl = opts.length ? h('table', {}, h('thead', {}, h('tr', {}, ...['Altitude', 'Inclination', 'Space band', 'Science ×', 'Period', 'Land from it', 'Back up to it', 'Why'].map((t) => h('th', { text: t })))),
        h('tbody', {}, ...opts.map((o) => h('tr', {}, h('td', { text: km(o.alt) }), h('td', { text: o.inc + '°' }), h('td', { text: o.band }), h('td', { text: fmt(o.multiplier, 2) }), h('td', { text: Orb.formatDuration(o.period) }),
          h('td', { text: o.dvDown === null ? '—' : fmt(o.dvDown) + ' m/s' }), h('td', { text: o.dvUp === null ? 'set on the Missions tab' : fmt(o.dvUp) + ' m/s' }), h('td', { text: o.why }))))) : null;
      const candBox = h('div', {});
      const find = h('button', { class: 'btn', type: 'button' }, 'Find base or mine sites on ' + (body ? body.name : '…'));
      const candProg = h('span', { class: 'hint', role: 'status' });
      find.addEventListener('click', () => {
        if (!body) return;
        find.disabled = true; candProg.textContent = 'Looking…';
        const relays = result && result.res.relays ? result.res.relays.filter((n) => true) : [];
        const gen = Net.baseCandidates({ world: App.world, lookup: App.lookup, settings: App.simSettings(), relays: relays, t0: st.scenario.ut, minSignal: s.minSignal / 100, power: 2e9 }, pl.body, { maxLat: pl.maxLat || 90 });
        (function tick() {
          const stop = Date.now() + 30;
          let r;
          do { r = gen.next(); } while (!r.done && Date.now() < stop);
          if (!r.done) { setTimeout(tick, 0); return; }
          find.disabled = false; candProg.textContent = '';
          cands = { body: pl.body, res: r.value, withRelays: relays.length };
          renderPlace();
        })();
      });
      const shown = cands && cands.body === pl.body ? cands : null;
      const candTbl = shown && shown.res.rows && shown.res.rows.length ? h('table', {}, h('thead', {}, h('tr', {}, ...['Where', 'Biome', 'Height', 'Flat ground', 'Biomes in reach', 'Sees the network', 'Score', ''].map((t) => h('th', { text: t })))),
        h('tbody', {}, ...shown.res.rows.slice(0, 8).map((r) => h('tr', {}, h('td', { text: fmt(r.lat, 1) + '°, ' + fmt(r.lon, 1) + '°' }), h('td', { text: r.biome }), h('td', { text: r.alt === null ? '—' : fmt(r.alt) + ' m' }),
          h('td', { text: pc(r.stayShare) }), h('td', { text: String(r.variety) }), h('td', { text: pc(r.link) }), h('td', { text: fmt(r.score * 100) }),
          h('td', {}, h('button', { class: 'btn small', type: 'button', onclick: () => { addSite('base', { body: pl.body, lat: Math.round(r.lat * 100) / 100, lon: Math.round(r.lon * 100) / 100, name: 'Base ' + r.biome }); } }, 'Add as base')))))) : null;
      placeCard.replaceChildren(...[
        h('h2', { text: 'Where to put things' }),
        h('p', { class: 'hint', text: 'Station and lab orbits (the body’s science multiplier differs between low and high space), the delta-v of a reusable lander from there, and the best places for a base or a mine: flat ground with several biomes in reach, scored by how well it sees the network and how cheap it is to reach from orbit. Ore concentration maps are not in the game files this app reads, so for a mine take the spot from your own scanner and add it as a mining site.' }),
        h('div', { class: 'row' }, field('Body', App.bodySelect(pl.body, (v) => { pl.body = v; saved(); renderPlace(); })),
          field('Lander engine Isp (s)', num(pl.isp, (v) => { pl.isp = v === null ? 345 : Math.max(50, v); saved(); renderPlace(); }, { size: 5, label: 'Isp' }), 'vacuum'),
          field('Lander dry mass (t)', num(pl.dry, (v) => { pl.dry = v === null ? 5 : Math.max(0.1, v); saved(); renderPlace(); }, { size: 5, label: 'dry mass' })),
          field('Base latitude limit (°)', num(pl.maxLat, (v) => { pl.maxLat = v === null ? 90 : Math.max(0, Math.min(90, v)); saved(); }, { size: 4, label: 'latitude limit' }))),
        opts.length ? h('div', {}, h('h3', { text: 'Station and lab orbits' }), tbl) : h('p', { class: 'hint', text: 'No orbit options for this body.' }),
        lander && !lander.error ? h('p', { text: 'A ' + fmt(pl.dry, 1) + ' t reusable lander at ' + fmt(pl.isp) + ' s needs about ' + fmt(lander.propTrip, 2) + ' t of propellant for the trip down and back up (' + fmt(lander.propDown, 2) + ' t down, ' + fmt(lander.propUp, 2) + ' t up). To refuel the ascent on the surface takes ' + fmt(lander.oreForUp) + ' ore (' + fmt(lander.oreForUp * 0.01, 2) + ' t), about ' + fmt(lander.refuelHours * 60) + ' minutes of one large converter at its full rate, if the drills keep up. The ratios are the game’s own: 0.5 ore per second becomes 0.45 liquid fuel and 0.55 oxidizer.' }) : (lander ? h('p', { class: 'hint', text: 'Lander figures need a default ascent allowance this body does not have (' + lander.error + '); use the Missions tab.' }) : null),
        h('div', { class: 'row', style: 'margin-top:8px' }, find, candProg),
        shown ? (candTbl || h('p', { class: 'hint', text: 'No flat enough ground found with these limits.' })) : null,
        shown ? h('p', { class: 'hint', text: 'Link scores use ' + (shown.withRelays ? 'the relays of the plan above' : 'the ground stations only, no relays yet: generate a network first to see it with relays') + ', over one rotation of the body. Slopes are regional, not ground level (see the Landing tab).' }) : null].filter(Boolean));
    }

    /* ---------- earning ---------- */

    let earn = null;
    function renderEarn() {
      const btn = h('button', { class: 'btn', type: 'button' }, 'Work out where to earn science');
      btn.addEventListener('click', () => {
        btn.disabled = true;
        setTimeout(() => {
          const ids = App.world.bodies.filter((b) => !b.star && b.pack === 'stock' && b.id !== 'Kerbin' && b.id !== 'Jool').map((b) => b.id);
          earn = Net.earnTable(App.world, ids, st.scenario.ut);
          renderEarn();
        }, 20);
      });
      const tbl = earn ? h('table', {}, h('thead', {}, h('tr', {}, ...['Body', 'Science if each experiment is done once at each place', 'Most it can ever give', 'Delta-v from low Kerbin orbit', 'Science per km/s', 'Trip'].map((t) => h('th', { text: t })))),
        h('tbody', {}, ...earn.map((r) => h('tr', {}, h('td', { text: r.body }), h('td', { text: fmt(r.first) }), h('td', { text: fmt(r.total) }), h('td', { text: r.dv === null ? r.error : fmt(r.dv) + ' m/s' + (r.partial ? ' (no ascent)' : '') }),
          h('td', { text: r.perKms ? fmt(r.perKms) : '—' }), h('td', { text: r.days ? fmt(r.days) + ' days' : '—' }))))) : null;
      earnCard.replaceChildren(...[
        h('h2', { text: 'Where to earn it' }),
        h('p', { class: 'hint', text: 'Science from landing, ranked against the delta-v it takes to arrive, land and get back to orbit (two-body, from a 100 km orbit of Kerbin, from the Missions tab’s own legs). Bodies with a thick atmosphere show the trip down only: nobody can give a default ascent allowance without flying it. Funds come from contracts and the World First milestones (Career tab), and from recovering what you fly. Seismometer crashes are planned on the Landing tab.' }),
        btn, tbl].filter(Boolean));
    }

    renderSites(); renderOptions(); renderPlace(); renderEarn();
    return {
      update: function () {
        if (result && result.rev !== App.rev()) { /* settings changed: keep the result, it says what it was made with */ }
        renderOptions();
      },
      hide: function () { /* a running plan keeps going */ },
    };
  }

  App.registerTab('netplan', 'Network plan', build, 'network');
})();
