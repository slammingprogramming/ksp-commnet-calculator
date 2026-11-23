# Network plan

The **Network plan** tab designs a relay network from a list of what has to stay connected. You describe the sites (a station,
a lab, a base, a mining site, rovers, aircraft), choose whether to build it all at once or in stages, and it works out the
relays, checks them against what your career has unlocked, and tells you what is missing and what it costs.

It is not a separate model. Each stage is a run of the [Relay planner](planner.md) on a scenario made from your sites plus the
relays of the stages before, so the uptime numbers are the same simulation (real orbits, the game's occlusion rule, ground
stations and difficulty settings from the settings panel).

## The sites

Add a site with one of the buttons, or load the example (a Mun station, a base on the far side and a rover group).

| Kind | Where it is | What it gets by default |
|---|---|---|
| Satellite or probe, Space station, Orbital science lab | a circular orbit: altitude and inclination | the lightest antenna that reaches the heavy class (15 G) |
| Land base, Mining or refinery site, Parked lander | a latitude and longitude | the lightest antenna that reaches 2 G |
| Surface vehicles (they roam) | spread-out points over the body, optionally limited to a latitude band | the lightest antenna that reaches 500 k |
| Aircraft and drones (they roam) | the same points, at a cruise altitude | as for vehicles |

* **Roaming sites** cannot be pinned to one place, so the plan covers a set of points spread evenly over the body (2 to 16 of
  them, more means a slower plan). The site only counts as met when every point meets the goal, which is how a rover or a drone
  stays connected wherever it goes. Atmosphere is handled by the game's own rule: the Occlusion setting for atmospheric bodies
  (the settings panel) makes thick atmospheres block more.
* **Antenna:** leave it on Automatic, or pick one. The automatic choice uses only antennas you have switched on, and
  (with a career loaded) only ones your career can build, or the lightest in the list if you have none.
* **Uptime goal:** blank means the global goal above the Run button. Crewed sites usually want a higher one.
* **Terrain** is a margin, not a game rule. The stock game blocks signals with whole bodies only; a cliff or a crater rim
  between a rover and a relay changes nothing (checked in the game's code, [research notes](RESEARCH.md)). The settings are
  for modded games and for caution: *rolling hills* makes the site need to see a relay at least 5° above its horizon,
  *rugged* 15°, *inside a crater* 30°. If the goal still fails with a terrain setting, the result suggests high ground
  near the site (from the [Landing](landing.md) finder) where a relay lander would see more sky.

## Staged or all at once

* **In stages** gives every site a stage number (the tab suggests one: the Kerbin system first, nearby planets next, the rest last;
  change it as you like). Stage 1 is planned for its sites; stage 2 for stage 1's and its own sites, **keeping stage 1's relays as
  built** and adding only what is missing; and so on. You see what each stage costs and what it unlocks, so you can fly them one
  at a time.
* **All at once** plans every site together. It can use fewer relays in total (a ring planned for everyone from the start)
  but you pay for it before the first site works.

## What your career has unlocked

With **Use what my career has unlocked** on and a career loaded on the [Career](career.md) tab (from a `persistent.sfs`
or a preset), the generator only builds with antennas whose tech node you have researched **and** whose part you have bought.
For each stage it then:

1. plans with what you have;
2. if the goal is missed, or the plan needs an antenna you cannot build yet, plans again with every antenna and lists the
   **unlock**: the antennas, the tech nodes to research in order with their science cost, and the price of the parts;
3. if it is still short, tries the next **Tracking Station** level (a stronger ground link) and says so with the facility price.

Later stages assume the earlier unlocks are done. The cost line adds the relay hardware (the antennas, plus a plain relay
bus from the game's probe core, battery and two panels, so a relay is not free) and any unlocks. **Launches are not included**:
what a rocket costs depends on how you build it, so price the launches on the [Missions](missions.md) tab. Against your funds
and science the card says what is short.

Without a career (or with the box off) every antenna you have switched on counts as available.

## Where to put things

Below the plan, pick a body for placement advice:

* **Station and lab orbits:** the low and high space bands of the body with the science multiplier of each (they differ: low space
  is worth more on the Mun, high space on Kerbin), the orbital period, and the delta-v of landing from it and of getting back,
  with the same ascent allowance the Missions tab uses (it does not grow with altitude). The inclination options are your bases'
  latitude (no plane change to land), equatorial and polar (every biome passes below).
* **Reusable lander:** the propellant for the trip down and back up from your dry mass and engine, and the ore that refills the
  ascent. The ISRU numbers are the game's: 0.5 ore per second becomes 0.45 liquid fuel and 0.55 oxidizer, and ore, fuel and
  oxidizer weigh the same per unit pair, so a tonne of ore makes a tonne of propellant.
* **Base and mine sites:** the flattest ground (from the Landing finder: slopes are regional, not ground level) with several biomes in
  reach, scored by how well each candidate sees the network (a simulation over one rotation of the body, with the plan's relays if
  you have generated one), how low its latitude is, and how many biomes are close. **Add as base** puts it on the list.
  The game's ore concentration maps are not in the files this app reads, so for a mine use the spot your own scanner found and add it as a mining site.

## Where to earn it

*Work out where to earn science* ranks the bodies by the first-time science of landing there against the delta-v of arriving,
landing and getting back to orbit (two-body, from a 100 km Kerbin orbit, using the Missions tab's legs and real transfer windows).
Thick atmospheres have no default ascent allowance, so those trips are priced down only and listed after the complete ones.
Funds come from contracts, the World First milestones and recovery: the [Career](career.md) tab has those.

## Limits to know

* Plans use circular relay rings and the planner's usual shapes. They are a good starting design, not a proven optimum.
* The simulation is two-body patched conics with no perturbations, like the game.
* A plan with several stages and a long look-ahead can take minutes: it runs in your browser and keeps working while you scroll.
* Mod antennas have no research data here; they count as available if you switched them on.
