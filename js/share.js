// SPDX-License-Identifier: AGPL-3.0-or-later
/* Scenario export / import and share links. Pure logic, no DOM, no network.
 *
 * Everything that comes in (a file, or a link someone sent) is untrusted: `parseScenario` copies only known fields into
 * brand-new objects, clamps every number, caps every length and never evaluates anything. The UI still asks before it
 * replaces the user's scenario.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KSPShare = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FORMAT = 'kspcomm-scenario';
  const VERSION = 1;
  const MAX_NODES = 200;
  const MAX_ANTENNA_ROWS = 40;
  const MAX_TEXT_BYTES = 400000; // refuse anything bigger before parsing
  const ID_RE = /^[A-Za-z0-9_.:\- ]{1,80}$/;
  const BODY_RE = /^[A-Za-z0-9_.\- ]{1,40}$/;

  const SETTING_KEYS = {
    dsnLevel: ['int', 1, 3], rangeMod: ['num', 0.05, 10], dsnMod: ['num', 0.05, 10], occVac: ['num', 0.1, 1.25], occAtm: ['num', 0.1, 1.25],
    extraStations: ['bool'], makingHistory: ['bool'], allowOtherLaunchSites: ['bool'], sunOccludes: ['bool'], atmoBlocks: ['bool'],
  };

  const num = (v, lo, hi, dflt) => {
    const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!isFinite(x)) return dflt;
    return Math.min(hi, Math.max(lo, x));
  };
  const text = (v, max, dflt) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : dflt);

  /** Scenario + (optionally) game settings -> plain JSON-able object. */
  function exportScenario(scenario, settings, appVersion) {
    const out = { format: FORMAT, version: VERSION, app: appVersion || null, ut: scenario.ut || 0, nodes: [] };
    for (const n of scenario.nodes) {
      const o = { name: n.name, tracked: n.tracked !== false, loc: Object.assign({}, n.loc), antennas: (n.antennas || []).map((a) => Object.assign({ id: a.id, count: a.count }, a.retracted ? { retracted: true } : {}, a.reflector ? { reflector: a.reflector } : {})) };
      if (n.planned) { o.planned = true; if (n.group) o.group = n.group; }
      out.nodes.push(o);
    }
    if (settings) {
      out.settings = {};
      for (const k of Object.keys(SETTING_KEYS)) if (settings[k] !== undefined) out.settings[k] = settings[k];
    }
    return out;
  }

  function cleanLoc(loc, warn, name) {
    if (!loc || typeof loc !== 'object') { warn.push('“' + name + '”: no location, skipped'); return null; }
    const body = typeof loc.body === 'string' && BODY_RE.test(loc.body) ? loc.body : null;
    if (!body) { warn.push('“' + name + '”: invalid body, skipped'); return null; }
    if (loc.type === 'landed') {
      return { type: 'landed', body: body, lat: num(loc.lat, -90, 90, 0), lon: num(loc.lon, -360, 360, 0), alt: num(loc.alt, -1e6, 1e8, 0) };
    }
    if (loc.type === 'orbit') {
      const out = {
        type: 'orbit', body: body, pe: num(loc.pe, 0, 1e13, 100000), ap: num(loc.ap, 0, 1e13, 100000),
        i: num(loc.i, -180, 180, 0), lan: num(loc.lan, -720, 720, 0), w: num(loc.w, -720, 720, 0), phase: num(loc.phase, -720, 720, 0),
      };
      if (loc.patched === true) out.patched = true;
      if (Array.isArray(loc.burns)) {
        const burns = loc.burns.slice(0, 12).map((b) => (b && typeof b === 'object' ? { t: num(b.t, -1e13, 1e13, NaN), prograde: num(b.prograde, -1e5, 1e5, 0), normal: num(b.normal, -1e5, 1e5, 0), radial: num(b.radial, -1e5, 1e5, 0) } : null)).filter((b) => b && isFinite(b.t));
        if (burns.length) out.burns = burns;
      }
      const el = loc.elements;
      if (el && typeof el === 'object') {
        const a = num(el.a, -1e15, 1e15, NaN), e = num(el.e, 0, 50, NaN);
        if (isFinite(a) && a !== 0 && isFinite(e) && (a > 0 ? e < 1 : e > 1)) {
          out.elements = { a: a, e: e, i: num(el.i, -180, 180, 0), lan: num(el.lan, -720, 720, 0), w: num(el.w, -720, 720, 0), m0: num(el.m0, -1e9, 1e9, 0), epoch: num(el.epoch, -1e13, 1e13, 0) };
        } else warn.push('\u201c' + name + '\u201d: invalid orbit elements ignored');
      }
      return out;
    }
    warn.push('“' + name + '”: unknown location type, skipped');
    return null;
  }

  /**
   * Validate untrusted input (JSON text or an object). Returns { scenario: {ut, nodes}, settings, warnings } or { error }.
   * `hasAntenna(id)` (optional) lets the caller flag antenna ids this install does not know.
   */
  function parseScenario(input, hasAntenna) {
    let data = input;
    if (typeof input === 'string') {
      if (input.length > MAX_TEXT_BYTES) return { error: 'That file is too large to be a scenario.' };
      try { data = JSON.parse(input); } catch (e) { return { error: 'Not valid JSON.' }; }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'Not a scenario file.' };
    if (data.format !== FORMAT) return { error: 'This is not a KSP CommNet Workbench scenario.' };
    if (!(Number(data.version) >= 1) || Number(data.version) > VERSION) return { error: 'This scenario was made by a newer version of the app.' };
    if (!Array.isArray(data.nodes)) return { error: 'The scenario has no list of vessels.' };

    const warnings = [];
    const nodes = [];
    const src = data.nodes.slice(0, MAX_NODES);
    if (data.nodes.length > MAX_NODES) warnings.push('Only the first ' + MAX_NODES + ' of ' + data.nodes.length + ' vessels were read.');
    src.forEach((n, i) => {
      if (!n || typeof n !== 'object') return;
      const name = text(n.name, 60, 'Vessel ' + (i + 1)) || 'Vessel ' + (i + 1);
      const loc = cleanLoc(n.loc, warnings, name);
      if (!loc) return;
      const antennas = [];
      for (const a of (Array.isArray(n.antennas) ? n.antennas : []).slice(0, MAX_ANTENNA_ROWS)) {
        if (!a || typeof a.id !== 'string' || !ID_RE.test(a.id)) continue;
        const count = Math.floor(num(a.count, 0, 99, 1));
        if (hasAntenna && !hasAntenna(a.id)) warnings.push('“' + name + '”: antenna ' + a.id + ' is not available here (enable its pack or import it); it is kept but ignored.');
        const ant = { id: a.id, count: count };
        if (a.retracted === true) ant.retracted = true;
        if (typeof a.reflector === 'string' && ID_RE.test(a.reflector)) ant.reflector = a.reflector;
        antennas.push(ant);
      }
      const node = { name: name, tracked: n.tracked !== false, loc: loc, antennas: antennas };
      if (n.planned === true) { node.planned = true; if (typeof n.group === 'string') node.group = text(n.group, 40, ''); }
      nodes.push(node);
    });

    let settings = null;
    if (data.settings && typeof data.settings === 'object') {
      settings = {};
      for (const k of Object.keys(SETTING_KEYS)) {
        const spec = SETTING_KEYS[k], v = data.settings[k];
        if (v === undefined) continue;
        if (spec[0] === 'bool') settings[k] = v === true;
        else if (spec[0] === 'int') settings[k] = Math.round(num(v, spec[1], spec[2], spec[1]));
        else settings[k] = num(v, spec[1], spec[2], 1);
      }
    }
    return { scenario: { ut: num(data.ut, 0, 1e13, 0), nodes: nodes }, settings: settings, warnings: warnings };
  }

  /* ---------- link encoding: base64url of UTF-8 (the UI may deflate it first; see "z." prefix) ---------- */

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function toBase64Url(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)];
      if (i + 1 < bytes.length) out += B64[((b1 & 15) << 2) | (b2 >> 6)];
      if (i + 2 < bytes.length) out += B64[b2 & 63];
    }
    return out;
  }

  /** Returns a Uint8Array, or null for malformed input. */
  function fromBase64Url(str) {
    if (typeof str !== 'string' || str.length > MAX_TEXT_BYTES * 2 || /[^A-Za-z0-9_-]/.test(str) || str.length % 4 === 1) return null;
    const out = new Uint8Array(Math.floor((str.length * 3) / 4));
    let o = 0;
    for (let i = 0; i < str.length; i += 4) {
      const c = [0, 1, 2, 3].map((k) => (i + k < str.length ? B64.indexOf(str[i + k]) : 0));
      out[o++] = (c[0] << 2) | (c[1] >> 4);
      if (i + 2 < str.length) out[o++] = ((c[1] & 15) << 4) | (c[2] >> 2);
      if (i + 3 < str.length) out[o++] = ((c[2] & 3) << 6) | c[3];
    }
    return out.slice(0, o);
  }

  const utf8 = (s) => new TextEncoder().encode(s);
  const unutf8 = (b) => new TextDecoder('utf-8', { fatal: true }).decode(b);

  return {
    FORMAT: FORMAT, VERSION: VERSION, MAX_NODES: MAX_NODES, MAX_TEXT_BYTES: MAX_TEXT_BYTES, SETTING_KEYS: SETTING_KEYS,
    exportScenario: exportScenario, parseScenario: parseScenario,
    toBase64Url: toBase64Url, fromBase64Url: fromBase64Url, utf8: utf8, unutf8: unutf8,
  };
});
