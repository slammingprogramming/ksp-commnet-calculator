// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/parsers.js');

// Trimmed from the stock RA-100 part config (KSP 1.12.5).
const RA100 = `
PART
{
	name = RelayAntenna100
	module = Part
	cost = 3000
	title = #autoLOC_500001 //#autoLOC_500001 = RA-100 Relay Antenna
	mass = 0.65
	TechRequired = automation
	MODULE
	{
		name = ModuleDeployableAntenna
		animationName = deploy
	}
	MODULE
	{
		name = ModuleDataTransmitter
		antennaType = RELAY
		packetInterval = 0.35
		packetSize = 4
		packetResourceCost = 24.0
		requiredResource = ElectricCharge
		antennaPower = 100000000000
		antennaCombinable = True
	}
}
`;

test('parses a stock relay antenna cfg', () => {
  const a = P.parseAntennaCfg(RA100);
  assert.equal(a.length, 1);
  assert.equal(a[0].partName, 'RelayAntenna100');
  assert.equal(a[0].name, 'RA-100 Relay Antenna');
  assert.equal(a[0].type, 'relay');
  assert.equal(a[0].power, 100e9);
  assert.equal(a[0].combinable, true);
  assert.equal(a[0].exp, 0.75); // default exponent
  assert.equal(a[0].mass, 0.65);
  assert.equal(a[0].cost, 3000);
  assert.equal(a[0].tech, 'automation');
  assert.equal(a[0].pktSize, 4);
  assert.equal(a[0].ground, false);
});

test('honours antennaCombinable = False and explicit exponents', () => {
  const cfg = `
PART
{
 name = a1
 MODULE
 {
  name = ModuleDataTransmitter
  antennaType = DIRECT
  antennaPower = 500000
  antennaCombinable = False
 }
}
PART
{
 name = a2
 MODULE
 {
  name = ModuleDataTransmitter
  antennaType = DIRECT
  antennaPower = 500000
  antennaCombinable = True
  antennaCombinableExponent = 1
 }
}`;
  const a = P.parseAntennaCfg(cfg);
  assert.equal(a.length, 2);
  assert.equal(a[0].combinable, false);
  assert.equal(a[0].exp, 0);
  assert.equal(a[1].exp, 1);
});

test('ignores internal antennas and parts without a transmitter', () => {
  const cfg = `
PART
{
 name = pod
 MODULE
 {
  name = ModuleDataTransmitter
  antennaType = INTERNAL
  antennaPower = 5000
 }
}
PART
{
 name = tank
}`;
  assert.equal(P.parseAntennaCfg(cfg).length, 0);
});

test('flags ground-station antennas', () => {
  const cfg = `
PART
{
 name = DeployedSatDish
 title = #autoLOC_6012019 //#autoLOC_6012019 = Communotron Ground HG-48
 MODULE
 {
  name = ModuleGroundCommsPart
  antennaType = DIRECT
  antennaPower = 10000000000
  antennaCombinable = True
 }
}`;
  const a = P.parseAntennaCfg(cfg);
  assert.equal(a[0].ground, true);
  assert.equal(a[0].name, 'Communotron Ground HG-48');
});

const SAVE = `GAME
{
	version = 1.12.5
	Title = Test (CAREER)
	Mode = CAREER
	PARAMETERS
	{
		CommNetParams
		{
			requireSignalForControl = True
			plasmaBlackout = False
			rangeModifier = 0.8
			DSNModifier = 1
			occlusionMultiplierVac = 1
			occlusionMultiplierAtm = 0.85
			enableGroundStations = False
		}
	}
	SCENARIO
	{
		name = ScenarioUpgradeableFacilities
		SpaceCenter/TrackingStation
		{
			lvl = 0.5
		}
	}
	FLIGHTSTATE
	{
		VESSEL
		{
			name = Relay One
			type = Relay
			PART
			{
				name = probeCoreOcto_v2
			}
			PART
			{
				name = RelayAntenna50
			}
			PART
			{
				name = HighGainAntenna5.v2
			}
		}
	}
}`;

test('reads difficulty, tracking station level and vessels from a save', () => {
  const s = P.parseSave(SAVE);
  assert.equal(s.mode, 'CAREER');
  assert.equal(s.params.rangeModifier, 0.8);
  assert.equal(s.params.dsnModifier, 1);
  assert.equal(s.params.occlusionAtm, 0.85);
  assert.equal(s.params.requireSignalForControl, true);
  assert.equal(s.params.enableGroundStations, false);
  assert.equal(s.trackingStationLevel, 2);
  assert.equal(s.vessels.length, 1);
  assert.equal(s.vessels[0].name, 'Relay One');
  assert.deepEqual(s.vessels[0].parts, { probeCoreOcto_v2: 1, RelayAntenna50: 1, HighGainAntenna5_v2: 1 });
});

test('sandbox saves default to Tracking Station level 3', () => {
  const s = P.parseSave('GAME\n{\n\tMode = SANDBOX\n}\n');
  assert.equal(s.trackingStationLevel, 3);
});

test('rejects text that is not a save', () => {
  assert.equal(P.parseSave('hello'), null);
});

test('reads vessel orbits, landed positions and the save time', () => {
  const save = `GAME
{
	Mode = CAREER
	FLIGHTSTATE
	{
		UT = 1987129.5
		VESSEL
		{
			name = Relay A
			type = Relay
			sit = ORBITING
			lat = 0.5
			lon = 100
			alt = 84572.28
			ORBIT
			{
				SMA = 686064.69
				ECC = 0.0069
				INC = 0.0186
				LPE = 9.03
				LAN = 353.85
				MNA = 6.2018
				EPH = 1610247.8
				REF = 1
			}
			PART
			{
				name = RelayAntenna50
			}
		}
		VESSEL
		{
			name = Mun Lander
			type = Ship
			sit = LANDED
			lat = -3.2
			lon = 40.5
			alt = 1949.4
			ORBIT
			{
				SMA = 0
				ECC = 1
				REF = 2
			}
		}
	}
}`;
  const s = P.parseSave(save);
  assert.equal(s.ut, 1987129.5);
  assert.equal(s.vessels.length, 2);
  assert.deepEqual(s.vessels[0].orbit, { sma: 686064.69, ecc: 0.0069, inc: 0.0186, lpe: 9.03, lan: 353.85, mna: 6.2018, eph: 1610247.8, ref: 1 });
  assert.equal(s.vessels[0].sit, 'ORBITING');
  assert.equal(s.vessels[1].sit, 'LANDED');
  assert.equal(s.vessels[1].lat, -3.2);
  assert.equal(s.vessels[1].orbit.ref, 2);
});
