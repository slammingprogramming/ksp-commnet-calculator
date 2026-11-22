# Changelog

All notable changes to KSP CommNet Workbench. Versions follow [Semantic Versioning](https://semver.org/).

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
