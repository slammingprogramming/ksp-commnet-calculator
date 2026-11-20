# Contributing

Thanks for wanting to help. This is a small, dependency-free project, so contributing is simple.

## Good first contributions

* **Wrong or missing game data** (an antenna, a body, a ground station): open a *Data correction* issue, or edit the
  table in `js/data.js` directly. Values must come from the game's or the mod's own config files, never from another
  tool or spreadsheet (that keeps the data independent and the licence clean).
* **A result that disagrees with the game:** open a *Bug report* with the game's numbers and your settings.
* **Another mod's antennas or a planet pack:** the *Antennas & mods* tab imports part `.cfg` and Kopernicus files, so
  often nothing needs changing; if a pack deserves built-in support, open an issue.

Security problems are **not** for public issues: follow [SECURITY.md](SECURITY.md).

## Working on the code

```
npm test        # unit tests (Node 18+, no install step)
npm start       # static dev server on http://localhost:8080
```

* No build step and no dependencies: plain scripts that also run from `file://`. Please keep it that way.
* The pure logic (`data`, `orbits`, `core`, `world`, `sim`, `planner`, `parsers`) has no DOM access and is unit-tested;
  changes to the maths, data or parsers should come with a test.
* The interface is built with the `h()` helper and `textContent`; never assign imported text with `innerHTML`
  (a test enforces this).
* Match the surrounding style: 2-space indent, single quotes, comments that explain *why*.
* Every source file starts with `SPDX-License-Identifier: AGPL-3.0-or-later`.
* Keep personal information out of everything you commit: save files, paths, names, emails.

## Pull requests

Keep them focused, say what and why, and make sure `npm test` passes (CI runs it too). By contributing you agree that
your work is licensed under AGPL-3.0-or-later like the rest of the project. You do not need to sign your commits.

## Conduct

Be kind and constructive: see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
