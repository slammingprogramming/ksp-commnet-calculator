// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I18n = require('../js/i18n.js');
const D = require('../js/i18n-data.js');

const root = path.join(__dirname, '..');
const source = [path.join(root, 'index.html')]
  .concat(fs.readdirSync(path.join(root, 'js')).filter((f) => /\.js$/.test(f) && !/-data\.js$/.test(f)).map((f) => path.join(root, 'js', f)))
  .map((f) => fs.readFileSync(f, 'utf8')).join('\n');
// the page is HTML, so a key such as "Link & relay chain" may also be written with an entity there
const unescaped = source.replace(/&amp;/g, '&');

test('catalogue: every row has English plus one non-empty text per language', () => {
  assert.equal(D.languages[0].code, 'en');
  assert.deepEqual(D.languages.map((l) => l.code), ['en', 'es', 'de', 'fr', 'pt', 'ja']);
  const seen = new Set();
  for (const row of D.rows) {
    assert.equal(row.length, D.languages.length, 'row ' + row[0]);
    row.forEach((c, i) => assert.ok(typeof c === 'string' && c.trim() === c && c.length > 0, 'row ' + row[0] + ' column ' + i));
    assert.ok(!seen.has(row[0]), 'duplicate key ' + row[0]);
    seen.add(row[0]);
  }
  assert.ok(D.rows.length > 200, 'a useful number of strings');
});

test('catalogue: keys are real texts of the app, so a renamed label is noticed', () => {
  const missing = D.rows.map((r) => r[0]).filter((k) => !unescaped.includes(k));
  assert.deepEqual(missing, [], 'these keys no longer appear in the source:\n' + missing.join('\n'));
});

test('catalogue: symbols and units that carry meaning survive translation', () => {
  for (const row of D.rows) {
    for (const token of ['×', '%', '…', '(t)', '(km)', '(UT)', '(DSN)', '▶', '＋', 'persistent.sfs', '.craft', '.cfg']) {
      if (!row[0].includes(token)) continue;
      row.slice(1).forEach((c, i) => assert.ok(c.includes(token), '"' + row[0] + '" in ' + D.languages[i + 1].code + ' lost ' + token));
    }
  }
});

test('catalogue: most translations really differ from the English', () => {
  for (let i = 1; i < D.languages.length; i++) {
    const same = D.rows.filter((r) => r[i] === r[0]).length;
    assert.ok(same / D.rows.length < 0.08, D.languages[i].code + ' leaves ' + same + ' of ' + D.rows.length + ' as English');
  }
});

test('translate: exact text, trailing colon, unknown text and unknown language', () => {
  assert.equal(I18n.translate('es', 'Scenario'), 'Escenario');
  assert.equal(I18n.translate('de', 'Scenario'), 'Szenario');
  assert.equal(I18n.translate('ja', 'Scenario'), 'シナリオ');
  assert.equal(I18n.translate('fr', 'Difficulty:'), 'Difficulté:');
  assert.equal(I18n.translate('es', 'Something that is not in the catalogue'), 'Something that is not in the catalogue');
  assert.equal(I18n.translate('en', 'Scenario'), 'Scenario');
  assert.equal(I18n.translate('xx', 'Scenario'), 'Scenario');
  assert.equal(I18n.translate('es', ''), '');
  assert.equal(I18n.translateSpaced('pt', '  Scenario \n'), '  Cenário \n');
  assert.equal(I18n.translateSpaced('pt', '   '), '   ');
  assert.ok(I18n.isSupported('ja') && !I18n.isSupported('xx'));
});

test('every tab label of the app has a translation', () => {
  const labels = [...source.matchAll(/registerTab\('([a-z]+)', '([^']+)'/g)].map((m) => m[2]);
  const fromApp = [...source.matchAll(/\{ id: '([a-z]+)', label: '([^']+)', build:/g)].map((m) => m[2]);
  const all = labels.concat(fromApp);
  assert.ok(all.length >= 10, 'found the tab labels');
  for (const code of ['es', 'de', 'fr', 'pt', 'ja']) {
    const t = I18n.table(code);
    const lacking = all.filter((l) => !t.has(l.replace(/&amp;/g, '&')));
    assert.deepEqual(lacking, [], code + ' lacks tab labels');
  }
});
