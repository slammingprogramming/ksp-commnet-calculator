// SPDX-License-Identifier: AGPL-3.0-or-later
/* Landing tab: finds landing sites by tilt, latitude, height, biome and distance; shows the biomes of a body, what a lander can
 * measure there, and (Breaking Ground) the deployed instruments and surface rocks. Uses js/landing.js and the game terrain summary
 * in js/terrain-data.js. */
(function () {
  'use strict';

  const App = window.KSPApp;
  const Data = window.KSPData;
  const CD = window.KSPCareerData;
  const Career = window.KSPCareer;
  const Land = window.KSPLanding;
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
  const fmt = (x, d) => (x === null || x === undefined ? '—' : String(Math.round(x * Math.pow(10, d || 0)) / Math.pow(10, d || 0)));
  const lonlat = (r) => Math.abs(r.lat).toFixed(1) + '° ' + (r.lat < 0 ? 'S' : 'N') + ', ' + Math.abs(r.lon).toFixed(1) + '° ' + (r.lon < 0 ? 'W' : 'E');
  const pct = (x) => (x === null || x === undefined ? '—' : Math.round(x * 100) + '%');

  function st() {
    const s = App.state.landing;
    if (!Land.has(s.body)) s.body = Land.bodies()[0];
    return s;
  }

  function build(root) {
    const out = h('div', {});
    root.append(out);
    let found = null, key = '';
    const cv = h('canvas', { width: 720, height: 360, class: 'map-canvas', role: 'img', 'aria-label': 'Map of the body: biomes, candidate sites' });
    const info = h('div', { class: 'card' });

    function render() {
      const s = st();
      const body = Land.body(s.body);
      const bodyDef = Data.bodies.find((b) => b.id === s.body);
      const opts = optionsOf(s);
      const k = JSON.stringify([s.body, opts]);
      if (k !== key) { found = null; key = k; }
      const biomeList = Land.biomeTable(s.body);

      const bodySel = select(Land.bodies().map((b) => [b, b]), s.body, (v) => { s.body = v; s.pick = null; s.biomes = []; s.avoid = []; s.near = null; changed(); }, 'Body');
      const rankSel = select([['flat', 'Flattest first'], ['variety', 'Most biomes in reach'], ['close', 'Closest to the reference point'], ['low', 'Lowest ground'], ['high', 'Highest ground']], s.rank, (v) => { s.rank = v; changed(); }, 'Rank by');
      const shareSel = select([['0.25', '25%'], ['0.5', '50%'], ['0.75', '75%'], ['0.9', '90%']], String(s.share), (v) => { s.share = parseFloat(v); changed(); }, 'Share of the ground');

      const biomeBox = (listKey, label) => h('details', {}, h('summary', { text: label + (s[listKey].length ? ' (' + s[listKey].length + ')' : '') }),
        h('div', { class: 'checks' }, biomeList.map((b) => {
          const c = h('input', { type: 'checkbox', 'aria-label': label + ': ' + b.name });
          c.checked = s[listKey].indexOf(b.name) >= 0;
          c.addEventListener('change', () => { s[listKey] = s[listKey].filter((x) => x !== b.name); if (c.checked) s[listKey].push(b.name); changed(); });
          return h('label', { class: 'inline' }, c, ' ',
            h('span', { class: 'swatch', style: 'display:inline-block;width:0.8em;height:0.8em;margin-right:0.3em;background:rgb(' + b.rgb.join(',') + ')' }), b.name + ' (' + Math.round(b.share * 100) + '%)');
        })));

      const nearLine = s.near
        ? h('span', { text: 'Reference point ' + lonlat(s.near) + ' ' }, h('button', { class: 'btn small', type: 'button', onclick: () => { s.near = null; changed(); } }, 'Clear'))
        : h('span', { class: 'hint', text: 'None. Click the map and press "Use as reference point", or ' }, s.body === 'Kerbin' ? h('button', { class: 'btn small', type: 'button', onclick: () => { s.near = { lat: -0.0972, lon: -74.5577 }; changed(); } }, 'use the Space Center') : null);

      const run = h('button', { class: 'btn primary', type: 'button', onclick: () => { found = Land.find(s.body, opts); draw(); renderResults(); } }, 'Find sites');

      const controls = h('div', { class: 'card' },
        h('h3', { text: 'Landing sites' }),
        h('p', { class: 'hint', text: 'Pick what the lander and the base can take. The finder reads the game’s own height map for ' + s.body + (body.hasHeight ? '' : ' (this body has none: its ground is made by noise only, so there are biomes but no slope data)') + ' and keeps the places where enough of the ground is gentle enough. A "region" here is one grid cell of about ' + fmt(body.cellKm[0], 1) + ' km.' }),
        h('div', { class: 'row' },
          field('Body', bodySel),
          field('Land at up to', num(s.landTilt, (v) => { s.landTilt = Math.max(0, v === null ? 10 : v); changed(); }, { min: 0, max: 60, step: 1, label: 'Landing tilt' }), '° of tilt'),
          field('Stay on up to', num(s.stayTilt, (v) => { s.stayTilt = Math.max(0, v === null ? 5 : v); changed(); }, { min: 0, max: 60, step: 1, label: 'Staying tilt' }), '° of tilt'),
          field('How much of the region', shareSel, 'must be that gentle')),
        h('div', { class: 'row' },
          field('Latitude no more than', num(s.maxLat, (v) => { s.maxLat = v === null ? 90 : Math.max(0, Math.min(90, v)); changed(); }, { min: 0, max: 90, step: 1, label: 'Maximum latitude' }), '° from the equator'),
          field('Height from', num(s.minAlt, (v) => { s.minAlt = v; changed(); }, { step: 100, label: 'Lowest height' }), 'm (blank = any)'),
          field('to', num(s.maxAlt, (v) => { s.maxAlt = v; changed(); }, { step: 100, label: 'Highest height' }), 'm'),
          Land.OCEAN.indexOf(s.body) >= 0 ? field('Dry land only', (() => { const c = h('input', { type: 'checkbox', 'aria-label': 'Dry land only' }); c.checked = !!s.dry; c.addEventListener('change', () => { s.dry = c.checked; changed(); }); return c; })()) : null),
        h('div', { class: 'row' }, biomeBox('biomes', 'Only these biomes'), biomeBox('avoid', 'Leave out these biomes')),
        h('div', { class: 'row' },
          field('Reference point', h('div', {}, nearLine)),
          s.near ? field('within', num(s.nearKm, (v) => { s.nearKm = v === null ? 500 : Math.max(10, v); changed(); }, { min: 10, step: 50, label: 'Distance from the reference point' }), 'km') : null,
          field('Count biomes within', num(s.varietyKm, (v) => { s.varietyKm = v === null ? 100 : Math.max(10, v); changed(); }, { min: 10, step: 10, label: 'Biome reach' }), 'km (for hopping)'),
          field('Rank', rankSel)),
        h('div', { class: 'row' }, run, h('span', { class: 'hint', text: ' Results are regions to inspect, not a guarantee: see the notes below.' })));

      const results = h('div', { class: 'card', id: 'landing-results' });
      function renderResults() {
        if (!found) { results.replaceChildren(h('p', { class: 'hint', text: 'Press "Find sites" to search.' })); return; }
        if (found.error) { results.replaceChildren(h('p', { class: 'bad', text: found.error })); return; }
        const rows = found.rows;
        const head = h('p', { class: 'hint', text: found.matches + ' regions match; the ' + rows.length + ' best, at least ' + fmt(Math.max(body.cellKm[0], body.cellKm[1]) * 2, 0) + ' km apart:' });
        results.replaceChildren(...[
          h('h3', { text: 'Candidates' }), head,
          !rows.length ? h('p', { class: 'bad', text: 'Nothing fits. Allow a steeper tilt, a smaller share, or widen the latitude and height limits.' }) : null,
          rows.length ? h('div', { class: 'scroll' }, h('table', {},
            h('thead', {}, h('tr', {}, ['#', 'Where', 'Biome', 'Height (m)', 'Relief (m)', 'Slope: half / 90%', 'Gentle enough: land / stay', 'Biomes in reach', ''].map((t, i) => h('th', { class: i >= 3 && i < 8 ? 'num' : '', text: t })))),
            h('tbody', {}, rows.map((r, n) => h('tr', { class: s.pick && s.pick.cx === r.cx && s.pick.cy === r.cy ? 'sel' : '' },
              h('td', { text: String(n + 1) }), h('td', { text: lonlat(r) }), h('td', { text: r.biome + (r.second !== r.biome ? ' / ' + r.second : '') }),
              h('td', { class: 'num', text: fmt(r.alt) }), h('td', { class: 'num', text: fmt(r.relief) }),
              h('td', { class: 'num', text: r.slope ? fmt(r.slope.q50, 1) + '° / ' + fmt(r.slope.q90, 1) + '°' : '—' }),
              h('td', { class: 'num', text: pct(r.landShare) + ' / ' + pct(r.stayShare) }),
              h('td', { class: 'num', title: r.nearby.join(', '), text: String(r.variety) }),
              h('td', {}, h('button', { class: 'btn small', type: 'button', onclick: () => { s.pick = { cx: r.cx, cy: r.cy }; changed(); } }, 'Details'))))))) : null,
        ].filter(Boolean));
      }

      // ---- the map -------------------------------------------------------------------------------------------
      function draw() {
        const W = cv.width, H = cv.height, ctx = cv.getContext('2d');
        const img = ctx.createImageData(W, H);
        const pass = new Uint8Array(Land.GW * Land.GH);
        if (found && found.cells) for (const i of found.cells) pass[i] = 1;
        for (let y = 0; y < H; y++) {
          const lat = 90 - (y + 0.5) / H * 180;
          for (let x = 0; x < W; x++) {
            const lon = -180 + (x + 0.5) / W * 360;
            const c = Land.cellAt(lat, lon);
            const i = c.cy * Land.GW + c.cx;
            const rgb = body.colors[body.bio[i]];
            const lit = !found || pass[i] ? 1 : 0.35;
            const o = (y * W + x) * 4;
            img.data[o] = rgb[0] * lit; img.data[o + 1] = rgb[1] * lit; img.data[o + 2] = rgb[2] * lit; img.data[o + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        const px = (p) => [((p.lon + 180) / 360) * W, ((90 - p.lat) / 180) * H];
        ctx.lineWidth = 2; ctx.font = '12px sans-serif';
        if (found && found.rows) found.rows.forEach((r, n) => {
          const [x, y] = px(r);
          ctx.strokeStyle = '#d02a8c'; ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#000'; ctx.fillText(String(n + 1), x + 8, y + 4);
        });
        if (s.near) { const [x, y] = px(s.near); ctx.strokeStyle = '#1155cc'; ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke(); }
        if (s.pick) { const p = Land.cellPos(s.pick.cx, s.pick.cy), [x, y] = px(p); ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeRect(x - 7, y - 7, 14, 14); }
      }
      cv.onclick = (e) => {
        const r = cv.getBoundingClientRect();
        const lon = -180 + ((e.clientX - r.left) / r.width) * 360, lat = 90 - ((e.clientY - r.top) / r.height) * 180;
        s.pick = Land.cellAt(lat, lon); changed();
      };

      // ---- details of the picked region ----------------------------------------------------------------------
      info.replaceChildren(...detail(s, body, bodyDef, changed));

      const legend = h('div', { class: 'row legend' }, biomeList.map((b) => h('span', { class: 'chip' }, h('span', { style: 'display:inline-block;width:0.9em;height:0.9em;margin-right:0.3em;vertical-align:-0.1em;background:rgb(' + b.rgb.join(',') + ')' }), b.name + ' ' + Math.round(b.share * 100) + '%')));

      out.replaceChildren(controls, results, h('div', { class: 'card' }, h('h3', { text: s.body + ': ' + biomeList.length + ' biomes' }),
        h('p', { class: 'hint', text: 'Every biome is its own science subject, so each experiment pays again in each biome (see the Career tab for the values). Cells outside your filters are dimmed; pink circles are the candidates; the black square is the region you picked.' }), cv, legend), info, notes(body));
      draw(); renderResults();
      const open = s.open || (s.open = {});
      for (const d of out.querySelectorAll('details')) {
        const k = d.querySelector('summary').textContent.split(/[(:]/)[0].trim();
        if (open[k] !== undefined) d.open = open[k];
        d.addEventListener('toggle', () => { open[k] = d.open; });
      }
    }

    function optionsOf(s) {
      return {
        landTilt: s.landTilt, stayTilt: s.stayTilt, share: s.share, maxLat: s.maxLat, minAlt: s.minAlt === null ? undefined : s.minAlt, maxAlt: s.maxAlt === null ? undefined : s.maxAlt,
        dry: !!s.dry, biomes: s.biomes, avoid: s.avoid, near: s.near ? { lat: s.near.lat, lon: s.near.lon, km: s.nearKm } : undefined, varietyKm: s.varietyKm, rank: s.rank, count: 15,
      };
    }
    const changed = () => { App.saveState(); render(); };

    function notes(body) {
      return h('details', { class: 'card' }, h('summary', { text: 'How far to trust the numbers' }),
        h('ul', {},
          h('li', { text: 'The slopes come from the game’s height map for the whole planet (about ' + fmt(body.cellKm[0] * 1000 / 32) + ' m per map pixel at this body). The game adds noise on top of it: hills, small craters and rocks that are not in the map. A region that looks flat here can still have a steep patch; one that looks steep is steep.' }),
          h('li', { text: 'The map is 8-bit, so the height changes in steps (a few tens of metres); a "flat" region can hide gentle slopes below a degree or two.' }),
          h('li', { text: 'Bodies without a height map (Minmus, Ike, Gilly, Bop, Pol) are shaped by noise alone: only biomes are shown for them.' }),
          h('li', { text: 'Heights are the map’s heights; the true surface also depends on the noise and on a few fixed offsets, so expect them to be off by a few hundred metres.' }),
          h('li', { text: 'To check a spot in the game, open the map view near the site and read the terrain slope there, or park a probe and tilt-check with the navball once landed. Treat the finder as a shortlist.' })));
    }
    render();
    return { update: render };
  }

  /** The panel about the region the user picked: science a lander can do, rocks, deployed instruments. */
  function detail(s, body, bodyDef, changed) {
    if (!s.pick) return [h('h3', { text: 'Pick a region' }), h('p', { class: 'hint', text: 'Click the map or press "Details" next to a candidate to see what a lander can measure there and which Breaking Ground instruments fit.' })];
    const i = s.pick.cy * Land.GW + s.pick.cx;
    const pos = Land.cellPos(s.pick.cx, s.pick.cy);
    const biome = body.biomes[body.bio[i]];
    const sl = Land.slopes(body, i);
    const nBiomes = body.biomes.length;
    const kids = [h('h3', { text: 'Region at ' + lonlat(pos) }),
      h('p', {}, h('button', { class: 'btn small', type: 'button', onclick: () => { s.near = { lat: pos.lat, lon: pos.lon }; changed(); } }, 'Use as reference point')),
      h('p', { text: 'Biome ' + biome + (body.bio2[i] !== body.bio[i] ? ' (and ' + body.biomes[body.bio2[i]] + ')' : '') + (body.hasHeight ? '; map height ' + fmt(body.hMean[i]) + ' m; relief ' + fmt(body.relief[i] * 32) + ' m; slope half of the ground under ' + fmt(sl.q50, 1) + '°, 90% under ' + fmt(sl.q90, 1) + '°.' : '; no height map for this body.') }),
      body.hasHeight ? h('p', { text: 'Share of the ground within ' + s.landTilt + '° (landing): ' + pct(Land.flatShare(sl, s.landTilt)) + '; within ' + s.stayTilt + '° (staying): ' + pct(Land.flatShare(sl, s.stayTilt)) + '.' }) : null];

    // lander experiments
    const table = Career.scienceTable(s.body, nBiomes).filter((r) => r.key === 'landed' || r.key === 'splashed');
    let first = 0, perBiome = 0;
    for (const r of table) { if (r.key === 'splashed') continue; first += r.first; if (r.biomeDependent) perBiome += r.first; }
    kids.push(h('h4', { text: 'Lander experiments here' }),
      h('p', { class: 'hint', text: 'Landed on ' + s.body + ' you can collect the first-return values below; the ones marked biome pay again in every biome you reach (' + nBiomes + ' on this body). Recovered or returned science pays the full first-return value; transmitting gives a fraction.' }),
      h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Experiment', 'First return', 'Subject cap', 'Per biome?'].map((t, n) => h('th', { class: n >= 1 && n <= 2 ? 'num' : '', text: t })))),
        h('tbody', {}, table.filter((r) => r.key === 'landed').map((r) => h('tr', {}, h('td', { text: r.title }), h('td', { class: 'num', text: fmt(r.first, 1) }), h('td', { class: 'num', text: fmt(r.cap, 1) }), h('td', { text: r.biomeDependent ? 'yes' : 'no (whole body)' })))))),
      h('p', { text: 'One landing here, every landed experiment once: about ' + fmt(first) + ' science (' + fmt(perBiome) + ' of it repeatable in other biomes). Visiting all ' + nBiomes + ' biomes with the biome ones: about ' + fmt(first - perBiome + perBiome * nBiomes) + '.' }));

    // rocks
    const rocs = CD.deployed ? CD.deployed.rocs.filter((r) => r.bodies.some((b) => b.body === s.body)) : [];
    if (rocs.length) {
      kids.push(h('h4', { text: 'Surface rocks (Breaking Ground)' }),
        h('p', { class: 'hint', text: 'The special rocks that can be scanned with the ROC arm and where they appear. This region is in ' + biome + '.' }),
        h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Rock', 'Biomes', 'Here?', 'Science', 'Common?'].map((t) => h('th', { text: t })))),
          h('tbody', {}, rocs.map((r) => {
            const b = r.bodies.find((x) => x.body === s.body);
            const sci = CD.deployed.rocScience[r.type];
            return h('tr', {}, h('td', { text: r.name }), h('td', { text: b.biomes.join(', ') || 'any' }), h('td', { text: !b.biomes.length || b.biomes.indexOf(biome) >= 0 ? 'yes' : 'no' }),
              h('td', { class: 'num', text: sci ? fmt(sci.cap) : '—' }), h('td', { text: r.freq >= 0.5 ? 'common' : r.freq >= 0.2 ? 'some' : 'rare' }));
          })))));
    }

    // deployed instruments
    const D = CD.deployed;
    if (D && Object.keys(D.instruments).length) {
      const dp = s.deploy;
      const atmo = Career.hasAtmosphere(s.body);
      const okOf = (e) => !(e.atmo && !atmo) && !(e.vacuum && atmo);
      const countOf = (id) => (dp.counts[id] === undefined || dp.counts[id] === null ? (okOf(D.instruments[id]) ? 1 : 0) : dp.counts[id]);
      const career = App.state.career && App.state.career.state;
      const gain = dp.gain !== null && dp.gain !== undefined ? dp.gain : career ? career.diff.gain[1] : 1;
      const level = dp.level === null || dp.level === undefined ? -1 : dp.level;
      const units = [];
      for (const id of Object.keys(D.instruments)) for (let k = 0; k < countOf(id); k++) units.push({ id: id, level: level < 0 ? null : level });
      const res = Career.deployedScience(s.body, units, { power: dp.power, gain: gain });
      const nInst = units.length;
      const pw = Career.deployPower(nInst, dp.dish ? 1 : 0, 0, dp.engineer);
      const levels = [['-1', 'Not a scientist (5%)']].concat([0, 1, 2, 3, 4, 5].map((l) => [String(l), 'Scientist, level ' + l + ' (' + fmt(Career.deployRate(l)) + '%)']));
      const engLevels = [['0', 'Anyone else / level 0']].concat([1, 2, 3, 4, 5].map((l) => [String(l), 'Engineer, level ' + l + ' (+' + Career.engineerBonus(l) + ')']));
      const dayH = Data.DAY / 3600, yearH = Data.YEAR / 3600;   // the home world's calendar (a planet pack can change it)
      const hrs = (x) => (x === null ? '—' : x >= yearH ? fmt(x / yearH, 1) + ' years' : x >= dayH ? fmt(x / dayH, 1) + ' days' : fmt(x, 1) + ' h');
      kids.push(h('h4', { text: 'Deployed instruments (Breaking Ground)' }),
        h('p', { class: 'hint', text: 'Set down on EVA from a kerbal’s inventory within 20 m of an Experiment Control Station (it has no limit on how many it runs) and powered (solar panel or RTG). All instruments of one kind on ' + s.body + ' fill one shared subject: per hour each makes its base rate × the body’s landed multiplier (×' + res.multiplier + ' here) × the rate fixed by whoever set it down, until the subject holds its cap (cap × multiplier). The science goes home over CommNet, so the station needs a link to the KSC.' }),
        h('div', { class: 'row' },
          field('Set down by', select(levels, String(level), (v) => { dp.level = parseInt(v, 10); changed(); }, 'Who sets the instruments down')),
          field('Power', select([['1', 'Enough (RTG, or solar in sunlight while you watch)'], ['0.5', 'Solar only, while you are elsewhere (half rate)'], ['0', 'Not enough power (no science)']], String(dp.power), (v) => { dp.power = parseFloat(v); changed(); }, 'Power')),
          field('Science gain ×', num(gain, (v) => { dp.gain = v; changed(); }, { size: 5, step: 0.05, min: 0, label: 'science gain' }), career ? 'from your career; clear to follow it' : 'difficulty setting')),
        h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Instrument', 'Part', 'Price', 'How many', 'Share of each','Science per hour', 'Total (cap)', 'Time to cap', 'Works on ' + s.body + '?'].map((t, n) => h('th', { class: n >= 2 && n <= 7 ? 'num' : '', text: t })))),
          h('tbody', {}, res.rows.map((r) => {
            const part = CD.parts.find((p) => p.ground === r.id);
            const runs = !r.count ? '—' : r.count === 1 ? '100%' : '100% + ' + (r.count - 1) + ' × ' + fmt(r.share * 100) + '%';
            return h('tr', { class: r.ok ? '' : 'dim' },
              h('td', { text: r.title.replace('Surface Deployed ', '') }), h('td', { text: part ? part.title : '—' }), h('td', { class: 'num', text: part ? fmt(part.cost) : '—' }),
              h('td', { class: 'num' }, num(countOf(r.id), (v) => { dp.counts[r.id] = v === null ? null : Math.max(0, Math.min(20, Math.round(v))); changed(); }, { size: 3, step: 1, min: 0, max: 20, label: 'how many ' + r.title })),
              h('td', { class: 'num', text: runs }),
              h('td', { class: 'num', text: r.impact ? 'per impact (below)' : r.ok ? fmt(r.perHour, 3) : '—' }),
              h('td', { class: 'num', text: r.ok ? fmt(r.cap, 1) : '—' }),
              h('td', { class: 'num', text: r.impact || !r.ok ? '—' : hrs(r.hours) }),
              h('td', { text: r.ok ? 'yes' : (D.instruments[r.id].atmo ? 'needs an atmosphere' : 'needs no atmosphere') }));
          })))),
        h('p', { text: 'Together: ' + fmt(res.perHour, 2) + ' science per hour, up to ' + fmt(res.total) + ' in all from the instruments that work here.' }),
        h('p', { class: 'hint', text: 'More than one of a kind does not raise the cap, it only fills it sooner, and the extras run at a reduced share (the game’s table: ' + D.returns.map((r) => r[0] + ' of a kind = ' + fmt(r[1] * 100) + '%').join(', ') + '; the best-rated one always runs at 100%). So one of each kind is usually the better buy. The rate is fixed when the part is set down: a scientist gives ' + fmt(Career.deployRate(0)) + '–' + fmt(Career.deployRate(5)) + '% by level, anyone else ' + fmt(Career.deployRate(null)) + '%.' }),
        h('div', { class: 'row' },
          field('Ground dish (HG-48)', h('input', { type: 'checkbox', checked: !!dp.dish, 'aria-label': 'Ground dish', onchange: (ev) => { dp.dish = ev.target.checked ? 1 : 0; changed(); } })),
          field('Panels/RTGs set down by', select(engLevels, String(dp.engineer || 0), (v) => { dp.engineer = parseInt(v, 10); changed(); }, 'Who sets the power parts down'))),
        h('p', { text: 'Power: the control station' + (dp.dish ? ', the dish' : '') + ' and ' + nInst + ' instrument' + (nInst === 1 ? '' : 's') + ' need ' + pw.need + ' power unit' + (pw.need === 1 ? '' : 's') + '; each solar panel or RTG gives ' + pw.each + ', so set down ' + pw.makers + '. Solar panels give nothing at night, and while you are away the game runs a solar-only station at half rate.' }),
        ...seismicBlock(s.body, dp, units.filter((u) => u.id === 'deployedSeismicSensor'), gain, D, changed));
    }
    return kids;
  }

  /** The seismometer pays per impact: what one crash of a given mass, speed and distance gives, and how many fill the subject. */
  function seismicBlock(bodyName, dp, sensors, gain, D, changed) {
    if (!D.instruments.deployedSeismicSensor) return [];
    const im = dp.impact || (dp.impact = { mass: 5, speed: 550, km: null, done: 0 });
    const b = Data.bodies.find((x) => x.name === bodyName || x.id === bodyName);
    const radius = b ? b.radius : null;
    const base = Career.seismicImpact(bodyName, { radius: radius });
    const km = im.km === null || im.km === undefined ? (base.bestDistance === null ? null : base.bestDistance / 1000) : im.km;
    const r = Career.seismicImpact(bodyName, { mass: im.mass, speed: im.speed, distance: km === null ? null : km * 1000, radius: radius,
      units: sensors.length ? sensors : null, power: dp.power, gain: gain, done: (im.done || 0) / (gain || 1) });
    const out = [h('h4', { text: 'Seismometer: science per impact' }),
      h('p', { class: 'hint', text: 'The seismometer earns nothing per hour; it pays when something crashes into ' + bodyName + ' while the station runs. The game takes the crash energy (½ × mass × speed², the speed at the surface), divides it by the body’s energy scale, and pays that fraction of the cap × the rate fixed when the sensor was set down × the share for its distance, never past the cap. Impacts under ' + fmt(D.seismicMin) + ' J do not count.' + (sensors.length ? '' : ' (No seismometer is planned above; this assumes one, set down as chosen.)') })];
    if (!r.ok) {
      out.push(h('p', { text: 'The game has no energy scale for ' + bodyName + ', so impacts there give no seismic science.' }));
      return out;
    }
    out.push(h('div', { class: 'row' },
      field('Impactor mass (t)', num(im.mass, (v) => { im.mass = v === null ? 0 : Math.max(0, v); changed(); }, { size: 6, step: 0.5, min: 0, label: 'impactor mass in tonnes' }), 'the whole spent stage, with what fuel is left'),
      field('Speed at impact (m/s)', num(im.speed, (v) => { im.speed = v === null ? 0 : Math.max(0, v); changed(); }, { size: 6, step: 10, min: 0, label: 'impact speed' }), 'surface speed when it hits'),
      field('Distance from the sensor (km)', num(km === null ? null : Math.round(km * 10) / 10, (v) => { im.km = v === null ? null : Math.max(0, v); changed(); }, { size: 6, step: 0.5, min: 0, label: 'impact distance in km' }), 'clear for the best distance'),
      field('Seismic science already in', num(im.done || 0, (v) => { im.done = v === null ? 0 : Math.max(0, v); changed(); }, { size: 6, step: 1, min: 0, label: 'seismic science already collected' }), 'of the ' + fmt(r.cap, 1) + ' cap')));
    const pctOf = (x) => fmt(x * 100, 1) + '%';
    const sentence = r.below
      ? 'This impact has ' + fmt(r.joules) + ' J, under the ' + fmt(r.minimum) + ' J the game needs: no science.'
      : 'This impact has ' + r.joules.toExponential(2) + ' J, ' + pctOf(r.ratio) + ' of the energy scale for ' + bodyName + ' (' + r.scale.toExponential(2) + ' J). At ' + fmt(km, 1) + ' km the sensor gets ' + pctOf(r.distanceShare) + ' of it. Science from it: ' + fmt(r.science, 1) +
        (r.perImpact > r.science + 1e-9 ? ' (it would be ' + fmt(r.perImpact, 1) + ', but the cap stops it)' : '') + '.';
    out.push(h('p', { text: sentence }));
    if (r.left <= 0) out.push(h('p', { text: 'The subject is full: more impacts give nothing.' }));
    else if (r.impactsToFill !== null) {
      out.push(h('p', { text: (r.impactsToFill === 1 ? 'One such impact fills' : r.impactsToFill + ' such impacts fill') + ' the ' + fmt(r.left, 1) + ' still open. One impact fills it alone with ' + r.joulesToFill.toExponential(2) + ' J' + (r.massToFill !== null ? ', about ' + fmt(r.massToFill, 1) + ' t at ' + fmt(im.speed) + ' m/s' : '') + '.' }));
    }
    if (r.bestDistance !== null) {
      out.push(h('p', { class: 'hint', text: 'Distance counts by the angle around the body: the best is ' + fmt(r.bestDistance / 1000, 1) + ' km away (100%); right on top of the sensor gives nothing, and from ' + fmt(r.farDistance / 1000) + ' km on the share stays at ' + pctOf(r.farShare) + '. A scientist who sets the sensor down raises the rate up to 20 times (5% → 100%). Each sensor counts the impact, the extras at the reduced share, but the subject still stops at its cap.' }));
    }
    return out;
  }

  App.registerTab('landing', 'Landing', build, 'antennas');
})();
