// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Re-checks the bundled mod antenna data against the mods' own part configs.
 *
 *   node scripts/check-mod-data.js            check every mod
 *   node scripts/check-mod-data.js restock    check one pack id
 *
 * It shallow-clones each mod's public repository into a temporary folder, parses every part config that has a data
 * transmitter with the app's own parser and compares power, type, combinability, mass and cost with js/data.js.
 * Exit code 1 means something differs (or a repository could not be read); the report says what.
 * Needs git on the PATH and network access. Not used by the app itself, which never touches the network.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Data = require('../js/data.js');
const Parsers = require('../js/parsers.js');

// pack id -> public repository. CommNet Antennas Extension patches other mods' parts through ModuleManager, so its
// values cannot be read with a plain part parser and it is reported as "check by hand".
const REPOS = {
  restock: 'https://github.com/PorktoberRevolution/ReStocked.git',
  nfe: 'https://github.com/post-kerbin-mining-corporation/NearFutureExploration.git',
  dmagic: 'https://github.com/DMagic1/Orbital-Science.git',
  jx2: 'https://github.com/KSPSnark/JX2Antenna.git',
  probesplus: 'https://github.com/raveloda/Coatl-Aerospace.git',
};
// Parts deliberately left out of the data, with the reason.
const IGNORE = { dmUSSoilMoisture: 'Universal Storage variant of the Soil Moisture Sensor; its tech node is "Unresearcheable"' };
const BY_HAND = { cae: 'https://github.com/yalov/CommNetAntennasExtension' };

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.cfg')) yield p;
  }
}

const close = (a, b) => Math.abs(a - b) <= 1e-9 + 1e-6 * Math.max(Math.abs(a), Math.abs(b));

function compare(pack, found) {
  const issues = [];
  const known = Data.antennas.filter((a) => a.pack === pack);
  const seen = new Set();
  for (const f of found) {
    if (IGNORE[f.partName]) continue;
    const row = known.find((a) => a.parts.indexOf(f.partName) >= 0);
    if (!row) { issues.push('new part not in the data: ' + f.partName + ' (' + f.name + ', ' + f.type + ', ' + f.power + ')'); continue; }
    seen.add(row.id);
    const diff = [];
    if (row.type !== f.type) diff.push('type ' + row.type + ' -> ' + f.type);
    if (!close(row.power, f.power)) diff.push('power ' + row.power + ' -> ' + f.power);
    if (!close(row.exp, f.exp)) diff.push('exponent ' + row.exp + ' -> ' + f.exp);
    if (!row.builtin && f.mass && !close(row.mass, f.mass)) diff.push('mass ' + row.mass + ' -> ' + f.mass);
    if (!row.builtin && f.cost && !close(row.cost, f.cost)) diff.push('cost ' + row.cost + ' -> ' + f.cost);
    if (diff.length) issues.push(f.partName + ': ' + diff.join(', '));
  }
  for (const row of known) if (!seen.has(row.id)) issues.push('in the data but not found upstream: ' + row.parts.join(', '));
  return issues;
}

function main() {
  const only = process.argv[2];
  let failed = false;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kspcomm-mods-'));
  try {
    for (const [pack, url] of Object.entries(REPOS)) {
      if (only && only !== pack) continue;
      const dir = path.join(tmp, pack);
      process.stdout.write('== ' + pack + ' (' + url + ')\n');
      try {
        execFileSync('git', ['clone', '--quiet', '--depth', '1', url, dir], { stdio: ['ignore', 'inherit', 'inherit'] });
      } catch (e) { console.log('   could not clone'); failed = true; continue; }
      const found = [];
      for (const file of walk(dir)) {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
        if (!/DataTransmitter/.test(text)) continue;
        try { found.push(...Parsers.parseAntennaCfg(text)); } catch (e) { console.log('   unreadable: ' + path.relative(dir, file)); failed = true; }
      }
      const issues = compare(pack, found);
      console.log(issues.length ? issues.map((i) => '   ' + i).join('\n') : '   ' + found.length + ' antenna parts read, all match');
      if (issues.length) failed = true;
    }
    for (const [pack, url] of Object.entries(BY_HAND)) {
      if (only && only !== pack) continue;
      console.log('== ' + pack + ': patches other mods’ parts through ModuleManager; check by hand at ' + url);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

main();
