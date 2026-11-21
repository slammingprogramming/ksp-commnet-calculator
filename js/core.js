// SPDX-License-Identifier: AGPL-3.0-or-later
/* CommNet maths. No DOM access; usable from the browser and from Node (for tests).
 *
 *   vessel power  P = strongest * (sum of powers / strongest) ^ e          (e = power-weighted mean exponent)
 *   link range    R = sqrt(P_a * P_b)
 *   signal        x = clamp(1 - d / R, 0, 1);  S = 3x^2 - 2x^3
 *   path signal   product of the signal of each hop
 *
 * A vessel's own connection uses all its antennas; a vessel relaying for someone else only contributes
 * its relay-type antennas. Range Modifier scales every vessel; DSN Modifier scales the DSN.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.KSPCore = factory(root.KSPData);
})(typeof self !== 'undefined' ? self : this, function (Data) {
  'use strict';

  const BUILTIN_POWER = 5e3;
  const FULL_SIGNAL = 0.995; // displayed as 100%

  /* ---------- number parsing / formatting ---------- */

  const DIST_UNITS = { '': 1, m: 1, km: 1e3, Mm: 1e6, mm: 1e6, Gm: 1e9, gm: 1e9, Tm: 1e12, tm: 1e12, k: 1e3, K: 1e3, M: 1e6, G: 1e9, g: 1e9, T: 1e12, t: 1e12 };
  const POWER_UNITS = { '': 1, k: 1e3, K: 1e3, M: 1e6, m: 1e6, G: 1e9, g: 1e9, T: 1e12, t: 1e12 };
  const NUM_RE = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z]*)\s*$/;

  function parseWithUnits(text, units) {
    if (typeof text === 'number') return isFinite(text) ? text : NaN;
    if (text == null) return NaN;
    const m = NUM_RE.exec(String(text).replace(/,/g, ''));
    if (!m) return NaN;
    const mult = units[m[2]];
    if (mult === undefined) return NaN;
    return parseFloat(m[1]) * mult;
  }
  const parseDistance = (t) => parseWithUnits(t, DIST_UNITS);
  const parsePower = (t) => parseWithUnits(t, POWER_UNITS);

  function siParts(x) {
    const a = Math.abs(x);
    if (a >= 1e12) return [x / 1e12, 'T'];
    if (a >= 1e9) return [x / 1e9, 'G'];
    if (a >= 1e6) return [x / 1e6, 'M'];
    if (a >= 1e3) return [x / 1e3, 'k'];
    return [x, ''];
  }
  function trim(n, digits) {
    let s = Number(n).toPrecision(digits);
    if (s.indexOf('e') >= 0) s = String(Number(s));
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  function formatPower(p, digits) {
    if (!isFinite(p) || p <= 0) return '0';
    const [v, u] = siParts(p);
    return trim(v, digits || 3) + u;
  }
  function formatDistance(d, digits) {
    if (!isFinite(d)) return '–';
    if (d === 0) return '0 m';
    const a = Math.abs(d);
    let v, u;
    if (a >= 1e12) [v, u] = [d / 1e12, 'Tm'];
    else if (a >= 1e9) [v, u] = [d / 1e9, 'Gm'];
    else if (a >= 1e6) [v, u] = [d / 1e6, 'Mm'];
    else if (a >= 1e3) [v, u] = [d / 1e3, 'km'];
    else [v, u] = [d, 'm'];
    return trim(v, digits || 3) + ' ' + u;
  }
  function formatPercent(s) {
    if (!(s > 0)) return '0%';
    if (s >= FULL_SIGNAL) return '100%';
    const p = s * 100;
    if (p < 1) return '<1%';
    return Math.round(p) + '%';
  }

  /* ---------- link maths ---------- */

  function signalStrength(distance, range) {
    if (!(range > 0) || !(distance >= 0)) return 0;
    const x = 1 - distance / range;
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return (3 - 2 * x) * x * x;
  }

  function linkRange(powerA, powerB) {
    if (!(powerA > 0) || !(powerB > 0)) return 0;
    return Math.sqrt(powerA * powerB);
  }

  /** Inverse of the signal curve: relative distance x in [0,1] giving signal s. */
  function invertSignal(s) {
    if (s <= 0) return 0;
    if (s >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if ((3 - 2 * mid) * mid * mid < s) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Link range needed so that `distance` gets at least `target` signal (0..1). */
  function rangeForSignal(distance, target) {
    const t = Math.min(Math.max(target, 0.001), FULL_SIGNAL);
    return distance / (1 - invertSignal(t));
  }

  /** Vessel power needed at one end, given the other end's power. */
  function powerForSignal(distance, target, otherPower) {
    if (!(otherPower > 0)) return Infinity;
    const r = rangeForSignal(distance, target);
    return (r * r) / otherPower;
  }

  /* ---------- antennas / vessels ---------- */

  /** items: [{power, exp, count}] -> {power, exp, strongest, sum} (before difficulty modifiers). */
  function combine(items) {
    let strongest = 0, sum = 0, weighted = 0;
    for (const it of items) {
      if (!(it.count > 0) || !(it.power > 0)) continue;
      strongest = Math.max(strongest, it.power);
      sum += it.power * it.count;
      weighted += it.power * it.count * (it.exp || 0);
    }
    if (sum <= 0) return { power: 0, exp: 0, strongest: 0, sum: 0 };
    const exp = weighted / sum;
    return { power: strongest * Math.pow(sum / strongest, exp), exp: exp, strongest: strongest, sum: sum };
  }

  /**
   * The game's algorithm for a vessel's antenna powers (read from CommNet.CommNetVessel.UpdateComm, 1.12.5).
   * items: [{power, exp, combinable, type ('direct'|'relay'|'internal'), count}]. Returns
   *  - relay: strongest relay antenna, or the combined relay antennas if that is stronger;
   *  - transmit: if the vessel has any direct/internal antenna, the combination of ALL combinable antennas
   *    when a combinable direct antenna exists and the result beats the best direct one, else the best direct one;
   *  - own: what the vessel uses on its own link, max(transmit, relay). Non-combinable antennas never add up.
   */
  function antennaPowers(items) {
    let hasD = false, bestD = 0, sumD = 0, wD = 0, maxD = 0, bestR = 0, sumR = 0, wR = 0, maxR = 0;
    for (const it of items) {
      const p = it.power, n = it.count;
      if (!(p > 0) || !(n > 0)) continue;
      const comb = it.combinable !== false;
      if (it.type === 'relay') {
        bestR = Math.max(bestR, p);
        if (comb) { sumR += p * n; wR += p * n * (it.exp || 0); maxR = Math.max(maxR, p); }
      } else {
        hasD = true;
        bestD = Math.max(bestD, p);
        if (comb) { sumD += p * n; wD += p * n * (it.exp || 0); maxD = Math.max(maxD, p); }
      }
    }
    const comb = (sum, w, max) => (sum > 0 ? (sum === max ? max : max * Math.pow(sum / max, w / sum)) : 0);
    const relay = Math.max(bestR, comb(sumR, wR, maxR));
    let transmit = 0, exp = 0;
    if (hasD) {
      const sumC = sumD + sumR, maxC = Math.max(maxD, maxR);
      const combined = comb(sumC, wD + wR, maxC);
      exp = sumC > 0 ? (wD + wR) / sumC : 0;
      transmit = sumD > 0 && combined > bestD ? combined : bestD;
    }
    return { relay: relay, transmit: transmit, own: Math.max(transmit, relay), exp: exp };
  }

  /**
   * entries: [{id, count}]; lookup(id) -> antenna. Returns the vessel's power for its own connection
   * (`own`, every antenna) and when relaying for others (`relay`, relay antennas only).
   */
  function vesselStats(entries, lookup, rangeModifier) {
    const mod = rangeModifier == null ? 1 : rangeModifier;
    const all = [], relay = [];
    let unknown = 0, antennaCount = 0;
    for (const e of entries || []) {
      const a = lookup(e.id);
      if (!a) { unknown += 1; continue; }
      const count = Math.max(0, Math.floor(Number(e.count) || 0));
      if (!count) continue;
      antennaCount += count;
      // The game ignores a transmitter that is not fully extended (ModuleDataTransmitter.CanComm), so a retracted or broken
      // antenna contributes nothing.
      if (e.retracted) continue;
      const refl = e.reflector && a.feed ? Data.REFLECTORS.find((r) => r.id === e.reflector) : null;
      const item = { power: a.power + (refl ? refl.bonus * a.feed : 0), exp: a.combinable === false ? 0 : a.exp, combinable: a.combinable !== false, type: a.type, count: count };
      all.push(item);
      if (a.type === 'relay') relay.push(item);
    }
    const ap = antennaPowers(all);
    const rel = combine(relay);
    const fallback = ap.own === 0 && unknown === 0;
    return {
      own: (fallback ? BUILTIN_POWER : ap.own) * mod,
      relay: ap.relay * mod,
      transmit: ap.transmit * mod,
      exp: ap.exp,
      relayExp: rel.exp,
      strongest: ap.own * mod,
      sum: ap.own * mod,
      antennaCount: antennaCount,
      usedBuiltin: fallback,
      unknown: unknown,
    };
  }

  function dsnPower(node, dsnModifier) {
    const mod = dsnModifier == null ? 1 : dsnModifier;
    if (node.custom != null && node.level === 'custom') return Math.max(0, Number(node.custom) || 0) * mod;
    const lvl = Data.DSN_LEVELS.find((l) => l.level === Number(node.level));
    return (lvl ? lvl.power : 0) * mod;
  }

  /* ---------- relay chains ---------- */

  /**
   * chain.nodes[0] is the DSN / far end ({kind:'dsn'} or {kind:'vessel'}); the rest are vessels.
   * chain.hops[i] is the distance (m) between nodes[i] and nodes[i+1].
   * Interior nodes act as relays (relay antennas only); the last node uses its full power.
   */
  function evaluateChain(nodes, hops, ctx) {
    const last = nodes.length - 1;
    const powers = nodes.map((n, i) => {
      if (n.kind === 'dsn') return { power: dsnPower(n, ctx.dsnModifier), role: 'dsn', stats: null };
      const stats = vesselStats(n.antennas, ctx.lookup, ctx.rangeModifier);
      if (i === last) return { power: stats.own, role: 'endpoint', stats: stats };
      // interior vessel, or a vessel acting as the far end of the chain: relays for others
      return { power: stats.relay, role: 'relay', stats: stats };
    });
    const out = [];
    let total = 1;
    for (let i = 0; i < hops.length; i++) {
      const a = powers[i], b = powers[i + 1];
      const d = hops[i];
      const range = linkRange(a.power, b.power);
      const s = signalStrength(d, range);
      total *= s;
      out.push({
        index: i, distance: d, powerA: a.power, powerB: b.power, range: range, signal: s,
        fullSignalRange: range * 0.0414,
        margin: range - d,
        noRelayA: a.role === 'relay' && a.power === 0,
        noRelayB: b.role === 'relay' && b.power === 0,
      });
    }
    const weakest = out.reduce((w, h) => (w === null || h.signal < w.signal ? h : w), null);
    return { nodes: powers, hops: out, total: total, connected: out.length > 0 && out.every((h) => h.signal > 0), weakest: weakest };
  }

  /* ---------- antenna finder ---------- */

  /**
   * Find minimal antenna setups reaching `target` signal against a far end of `farPower`.
   * opts: {antennas, farPower, distance, target (0..1), role ('own'|'relay'), maxCount, rangeModifier, sort, limit}
   * A setup is "minimal": removing any single antenna would drop it below the target.
   */
  function findSetups(opts) {
    const target = Math.min(Math.max(opts.target, 0), FULL_SIGNAL);
    const mod = opts.rangeModifier == null ? 1 : opts.rangeModifier;
    const maxCount = opts.maxCount || 6;
    const role = opts.role || 'own';
    const pool = opts.antennas.filter((a) => a.power > 0 && (role !== 'relay' || a.type === 'relay'));
    const items = (setup) => setup.map((c) => ({ power: c.a.power, exp: c.a.combinable === false ? 0 : c.a.exp, combinable: c.a.combinable !== false, type: c.a.type, count: c.n }));
    const powerOf = (setup) => { const ap = antennaPowers(items(setup)); return role === 'relay' ? ap.relay : ap.own; };
    const signalOf = (setup) => {
      const p = powerOf(setup) * mod;
      return signalStrength(opts.distance, linkRange(p, opts.farPower));
    };
    const meets = (setup) => signalOf(setup) >= target;
    const minimal = (setup) => {
      for (let i = 0; i < setup.length; i++) {
        const reduced = setup.map((c, j) => (j === i ? { a: c.a, n: c.n - 1 } : c)).filter((c) => c.n > 0);
        if (reduced.length && meets(reduced)) return false;
      }
      return true;
    };
    const found = [];
    const consider = (setup) => {
      if (meets(setup) && minimal(setup)) found.push(setup);
    };
    for (let i = 0; i < pool.length; i++) {
      for (let n = 1; n <= maxCount; n++) consider([{ a: pool[i], n: n }]);
      for (let j = i + 1; j < pool.length; j++) {
        if (pool[j].id === pool[i].id) continue;
        for (let n = 1; n <= Math.min(maxCount, 3); n++) {
          for (let m = 1; m <= Math.min(maxCount, 3); m++) consider([{ a: pool[i], n: n }, { a: pool[j], n: m }]);
        }
      }
    }
    const rows = found.map((setup) => {
      const mass = setup.reduce((q, c) => q + c.a.mass * c.n, 0);
      const cost = setup.reduce((q, c) => q + c.a.cost * c.n, 0);
      const parts = setup.reduce((q, c) => q + c.n, 0);
      const powerRaw = powerOf(setup) * mod;
      return {
        setup: setup.map((c) => ({ id: c.a.id, name: c.a.name, count: c.n, antenna: c.a })),
        power: powerRaw, signal: signalStrength(opts.distance, linkRange(powerRaw, opts.farPower)),
        mass: mass, cost: cost, parts: parts,
      };
    });
    const keys = {
      mass: (r) => [r.mass, r.cost, r.parts],
      cost: (r) => [r.cost, r.mass, r.parts],
      parts: (r) => [r.parts, r.mass, r.cost],
      signal: (r) => [-r.signal, r.mass, r.cost],
    };
    const key = keys[opts.sort] || keys.mass;
    rows.sort((a, b) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return 0;
    });
    return rows.slice(0, opts.limit || 40);
  }

  return {
    BUILTIN_POWER: BUILTIN_POWER,
    FULL_SIGNAL: FULL_SIGNAL,
    parseDistance: parseDistance,
    parsePower: parsePower,
    formatPower: formatPower,
    formatDistance: formatDistance,
    formatPercent: formatPercent,
    signalStrength: signalStrength,
    linkRange: linkRange,
    invertSignal: invertSignal,
    rangeForSignal: rangeForSignal,
    powerForSignal: powerForSignal,
    combine: combine,
    antennaPowers: antennaPowers,
    vesselStats: vesselStats,
    dsnPower: dsnPower,
    evaluateChain: evaluateChain,
    findSetups: findSetups,
  };
});
