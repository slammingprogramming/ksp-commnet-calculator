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
* *Not* settled by the code: whether Kerbol carries a `CommNetBody`. The component is attached in the Unity scene,
  which can't be read from the IL, so "Kerbol blocks" remains an assumption (default on, switchable).

**Ground stations** (`CommNetHome.CreateNode`)
* With the difficulty option *Enable Extra Groundstations* **off**, only KSC exists, plus nodes flagged
  `isPermanent` (launch-site relays) when *Allow Other Launch Sites* is on. The five anomaly stations (Crater Rim,
  Nye Island, Harvester Massif, North Station One, Mesa South) are removed entirely. With the option **on**, all exist.
* A non-permanent station's rating is the DSN level (`GetDSNRange`: 2G / 50G / 250G, the wiki values); a permanent
  one uses its own fixed `antennaPower`. Which stations are permanent and their power (the wiki's "~36k") is
  *inferred*, not read: the workbench treats Baikerbanur and Larkes as permanent, 36 kilo.

**Links and paths** (`CommNetwork.TryConnect`, `CommLink.GetSignalStrength`, `CommRangeModel`)
* Range `= sqrt(Pa·Pb)`; normalized range `= 1 − d/sqrt(Pa·Pb)`; signal = the Bezier curve (0,0)-(1,1), i.e. 3x²−2x³;
  each antenna set has its own curve and the link uses `sqrt(curveA·curveB)` (identical here).
* A link stores three strengths: relay×relay, relay(A)×transmit(B), transmit(A)×relay(B). For a path, a link that
  touches the path's **source** may use that end's `transmit`; **every other link uses relay×relay only**. This is
  exactly the workbench's rule (own power for the source's links, relay power elsewhere).
* Paths go to the best home node by maximizing the strength (assumed to be the product; the cost arithmetic is
  not fully decoded).

**A vessel's antenna powers** (`CommNetVessel.UpdateComm`)
* Antennas are split into direct+internal (D) and relay (R); only *combinable* antennas add. `relay` = max(best R,
  combined combinable R). `transmit` = if any D antenna exists: the combination of all combinable antennas (D and R)
  provided a combinable D antenna exists and it beats the best D antenna, else the best D antenna. Both are then
  multiplied by the Range Modifier. A link at the source uses the better of transmit and relay.
* `antennaCombinableExponent` defaults to 0.75, `antennaPower` to 500000 (`ModuleDataTransmitter` constructor);
  weighted exponent and `strongest × (Σ/strongest)^e` are as the wiki says. `core.antennaPowers` ports this.

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

## 5. Mod antennas: checked against the mods' current configs (2026-09-29)

Each mod's part configs were read from its GitHub repository and compared with the community listing that inspired
this project.

| Mod | Result |
|---|---|
| ReStock+ | Powers, masses, costs and packet data match. Tech nodes filled in. |
| Near Future Exploration | All 18 antennas match. Tech nodes filled in. |
| JX2Antenna | All 3 match. |
| CommNet Antennas Extension | Powers match, but several packet values were stale (e.g. EXP-VR-2T interval 0.3 s / 16 EC, RA-25 3 Mit / 30 EC, "Tigger" 28 EC). It patches RemoteTech's part names. |
| **DMagic Orbital Science** | **The listing was wrong by 10×:** Oversize SIGINT is a **10 T relay** (was 1 T direct), Undersize SIGINT a **1 T relay** (was 10 G direct); exponent default 0.75 (not 0). |
| ProbesPlus | Values match, but the current pack has ~10 more antennas (Argo dishes/masts, Vorona dish, Meridiani dish, integrated antennas) and no longer has the "landv" parts. |
| Vens' Stock Revamp | Obsolete: it no longer defines antennas (its HG-20 model became CAE's HG-32). Removed. |

Parts with no `antennaCombinable` key default to non-combinable (e.g. Probes Plus integrated antennas).

## 6. Independence from the spreadsheet

The spreadsheet's formulas were the same as the wiki's, which is where they are taken from here. Stock and mod antenna
values are read from the games' and mods' configs (sections 4-5). Body distances are computed from orbital geometry
(section 3) rather than copied. The remaining overlap is ideas: the antenna selector, the mod pack toggles, the
reachability matrix and the difficulty modifiers; the implementation and data are independent.

## 7. Known gaps

* Occlusion rule details (section 2); atmosphere and Sun handling are assumptions.
* Whether the game's path-finder ever prefers a relayed path over a working direct one (wiki says no).
* Spin phase of tidally locked moons other than the Mun; Larkes station position.
* Two-body orbits only; the game itself is patched-conics, so vessels behave the same way, but Kopernicus binaries
  (Plock-Karen) are simplified.
