// SPDX-License-Identifier: AGPL-3.0-or-later
/* Network planning on top of the simulator: who can talk to whom over time, which relays are single points of failure,
 * and what each group of ground stations adds. Pure logic, no DOM access.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sim.js'));
  else root.KSPNetwork = factory(root.KSPSim);
})(typeof self !== 'undefined' ? self : this, function (Sim) {
  'use strict';

  const MAX_STEPS = 1500;

  /**
   * Pairwise connectivity over time. sim: from Sim.createSim. Returns { names, planned, tracked, uptime[i][j] (0..1; the last
   * row/column is the DSN, all ground stations as one network), steps, dt }. Vessels are the non-home nodes of the sim.
   */
  function interconnect(sim, t0, horizon) {
    const vessels = [];
    sim.nodes.forEach((n, i) => { if (!n.home) vessels.push(i); });
    const k = vessels.length;
    const dt = Math.max(sim.suggestStep(12), horizon / MAX_STEPS);
    const counts = [];
    for (let i = 0; i <= k; i++) counts.push(new Float64Array(k + 1));
    let steps = 0;
    for (let t = t0; t <= t0 + horizon; t += dt) {
      const c = sim.connectivityAt(t);
      steps++;
      for (let a = 0; a < k; a++) {
        const ia = vessels[a];
        if (c.home[ia]) { counts[a][k]++; counts[k][a]++; }
        for (let b = a + 1; b < k; b++) if (c.pair[ia * sim.nodes.length + vessels[b]]) { counts[a][b]++; counts[b][a]++; }
      }
    }
    const uptime = counts.map((row) => Array.from(row, (x) => (steps ? x / steps : 0)));
    return {
      names: vessels.map((i) => sim.nodes[i].name).concat(['DSN (ground stations)']),
      tracked: vessels.map((i) => !!sim.nodes[i].tracked),
      planned: vessels.map((i) => !!(sim.nodes[i].source && sim.nodes[i].source.planned)),
      uptime: uptime, steps: steps, dt: dt,
    };
  }

  const uptimes = (res) => res.sources.map((s) => s.uptime);

  /**
   * Single points of failure: for every vessel that can relay, the uptime of each tracked vessel if it were lost.
   * simOpts: the options given to Sim.createSim. Returns { baseline: [{name, uptime}], rows: [{name, planned, worst, lost: [{name, before, after}], critical}] } sorted by damage.
   */
  function redundancy(simOpts, t0, horizon) {
    const full = Sim.createSim(simOpts);
    const dt = Math.max(full.suggestStep(12), horizon / MAX_STEPS);
    const base = Sim.scanSync(full, t0, t0 + horizon, dt);
    const baseline = base.sources.map((s) => ({ name: s.name, uptime: s.uptime }));
    const rows = [];
    const list = simOpts.nodes || [];
    list.forEach((n, idx) => {
      const rec = full.nodes.find((x) => x.source === n);
      if (!rec || !(rec.relay > 0)) return;
      const sim = Sim.createSim(Object.assign({}, simOpts, { nodes: list.filter((_, i) => i !== idx) }));
      const res = Sim.scanSync(sim, t0, t0 + horizon, dt);
      const after = new Map(res.sources.map((s) => [s.name, s.uptime]));
      const lost = [];
      for (const b of baseline) {
        if (b.name === n.name) continue;
        const a = after.has(b.name) ? after.get(b.name) : b.uptime;
        if (b.uptime - a > 0.005) lost.push({ name: b.name, before: b.uptime, after: a });
      }
      lost.sort((x, y) => (y.before - y.after) - (x.before - x.after));
      const worst = lost.length ? Math.min.apply(null, lost.map((l) => l.after)) : Math.min.apply(null, baseline.filter((b) => b.name !== n.name).map((b) => b.uptime).concat([1]));
      rows.push({ name: n.name, planned: !!n.planned, worst: worst, lost: lost, critical: lost.some((l) => l.before - l.after > 0.05) });
    });
    rows.sort((a, b) => a.worst - b.worst);
    return { baseline: baseline, rows: rows, dt: dt };
  }

  /** What the ground stations add: the tracked vessels' uptime with the KSC alone, plus the Making History stations, plus the extra stations, and everything. */
  function stationVariants(simOpts, t0, horizon) {
    const base = simOpts.settings || {};
    const clear = { stationOverride: {} };
    const variants = [
      ['Kerbal Space Center only', { extraStations: false, makingHistory: false, allowOtherLaunchSites: false }],
      ['plus the Making History launch-site stations (Desert, Larkes)', { extraStations: false, makingHistory: true, allowOtherLaunchSites: true }],
      ['plus the extra ground stations (five anomaly dishes and Baikerbanur)', { extraStations: true, makingHistory: false, allowOtherLaunchSites: true }],
      ['all of them', { extraStations: true, makingHistory: true, allowOtherLaunchSites: true }],
    ];
    const probe = Sim.createSim(simOpts);
    const dt = Math.max(probe.suggestStep(12), horizon / MAX_STEPS);
    return variants.map(([label, s]) => {
      const sim = Sim.createSim(Object.assign({}, simOpts, { settings: Object.assign({}, base, clear, s) }));
      const res = Sim.scanSync(sim, t0, t0 + horizon, dt);
      const u = uptimes(res);
      return { label: label, stations: sim.homeCount, worst: u.length ? Math.min.apply(null, u) : 1, mean: u.length ? u.reduce((a, b) => a + b, 0) / u.length : 1, sources: res.sources.map((s) => ({ name: s.name, uptime: s.uptime })) };
    });
  }

  return { interconnect: interconnect, redundancy: redundancy, stationVariants: stationVariants };
});
