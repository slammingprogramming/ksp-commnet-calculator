// SPDX-License-Identifier: AGPL-3.0-or-later
/* Relay planning: diagnose why blackouts happen, then design structural fixes.
 * No DOM access. Long-running work is written as generators so the UI can time-slice it.
 *
 * Strategy ("a real bandage, not a band-aid"): attribute every outage to the body that blocks the line,
 * then fix the *cause* rather than the symptom:
 *   - a body blocks the link (Kerbin's night side, the moon a lander sits on, ...) -> a ring of relays
 *     around that body, tested against every point on the surface, not just today's asset;
 *   - Kerbol blocks the link at conjunction -> relays in Kerbin-like solar orbits 60 degrees ahead/behind,
 *     which keep their geometry to Kerbin permanently;
 *   - weak / out of range -> more power, sized last so the geometry is judged fairly.
 * After every fix the whole scenario is re-simulated over the horizon, and the remaining outage is
 * re-diagnosed, until the uptime target is met.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./orbits.js'), require('./core.js'), require('./sim.js'));
  } else root.KSPPlanner = factory(root.KSPData, root.KSPOrbits, root.KSPCore, root.KSPSim);
})(typeof self !== 'undefined' ? self : this, function (Data, Orb, Core, Sim) {
  'use strict';

  const DEG = Orb.DEG;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------- helpers ---------- */

  /** Fibonacci-sphere surface points (near-uniform coverage of a body). */
  function surfaceSamples(n) {
    const pts = [];
    for (let k = 0; k < n; k++) {
      const z = 1 - (2 * (k + 0.5)) / n;
      const lat = Math.asin(z) / DEG;
      const lon = (((k * 137.50776405) % 360) + 360) % 360;
      pts.push({ lat: lat, lon: lon > 180 ? lon - 360 : lon });
    }
    return pts;
  }

  /** Relay-type antenna stacks, lightest way to reach each power level (ascending power). */
  function relayTiers(pool, rangeMod) {
    const items = [];
    for (const a of pool) {
      if (a.type !== 'relay' || a.builtin || a.ground || !(a.power > 0)) continue;
      for (let n = 1; n <= 4; n++) {
        const p = Core.combine([{ power: a.power, exp: a.combinable ? a.exp : 0, count: n }]).power * (rangeMod == null ? 1 : rangeMod);
        items.push({ setup: [{ id: a.id, count: n }], power: p, mass: a.mass * n, cost: a.cost * n, label: n + '× ' + a.name });
      }
    }
    items.sort((x, y) => y.power - x.power || x.mass - y.mass);
    const keep = [];
    let minMass = Infinity;
    for (const it of items) { // from strongest down: keep an item only if it is lighter than every stronger one
      if (it.mass < minMass) { keep.push(it); minMass = it.mass; }
    }
    return keep.reverse();
  }

  function* runScan(sim, t0, t1, dt, coarse) {
    // coarse: candidate comparison, edges only need to be known to a fraction of the step
    const sc = Sim.createScanner(sim, t0, t1, dt, coarse ? dt / 8 : 0);
    while (!sc.run(25)) yield sc.progress;
    return sc.result;
  }

  /** Aggregate outage time by cause across all sources of a scan result. */
  function causeTable(result) {
    const map = new Map();
    let total = 0;
    for (const s of result.sources) {
      for (const b of s.blackouts) {
        const keys = b.causes.length ? b.causes : [{ type: 'range' }];
        const per = b.duration / keys.length;
        total += b.duration;
        for (const c of keys) {
          const ids = c.type === 'occlusion' ? c.bodies.map((id) => 'occ:' + id) : [c.type];
          for (const id of ids) {
            const rec = map.get(id) || { id: id, type: c.type, body: id.startsWith('occ:') ? id.slice(4) : null, time: 0, events: 0 };
            rec.time += per / ids.length;
            rec.events += 1 / ids.length;
            map.set(id, rec);
          }
        }
      }
    }
    return { total: total, causes: Array.from(map.values()).sort((a, b) => b.time - a.time) };
  }

  const worstUptime = (result) => result.sources.reduce((m, s) => Math.min(m, s.uptime), 1);
  const meanUptime = (result) => (result.sources.length ? result.sources.reduce((q, s) => q + s.uptime, 0) / result.sources.length : 1);

  /* ---------- candidate builders ---------- */

  function ringNodes(world, bodyId, n, alt, incDeg, lanDeg, phase0Deg, antennas, groupId, label) {
    const body = world.index.get(bodyId);
    const nodes = [];
    for (let k = 0; k < n; k++) {
      nodes.push({
        id: groupId + ':' + (k + 1), name: label + ' ' + (k + 1) + '/' + n, tracked: false, planned: true, group: groupId,
        loc: { type: 'orbit', body: bodyId, orbit: Orb.orbitFromAltitudes(body, alt, alt, incDeg, lanDeg, 0, phase0Deg + (360 * k) / n) },
        antennas: clone(antennas),
      });
    }
    return nodes;
  }

  /** Kerbin's geosynchronous ("keostationary") radius; a relay there stays over one longitude. */
  function keoAltitude(world) {
    const k = world.index.get('Kerbin');
    return Orb.smaForPeriod(k.rotPeriod, k.gm) - k.radius;
  }

  function ringAltitudes(world, bodyId) {
    const b = world.index.get(bodyId);
    const lim = world.altitudeLimits(bodyId);
    const cap = 0.6 * (b.soiRadius - b.radius);
    const alts = new Set();
    for (const ratio of [1.5, 2.3, 3.6, 6]) {
      const alt = Math.max(lim.min, (ratio - 1) * b.radius);
      if (alt <= cap) alts.add(Math.round(alt / 1000) * 1000);
    }
    if (!alts.size) alts.add(Math.round(Math.min(cap, Math.max(lim.min, 0.5 * b.radius)) / 1000) * 1000);
    return Array.from(alts).sort((x, y) => x - y);
  }

  /* ---------- the planner ---------- */

  /**
   * problem: {world, lookup, settings (sim settings), nodes (scenario), t0, horizon, target (uptime, 0.995),
   *           minSignal (0..1), pool (antennas usable for relays), robust (bool: design for the whole body)}
   * Generator: yields progress numbers; returns the plan.
   */
  function* planGen(P) {
    const world = P.world, lookup = P.lookup;
    const phase = (t) => { if (P.onPhase) P.onPhase(t); };
    const target = P.target == null ? 0.995 : P.target;
    const settings = Object.assign({}, P.settings, { minSignal: P.minSignal || 0 });
    const t0 = P.t0, t1 = P.t0 + P.horizon;
    const pool = P.pool || Data.antennas.filter((a) => a.pack === 'stock');
    const tiers = relayTiers(pool, settings.rangeMod);
    const ample = tiers.length ? tiers[tiers.length - 1].setup : [{ id: 'stock:RelayAntenna100', count: 3 }];
    const mk = (ns, s) => Sim.createSim({ world, lookup, settings: s || settings, nodes: ns });
    const fullDt = (sim) => Math.max(sim.suggestStep(24), P.horizon / 90000);
    // Comparing candidates only needs the ranking, so scan them at half resolution; accepted designs are re-scanned
    // at full resolution (blackout edges are refined to 0.5 s either way, only blackouts shorter than the step can slip by).
    const roughDt = (sim) => Math.max(fullDt(sim) * 2, P.horizon / 45000);

    let working = clone(P.nodes);
    const steps = [], advice = [], addressed = new Set(), retry = new Set();

    function* diagnose(nodes, rough) {
      const sim = mk(nodes);
      const res = yield* runScan(sim, t0, t1, rough ? roughDt(sim) : fullDt(sim), rough);
      return { sim: sim, res: res, causes: causeTable(res) };
    }

    // ---- baseline ----
    phase('Simulating the scenario as it is');
    let cur = yield* diagnose(working);
    const baseline = cur.res;
    const baselineCauses = cur.causes;
    if (!cur.sim.trackedIdx.length) return { error: 'No tracked assets in the scenario.', steps: [], advice: [] };

    /** Score a candidate relay set over a few short windows (cheap), against extra sample assets. */
    function* quickScore(extraNodes, sampleBody, windows, span) {
      const nodes = working.concat(extraNodes);
      if (sampleBody && P.robust !== false) {
        surfaceSamples(8).forEach((p, i) => nodes.push({
          id: 'sample:' + i, name: 'sample ' + i, tracked: true, sample: true,
          loc: { type: 'landed', body: sampleBody, lat: p.lat, lon: p.lon, alt: 0 }, antennas: [{ id: 'stock:longAntenna', count: 1 }],
        }));
      }
      const sim = mk(nodes);
      const dt = Math.max(30, sim.suggestStep(24));
      let worst = 1, mean = 0;
      for (let w = 0; w < windows; w++) {
        const a = t0 + (P.horizon * (w + 0.5)) / windows;
        const res = yield* runScan(sim, a, a + span, dt, true);
        worst = Math.min(worst, worstUptime(res));
        mean += meanUptime(res) / windows;
      }
      return { worst: worst, mean: mean };
    }

    const trackedBodies = () => new Set(working.filter((n) => n.tracked !== false && !n.planned).map((n) => n.loc.body));

    function* bestRing(bodyId) {
      const body = world.index.get(bodyId);
      const alts = ringAltitudes(world, bodyId);
      const keo = bodyId === 'Kerbin' ? keoAltitude(world) : null;
      const configs = [];
      for (const n of [1, 2, 3, 4]) {
        for (const inc of [0, 90]) {
          for (const alt of alts) configs.push({ n: n, inc: inc, alt: alt, keo: false });
        }
        if (keo) configs.push({ n: n, inc: 0, alt: keo, keo: true });
      }
      const span = Math.max(2 * Data.DAY, 3 * Math.min(body.rotPeriod, 20 * Data.DAY));
      const scored = [];
      let done = 0;
      for (const c of configs) {
        const phase0 = c.keo ? keoPhase(world, 0) : 0; // orbit epoch is UT 0
        const nodes = ringNodes(world, bodyId, c.n, c.alt, c.inc, 0, phase0, ample, 'ring:' + bodyId, (c.keo ? 'Keostationary ' : '') + body.name + ' relay');
        const sc = yield* quickScore(nodes, trackedBodies().has(bodyId) ? bodyId : null, 4, Math.min(span, 4 * Data.DAY));
        scored.push({ cfg: c, nodes: nodes, worst: sc.worst, mean: sc.mean });
        yield ++done / configs.length;
      }
      // prefer: highest worst-case uptime, then fewest relays, then lowest altitude
      scored.sort((x, y) => (Math.abs(y.worst - x.worst) > 0.002 ? y.worst - x.worst : x.cfg.n - y.cfg.n || x.cfg.alt - y.cfg.alt));
      return scored.slice(0, 3);
    }

    function keoPhase(w, t) {
      const k = w.index.get('Kerbin');
      const ksc = Data.STATIONS[0];
      return (((k.rot0 || 0) * DEG + (Orb.TAU * t) / k.rotPeriod) / DEG + ksc.lon) % 360;
    }

    function* solarCandidates() {
      const kerbin = world.index.get('Kerbin');
      const base = kerbin.orbit;
      const out = [];
      const make = (offsets, label) => offsets.map((off, i) => ({
        id: 'solar:' + (i + 1), name: 'Solar relay ' + (i + 1) + '/' + offsets.length, tracked: false, planned: true, group: 'solar',
        loc: { type: 'orbit', body: 'Kerbol', orbit: { a: base.a, e: 0, i: 0, lan: 0, w: 0, m0: base.m0 + off * DEG, epoch: base.epoch } },
        antennas: clone(ample), label: label,
      }));
      out.push({ label: '1 relay 60° ahead of Kerbin', nodes: make([60], '60° ahead'), n: 1 });
      out.push({ label: '1 relay 60° behind Kerbin', nodes: make([-60], '60° behind'), n: 1 });
      out.push({ label: '2 relays, 60° ahead and behind', nodes: make([60, -60], '±60°'), n: 2 });
      return out;
    }

    // ---- iterate ----
    for (let iter = 0; iter < 6; iter++) {
      if (worstUptime(cur.res) >= target) break;
      const cause = cur.causes.causes.find((c) => (c.type === 'occlusion' || c.type === 'range' || c.type === 'weak') && !addressed.has(c.id));
      if (!cause) break;
      addressed.add(cause.id);
      if (cause.type !== 'occlusion') {
        advice.push({ cause: cause, kind: cause.type });
        continue;
      }
      const before = worstUptime(cur.res), beforeMean = meanUptime(cur.res);
      phase('Designing a fix for blockage by ' + cause.body + ' (' + (iter + 1) + ')');
      let proposal = null;
      if (cause.body === 'Kerbol') {
        phase('Trying solar relay positions');
        const cands = yield* solarCandidates();
        let best = null, n = 0;
        for (const c of cands) {
          const d = yield* diagnose(working.concat(c.nodes), true);
          const score = { cand: c, res: d.res, worst: worstUptime(d.res), mean: meanUptime(d.res) };
          if (!best || score.worst > best.worst + 0.0005 || (Math.abs(score.worst - best.worst) <= 0.0005 && c.n < best.cand.n)) best = score;
          yield ++n / cands.length;
        }
        proposal = { family: 'solar', title: 'Relays in Kerbin-like solar orbits', nodes: best.cand.nodes, detail: best.cand.label, worst: best.worst, mean: best.mean, body: 'Kerbol' };
      } else if (world.index.get(cause.body)) {
        phase('Trying relay rings around ' + world.index.get(cause.body).name);
        const top = yield* bestRing(cause.body);
        phase('Checking the best rings over the whole look-ahead');
        // confirm the top candidates over the full horizon
        let best = null;
        for (const c of top) {
          const d = yield* diagnose(working.concat(c.nodes), true);
          const score = { c: c, res: d.res, worst: worstUptime(d.res), mean: meanUptime(d.res) };
          if (!best || score.worst > best.worst + 0.0005 || (Math.abs(score.worst - best.worst) <= 0.0005 && c.cfg.n < best.c.cfg.n)) best = score;
        }
        const cfg = best.c.cfg;
        proposal = {
          family: 'ring', title: (cfg.keo ? 'Keostationary relay ring around ' : 'Relay ring around ') + world.index.get(cause.body).name,
          nodes: best.c.nodes, worst: best.worst, mean: best.mean, body: cause.body, cfg: cfg,
          detail: cfg.n + ' relay' + (cfg.n > 1 ? 's' : '') + ' at ' + Core.formatDistance(cfg.alt) + ' altitude, ' + (cfg.inc === 0 ? 'equatorial' : 'polar') + ' orbit' + (cfg.n > 1 ? ', equally spaced' : ''),
        };
      }
      if (!proposal) continue;
      const improved = proposal.worst > before + 0.0005 || proposal.mean > beforeMean + 0.0005;
      if (!improved) { advice.push({ cause: cause, kind: 'nofix', proposal: proposal }); retry.add(cause.id); continue; }
      working = working.concat(proposal.nodes);
      // a fix can unlock causes that had nothing to fix before (e.g. Kerbin's night side once a far relay exists)
      for (const id of retry) {
        addressed.delete(id);
        const k = advice.findIndex((a) => a.kind === 'nofix' && a.cause.id === id);
        if (k >= 0) advice.splice(k, 1);
      }
      retry.clear();
      cur = yield* diagnose(working);
      steps.push({ cause: cause, proposal: proposal, before: before, after: worstUptime(cur.res), beforeMean: beforeMean, afterMean: meanUptime(cur.res) });
    }

    // ---- prune: later fixes can make earlier ones redundant (e.g. solar relays also cure Kerbin's night side) ----
    const pruned = [];
    phase('Dropping fixes that became redundant');
    {
      const order = Array.from(new Set(working.filter((n) => n.planned).map((n) => n.group))).reverse();
      let ref = order.length ? yield* diagnose(working, true) : cur; // same resolution as the candidates below
      for (const g of order) {
        const without = working.filter((n) => n.group !== g);
        const d = yield* diagnose(without, true);
        if (worstUptime(d.res) >= worstUptime(ref.res) - 0.0003 && meanUptime(d.res) >= meanUptime(ref.res) - 0.0003) {
          pruned.push({ group: g, count: working.length - without.length, uptimeWithout: worstUptime(d.res) });
          working = without;
          ref = d;
          cur = null;
        }
      }
      if (!cur) cur = yield* diagnose(working);
    }

    // ---- size the antennas (geometry is settled; use the lightest power that loses nothing) ----
    const sized = [];
    phase('Choosing the lightest antennas');
    if (tiers.length) {
      const groups = Array.from(new Set(working.filter((n) => n.planned).map((n) => n.group)));
      const ampleRef = groups.length ? yield* diagnose(working, true) : cur;
      const ampleScore = worstUptime(ampleRef.res) - 0.0004;
      const ampleMean = meanUptime(ampleRef.res) - 0.0004;
      for (const g of groups) {
        const members = working.filter((n) => n.group === g);
        let lo = 0, hi = tiers.length - 1, chosen = hi;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          members.forEach((m) => { m.antennas = clone(tiers[mid].setup); });
          const sim = mk(working);
          const res = yield* runScan(sim, t0, t1, roughDt(sim), true);
          const ok = worstUptime(res) >= ampleScore && meanUptime(res) >= ampleMean;
          if (ok) { chosen = mid; hi = mid - 1; } else lo = mid + 1;
        }
        members.forEach((m) => { m.antennas = clone(tiers[chosen].setup); });
        sized.push({ group: g, tier: tiers[chosen], count: members.length });
      }
    }

    const final = yield* diagnose(working);

    phase('Checking the alternatives and stress-testing the design');
    // Cheapest possible fix: the "Enable Extra Groundstations" difficulty option.
    let extraStations = null;
    if (!settings.extraStations) {
      const sim = mk(P.nodes, Object.assign({}, settings, { extraStations: true }));
      const res = yield* runScan(sim, t0, t1, fullDt(sim));
      extraStations = { uptime: worstUptime(res), mean: meanUptime(res) };
    }

    // Stress test: does the finished design survive the other difficulty presets?
    const stress = [];
    for (const preset of Data.DIFFICULTY_PRESETS) {
      const s2 = Object.assign({}, settings, { occVac: preset.occVac, occAtm: preset.occAtm, rangeMod: preset.range });
      const sim = mk(working, s2);
      const res = yield* runScan(sim, t0, t1, roughDt(sim), true);
      const base = mk(P.nodes, s2);
      const bres = yield* runScan(base, t0, t1, roughDt(base), true);
      stress.push({ preset: preset, uptime: worstUptime(res), baselineUptime: worstUptime(bres), longest: res.sources.reduce((m, x) => Math.max(m, x.longestBlackout), 0) });
    }

    return {
      baseline: baseline, baselineCauses: baselineCauses, final: final.res, finalCauses: final.causes,
      steps: steps, advice: advice, sized: sized, pruned: pruned, extraStations: extraStations, stress: stress,
      nodes: working, planned: working.filter((n) => n.planned), t0: t0, t1: t1, target: target,
    };
  }

  /** Run a generator to completion synchronously (tests / non-UI use). */
  function runSync(gen) {
    for (;;) {
      const r = gen.next();
      if (r.done) return r.value;
    }
  }

  /* ---------- deployment hints ---------- */

  /**
   * How to put the relays of one planned group on station. Relays on one circular orbit, equally spaced, are
   * deployed from a single carrier by phasing: release one, lower the carrier's periapsis so its period is shorter by
   * 1/(n*k) for k laps, and it comes back 360/n degrees behind the released relay. Two-body numbers only.
   * `nodes`: the planned simulator nodes of one group. Returns null if there is nothing to say.
   */
  function deployHint(world, nodes) {
    if (!nodes.length || nodes[0].loc.type !== 'orbit') return null;
    const first = nodes[0];
    const body = world.index.get(first.loc.body);
    const o = first.loc.orbit;
    const n = nodes.length;
    const gm = body.gm, r = o.a;
    const T = Orb.TAU * Math.sqrt((r * r * r) / gm);
    const vc = Math.sqrt(gm / r);
    const solar = !!body.star;
    const out = { body: body.id, n: n, solar: solar, radius: r, altitude: solar ? null : r - body.radius, period: T, spacing: n > 1 ? T / n : 0, steps: [] };
    if (!solar) out.minAltitude = world.altitudeLimits(body.id).min;
    // one phasing manoeuvre for a gap of `frac` of a revolution gained over k laps (frac > 0: carrier ends up behind the released relay)
    const phasing = (frac, k) => {
      const Tp = T * (1 - frac / k);
      const ap = r * Math.pow(Tp / T, 2 / 3);
      const rOther = 2 * ap - r; // the other apsis of the phasing orbit
      const vAp = Math.sqrt(gm * (2 / r - 1 / ap));
      return { laps: k, period: Tp, other: rOther, dv: Math.abs(vc - vAp) };
    };
    if (n > 1 || solar) {
      for (let k = 1; k <= 12; k++) {
        const frac = solar ? 1 / 6 : 1 / n; // solar relays sit 60 degrees from Kerbin
        const p = phasing(frac, k);
        const ok = solar ? p.other > 0 : p.other - body.radius >= out.minAltitude;
        if (ok || k === 12) { out.phasing = Object.assign({ feasible: ok, otherAltitude: solar ? null : p.other - body.radius, count: solar ? n : n - 1 }, p); break; }
      }
    }
    return out;
  }

  /** Plain-English lines for a deploy hint (shared by the UI and the copy-as-text plan). */
  function deployText(h, fmtDist, fmtDur) {
    if (!h) return [];
    const lines = [];
    if (h.solar) {
      lines.push('Each solar relay shares Kerbin\u2019s heliocentric orbit but sits 60\u00b0 ahead or behind. Leave Kerbin on a heliocentric orbit with a slightly different period (' + fmtDur(h.phasing ? h.phasing.period : h.period) + ' instead of ' + fmtDur(h.period) + ', shorter for a relay ahead, longer for one behind) so it drifts 60° from Kerbin in ' + (h.phasing ? h.phasing.laps : 1) +
        ' lap' + (h.phasing && h.phasing.laps > 1 ? 's' : '') + ', then circularise at Kerbin’s distance: about ' +
        (h.phasing ? Math.round(h.phasing.dv) : 0) + ' m/s of heliocentric velocity change each way, on top of escaping Kerbin.');
      return lines;
    }
    lines.push('Orbit period ' + fmtDur(h.period) + (h.n > 1 ? '; relays ' + fmtDur(h.spacing) + ' apart' : '') + '.');
    if (h.n > 1 && h.phasing) {
      const p = h.phasing;
      lines.push('Deploy from one carrier: circularise at ' + fmtDist(h.altitude) + ', release relay 1, then lower the carrier\u2019s periapsis to about ' + fmtDist(p.otherAltitude) + ' (period ' + fmtDur(p.period) +
        ') for ' + p.laps + ' lap' + (p.laps > 1 ? 's' : '') + ' and re-circularise at ' + fmtDist(h.altitude) + ' to release the next. About ' + Math.round(p.dv) + ' m/s each way per extra relay (' + Math.round(2 * p.dv * p.count) + ' m/s in total).' +
        (p.feasible ? '' : ' Even 12 laps leave the periapsis too low: use separate launches or smaller steps.'));
    } else if (h.n === 1) {
      lines.push('A single relay: just circularise at ' + fmtDist(h.altitude) + '.');
    }
    return lines;
  }

  /* ---------- what-if evaluation (Relay planner tab) ---------- */

  /**
   * Simulate `nodes` over the look-ahead and report per tracked source uptime plus the outage causes.
   * P: { world, lookup, settings, nodes, t0, horizon, minSignal }. Generator; returns { sources, causes, worst, mean }.
   */
  function* evaluateGen(P) {
    const settings = Object.assign({}, P.settings, { minSignal: P.minSignal || 0 });
    const sim = Sim.createSim({ world: P.world, lookup: P.lookup, settings: settings, nodes: P.nodes });
    const dt = Math.max(sim.suggestStep(24), P.horizon / 90000);
    const res = yield* runScan(sim, P.t0, P.t0 + P.horizon, dt);
    return { sources: res.sources, causes: causeTable(res), worst: worstUptime(res), mean: meanUptime(res), problems: sim.problems };
  }

  /* ---------- line-of-sight survey for the Reach tab ---------- */

  /** Bodies with no surface to land on (stock + Outer Planets). Unknown bodies from planet packs count as solid. */
  const GAS_GIANTS = new Set(['Jool', 'Sarnus', 'Urlum', 'Neidon']);

  /**
   * For each body: how much of the time can a lander (8 spread-out sites) with `power` reach the DSN directly, counting
   * every body that gets in the way? Yields progress 0..1; returns [{ body, mean, worst, best }] (no entry for gas giants).
   * P: { world, lookup, settings (sim settings incl. dsnPower), power: {own, relay}, t0, horizon, minSignal }
   */
  function* reachGen(P, bodyIds) {
    const world = P.world;
    const sites = surfaceSamples(8);
    const out = [];
    let done = 0;
    for (const id of bodyIds) {
      const b = world.index.get(id);
      if (b && !b.star && !GAS_GIANTS.has(id)) {
        const nodes = sites.map((p, i) => ({
          id: 'site:' + i, name: 'site ' + i, tracked: true, loc: { type: 'landed', body: id, lat: p.lat, lon: p.lon, alt: 0 },
          antennas: [], powerOverride: { own: P.power, relay: P.power },
        }));
        const sim = Sim.createSim({ world: world, lookup: P.lookup, settings: Object.assign({}, P.settings, { minSignal: P.minSignal || 0 }), nodes: nodes });
        const dt = Math.max(60, sim.suggestStep(12));
        const span = Math.min(20 * Data.DAY, Math.max(2 * Data.DAY, b.rotPeriod * 1.05));
        let mean = 0, worst = 1, best = 0;
        const windows = 3;
        for (let w = 0; w < windows; w++) {
          const a = P.t0 + (P.horizon * (w + 0.5)) / windows;
          const res = yield* runScan(sim, a, a + span, dt, true);
          res.sources.forEach((s) => { mean += s.uptime / (windows * res.sources.length); });
          const wu = res.sources.map((s) => s.uptime);
          // per site, over all windows: accumulate below
          wu.forEach((u, i) => { nodes[i].acc = (nodes[i].acc || 0) + u / windows; });
        }
        nodes.forEach((n) => { worst = Math.min(worst, n.acc); best = Math.max(best, n.acc); });
        out.push({ body: id, mean: mean, worst: worst, best: best });
      }
      yield ++done / bodyIds.length;
    }
    return out;
  }

  /* ---------- surface coverage map of a body ---------- */

  /** Uptime at a grid of surface points on `bodyId`, given the scenario's relays. Generator. */
  function* coverageGen(P, bodyId, latStep, lonStep, windows, span) {
    const world = P.world;
    const nodes = P.nodes.filter((n) => !n.tracked || n.planned).map((n) => Object.assign({}, n, { tracked: false }));
    const cells = [];
    for (let lat = -90 + latStep / 2; lat < 90; lat += latStep) {
      for (let lon = -180 + lonStep / 2; lon < 180; lon += lonStep) {
        cells.push({ lat: lat, lon: lon });
        nodes.push({ id: 'cell:' + cells.length, name: 'cell', tracked: true, cell: true, loc: { type: 'landed', body: bodyId, lat: lat, lon: lon, alt: 0 }, antennas: [{ id: 'stock:longAntenna', count: 1 }] });
      }
    }
    const sim = Sim.createSim({ world: world, lookup: P.lookup, settings: Object.assign({}, P.settings, { minSignal: P.minSignal || 0 }), nodes: nodes });
    const dt = Math.max(30, sim.suggestStep(16));
    const up = new Float64Array(cells.length);
    for (let w = 0; w < windows; w++) {
      const a = P.t0 + (P.horizon * (w + 0.5)) / windows;
      const res = yield* runScan(sim, a, a + span, dt, true);
      res.sources.forEach((s, i) => { up[i] += s.uptime / windows; });
    }
    return { cells: cells, uptime: up, latStep: latStep, lonStep: lonStep };
  }

  return {
    surfaceSamples: surfaceSamples, relayTiers: relayTiers, causeTable: causeTable, keoAltitude: keoAltitude,
    planGen: planGen, runSync: runSync, coverageGen: coverageGen, reachGen: reachGen, GAS_GIANTS: GAS_GIANTS, deployHint: deployHint, deployText: deployText, evaluateGen: evaluateGen, runScan: runScan, ringNodes: ringNodes,
  };
});
