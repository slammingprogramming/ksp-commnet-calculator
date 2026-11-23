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

// Trimmed from the style of Real Solar System: replaces Kerbin by Earth, gives the mean anomaly in degrees, patches the Sun and scales a radius.
const RSS = `
@Kopernicus:FOR[RealSolarSystem]
{
	Body
	{
		name = Sun
		Properties
		{
			radius = 696342000
			gravParameter = 1.3271244004193938e+20
		}
	}
	Body
	{
		name = Kerbin
		cbNameLater = Earth
		Template
		{
			name = Kerbin
		}
		Orbit
		{
			referenceBody = Sun
			semiMajorAxis = 149598261150.4425
			eccentricity = 0.01609636160505683
			inclination = 23.44603795469773
			meanAnomalyAtEpochD = 357.0607464120944
			longitudeOfAscendingNode = 359.9965004168758
			argumentOfPeriapsis = 102.9720683296131
		}
		Properties
		{
			radius = 6371000
			rotationPeriod = 86164.098903691
			gravParameter = 3.9860043543609598e+14
		}
	}
	Body
	{
		name = Mars
		Template
		{
			name = Duna
		}
		Orbit
		{
			referenceBody = Sun
			semiMajorAxis = 227939366000
			eccentricity = 0.0934
			meanAnomalyAtEpochD = 19.4
		}
		Properties
		{
			radius = 3389500
			rotationPeriod = 88642.6848
			gravParameter = 4.2828375816e13
		}
	}
	@Body[Mars]
	{
		@Properties
		{
			@radius *= 1.1
		}
	}
	@Body:HAS[@Atmosphere]
	{
		%foo = bar
	}
}`;

test('a Real Solar System style pack: degrees, Sun patch, relative radius, MM filters ignored', () => {
  const r = P.parseKopernicus(RSS, stock);
  assert.equal(r.warnings.length, 0);
  assert.deepEqual(r.bodies.map((b) => b.id).sort(), ['Kerbin', 'Mars']);
  const earth = r.bodies.find((b) => b.id === 'Kerbin');
  assert.equal(earth.name, 'Earth');
  near(earth.orbit.m0, (357.0607464120944 * Math.PI) / 180);
  assert.deepEqual(r.patches.map((p) => p.id).sort(), ['Kerbol', 'Mars']);
  near(r.patches.find((p) => p.id === 'Mars').fields.radiusScale, 1.1);
  near(r.patches.find((p) => p.id === 'Kerbol').fields.radius, 696342000);
});

test('a pack that defines its own Kerbin replaces the stock system and switches the calendar to Earth time', () => {
  const r = P.parseKopernicus(RSS, stock);
  const w = createWorld({ extraBodies: r.bodies, patches: r.patches });
  assert.deepEqual(w.bodies.map((b) => b.id).sort(), ['Kerbin', 'Kerbol', 'Mars'].sort());
  near(w.index.get('Kerbin').radius, 6371000);
  near(w.index.get('Mars').radius, 3389500 * 1.1);
  near(w.index.get('Kerbol').radius, 696342000);
  assert.deepEqual(w.calendar, { day: 86400, daysPerYear: 365 });
  // stock keeps the stock calendar
  assert.deepEqual(createWorld({}).calendar, { day: 21600, daysPerYear: 426 });
});

test('a pack body with a stock id but no Kerbin only replaces that body', () => {
  const r = P.parseKopernicus(RSS.replace(/name = Kerbin/, 'name = Duna').replace('cbNameLater = Earth', ''), stock);
  const w = createWorld({ extraBodies: r.bodies.filter((b) => b.id === 'Duna'), patches: [] });
  assert.ok(w.index.has('Mun') && w.index.has('Eve'));
  near(w.index.get('Duna').radius, 6371000);
});

// Written for this test in the shape JNSQ uses: an internal name that differs from the name the game shows, a localisation key as a
// display name, a body built on a gas giant, a rescaled home world and a 12-hour day.
const RESCALED = `
@Kopernicus:FOR[Rescaled]
{
	Body
	{
		name = Kerbin
		Template
		{
			name = Kerbin
		}
		Properties
		{
			displayName = Kerbin^N
			radius = 1600000
			geeASL = 1
			rotationPeriod = 43200
			isHomeWorld = True
		}
		Orbit
		{
			referenceBody = Sun
			semiMajorAxis = 37525647898
			eccentricity = 0.02
		}
	}
	Body
	{
		name = Giant2
		Template
		{
			name = Jool
		}
		Properties
		{
			displayName = Giant^N
			radius = 14000000
			geeASL = 1.04
			rotationPeriod = 90000
		}
		Orbit
		{
			referenceBody = Sun
			semiMajorAxis = 189800000000
			eccentricity = 0.05
		}
	}
	Body
	{
		name = Rock
		Template
		{
			name = Moho
		}
		Properties
		{
			displayName = #LOC_PACK_Rock
			radius = 600000
			geeASL = 0.5
			rotationPeriod = 20000
		}
		Orbit
		{
			referenceBody = Sun
			semiMajorAxis = 94100000000
			eccentricity = 0.1
		}
	}
}`;

test('planet pack with a rescaled home world: display names, gas giants and the calendar', () => {
  const r = P.parseKopernicus(RESCALED, stock);
  assert.deepEqual(r.warnings, []);
  const by = (id) => r.bodies.find((b) => b.id === id);
  assert.equal(by('Giant2').name, 'Giant', 'the name the game shows, not the internal one');
  assert.equal(by('Kerbin').name, 'Kerbin', 'the ^N marker is removed');
  assert.equal(by('Rock').name, 'Rock', 'a localisation key is no name');
  assert.equal(by('Giant2').gas, true, 'built on Jool: nothing to land on');
  assert.ok(!by('Rock').gas && !by('Kerbin').gas);
  const w = createWorld({ extraBodies: r.bodies, patches: r.patches });
  assert.equal(w.index.get('Giant2').gas, true);
  assert.equal(w.bodies.filter((b) => !b.star).length, 3, 'the pack replaces the stock system');
  near(w.index.get('Kerbin').radius, 1600000);
  assert.ok(Math.abs(w.calendar.day - 43200) / 43200 < 0.02, 'a 12-hour home day');
  assert.ok(require('../js/planner.js').isGas(w.index.get('Giant2')));
});

test('a pack body\'s Atmosphere node gives the Reentry and Energy tabs its air', () => {
  const cfg = [
    '@Kopernicus:FOR[Pack]', '{', '  Body', '  {', '    name = Wetworld', '    Template', '    {', '      name = Duna', '    }', '    Properties', '    {', '      radius = 400000', '      geeASL = 0.9', '      rotationPeriod = 30000', '    }',
    '    Orbit', '    {', '      referenceBody = Kerbol', '      semiMajorAxis = 30000000000', '      eccentricity = 0', '    }',
    '    Atmosphere', '    {', '      enabled = True', '      altitude = 50000', '      adiabaticIndex = 1.3', '      atmosphereMolarMass = 0.03', '      shockTemperatureMultiplier = 1.2',
    '      temperatureCurve', '      {', '        key = 0 300 0 -0.002', '        key = 50000 200 0 0', '      }',
    '      pressureCurve', '      {', '        key = 0 200 0 -0.003', '        key = 25000 20 -0.0003 -0.0003', '        key = 50000 0 0 0', '      }', '    }', '  }', '}',
  ].join('\n');
  const r = P.parseKopernicus(cfg, stock);
  assert.equal(r.bodies.length, 1, r.warnings.join('; '));
  const at = r.bodies[0].atmosphere;
  assert.ok(at, 'the curves were read');
  assert.equal(at.depth, 50000);
  assert.equal(at.molarMass, 0.03);
  assert.equal(at.gamma, 1.3);
  assert.equal(at.shock, 1.2);
  assert.deepEqual(at.temp[0], [0, 300, 0, -0.002]);
  assert.equal(at.pressure.length, 3);
  // it flows into the world and the reentry module: the pack's air, not Duna's
  const world = createWorld({ extraBodies: r.bodies });
  const b = world.index.get('Wetworld');
  assert.equal(b.atmosphere.depth, 50000);
  const R = require('../js/reentry.js');
  R.usePack({ Wetworld: b.atmosphere });
  try {
    assert.ok(R.hasAtmosphere('Wetworld'));
    const a = R.air('Wetworld', 0);
    near(a.pressure, 200, 1e-9);
    assert.ok(a.density > 2 && a.density < 4, 'dense air: ' + a.density);
  } finally { R.usePack({}); }
  assert.ok(!R.hasAtmosphere('Wetworld'), 'gone again once the pack is off');
});
