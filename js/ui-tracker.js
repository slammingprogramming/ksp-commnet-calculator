// SPDX-License-Identifier: AGPL-3.0-or-later
/* Tracker tab: live orbit view with line-of-sight occlusion, time controls and blackout analysis. */
(function () {
  'use strict';

  const App = window.KSPApp;
  const Core = window.KSPCore;
  const Orb = window.KSPOrbits;
  const Sim = window.KSPSim;
  const Pl = window.KSPPlanner;
  const Scn = window.KSPScenario;
  const h = App.h;

  const SPEEDS = [
    ['1 min / s', 60], ['10 min / s', 600], ['1 hour / s', 3600], ['1 day / s', 21600],
    ['4 days / s', 86400], ['20 days / s', 432000], ['100 days / s', 2160000], ['1 year / s', 9201600],
  ];
  const HORIZONS = [['1 month', 30 * 21600], ['3 months', 106 * 21600], ['1 year', 426 * 21600], ['2 years', 852 * 21600], ['4 years', 1704 * 21600], ['8 years', 3408 * 21600]];

  const cssVar = (name, fallback) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

  function autoView(world, focus) {
    const b = world.index.get(focus);
    if (!b) return 1e9;
    let far = 0;
    for (const m of b.moons) far = Math.max(far, m.orbit.a * (1 + m.orbit.e));
    if (!far) return b.radius * 6;
    return far * 1.25;
  }

  function build(root) {
    const st = App.state;
    const sc = st.scenario;
    const tr = st.tracker;
    let analysis = null; // {rev, result, ...}
    let job = null, timer = null, playing = false, lastTick = 0;
    let viewR = null;

    /* ---------- layout ---------- */
    const canvas = h('canvas', { class: 'tracker-canvas', role: 'img', 'aria-label': 'Top-down view of the tracked orbits and links' });
    const legend = h('div', { class: 'legend', style: 'margin-top:6px' });
    const statusBox = h('div', { class: 'card' });
    const analysisBox = h('div', { class: 'card', 'aria-live': 'polite' });
    const timeline = h('canvas', { class: 'timeline', 'aria-label': 'Timeline of connection and blackouts' });

    const utIn = h('input', { type: 'text', size: 18, spellcheck: 'false', 'aria-label': 'Simulation time' });
    const dateLbl = h('small', { class: 'hint' });
    const focusSel = App.bodySelect(tr.focus, (v) => { tr.focus = v; viewR = null; App.saveState(); draw(); }, { withStar: true });
    const speedSel = h('select', { 'aria-label': 'Playback speed' }, SPEEDS.map((s) => h('option', { value: String(s[1]), text: s[0] })));
    speedSel.value = String(tr.speed);
    speedSel.addEventListener('change', () => { tr.speed = parseFloat(speedSel.value); App.saveState(); });
    const playBtn = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false' }, '▶ Play');

    function setUT(v) {
      sc.ut = v;
      utIn.value = Orb.formatUT(sc.ut);
      App.saveState();
      draw();
      drawTimeline();
      renderStatus();
    }
    utIn.addEventListener('change', () => { const v = Orb.parseUT(utIn.value); if (isFinite(v)) setUT(v); else utIn.value = Orb.formatUT(sc.ut); });

    function stopPlay() {
      playing = false;
      playBtn.textContent = '▶ Play';
      playBtn.setAttribute('aria-pressed', 'false');
      if (timer) { clearInterval(timer); timer = null; }
    }
    function startPlay() {
      playing = true;
      playBtn.textContent = '⏸ Pause';
      playBtn.setAttribute('aria-pressed', 'true');
      lastTick = Date.now();
      timer = setInterval(() => {
        const now = Date.now();
        const dtReal = Math.min(0.25, (now - lastTick) / 1000);
        lastTick = now;
        setUT(sc.ut + tr.speed * dtReal);
      }, 60);
    }
    playBtn.addEventListener('click', () => (playing ? stopPlay() : startPlay()));

    const stepBtn = (label, sec) => h('button', { class: 'btn small', type: 'button', onclick: () => setUT(sc.ut + sec) }, label);

    const controls = h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { text: 'Time (UT)' }), utIn),
        playBtn,
        h('div', { class: 'field' }, h('label', { text: 'Speed' }), speedSel),
        h('div', { class: 'field' }, h('label', { text: 'View centred on' }), focusSel)),
      h('div', { class: 'seg', style: 'margin-top:8px' },
        stepBtn('−1 day', -21600), stepBtn('−1 h', -3600), stepBtn('+1 h', 3600), stepBtn('+1 day', 21600), stepBtn('+10 days', 216000),
        h('button', { class: 'btn small', type: 'button', onclick: () => { viewR = viewR ? viewR / 1.6 : autoView(App.world, tr.focus) / 1.6; draw(); } }, 'Zoom +'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { viewR = (viewR || autoView(App.world, tr.focus)) * 1.6; draw(); } }, 'Zoom −'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { viewR = null; draw(); } }, 'Fit')),
      h('div', { style: 'margin-top:6px' }, dateLbl));

    root.append(h('div', { class: 'two-col' },
      h('div', {}, controls, h('div', { class: 'card', style: 'margin-top:12px' }, canvas, legend)),
      h('div', {}, statusBox, analysisBox)));

    /* ---------- drawing ---------- */

    function resizeCanvas(c, aspect) {
      const w = Math.max(200, Math.floor(c.clientWidth || c.parentElement.clientWidth || 600));
      const hh = Math.floor(w * aspect);
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.floor(w * dpr) || c.height !== Math.floor(hh * dpr)) {
        c.width = Math.floor(w * dpr);
        c.height = Math.floor(hh * dpr);
        c.style.height = hh + 'px';
      }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { ctx: ctx, w: w, h: hh };
    }

    const BODY_COLORS = { Kerbol: '#f5c542', Kerbin: '#4a90d9', Mun: '#9a9a9a', Minmus: '#8fd9c6', Duna: '#c8663c', Eve: '#8e5bb5', Jool: '#5fae4b', Laythe: '#4aa3d9', Moho: '#a58a72', Dres: '#8a8a7a', Eeloo: '#cfe3ef' };

    function draw() {
      const w = App.world;
      const sim = Scn.getSim();
      if (!focusSel.value || !w.index.get(tr.focus)) tr.focus = 'Kerbol';
      const focus = w.index.get(tr.focus);
      if (viewR === null) viewR = autoView(w, tr.focus);
      const { ctx, w: W, h: H } = resizeCanvas(canvas, 0.85);
      const text = cssVar('--text', '#e6edf7'), muted = cssVar('--muted', '#93a4bf'), line = cssVar('--line', '#24365a');
      ctx.clearRect(0, 0, W, H);
      const snap = sim.snapshot(sc.ut);
      const bp = snap.bodyPos;
      const cx0 = bp[focus.idx * 3], cy0 = bp[focus.idx * 3 + 1];
      const scale = (Math.min(W, H) / 2 - 14) / viewR;
      const px = (x) => W / 2 + (x - cx0) * scale;
      const py = (y) => H / 2 - (y - cy0) * scale;
      const inView = (x, y, pad) => { const X = px(x), Y = py(y); return X > -pad && X < W + pad && Y > -pad && Y < H + pad; };

      // orbits of bodies whose parent is in view
      ctx.lineWidth = 1;
      const tmp = [0, 0, 0];
      for (const b of w.bodies) {
        if (!b._p) continue;
        const pi = b.parentIdx * 3;
        ctx.beginPath();
        let started = false;
        const N = 120;
        for (let k = 0; k <= N; k++) {
          Orb.positionAtE(b._p, (Orb.TAU * k) / N, tmp);
          const X = px(bp[pi] + tmp[0]), Y = py(bp[pi + 1] + tmp[1]);
          if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
        }
        ctx.strokeStyle = line;
        ctx.stroke();
      }
      // asset orbits
      sim.nodes.forEach((n, i) => {
        if (n.home || !n._p) return;
        const pi = w.index.get(n.loc.body).idx * 3;
        ctx.beginPath();
        for (let k = 0; k <= 90; k++) {
          Orb.positionAtE(n._p, (Orb.TAU * k) / 90, tmp);
          const X = px(bp[pi] + tmp[0]), Y = py(bp[pi + 1] + tmp[1]);
          if (k === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
        ctx.strokeStyle = n.source && n.source.planned ? 'rgba(217,111,217,0.55)' : n.tracked ? 'rgba(110,168,255,0.55)' : 'rgba(240,180,41,0.55)';
        ctx.stroke();
      });

      // bodies (+ dashed blocking spheres)
      ctx.font = '11px system-ui, sans-serif';
      w.bodies.forEach((b, i) => {
        const x = bp[i * 3], y = bp[i * 3 + 1];
        if (!inView(x, y, 40)) return;
        const rr = Math.max(2.5, b.radius * scale);
        ctx.beginPath();
        ctx.arc(px(x), py(y), rr, 0, Orb.TAU);
        ctx.fillStyle = BODY_COLORS[b.id] || (b.isMoon ? '#8a94a6' : '#6f7f96');
        ctx.fill();
        const occ = b.radius * (b.hasAtmo ? sim.settings.occAtm : sim.settings.occVac);
        if (occ * scale > 4 && b.radius * scale > 3) {
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(px(x), py(y), occ * scale, 0, Orb.TAU);
          ctx.strokeStyle = 'rgba(255,235,235,0.85)';
          ctx.lineWidth = 1.25;
          ctx.stroke();
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
        }
        const showLabel = b === focus || b.parentBody === focus || (focus.star && b.depth === 1) || rr > 6;
        if (showLabel) { ctx.fillStyle = muted; ctx.fillText(b.name, px(x) + rr + 3, py(y) - rr - 2); }
      });

      // links
      for (const l of snap.links) {
        const ax = snap.nodePos[l.a * 3], ay = snap.nodePos[l.a * 3 + 1], bx = snap.nodePos[l.b * 3], by = snap.nodePos[l.b * 3 + 1];
        if (!inView(ax, ay, 400) && !inView(bx, by, 400)) continue;
        ctx.beginPath();
        ctx.moveTo(px(ax), py(ay));
        ctx.lineTo(px(bx), py(by));
        if (l.blocked) { ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(239,107,107,0.6)'; ctx.lineWidth = 1; }
        else { ctx.setLineDash([]); ctx.strokeStyle = App.sigColor(l.signal); ctx.lineWidth = 1.5; }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
      }
      // active paths, thicker
      snap.results.forEach((r) => {
        if (!r.connected) return;
        ctx.beginPath();
        r.path.forEach((ni, k) => { const X = px(snap.nodePos[ni * 3]), Y = py(snap.nodePos[ni * 3 + 1]); if (k === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
        ctx.strokeStyle = App.sigColor(r.signal);
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.lineWidth = 1;
      });

      // nodes
      sim.nodes.forEach((n, i) => {
        const x = snap.nodePos[i * 3], y = snap.nodePos[i * 3 + 1];
        if (!inView(x, y, 20)) return;
        const X = px(x), Y = py(y);
        if (n.home) {
          if (scale * 600000 < 2 && sim.nodes.filter((m) => m.home).indexOf(n) > 0) return; // avoid a stack of dots
          ctx.fillStyle = '#45d6b0';
          ctx.fillRect(X - 3, Y - 3, 6, 6);
          if (viewR < 5e7 && n.name === 'Kerbal Space Center') { ctx.fillStyle = text; ctx.fillText('KSC', X + 5, Y + 12); }
        } else {
          ctx.beginPath();
          ctx.arc(X, Y, 4, 0, Orb.TAU);
          ctx.fillStyle = n.source && n.source.planned ? '#d96fd9' : n.tracked ? '#6ea8ff' : '#f0b429';
          ctx.fill();
          ctx.fillStyle = text;
          ctx.fillText(n.name, X + 6, Y - 6);
        }
      });
      // scale bar
      const bar = Math.pow(10, Math.floor(Math.log10(viewR / 2)));
      ctx.strokeStyle = muted; ctx.fillStyle = muted;
      ctx.beginPath(); ctx.moveTo(10, H - 12); ctx.lineTo(10 + bar * scale, H - 12); ctx.stroke();
      ctx.fillText(Core.formatDistance(bar, 2), 10, H - 16);
      dateLbl.textContent = 'KSP date ' + Orb.formatUT(sc.ut) + ' · top-down projection (inclination not shown) · dashed white circles are the blocking spheres';
      return snap;
    }

    function renderLegend() {
      legend.replaceChildren(
        h('span', {}, h('i', { style: 'background:#6ea8ff' }), 'tracked'),
        h('span', {}, h('i', { style: 'background:#f0b429' }), 'relay'),
        h('span', {}, h('i', { style: 'background:#d96fd9' }), 'planned relay'),
        h('span', {}, h('i', { style: 'background:#45d6b0' }), 'ground station'),
        h('span', {}, h('i', { style: 'background:' + App.sigColor(0.9) }), 'link'),
        h('span', {}, h('i', { style: 'background:rgba(239,107,107,0.8)' }), 'blocked'));
    }

    function renderStatus() {
      const sim = Scn.getSim();
      const results = sim.evalAt(sc.ut);
      const names = sim.nodes.map((n) => n.name);
      const rows = results.map((r) => {
        const cause = !r.connected ? Scn.describeCause(r.cause) : '';
        return h('div', { class: 'tr-row' },
          h('span', { class: 'badge', style: 'background:' + (r.connected ? App.sigColor(r.signal) : 'var(--bad)'), text: r.connected ? Core.formatPercent(r.signal) : 'OUT' }),
          h('strong', { text: ' ' + r.name }),
          r.connected ? h('div', { class: 'hint', text: r.path.map((i) => names[i]).join(' → ') }) : h('div', { class: 'hint bad', text: cause }));
      });
      statusBox.replaceChildren(...[
        h('h2', { text: 'Right now' }),
        sim.problems.length ? h('p', { class: 'bad', text: sim.problems.join(' ') }) : null,
      ].concat(rows.length ? rows : [h('p', { class: 'hint', text: 'Nothing is tracked. Add a vessel on the Scenario tab.' })]).filter(Boolean));
    }

    /* ---------- analysis ---------- */

    function causeColor(c) {
      if (!c) return '#888';
      if (c.type === 'range') return '#b58a2a';
      if (c.type === 'weak') return '#a0762f';
      const b = c.bodies[0];
      return b === 'Kerbol' ? '#e0a020' : b === 'Kerbin' ? '#4a90d9' : '#a35bd0';
    }

    function drawTimeline() {
      if (!analysis || !timeline.isConnected) return;
      const src = analysis.result.sources[analysis.sel] || analysis.result.sources[0];
      const { ctx, w: W, h: H } = resizeCanvas(timeline, 0.09);
      ctx.clearRect(0, 0, W, H);
      const t0 = analysis.result.t0, t1 = analysis.result.t1;
      const x = (t) => ((t - t0) / (t1 - t0)) * W;
      ctx.fillStyle = 'rgba(69,214,176,0.35)';
      ctx.fillRect(0, 4, W, H - 8);
      for (const b of src.blackouts) {
        ctx.fillStyle = causeColor(b.causes[0]);
        ctx.fillRect(x(b.start), 4, Math.max(1.5, x(b.end) - x(b.start)), H - 8);
      }
      if (sc.ut >= t0 && sc.ut <= t1) {
        ctx.fillStyle = cssVar('--text', '#fff');
        ctx.fillRect(x(sc.ut) - 1, 0, 2, H);
      }
    }
    timeline.addEventListener('click', (e) => {
      if (!analysis) return;
      const r = timeline.getBoundingClientRect();
      const t = analysis.result.t0 + ((e.clientX - r.left) / r.width) * (analysis.result.t1 - analysis.result.t0);
      setUT(t);
    });

    function renderAnalysis() {
      const sim = Scn.getSim();
      const horizonSel = h('select', { 'aria-label': 'Analysis length' }, HORIZONS.map((x) => h('option', { value: String(x[1]), text: x[0] })));
      horizonSel.value = String(HORIZONS.some((x) => x[1] === tr.horizon) ? tr.horizon : 426 * 21600);
      const go = h('button', { class: 'btn primary', type: 'button' }, 'Analyze blackouts');
      const bar = h('div', { class: 'meter', hidden: true }, h('i', { style: 'width:0%;background:var(--accent)' }));
      go.addEventListener('click', () => {
        if (!sim.trackedIdx.length) return;
        tr.horizon = parseFloat(horizonSel.value);
        App.saveState();
        const dt = Math.max(sim.suggestStep(32), tr.horizon / 200000);
        const sc2 = Sim.createScanner(sim, sc.ut, sc.ut + tr.horizon, dt);
        job = sc2;
        go.disabled = true;
        bar.hidden = false;
        (function step() {
          if (job !== sc2) return;
          const done = sc2.run(30);
          bar.firstChild.style.width = Math.round(sc2.progress * 100) + '%';
          if (!done) { setTimeout(step, 0); return; }
          analysis = { rev: App.rev(), result: sc2.result, sel: 0 };
          job = null;
          renderAnalysis();
          drawTimeline();
        })();
      });

      const head = h('div', { class: 'row' }, horizonSel, go);
      const parts = [h('h2', { text: 'Blackout analysis' }), h('p', { class: 'hint', text: 'Scans forward from the current time and finds every period without a connection to home, and what blocked it.' }), head, bar];

      if (analysis) {
        const stale = analysis.rev !== App.rev();
        const res = analysis.result;
        if (stale) parts.push(h('p', { class: 'warn', text: 'The scenario or settings changed since this analysis. Run it again.' }));
        parts.push(h('p', { class: 'hint', text: Orb.formatUT(res.t0) + ' → ' + Orb.formatUT(res.t1) + ' (step ' + Orb.formatDuration(res.dt) + ')' }));
        if (res.sources.length > 1) {
          const sel = h('select', { 'aria-label': 'Asset' }, res.sources.map((s, i) => h('option', { value: String(i), text: s.name })));
          sel.value = String(analysis.sel);
          sel.addEventListener('change', () => { analysis.sel = parseInt(sel.value, 10); renderAnalysis(); drawTimeline(); });
          parts.push(sel);
        }
        const s = res.sources[analysis.sel] || res.sources[0];
        const ct = Pl.causeTable({ sources: [s] });
        parts.push(
          h('div', { class: 'big', style: 'margin-top:8px' },
            h('div', { class: 'pct', style: 'color:' + App.sigColor(s.uptime), text: (s.uptime * 100).toFixed(s.uptime > 0.99 ? 2 : 1) + '%' }),
            h('div', {}, h('div', { class: 'verdict', text: 'uptime · ' + s.blackouts.length + ' blackout' + (s.blackouts.length === 1 ? '' : 's') }),
              h('small', { class: 'hint', text: 'longest ' + Orb.formatDuration(s.longestBlackout) + ' · average signal while connected ' + Core.formatPercent(s.avgSignal) }))),
          timeline,
          h('div', { class: 'legend', style: 'margin-top:4px' },
            h('span', {}, h('i', { style: 'background:rgba(69,214,176,0.6)' }), 'connected'),
            h('span', {}, h('i', { style: 'background:#4a90d9' }), 'Kerbin blocks'),
            h('span', {}, h('i', { style: 'background:#a35bd0' }), 'another body blocks'),
            h('span', {}, h('i', { style: 'background:#e0a020' }), 'Kerbol (conjunction)'),
            h('span', {}, h('i', { style: 'background:#b58a2a' }), 'range / weak')));
        if (ct.causes.length) {
          parts.push(h('div', { class: 'scroll', style: 'margin-top:8px' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', { text: 'Why the link drops' }), h('th', { class: 'num', text: 'Share' }), h('th', { class: 'num', text: 'Events' }))),
            h('tbody', {}, ct.causes.map((c) => h('tr', {},
              h('td', { text: c.type === 'occlusion' ? 'Blocked by ' + c.body + (c.body === 'Kerbol' ? ' (solar conjunction)' : '') : c.type === 'range' ? 'Out of range' : 'Signal below minimum' }),
              h('td', { class: 'num', text: Math.round((c.time / ct.total) * 100) + '%' }),
              h('td', { class: 'num', text: String(Math.round(c.events)) })))))));
        }
        const rows = s.blackouts.slice(0, 120);
        if (rows.length) {
          parts.push(h('div', { class: 'scroll', style: 'margin-top:8px;max-height:300px;overflow:auto' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', { text: 'From' }), h('th', { text: 'Duration' }), h('th', { text: 'Cause' }), h('th'))),
            h('tbody', {}, rows.map((b) => h('tr', {},
              h('td', { text: (b.startedBefore ? '≤ ' : '') + Orb.formatUT(b.start) }),
              h('td', { text: Orb.formatDuration(b.duration) + (b.ongoing ? '+' : '') }),
              h('td', { text: Scn.describeCauses(b.causes) }),
              h('td', {}, h('button', { class: 'btn small', type: 'button', onclick: () => setUT(Math.max(res.t0, b.start - 900)) }, 'Go'))))))));
          if (s.blackouts.length > rows.length) parts.push(h('p', { class: 'hint', text: 'Showing the first ' + rows.length + ' of ' + s.blackouts.length + '.' }));
        } else parts.push(h('p', { class: 'good', text: 'No blackouts in this period.' }));
      }
      analysisBox.replaceChildren(...parts);
    }

    utIn.value = Orb.formatUT(sc.ut);
    renderLegend();
    renderAnalysis();
    window.addEventListener('resize', () => { if (root.isConnected && !root.hidden) { draw(); drawTimeline(); } });

    return {
      update: function () {
        if (!root.isConnected) return;
        utIn.value = Orb.formatUT(sc.ut);
        focusSel.value = tr.focus;
        draw();
        renderStatus();
        renderAnalysis();
        drawTimeline();
      },
      hide: stopPlay,
    };
  }

  App.registerTab('tracker', 'Tracker', build, 'antennas');
})();
