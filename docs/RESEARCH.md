# CommNet research notes (KSP 1.12.5)

Findings the workbench is built on. "Verified" means read from primary files (the game's own configs, or a mod's
current GitHub configs); "wiki" means the KSP Wiki. This project was inspired by Poodmund's *CommNet Signal
Strength Calculator & Antenna Selector* spreadsheet; no data or formulas were copied from it (section 6 explains
how each table was obtained independently).

## 1. The link maths

| Step | Formula | Source |
|---|---|---|
| Vessel power (combining) | `P = strongest × (Σpower / strongest) ^ e` | wiki |
| Average exponent `e` | power-weighted mean of each antenna's `antennaCombinableExponent` | wiki |
| Default exponent | 0.75 when the part has none. Communotron 16 = 1.0 (verified). Communotron 16-S: `antennaCombinable = False` (verified); modelled as exponent 0 | verified |
| Link range | `R = sqrt(P_a × P_b)` | wiki |
| Relative distance | `x = clamp(1 − d / R, 0, 1)` | wiki |
| Signal strength | `S = 3x² − 2x³` | wiki |
| Multi-hop path | product of every link's signal | wiki |
| Difficulty | *Range Modifier* scales every vessel; *DSN Modifier* scales the DSN | wiki, save file |

A vessel's **own** link uses all its antennas; when relaying for someone else only its relay-type antennas count.
The game prefers a direct link to the DSN whenever one exists. The maths reproduces the wiki's worked example (two
88-88 at Jool distance, DSN level 3, 73.4 Gm → 71%).

DSN: Tracking Station level 1 / 2 / 3 = 2 G / 50 G / 250 G. Extra ground stations, with the difficulty option off,
are ~36 k antennas (wiki, "circumstantial evidence").

Difficulty presets (wiki): Normal range ×1 / occlusion 0.9 vacuum, 0.75 atmosphere; Moderate ×0.8 / 1.0, 0.85; Hard
×0.65 / 1.0, 1.0. Easy has CommNet off.

## 2. How CommNet really works (read from the game's code)

The rules below were read from the 1.12.5 `Assembly-CSharp.dll` with `tools/ildump` (an IL disassembler built on
`System.Reflection.Metadata`), not guessed. Class and method names are the game's.

**Occlusion** (`CommNetBody.CreateOccluder`, `OccluderHorizonCulling.Raycast`)
* Each body's blocking radius is `Radius × scaledRadiusHorizonMultiplier (default 1.0) × (body.atmosphere ?
  occlusionMultiplierAtm : occlusionMultiplierVac)`. The atmosphere's *height* is not added.
* The test works in units of that radius with the nearer endpoint first (`A = |p1|² − 1`, `d = p2 − p1`,
  `L = −d·p1`): if the nearer endpoint is outside it is blocked when `L > A` and `L²/|d|² > A`, which is the
  ordinary segment-vs-sphere test; if it is *inside* the sphere it is blocked only when `L > 0` (looking toward the
  centre), so a node inside a (modifier > 1) sphere can still see outward. The simulator ports this exactly.
* **Kerbol blocks.** The Sun's GameObject carries a `CommNetBody` like the other 16 stock bodies. That is scene data, not
  IL, so it was read with `tools/unityscan` from the game's serialized scene files (`sharedassets*.assets`). The
  "Kerbol blocks" switch in the app is therefore only a what-if.

**Ground stations** (`CommNetHome.CreateNode`)
* With the difficulty option *Enable Extra Groundstations* **off**, only KSC exists, plus nodes flagged
  `isPermanent` (launch-site relays) when *Allow Other Launch Sites* is on. The five anomaly stations (Crater Rim,
  Nye Island, Harvester Massif, North Station One, Mesa South) are removed entirely. With the option **on**, all exist.
* A non-permanent station's rating is the DSN level (`GetDSNRange`: 2G / 50G / 250G, the wiki values); a permanent
  one uses its own fixed `antennaPower`. Read with `tools/unityscan` from the scene data and the Making History asset
  bundle: the **permanent** stations are the two Making History launch sites, *Desert* (-6.56, -143.95, altitude
  820 m) and *Larkes* (44.72, 137.03), each with `antennaPower` **40000**. **Baikerbanur is not permanent**: it is a
  normal DSN-rated station that exists only with extra ground stations (the earlier assumption was wrong).

**Links and paths** (`CommNetwork.TryConnect`, `CommLink.GetSignalStrength`, `CommRangeModel`)
* Range `= sqrt(Pa·Pb)`; normalized range `= 1 − d/sqrt(Pa·Pb)`; signal = the Bezier curve (0,0)-(1,1), i.e. 3x²−2x³;
  each antenna set has its own curve and the link uses `sqrt(curveA·curveB)` (identical here).
* A link stores three strengths: relay×relay, relay(A)×transmit(B), transmit(A)×relay(B). For a path, a link that
  touches the path's **source** may use that end's `transmit`; **every other link uses relay×relay only**. This is
  exactly the workbench's rule (own power for the source's links, relay power elsewhere).
* Paths go to the best home node by maximizing the product of the link strengths (read from the shortest-path
  search in `CommNetwork`, `UpdateShortestPath` and the cost it uses).

**A vessel's antenna powers** (`CommNetVessel.UpdateComm`)
* Antennas are split into direct+internal (D) and relay (R); only *combinable* antennas add. `relay` = max(best R,
  combined combinable R). `transmit` = if any D antenna exists: the combination of all combinable antennas (D and R)
  provided a combinable D antenna exists and it beats the best D antenna, else the best D antenna. Both are then
  multiplied by the Range Modifier. A link at the source uses the better of transmit and relay.
* `antennaCombinableExponent` defaults to 0.75, `antennaPower` to 500000 (`ModuleDataTransmitter` constructor);
  weighted exponent and `strongest × (Σ/strongest)^e` are as the wiki says. `core.antennaPowers` ports this.
* `antennaCombinable` is **not** initialised in that constructor, so it defaults to `false`: a part config that does
  not mention it is non-combinable (the importer in `js/parsers.js` follows this).

**Bodies from the game's data** (`tools/unityscan`, the `CelestialBody` prefabs)
* The gravity constant behind `geeASL` is **9.80665** (not 9.81); all 17 stock radii and orbits agree with the data.
* Each body's `initialRotation` fixes its spin phase. Kerbin's prefab period 21600 s is the *solar* day (sidereal
  21549.425 s). Tidally locked moons spin once per orbit and `initialRotation` says which side faces the parent
  (Mun 230 gives sub-Kerbin longitude 47.4°E). The table is in `js/data.js` (`rot0`) and `test/gamedata.test.js`.

**Things that turned out not to matter, or to be absent** (read from `Assembly-CSharp.dll` with `tools/ildump`)
* **Plasma blackout** (`CommNetParams.plasmaBlackout`) is a re-entry transient: `CommNetVessel.CalculatePlasmaMult`
  looks at a loaded vessel's external temperature, atmospheric density, dynamic pressure × surface speed and the angle
  to the flow, and `GetSignalStrengthModifier` scales the vessel's signal by the result. It is the only signal
  multiplier, and it is zero for orbiting and landed vessels, so it has no place in orbit or relay planning. It is
  modelled on the Reentry tab (`js/reentry.js`) with the rules as read: shock temperature = speed, blended from Mach 2 to
  Mach 5 into 21 × speed^0.75, times `ReentryHeatScale` (Easy 0.5, else 1) and the body's `shockTemperatureMultiplier`;
  plasma only above 1100 K and 5×10⁻⁵ kg/m³ with `q × v` (q = 0.0005 ρ v², kPa) between 500 and 2500; per link the angle
  term `InverseLerp(−0.866, −0.5, dot)`; and the signal factor is zero below 0.5. Air density is
  P·M / (R·T) from the temperature and pressure `FloatCurve`s of each `CelestialBody` prefab, which
  `tools/unityscan` reads (`atmospheres()`) into `Data.ATMOSPHERES` (Kerbin, Eve, Duna, Jool, Laythe). Kerbin sea level
  comes out at 1.2250 kg/m³, the textbook value. The entry itself is a point mass with a constant ballistic coefficient.
* **Perturbations:** stock KSP propagates vessels on patched conics (one two-body orbit per sphere of influence), so a
  two-body model *is* the game's model. Only the SOI hand-over needed adding (`js/trajectory.js`).
* **Extended antennas:** `ModuleDataTransmitter.CanComm` returns false for a deployable antenna that is not fully
  extended. The app has an *extended* switch per antenna entry.
* **Near Future reflectors:** `ModuleAntennaFeed.ApplyReflectorBonus` adds `AddedRange × FeedScale` to the
  antenna's power when its feed points at a deployed `ModuleDeployableReflector`. Feed scales are in `Data.FEED_SCALE`
  and reflector bonuses in `Data.REFLECTORS` (checked by `scripts/check-mod-data.js` against the mod's configs).

## 3. Bodies and orbits

Stock: elements, radius, GM, rotation and atmosphere heights from the wiki infoboxes (each body's page). Notably the
game's mean anomalies at epoch are `3.14` rad, not π. Outer Planets Mod: read from its Kopernicus configs
(`Poodmund/Outer-Planets-Mod`, `GameData/OPM/KopernicusConfigs`); GM from `geeASL × 9.81 × r²` (this reproduces the
stock GMs exactly). With OPM installed, **Eeloo is moved to orbit Sarnus** (an override, not an addition). Plock and
Karen form a Kopernicus binary; here Karen simply orbits Plock.

All orbits are two-body Kepler orbits in one inertial frame (KSP has no axial tilts). Validation:

* orbital periods (Kerbin 9,203,545 s, Mun 138,984 s, Duna 17,315,400 s) and spheres of influence match the wiki;
* the closest/farthest distance between two bodies is computed from the orbit geometry and reproduces the community
  sheet's figures independently (Kerbin-Duna 6.07 / 35.38 Gm, Kerbin-Jool 51.74 / 85.81 Gm, Kerbin-Eeloo 53.18 /
  127.08 Gm);
* the Mun's spin phase is calibrated so its sub-Kerbin point is at 47°26′10″ E (community-measured), and stays there.
  Other tidally locked moons have an unknown spin phase and are flagged approximate.

The calendar is 6-hour days and 426-day years. Save vessels use body index `REF` = Kerbol 0, Kerbin 1, Mun 2, Minmus 3,
Moho 4, Eve 5, Duna 6, Ike 7, Jool 8, Laythe 9, Vall 10, Bop 11, Tylo 12, Gilly 13, Pol 14, Dres 15, Eeloo 16
(0-2 confirmed in a real save; the rest from KSP's `flightGlobalsIndex`).

Ground stations (wiki "List of bases on Kerbin"): KSC (−0.097, −74.558) and Baikerbanur, Crater Rim, Nye Island,
Harvester Massif, North Station One, Mesa South, plus Making History's Larkes (position approximate, ~10 km south of
Woomerang).

## 4. Stock antennas, verified from the game files

| Part | Type | Power | Exp. | Mass t | Cost | Tech node |
|---|---|---|---|---|---|---|
| Built-in (pods, probe cores) | Internal | 5 k | – | – | – | – |
| MPO Probe (built-in) | **Relay** | 2 G | 0.75 | – | – | – |
| Communotron 16 | Direct | 500 k | **1.0** | 0.005 | 300 | Engineering 101 |
| Communotron 16-S | Direct | 500 k | **no** | 0.015 | 300 | Engineering 101 |
| HG-5 High Gain | **Relay** | 5 M | 0.75 | 0.07 | 600 | Basic Science |
| Communotron DTS-M1 | Direct | 2 G | 0.75 | 0.05 | 900 | Precision Engineering |
| RA-2 Relay | Relay | 2 G | 0.75 | 0.15 | 1800 | Precision Engineering |
| Communotron HG-55 | Direct | 15 G | 0.75 | 0.075 | 1200 | Electronics |
| RA-15 Relay | Relay | 15 G | 0.75 | 0.3 | 2400 | Electronics |
| Communotron 88-88 | Direct | 100 G | 0.75 | 0.1 | 1500 | Automation |
| RA-100 Relay | Relay | 100 G | 0.75 | 0.65 | 3000 | Automation |

Breaking Ground (deployed science only): Experiment Control Station 500 k (exp 1); Communotron Ground HG-48 10 G.
Making History adds no comm parts. (The Reflectron KR-7 / KR-14 / GX-128 / DP-10 in some search results are
RemoteTech parts.)

## 5. Mod antennas: checked against the mods' current configs (2026-11-21)

Each mod's part configs were read from its GitHub repository and compared with the community listing that inspired
this project. Since 2026-11-21 the check is a script, `node scripts/check-mod-data.js` (also run monthly by a GitHub
workflow): it shallow-clones the repositories, parses every part with the app's own parser and compares power, type,
exponent, mass and cost. The 2026-11-21 run matched ReStock+ (4), Near Future Exploration (18), DMagic (5),
JX2Antenna (3), ProbesPlus (28 parts) and CommNet Antennas Extension (6) after adding what it found: DMagic's **Soil
Moisture Sensor is a 100G relay** (its Universal Storage twin is unresearchable and left out) and three new ProbesPlus
parts (the Landvermesser antennas). CommNet Antennas Extension patches other mods' parts through ModuleManager
(`@PART[x]:NEEDS[...]{ @MODULE[...] { @key = value } }`); the script flattens those patches into plain part configs
(`flattenPatches`) so the same parser and comparison apply.

| Mod | Result |
|---|---|
| ReStock+ | Powers, masses, costs and packet data match. Tech nodes filled in. |
| Near Future Exploration | All 18 antennas match. Tech nodes filled in. |
| JX2Antenna | All 3 match. |
| CommNet Antennas Extension | Powers match, but several packet values were stale (e.g. EXP-VR-2T interval 0.3 s / 16 EC, RA-25 3 Mit / 30 EC, "Tigger" 28 EC). It patches RemoteTech's part names. |
| **DMagic Orbital Science** | **The listing was wrong by 10×:** Oversize SIGINT is a **10 T relay** (was 1 T direct), Undersize SIGINT a **1 T relay** (was 10 G direct); exponent default 0.75 (not 0). |
| ProbesPlus | Values match, but the current pack has ~10 more antennas (Argo dishes/masts, Vorona dish, Meridiani dish, integrated antennas) and the Landvermesser (`landv`) parts, which were added to the data on 2026-11-21. |
| Vens' Stock Revamp | Obsolete: it no longer defines antennas (its HG-20 model became CAE's HG-32). Removed. |

Parts with no `antennaCombinable` key default to non-combinable (e.g. Probes Plus integrated antennas).

## 6. Independence from the spreadsheet

The spreadsheet's formulas were the same as the wiki's, which is where they are taken from here. Stock and mod antenna
values are read from the games' and mods' configs (sections 4-5). Body distances are computed from orbital geometry
(section 3) rather than copied. The remaining overlap is ideas: the antenna selector, the mod pack toggles, the
reachability matrix and the difficulty modifiers; the implementation and data are independent.

## 7. Known gaps

* Whether the game's path-finder ever prefers a relayed path over a working direct one (wiki says no).
* Spin phase and station positions for bodies and sites added by mods (the stock ones are read from the game).
* Not modelled, with reasons in section 2: plasma blackout inside the orbit/relay simulation (re-entry transient only;
  the Reentry tab models it for landings), orbital perturbations (the game has none), mods' own signal multipliers (not
  looked for in other mods' code). The entry model ignores lift and the sun/latitude temperature bias of the air.
* Planet packs: the importer was run against the real Real Solar System configs (all bodies import; Earth-sized
  keostationary height 35 793 km; planner, tracker and network work). JNSQ was run later (2026-11-23, `node scripts/check-planet-pack.js`):
  31 bodies and one patch import with no warnings, the calendar follows its 12-hour home day (43 320 s, 364-day year), two gas giants are recognised
  (Jool, Lindor), and the planner brings a far-side lander on the home world's first moon from 64% to 100% with two relays. It needed a `displayName`
  reader (the internal name differs from the shown one), a gas-giant flag from the Jool/Sarnus/Urlum/Neidon templates and a gap filler for
  template-defined bodies. The monthly workflow repeats the run; no pack file is stored in this repository. JNSQ's `AntennaRange.cfg` patch multiplies every part's
  `antennaPower` by 4 (and its upgrades) and recommends DSN modifier 4 and range modifier 1; this is not applied automatically (see settings-and-mods).
* Vessels opted in to *patched conics* follow SOI exits and encounters on a fixed conic (`js/trajectory.js`, at most
  8 legs over 25 years, no burns). Others stay on one conic about their body. Kopernicus binaries (Plock-Karen) are
  simplified.
* The Finder and the Link & relay chain remain range calculators; they report the line-of-sight windows between the two
  bodies' centres but not a vessel hiding behind its own planet (use the Tracker for that).

## 8. Career and finance (read from the game, session of 2026-11-22)

Used by the Career and Missions tabs. Everything here was read from the user's own KSP 1.12.5 install: configs under
`GameData`, scene and prefab files with `tools/unityscan`, and the code of `Assembly-CSharp.dll` with `tools/ildump`.

**Facility prices** (the `UpgradeableFacility` objects in the space-centre scene files; each has three level records and the
first float of a record is its `levelCost`; record 0 is the level-1 base cost, not an upgrade). Level 2 and 3 prices:
Launch Pad, Runway, Mission Control, Astronaut Complex 75,000 and 282,000; Tracking Station, Administration 150,000 and
563,000; Vehicle Assembly Building, Spaceplane Hangar 225,000 and 845,000; Research & Development 451,000 and 1,690,000.
The Launch Pad has a second copy in a shared prefab file with 50,000 for level 2; the scene copy (75,000) is used because it is
the one the space-centre scene loads and it matches the pattern of the other buildings (flag as less certain).

**Facility effects** are methods of `GameVariables`; each compares the normalised level (0, 0.5, 1 for levels 1 to 3) with
thresholds. Results for levels 1, 2, 3: part count 30 / 255 / unlimited (`GetPartCountLimit`), craft mass 18 t / 140 t /
unlimited (`GetCraftMassLimit`), active contracts 2 / 7 / unlimited, active strategies 1 / 3 / 5 with a commitment of 25% / 60% /
100% (`GetStrategyCommitRange`), active crew 5 / 12 / unlimited, tracked objects 0 / 8 / unlimited, patches ahead 0 / 2 / all,
research node cost limit 100 / 500 / unlimited science, data-to-science ratio 0.4 / 0.8 / 1.0. `UnlockedFlightPlanning` is
true above 0.4 (read on Mission Control, facility enum value 3), `ManeuverToolAvailable` above 0.75 (Tracking Station, value 6).
The facility enum order is Administration 0, Astronaut Complex 1, Launch Pad 2, Mission Control 3, R&D 4, Runway 5, Tracking
Station 6, Spaceplane Hangar 7, VAB 8.

**Recovery** (`VesselRecovery.OnVesselRecovered`): the funds share is `lerp(0.98, 0.1, d / (pi R))` with `d` the great-circle
distance of the landing to the space centre and `R` Kerbin's radius; a vessel whose `landedAt` contains "KSC" gets 0.98, and one
whose `landedAt` contains "Runway" or "LaunchPad" gets 1.0. (Strategy effects can shift the two ends through
`RecoveryMinimumDelta` and `RecoveryMaximumDelta`; they are not modelled.) `GameVariables.partRecoveryValueFactor` (0.9) and
`resourceRecoveryValueFactor` (0.95) exist but no method calls them: they have no effect in 1.12.5.

**Difficulty presets** (`GameParameters.SetDifficultyPresets`): Easy 250,000 funds, gains ×2, funds and reputation losses ×0.5,
reputation penalty for declined contracts 0; Normal 25,000, all ×1, declined ×1; Moderate 15,000, gains ×0.9, losses ×1.5,
declined ×2; Hard 10,000, gains ×0.6, losses ×2, declined ×3.

**Contracts:** the saved `values` string is, in order, expiry time, deadline time, funds advance, funds completion, funds failure,
science, reputation completion, reputation failure, then four dates (`Contract.Save`). Base values per contract type come from
`Contracts/Contracts.cfg`; the prestige factors (1, 1.25, 1.5) and the other multipliers are the constructor defaults of `GameVariables`.

**Science:** per-body multipliers are nine consecutive floats in each `CelestialBody` prefab (landed, splashed, flying low,
flying high, in space low, in space high, recovery, flying altitude threshold, space altitude threshold), read by `tools/unityscan`.
Experiment base values and caps are in `Resources/ScienceDefs.cfg`; transmit efficiency is each part module's `xmitDataScalar`
(default 0.5). The number of biomes per body is not read.

**Parts and rockets:** `cost` in a part's cfg is the price with a full set of resources, so the dry price subtracts
`maxAmount x unitCost` per resource (verified: 22 of 28 of the user's saved rockets match the game's stored `totalCost` to the
unit; the others had stale saved totals or a renamed legacy part). The game's stored `totalMass` is lower than the sum of
part masses by 0.094 t per crew seat; the app applies the same rule. `ModuleDecouple` / `ModuleAnchoredDecoupler` name the
attachment that separates in `explosiveNodeID` (`srf` = the part leaves with its subtree).

**Milestones ("World First")** (`ProgressNode.AwardProgressStandard` calls `ProgressUtilities.WorldFirstStandardReward(passive = true, currency, type, body)`):
reward = `Progression.BaseReward` (80,000 funds, 8 science, 16 reputation in `Contracts.cfg`) × `PassiveBaseRatio` (0.2) ×
`ScoreProgressType(type, body)` × `OutlierMilestoneMultiplier` (1.5) when `OutlierWorldFirstContract` is true × (for the three
currencies) the contract factor of the tier from `ProgressTypePrestige(type, null)` × the difficulty gain, and for funds with a body
× (1 + (`GetContractDestinationWeight(body)` − 1) × `PassiveBodyRatio` (0.3)), where the weight is the body's science `RecoveryValue`
(× `contractDestinationWeight` = 1); the result goes through `Mathf.Round`. The score per type, at the home planet / elsewhere
(from the jump table of `ScoreProgressType`): orbit 1 / 0.8, flyby 0.8 / 1, landing 0.1 / 1.5, escape 1.1 / 0.6, splashdown 0.3 / 1.5,
suborbit 0.8 / 1, flight 0.5 / 1.2, science, flag and surface EVA 0.2 / 0.6, spacewalk 0.6, orbit return 1 / 0.8, flyby return 0.8 / 1,
landing return 0.1 / 1.5, rendezvous 1 / 0.8, docking, crew transfer, base construction, point of interest and tower buzz 0.3 / 0.8,
station construction and reach space 0.8, first launch and crew recovery 0.1, and the four records 2 (they pay by interval, not
here). Outliers: base and station construction, and a landing return on a body with an atmosphere. The tier (`ProgressTypePrestige`)
scores the type as at home (it passes no body): at or below the home flight score (0.5) trivial, below the home orbit score (1)
significant, else exceptional; the outliers are exceptional. The factors are `contractPrestigeTrivial/Significant/Exceptional`
(1, 1.25, 1.5). The achievement classes that award each type were mapped from the 25 callers of `AwardProgressStandard`. Not
compared with a played save.

**Strategies** (`Strategies.cfg`, `Strategies.Effects.*`): the slider value `Factor` (0..1) interpolates every `min`/`max` pair
(`ParentLerp`). `CurrencyConverter` takes `share` of the input amount of each query whose reason is in `AffectReasons` and pays
`share × amount × rate` in the output currency; `CurrencyOperation` multiplies (or adds to) the currency for the listed reasons;
`ValueModifier` changes `RecoveryMinimumDelta`/`RecoveryMaximumDelta`. Effects work on the original amounts of the query.

**Fuel ducts** (`CompoundParts.CModuleFuelLine`, `Part.RequestFuel`): a duct is a surface-attached compound part; when its target is set it
adds itself to the target part's `fuelLookupTargets`, and the target's fuel request is also sent to the duct, which reaches its own
parent: the part the duct sits on feeds the part at its far end. In a `.craft` the target is `PARTDATA.tpersID` (a persistent id).
Tank drain order: `Part.GetResourcePriority` = (inverse stage of the part, or of its parent) × 10 + `resourcePriorityOffset`; the app uses
the saved `sepI` (the stage a part separates in) for the first. `SolidFuel` has `flowMode = NO_FLOW` (its own part only).

**Terrain and biomes**: every body's map data are `MapSO` (height, `PQSMod_VertexHeightMap`: height = `heightMapOffset` +
`heightMapDeformity` × pixel/255) and `CBAttributeMapSO` (biomes: pixel colours matched to the attribute table that follows the
pixels; names and the number of biomes per body: Bop 5, Dres 8, Duna 14, Eeloo 11, Eve 15, Gilly 3, Ike 8, Kerbin 11, Laythe 10,
Minmus 9, Moho 12, Mun 17, Pol 4, Tylo 9, Vall 9) in `sharedassets9.assets`. Mapping from a direction to a pixel
(`PQS` vertex build): u = longitude / (2π) in the generator's frame, v = latitude / π + 0.5; the geographic longitude of the game relates
to it by u = 0.25 − lon / 360 (found by matching ground stations: ten sites, all on the right biomes). Bodies with a height map: Kerbin,
Mun, Duna, Eve, Laythe, Moho, Dres, Eeloo, Tylo, Vall; the others are made by noise modifiers only. The generator adds noise on top of
the maps, which is not read.

**Breaking Ground** (`GameData/SquadExpansion/Serenity`): four deployed instruments with `baseValue` (per hour, except the seismometer which pays by
impact energy) and `scienceCap`, `dataScale` 1, `applyScienceScale = false`, `situationMask` 1 (landed), `biomeMask` 0; `ScienceTimeDelay` 60 s; a
`DIMINSHINGRETURNS` table (1, 0.2, 0.35, 0.45, 0.5 by the number of the same instrument on a body); `rocsdef.cfg` lists each rock, its bodies and
biomes and its frequency. How it is paid (read from `Expansions.Serenity.DeployedScience.*`, `ModuleGroundExperiment`, `ModuleInventoryPart`,
`ScienceSubject`, `ResearchAndDevelopment`):

* Subject = `GetExperimentSubject(exp, Landed, body, "", "")`: one per instrument kind and body. `ScienceSubject` sets `subjectValue` = the body's
  `LandedDataValue`, `scienceCap = exp.scienceCap × subjectValue`, `dataScale = exp.dataScale`.
* Per hour: `scienceValue = baseValue × dataScale × subjectValue × ScienceModifierRate / 100`; each frame adds `scienceValue / 3600 × dt ×
  ScienceDiminishingModifierRate × power`, clamped to the subject's room left. R&D credits `data / dataScale × subjectValue` up to the cap, times
  `ScienceGainMultiplier` (difficulty). Sending happens at 10% of the cap or at the cap, over CommNet, with no transmission penalty.
* `ScienceModifierRate`: the module's constructor sets 5; placing from an EVA kerbal's inventory sets `DeployedScienceExpSkill × 100` if the kerbal
  has it (Scientist trait, modifiers 0.35, 0.45, 0.60, 0.80, 1 in `Serenity/Experience/Traits.cfg`, index `min(level, 4)` by
  `ExperienceTrait.CrewMemberExperienceLevel`).
* Diminishing returns (`SetDiminishingScienceRate`): n = instruments of that kind on that body in powered clusters; the one with the highest
  `ScienceModifierRate` (first found on ties) gets 1, every other one `GetDiminishingReturnsMultiplier(n)` = the exact table entry for n, else the
  last entry below n, else 1.
* Power: every part has `powerUnitsRequired`/`powerUnitsProduced` (station, instruments, dish need 1; solar panel and RTG make 1). An engineer
  placing a power part adds `DeployedSciencePowerSkill` (0 at level 0, else modifiers 0, 1, 1, 2, 2 by `min(level, 4)`). Loaded: rate ×1 if the
  cluster's power covers the need, else 0. Unloaded: 0 if short, 1 if non-solar parts cover it, else 0.5.
* The control station collects parts within `controlUnitRange` = 20 m (constructor default) and has no count limit.
* Seismometer (`DeployedScienceExperiment.ProcessSeismicEvent` and the impact handlers): an impact on the cluster's body gives
  `totalJoules = Σ ½ × mass(t) × 1000 × v²` over the parts that hit (part mass plus resources; `v` = the part's rigidbody speed, or the vessel's
  `srfSpeed` when it has none; a whole-vessel event uses `GetTotalMass` / `totalMass` and `srfSpeed`). Under `MinimumEnergyRequired`
  (3000 J, `DeployedScience.cfg` `SEISMICENERGY`) nothing happens. `impactRate` = the body's `Energy` entry in that node (Mun 7.82e8 J, Minmus
  2.12e7, Duna 3.62e9, ...); a body without an entry gets `float.MaxValue`, so no science. Science of one sensor =
  `ScienceDiminishingModifierRate × solarMultiplier × dataScale × scienceLimit × totalJoules / impactRate × ScienceModifierRate / 100 ×
  distanceMultiplier`, with `scienceLimit = subject.scienceCap`; it is clamped so the sensor's total never passes `scienceLimit`, and stored as
  `science / subjectValue` like the hourly instruments. `distanceMultiplier = Clamp01(distanceCurve.Evaluate(d / body.Radius))`, where
  `d` = `FinePrint.Utilities.CelestialUtilities.GreatCircleDistance` (= radius × acos of the dot product of the two surface normals) between the
  impact and the station, and one radius if there is no controlling vessel. `distanceCurve` (seismicSensor.cfg, Unity Hermite keys): `0 0 50 50`,
  `0.02 1 -0.0453 -0.0453`, `0.3 0.5 0.0247 0.0247`, `1 0.5 0 0`: nothing at the sensor, 100% at 0.02 rad (4 km on the Mun), 50% from 0.3 rad on.
  When several parts hit at once the multiplier of the last one in the list is used. A mod hook (`seismicDataCalcOverride`) can replace the
  result; stock does not set it.

* ISRU (`Squad/Parts/Resources/ISRU/ISRU.cfg`, Convert-O-Tron 250 liquid fuel + oxidizer converter): input `Ore` ratio 0.5 and `ElectricCharge` 30,
  output `LiquidFuel` 0.45 and `Oxidizer` 0.55 per converter cycle (per second at full rate). `ResourcesGeneric.cfg` densities: Ore 0.01 t/unit,
  liquid fuel and oxidizer 0.005 t/unit: one ore unit becomes 0.9 + 1.1 units of propellant, so a tonne of ore is a tonne of propellant. Drill rates
  depend on the ore concentration, which is not in the files read here (the drill `Efficiency` is: 0.3 for the small drill, 1.5 for the radial one).
* Terrain and CommNet: the occluder test (section 2) takes the celestial bodies only, so cliffs and crater rims never block a link in stock.
  The Network plan tab's terrain setting is an elevation mask the simulator applies to a landed site (`sim.js`, `node.mask`): it is a margin for
  modded games, off by default.
* `Career.techPlan` used to cost the same goals differently depending on their order when one goal was another's alternative parent; goals now count
  as parents that will be researched. The part-name normaliser in `Career.craftNeeds` (`mk1pod.v2` against `mk1pod_v2`) used a pattern that matched
  every character; both are fixed and tested.

**Not read:** kerbal hiring cost curve details, the interval records, the Space Center biomes, and the noise the terrain generator adds.

## 9. Energy (read from the game, 2026-11-23)

* **Solar panels** (`ModuleDeployableSolarPanel`, IL of `ModuleDeployableSolarPanel.PostCalculateTracking` and the flux code): output =
  `chargeRate × (solarFlux / SolarLuminosityAtHome) × sunAOA × temperature/time efficiency × efficiencyMult`. `solarFlux` is the star's luminosity over
  4π d², so against the home flux it is `(a_home / d)²`. Tracking panels use an angle factor of 1 while lit; fixed panels use the cosine of the angle
  between the panel and the sun. The atmosphere's own factor (`CelestialBody.GetSolarAtmosphericEffects`) is not modelled; the Energy tab takes it as a
  setting. The sun is hidden when a body's sphere is between the vessel and the star.
* **Part numbers** come from the part configs (`node scripts/build-energy-data.js`): 11 solar panels (charge rate and whether they track), the RTG
  (0.75 charge per second, no fuel), the fuel cells (the Fuel Cell: 1.5 charge per second from liquid fuel 0.0016875 and oxidizer 0.0020625 per second; the
  Fuel Cell Array: 18 from 0.02025 and 0.02475), 7 batteries (capacity in charge units), probe cores and reaction wheels (the `ElectricCharge` rate), 2 drills (3 and 15 per
  second), 2 converters (the Convert-O-Tron and the mini ISRU each draw 30), radiators and rover wheel motors. Titles, prices, masses and tech nodes are read from the career data.
* Antennas draw `packetCost / packetInterval` only while they transmit; relaying draws nothing.
* **Eclipses and night** are computed, not assumed: the module samples real positions over the planet's year (8 epochs) and two cycles of the orbit
  or solar day. The share in sunlight in a 100 km Kerbin orbit is about 2/3, and the longest darkness about 650 s, as the geometry says.
* **Not read:** panel heating curves, how the game dims light through an atmosphere, ion-engine consumption per throttle, and mods' own power parts.
