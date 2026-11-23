// SPDX-License-Identifier: AGPL-3.0-or-later
/* Reentry tab: when and where does plasma blackout cut the link on a landing? Uses js/reentry.js (rules read from the game). */
(function () {
  'use strict';

  const App = window.KSPApp;
  const Data = window.KSPData;
  const Core = window.KSPCore;
  const Orb = window.KSPOrbits;
  const R = window.KSPReentry;
  const h = App.h;

  const BALLISTIC = [
    ['Light capsule (about 150 kg/m²)', 150], ['Heavy capsule (about 400 kg/m²)', 400], ['Spaceplane or lifting body (about 800 kg/m²)', 800],
    ['Dense probe or booster stage (about 2000 kg/m²)', 2000],
  ];
  const LINKS = [
    ['Antenna toward the nose or the side (full effect)', 0], ['Link about 100° from the direction of travel', 100],
    ['Link about 130° from the direction of travel (partial)', 130], ['Link behind the vessel (about 150° or more: unaffected)', 160],
  ];

  const dur = (s) => (s >= 60 ? Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s' : s.toFixed(0) + ' s');
  const km = (m) => (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km';

  function build(root) {
    const st = App.state;
    const rs = st.reentry;
    const out = h('div', {});
    const canvas = h('canvas', { class: 'tracker-canvas', role: 'img', 'aria-label': 'Altitude against speed with the entry path and the blackout region' });

    const bodyOpts = App.world.bodies.filter((b) => !b.star && R.hasAtmosphere(b.id));
    const sel = (label, key, opts, num) => {
      const s = h('select', { 'aria-label': label }, opts.map((o) => h('option', { value: String(o[1]), text: o[0] })));
      s.value = String(rs[key]);
      if (s.value !== String(rs[key])) { s.append(h('option', { value: String(rs[key]), text: 'custom (' + rs[key] + ')' })); s.value = String(rs[key]); }
      s.addEventListener('change', () => { rs[key] = num ? parseFloat(s.value) : s.value; App.saveState(); render(); });
      return s;
    };
    const num = (label, key, step) => {
      const i = h('input', { type: 'number', step: step || 'any', value: rs[key], 'aria-label': label });
      i.addEventListener('input', () => { const v = parseFloat(i.value); if (isFinite(v)) { rs[key] = v; App.saveState(); render(); } });
      return i;
    };
    const field = (label, el, hint) => h('div', { class: 'field' }, h('label', { text: label }), el, hint ? h('small', { class: 'hint', text: hint }) : null);

    const bodySel = h('select', { 'aria-label': 'Body' }, bodyOpts.map((b) => h('option', { value: b.id, text: b.name })));
    bodySel.value = rs.body;
    bodySel.addEventListener('change', () => { rs.body = bodySel.value; App.saveState(); render(); });
    const modeSel = h('select', { 'aria-label': 'How to describe the entry' },
      h('option', { value: 'orbit', text: 'From the orbit you arrive on (periapsis and apoapsis)' }),
      h('option', { value: 'speed', text: 'From speed and angle at the top of the atmosphere' }));
    modeSel.value = rs.mode;
    modeSel.addEventListener('change', () => { rs.mode = modeSel.value; App.saveState(); renderForm(); render(); });

    const form = h('div', { class: 'card' });
    function renderForm() {
      form.replaceChildren(...[
        h('h2', { text: 'Reentry and plasma blackout' }),
        h('p', { class: 'hint', text: 'Plasma around a re-entering vessel blacks out CommNet when the difficulty option Plasma Blackout is on. The rules come from the game’s code; this tab finds when and where they trigger on your entry so you can plan the landing around the silence.' }),
        h('p', { class: 'hint', text: 'Bodies and atmospheres are the ones in the world you set up: the stock game’s, or the air curves a planet pack gives its bodies when you import it. A pack body whose config lacks the air curves uses the stock body of the same name if there is one.' }),
        h('div', { class: 'row' }, field('Body', bodySel), field('Describe the entry', modeSel)),
        rs.mode === 'orbit'
          ? h('div', { class: 'row' }, field('Periapsis altitude (m)', num('Periapsis altitude in metres', 'pe', 1000), 'inside the atmosphere'), field('Apoapsis altitude (m, or blank for an escape)', num('Apoapsis altitude in metres', 'ap', 100000), 'a negative value means an escape'), field('Escape speed left over (m/s)', num('Speed at infinity in metres per second', 'vinf', 50), 'used when the apoapsis is negative'))
          : h('div', { class: 'row' }, field('Speed at the top (m/s)', num('Entry speed', 'speed', 50), 'surface-relative'), field('Angle below the horizon (°)', num('Entry angle', 'angle', 0.5))),
        h('div', { class: 'row' }, field('Vessel', sel('Ballistic coefficient', 'ballistic', BALLISTIC, true), 'mass ÷ (drag coefficient × area)'),
          field('Link direction', sel('Link direction', 'link', LINKS, true), 'angle between the link and the direction of travel'),
          field('Reentry heating scale', num('Reentry heating scale', 'heat', 0.1), '1 = default, 0.5 = Easy')),
      ].filter(Boolean));
    }

    function entryOf(body) {
      if (rs.mode === 'speed') return { speed: rs.speed, angle: rs.angle };
      const e = R.entryFromOrbit(body, rs.pe, rs.ap < 0 ? null : rs.ap, rs.vinf);
      return e;
    }

    function render() {
      const body = App.world.bodies.find((b) => b.id === rs.body);
      const e0 = entryOf(body);
      const kids = [];
      if (!e0) { out.replaceChildren(h('div', { class: 'card warn', text: 'The periapsis is above the top of the atmosphere (' + km(R.atmosphere(rs.body).depth) + '), so the vessel never enters.' })); draw(null); return; }
      const o = { speed: e0.speed, angle: e0.angle, ballistic: rs.ballistic, heat: rs.heat, link: rs.link };
      const e = R.entry(body, o);
      kids.push(h('div', { class: 'card' },
        h('h3', { text: 'The entry' }),
        h('p', { class: 'stats', text: 'Arrives at ' + e0.speed.toFixed(0) + ' m/s, ' + e0.angle.toFixed(1) + '° below the horizon, ' + km(R.atmosphere(rs.body).depth) + ' up. ' +
          (e.skipped ? 'At this angle the vessel skips back out of the atmosphere without ever dropping low (try a lower periapsis or a steeper angle).' : e.landed ? 'It reaches the ground after ' + dur(e.flightTime) + ' and ' + km(e.final.range) + ' downrange (no lift, no parachutes).' : 'It is still flying after ' + dur(e.flightTime) + '.') }),
        h('p', { class: 'hint', text: 'Peak deceleration ' + e.peakDecel.toFixed(1) + ' g · peak shock temperature ' + Math.round(e.peakShock) + ' K · the shock heating in the game depends on the Reentry Heating setting.' })));
      if (e.blackout) {
        const b = e.blackout;
        kids.push(h('div', { class: 'card warn' },
          h('h3', { text: 'Blackout: ' + dur(b.duration) }),
          h('p', {}, h('strong', { text: 'Signal lost ' }), 'at ' + km(b.start.alt) + ' and ' + b.start.speed.toFixed(0) + ' m/s, ' + dur(b.start.t) + ' after entering the atmosphere, ' + km(b.start.range) + ' downrange.'),
          h('p', {}, h('strong', { text: 'Signal back ' }), 'at ' + km(b.end.alt) + ' and ' + b.end.speed.toFixed(0) + ' m/s, ' + dur(b.end.t) + ' after entering, ' + km(b.end.range) + ' downrange.'),
          e.partial && e.partial.duration > b.duration + 1 ? h('p', { class: 'hint', text: 'The signal is already weakened from ' + km(e.partial.start.alt) + ' (' + e.partial.start.speed.toFixed(0) + ' m/s) until ' + km(e.partial.end.alt) + '.' }) : null));
      } else if (e.plasma) {
        kids.push(h('div', { class: 'card good', text: 'Plasma forms (from ' + km(e.plasma.start.alt) + ') but this link direction keeps enough signal: no total blackout.' }));
      } else if (!e.skipped) {
        kids.push(h('div', { class: 'card good', text: 'No plasma at all on this entry: it never gets hot and dense enough at the same time.' }));
      }
      const lim = h('div', { class: 'card' }, h('h3', { text: 'How fast can you come in?' }), h('p', { class: 'hint', text: 'Searches the speed at the top of the atmosphere, with the same angle and vessel. Entries with a different angle give different numbers. A shallow entry that starts slowly still speeds up as it falls, which is why this can be lower than the steady-speed threshold below. Entries above escape speed at a shallow angle skip back out and are left out.' }));
      const btn = h('button', { class: 'btn', type: 'button' }, 'Find the blackout-free speed');
      btn.addEventListener('click', () => {
        const full = R.speedLimit(body, o, 'full'), any = R.speedLimit(body, o, 'any');
        const f = (x) => (x.limit === null ? 'even a slow entry at this angle blacks out' : x.limit === Infinity ? 'every speed that still enters (up to ' + x.feasibleMax.toFixed(0) + ' m/s)' : 'up to ' + x.limit.toFixed(0) + ' m/s');
        lim.append(h('p', {}, h('strong', { text: 'No total blackout: ' }), f(full)), h('p', {}, h('strong', { text: 'No plasma at all: ' }), f(any)));
        btn.disabled = true;
      });
      lim.append(btn);
      const mp = R.minimumPlasmaSpeed(rs.body, rs.heat);
      kids.push(lim, h('p', { class: 'hint', text: 'Anywhere on ' + body.name + ', plasma cannot form below about ' + mp.speed.toFixed(0) + ' m/s (reached at ' + km(mp.altitude) + '): the shock temperature has to pass 1100 K in air thicker than 5×10⁻⁵ kg/m³. Above that the blackout band is where speed × dynamic pressure is large enough.' }));
      out.replaceChildren(...kids);
      draw(e, body, o);
    }

    function draw(e, body, o) {
      const par = canvas.parentElement, pcs = par ? getComputedStyle(par) : null;
      const inner = par ? par.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight) : 0; // the card's padding is not drawing space
      const W = Math.max(300, Math.floor(inner || 640)), H = Math.round(W * 0.6);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!e) return;
      const depth = R.atmosphere(rs.body).depth;
      const vMax = Math.max(6000, Math.ceil((e.samples.length ? e.samples[0].speed : 3000) / 1000 + 1) * 1000);
      const m = R.map(rs.body, { link: rs.link, heat: rs.heat, maxSpeed: vMax });
      const pad = { l: 46, r: 8, t: 8, b: 30 };
      const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
      const cw = pw / m.speeds.length, ch = ph / m.alts.length;
      m.grid.forEach((row, j) => row.forEach((mod, i) => {
        ctx.fillStyle = mod === 0 ? 'rgba(220,80,80,0.75)' : mod < 1 ? 'rgba(240,180,41,' + (0.15 + 0.5 * (1 - mod)) + ')' : 'rgba(80,120,160,0.10)';
        ctx.fillRect(pad.l + i * cw, pad.t + j * ch, cw + 0.6, ch + 0.6);
      }));
      const text = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#ddd';
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.fillStyle = text; ctx.font = '11px system-ui, sans-serif';
      ctx.strokeRect(pad.l, pad.t, pw, ph);
      for (let v = 0; v <= vMax; v += 1000) { const x = pad.l + (v / vMax) * pw; ctx.fillText(String(v), x - 8, H - 14); }
      ctx.fillText('speed (m/s)', pad.l + pw / 2 - 25, H - 2);
      for (let a = 0; a <= depth; a += depth / 5) { const y = pad.t + ph - (a / depth) * ph; ctx.fillText((a / 1000).toFixed(0) + ' km', 2, y + 4); }
      ctx.strokeStyle = '#5fd2a3'; ctx.lineWidth = 2; ctx.beginPath();
      e.samples.forEach((s, i) => {
        const x = pad.l + Math.min(1, s.speed / vMax) * pw, y = pad.t + ph - Math.min(1, s.alt / depth) * ph;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke(); ctx.lineWidth = 1;
      void body; void o;
    }

    root.append(form, out, h('div', { class: 'card' },
      h('h3', { text: 'Altitude and speed' }),
      h('p', { class: 'hint', text: 'Red: the link is blacked out at that steady altitude and speed. Amber: weakened. The green line is your entry, which slows as it descends.' }),
      canvas));
    renderForm();
    render();
    return { update: function () { render(); } };
  }

  App.registerTab('reentry', 'Reentry blackout', build, 'antennas');
})();
