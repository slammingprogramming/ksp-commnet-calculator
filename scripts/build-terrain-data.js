#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Builds js/terrain-data.js: a coarse summary of each planet's terrain for the Landing tab. Input is the folder written by
 *   python tools/unityscan/unityscan.py "<KSP folder>" facts.json --terrain=<folder>
 * (one `<Body>.height` and `<Body>.biome` file per body plus terrain.json). The summary is a grid of GRID_W x GRID_H cells per
 * body; each cell holds its main and second biome, mean height, relief and three slope percentiles measured on the full-size
 * height map. Numbers only, no pictures; run again after a game update. */
'use strict';
const fs = require('fs');
const path = require('path');

const GRID_W = 128, GRID_H = 64;
const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/build-terrain-data.js <terrain folder>'); process.exit(2); }
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'terrain.json'), 'utf8'));
const Data = require('../js/data.js');
const radius = {};
for (const b of Data.bodies) radius[b.id] = b.radius;

const SLOPE_STEP = 0.25;           // degrees per stored unit
const BINS = 360;                  // slope histogram: 0.25 degree bins up to 90
const out = { grid: [GRID_W, GRID_H], slopeStep: SLOPE_STEP, bodies: {} };
let bytes = 0;

for (const body of Object.keys(meta).sort()) {
  const m = meta[body];
  const R = radius[body];
  if (!R || !m.biomes) continue;
  const bio = fs.readFileSync(path.join(dir, body + '.biome'));
  const nb = m.biomes.length;
  const cells = GRID_W * GRID_H;
  const b1 = new Uint8Array(cells), b2 = new Uint8Array(cells);
  // biomes: most and second most common index in each cell (the map's rows run south to north, like the height map)
  for (let cy = 0; cy < GRID_H; cy++) for (let cx = 0; cx < GRID_W; cx++) {
    const x0 = Math.floor(cx * m.bw / GRID_W), x1 = Math.floor((cx + 1) * m.bw / GRID_W);
    const y0 = Math.floor(cy * m.bh / GRID_H), y1 = Math.floor((cy + 1) * m.bh / GRID_H);
    const cnt = new Uint32Array(nb);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) cnt[bio[y * m.bw + x]]++;
    let a = 0, c = -1;
    for (let k = 1; k < nb; k++) if (cnt[k] > cnt[a]) a = k;
    for (let k = 0; k < nb; k++) if (k !== a && cnt[k] > 0 && (c < 0 || cnt[k] > cnt[c])) c = k;
    b1[cy * GRID_W + cx] = a; b2[cy * GRID_W + cx] = c < 0 ? a : c;
  }
  const rec = { biomes: m.biomes.map((b) => b.name), colors: m.biomes.map((b) => b.rgb), bio: b1, bio2: b2 };
  if (m.heightMap) {
    const hm = fs.readFileSync(path.join(dir, body + '.height'));
    const W = m.w, H = m.h;
    const z = (x, y) => m.offset + m.scale * hm[y * W + ((x + W) % W)] / 255;
    const hMean = new Int16Array(cells), relief = new Uint8Array(cells), s25 = new Uint8Array(cells), s50 = new Uint8Array(cells), s90 = new Uint8Array(cells);
    let hMin = Infinity, hMax = -Infinity;
    for (let cy = 0; cy < GRID_H; cy++) for (let cx = 0; cx < GRID_W; cx++) {
      const x0 = Math.floor(cx * W / GRID_W), x1 = Math.floor((cx + 1) * W / GRID_W);
      const y0 = Math.floor(cy * H / GRID_H), y1 = Math.floor((cy + 1) * H / GRID_H);
      const hist = new Uint32Array(BINS + 1);
      let n = 0, sum = 0, lo = Infinity, hi = -Infinity;
      for (let y = y0; y < y1; y++) {
        const lat = ((y + 0.5) / H - 0.5) * Math.PI;
        const dx = 2 * Math.PI * R * Math.max(0.02, Math.cos(lat)) / W, dy = Math.PI * R / H;
        const ya = Math.max(0, y - 1), yb = Math.min(H - 1, y + 1);
        for (let x = x0; x < x1; x++) {
          const zc = z(x, y);
          const gx = (z(x + 1, y) - z(x - 1, y)) / (2 * dx), gy = (z(x, yb) - z(x, ya)) / ((yb - ya) * dy);
          const s = Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI;
          hist[Math.min(BINS, Math.round(s / SLOPE_STEP))]++;
          sum += zc; n++; if (zc < lo) lo = zc; if (zc > hi) hi = zc;
        }
      }
      const q = (p) => { let acc = 0; const t = p * n; for (let k = 0; k <= BINS; k++) { acc += hist[k]; if (acc >= t) return k; } return BINS; };
      const i = cy * GRID_W + cx;
      hMean[i] = Math.round(sum / n); relief[i] = Math.min(255, Math.round((hi - lo) / 32));
      s25[i] = q(0.25); s50[i] = q(0.5); s90[i] = q(0.9);
      if (lo < hMin) hMin = lo; if (hi > hMax) hMax = hi;
    }
    Object.assign(rec, { hMean, relief, s25, s50, s90, hMin: Math.round(hMin), hMax: Math.round(hMax), scale: m.scale, offset: m.offset, mapW: W, mapH: H });
  }
  // pack: every array as base64 of its raw little-endian bytes
  const packed = { biomes: rec.biomes, colors: rec.colors };
  for (const k of ['bio', 'bio2', 'hMean', 'relief', 's25', 's50', 's90']) {
    if (!rec[k]) continue;
    const a = rec[k];
    packed[k] = Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
    bytes += a.byteLength;
  }
  for (const k of ['hMin', 'hMax', 'scale', 'offset', 'mapW', 'mapH']) if (rec[k] !== undefined) packed[k] = rec[k];
  out.bodies[body] = packed;
  console.log('%s: %d biomes%s', body, nb, m.heightMap ? ', height ' + rec.hMin + '..' + rec.hMax + ' m, map ' + m.w + 'x' + m.h : ', no height map');
}

const header = '// SPDX-License-Identifier: AGPL-3.0-or-later\n/* GENERATED by scripts/build-terrain-data.js from KSP 1.12.5 terrain maps: a coarse grid per body (biome, mean height, relief,\n * slope percentiles). Numbers only. Do not edit by hand. */\n';
const body = '(function (root, factory) {\n  if (typeof module === \'object\' && module.exports) module.exports = factory();\n  else root.KSPTerrainData = factory();\n})(typeof self !== \'undefined\' ? self : this, function () {\n  \'use strict\';\n  return ' + JSON.stringify(out) + ';\n});\n';
fs.writeFileSync(path.join(__dirname, '..', 'js', 'terrain-data.js'), header + body);
console.log('raw %d KB, file %d KB', Math.round(bytes / 1024), Math.round((header + body).length / 1024));
