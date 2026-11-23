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

    if (want('career')) {
      // a made-up career (nothing from a real save) and a two-stage lander, for the Career and Missions guides
      const fs = require('node:fs');
      const os = require('node:os');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.waitForSelector('#tabs button');
      const sfs = path.join(os.tmpdir(), 'ksp-shots-career.sfs');
      const tech = ['start', 'basicRocketry', 'engineering101', 'survivability', 'generalRocketry'];
      fs.writeFileSync(sfs, 'GAME\n{\n\tTitle = Example career (CAREER)\n\tMode = CAREER\n\tPARAMETERS\n\t{\n\t\tCAREER\n\t\t{\n\t\t\tStartingFunds = 25000\n\t\t\tFundsGainMultiplier = 1\n\t\t\tScienceGainMultiplier = 1\n\t\t\tRepGainMultiplier = 1\n\t\t\tFundsLossMultiplier = 1\n\t\t\tRepLossMultiplier = 1\n\t\t\tRepLossDeclined = 1\n\t\t}\n\t}\n' +
        '\tSCENARIO\n\t{\n\t\tname = Funding\n\t\tfunds = 118000\n\t}\n\tSCENARIO\n\t{\n\t\tname = Reputation\n\t\trep = 64\n\t}\n' +
        '\tSCENARIO\n\t{\n\t\tname = ResearchAndDevelopment\n\t\tsci = 83\n' + tech.map((t) => '\t\tTech\n\t\t{\n\t\t\tid = ' + t + '\n\t\t\tstate = Available\n\t\t}\n').join('') + '\t}\n' +
        '\tSCENARIO\n\t{\n\t\tname = ScenarioUpgradeableFacilities\n\t\tSpaceCenter/LaunchPad\n\t\t{\n\t\t\tlvl = 0\n\t\t}\n\t\tSpaceCenter/MissionControl\n\t\t{\n\t\t\tlvl = 0.5\n\t\t}\n\t}\n' +
        '\tSCENARIO\n\t{\n\t\tname = ContractSystem\n\t\tCONTRACTS\n\t\t{\n\t\t\tCONTRACT\n\t\t\t{\n\t\t\t\ttype = SatelliteContract\n\t\t\t\tstate = Active\n\t\t\t\tbody = Kerbin\n\t\t\t\tvalues = 1,2,16000,41000,12000,3,10,5,0,0,999,0\n\t\t\t}\n\t\t\tCONTRACT\n\t\t\t{\n\t\t\t\ttype = ExplorationContract\n\t\t\t\tstate = Offered\n\t\t\t\tbody = Mun\n\t\t\t\tvalues = 1,2,30000,66000,30000,6,12,6,0,0,999,0\n\t\t\t}\n\t\t}\n\t}\n}\n');
      await tab('career');
      await page.setInputFiles('input[aria-label="KSP career save file"]', sfs);
      await page.waitForSelector('#tab-career >> text=Loaded “Example career (CAREER)”', { timeout: 10000 });
      await page.selectOption('#tab-career select[aria-label="Goal node"]', 'advRocketry');
      await page.selectOption('#tab-career select[aria-label="Goal node"]', 'landing');
      await page.click('#tab-career button:has-text("Add the plan to the money list")');
      await page.click('#tab-career tr:has-text("Launch Pad") button:has-text("Plan")');
      await page.click('#tab-career tr:has-text("Satellite") button:has-text("Plan reward")');
      await page.waitForTimeout(500);
      await slice('#tab-career', 'career', 'start', '>Money, science and reputation over time');
      const part = (id, i, o) => {
        o = o || {};
        let t = 'PART\n{\n\tpart = ' + id + '_' + (1000 + i) + '\n\tistg = ' + (o.istg === undefined ? -1 : o.istg) + '\n\tmodCost = 0\n\tmodMass = 0\n';
        for (const l of o.links || []) t += '\tlink = ' + l + '\n';
        for (const a of o.att || []) t += '\tattN = ' + a + '\n';
        for (const k of Object.keys(o.res || {})) t += '\tRESOURCE\n\t{\n\t\tname = ' + k + '\n\t\tamount = ' + o.res[k] + '\n\t\tmaxAmount = ' + o.res[k] + '\n\t}\n';
        return t + '}\n';
      };
      const tank = { LiquidFuel: 180, Oxidizer: 220 };
      const craftFile = path.join(os.tmpdir(), 'Example Lander.craft');
      fs.writeFileSync(craftFile, 'ship = Example Lander\nversion = 1.12.5\ntype = VAB\n' + part('mk1pod.v2', 0, { links: ['fuelTank_1001'] }) +
        part('fuelTank', 1, { links: ['liquidEngine_1002'], res: tank }) + part('liquidEngine', 2, { istg: 0, links: ['Decoupler_1_1003'] }) +
        part('Decoupler_1', 3, { istg: 0, links: ['fuelTank_1004'], att: ['bottom,fuelTank_1004_0|0|0'] }) +
        part('fuelTank', 4, { links: ['fuelTank_1005'], res: tank }) + part('fuelTank', 5, { links: ['liquidEngine_1006'], res: tank }) + part('liquidEngine', 6, { istg: 1 }));
      await tab('missions');
      await page.setInputFiles('input[aria-label="Rocket files"]', craftFile);
      await page.waitForSelector('#tab-missions >> text=1 rocket(s) read', { timeout: 10000 });
      await page.click('#tab-missions button:has-text("+ Mun landing and return")');
      await page.waitForSelector('#tab-missions >> text=Delta-v budget', { timeout: 10000 });
      await page.waitForTimeout(400);
      await slice('#tab-missions', 'missions', 'Route', '>What it needs');
    }
    if (want('landing')) {
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.waitForSelector('#tabs button');
      await tab('landing');
      await page.selectOption('#tab-landing select[aria-label="Body"]', 'Duna');
      await page.fill('#tab-landing input[aria-label="Landing tilt"]', '8');
      await page.press('#tab-landing input[aria-label="Landing tilt"]', 'Tab');
      await page.fill('#tab-landing input[aria-label="Maximum latitude"]', '40');
      await page.press('#tab-landing input[aria-label="Maximum latitude"]', 'Tab');
      await page.selectOption('#tab-landing select[aria-label="Rank by"]', 'variety');
      await page.click('#tab-landing button:has-text("Find sites")');
      await page.waitForSelector('#landing-results tbody tr', { timeout: 15000 });
      await page.click('#landing-results tbody tr:first-child button:has-text("Details")');
      await page.waitForSelector('#tab-landing >> text=Lander experiments here', { timeout: 10000 });
      await page.waitForTimeout(400);
      await slice('#tab-landing', 'landing', 'Landing sites', 'end');
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
