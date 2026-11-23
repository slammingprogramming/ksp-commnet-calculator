# Landing: where to put down, and what to do there

The **Landing** tab finds places to land by how much tilt you can take, shows the biomes of a body, and lists what a lander can
measure at the spot you pick, including the Breaking Ground instruments and surface rocks. It reads the game's own height and
biome maps, so it works the same on stock bodies as the game does.

![The Landing tab](img/landing.png)

## Find sites

Pick a body, then say what you can live with. Press **Find sites** and the best places come back as a table and as pink numbered
circles on the map. Cells that fail your limits are dimmed.

| Setting | What it does |
|---|---|
| **Land at up to … ° of tilt** | the steepest ground you can touch down on |
| **Stay on up to … ° of tilt** | the steepest ground you can stay parked on (a base, a rover, a deployed station); normally gentler than the landing limit |
| **How much of the region must be that gentle** | a region is one cell of the map (see the size in the text above the form); this is the share of its ground that has to be within both limits: 25%, 50%, 75% or 90% |
| **Latitude, height** | keep to an equatorial band (sun, communications, getting back up) or a height range, in metres on the map |
| **Only these biomes / Leave out these biomes** | each biome is its own science subject, so you can aim for the ones you still need or skip a hard one |
| **Reference point** | click the map and press "Use as reference point" (or the Space Center on Kerbin), then limit the search to a distance from it |
| **Count biomes within … km** | how many different biomes are within hopping range of the site; useful for a rover or a hopper |
| **Rank** | flattest first, most biomes in reach, closest to the reference point, lowest or highest ground |
| **Dry land only** | on Kerbin, Eve and Laythe, leave out the ground under the sea |

Click the map or press **Details** on a row to see the region: its biome and the one next to it, the map height, the relief, the
slope (half of the ground is under one value, nine tenths under another) and how much of it passes your two limits.

## What a lander can measure there

For the picked region the tab lists every experiment that works landed, with the first-return value and the cap for the subject. The
ones marked "per biome" pay again in every biome you reach, and the tab adds up one landing and a trip through all the biomes of the
body. Recovering the science pays the first-return value; transmitting gives a fraction (see [Career](career.md#science-worth-at-a-body)).

### Breaking Ground (DLC)

If you own the expansion the same panel shows two more things:

* **Surface rocks**: the special rocks you can scan with the ROC arm, the biomes each appears in, whether the region you picked is
  one of them, how much science the scan can give and how common the rock is.
* **Deployed instruments**: the four sensors you set down from a lander (a seismometer, a weather analyser, a goo monitor and an
  ion collector). Say how many of each you plan, who sets them down and how they are powered; the table gives the part price, the
  science per hour, the total, the time to reach it and whether the instrument works on this body (the weather analyser needs an
  atmosphere, the ion collector a vacuum). Below it, the power units the station needs and how many solar panels or RTGs that takes.

How the game pays for deployed science (read from its code; [research notes](RESEARCH.md) section 8):

* **One subject per kind and body.** Every goo monitor on the Mun feeds the same subject: no biomes. Its worth is the body's
  *landed* multiplier (the Mun ×4, Minmus ×5, Duna ×8, Laythe ×14 ...), which the tab applies to both the rate and the cap.
* **Rate per hour** = base rate × landed multiplier × the rate set when the part was put down × the share below × power.
  A scientist on EVA sets the rate by level: 35, 45, 60, 80, then 100% from level 4; anyone else leaves it at 5%.
* **Several of one kind** don't raise the cap; they only reach it sooner. The best-rated one runs at 100%; every other one runs
  at the share for the count (2 of a kind 20%, 3 35%, 4 45%, 5 or more 50%). Three goo monitors by a level 5 scientist make 1.7
  times what one makes, not three times.
* **Power:** the control station, each instrument and a ground dish need 1 unit each; a solar panel or RTG makes 1, plus 1 if an
  engineer of level 1 or 2 set it down, plus 2 from level 3. Without enough power nothing is made. While the station is not
  loaded (you are elsewhere) and only solar panels power it, the game runs it at half rate. Parts must be within 20 m of the station; there is no limit on how many it runs.
* **Getting it home:** the station sends its data over CommNet when it has a link to the KSC (the control station has its own
  antenna); the science is credited times your difficulty's science gain (the tab takes it from your career, or set it yourself).
* On a body with air, the crash speeds listed come from a drop through the body's atmosphere (the Reentry tab's point-mass model) for a light probe (ballistic coefficient 300 kg/m²) and a dense slug (3000 kg/m²), not the airless fall.
* The **seismometer** pays per impact, not per hour. Below the table, give the mass of what crashes (a spent stage with its
  leftover fuel), its speed at the surface and how far from the sensor it hits, and the tab gives the science from that impact
  and how many such impacts fill the subject. The game's rule: the impact's energy (½ × mass × speed²) divided by the body's
  energy scale (the Mun 7.82 × 10⁸ J, Minmus 2.12 × 10⁷ J, Duna 3.62 × 10⁹ J ...) is the fraction of the cap paid, times the
  sensor's rate (5% from anyone, up to 100% from a scientist), the share above for several sensors, the half rate for solar-only
  power while you are away, and a share for the distance: nothing right on the sensor, all of it at 2% of the body's radius
  around the surface (4 km on the Mun) and half from 30% of the radius on (60 km on the Mun). Impacts under 3000 J don't count,
  the subject stops at its cap, and Jool has no energy scale, so no seismic science there.
* **Which crashes to plan:** under that, a table of the mass to drop. Energy simply adds up, so the *total* mass that fills the cap is
  fixed by the speed (one crash of 2 t pays what two of 1 t pay) and splitting it only costs you the 3000 J floor per impact. It
  lists one crash alone, two, three, four and six, at your speed and at the speeds an impactor reaches from a 30 km and a 100 km
  orbit (a de-orbit burn with periapsis at the surface) and from far away (escape speed), and the same for a far crash that pays half.
  The distance band says where to aim: full value at 4 km on the Mun, at least 90% from 3.1 to 19.8 km, nothing on the sensor itself.
  Aim your orbit's ground track so the crash lands in that ring. With two or more sensors, type their positions (latitude and
  longitude, one per line) and the tab finds the point that sits in the ring of all of them; sensors within a few tens of
  kilometres of each other can share one crash. Bodies with an atmosphere slow the crash down, so use the speed you measure at the ground.

## How far to trust the numbers

The map data are what the game's terrain generator starts from. The generator then adds noise (hills, craters, rocks) that is not
in the maps, so:

* **Slopes are regional.** One map pixel is hundreds of metres to a kilometre. A region that passes is a good place to *look*; the
  ground right under the lander can still be steeper. A region that fails is steep.
* The height map has 256 levels, so heights change in steps of a few tens of metres; gentle slopes below a degree or two are not
  resolved, and a "flat" region can hide them.
* **Minmus, Ike, Gilly, Bop and Pol have no height map** (their ground is made by noise alone). The tab shows biomes for them but no
  slope; all the slope filters pass.
* Heights are the map's heights. The true surface also depends on the noise and on a few fixed offsets, so expect an error of
  a few hundred metres.
* The Space Center's own biomes and the special sites (anomalies, launch sites) are not in the maps and are not shown.

A good routine: use the finder to get a shortlist, check the map view of the game near each candidate, then pick by what you see
when you get there.

## Where the data comes from

`python tools/unityscan/unityscan.py "<KSP folder>" facts.json --terrain=<folder>` reads the height map and the biome map of every body
from the game's asset file (the map for a body is found by walking the game's object hierarchy to the body it belongs to, and the
orientation was checked against the Kerbin ground stations: all land on the right biomes). `node scripts/build-terrain-data.js <folder>`
turns them into `js/terrain-data.js`: a 128 × 64 grid per body with the main and second biome, the mean height, the relief and the 25th,
50th and 90th percentile of the slope computed on the full-size map. Numbers only, no pictures. See [Development](development.md).
