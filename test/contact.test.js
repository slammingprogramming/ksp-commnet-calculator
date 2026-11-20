// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const LINK = 'https://smp14.simplex.im/a#3gZ-zeHs4QrFZKLAN0o3SC_XQJXhj1eYBVTO_c0FAtg';
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('the private SimpleX contact link is present and identical everywhere it is used', () => {
  for (const f of ['SECURITY.md', 'README.md', 'index.html', '.github/ISSUE_TEMPLATE/config.yml']) {
    assert.ok(read(f).includes(LINK), f + ' is missing the contact link');
  }
  // no other (possibly mistyped) simplex.im address anywhere in those files
  for (const f of ['SECURITY.md', 'README.md', 'index.html', '.github/ISSUE_TEMPLATE/config.yml']) {
    const found = read(f).match(/https:\/\/smp\d+\.simplex\.im\/a#[A-Za-z0-9_-]+/g) || [];
    for (const l of found) assert.equal(l, LINK, f + ' has a different SimpleX link');
  }
});

test('the app never injects imported text as HTML', () => {
  for (const f of fs.readdirSync(path.join(root, 'js')).filter((n) => n.endsWith('.js'))) {
    const src = read('js/' + f);
    assert.doesNotMatch(src, /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/, f);
  }
});

// ---- donation details -------------------------------------------------------------------------------------------
// The single source in the app is KSPData.SUPPORT; the README and the workflow files must carry identical copies.
const Data = require('../js/data.js');

test('the donation details are identical in the app data, README, footer and FUNDING.yml', () => {
  const S = Data.SUPPORT;
  assert.equal(S.contact, LINK);
  assert.equal(S.kofi, 'https://ko-fi.com/scenprogramming');
  const readme = read('README.md');
  assert.ok(readme.includes(S.kofi), 'README is missing the Ko-fi link');
  assert.ok(read('index.html').includes(S.kofi), 'footer is missing the Ko-fi link');
  assert.match(read('.github/FUNDING.yml'), /^ko_fi: scenprogramming\s*$/m);
  for (const c of S.crypto) assert.ok(readme.includes('`' + c.address + '`'), 'README is missing the ' + c.coin + ' address');
  // nothing else that looks like a different Ko-fi page or wallet slipped in
  assert.deepEqual(readme.match(/https:\/\/ko-fi\.com\/[A-Za-z0-9_]+/g), [S.kofi]);
});

test('the crypto addresses are well formed', () => {
  const by = Object.fromEntries(Data.SUPPORT.crypto.map((c) => [c.symbol, c.address]));
  assert.deepEqual(Object.keys(by).sort(), ['BTC', 'ETH', 'XMR']);
  assert.match(by.ETH, /^0x[0-9a-fA-F]{40}$/);
  assert.match(by.XMR, /^[48][0-9AB][1-9A-HJ-NP-Za-km-z]{93}$/); // Monero main-net address (4... standard, 8... subaddress): 95 base58 characters
  assert.match(by.BTC, /^sp1q[023456789acdefghjklmnpqrstuvwxyz]{100,}$/); // Silent Payments (BIP 352), bech32m charset
});

test('the support links are plain links: no network calls, no tracking', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<(script|img|iframe)[^>]+src="https?:/i);
  for (const f of fs.readdirSync(path.join(root, 'js')).filter((n) => n.endsWith('.js'))) {
    assert.doesNotMatch(read('js/' + f), /(fetch|XMLHttpRequest|sendBeacon|WebSocket)/, f);
  }
});
