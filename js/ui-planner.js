// SPDX-License-Identifier: AGPL-3.0-or-later
/* Relay planner tab: diagnose the scenario's blackouts, design structural fixes, verify and size them. */
(function () {
  'use strict';

  const App = window.KSPApp;
  const Data = window.KSPData;
  const Core = window.KSPCore;
  const Orb = window.KSPOrbits;
  const Pl = window.KSPPlanner;
  const Scn = window.KSPScenario;
  const h = App.h;

  const HORIZONS = [['1 year', 1], ['2 years', 2], ['4 years', 4], ['8 years', 8]];
  const YEAR = Data.YEAR;

  const pct = (x) => (x * 100).toFixed(x > 0.99 ? 2 : 1) + '%';

  function explain(step) {
    const p = step.proposal;
    const body = p.body;
    if (p.family === 'solar') {
      return 'Kerbol sits between Kerbin and your vessel at conjunction, and no relay near either end can see around it. Relays in an orbit identical to Kerbin’s but 60° ahead or behind keep that position relative to Kerbin permanently (same period, so they never drift) and always have a clear view of both Kerbin and the far side. Because the geometry never changes, this fix does not expire.';
    }
    if (body === 'Kerbin') {
      return 'Kerbin’s night side hides the ground station from the outer sky. Relays orbiting Kerbin keep a clear view of both the station and the direction of your vessel, so the outage stops depending on the time of day. A single ground-based antenna can never solve this; the fix has to be in orbit.';
    }
    return p.cfg.n + ' relays around ' + body + ' guarantee at least one is in view from every point of its surface and from the space around it. The design is tested against eight sample landing sites, not just today’s vessel, so future landers and bases are covered too.';
  }

  function build(root) {
    const st = App.state;
    const pp = st.planner;
    let job = null;
    let result = null; // {plan, rev}
    let coverage = null;

    const opts = h('div', { class: 'card' });
    const whatifCard = h('div', { class: 'card' });
    const out = h('div', {});
    root.append(opts, whatifCard, out);

    /** Run a generator in ~30 ms slices; calls progress(value) and done(result). Returns a cancel function. */
    function slice(gen, progress, done) {
      let live = true;
      (function tick() {
        if (!live) return;
        const stop = Date.now() + 30;
        let r;
        do { r = gen.next(); } while (!r.done && Date.now() < stop);
        if (!r.done) { if (progress) progress(r.value); setTimeout(tick, 0); return; }
        done(r.value);
      })();
      return () => { live = false; };
    }

    /* ---------- "what if I add this relay?" ---------- */

    function renderWhatIf() {
      const w = pp.whatif;
      const body = App.bodySelect(w.body, (v) => { w.body = v; App.saveState(); }, {});
      const count = h('input', { type: 'number', min: 1, max: 8, step: 1, value: w.n, 'aria-label': 'Number of relays' });
      count.addEventListener('input', () => { const v = parseInt(count.value, 10); if (v >= 1 && v <= 8) { w.n = v; App.saveState(); } });
      const alt = h('input', { type: 'text', value: w.alt, size: 12, spellcheck: 'false', 'aria-label': 'Altitude, for example 2863 km' });
      alt.addEventListener('input', () => { w.alt = alt.value; App.saveState(); });
      const inc = h('select', { 'aria-label': 'Orbit inclination' }, h('option', { value: '0', text: 'Equatorial' }), h('option', { value: '90', text: 'Polar' }));
      inc.value = String(w.inc);
      inc.addEventListener('change', () => { w.inc = parseFloat(inc.value); App.saveState(); });
      const go = h('button', { class: 'btn primary', type: 'button' }, 'Test it');
      const res = h('div', { 'aria-live': 'polite', style: 'margin-top:10px' });
      go.addEventListener('click', () => {
        const b = App.world.index.get(w.body);
        const a = Core.parseDistance(alt.value);
        if (!b || b.star || !(a > 0)) { res.replaceChildren(h('p', { class: 'bad', text: 'Pick a planet or moon and an altitude such as 2863 km.' })); return; }
        const lim = App.world.altitudeLimits(b.id);
        if (a < lim.min || a > lim.max) { res.replaceChildren(h('p', { class: 'bad', text: 'Altitude must be between ' + Core.formatDistance(lim.min) + ' and ' + Core.formatDistance(lim.max) + ' for ' + b.name + '.' })); return; }
        const P = problem();
        if (!P.nodes.some((n) => n.tracked !== false && !n.planned)) { res.replaceChildren(h('p', { class: 'hint', text: 'Add a tracked vessel on the Scenario tab first.' })); return; }
        go.disabled = true;
        const extra = Pl.ringNodes(App.world, b.id, w.n, a, w.inc, 0, 0, JSON.parse(JSON.stringify(w.antennas)), 'whatif', 'Test relay').map((n) => Object.assign(n, { tracked: false }));
        const jobs = [P, Object.assign({}, P, { nodes: P.nodes.concat(extra) })];
        const outs = [];
        const next = () => {
          if (outs.length === jobs.length) {
            go.disabled = false;
            showWhatIf(res, outs[0], outs[1], P, w.n + ' relay' + (w.n > 1 ? 's' : '') + ' around ' + b.name + ' at ' + Core.formatDistance(a));
            return;
          }
          res.replaceChildren(h('p', { class: 'hint', text: outs.length === 0 ? 'Simulating today’s network…' : 'Simulating with the extra relays…' }));
          slice(Pl.evaluateGen(jobs[outs.length]), null, (r) => { outs.push(r); next(); });
        };
        next();
      });
      whatifCard.replaceChildren(
        h('h3', { text: 'What if I add a relay?' }),
        h('p', { class: 'hint', text: 'Try your own idea in seconds: put a ring of relays around a body and see what it does to every tracked vessel, using the same look-ahead as the planner.' }),
        h('div', { class: 'row' },
          h('div', { class: 'field' }, h('label', { text: 'Around' }), body),
          h('div', { class: 'field' }, h('label', { text: 'How many' }), count),
          h('div', { class: 'field' }, h('label', { text: 'Altitude' }), alt),
          h('div', { class: 'field' }, h('label', { text: 'Orbit' }), inc)),
        h('div', { class: 'field', style: 'margin-top:10px' }, h('label', { text: 'Each relay carries' }), App.antennaEditor(w.antennas, () => App.saveState())),
        h('div', { class: 'row', style: 'margin-top:10px' }, go), res);
    }

    function showWhatIf(box, before, after, P, label) {
      const rows = after.sources.map((s, i) => {
        const b = before.sources[i];
        return h('tr', {},
          h('td', { text: s.name }),
          h('td', { class: 'num', style: 'color:' + App.sigInk(b.uptime), text: pct(b.uptime) }),
          h('td', { class: 'num', style: 'font-weight:700;color:' + App.sigInk(s.uptime), text: pct(s.uptime) }),
          h('td', { class: 'num', text: Orb.formatDuration(b.longestBlackout) + ' → ' + Orb.formatDuration(s.longestBlackout) }));
      });
      const left = after.causes.causes.slice(0, 4).map((c) => (c.type === 'occlusion' ? 'blocked by ' + c.body : c.type === 'range' ? 'out of range' : 'signal too weak') + ' ' + Math.round((c.time / Math.max(1, after.causes.total)) * 100) + '%');
      box.replaceChildren(
        h('p', { class: 'verdict', text: label + ': worst vessel ' + pct(before.worst) + ' → ' + pct(after.worst) }),
        h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { text: 'Vessel' }), h('th', { class: 'num', text: 'Before' }), h('th', { class: 'num', text: 'With the relays' }), h('th', { class: 'num', text: 'Longest blackout' }))),
          h('tbody', {}, rows))),
        h('p', { class: 'hint', text: left.length ? 'What still goes wrong: ' + left.join(', ') + '.' : 'No blackouts left in this period.' }));
      void P;
    }

    function nodeToScenario(n) {
      const w = App.world;
      const b = w.index.get(n.loc.body);
      const o = n.loc.orbit;
      return Scn.newNode({
        name: n.name, tracked: false, planned: true, group: n.group, antennas: JSON.parse(JSON.stringify(n.antennas)),
        loc: { type: 'orbit', body: b.id, pe: o.a * (1 - o.e) - b.radius, ap: o.a * (1 + o.e) - b.radius, i: o.i, lan: o.lan, w: o.w, phase: (((o.m0 / Orb.DEG) % 360) + 360) % 360 },
      });
    }

    /** Plain-text summary of a plan: causes, fixes, and each relay's orbit and antennas. */
    function planText(plan) {
      const w = App.world;
      const pc = (x) => (x * 100).toFixed(2) + '%';
      const lines = ['KSP CommNet Workbench relay plan', Orb.formatUT(plan.t0) + ' to ' + Orb.formatUT(plan.t1), ''];
      lines.push('Uptime (worst tracked vessel): ' + pc(plan.baseline.sources.reduce((m, s) => Math.min(m, s.uptime), 1)) + ' -> ' + pc(plan.final.sources.reduce((m, s) => Math.min(m, s.uptime), 1)));
      lines.push('Why it fails today: ' + (plan.baselineCauses.causes.map((c) => (c.type === 'occlusion' ? 'blocked by ' + c.body : c.type) + ' ' + Math.round((c.time / plan.baselineCauses.total) * 100) + '%').join(', ') || 'no blackouts'));
      lines.push('');
      plan.steps.forEach((s, i) => lines.push((i + 1) + '. ' + s.proposal.title + ': ' + s.proposal.detail + ' (' + pc(s.before) + ' -> ' + pc(s.after) + ')'));
      lines.push('', 'Relays:');
      for (const n of plan.planned) {
        const b = w.index.get(n.loc.body), o = n.loc.orbit;
        const ants = n.antennas.map((a) => a.count + 'x ' + (App.lookup(a.id) ? App.lookup(a.id).name : a.id)).join(' + ');
        lines.push('- ' + n.name + ': orbit ' + b.name + ' ' + (b.star ? 'distance ' + Core.formatDistance(o.a) : 'altitude ' + Core.formatDistance(o.a * (1 - o.e) - b.radius) + ' x ' + Core.formatDistance(o.a * (1 + o.e) - b.radius)) +
          ', inclination ' + o.i.toFixed(1) + ' deg, LAN ' + o.lan.toFixed(1) + ' deg, phase at UT 0 ' + ((((o.m0 / Orb.DEG) % 360) + 360) % 360).toFixed(1) + ' deg; antennas ' + ants);
      }
      const groups = Array.from(new Set(plan.planned.map((n) => n.group)));
      const hints = groups.map((g) => Pl.deployHint(w, plan.planned.filter((n) => n.group === g))).filter(Boolean);
      if (hints.length) {
        lines.push('', 'Getting them there (two-body estimates):');
        hints.forEach((hh) => Pl.deployText(hh, Core.formatDistance, Orb.formatDuration).forEach((t) => lines.push('- ' + (hh.solar ? 'Solar relays: ' : hh.body + ' relays: ') + t)));
      }
      lines.push('', 'Stress test: ' + plan.stress.map((s) => s.preset.name + ' ' + pc(s.baselineUptime) + ' -> ' + pc(s.uptime)).join('; '));
      return lines.join('\n');
    }
    function copyText(text, btn) {
      const done = () => { const old = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = old; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => window.prompt('Copy the plan:', text));
      else window.prompt('Copy the plan:', text);
    }

    function designSettings() {
      const s = App.simSettings();
      if (pp.designHard) { s.occVac = 1; s.occAtm = 1; s.rangeMod = Math.min(s.rangeMod, 0.65); }
      return s;
    }

    /** Scenario nodes for the planner: vessels the user unticked stay in the network (their antennas still relay) but are not goals. */
    function plannerNodes() {
      return Scn.simNodes().map((n) => (pp.skip && pp.skip[n.id] && n.tracked !== false && !n.planned ? Object.assign({}, n, { tracked: false }) : n));
    }

    function problem() {
      return {
        world: App.world, lookup: App.lookup, settings: designSettings(), nodes: plannerNodes(), t0: st.scenario.ut, horizon: pp.horizon * YEAR,
        target: pp.target / 100, minSignal: pp.minSignal / 100, pool: App.enabledAntennas(), robust: pp.robust,
      };
    }

    function renderOptions() {
      const hz = h('select', { 'aria-label': 'Planning horizon' }, HORIZONS.map((x) => h('option', { value: String(x[1]), text: x[0] })));
      hz.value = String(pp.horizon);
      hz.addEventListener('change', () => { pp.horizon = parseFloat(hz.value); App.saveState(); });
      const target = h('input', { type: 'number', min: 50, max: 100, step: 0.1, value: pp.target, 'aria-label': 'Target uptime %' });
      target.addEventListener('input', () => { const v = parseFloat(target.value); if (v > 0) { pp.target = v; App.saveState(); } });
      const minSig = h('input', { type: 'number', min: 0, max: 90, step: 5, value: pp.minSignal, 'aria-label': 'Minimum acceptable signal %' });
      minSig.addEventListener('input', () => { const v = parseFloat(minSig.value); if (v >= 0) { pp.minSignal = v; App.saveState(); } });
      const hard = h('input', { type: 'checkbox', checked: pp.designHard });
      hard.addEventListener('change', () => { pp.designHard = hard.checked; App.saveState(); });
      const robust = h('input', { type: 'checkbox', checked: pp.robust });
      robust.addEventListener('change', () => { pp.robust = robust.checked; App.saveState(); });
      const goals = Scn.simNodes().filter((n) => n.tracked !== false && !n.planned);
      const goalBox = goals.length > 1 ? h('div', { class: 'field', style: 'margin-top:10px' },
        h('label', { text: 'Plan for these vessels (unticked ones still relay, but need no fix)' }),
        goals.map((n) => {
          const cb = h('input', { type: 'checkbox', checked: !(pp.skip && pp.skip[n.id]) });
          cb.addEventListener('change', () => { if (!pp.skip) pp.skip = {}; if (cb.checked) delete pp.skip[n.id]; else pp.skip[n.id] = true; App.saveState(); });
          return h('label', { class: 'inline', style: 'color:var(--text);display:flex' }, cb, n.name);
        })) : null;
      const run = h('button', { class: 'btn primary', type: 'button' }, 'Design a fix');
      const cancel = h('button', { class: 'btn ghost', type: 'button', hidden: true }, 'Cancel');
      const prog = h('div', { class: 'hint', style: 'margin-top:8px' });
      const bar = h('div', { class: 'meter', hidden: true }, h('i', { style: 'width:100%;background:var(--accent);opacity:0.6' }));

      run.addEventListener('click', () => {
        const P = problem();
        if (!P.nodes.some((n) => n.tracked !== false && !n.planned)) { prog.textContent = 'Add a tracked vessel on the Scenario tab first.'; return; }
        result = null;
        out.replaceChildren();
        run.disabled = true; cancel.hidden = false; bar.hidden = false;
        const started = Date.now();
        let phaseText = 'Starting';
        P.onPhase = (t) => { phaseText = t; };
        const gen = Pl.planGen(P);
        job = gen;
        (function tick() {
          if (job !== gen) return;
          const stop = Date.now() + 30;
          let r;
          do { r = gen.next(); } while (!r.done && Date.now() < stop);
          prog.textContent = phaseText + '… ' + Math.round((Date.now() - started) / 1000) + ' s';
          if (!r.done) { setTimeout(tick, 0); return; }
          job = null;
          run.disabled = false; cancel.hidden = true; bar.hidden = true; prog.textContent = '';
          result = { plan: r.value, rev: App.rev(), P: P };
          coverage = null;
          renderResult();
        })();
      });
      cancel.addEventListener('click', () => { job = null; run.disabled = false; cancel.hidden = true; bar.hidden = true; prog.textContent = 'Cancelled.'; });

      opts.replaceChildren(...[
        h('h2', { text: 'Relay planner' }),
        h('p', { class: 'hint', text: 'Works out why the tracked vessels lose contact, then designs fixes for the causes rather than the symptoms: it re-simulates after every fix, drops fixes that became redundant, and picks the lightest antennas that lose nothing.' }),
        h('div', { class: 'row' },
          h('div', { class: 'field' }, h('label', { text: 'Look ahead' }), hz),
          h('div', { class: 'field' }, h('label', { text: 'Target uptime %' }), target),
          h('div', { class: 'field' }, h('label', { text: 'Weakest usable signal %' }), minSig)),
        goalBox,
        h('div', { style: 'margin-top:8px' },
          h('label', { class: 'inline', style: 'color:var(--text);display:flex' }, robust, 'Design for every landing site on the bodies involved, not just today’s vessel'),
          h('label', { class: 'inline', style: 'color:var(--text);display:flex' }, hard, 'Design for the hardest difficulty (occlusion ×1.0, range ×0.65)')),
        h('div', { class: 'row', style: 'margin-top:10px' }, run, cancel), bar, prog,
        h('p', { class: 'hint', text: 'Designing runs many simulations and can take a minute or two, longer for the hardest difficulty or a longer look-ahead.' })].filter(Boolean));
    }

    function renderResult() {
      if (!result) { out.replaceChildren(); return; }
      const plan = result.plan;
      const parts = [];
      if (plan.error) { out.replaceChildren(h('div', { class: 'card bad', text: plan.error })); return; }
      const stale = result.rev !== App.rev();
      if (stale) parts.push(h('div', { class: 'card warn', text: 'The scenario or settings changed since this plan was made; run it again for current numbers.' }));

      const b0 = plan.baseline.sources.reduce((m, s) => Math.min(m, s.uptime), 1);
      const b1 = plan.final.sources.reduce((m, s) => Math.min(m, s.uptime), 1);
      const longest0 = plan.baseline.sources.reduce((m, s) => Math.max(m, s.longestBlackout), 0);
      const longest1 = plan.final.sources.reduce((m, s) => Math.max(m, s.longestBlackout), 0);
      const mass = plan.sized.reduce((q, g) => q + g.tier.mass * g.count, 0);
      const cost = plan.sized.reduce((q, g) => q + g.tier.cost * g.count, 0);

      // summary
      parts.push(h('div', { class: 'card' },
        h('div', { class: 'big' },
          h('div', { class: 'pct', style: 'color:' + App.sigInk(b0), text: pct(b0) }),
          h('div', { style: 'font-size:1.6rem' }, '→'),
          h('div', { class: 'pct', style: 'color:' + App.sigInk(b1), text: pct(b1) }),
          h('div', {}, h('div', { class: 'verdict', text: b1 >= plan.target ? 'Target met' : 'Best achievable with these fixes' }),
            h('small', { class: 'hint', text: 'worst tracked vessel · ' + Orb.formatUT(plan.t0) + ' → ' + Orb.formatUT(plan.t1) }))),
        h('p', { class: 'hint', text: 'Longest blackout: ' + Orb.formatDuration(longest0) + ' → ' + Orb.formatDuration(longest1) + (plan.planned.length ? ' · ' + plan.planned.length + ' relay' + (plan.planned.length > 1 ? 's' : '') + ', ' + mass.toFixed(2) + ' t of antennas, ' + Math.round(cost).toLocaleString('en-US') + ' funds' : '') }),
        plan.planned.length ? h('div', { class: 'row' },
          h('button', {
            class: 'btn primary', type: 'button',
            onclick: () => {
              const sc = st.scenario;
              sc.nodes = sc.nodes.filter((n) => !n.planned).concat(plan.planned.map(nodeToScenario));
              App.saveState();
              App.rebuildAll();
            },
          }, 'Add these relays to the scenario'),
          h('button', { class: 'btn', type: 'button', onclick: () => { st.scenario.nodes = st.scenario.nodes.filter((n) => !n.planned); App.rebuildAll(); } }, 'Remove planned relays'),
          h('button', { class: 'btn', type: 'button', onclick: (e) => copyText(planText(plan), e.target) }, 'Copy the plan as text')) : null));

      // diagnosis
      const bc = plan.baselineCauses;
      if (bc.causes.length) {
        parts.push(h('div', { class: 'card' },
          h('h3', { text: 'Why it fails today' }),
          h('div', { class: 'scroll' }, h('table', {},
            h('tbody', {}, bc.causes.map((c) => {
              const share = c.time / bc.total;
              const label = c.type === 'occlusion' ? 'Blocked by ' + c.body + (c.body === 'Kerbol' ? ' (solar conjunction)' : '') : c.type === 'range' ? 'Out of range' : 'Signal below the minimum';
              return h('tr', {},
                h('td', { text: label }),
                h('td', { style: 'width:45%' }, h('div', { class: 'meter' }, h('i', { style: 'width:' + Math.round(share * 100) + '%;background:var(--warn)' }))),
                h('td', { class: 'num', text: Math.round(share * 100) + '%' }));
            }))))));
      } else {
        parts.push(h('div', { class: 'card good', text: 'No blackouts in this period; nothing to fix.' }));
      }

      // steps
      plan.steps.forEach((step, i) => {
        parts.push(h('div', { class: 'node relay' },
          h('div', { class: 'node-head' }, h('strong', { text: (i + 1) + '. ' + step.proposal.title }),
            h('span', { class: 'tag', text: pct(step.before) + ' → ' + pct(step.after) })),
          h('div', { text: step.proposal.detail }),
          h('p', { class: 'hint', style: 'margin-top:6px', text: explain(step) })));
      });
      if (plan.pruned.length) {
        parts.push(h('div', { class: 'callout' }, 'Dropped as redundant: ' + plan.pruned.map((p) => p.count + ' relay' + (p.count > 1 ? 's' : '') + ' (' + p.group.replace(/^ring:/, 'ring around ') + ')').join(', ') + '. A later fix made them unnecessary, so building them would be wasted mass.'));
      }
      for (const a of plan.advice) {
        if (a.kind === 'range') parts.push(h('div', { class: 'callout' }, 'Some outages are out-of-range: the vessel’s own antennas are too weak for the distance. Use the Antenna finder on the worst-case separation, or fit a stronger antenna.'));
        else if (a.kind === 'weak') parts.push(h('div', { class: 'callout' }, 'Some outages are signal below your minimum. A stronger antenna on the vessel would help; relays cannot add signal beyond the weakest hop.'));
        else if (a.kind === 'nofix') parts.push(h('div', { class: 'callout' }, 'Blockage by ' + a.cause.body + ' has no relay fix in the candidates tried (' + pct(a.cause.time / Math.max(1, plan.baselineCauses.total)) + ' of the outage time).'));
      }

      // antennas
      if (plan.sized.length) {
        parts.push(h('div', { class: 'card' },
          h('h3', { text: 'Antennas for the planned relays' }),
          h('div', { class: 'scroll' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', { text: 'Group' }), h('th', { text: 'Each relay carries' }), h('th', { class: 'num', text: 'Relay power' }), h('th', { class: 'num', text: 'Total mass' }), h('th', { class: 'num', text: 'Total cost' }))),
            h('tbody', {}, plan.sized.map((g) => h('tr', {},
              h('td', { text: g.count + '× ' + (g.group === 'solar' ? 'solar relay' : g.group.replace(/^ring:/, 'relay at ')) }),
              h('td', { text: g.tier.label }),
              h('td', { class: 'num', text: Core.formatPower(g.tier.power) }),
              h('td', { class: 'num', text: (g.tier.mass * g.count).toFixed(2) + ' t' }),
              h('td', { class: 'num', text: Math.round(g.tier.cost * g.count).toLocaleString('en-US') })))))),
          h('p', { class: 'hint', text: 'The lightest stack whose result matches an unlimited-power design. Only antennas from the packs you enabled were considered.' })));
      }

      // deployment
      const dgroups = Array.from(new Set(plan.planned.map((n) => n.group)));
      const dhints = dgroups.map((g) => Pl.deployHint(App.world, plan.planned.filter((n) => n.group === g))).filter(Boolean);
      if (dhints.length) {
        parts.push(h('details', { class: 'card' },
          h('summary', { text: 'How to get them there' }),
          dhints.map((hh) => h('div', { style: 'margin-top:8px' }, h('strong', { text: hh.solar ? 'Solar relays' : hh.n + ' relay' + (hh.n > 1 ? 's' : '') + ' around ' + App.world.index.get(hh.body).name }),
            Pl.deployText(hh, Core.formatDistance, Orb.formatDuration).map((t) => h('p', { class: 'hint', text: t })))),
          h('p', { class: 'hint', text: 'Two-body estimates without gravity losses or the transfer to the ring; the phasing numbers are what the carrier spends between releases. The relays are equally spaced, so any release order works.' })));
      }

      // extra stations
      if (plan.extraStations && (plan.extraStations.uptime > b0 + 0.01 || plan.extraStations.mean > plan.baseline.sources.reduce((q, s) => q + s.uptime, 0) / plan.baseline.sources.length + 0.01)) {
        parts.push(h('div', { class: 'callout' }, h('strong', { text: 'Cheapest alternative: ' }), 'turning on the difficulty option “Enable Extra Groundstations” alone would give ' + pct(plan.extraStations.uptime) + ' uptime without launching anything (it adds five more Kerbin stations at the DSN rating, so Kerbin’s night side stops mattering).'));
      }

      // stress
      parts.push(h('div', { class: 'card' },
        h('h3', { text: 'Does the design survive other difficulty settings?' }),
        h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { text: 'Difficulty' }), h('th', { class: 'num', text: 'Without the plan' }), h('th', { class: 'num', text: 'With the plan' }), h('th', { class: 'num', text: 'Longest blackout' }))),
          h('tbody', {}, plan.stress.map((s) => h('tr', {},
            h('td', { text: s.preset.name + ' (occlusion ×' + s.preset.occVac + '/' + s.preset.occAtm + ', range ×' + s.preset.range + ')' }),
            h('td', { class: 'num', style: 'color:' + App.sigInk(s.baselineUptime), text: pct(s.baselineUptime) }),
            h('td', { class: 'num', style: 'font-weight:700;color:' + App.sigInk(s.uptime), text: pct(s.uptime) }),
            h('td', { class: 'num', text: Orb.formatDuration(s.longest) })))))),
        h('p', { class: 'hint', text: 'Higher occlusion multipliers make planets block more of the sky, so a design that only just works on Normal can fail on Hard. Tick “Design for the hardest difficulty” to plan for that from the start.' })));

      parts.push(coverageCard(plan));
      out.replaceChildren(...parts);
    }

    /* ---------- coverage map ---------- */

    function coverageCard(plan) {
      const card = h('div', { class: 'card' });
      const bodies = App.world.bodies.filter((b) => !b.star);
      const tracked = Scn.simNodes().filter((n) => n.tracked !== false && !n.planned).map((n) => n.loc.body);
      const bodySel = App.bodySelect(coverageCard.body || tracked[0] || 'Kerbin', (v) => { coverageCard.body = v; }, {});
      void bodies;
      const withPlan = h('select', { 'aria-label': 'Which relays to include' },
        h('option', { value: 'with', text: 'With the planned relays' }), h('option', { value: 'without', text: 'Without them (today’s relays only)' }));
      const go = h('button', { class: 'btn', type: 'button' }, 'Compute coverage map');
      const canvas = h('canvas', { class: 'map-canvas', role: 'img', 'aria-label': 'Map of connection uptime across the body’s surface' });
      const note = h('p', { class: 'hint' });
      go.addEventListener('click', () => {
        const bodyId = bodySel.value;
        note.textContent = 'Computing…';
        go.disabled = true;
        const P = result.P;
        // include planned relays as untracked nodes
        const nodes = P.nodes.filter((n) => !n.planned).concat(withPlan.value === 'with' ? plan.planned : []);
        const gen = Pl.coverageGen(Object.assign({}, P, { nodes: nodes }), bodyId, 20, 30, 3, 3 * Data.DAY);
        (function tick() {
          const stop = Date.now() + 30;
          let r;
          do { r = gen.next(); } while (!r.done && Date.now() < stop);
          if (!r.done) { setTimeout(tick, 0); return; }
          go.disabled = false;
          note.textContent = 'Uptime of a lander with a small direct antenna (Communotron 16) at each spot, averaged over three 3-day windows spread across the look-ahead period. It shows what your relay network gives any future landing site.';
          drawMap(canvas, r.value, bodyId);
        })();
      });
      card.append(h('h3', { text: 'Surface coverage' }), h('div', { class: 'row' }, bodySel, withPlan, go), note, canvas);
      return card;
    }

    function drawMap(canvas, data, bodyId) {
      const W = Math.max(280, canvas.parentElement.clientWidth - 8), H = Math.round(W / 2);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const cw = W / (360 / data.lonStep), chh = H / (180 / data.latStep);
      data.cells.forEach((c, i) => {
        const x = ((c.lon + 180 - data.lonStep / 2) / 360) * W;
        const y = ((90 - c.lat - data.latStep / 2) / 180) * H;
        ctx.fillStyle = App.sigColor(data.uptime[i]);
        ctx.fillRect(x, y, cw + 0.5, chh + 0.5);
        ctx.fillStyle = '#08131f';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(Math.round(data.uptime[i] * 100), x + 3, y + chh / 2 + 3);
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
      ctx.fillStyle = cssText();
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(bodyId + ' (longitude −180° → 180°, latitude 90° → −90°)', 6, H - 6);
    }
    const cssText = () => getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#fff';

    renderOptions();
    renderWhatIf();
    renderResult();
    return {
      update: function () { if (result && result.rev !== App.rev()) renderResult(); },
    };
  }

  App.registerTab('planner', 'Relay planner', build, 'antennas');
})();
