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
* **Light through the air** is a factor you set for a world with an atmosphere. The game's own rule for it is not modelled.
* The result states the share of the time in sunlight (worst and average season) and the **longest unbroken darkness**, which is what
  the batteries must carry. A polar orbit's eclipses change with the season; the design uses the worst one.

## What it draws

Pick parts from the list (probe cores, reaction wheels, drills, converters, radiators, rover wheel motors) or enter your own charge
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

* A panel's output is its charge rate times the light at that distance and the sun angle, as the game computes it (read from the code,
  [research notes](RESEARCH.md), section 8). Panel heating and damage and the game's atmospheric dimming are not modelled.
* Batteries built into probe cores and pods are not counted, so a small probe may need less than shown.
* Loads that change with what the crew does need a duty cycle you choose.
* Mods that add power parts are not read; enter their output as a custom load and compare by hand.
* The light depends on where the home planet is: a pack with a rescaled home world uses its orbit as the reference.
