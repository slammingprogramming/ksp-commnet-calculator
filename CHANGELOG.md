# Changelog

All notable changes to KSP CommNet Workbench. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Landing tab, Breaking Ground:** deployed science is now worked out the way the game pays it. Plan how many of each instrument,
  who sets them down (scientist level, or anyone else) and the power; the tab gives science per hour, the total and the time to
  reach it, with the body's landed multiplier, the diminishing-returns share for several of one kind (the best one at 100%, the
  rest at the table's share), half rate for solar-only stations while you are away, and your difficulty's science gain. A power
  budget says how many solar panels or RTGs the station needs (engineers add power).
- **Seismometer impacts:** give the mass, speed and distance of a crash and the Landing tab gives the science it earns and how many
  such impacts fill the subject, by the game's formula (impact energy against the body's energy scale, the sensor's rate, the
  distance curve from the part's config, the cap). It also says how big one impact must be to fill the subject alone.

## [1.3.1] - 2026-11-22

### Security
- Loading saved settings from the browser's storage no longer lets a stored `__proto__`, `constructor` or `prototype` key reach the
  object prototype (a CodeQL prototype-pollution alert). Saved state is still read the same way otherwise.
- The repository test compares whole URLs instead of substrings (a CodeQL alert in a test file, no effect on the app).

## [1.3.0] - 2026-11-22

### Added
- **Career tab:** load a career from `persistent.sfs` (funds, science, reputation, difficulty, researched tech, bought parts, facility
  levels, contracts) or start from a difficulty preset. A money, science and reputation list with the running balance, the lowest
  point and the first day you could not afford a step. **Facility upgrades** with the game's real prices and what each level allows
  (launch mass, part count, contracts, strategies, crew, tracking, research limits). A **tech tree plan** to any goal nodes (research
  order, science, part prices, the Research & Development limit). **Science worth** per experiment, situation and body. Contracts from the save.
- **Missions tab:** import `.craft` files for price, mass, recoverable value and stage-by-stage delta-v (fuel reach, decouplers,
  boosters that burn out first). Build a route from legs (launch, transfer with real Lambert windows or a Hohmann transfer to a
  moon, landing, ascent, return from a moon, plane change, custom burn) with templates for the Mun, Minmus and Duna. A verdict
  with delta-v needed against available, facility and research checks with one-click upgrade planning, recovery value and contract
  rewards, and a button that books the mission on the money list.
- Data read from the game: the tech tree, ~480 part prices, masses, engines and tanks, science tables, contract base values,
  strategies, facility upgrade prices and limits, recovery rules, difficulty presets (`scripts/build-career-data.js`, numbers only).
  `tools/unityscan` now also reads facility prices and per-body science multipliers.
- The config parser keeps the name of a node that has a trailing comment (`ARM // Asteroid Recovery Contracts`).
- Documentation: guides for the Career and Missions tabs; research notes section 8.
- **Milestones ("World First"):** the reward of every first (orbit, landing, flyby, escape, flag, spacewalk, base and the rest) on every
  body, from the game's own formula, with your difficulty gain and strategies, marked off from the milestones already in your save.
- **Strategies:** the eleven strategies with their price at a commitment, what they convert or multiply, the Administration limit,
  and their effect on milestone income.
- **Landing tab:** finds landing sites by how much tilt you can land on and stay on, latitude, height, biome, distance from a point and
  biomes within hopping reach, on 15 bodies; a map of the biomes with the candidates; what a lander can measure there, the Breaking
  Ground deployed instruments (with the game's rates and caps) and the surface rocks that appear in that biome. Built from the game's
  height and biome maps (`tools/unityscan --terrain`, `scripts/build-terrain-data.js`); slopes are regional, not ground level, and the
  tab says so.
- **Biome counts** per body, and the science tables mark which experiments repeat in every biome.
- **Fuel ducts:** delta-v now counts fuel lines (a duct feeds the part at its far end from the part it sits on), drains boosters
  first (by the stage they separate in) and keeps solid fuel in its own part, so asparagus staging comes out right.

### Fixed
- Planet science tables no longer list asteroid and comet samples.

### Notes
- The reward formula, strategy conversion and fuel-duct rules were read from the game's code. They were not compared with a played save.
  Interval records (altitude, speed, distance, depth) are not in the milestone list.

## [1.2.0] - 2026-11-22

### Added
- **Network tab:** who can reach whom over time (a pairwise matrix between vessels and the DSN), the network right now
  (connected, separate groups, vessels with no relay), **redundancy** (each relay removed in turn to find single points of
  failure), a table of every ground station with per-station on/off overrides and custom stations, and **Compare
  station sets** (Kerbal Space Center only, plus the Making History launch-site stations, plus the extra stations, all).
  The Making History stations (Desert, Larkes) are plannable like any other.
- **Reentry tab (plasma blackout):** the game's exact blackout rules (shock temperature, density and dynamic-pressure
  thresholds, link angle), with atmosphere curves read from the game for Kerbin, Eve, Duna, Jool and Laythe. Describe an
  entry by orbit or by speed and angle; see where signal is lost and returns, peak deceleration and shock temperature,
  the highest speed that avoids blackout, and an altitude/speed map.
- **Launch windows tab:** Lambert-based transfer windows between planets or moons (leaving, arrival and total delta-v).
- **Manoeuvre burns** on orbiting vessels (prograde, normal, radial), carried through patched conics, the tracker,
  every simulation and export/share files.
- **Relay planner:** a budget (most relays, mass, cost), an uptime target per vessel, elliptical relay orbits as a new
  fix shape, and a choice of coverage-map resolution.
- **Distance picker:** measure the line-of-sight between two vessels of the scenario.
- **Tracker:** drag to pan, scroll or pinch to zoom, `W` `A` `S` `D` to move; works on touch screens.
- **Works offline:** a service worker and web-app manifest (installable from the Pages site); a Content-Security-Policy
  that forbids network access and inline scripts.
- **Planet packs:** Real Solar System style packs now work: a pack that defines its own Kerbin replaces the stock system,
  degree-valued mean anomalies, relative radius edits and the star are applied, and the calendar follows the home world
  (24-hour days, 365-day years for Earth). Tested against the real RSS configs.
- Documentation: guides for the Network, Reentry and Launch windows tabs, and updated model, planner, scenario, tracker
  and mod guides; light-theme screenshot.

### Fixed
- **Share links did not open** (the Scenario tab was only built after the link had been read): a link now opens the
  Scenario tab and offers to load the scenario. The browser smoke test covers a round trip.
- Imported mod bodies named like a stock body no longer disappear behind the stock one.
- The scenario's burn total updates when a field is left.

### Changed
- The browser smoke test also covers burns, the tracker's mouse and keyboard moves, share-link round trip, save import
  from a made-up save, the planner budget fields and a phone-sized screen.

## [1.1.1] - 2026-11-22

### Documentation
- A full set of guides in `docs/` (getting started, calculators, scenarios, tracker, relay planner, game settings and
  mods, how the model works, FAQ, development) with the screenshots next to the text they illustrate. The README is now a
  short overview that links to them.
- `scripts/screenshots.js` regenerates the screenshots; a test checks that every link and image in the guides resolves
  and that every screenshot is used. The release zip now includes `docs/`.

### Fixed
- The extra ground stations are six (the five anomaly dishes and Baikerbanur); two texts said five.
- The Help tab gives the date of the latest mod-data check.

## [1.1.0] - 2026-11-21

### Corrected (all read from the game's own files)
- **Kerbol blocks signals** (the Sun carries a CommNet body in the game's scene data, like all 17 stock bodies). The
  "Kerbol blocks" switch stays, now labelled as a what-if.
- **Signal paths** take the best product of link strengths (confirmed in `CommNetwork`), not an assumption any more.
- **Ground stations:** only the Kerbal Space Center is always there. The five anomaly stations and Baikerbanur exist
  only with *Enable Extra Groundstations*. The two Making History launch-site stations (Desert, Larkes) are weak
  (40k) fixed antennas, present when other launch sites are allowed. Positions and power are read from the game, and
  Baikerbanur is a normal DSN-rated station (it was wrongly treated as a launch-site station).
- **Gravity constant** 9.80665 m/s² (was 9.81) for converting surface gravity to GM in imported planet packs; Pol's eccentricity.
- **Spin phase** of every stock body is now the game's `initialRotation`, so which side of Mun, Minmus, Ike, Gilly,
  Vall, Tylo, Bop, Pol faces its parent is exact instead of approximate.

- **Mod antenna data re-checked by script** (`scripts/check-mod-data.js`, monthly in CI): added DMagic's Soil Moisture
  Sensor (a 100G relay) and three ProbesPlus (Landvermesser) parts that were missing.
- **Part-config import:** a transmitter that does not say `antennaCombinable` is now non-combinable, as in the game
  (it used to be treated as combinable).
- Light theme: accent and warning colours and the percentage text now meet WCAG AA contrast.

### Added
- **Patched conics (opt-in per vessel).** Escape/hyperbolic orbits are imported from saves and, together with transfer
  orbits, are carried through sphere-of-influence exits and encounters (new `js/trajectory.js`, hyperbolic Kepler
  solver and state-vector conversion in `js/orbits.js`). The Tracker draws each leg; the simulator and planner use them.
- **Near Future reflectors** (pick the reflector an antenna points at) and an **extended** switch per antenna entry
  (retracted antennas do not count). Both are carried by scenario export/share links.
- **Finder and Link & relay chain:** a line-of-sight line under the distance picker (how often the straight line between
  the two bodies is blocked over the next 8 years, and by what).
- CommNet Antennas Extension is now checked by the mod-data script too (its ModuleManager patches are flattened).
- **Reach map: line-of-sight check.** Optional extra columns simulate a year of real geometry for a lander on each body.
- **Scenario export / import** as a JSON file, and a **share link** that carries the whole scenario in the URL
  (compressed in the browser, nothing uploaded). Imports are validated and always ask before replacing anything.
- **Relay planner:** a *What if I add a relay?* test, a *Plan for these vessels* selection, and *How to get them there*
  (phasing orbit, periapsis, delta-v estimates), also in the copied plan text.
- **Tracker:** edge-on projection (shows inclination) and keyboard control (zoom, fit, projection, time step, play) with a
  spoken summary of the connection state.
- Version label in the page footer, a browser smoke test in CI (`test/smoke/smoke.js`), README screenshots.
- `tools/unityscan`: a small stdlib-only Python tool that reads the facts above out of a KSP install.

### Researched, deliberately not modelled
- **Plasma blackout** is a transient for loaded vessels re-entering an atmosphere (the only signal multiplier in the
  game), so it never affects an orbiting or landed vessel. Stock KSP has no orbital perturbations (patched conics).

### Faster
- The relay planner is roughly a third faster on the reference scenarios (cheaper blackout-edge refinement, line-of-sight
  pre-rejection, candidates compared at half resolution) and produces the same designs. It still runs entirely in
  your browser.

## [1.0.0] - 2026-11-19

First public release: calculator, antenna finder, reach map, scenario, tracker, relay planner, antenna and planet-pack
import, persistent.sfs import.
