// SPDX-License-Identifier: AGPL-3.0-or-later
/* Static game data: antennas, DSN levels, difficulty presets, celestial bodies and ground stations.
 *
 * Provenance (all checked 2026-09-29):
 *  - Stock and Breaking Ground antennas: KSP 1.12.5 part configs (GameData/Squad, GameData/SquadExpansion).
 *  - Mod antennas: read from each mod's current part configs on GitHub (see PACKS[].source).
 *  - Stock bodies: KSP Wiki body infoboxes (elements, radius, GM, rotation, atmosphere).
 *  - Outer Planets Mod bodies: OPM's Kopernicus configs (Poodmund/Outer-Planets-Mod).
 *  - CommNet ground stations: KSP Wiki "List of bases on Kerbin"; which exist when is from the game's CommNetHome.CreateNode IL.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KSPData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GAME_VERSION = '1.12.5';
  const APP_VERSION = '1.3.0'; // keep equal to package.json (a test checks it)

  const TECH = {
    start: 'Start',
    basicRocketry: 'Basic Rocketry',
    engineering101: 'Engineering 101',
    basicScience: 'Basic Science',
    survivability: 'Survivability',
    flightControl: 'Flight Control',
    precisionEngineering: 'Precision Engineering',
    electrics: 'Electrics',
    miniaturization: 'Miniaturization',
    spaceExploration: 'Space Exploration',
    advFlightControl: 'Advanced Flight Control',
    unmannedTech: 'Unmanned Tech',
    electronics: 'Electronics',
    advUnmanned: 'Advanced Unmanned Tech',
    automation: 'Automation',
    largeUnmanned: 'Large Probes',
    largeElectrics: 'High-Power Electrics',
    advElectrics: 'Advanced Electrics',
    advConstruction: 'Advanced Construction',
    advScienceTech: 'Advanced Science Tech',
    specializedConstruction: 'Specialized Construction',
    composites: 'Composites',
    scienceTech: 'Science Tech',
  };

  const PACKS = [
    { id: 'stock', name: 'Stock', verified: true, defaultOn: true, source: 'KSP 1.12.5 part configs' },
    { id: 'bg', name: 'Breaking Ground (ground stations)', verified: true, defaultOn: true, source: 'KSP 1.12.5 part configs' },
    { id: 'restock', name: 'ReStock+', verified: true, defaultOn: false, source: 'github.com/PorktoberRevolution/ReStocked (RestockPlus)' },
    { id: 'nfe', name: 'Near Future Exploration', verified: true, defaultOn: false, source: 'github.com/post-kerbin-mining-corporation/NearFutureExploration' },
    { id: 'cae', name: 'CommNet Antennas Extension', verified: true, defaultOn: false, source: 'github.com/yalov/CommNetAntennasExtension' },
    { id: 'dmagic', name: 'DMagic Orbital Science', verified: true, defaultOn: false, source: 'github.com/DMagic1/Orbital-Science' },
    { id: 'jx2', name: 'JX2Antenna', verified: true, defaultOn: false, source: 'github.com/KSPSnark/JX2Antenna' },
    { id: 'probesplus', name: 'ProbesPlus', verified: true, defaultOn: false, source: 'github.com/raveloda/Coatl-Aerospace' },
  ];

  // [pack, name, parts, type, power, exp, mass t, cost, tech, packetSize Mit, packetInterval s, packetEC, flags]
  // exp 0 means "does not combine". type: direct | relay | internal
  const ROWS = [
    ['stock', 'Built-in antenna (command pods, probe cores)', ['builtin'], 'internal', 5e3, 0, 0, 0, '', 2, 1, 12, { builtin: true }],
    ['stock', 'MPO Probe built-in relay', ['MpoProbe'], 'relay', 2e9, 0.75, 0, 0, '', 1, 0.35, 24, { builtin: true }],
    ['stock', 'Communotron 16', ['longAntenna'], 'direct', 5e5, 1, 0.005, 300, 'engineering101', 2, 0.6, 12],
    ['stock', 'Communotron 16-S', ['SurfAntenna'], 'direct', 5e5, 0, 0.015, 300, 'engineering101', 2, 0.6, 12],
    ['stock', 'HG-5 High Gain Antenna', ['HighGainAntenna5', 'HighGainAntenna5_v2'], 'relay', 5e6, 0.75, 0.07, 600, 'basicScience', 2, 0.35, 18],
    ['stock', 'Communotron DTS-M1', ['mediumDishAntenna'], 'direct', 2e9, 0.75, 0.05, 900, 'precisionEngineering', 2, 0.35, 12],
    ['stock', 'RA-2 Relay Antenna', ['RelayAntenna5'], 'relay', 2e9, 0.75, 0.15, 1800, 'precisionEngineering', 1, 0.35, 24],
    ['stock', 'Communotron HG-55', ['HighGainAntenna'], 'direct', 15e9, 0.75, 0.075, 1200, 'electronics', 3, 0.15, 20],
    ['stock', 'RA-15 Relay Antenna', ['RelayAntenna50'], 'relay', 15e9, 0.75, 0.3, 2400, 'electronics', 2, 0.35, 24],
    ['stock', 'Communotron 88-88', ['commDish'], 'direct', 100e9, 0.75, 0.1, 1500, 'automation', 2, 0.1, 20],
    ['stock', 'RA-100 Relay Antenna', ['RelayAntenna100'], 'relay', 100e9, 0.75, 0.65, 3000, 'automation', 4, 0.35, 24],

    // Breaking Ground: only work on a deployed Experiment Control Station. Packet data is unknown (0).
    ['bg', 'Experiment Control Station', ['DeployedCentralStation'], 'direct', 5e5, 1, 0.05, 800, '', 0, 0, 0, { ground: true }],
    ['bg', 'Communotron Ground HG-48', ['DeployedSatDish'], 'direct', 10e9, 0.75, 0.035, 1000, 'electronics', 0, 0, 0, { ground: true }],

    // ReStock+
    ['restock', 'HG-20 High Gain Antenna (ReStock+)', ['restock-relay-radial-2', 'restock-relay-radial-2_v2'], 'relay', 2e7, 0.75, 0.18, 1000, 'electrics', 2, 0.35, 40],
    ['restock', 'Communotron DTS-J1', ['restock-antenna-stack-2'], 'direct', 2e9, 0.75, 0.055, 900, 'precisionEngineering', 2, 0.35, 10],
    ['restock', 'Communotron HG-61', ['restock-antenna-stack-3'], 'direct', 15e9, 0.75, 0.06, 999, 'electronics', 3, 0.15, 20],

    // CommNet Antennas Extension (it patches RemoteTech's part names)
    ['cae', 'C2 Communotron EXP-VR-2T', ['RTLongAntenna3'], 'direct', 5e6, 1, 0.02, 400, 'basicScience', 2, 0.3, 16],
    ['cae', 'C2+ High Gain Antenna HG-32', ['caeDeployableAntenna'], 'relay', 3.2e7, 0.75, 0.11, 1200, 'electrics', 2, 0.35, 24],
    ['cae', 'C3+ Relay Antenna RA-7', ['RTShortDish2'], 'relay', 7e9, 0.75, 0.21, 2000, 'unmannedTech', 1, 0.35, 16],
    ['cae', 'C4+ Relay Antenna RA-25', ['RTLongDish2'], 'relay', 2.5e10, 0.75, 0.4, 2600, 'advUnmanned', 3, 0.35, 30],
    ['cae', 'C5+ Communotron "Tigger"', ['RTGigaDish1'], 'direct', 5e11, 1, 0.5, 2000, 'largeUnmanned', 2, 0.1, 28],
    ['cae', 'C5+ RelayTech One', ['RTGigaDish2'], 'relay', 5e11, 1, 1.5, 4000, 'largeUnmanned', 5, 0.35, 24],

    // DMagic Orbital Science: SIGINT dishes are relays, 10x stronger than older community listings.
    ['dmagic', 'Undersize Signals Intelligence Satellite', ['dmSIGINT.Small'], 'relay', 1e12, 0.75, 1, 7000, 'miniaturization', 2, 0.1, 25],
    ['dmagic', 'Oversize Signals Intelligence Satellite', ['dmSIGINT', 'dmSIGINT.End'], 'relay', 1e13, 0.75, 4, 14000, 'electronics', 4, 0.08, 55],
    // The Soil Moisture Sensor doubles as a 100G relay (found by scripts/check-mod-data.js, 2026-11-21). Its Universal Storage variant is not researchable and is left out.
    ['dmagic', 'Soil Moisture Sensor', ['dmSoilMoisture'], 'relay', 1e11, 0.75, 0.04, 4500, 'largeElectrics', 4, 0.2, 30],

    // JX2Antenna
    ['jx2', 'JU1 Medium Deployable Antenna', ['ju1MDA'], 'relay', 3e11, 0.75, 1.2, 18000, 'largeUnmanned', 4, 0.35, 22],
    ['jx2', 'JW1 Medium Deployable Antenna', ['jw1MDA'], 'direct', 3e11, 0.75, 0.35, 9000, 'largeUnmanned', 4, 0.35, 18],
    ['jx2', 'JX2 Large Deployable Antenna', ['jx2LDA'], 'relay', 1e12, 0.75, 3.5, 30000, 'largeUnmanned', 4, 0.35, 22],

    // ProbesPlus
    ['probesplus', 'CA-KPS KerbNet Position System Antenna', ['ca_ant_gps'], 'direct', 4e5, 1, 0.009, 300, 'flightControl', 2, 0.6, 12],
    ['probesplus', 'CA-A01 Ground Plane Antenna', ['antenna_tv'], 'direct', 5e5, 1, 0.005, 280, 'engineering101', 2, 0.6, 12],
    ['probesplus', 'CA-A06 Quetzal Omni Antenna', ['antenna_quetzal'], 'direct', 5e5, 0, 0.005, 100, 'flightControl', 2, 0.6, 12],
    ['probesplus', 'CA-A02 Conic Antenna', ['antenna_cone_toggle'], 'direct', 5.5e5, 0, 0.005, 320, 'engineering101', 2.2, 0.6, 12],
    ['probesplus', 'CA-AMA Argo Mast Assembly', ['ca_argo-mk2-mast'], 'direct', 8e5, 1, 0.03, 1200, 'engineering101', 2, 0.6, 12],
    ['probesplus', 'CA-AMA2 Argo Mast Assembly', ['ca_argo-mk4-mast'], 'direct', 8e5, 1, 0.02, 100, 'advFlightControl', 2, 0.6, 12],
    ['probesplus', 'CAE-A03 Vorona Communication Array', ['ca_vor_comm'], 'direct', 9.6e5, 0, 0.012, 300, 'engineering101', 2.2, 0.6, 12],
    ['probesplus', 'CA-AD1-R Small Folding Relay Antenna', ['dish_deploy_S2'], 'relay', 2.5e6, 0.75, 0.1, 300, 'engineering101', 2, 0.35, 18],
    ['probesplus', 'CA-A10 Small Folding Relay Antenna', ['dish_deploy_S'], 'relay', 5e6, 0.75, 0.055, 500, 'precisionEngineering', 2, 0.35, 18],
    ['probesplus', 'CA-D02 Medium Folding Relay Antenna', ['dish_xihe'], 'relay', 1e7, 0.75, 0.075, 580, 'precisionEngineering', 2, 0.35, 18],
    ['probesplus', 'CAE-102 Vorona Dish Antenna', ['ca_vor_dish'], 'relay', 3e9, 0.75, 0.1, 420, 'advConstruction', 1, 0.35, 24],
    ['probesplus', 'CA-A100 Small Dish Antenna', ['dish_S'], 'direct', 2.5e9, 0.75, 0.15, 500, 'miniaturization', 1, 0.35, 24],
    ['probesplus', 'CA-ED3 Argo Dish Antenna', ['ca_argo-mk2-hga'], 'direct', 9e9, 0.75, 0.1, 700, 'basicScience', 2, 0.35, 12],
    ['probesplus', 'CA-ED3b Argo Mk3 Dish Antenna', ['ca_argo-mk3-hga'], 'direct', 9e9, 0.75, 0.1, 710, 'flightControl', 2, 0.35, 12],
    ['probesplus', 'CA-RDA67 Argo Mk4 Dish Antenna', ['ca_argo-mk4-hga'], 'relay', 9.8e9, 0.75, 0.1, 920, 'advFlightControl', 2.5, 0.35, 12],
    ['probesplus', 'CA-A180 Tatsujin Relay Antenna', ['dish_tatsujin'], 'relay', 1.5e10, 0.75, 0.22, 850, 'advScienceTech', 2.2, 0.35, 24],
    ['probesplus', 'CA-A190 Hera Dish Antenna', ['dish_hera'], 'relay', 3e10, 0.75, 0.29, 900, 'advScienceTech', 2.2, 0.35, 24],
    ['probesplus', 'CA-A200 Quetzal Relay Antenna', ['dish_quetzal'], 'relay', 5e10, 0.75, 0.36, 670, 'advConstruction', 2, 0.35, 24],
    ['probesplus', 'CA-A300 Torekka Relay Antenna', ['dish_L'], 'relay', 1e11, 0.75, 0.6, 2150, 'specializedConstruction', 4, 0.35, 24],
    ['probesplus', 'CA-MER-A400 Meridiani Dish Antenna', ['mer_dish'], 'relay', 1e11, 0.75, 0.5, 3780, 'composites', 4, 0.35, 24],
    // Probes Plus parts with an integrated antenna (matched when importing saves; not offered by the finder).
    ['probesplus', 'CA-L1200 Draco lander (integrated)', ['ca_draco'], 'direct', 5.5e5, 0, 0, 0, '', 2.2, 0.6, 5, { builtin: true }],
    // Landvermesser antennas, added after scripts/check-mod-data.js found them upstream (2026-11-21).
    ['probesplus', 'CA-AE20 HGA Antenna and Solar Panel', ['ca_landv_hga'], 'direct', 1e6, 0.75, 0.035, 500, 'engineering101', 2, 0.35, 12],
    ['probesplus', 'CA-A07 Landvermesser Omni Antenna', ['ca_landv_omni'], 'direct', 5.05e5, 1, 0.007, 150, 'engineering101', 2, 0.6, 12],
    ['probesplus', 'CA-A20-B HGA Antenna', ['ca_landv_orbiter_HGA'], 'direct', 1e6, 0.75, 0.022, 400, 'engineering101', 2, 0.35, 12],
    ['probesplus', 'CAE-L165 Fomalhaut lander (integrated)', ['ca_fom_lander'], 'direct', 5.5e5, 0, 0, 0, '', 2.2, 0.6, 6, { builtin: true }],
    ['probesplus', 'CA-MER-LEU Meridiani equipment (integrated)', ['ca_mer_leu'], 'direct', 5.5e5, 0, 0, 0, '', 2.2, 0.6, 12, { builtin: true }],
    ['probesplus', 'CA-T8E Explorer telescope (integrated)', ['ca_explorer'], 'direct', 5.5e5, 0, 0, 0, '', 2.2, 0.6, 12, { builtin: true }],
    ['probesplus', 'CAE-SAR15 Radar (integrated)', ['ca_vor_sar'], 'direct', 9.6e5, 0, 0, 0, '', 2.2, 0.6, 12, { builtin: true }],

    // Near Future Exploration (feeds and reflectors: the reflector mechanic isn't modelled)
    ['nfe', 'F-DA Direct Antenna Feed', ['nfex-antenna-feeder-direct-1'], 'direct', 5e3, 0.5, 0.006, 210, 'precisionEngineering', 2, 0.6, 24],
    ['nfe', 'AX-4 Pointable Helical Antenna', ['nfex-antenna-rover-1'], 'direct', 4e4, 0.75, 0.095, 250, 'engineering101', 2, 0.75, 8],
    ['nfe', 'PH-1 Phased Array Antenna Element', ['nfex-antenna-phased-single-1'], 'direct', 1.25e5, 1, 0.005, 350, 'miniaturization', 2, 0.4, 14],
    ['nfe', 'AX-5 Aerial Micro-Antenna', ['nfex-antenna-rover-2'], 'direct', 1.5e5, 0.75, 0.005, 340, 'basicScience', 2, 0.75, 8],
    ['nfe', 'PH-2 Phased Array Antenna Element', ['nfex-antenna-phased-single-2'], 'direct', 2e5, 1, 0.0075, 390, 'precisionEngineering', 2, 0.4, 14],
    ['nfe', 'AX-30 High Gain Micro-Antenna', ['nfex-antenna-rover-3'], 'direct', 3e5, 0.75, 0.01, 500, 'miniaturization', 2, 0.65, 10],
    ['nfe', 'DR-1 High Gain Antenna', ['nfex-antenna-static-mini-1'], 'direct', 3e5, 0.75, 0.01, 320, 'basicScience', 2, 0.25, 10],
    ['nfe', 'DR-3 Deployable High Gain Antenna', ['nfex-antenna-deploy-wv3-1'], 'direct', 5e5, 0.75, 0.02, 650, 'spaceExploration', 4, 0.25, 12],
    ['nfe', 'PH-3 Phased Array Antenna Element', ['nfex-antenna-phased-single-3'], 'direct', 8e5, 1, 0.0075, 420, 'unmannedTech', 3, 0.4, 20],
    ['nfe', 'D-2 Spot Antenna', ['nfex-antenna-top-dish-1'], 'direct', 2e6, 0.75, 0.04, 650, 'precisionEngineering', 1, 0.1, 6],
    ['nfe', 'D-50 Large Spot Antenna', ['nfex-antenna-top-dish-2'], 'direct', 5e7, 0.75, 0.09, 800, 'unmannedTech', 2, 0.1, 6],
    ['nfe', 'F-RA Relay Antenna Feed', ['nfex-antenna-feeder-relay-1'], 'relay', 5e3, 0.5, 0.009, 500, 'precisionEngineering', 2, 0.6, 24],
    ['nfe', 'RA-00-2 Micro-Relay Antenna', ['nfex-antenna-relay-tiny-1'], 'relay', 2e6, 0.75, 0.09, 300, 'miniaturization', 1, 0.35, 24],
    ['nfe', 'RA-X1 Phased Relay Antenna', ['nfex-antenna-phased-array-1'], 'relay', 6e6, 0.25, 0.06, 600, 'precisionEngineering', 3, 0.5, 20],
    ['nfe', 'RA-X2 Phased Relay Antenna', ['nfex-antenna-phased-array-2'], 'relay', 1e7, 0.25, 0.09, 725, 'unmannedTech', 6, 0.5, 35],
    ['nfe', 'RA-0-8 Relay Antenna', ['nfex-antenna-relay-tdrs-1'], 'relay', 8.5e7, 0.75, 0.13, 300, 'precisionEngineering', 2, 0.35, 24],
    ['nfe', 'RA-X3 Phased Relay Antenna', ['nfex-antenna-phased-array-3'], 'relay', 1e8, 0.25, 0.54, 850, 'advUnmanned', 8, 0.5, 45],
    ['nfe', 'RA-5B Advanced Relay Antenna', ['nfex-antenna-relay-tdrs-2'], 'relay', 5e8, 0.75, 0.2, 300, 'unmannedTech', 3, 0.6, 28],
  ];

  /* Near Future Exploration reflectors (Source/ModuleAntennaFeed.cs, ModuleDeployableReflector.cs): a deployed reflector that
   * a feed points at adds AddedRange x FeedScale to that antenna's power. FEED_SCALE comes from the mod's part configs and its
   * stock / ReStock+ patches (parts without an entry have no feed). Pointing is a build decision: the user ticks it per antenna. */
  const FEED_SCALE = {
    'longAntenna': 0.9, 'commDish': 0.9, 'RelayAntenna5': 0.9, 'RelayAntenna50': 0.9, 'RelayAntenna100': 0.9,
    'restock-antenna-stack-2': 0.9, 'restock-antenna-stack-3': 0.9,
    'nfex-antenna-deploy-wv3-1': 0.9, 'nfex-antenna-feeder-direct-1': 1, 'nfex-antenna-feeder-relay-1': 1,
    'nfex-antenna-phased-array-1': 0.75, 'nfex-antenna-phased-array-2': 0.75, 'nfex-antenna-phased-array-3': 0.75,
    'nfex-antenna-phased-single-1': 0.9, 'nfex-antenna-phased-single-2': 0.9, 'nfex-antenna-phased-single-3': 0.9,
    'nfex-antenna-relay-tdrs-1': 0.5, 'nfex-antenna-relay-tdrs-2': 0.5, 'nfex-antenna-relay-tiny-1': 0.5,
    'nfex-antenna-rover-1': 0.5, 'nfex-antenna-rover-2': 0.5, 'nfex-antenna-rover-3': 0.5,
    'nfex-antenna-static-mini-1': 0.9, 'nfex-antenna-top-dish-1': 0.9, 'nfex-antenna-top-dish-2': 0.9,
  };
  // [id, name, AddedRange, mass t, cost, tech]
  const REFLECTORS = [
    ['nfe:reflector-side-1', 'RFL-1 Dish Reflector', 9e6, 0.1, 400, 'precisionEngineering'],
    ['nfe:reflector-side-2', 'RFL-2 Medium Dish Reflector', 7.5e7, 0.25, 800, 'electronics'],
    ['nfe:reflector-side-3', 'RFL-3 Dish Reflector Array', 8.5e8, 0.45, 1300, 'automation'],
    ['nfe:reflector-large-1', 'RFL-50 Large Dish Reflector', 9e9, 0.4, 1800, 'advUnmanned'],
    ['nfe:reflector-huge-1', 'RFL-100 Giant Dish Reflector', 1e11, 0.7, 2400, 'largeUnmanned'],
    ['nfe:reflector-giant-1', 'RFL-2000 Dish Reflector Array', 5e12, 1.1, 3600, 'largeUnmanned'],
  ].map((r) => ({ id: r[0], name: r[1], bonus: r[2], mass: r[3], cost: r[4], tech: r[5] }));

  const antennas = ROWS.map(function (r) {
    const flags = r[12] || {};
    const pack = PACKS.find((p) => p.id === r[0]);
    return {
      id: r[0] + ':' + r[2][0],
      pack: r[0],
      name: r[1],
      parts: r[2],
      type: r[3],
      power: r[4],
      exp: r[5],
      combinable: r[5] > 0,
      mass: r[6],
      cost: r[7],
      tech: r[8],
      pktSize: r[9],
      pktInterval: r[10],
      pktEC: r[11],
      builtin: !!flags.builtin,
      feed: r[2].reduce((f, p) => f || FEED_SCALE[p] || 0, 0),
      ground: !!flags.ground,
      verified: !!(pack && pack.verified),
    };
  });

  const DSN_LEVELS = [
    { level: 1, power: 2e9, label: 'Level 1 (2 G)' },
    { level: 2, power: 50e9, label: 'Level 2 (50 G)' },
    { level: 3, power: 250e9, label: 'Level 3 (250 G)' },
  ];

  // Wiki difficulty table. Easy has CommNet disabled. occVac / occAtm scale each body's blocking size.
  const DIFFICULTY_PRESETS = [
    { id: 'normal', name: 'Normal', range: 1, dsn: 1, occVac: 0.9, occAtm: 0.75 },
    { id: 'moderate', name: 'Moderate', range: 0.8, dsn: 1, occVac: 1, occAtm: 0.85 },
    { id: 'hard', name: 'Hard', range: 0.65, dsn: 1, occVac: 1, occAtm: 1 },
  ];

  /* ---------------- celestial bodies ----------------
   * Orbits are about the parent, in one shared reference frame (KSP has no axial tilts, so every
   * equator lies in the reference plane). a: semi-major axis (m), e, i / lan / w in degrees,
   * m0: mean anomaly at `epoch` (rad, 3.14 not pi: that is what the game files use), epoch in UT seconds.
   * rot: sidereal rotation period (s; Kerbin's 21549.4 s is the game's 21600 s solar day converted), or 'locked'. atmo: atmosphere height (m).
   * rot0: the game's initialRotation (deg) at UT 0, read from the 1.12.5 body prefabs. For a tidally locked moon the spin
   * period is its orbital period, so rot0 fixes which side faces the parent (the Mun's sub-Kerbin longitude comes out at
   * 47.4 E). Bodies without rot0 (other planet packs) fall back to subParentLon / an approximation.
   */
  const G0 = 9.80665; // standard gravity: GM = geeASL * 9.80665 * radius^2 (read from the game: this ratio is exact for every stock body)
  const orb = (a, e, i, lan, w, m0, epoch) => ({ a: a, e: e, i: i, lan: lan, w: w, m0: m0, epoch: epoch || 0 });
  const gmFromGee = (gee, radius) => gee * G0 * radius * radius;

  // [id, name, parent, pack, radius, gm, atmo, rot, orbit, extra]
  const BODY_ROWS = [
    ['Kerbol', 'Kerbol', null, 'stock', 261600000, 1.1723328e18, 600000, 432000, null, { star: true }],
    ['Moho', 'Moho', 'Kerbol', 'stock', 250000, 1.6860938e11, 0, 1210000, orb(5263138304, 0.2, 7, 70, 15, 3.14), { rot0: 190 }],
    ['Eve', 'Eve', 'Kerbol', 'stock', 700000, 8.1717302e12, 90000, 80500, orb(9832684544, 0.01, 2.1, 15, 0, 3.14), { rot0: 0 }],
    ['Gilly', 'Gilly', 'Eve', 'stock', 13000, 8289449.8, 0, 28255, orb(31500000, 0.55, 12, 80, 10, 0.9), { rot0: 5 }],
    ['Kerbin', 'Kerbin', 'Kerbol', 'stock', 600000, 3.5316e12, 70000, 21549.425, orb(13599840256, 0, 0, 0, 0, 3.14), { rot0: 90 }],
    ['Mun', 'Mun', 'Kerbin', 'stock', 200000, 6.5138398e10, 0, 'locked', orb(12000000, 0, 0, 0, 0, 1.7), { rot0: 230 }],
    ['Minmus', 'Minmus', 'Kerbin', 'stock', 60000, 1.7658e9, 0, 40400, orb(47000000, 0, 6, 78, 38, 0.9), { rot0: 230 }],
    ['Duna', 'Duna', 'Kerbol', 'stock', 320000, 3.0136321e11, 50000, 65517.859, orb(20726155264, 0.051, 0.06, 135.5, 0, 3.14), { rot0: 90 }],
    ['Ike', 'Ike', 'Duna', 'stock', 130000, 1.8568369e10, 0, 'locked', orb(3200000, 0.03, 0.2, 0, 0, 1.7), { rot0: 0 }],
    ['Dres', 'Dres', 'Kerbol', 'stock', 138000, 2.1484489e10, 0, 34800, orb(40839348203, 0.145, 5, 280, 90, 3.14), { rot0: 25 }],
    ['Jool', 'Jool', 'Kerbol', 'stock', 6000000, 2.82528e14, 200000, 36000, orb(68773560320, 0.05, 1.304, 52, 0, 0.1), { rot0: 0 }],
    ['Laythe', 'Laythe', 'Jool', 'stock', 500000, 1.962e12, 50000, 'locked', orb(27184000, 0, 0, 0, 0, 3.14), { rot0: 90 }],
    ['Vall', 'Vall', 'Jool', 'stock', 300000, 2.074815e11, 0, 'locked', orb(43152000, 0, 0, 0, 0, 0.9), { rot0: 0 }],
    ['Tylo', 'Tylo', 'Jool', 'stock', 600000, 2.82528e12, 0, 'locked', orb(68500000, 0, 0.025, 0, 0, 3.14), { rot0: 0 }],
    ['Bop', 'Bop', 'Jool', 'stock', 65000, 2.4868349e9, 0, 'locked', orb(128500000, 0.235, 15, 10, 25, 0.9), { rot0: 230 }],
    ['Pol', 'Pol', 'Jool', 'stock', 44000, 7.2170208e8, 0, 'locked', orb(179890000, 0.17085, 4.25, 2, 15, 0.9), { rot0: 25 }],
    ['Eeloo', 'Eeloo', 'Kerbol', 'stock', 210000, 7.4410815e10, 0, 19460, orb(90118820000, 0.26, 6.15, 50, 260, 3.14),
      // With Outer Planets Mod installed, Eeloo is moved to orbit Sarnus.
      { rot0: 25, opm: { parent: 'Sarnus', rot: 'locked', orbit: orb(19105978, 0.0034, 2.3, 55, 260, 3.14) } }],

    // Outer Planets Mod (Kopernicus configs; gm from geeASL)
    ['Sarnus', 'Sarnus', 'Kerbol', 'opm', 5300000, gmFromGee(0.298, 5300000), 580000, 28500, orb(125798522368, 0.0534, 2.02, 184, 0, 2.88114666938782, 359.279999999964)],
    ['Hale', 'Hale', 'Sarnus', 'opm', 6000, gmFromGee(0.0023, 6000), 0, 'locked', orb(10488231, 0, 1, 55, 0, 0, 0), { soi: 41000 }],
    ['Ovok', 'Ovok', 'Sarnus', 'opm', 26000, gmFromGee(0.002, 26000), 0, 'locked', orb(12169413, 0.01, 1.5, 55, 0, 1.72, 751.7), { soi: 94000 }],
    ['Slate', 'Slate', 'Sarnus', 'opm', 540000, gmFromGee(0.692, 540000), 0, 'locked', orb(42592946, 0.04, 2.3, 55, 0, 1.1, 1343.91)],
    ['Tekto', 'Tekto', 'Sarnus', 'opm', 280000, gmFromGee(0.2503, 280000), 95000, 'locked', orb(97355304, 0.028, 9.4, 55, 0, 2.1, 1275.12)],
    ['Urlum', 'Urlum', 'Kerbol', 'opm', 2177000, gmFromGee(0.257, 2177000), 325000, 41000, orb(254317012787, 0.045214674, 0.64, 61, 0, 5.59607362747192, 422.539999999906)],
    ['Polta', 'Polta', 'Urlum', 'opm', 220000, gmFromGee(0.19, 220000), 0, 'locked', orb(11727895, 0.0015, 2.45, 40, 60, 1.5209, 878.1399)],
    ['Priax', 'Priax', 'Urlum', 'opm', 74000, gmFromGee(0.063, 74000), 0, 'locked', orb(11727895, 0.0015, 2.5, 40, 0, 1.5209, 878.1399)],
    ['Wal', 'Wal', 'Urlum', 'opm', 370000, gmFromGee(0.37, 370000), 0, 'locked', orb(67553668, 0.023, 1.9, 40, 0, 2.9615, 1078.179)],
    ['Tal', 'Tal', 'Wal', 'opm', 22000, gmFromGee(0.045, 22000), 0, 'locked', orb(3109163, 0, 1.9, 40, 0, 0, 1179.579)],
    ['Neidon', 'Neidon', 'Kerbol', 'opm', 2145000, gmFromGee(0.314, 2145000), 260000, 40250, orb(409355191706, 0.0127567, 1.27, 259, 0, 2.27167344093323, 99.6799999999973)],
    ['Thatmo', 'Thatmo', 'Neidon', 'opm', 286000, gmFromGee(0.232, 286000), 35000, 'locked', orb(32300895, 0.00043, 161.1, 66, 0, 2.04731106758118, 1953406.32967385)],
    ['Nissee', 'Nissee', 'Neidon', 'opm', 30000, gmFromGee(0.045, 30000), 0, 27924.8723, orb(487743514, 0.72, 29.56, 66, 0, 2.04731106758118, 1953406.32967385)],
    ['Plock', 'Plock', 'Kerbol', 'opm', 189000, gmFromGee(0.148, 189000), 0, 106309.606989054, orb(535833706086, 0.26, 6.15, 260, 50, 0, 213)],
    ['Karen', 'Karen', 'Plock', 'opm', 85050, gmFromGee(0.066, 85050), 0, 'locked', orb(2457800, 0, 0, 260, 50, 0, 213)],
  ];

  const bodies = BODY_ROWS.map(function (r) {
    const extra = r[9] || {};
    return {
      id: r[0], name: r[1], parent: r[2], pack: r[3], radius: r[4], gm: r[5], atmo: r[6], rot: r[7], orbit: r[8],
      star: !!extra.star, soi: extra.soi || null, opm: extra.opm || null, subParentLon: extra.subParentLon === undefined ? null : extra.subParentLon,
      rot0: extra.rot0 === undefined ? null : extra.rot0,
    };
  });

  const BODY_PACKS = [
    { id: 'stock', name: 'Stock system', defaultOn: true },
    { id: 'opm', name: 'Outer Planets Mod', defaultOn: false },
  ];

  /* ---------------- ground stations (all on Kerbin) ----------------
   * The Kerbal Space Center is the DSN. All other homes are rules of CommNetHome.CreateNode (see the notes per entry).
   */
  /* Atmospheres of the stock bodies, read from the CelestialBody prefabs with tools/unityscan (see docs/RESEARCH.md).
   * temp / pressure are the game's FloatCurves, [altitude m, value, inSlope, outSlope] per key (Hermite): temperature in K,
   * pressure in kPa. molarMass kg/mol, gamma = adiabatic index, shock = shockTemperatureMultiplier, depth = atmosphere height (m). */
  const ATMOSPHERES = {
    Kerbin: { depth: 70000, molarMass: 0.0289644, gamma: 1.4, shock: 1,
      temp: [[0, 288.15, 0, -0.008125], [8815.22, 216.65, -0.008097, 0], [16050.4, 216.65, 0, 0.001242], [25729.2, 228.65, 0.001237, 0.003465], [37879.4, 270.65, 0.003449, 0], [41129.2, 270.65, 0, -0.003444], [57440.1, 214.65, -0.003422, -0.002445], [68797.9, 186.946, -0.002434, 0], [70000, 186.946, 0, 0]],
      pressure: [[0, 101.325, 0, -0.015016], [1241.03, 84.0292, -0.012898, -0.012898], [2439.59, 69.6814, -0.011079, -0.011079], [3597.11, 57.78, -0.009515, -0.009515], [4714.94, 47.9086, -0.008173, -0.008172], [5794.41, 39.7215, -0.007019, -0.007019], [6836.79, 32.9317, -0.006028, -0.006028], [7843.33, 27.3011, -0.005177, -0.005177], [8815.22, 22.6321, -0.004446, -0.004446], [10786.4, 15.3684, -0.003017, -0.003016], [12101.4, 11.8731, -0.002329, -0.002329], [13417, 9.1728, -0.001799, -0.001799], [16678.5, 4.84226, -0.000945, -0.000945], [21143.1, 2.0501, -0.000389, -0.000389], [26977.9, 0.690593, -0.000125, -0.000125], [33593.8, 0.220173, -3.6e-05, -3.6e-05], [42081.9, 0.057685, -9e-06, -9e-06], [49312.1, 0.017538, -3e-06, -3e-06], [56669.9, 0.004592, -1e-06, -1e-06], [62300.8, 0.001497, -0, -0], [70000, 0, 0, 0]] },
    Eve: { depth: 90000, molarMass: 0.043, gamma: 1.2, shock: 1.1,
      temp: [[0, 420, 0, -0.010293], [15000, 280, -0.004705, -0.004705], [50000, 180, 0, 0], [60000, 190, 0, 0], [70000, 160, 0, 0], [90000, 250, 0.005895, 0]],
      pressure: [[0, 506.625, 0, -0.044239], [15000, 95.6891, -0.013049, -0.013049], [25000, 18.0733, -0.003012, -0.003012], [40000, 3.5, -0.000569, -0.000569], [50000, 0.121777, -2e-05, -2e-05], [60000, 0.023001, -4e-06, -4e-06], [70000, 0.004344, -1e-06, -1e-06], [80000, 0.000821, -0, -0], [90000, 0, -0, 0]] },
    Duna: { depth: 50000, molarMass: 0.043, gamma: 1.2, shock: 1.1,
      temp: [[0, 233, 0, -0.000426], [1000, 232.8, -0.000573, -0.000573], [25000, 153.7, -0.001877, -0.001877], [30000, 150, 0, 0], [45000, 150, 0, 0], [50000, 160, 0.003747, 0]],
      pressure: [[0, 6.755, 0, -0.0007], [12000, 1.276, -0.000223, -0.000223], [20000, 0.241, -4.2e-05, -4.2e-05], [35000, 0.015, -3e-06, -3e-06], [50000, 0, 0, 0]] },
    Jool: { depth: 200000, molarMass: 0.0022, gamma: 1.43, shock: 0.5,
      temp: [[0, 200, 0, -0.001183], [29000, 165, -0.001207, -0.001207], [123450, 120, 0, 0], [168000, 160, 0.000997, 0.000997], [187500, 175, 0, 0], [194000, 167, 0, 0], [200000, 350, 0.087175, 0]],
      pressure: [[0, 5066.25, 0, -0.672397], [10000, 1519.88, -0.134659, -0.134659], [29000, 628.044, -0.014493, -0.014493], [123450, 22.26, -0.001562, -0.001562], [150000, 2, -0.000136, -0.000136], [170000, 0.1, -1e-05, -1e-05], [200000, 0, 0, 0]] },
    Laythe: { depth: 50000, molarMass: 0.0289644, gamma: 1.4, shock: 1,
      temp: [[0, 277, 0, -0.009286], [5250, 206, -0.009254, 0], [10000, 206, 0, 0.00142], [17000, 217.8, 0.001414, 0.00396], [22000, 235.5, 0.003941, -0.000258], [31000, 203, -0.003911, -0.000762], [38000, 199, 0, 0.001478], [50000, 214, 0, 0]],
      pressure: [[0, 60.795, 0, -0.005216], [5250, 33.409, -0.004253, -0.004253], [10000, 17.7861, -0.002408, -0.002408], [17000, 7.10058, -0.001092, -0.001092], [22000, 3.81242, -0.000468, -0.000468], [31000, 1.31248, -0.000196, -0.000196], [38000, 0.510405, -7.9e-05, -7.9e-05], [50000, 0, 0, 0]] },
  };

  const STATIONS = [
    { id: 'KSC', name: 'Kerbal Space Center', lat: -0.0972092, lon: -74.557677, kind: 'main', main: true },
    // "anomaly" = every home that is not permanent: it only exists when the difficulty option "Enable Extra Groundstations"
    // is on, and then carries the DSN rating. (Baikerbanur is the game object "KSC2": isPermanent is false in the prefab.)
    { id: 'CraterRim', name: 'Crater Rim', lat: 9.45, lon: -172.110278, kind: 'anomaly' },
    { id: 'NyeIsland', name: 'Nye Island', lat: 5.363611, lon: 108.548056, kind: 'anomaly' },
    { id: 'HarvesterMassif', name: 'Harvester Massif', lat: -11.95, lon: 33.740278, kind: 'anomaly' },
    { id: 'NorthStationOne', name: 'North Station One', lat: 63.095, lon: -90.079722, kind: 'anomaly' },
    { id: 'MesaSouth', name: 'Mesa South', lat: -59.589722, lon: -25.861667, kind: 'anomaly' },
    { id: 'Baikerbanur', name: 'Baikerbanur', lat: 20.679167, lon: -146.501111, kind: 'anomaly' },
    // "permanent" = isPermanent in the game data: a fixed small antenna instead of the DSN rating, present when extra
    // stations are on OR "Allow Other Launch Sites" is on. Both belong to Making History (read from its asset bundle).
    { id: 'Desert', name: 'Desert Launch Site (Making History)', lat: -6.56, lon: -143.95, alt: 820, kind: 'permanent', power: 40e3, dlc: 'making-history' },
    { id: 'Larkes', name: 'Larkes (Making History)', lat: 44.72, lon: 137.03, alt: 0, kind: 'permanent', power: 40e3, dlc: 'making-history' },
  ];

  /* ---------------- project links (shown in the app footer and the "How it works" tab) ----------------
   * Keep identical to README.md; test/contact.test.js checks that every copy matches.
   */
  const SUPPORT = {
    contact: 'https://smp14.simplex.im/a#3gZ-zeHs4QrFZKLAN0o3SC_XQJXhj1eYBVTO_c0FAtg',
    kofi: 'https://ko-fi.com/scenprogramming',
    crypto: [
      { coin: 'Bitcoin', symbol: 'BTC', note: 'Silent Payments address (BIP 352): needs a wallet that supports it',
        address: 'sp1qq2637t6ve9zp4wh0e4ly2u7h7jwfn0k6c4535lxpp3wrqvmkua6xjqkwevyz0wwqx5ly2f0q29qh48wgf9gl0zt049za9kr9m8xgkey4cyggxa0x' },
      { coin: 'Ethereum', symbol: 'ETH', note: '',
        address: '0x8F238db898102125Fd968ed7CaD959Cb594a7e93' },
      { coin: 'Monero', symbol: 'XMR', note: '',
        address: '8AYK93mQEzsFFEFkuPN7wC9rPcXCyEXa1Ye5bH9U2GR3PpaZiYc84SxjMcdSdVMaaQUGmCXYkuxdDSG5bM3EVyqR25nbumV' },
    ],
  };

  return {
    GAME_VERSION: GAME_VERSION,
    APP_VERSION: APP_VERSION,
    TECH: TECH,
    PACKS: PACKS,
    antennas: antennas,
    REFLECTORS: REFLECTORS,
    DSN_LEVELS: DSN_LEVELS,
    DIFFICULTY_PRESETS: DIFFICULTY_PRESETS,
    BODY_PACKS: BODY_PACKS,
    bodies: bodies,
    STATIONS: STATIONS,
    ATMOSPHERES: ATMOSPHERES,
    SUPPORT: SUPPORT,
    G0: G0,
    // Calendar: 6-hour days, 426-day years (stock). setCalendar changes it when a planet pack replaces Kerbin by Earth.
    DAY: 21600,
    YEAR: 426 * 21600,
    setCalendar: function (day, daysPerYear) { this.DAY = day; this.YEAR = day * daysPerYear; },
  };
});
