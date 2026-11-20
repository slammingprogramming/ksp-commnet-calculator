// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
// Runs every test/*.test.js with Node's built-in runner. `node --test "test/*.test.js"` only works on Node 21+
// (older runners do not expand globs) and `node --test test/` breaks on Node 24, so list the files ourselves.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = path.join(__dirname, '..', 'test');
const files = fs.readdirSync(dir).filter((n) => n.endsWith('.test.js')).sort().map((n) => path.join(dir, n));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
