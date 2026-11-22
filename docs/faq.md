# FAQ and troubleshooting

## The calculators say my link works, but the game says no signal

The Link & relay chain, Antenna finder and Reach map use **range only**. In the game a body can also be in the way.
Look at the *line of sight* note under the distance picker, then put the vessel in a [Scenario](scenario.md) and use
the [Tracker](tracker.md): it shows which body blocks the link and when. The usual culprits are Kerbin's own night side
(when the KSC is the only ground station), the far side of the body you orbit, and Kerbol at conjunction.

## I added a relay and the signal did not improve

Three common reasons:

* **The game prefers a direct link.** If a direct link to the DSN exists, it is used even when a relayed path would be
  stronger. Tick the direct-link check in the chain tab to see which one applies.
* **Only relay antennas count when a vessel relays for someone else.** A vessel's *own* link uses all its antennas; as a
  relay, only the relay-type ones (RA-2, RA-15, RA-100, HG-5 and similar) count. The vessel card shows both numbers.
* **A relay's signal multiplies with the other hops.** Two 70% hops make a 49% path.

## Why does Kerbin block my link every day?

With only the Kerbal Space Center as a DSN station, the ground station is hidden behind Kerbin from a distant
vessel for hours every day. Either turn on *Enable Extra Groundstations* in your game (the planner tells you
what that alone would achieve), or put relays in orbit around Kerbin. See [Relay planner](planner.md).

## Does the app change my game or upload my save?

No. Everything runs in your browser: the app makes no network requests (a test enforces it). A save you load is read in
the page and kept in your browser's local storage, and the app only ever reads it. Nothing is written to your KSP
install. To clear everything, use **Reset** at the top right.

## Which version of KSP and which mods are supported?

KSP **1.12.5**: stock, Breaking Ground and Making History, the Outer Planets Mod, and these antenna mods: ReStock+, Near
Future Exploration, CommNet Antennas Extension, DMagic Orbital Science, JX2Antenna and ProbesPlus. Any other mod's antennas
can be imported from its part `.cfg` files and other planet packs from their Kopernicus configs; see
[Game settings and mods](settings-and-mods.md).

## A number does not match what I see in the game

First check the [Game settings](settings-and-mods.md): Tracking Station level, the four difficulty modifiers, whether
extra ground stations and other launch sites are enabled, and which antenna packs are on. Then check that the vessel's
antennas are the deployed ones (the *extended* checkbox) and whether the connection depends on a reflector. If it still
differs, [open an issue](https://github.com/slammingprogramming/ksp-commnet-calculator/issues) with the scenario file
(**Export file** on the Scenario tab) and what the game shows. What the model covers, and what it does not, is in
[How the model works](model.md).

## What is not modelled?

Plasma blackout inside the relay simulation (it only happens during an atmospheric entry, which the Reentry tab covers),
orbital perturbations (the game has none), powered flight and fuel, other mods' signal multipliers and science bonuses. See the table in [How the model works](model.md#accuracy-and-limits).

## The planner takes a long time

It runs many simulations on your own device, in the page, and no Web Worker is used by design. It is time-sliced so the page
stays usable, and it normally takes twenty seconds to a couple of minutes. A shorter look-ahead, fewer vessels under
*Plan for these vessels*, and leaving *Design for the hardest difficulty* off all make it faster. You can cancel at any
time.

## Is the planner's answer the best possible?

It is verified, not proven optimal. Every fix is simulated over the look-ahead period and kept only if it improves
uptime, redundant fixes are removed, and the result is stress-tested on every difficulty preset. A different
arrangement might use fewer relays in a case the search does not try.

## My scenario disappeared

The scenario is stored in your browser. Clearing site data, using a private window, or pressing **Reset** removes it.
Use **Export file** (or **Copy share link**) on the Scenario tab to keep a copy.

## Where do I report a bug, a wrong value or an idea?

In the repository's [issues](https://github.com/slammingprogramming/ksp-commnet-calculator/issues): there are forms
for bugs, data corrections and feature requests. For anything private, and for every security problem, follow
[SECURITY.md](../SECURITY.md); never put a vulnerability in a public issue.
