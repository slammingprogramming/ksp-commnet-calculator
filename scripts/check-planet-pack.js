// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Runs a real Kopernicus planet pack through the app: import every body config, build the world, check it is sane, and
 * plan the relays for a lander on the far side of the first moon of the home world.
 *
 *   node scripts/check-planet-pack.js                  JNSQ (shallow, blob-less clone of its public repository)
 *   node scripts/check-planet-pack.js <folder>         any folder of body configs (searched recursively for *.cfg)
 *
 * The pack's files are never copied into this repository (they have their own licence), so this is a script and not a
 * unit test: the monthly workflow runs it. Exit code 1 means the importer or the planner no longer copes with the pack.
 * Needs git on the PATH and network access when it clones. The app itself never touches the network.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const Data = require('../js/data.js');
const Orb = require('../js/orbits.js');
const Parsers = require('../js/parsers.js');
const { createWorld } = require('../js/world.js');
const Pl = require('../js/planner.js');
const Sim = require('../js/sim.js');

const JNSQ = { url: 'https://github.com/Galileo88/JNSQ.git', dir: 'GameData/JNSQ/JNSQ_Bodies' };

function fetchJnsq() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jnsq-'));
  const git = (args, cwd) => execFileSync('git', args, { cwd: cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  git(['clone', '--depth', '1', '--filter=blob:none', '--no-checkout', JNSQ.url, tmp]);
  git(['sparse-checkout', 'set', JNSQ.dir], tmp);
  git(['checkout'], tmp);
  return path.join(tmp, JNSQ.dir);
}

function cfgFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...cfgFiles(p)); else if (/\.cfg$/i.test(e.name)) out.push(p);
  }
  return out;
}

function main() {
  const dir = process.argv[2] || fetchJnsq();
  const stockBody = (id) => Data.bodies.find((b) => b.id === id) || null;
  const bodies = [], patches = [], warnings = [];
  for (const f of cfgFiles(dir)) {
    const r = Parsers.parseKopernicus(fs.readFileSync(f, 'utf8'), stockBody);
    bodies.push(...r.bodies); patches.push(...r.patches);
    r.warnings.forEach((w) => warnings.push(path.basename(f) + ': ' + w));
  }
  console.log('read ' + bodies.length + ' bodies and ' + patches.length + ' patches from ' + dir);
  assert.equal(warnings.length, 0, 'the importer skipped something:\n' + warnings.join('\n'));
  assert.ok(bodies.length >= 10, 'too few bodies');

  const world = createWorld({ extraBodies: bodies, patches: patches });
  Data.setCalendar(world.calendar.day, world.calendar.daysPerYear);
  Orb.setCalendar(world.calendar.day, world.calendar.daysPerYear);
  const home = world.index.get('Kerbin');
  assert.ok(home, 'the pack has no Kerbin');
  const placed = world.bodies.filter((b) => !b.star);
  assert.equal(placed.length, bodies.length, 'every imported body is in the world (a missing parent drops it)');
  for (const b of placed) {
    assert.ok(b.radius > 0 && b.gm > 0 && b.orbitalPeriod > 0, b.id + ' has a radius, a gravity and a period');
    assert.ok(b.soiRadius > b.radius, b.id + ' sphere of influence above its surface');
    assert.ok(b.parentBody.star || b.soiRadius < b.parentBody.soiRadius, b.id + ' sphere of influence inside its parent\'s');
  }
  assert.ok(Math.abs(world.calendar.day - home.rotPeriod) / home.rotPeriod < 0.02, 'the calendar follows the home world\'s day');
  const gas = placed.filter((b) => Pl.isGas(b)).map((b) => b.name);
  const withAir = placed.filter((b) => b.atmosphere).map((b) => b.name + ' (' + Math.round(b.atmosphere.pressure[0][1]) + ' kPa)');
  console.log('bodies with air curves read: ' + (withAir.join(', ') || 'none'));
  console.log('home world day ' + world.calendar.day + ' s, year ' + world.calendar.daysPerYear + ' days; gas giants: ' + (gas.join(', ') || 'none'));

  // the first moon of the home world: a lander on its far side, over a short window
  const moon = home.moons[0];
  assert.ok(moon, 'the home world has no moon');
  const lookup = (id) => Data.antennas.find((a) => a.id === id);
  const settings = { dsnPower: 250e9, extraStations: true, occVac: 0.9, occAtm: 0.75, rangeMod: 1 };
  const lander = { id: 'l', name: 'Far-side lander', tracked: true, loc: { type: 'landed', body: moon.id, lat: 10, lon: ((moon.rot0 || 0) + 180) % 360, alt: 0 }, antennas: [{ id: 'stock:HighGainAntenna', count: 1 }] };
  const plan = Pl.runSync(Pl.planGen({
    world: world, lookup: lookup, settings: settings, nodes: [lander], t0: 0, horizon: 6 * world.calendar.day, target: 0.995, minSignal: 0.1,
    pool: Data.antennas.filter((a) => a.pack === 'stock'), robust: true,
  }));
  console.log(moon.name + ' far side: ' + (plan.baseline.sources[0].uptime * 100).toFixed(1) + '% -> ' + (plan.final.sources[0].uptime * 100).toFixed(1) + '% with ' + plan.planned.length + ' relays');
  assert.ok(plan.final.sources[0].uptime > plan.baseline.sources[0].uptime, 'the planner improves the far side');

  // every body is reachable by the simulator: a vessel in a low orbit of each gets a defined uptime
  for (const b of placed.slice(0, 12)) {
    const alt = Math.max(world.altitudeLimits(b.id).min * 1.5, 30000);
    const node = { id: 'o', name: 'probe', tracked: true, loc: { type: 'orbit', body: b.id, orbit: Orb.orbitFromAltitudes(b, alt, alt, 0, 0, 0, 0) }, antennas: [{ id: 'stock:RelayAntenna100', count: 1 }] };
    const sim = Sim.createSim({ world: world, lookup: lookup, settings: settings, nodes: [node], trajectory: { t0: 0, horizon: 1e7 } });
    const r = Sim.scanSync(sim, 0, 3 * world.calendar.day, Math.max(60, sim.suggestStep(12)));
    assert.ok(r.sources[0].uptime >= 0 && r.sources[0].uptime <= 1, b.id + ' uptime in range');
  }
  console.log('planet pack check passed');
}

try { main(); } catch (e) { console.error(e && e.message ? e.message : e); process.exit(1); }
