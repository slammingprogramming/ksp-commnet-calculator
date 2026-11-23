# Energy planning

The **Energy** tab answers "how many solar panels, RTGs or fuel cells, and how many batteries, does this vessel or base need
where it will be?". It measures the sunlight the place really gets over the planet's whole year, adds up what your parts draw,
and lists what covers it, lightest first, with mass, price and what you would still have to unlock.

The **Network plan** tab also shows a power line for each relay group it plans, using the same calculation.

## Where it is

| Choice | What it means |
|---|---|
| **In orbit** | a circular orbit about a body: altitude and inclination. Eclipses by the body (and by other planets and moons) are found by testing every body as a sphere between the vessel and the star at sampled moments of the planet's year. |
| **On the ground** | a latitude and longitude. The sun is up half the time (a solar day is the body's spin against its planet's year; a tidally locked moon spins once per orbit, so its night is long). A flat panel gets the sine of the sun's height. |
| **In deep space** | flying about the orbit of a planet: always lit, but the light follows the changing distance to the star. Panels are sized for the dimmest point of the orbit. |

* **Light** falls with the square of the distance to the star, measured against the home planet's orbit (a panel's charge rate in the
  part list is what it gives at Kerbin's distance). At Eeloo that is about 1.4% to 4%; at Moho more than four times as much.
* **Fixed panels** (the OX-STAT types and others that do not track) get a "facing the sun" share you set (50% by default for a
  vessel that tumbles slowly; lying flat on the ground the sun's height is used instead). Tracking panels always face the sun.
* **Light through the air** follows the game's own rule on a world with an atmosphere: the sun's path through the air (longer when the sun is low) times
  the local air density, turned into a factor `k / (k + density x path x 0.15)`, where `k` is 0.85 times the home world's sea-level density. Overhead at
  sea level on Kerbin that is 85%; with the sun 30 degrees up, 74%; near the horizon, about a third. The "Extra dimming" field is for anything on top
  (dust, a mod).
* **Panel heat:** a panel loses output when it runs hot and makes a little more when it is cold (the game's temperature curve: 100% at 300 K, about 69% at
  600 K, 120% near absolute zero). The panel temperature is an **estimate** for a plate facing the sun (a flat plate that absorbs on one face and radiates
  from two, about 331 K at Kerbin's distance and 616 K near Moho); the game works it out from the whole vessel, its areas and its surroundings, which
  this does not. On a world with air the air carries the heat away, so the air's temperature is used. Untick *Panel heat* to leave it out.
* The result states the share of the time in sunlight (worst and average season) and the **longest unbroken darkness**, which is what
  the batteries must carry. A polar orbit's eclipses change with the season; the design uses the worst one.

## What it draws

Pick parts from the list (probe cores, reaction wheels, drills, converters, radiators, rover wheel motors, **electric engines** at full thrust:
the ion engine draws 8.7 charge per second, worked out from its thrust, specific impulse and propellant mix as the game does) or enter your own charge
per second, and give each a **duty cycle** (the share of the time it runs). Antennas draw only while they send data (the game's
packet cost over the packet interval); relaying costs nothing. Three more settings:

* **Spare power** (15% by default) on top of the average load.
* **Burst minutes**: how long everything may run at once, which the batteries must carry on top of the darkness.
* **Fuel cell days**: how long a fuel cell must run, for the propellant it burns.

## What covers it

| Kind | How it is sized |
|---|---|
| **Solar** | enough panels that the time-average output (darkness counts as zero, the dimmest season and distance, your sunlight factors) covers the load with the spare, plus the lightest batteries that carry the longest darkness and any burst |
| **RTG** | enough generators for the load: a fixed 0.75 charge per second, the same in darkness and at any distance; batteries only for a burst |
| **Fuel cell** | enough cells for the load, with the liquid fuel and oxidizer burnt over the days you set (tanks not counted); independent of light |

The table is sorted by mass. **To unlock** shows what is missing: the tech node to research, or the part price to pay. With a career
loaded, only parts it can build are listed unless you tick *Also show parts I would have to research or buy*; without a career,
everything counts.

## What is and is not modelled

* A panel's output is its charge rate times the light at that distance, the sun angle, the air (on the ground) and the temperature curve, as the game
  computes it (read from the code, [research notes](RESEARCH.md), section 9). Panel damage is not modelled; the panel temperature is an estimate (see above).
* **Charge your parts already carry** (probe cores, command pods and other parts; read from the part configs) is entered under *Already on board* and
  counts against the batteries.
* Loads that change with what the crew does need a duty cycle you choose.
* **Mod parts:** pick a mod's part `.cfg` files under *Mod power parts* and its solar panels, RTGs, batteries, reactors, fuel cells, electric engines and
  loads join the lists (Near Future Solar and Near Future Electrical read correctly, including the current reactors' `ElectricalGeneration`). Mod parts are
  treated as available in a career. A reactor is listed at full power; its cooling and fuel are not sized. Some mods let an RTG decay over its half-life; the
  starting output is used. Panels that a mod switches between cell types use the first rate in the file.
* Engine alternators (jet engines that run a generator) are not offered as a source.
* The light depends on where the home planet is: a pack with a rescaled home world uses its orbit as the reference.
