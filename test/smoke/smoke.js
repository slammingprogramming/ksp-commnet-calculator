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
    assert.deepEqual(tabs, ['tabbtn-chain', 'tabbtn-finder', 'tabbtn-reach', 'tabbtn-scenario', 'tabbtn-tracker', 'tabbtn-planner', 'tabbtn-netplan', 'tabbtn-network', 'tabbtn-reentry', 'tabbtn-transfer', 'tabbtn-career', 'tabbtn-missions', 'tabbtn-landing', 'tabbtn-antennas', 'tabbtn-help']);
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

    // Career and Missions: load a career, plan research, import a rocket, build a mission and put it on the money list
    const careerFile = path.join(os.tmpdir(), 'ksp-smoke-career.sfs');
    fs.writeFileSync(careerFile, 'GAME\n{\n\tTitle = Smoke career (CAREER)\n\tMode = CAREER\n\tSCENARIO\n\t{\n\t\tname = Funding\n\t\tfunds = 90000\n\t}\n\tSCENARIO\n\t{\n\t\tname = ResearchAndDevelopment\n\t\tsci = 60\n\t\tTech\n\t\t{\n\t\t\tid = start\n\t\t\tstate = Available\n\t\t}\n\t}\n}\n');
    await page.click('#tabbtn-career');
    await page.setInputFiles('input[aria-label="KSP career save file"]', careerFile);
    await page.waitForSelector('#tab-career >> text=Loaded “Smoke career (CAREER)”', { timeout: 10000 });
    await page.selectOption('#tab-career select[aria-label="Goal node"]', 'generalRocketry');
    await page.waitForSelector('#tab-career >> text=Add the plan to the money list', { timeout: 10000 });
    const part = (id, i, o) => {
      o = o || {};
      let t = 'PART\n{\n\tpart = ' + id + '_' + (1000 + i) + '\n\tistg = ' + (o.istg === undefined ? -1 : o.istg) + '\n\tmodCost = 0\n\tmodMass = 0\n';
      for (const l of o.links || []) t += '\tlink = ' + l + '\n';
      for (const k of Object.keys(o.res || {})) t += '\tRESOURCE\n\t{\n\t\tname = ' + k + '\n\t\tamount = ' + o.res[k] + '\n\t\tmaxAmount = ' + o.res[k] + '\n\t}\n';
      return t + '}\n';
    };
    const craftFile = path.join(os.tmpdir(), 'Smoke Rocket.craft');
    fs.writeFileSync(craftFile, 'ship = Smoke Rocket\nversion = 1.12.5\ntype = VAB\n' + part('mk1pod.v2', 0, { links: ['fuelTank_1001'] }) +
      part('fuelTank', 1, { links: ['liquidEngine_1002'], res: { LiquidFuel: 180, Oxidizer: 220 } }) + part('liquidEngine', 2, { istg: 0 }));
    await page.click('#tabbtn-missions');
    await page.setInputFiles('input[aria-label="Rocket files"]', craftFile);
    await page.waitForSelector('#tab-missions >> text=1 rocket(s) read', { timeout: 10000 });
    await page.click('#tab-missions button:has-text("+ Reach orbit")');
    await page.waitForSelector('#tab-missions >> text=Delta-v budget', { timeout: 10000 });
    assert.match(await page.innerText('#tab-missions'), /Launch to 80 km orbit of Kerbin — 34\d\d m\/s/);
    await page.click('#tab-missions button:has-text("Add to the money list")');
    await page.click('#tabbtn-career');
    await page.waitForSelector('#tab-career table tbody tr:has-text("Kerbin orbit: Launch (rocket)")', { timeout: 10000 });
    step('career and missions');

    // Milestones and strategies on the Career tab, then the Landing tab: find sites, pick one, see what a lander can measure there
    await page.click('#tab-career summary:has-text("Milestones")');
    await page.waitForSelector('#tab-career tr:has-text("Reach orbit") button:has-text("Plan reward")', { timeout: 10000 });
    await page.click('#tab-career summary:has-text("Strategies")');
    await page.waitForSelector('#tab-career input[aria-label="Leadership Initiative active"]', { timeout: 10000 });
    await page.check('#tab-career input[aria-label="Leadership Initiative active"]');
    await page.waitForSelector('#tab-career input[aria-label="Leadership Initiative commitment percent"]', { timeout: 10000 });
    step('milestones and strategies');
    await page.click('#tabbtn-landing');
    await page.selectOption('#tab-landing select[aria-label="Body"]', 'Duna');
    await page.fill('#tab-landing input[aria-label="Landing tilt"]', '8');
    await page.press('#tab-landing input[aria-label="Landing tilt"]', 'Tab');
    await page.click('#tab-landing button:has-text("Find sites")');
    await page.waitForSelector('#landing-results tbody tr', { timeout: 15000 });
    await page.click('#landing-results tbody tr:first-child button:has-text("Details")');
    await page.waitForSelector('#tab-landing >> text=Lander experiments here', { timeout: 10000 });
    assert.match(await page.innerText('#tab-landing'), /Deployed instruments/);
    assert.match(await page.innerText('#tab-landing'), /Surface rocks/);
    assert.match(await page.innerText('#tab-landing'), /Seismometer: which crashes to plan/);
    step('landing sites');

    // Network plan: the example sites, a short look-ahead, one generated stage
    await page.click('#tabbtn-netplan');
    await page.click('#tab-netplan button:has-text("Example: Mun station")');
    await page.selectOption('#tab-netplan select[aria-label="Look ahead"]', '0.25');
    await page.click('#tab-netplan button:has-text("Generate the network")');
    await page.waitForSelector('#tab-netplan button:has-text("Copy the plan as text")', { timeout: 180000 });
    assert.match(await page.innerText('#tab-netplan'), /Your network/);
    assert.match(await page.innerText('#tab-netplan'), /Far-side base/);
    await page.click('#tab-netplan button:has-text("Find base or mine sites")');
    await page.waitForSelector('#tab-netplan button:has-text("Add as base")', { timeout: 60000 });
    step('network plan');

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
