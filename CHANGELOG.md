# Changelog

All notable changes to KSP CommNet Workbench. Versions follow [Semantic Versioning](https://semver.org/).

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
