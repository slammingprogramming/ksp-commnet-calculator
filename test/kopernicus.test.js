// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/parsers.js');
const Data = require('../js/data.js');
const { createWorld } = require('../js/world.js');

const stock = (id) => Data.bodies.find((b) => b.id === id) || null;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} !~ ${b}`);

// Trimmed from the Outer Planets Mod's Neidon.cfg.
const NEIDON = `
@Kopernicus:FOR[OPM]
{
	Body
	{
		name = Neidon
		Template
		{
			name = Jool
		}
		Properties
		{
			radius = 2145000
			geeASL = 0.314
			rotationPeriod = 40250
			tidallyLocked = false
		}
		Orbit
		{
			referenceBody = Sun
			inclination = 1.27
			eccentricity = 0.0127567
			semiMajorAxis = 409355191706
			longitudeOfAscendingNode = 259
			argumentOfPeriapsis = 0
			meanAnomalyAtEpoch = 2.27167344093323
			epoch = 99.6799999999973
		}
		Atmosphere
		{
			enabled = true
			altitude = 260000.0
		}
	}
}`;

test('reads an OPM-style Body: radius, gee -> GM, orbit, atmosphere, Sun -> Kerbol', () => {
  const r = P.parseKopernicus(NEIDON, stock);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.bodies.length, 1);
  const b = r.bodies[0];
  assert.equal(b.id, 'Neidon');
  assert.equal(b.parent, 'Kerbol');
  assert.equal(b.pack, 'custom');
  assert.equal(b.radius, 2145000);
  near(b.gm, 0.314 * 9.80665 * 2145000 * 2145000);
  assert.equal(b.atmo, 260000);
  assert.equal(b.rot, 40250);
  assert.equal(b.orbit.a, 409355191706);
  assert.equal(b.orbit.m0, 2.27167344093323);
  assert.equal(b.orbit.epoch, 99.6799999999973);
});

test('the same numbers as the built-in OPM data', () => {
  const r = P.parseKopernicus(NEIDON, stock).bodies[0];
  const mine = Data.bodies.find((b) => b.id === 'Neidon');
  near(r.gm, mine.gm, 1e-9);
  assert.equal(r.orbit.a, mine.orbit.a);
  assert.equal(r.atmo, mine.atmo);
});

test('Template inheritance fills gaps; mass and gravParameter are understood', () => {
  const cfg = `
Kopernicus
{
	Body
	{
		name = Fake
		Template
		{
			name = Duna
		}
		Properties
		{
			mass = 1e21
		}
		Orbit
		{
			referenceBody = Kerbin
			semiMajorAxis = 50000000
		}
	}
	Body
	{
		name = Fake2
		Properties
		{
			radius = 100000
			gravParameter = 1e10
			tidallyLocked = True
		}
		Orbit
		{
			referenceBody = Fake
			semiMajorAxis = 2000000
		}
	}
}`;
  const r = P.parseKopernicus(cfg, stock);
  assert.equal(r.bodies.length, 2);
  const f = r.bodies[0];
  assert.equal(f.radius, 320000); // from Duna
  assert.equal(f.atmo, 50000); // inherited atmosphere
  near(f.gm, 1e21 * 6.6743e-11);
  assert.equal(r.bodies[1].rot, 'locked');
  assert.equal(r.bodies[1].gm, 1e10);
});

test('incomplete bodies are skipped with a reason', () => {
  const r = P.parseKopernicus('Kopernicus\n{\n\tBody\n\t{\n\t\tname = Broken\n\t\tProperties { radius = 1000 }\n\t}\n}', stock);
  assert.equal(r.bodies.length, 0);
  assert.match(r.warnings[0], /Broken.*missing/);
});

test('@Body patches are returned separately and can move a stock body', () => {
  const cfg = `
@Kopernicus:FOR[X]
{
	%Body[Eeloo]
	{
		%Orbit
		{
			%referenceBody = Jool
			semiMajorAxis = 300000000
			inclination = 3
		}
	}
}`;
  const r = P.parseKopernicus(cfg, stock);
  assert.equal(r.bodies.length, 0);
  assert.equal(r.patches.length, 1);
  assert.equal(r.patches[0].id, 'Eeloo');
  const w = createWorld({ patches: r.patches });
  const e = w.index.get('Eeloo');
  assert.equal(e.parent, 'Jool');
  assert.equal(e.orbit.a, 300000000);
  assert.equal(e.orbit.i, 3);
  assert.equal(e.orbit.e, 0.26, 'unpatched elements are kept');
});

test('imported bodies join the world and get distances', () => {
  const r = P.parseKopernicus(NEIDON, stock);
  const w = createWorld({ extraBodies: r.bodies });
  const n = w.index.get('Neidon');
  assert.ok(n && n.depth === 1);
  const d = w.distanceRange('Kerbin', 'Neidon');
  assert.ok(d.min > 3.8e11 && d.max > 4.2e11);
  assert.ok(n.soiRadius > 1e8);
});
