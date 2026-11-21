// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Browser smoke test: loads the real page in Chrome and drives the main flows.
 *
 *   npm install --no-save playwright-core        (CI does this; it is not a dependency of the app)
 *   node test/smoke/smoke.js                     uses the installed Chrome (or CHROME_PATH)
 *
 * Fails on any console error, uncaught exception or request to a host other than the local test server, and checks that
 * every tab renders and that the scenario, tracker, planner what-if, reach line-of-sight and export flows work.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (e) {
  console.error('playwright-core is not installed: npm install --no-save playwright-core');
  process.exit(2);
}

const root = path.join(__dirname, '..', '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

async function main() {
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(root, 'scripts', 'serve.js')], { env: Object.assign({}, process.env, { PORT: String(port) }), stdio: 'ignore' });
  const base = 'http://localhost:' + port + '/';
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
  const problems = [];
  let steps = 0;
  const step = (name) => { steps++; console.log('ok  ' + name); };
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.on('console', (m) => { if (m.type() === 'error') problems.push('console error: ' + m.text()); });
    page.on('pageerror', (e) => problems.push('page error: ' + e.message));
    page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push('external request: ' + r.url()); });
    page.on('dialog', (d) => d.accept());

    await page.goto(base);
    await page.waitForSelector('#tabs button');
    const tabs = await page.$$eval('#tabs button', (bs) => bs.map((b) => b.id));
    assert.deepEqual(tabs, ['tabbtn-chain', 'tabbtn-finder', 'tabbtn-reach', 'tabbtn-scenario', 'tabbtn-tracker', 'tabbtn-planner', 'tabbtn-antennas', 'tabbtn-help']);
    for (const id of tabs) {
      await page.click('#' + id);
      const panel = '#tab-' + id.replace('tabbtn-', '');
      assert.ok((await page.innerText(panel)).trim().length > 50, id + ' renders');
      assert.ok(!/\bnull\b|\bundefined\b|NaN/.test(await page.innerText(panel)), id + ' shows no null/undefined/NaN');
    }
    step('all tabs render');
    assert.match(await page.innerText('footer'), /v\d+\.\d+\.\d+/);
    step('version label');

    // Reach: line of sight
    await page.click('#tabbtn-reach');
    await page.click('text=Add line-of-sight check');
    await page.waitForSelector('text=Landed: average uptime', { timeout: 60000 });
    step('reach line-of-sight');

    // Scenario example, tracker, edge-on, what-if
    await page.click('#tabbtn-scenario');
    await page.selectOption('select[aria-label="Load an example"]', '0');
    await page.waitForSelector('#tab-scenario .scn-list > *');
    step('scenario example');
    await page.click('#tabbtn-tracker');
    await page.selectOption('#tab-tracker select[aria-label="Projection"]', 'side');
    assert.match(await page.getAttribute('#tab-tracker canvas.tracker-canvas', 'aria-label'), /Edge-on orbit view/);
    await page.click('#tab-tracker button:has-text("Analyze blackouts")');
    await page.waitForSelector('#tab-tracker >> text=/blackout/i', { timeout: 60000 });
    step('tracker + analysis');
    await page.click('#tabbtn-planner');
    await page.click('#tab-planner button:has-text("Test it")');
    await page.waitForSelector('#tab-planner .verdict', { timeout: 90000 });
    step('planner what-if');

    // Export a file
    await page.click('#tabbtn-scenario');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export file")')]);
    assert.equal(download.suggestedFilename(), 'ksp-commnet-scenario.json');
    step('export file');
  } finally {
    await browser.close();
    server.kill();
  }
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log('smoke test passed (' + steps + ' checks, no console errors, no external requests)');
}

main().catch((e) => { console.error(e); process.exit(1); });
