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
const fs = require('node:fs');
const os = require('node:os');
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
    const prompts = [];
    const watch = (p) => {
      p.on('console', (m) => { if (m.type() === 'error') problems.push('console error: ' + m.text()); });
      p.on('pageerror', (e) => problems.push('page error: ' + e.message + (e.stack ? ' | ' + e.stack.split(String.fromCharCode(10)).slice(0, 4).join(' <- ') : '')));
      p.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push('external request: ' + r.url()); });
      p.on('dialog', (d) => { if (d.type() === 'prompt') prompts.push(d.defaultValue()); d.accept(); });
      return p;
    };
    const page = watch(await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage());

    await page.goto(base);
    await page.waitForSelector('#tabs button');
    const tabs = await page.$$eval('#tabs button', (bs) => bs.map((b) => b.id));
    assert.deepEqual(tabs, ['tabbtn-chain', 'tabbtn-finder', 'tabbtn-reach', 'tabbtn-scenario', 'tabbtn-tracker', 'tabbtn-planner', 'tabbtn-network', 'tabbtn-reentry', 'tabbtn-transfer', 'tabbtn-antennas', 'tabbtn-help']);
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

    // Network planner and reentry
    await page.click('#tabbtn-network');
    await page.click('#tab-network button:has-text("Analyze the network")');
    await page.waitForSelector('#tab-network table th:has-text("DSN")', { timeout: 60000 });
    await page.click('#tab-network button:has-text("Compare station sets")');
    await page.waitForSelector('#tab-network >> text=Kerbal Space Center only', { timeout: 60000 });
    step('network planner');
    await page.click('#tabbtn-reentry');
    await page.waitForSelector('#tab-reentry >> text=Blackout:', { timeout: 30000 });
    await page.click('#tab-reentry button:has-text("Find the blackout-free speed")');
    await page.waitForSelector('#tab-reentry >> text=No total blackout', { timeout: 60000 });
    step('reentry blackout');

    await page.click('#tabbtn-transfer');
    await page.click('#tab-transfer button:has-text("Find launch windows")');
    await page.waitForSelector('#tab-transfer table tbody tr', { timeout: 30000 });
    step('launch windows');

    // Manoeuvre burn + patched conics on the example's first orbiting vessel, then the tracker's mouse and keyboard navigation
    await page.click('#tabbtn-scenario');
    await page.check('#tab-scenario label:has-text("Follow patched conics") input >> nth=0');
    await page.click('#tab-scenario button:has-text("Add a burn") >> nth=0');
    await page.fill('#tab-scenario input[aria-label="prograde m/s"] >> nth=0', '900');
    await page.keyboard.press('Tab');
    await page.waitForSelector('#tab-scenario >> text=Total 900 m/s', { timeout: 10000 });
    await page.click('#tabbtn-tracker');
    const cv = await page.$('#tab-tracker canvas.tracker-canvas');
    const box = await cv.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 }); await page.mouse.up();
    await cv.focus();
    await page.keyboard.press('d'); await page.keyboard.press('w'); await page.keyboard.press('+'); await page.keyboard.press('0');
    step('burn, patched conics, tracker pan and zoom');

    // Share link round trip: the link opens in a fresh browser profile and rebuilds the same scenario
    await page.click('#tabbtn-scenario');
    const count = await page.locator('#tab-scenario .scn-list > *').count();
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) }, configurable: true }); });
    await page.click('#tab-scenario button:has-text("Copy share link")');
    await page.waitForSelector('text=holds the whole scenario');
    const link = prompts.find((p) => /#s=/.test(p));
    assert.ok(link, 'share link was offered');
    const other = watch(await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage());
    await other.goto(link);
    await other.waitForSelector('#tab-scenario .scn-list > *', { timeout: 20000 });
    assert.equal(await other.locator('#tab-scenario .scn-list > *').count(), count);
    assert.match(await other.innerText('#tab-scenario'), /900|prograde/i);
    await other.context().close();
    step('share link round trip');

    // Save import from a made-up persistent.sfs
    const sfs = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kspcn-')), 'persistent.sfs');
    fs.writeFileSync(sfs, `GAME
{
	Title = Smoke test save
	Mode = CAREER
	FLIGHTSTATE
	{
		UT = 1000
		VESSEL
		{
			name = Smoke relay
			type = Relay
			sit = ORBITING
			PART
			{
				name = RelayAntenna50
			}
			ORBIT
			{
				SMA = 1000000
				ECC = 0
				INC = 0
				LPE = 0
				LAN = 0
				MNA = 0
				EPH = 1000
				REF = 1
			}
		}
	}
}
`);
    await page.setInputFiles('input[aria-label="KSP save file"]', sfs);
    await page.waitForSelector('text=Loaded “Smoke test save”', { timeout: 10000 });
    await page.click('#tabbtn-scenario');
    assert.ok(await page.locator('select[aria-label="Add a vessel from the save"] option:has-text("Smoke relay")').count());
    step('save import');

    // Planner budget fields are there and keep their value
    await page.click('#tabbtn-planner');
    await page.fill('#tab-planner input[aria-label="Most relays"]', '2');
    assert.equal(await page.inputValue('#tab-planner input[aria-label="Most relays"]'), '2');
    step('planner budget fields');

    // Phone-sized screen: no tab scrolls sideways
    const phone = watch(await (await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })).newPage());
    await phone.goto(base);
    await phone.waitForSelector('#tabs button');
    for (const id of await phone.$$eval('#tabs button', (bs) => bs.map((b) => b.id))) {
      await phone.evaluate((i) => document.getElementById(i).click(), id);
      const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 1, id + ' overflows a phone screen by ' + over + 'px');
    }
    await phone.context().close();
    step('phone layout');

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
