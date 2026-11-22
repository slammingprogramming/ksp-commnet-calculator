# How the model works

What the app computes, and how far to trust it. Where a rule was read from the game's own files, that is said; the
evidence and sources are in [RESEARCH.md](RESEARCH.md).

## Signal strength

```
vessel power = strongest × (Σ powers ÷ strongest) ^ e        e = power-weighted mean combinability exponent
link range   = √(power A × power B)
signal       = 3x² − 2x³   where x = 1 − distance ÷ range     (clamped to 0..1)
path signal  = product of each hop's signal
```

* Every antenna has a **power rating** (an RA-15 is 15 G, 15 billion). A vessel's rating combines its antennas with
  diminishing returns: `e` is 0.75 for almost everything, 1.0 for the Communotron 16, and the 16-S does not combine at all.
* Two ends of a link reach as far as the **geometric mean** of their ratings, so a strong dish on a weak probe still only
  gets you a mid-range link.
* The DSN is rated **2 G / 50 G / 250 G** for Tracking Station levels 1 / 2 / 3.
* **Difficulty:** the *Range modifier* scales every vessel, the *DSN modifier* scales the DSN.
  Presets: Normal ×1, Moderate ×0.8, Hard ×0.65 (with occlusion multipliers 0.9/0.75, 1.0/0.85 and 1.0/1.0).

## Own link and relay link

A vessel's **own link** uses all its antennas. When it acts as a **relay** for someone else, only its relay-type
antennas count (RA-2, RA-15, RA-100, HG-5 and similar). The exact rule, ported from the game's `UpdateComm`:

* only *combinable* antennas add up;
* the relay rating is the better of the best single relay antenna and the combined relay antennas;
* the transmit rating is the combination of all combinable antennas if a combinable direct antenna exists and beats the
  best direct one, otherwise the best direct antenna;
* a vessel's own rating is the larger of transmit and relay.

A part config that does not say `antennaCombinable` is **non-combinable**, as in the game.

## Paths

The game connects a vessel to the DSN along the path with the **best product of link strengths** (confirmed in
`CommNetwork`'s shortest-path search). Source links may use the source's transmit power; every other link is
relay-to-relay. The app follows the same rule, and also tells you the weakest hop so you know what to upgrade.

## What blocks a signal

Every body is a sphere of radius **body radius × occlusion modifier**: the *vacuum* modifier for airless bodies and the
*atmosphere* modifier for bodies with air. The atmosphere's height is **not** added. A link is blocked when its
straight line enters a sphere. The test is a port of the game's `OccluderHorizonCulling.Raycast`.

* **Kerbol blocks signals**, like all 17 stock bodies. That is what causes conjunction blackouts. The "Kerbol blocks"
  switch in the game settings is only for what-if runs.
* With only the Kerbal Space Center as a DSN station, **Kerbin's own night side** cuts a distant link for hours every
  day. This is the most common outage, and the planner treats it as its own case.

## Ground stations

* Only the **Kerbal Space Center** is always present.
* The five anomaly stations and **Baikerbanur** exist only with the difficulty option *Enable Extra Groundstations*;
  they use the DSN rating.
* With *Allow Other Launch Sites* on, the two **Making History** launch-site stations (Desert, Larkes) exist as weak,
  fixed 40 G antennas. The game settings panel has a switch for them.

## Orbits and time

* Every body and vessel moves on a **two-body Kepler orbit**, in one inertial frame with +z as the spin axis (KSP has no
  axial tilt). Stock KSP has no orbital perturbations, so this is the game's own model.
* Kerbin's rotation moves the ground stations; every stock body's starting spin phase is the game's `initialRotation`,
  so which side of Mun, Minmus, Ike and the other locked moons faces its parent is exact.
* The calendar is KSP's: 6-hour days, 426-day years.
* **Patched conics (opt-in per vessel).** A vessel set to *follow patched conics* is carried out of a sphere of
  influence when it reaches the edge, and onto the new body's orbit, up to 8 legs and 25 years ahead. Escape (hyperbolic)
  orbits imported from a save always do. There are no burns: it shows where the vessel goes if it does nothing more.
  A vessel without the option stays on one orbit about its body.

## Antenna options

* **Extended switch.** Each antenna entry can be marked not extended: a retracted antenna does not count, as in the game.
* **Near Future reflectors.** With the Near Future Exploration pack on, an antenna with a feed can be pointed at a
  reflector. The reflector adds `bonus × feed scale` to its power, using the game's own formula.

## Accuracy and limits

**Read from the game's own code and data:** the occlusion test and radius rule, path choice, antenna-combining rules,
link rules, ground-station set, positions and power, the constants behind body masses, and every stock body's radius,
orbit and spin phase. Nothing the model relies on is a guess for stock KSP.

**Only as accurate as their configs:** mod antennas (compared with each mod's current part configs by
`scripts/check-mod-data.js`, also run monthly in CI) and bodies or stations added by planet packs.

**Not modelled, and why:**

| Not modelled | Reason |
|---|---|
| Plasma blackout | In the game it is a transient on loaded vessels re-entering an atmosphere. It never affects an orbiting or landed vessel, so it has no place in link planning. |
| Orbital perturbations | Stock KSP has none (patched conics). |
| Manoeuvres | The patched conics follow a fixed orbit; there are no manoeuvre nodes. |
| Other mods' signal multipliers, `ModuleRelayEnabler`, science bonuses | No verified data to model. |

**Things to keep in mind:**

* The **Antenna finder** and **Link & relay chain** are range calculators. Under the distance picker they also say how
  often the straight line between the two bodies is blocked over the next 8 years (centre to centre), but a vessel
  hiding behind its own planet is only visible in the Tracker.
* The **distance pickers** give the closest and farthest separation two bodies ever reach, a worst and best case rather
  than today's distance. The "at scenario time" chip gives the actual distance.
* The planner's search is a heuristic: it finds good, verified designs, not provably optimal ones.
* Kopernicus binaries (Plock–Karen) are simplified.

For how the numbers were verified, see [RESEARCH.md](RESEARCH.md).
