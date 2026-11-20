// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
// Checks that the repository metadata a public release depends on stays consistent.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const REPO = 'https://github.com/slammingprogramming/ksp-commnet-calculator';
const PAGES = 'https://slammingprogramming.github.io/ksp-commnet-calculator/';
// The maintainer's published commit-signing key (a public key) and its fingerprint.
const SIGNING_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIHSyg1EK6pjVGJaDawe37NFKpL9sasrvGU/NLz7I73M';

test('the source repository URL is the same in the app, footer, package.json and README', () => {
  assert.ok(read('js/app.js').includes("SOURCE_URL = '" + REPO + "'"), 'js/app.js SOURCE_URL');
  assert.ok(read('index.html').includes('id="source-link" href="' + REPO + '"'), 'index.html source link');
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.repository.url, 'git+' + REPO + '.git');
  assert.equal(pkg.bugs.url, REPO + '/issues');
  assert.ok(read('README.md').includes(PAGES), 'README Pages link');
});

test('the licence notice names the copyright holder and the licence is AGPL-3.0-or-later', () => {
  assert.match(read('README.md'), /^Copyright \(C\) 2026 slammingprogramming\.$/m);
  assert.equal(JSON.parse(read('package.json')).license, 'AGPL-3.0-or-later');
  assert.match(read('LICENSE'), /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/);
  for (const f of fs.readdirSync(path.join(root, 'js')).filter((n) => n.endsWith('.js'))) {
    assert.match(read('js/' + f), /SPDX-License-Identifier: AGPL-3.0-or-later/, f);
  }
});

test('SECURITY.md publishes the signing key with its correct fingerprint', () => {
  const sec = read('SECURITY.md');
  assert.ok(sec.includes(SIGNING_KEY), 'signing key missing');
  const blob = Buffer.from(SIGNING_KEY.split(' ')[1], 'base64');
  const fp = 'SHA256:' + crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
  assert.ok(sec.includes(fp), 'fingerprint should be ' + fp);
  // the reporting flow (issue -> SimpleX -> signature exchange) is spelled out and uses one namespace everywhere
  assert.match(sec, /content-free issue/i);
  assert.match(sec, /security_contact\.yml/);
  assert.equal((sec.match(/-n ksp-commnet-security/g) || []).length, 2);
  assert.ok(fs.existsSync(path.join(root, '.github/ISSUE_TEMPLATE/security_contact.yml')));
});

test('community files exist and no private or agent file is part of the public tree', () => {
  for (const f of ['LICENSE', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', '.github/FUNDING.yml',
    '.github/PULL_REQUEST_TEMPLATE.md', '.github/dependabot.yml', '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/data_correction.yml', '.github/ISSUE_TEMPLATE/feature_request.yml', '.gitattributes']) {
    assert.ok(fs.existsSync(path.join(root, f)), f + ' is missing');
  }
  // CI refuses a tree that tracks agent or Drive files
  assert.match(read('.github/workflows/ci.yml'), /AGENTS\\\.md/);
  // the ignore file keeps them out of the public branch
  const ign = read('.gitignore');
  for (const p of ['AGENTS.md', '.claude/', 'Communications Network Calculator/', '*.gsheet']) assert.ok(ign.includes(p), p + ' not ignored');
});

test('public docs and templates carry no personal information', () => {
  const files = ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'index.html', 'package.json', 'docs/RESEARCH.md',
    'tools/ildump/README.md', 'tools/ildump/Program.cs'];
  for (const f of fs.readdirSync(path.join(root, '.github/ISSUE_TEMPLATE'))) files.push('.github/ISSUE_TEMPLATE/' + f);
  for (const f of fs.readdirSync(path.join(root, 'js')).filter((n) => n.endsWith('.js'))) files.push('js/' + f);
  for (const f of files) {
    const s = read(f);
    assert.doesNotMatch(s, /@(gmail|outlook|hotmail|proton|protonmail|privaterelay|icloud)\./i, f + ' contains an email address');
    assert.doesNotMatch(s, /[A-Za-z]:[\\/](Users|Class)/, f + ' contains a local path');
  }
});
