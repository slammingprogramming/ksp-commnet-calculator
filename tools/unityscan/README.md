# unityscan

A small, standard-library-only Python tool (3.9+) that reads CommNet-relevant facts out of a copy of KSP 1.12.5 that
you own: which bodies carry a `CommNetBody` (all of them, including the Sun), the ground stations (`CommNetHome`: KSC,
anomaly stations, the Making History launch-site stations with their position and power), and each celestial body's
radius, surface gravity, initial rotation, tidal lock and orbit.

```
python tools/unityscan/unityscan.py "C:/Program Files (x86)/Steam/steamapps/common/Kerbal Space Program"
python tools/unityscan/unityscan.py "<KSP folder>" facts.json      # also write the numbers to a file
```

It also reads the facility upgrade prices and the per-body science multipliers that the career tools use (`facts.json`, `career` key). It is how the values behind the simulation's ground-station rules, spin phases and gravity constant were confirmed
(see `docs/RESEARCH.md`). Run it again after a game update to see whether anything moved.

`--terrain=<folder>` also writes each body's height map and biome map (one byte per pixel) with their scale, offset and biome names, for
`scripts/build-terrain-data.js` (the Landing tab). The map of a body is found by following the game's object hierarchy from the terrain
modifier to the body, and the longitude orientation was checked against the Kerbin ground stations.

Notes:

* The game's own player files carry no Unity type trees, so some values are read at offsets derived from the C# field
  order (`tools/ildump` lists a class's fields). The Making History asset bundles carry type trees and are read generically.
* The `Sun` entry's rotation value is not reliable (the Sun's prefab holds a placeholder); nothing uses it.
* Output goes to the terminal; do not commit it.

## Legal note

This tool is original code: it contains none of the game's code or assets and ships no game files. Run it only on a
copy of the game that you own. Do not redistribute the game's files or dumps of them, and check the game's licence
terms and your local law before you use the output for anything beyond interoperability and compatibility research.
This is not legal advice.
