# Development

Plain scripts, no build step, no runtime dependencies. The app runs from `file://`, so you can also just open
`index.html`. Read [CONTRIBUTING.md](../CONTRIBUTING.md) before opening a pull request.

## Commands

```
npm test                                       # unit tests (Node's built-in runner)
npm start                                      # static dev server on http://localhost:8080
npm install --no-save playwright-core && node test/smoke/smoke.js    # browser smoke test (needs Chrome; CI runs it)
node scripts/screenshots.js                    # regenerate docs/img/*.png (same Playwright setup)
node scripts/check-mod-data.js                 # compare the bundled mod antennas with the mods' repositories (needs git and network)
```

Set `CHROME_PATH` to a Chrome executable if Playwright cannot find it, and `NODE_PATH` if `playwright-core` is installed
outside the project.

## Layout

| File | What it holds |
|---|---|
| `js/data.js` | antennas (the `ROWS` table), packs, DSN levels, difficulty presets, bodies (stock and OPM), ground stations, reflectors |
| `js/orbits.js` | Kepler propagation (ellipses and hyperbolas), state-vector conversion, the KSP calendar |
| `js/core.js` | link maths: antenna combining, range, signal, the antenna finder, number parsing and formatting |
| `js/world.js` | the body tree, body and surface positions at a time, distances, line-of-sight reports |
| `js/trajectory.js` | patched conics: sphere-of-influence exits and entries, hand-over between orbits |
| `js/sim.js` | the time-domain simulator: nodes, occlusion, paths, cause attribution, blackout scanner |
| `js/planner.js` | the relay planner (diagnose, fix, budget, prune, size, stress), coverage map, what-if, reach survey |
| `js/network.js` | network interconnectivity, redundancy (relay-loss tests) and ground-station set comparison |
| `js/reentry.js` | plasma blackout rules and the entry trajectory on a body with an atmosphere |
| `js/transfer.js` | Lambert solver and launch-window search between sibling bodies |
| `js/terrain-data.js`, `js/landing.js` | generated: a coarse grid per body (biome, height, slope percentiles) from the game's maps (`node scripts/build-terrain-data.js <folder>`, input from `unityscan.py --terrain=<folder>`); the landing-site finder |
| `js/career-data.js` | generated: the tech tree, part list, science and contract tables, facility rules (`node scripts/build-career-data.js`; numbers only) |
| `js/craft.js`, `js/career.js`, `js/mission.js` | rockets (.craft import, price, mass, stage-by-stage delta-v), career state, facilities, tech plan, finance and science, mission legs |
| `js/share.js` | scenario export and import, share-link validation (all input is untrusted) |
| `js/parsers.js` | ConfigNode parser, part `.cfg` import, Kopernicus planet-pack import, `persistent.sfs` reader |
| `js/app.js`, `js/ui-*.js` | the interface: state, settings, the first tabs; Scenario, Tracker, Planner, Network, Reentry, Launch windows, Career, Missions and Landing tabs |
| `index.html`, `sw.js`, `manifest.webmanifest`, `icon.svg` | the page (with its Content-Security-Policy), and the offline cache and install files |
| `scripts/` | dev server, mod-data check, screenshot generator, test runner |
| `tools/ildump`, `tools/unityscan` | small readers used to verify the game's rules and data (see their READMEs for the legal note) |
| `test/` | unit tests per module, plus `test/smoke/` for the browser smoke test |

The pure-logic modules (`data`, `orbits`, `core`, `world`, `trajectory`, `sim`, `network`, `planner`, `reentry`, `transfer`, `parsers`, `share`, `craft`, `career`, `mission`) never touch the
DOM and are tested in Node. The UI files are covered by the browser smoke test.

## Conventions

* Every JS file is a UMD-style IIFE exposing one global (`KSPCore`, `KSPSim`, …). Script order in `index.html` matters.
* 2-space indent, single quotes, `'use strict'`, comments that say *why*. Match the surrounding code.
* DOM is built with the `h(tag, props, ...children)` helper, never `innerHTML` (a test enforces it). The native
  `replaceChildren()` and `append()` do not accept `null` or arrays: pass a filtered, spread array.
* The app makes **no network requests**; a test enforces it. Do not add fonts, analytics, QR widgets or CDNs.
* Anything that changes simulation inputs must call `commit()` or `rebuildAll()`, which bumps the revision that keys the
  cached simulation.
* Long work (planner, scans) is written as generators that the UI time-slices on the main thread. There is no Web Worker
  by design: everything runs on the user's device in the page.
* Every source file starts with `SPDX-License-Identifier: AGPL-3.0-or-later`.

## Data

To add or correct an antenna, edit the `ROWS` table in `js/data.js` and check it against the mod's or game's own config:

```
node scripts/check-mod-data.js
```

The script shallow-clones the mods' repositories, parses every antenna part with the app's own parser (flattening
ModuleManager patches where needed) and compares power, type, exponent, mass and cost. It exits non-zero on a
difference, and a monthly GitHub workflow runs it. Body data and stock-game facts are checked by `test/gamedata.test.js`.

## Screenshots

The images in `docs/img/` come from `scripts/screenshots.js`: a fresh browser profile, dark theme, only the bundled
example scenarios, so they contain no personal data. Regenerate them after any visible UI change and commit them with it.

## Offline use and the page policy

`sw.js` is a service worker that keeps the app's own files in a cache named after the version, so the site opens without a
connection once visited (it is not registered on `file://` or on localhost, where a cache would hide your edits). Its file
list must match what `index.html` loads and its version must equal `package.json`'s: `test/repo.test.js` checks both.
The page also carries a Content-Security-Policy (`connect-src 'none'`, no inline scripts), so the browser itself refuses
any network request the app might make by mistake.

## Releasing

Maintainers only. Update `CHANGELOG.md` and the version in `package.json` and `js/data.js` (a test keeps the app,
package and changelog versions equal), tag `vX.Y.Z`, and push the tag: the release workflow builds the zip and
publishes it, and the Pages workflow deploys the site.
