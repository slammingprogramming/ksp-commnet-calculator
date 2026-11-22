// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Regenerates the screenshots used by the guides in docs/ (docs/img/*.png).
 *
 *   npm install --no-save playwright-core        (not a dependency of the app)
 *   node scripts/screenshots.js                  uses the installed Chrome (or CHROME_PATH)
 *   SHOTS=escape,antennas node scripts/screenshots.js     only some of them (names: see `groups` below)
 *
 * Dark theme, fresh browser profile (no personal data), only the bundled example scenarios. Run it after a visible UI
 * change and commit the images with the change.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (e) {
  console.error('playwright-core is not installed: npm install --no-save playwright-core');
  process.exit(2);
}

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'img');
const only = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
const want = (g) => !only || only.has(g);

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

async function main() {
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js')], { env: Object.assign({}, process.env, { PORT: String(port) }), stdio: 'ignore' });
  const base = 'http://localhost:' + port + '/';
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, colorScheme: 'dark', deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(base);
    await page.waitForSelector('#tabs button');

    const shot = async (selector, name) => {
      const el = page.locator(selector).first();
      await el.scrollIntoViewIfNeeded();
      await el.screenshot({ path: path.join(out, name + '.png') });
      console.log('wrote docs/img/' + name + '.png');
    };
    // a vertical slice of a tab, between two of its top-level cards (page coordinates)
    const slice = async (panel, name, from, to) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      const box = await page.evaluate(({ panel, from, to }) => {
        const p = document.querySelector(panel).getBoundingClientRect();
        const cards = [...document.querySelectorAll(panel + ' .card')].filter((c) => !c.parentElement.closest('.card'));
        const title = (c) => ((c.querySelector('h2,h3,summary') || {}).textContent || '').trim();
        // 'Title' = top of that card, '>Title' = its bottom
        const at = (key) => {
          const bottom = key[0] === '>';
          const c = cards.find((x) => title(x).startsWith(bottom ? key.slice(1) : key));
          if (!c) throw new Error('no card starting with ' + key);
          const r = c.getBoundingClientRect();
          return bottom ? r.bottom : r.top;
        };
        const y0 = from === 'start' ? p.top : at(from);
        const y1 = to === 'end' ? cards[cards.length - 1].getBoundingClientRect().bottom : at(to);
        return { x: p.left, y: y0 - 4, width: p.width, height: y1 - y0 + 4 };
      }, { panel, from, to });
      await page.screenshot({ path: path.join(out, name + '.png'), clip: box, fullPage: true });
      console.log('wrote docs/img/' + name + '.png');
    };
    const tab = async (id) => { await page.click('#tabbtn-' + id); await page.waitForTimeout(250); };
    const focusOn = async (id) => { await page.selectOption('#tab-tracker select:has(option[value="Kerbin"])', { value: id }); await page.waitForTimeout(300); };

    if (want('basics')) {
      await shot('#settings', 'settings');
      await tab('chain');
      await shot('#tab-chain', 'chain');
      await tab('finder');
      await shot('#tab-finder', 'finder');
      // the full antenna table is several thousand pixels tall: keep the top (packs, import sections, first rows)
      await tab('antennas');
      await page.evaluate(() => window.scrollTo(0, 0));
      const ab = await page.locator('#tab-antennas').boundingBox();
      await page.screenshot({ path: path.join(out, 'antennas.png'), clip: { x: ab.x, y: ab.y, width: ab.width, height: Math.min(ab.height, 640) }, fullPage: true });
      console.log('wrote docs/img/antennas.png');
    }

    if (want('reach')) {
      // the line-of-sight columns make the table wide: use a wider window for this one
      await page.setViewportSize({ width: 800, height: 900 });
      await tab('reach');
      await page.click('text=Add line-of-sight check');
      await page.waitForSelector('text=Landed: average uptime', { timeout: 90000 });
      await shot('#tab-reach', 'reach');
      await page.setViewportSize({ width: 1180, height: 900 });
    }

    if (want('planning')) {
      // the far-side Mun lander: scenario, blackouts, planner, tracker with the planned relays
      await tab('scenario');
      await page.selectOption('select[aria-label="Load an example"]', '1');
      await page.waitForSelector('#tab-scenario .scn-list > *');
      await shot('#tab-scenario', 'scenario');

      await tab('tracker');
      await page.click('#tab-tracker button:has-text("Analyze blackouts")');
      await page.waitForSelector('#tab-tracker >> text=/blackout/i', { timeout: 60000 });
      await page.waitForTimeout(500);
      await shot('#tab-tracker', 'tracker-blackouts');

      await tab('planner');
      await page.click('#tab-planner button:has-text("Design a fix")');
      await page.waitForSelector('#tab-planner >> text=Does the design survive', { timeout: 240000 });
      await page.click('#tab-planner button:has-text("Compute coverage map")');
      await page.waitForSelector('#tab-planner >> text=Uptime of a lander', { timeout: 240000 });
      await page.waitForTimeout(500);
      await slice('#tab-planner', 'planner-setup', 'start', '>What if I add a relay?');
      await slice('#tab-planner', 'planner', '>What if I add a relay?', 'Antennas for the planned relays');
      await slice('#tab-planner', 'planner-checks', 'Antennas for the planned relays', 'end');

      await page.click('#tab-planner button:has-text("Add these relays to the scenario")');
      await tab('tracker');
      await focusOn('Mun');
      await page.waitForTimeout(600);
      await shot('#tab-tracker', 'tracker');
    }

    if (want('escape')) {
      // patched conics: an escape probe leaving Kerbin
      await page.evaluate(() => {
        const st = JSON.parse(localStorage.getItem('kspcomm.v1') || '{}');
        const kerbin = window.KSPApp.world.index.get('Kerbin');
        const a = -kerbin.gm / (1000 * 1000), e = 1 - (kerbin.radius + 120000) / a;
        st.scenario = st.scenario || {};
        st.scenario.ut = 0;
        st.scenario.nodes = [{
          id: 'esc', name: 'Escape probe', tracked: true,
          loc: { type: 'orbit', body: 'Kerbin', pe: 0, ap: 0, i: 0, lan: 0, w: 0, phase: 0, patched: true, elements: { a: a, e: e, i: 0, lan: 0, w: 0, m0: -0.5, epoch: 0 } },
          antennas: [{ id: 'stock:HighGainAntenna', count: 1 }],
        }];
        st.ui = st.ui || {}; st.ui.tab = 'scenario';
        localStorage.setItem('kspcomm.v1', JSON.stringify(st));
      });
      await page.reload();
      await page.waitForSelector('#tabs button');
      await tab('scenario');
      await shot('#tab-scenario', 'scenario-patched');
      await tab('tracker');
      await focusOn('Kerbin');
      for (let i = 0; i < 1; i++) { await page.click('#tab-tracker button:has-text("Zoom −")'); await page.waitForTimeout(100); }
      await page.waitForTimeout(500);
      await shot('#tab-tracker', 'tracker-escape');
    }

    if (want('newtabs')) {
      // the network planner, reentry, launch windows and the light theme, from a fresh profile with the far-side Mun lander loaded
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.waitForSelector('#tabs button');
      await tab('scenario');
      await page.selectOption('select[aria-label="Load an example"]', '1');
      await page.waitForSelector('#tab-scenario .scn-list > *');

      await tab('network');
      await page.click('#tab-network button:has-text("Analyze the network")');
      await page.waitForSelector('#tab-network table th:has-text("DSN")', { timeout: 60000 });
      await page.click('#tab-network button:has-text("Compare station sets")');
      await page.waitForSelector('#tab-network >> text=Kerbal Space Center only', { timeout: 60000 });
      await page.waitForTimeout(400);
      await shot('#tab-network', 'network');

      await tab('reentry');
      await page.waitForSelector('#tab-reentry >> text=Blackout:', { timeout: 30000 });
      await page.click('#tab-reentry button:has-text("Find the blackout-free speed")');
      await page.waitForSelector('#tab-reentry >> text=No total blackout', { timeout: 60000 });
      await page.waitForTimeout(400);
      await shot('#tab-reentry', 'reentry');

      await tab('transfer');
      await page.click('#tab-transfer button:has-text("Find launch windows")');
      await page.waitForSelector('#tab-transfer table tbody tr', { timeout: 30000 });
      await shot('#tab-transfer', 'transfer');

      await page.emulateMedia({ colorScheme: 'light' });
      await tab('tracker');
      await focusOn('Mun');
      await page.waitForTimeout(600);
      await shot('#tab-tracker', 'tracker-light');
      await page.emulateMedia({ colorScheme: 'dark' });
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
