// SPDX-License-Identifier: AGPL-3.0-or-later
/* The solar system as a queryable model: body tree, positions over time, surface points, distances.
 * No DOM access. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'), require('./orbits.js'));
  else root.KSPWorld = factory(root.KSPData, root.KSPOrbits);
})(typeof self !== 'undefined' ? self : this, function (Data, Orb) {
  'use strict';

  const DEG = Orb.DEG;

  /**
   * opts: {packs: {opm: true}, extraBodies: [body defs in the shape of Data.bodies]}
   * Returns a world. Bodies are stored parents-first.
   */
  function createWorld(opts) {
    opts = opts || {};
    const packs = opts.packs || {};
    const extra = opts.extraBodies || [];
    // A pack that defines its own Kerbin replaces the whole stock system (Real Solar System style): the stock bodies it does
    // not redefine are dropped. Otherwise a body with the same id as a stock body replaces just that body.
    const replacesSystem = extra.some((b) => b.id === 'Kerbin');
    const extraIds = new Set(extra.map((b) => b.id));
    const base = Data.bodies.filter((b) => !extraIds.has(b.id) && !(replacesSystem && !b.star));
    const defs = base.concat(extra).filter((b) => b.pack === 'stock' || packs[b.pack] || b.pack === 'custom');
    const resolved = defs.map((d) => {
      const useOpm = d.opm && packs.opm;
      return {
        id: d.id, name: d.name, pack: d.pack, radius: d.radius, gm: d.gm, atmo: d.atmo || 0, star: !!d.star,
        parent: useOpm ? d.opm.parent : d.parent, rot: useOpm && d.opm.rot ? d.opm.rot : d.rot,
        orbit: useOpm ? d.opm.orbit : d.orbit, soi: d.soi || null, rot0: d.rot0 == null ? null : d.rot0, subParentLon: d.subParentLon,
      };
    });
    const byId = new Map(resolved.map((b) => [b.id, b]));
    // Patches from imported planet packs (e.g. a pack that moves a stock body).
    for (const p of opts.patches || []) {
      const b = byId.get(p.id);
      if (!b) continue;
      const f = p.fields;
      if (f.parent) b.parent = f.parent;
      if (f.orbit) b.orbit = Object.assign({}, b.orbit || { a: 0, e: 0, i: 0, lan: 0, w: 0, m0: 0, epoch: 0 }, f.orbit);
      if (f.radius !== undefined) b.radius = f.radius;
      if (f.radiusScale) b.radius *= f.radiusScale;
      if (f.gm !== undefined) b.gm = f.gm;
      else if (f.geeASL !== undefined) b.gm = f.geeASL * Data.G0 * b.radius * b.radius;
      if (f.rot !== undefined) b.rot = f.rot;
      if (f.rot0 !== undefined) b.rot0 = f.rot0;
      if (f.atmo !== undefined) b.atmo = f.atmo;
      if (f.soi !== undefined) b.soi = f.soi;
    }
    // Order parents before children; drop bodies whose parent is missing.
    const ordered = [];
    const seen = new Set();
    function visit(b) {
      if (seen.has(b.id)) return true;
      if (b.parent) {
        const p = byId.get(b.parent);
        if (!p || !visit(p)) return false;
      }
      seen.add(b.id);
      ordered.push(b);
      return true;
    }
    resolved.forEach(visit);

    const index = new Map();
    ordered.forEach((b, i) => {
      b.idx = i;
      index.set(b.id, b);
    });
    ordered.forEach((b) => {
      b.parentBody = b.parent ? index.get(b.parent) : null;
      b.parentIdx = b.parentBody ? b.parentBody.idx : -1;
      b.moons = [];
      b.hasAtmo = b.atmo > 0;
      if (b.orbit) b._p = Orb.prepare(b.orbit, b.parentBody.gm);
      b.orbitalPeriod = b._p ? b._p.period : Infinity;
      b.rotPeriod = b.rot === 'locked' ? b.orbitalPeriod : b.rot;
      b.locked = b.rot === 'locked';
      // rot0 is the game's initialRotation. A tidally locked body spins once per orbit, so it alone fixes which side faces
      // the parent. Without it (other planet packs): choose the phase so subParentLon points at the parent at UT 0.
      const knownRot = b.rot0 !== null;
      b.approxSpin = b.locked && !knownRot && b.subParentLon == null;
      if (b.locked && !knownRot) {
        const facing = b._p.m0 / DEG + 180; // direction from the moon to its parent at t = 0 (circular approx.)
        b.rot0 = facing - (b.subParentLon == null ? 0 : b.subParentLon);
      }
      if (b.rot0 === null) b.rot0 = 0;
      b.soiRadius = b.parentBody ? b.soi || Orb.sphereOfInfluence(b.orbit.a, b.gm, b.parentBody.gm) : Infinity;
      b.depth = b.parentBody ? b.parentBody.depth + 1 : 0; // star 0, planets 1, moons 2, sub-moons 3
      b.isMoon = b.depth >= 2;
    });
    ordered.forEach((b) => { if (b.parentBody) b.parentBody.moons.push(b); });

    // Calendar: the home world's solar day and its year in whole days (stock Kerbin: 6 h, 426 d; an Earth pack: 24 h, 365 d).
    const home = index.get('Kerbin');
    const calendar = { day: 21600, daysPerYear: 426 };
    if (home && home._p && home.rot > 0 && isFinite(home.orbitalPeriod)) {
      const day = 1 / (1 / home.rot - 1 / home.orbitalPeriod);
      calendar.day = Math.round(day / 60) * 60;
      calendar.daysPerYear = Math.max(1, Math.round(home.orbitalPeriod / calendar.day));
    }

    const world = {
      calendar: calendar,
      bodies: ordered,
      index: index,
      root: ordered.find((b) => !b.parent),
      stations: Data.STATIONS,
      extremesCache: new Map(),
    };

    /** Heliocentric positions of every body centre at time t (Float64Array, 3 per body). */
    world.positions = function (t, out) {
      const n = ordered.length;
      const buf = out || new Float64Array(n * 3);
      const tmp = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        const b = ordered[i];
        if (!b._p) { buf[i * 3] = buf[i * 3 + 1] = buf[i * 3 + 2] = 0; continue; }
        Orb.position(b._p, t, tmp);
        const k = b.parentIdx * 3;
        buf[i * 3] = buf[k] + tmp[0];
        buf[i * 3 + 1] = buf[k + 1] + tmp[1];
        buf[i * 3 + 2] = buf[k + 2] + tmp[2];
      }
      return buf;
    };

    /**
     * How often is the straight line between two body centres blocked by other bodies, sampled over a period? Same
     * occlusion test as the simulator (CommNet's OccluderHorizonCulling.Raycast); the two bodies themselves are not
     * occluders and neither are their own planets or moons, so this answers "do other planets and Kerbol get in the way", not "is my vessel behind its own planet".
     * opt: { occVac, occAtm, sunOccludes, atmosphereBlocks }. Returns { samples, blocked (0..1), by: {bodyId: 0..1} } or null.
     */
    world.sightReport = function (aId, bId, opt, t0, horizon, samples) {
      const a = index.get(aId), b = index.get(bId);
      if (!a || !b || a === b) return null;
      const nb = ordered.length;
      const occ = new Float64Array(nb);
      // A vessel near either end sits inside that planet's own system, so its planet and moons are not "in between";
      // only the rest of the system (other planets, their moons, Kerbol) counts.
      const planetOf = (bd) => { let x = bd; while (x.parentBody && x.depth > 1) x = x.parentBody; return x; };
      const pa = planetOf(a), pb = planetOf(b);
      ordered.forEach((bd, i) => {
        if (bd === a || bd === b || (bd.star && opt.sunOccludes === false)) return;
        const pbd = planetOf(bd);
        if (!bd.star && (pbd === pa || pbd === pb)) return;
        occ[i] = (bd.radius + (opt.atmosphereBlocks ? bd.atmo : 0)) * (bd.hasAtmo ? opt.occAtm : opt.occVac);
      });
      const pos = new Float64Array(nb * 3);
      const by = {};
      let blocked = 0;
      const n = Math.max(2, samples | 0);
      for (let k = 0; k < n; k++) {
        world.positions(t0 + (horizon * k) / (n - 1), pos);
        const ai = a.idx * 3, bi = b.idx * 3;
        for (let i = 0; i < nb; i++) {
          if (!(occ[i] > 0)) continue;
          const r = occ[i];
          let px = (pos[ai] - pos[i * 3]) / r, py = (pos[ai + 1] - pos[i * 3 + 1]) / r, pz = (pos[ai + 2] - pos[i * 3 + 2]) / r;
          let qx = (pos[bi] - pos[i * 3]) / r, qy = (pos[bi + 1] - pos[i * 3 + 1]) / r, qz = (pos[bi + 2] - pos[i * 3 + 2]) / r;
          if (px * px + py * py + pz * pz > qx * qx + qy * qy + qz * qz) { const tx = px, ty = py, tz = pz; px = qx; py = qy; pz = qz; qx = tx; qy = ty; qz = tz; }
          const A = px * px + py * py + pz * pz - 1;
          const dx = qx - px, dy = qy - py, dz = qz - pz;
          const L = -(dx * px + dy * py + dz * pz);
          const hit = A < 0 ? L > 0 : L > A && (L * L) / (dx * dx + dy * dy + dz * dz) > A;
          if (hit) { blocked++; by[ordered[i].id] = (by[ordered[i].id] || 0) + 1; break; }
        }
      }
      Object.keys(by).forEach((id) => { by[id] /= n; });
      return { samples: n, blocked: blocked / n, by: by };
    };

    /** Rotation angle (rad) of a body about its spin axis at time t. */
    world.rotationAngle = function (body, t) {
      return (body.rot0 || 0) * DEG + (Orb.TAU * t) / body.rotPeriod;
    };

    /** Point fixed to a body's surface (lat/lon in degrees, altitude in m), written to out. */
    world.surfacePoint = function (body, latDeg, lonDeg, alt, t, pos, out) {
      const lat = latDeg * DEG;
      const lon = lonDeg * DEG + world.rotationAngle(body, t);
      const r = body.radius + (alt || 0);
      const cl = Math.cos(lat);
      const k = body.idx * 3;
      out[0] = pos[k] + r * cl * Math.cos(lon);
      out[1] = pos[k + 1] + r * cl * Math.sin(lon);
      out[2] = pos[k + 2] + r * Math.sin(lat);
      return out;
    };

    /** Prepared orbit for an orbit description about a body id. */
    world.prepareOrbit = function (bodyId, orbit) {
      const b = index.get(bodyId);
      return b ? Orb.prepare(orbit, b.gm) : null;
    };

    world.altitudeLimits = function (bodyId) {
      const b = index.get(bodyId);
      if (!b) return null;
      // Above the atmosphere, or above the highest terrain on airless bodies (Bop's peaks are ~22 km).
      const min = b.hasAtmo ? b.atmo + 5000 : 25000;
      return { min: min, max: b.soiRadius - b.radius };
    };

    /* ---- geometric distance extremes between bodies (replaces precomputed tables) ---- */

    function planetOf(b) {
      while (b.depth > 1) b = b.parentBody;
      return b;
    }
    function radialInterval(b) {
      // Distance interval of a body from its heliocentric planet (planets: 0).
      if (b.depth <= 1) return { min: 0, max: 0 };
      const bap = b.orbit.a * (1 + b.orbit.e);
      if (b.depth === 2) return { min: b.orbit.a * (1 - b.orbit.e), max: bap };
      const p = b.parentBody;
      return { min: Math.max(0, p.orbit.a * (1 - p.orbit.e) - bap), max: p.orbit.a * (1 + p.orbit.e) + bap };
    }
    function curvePoints(b, n) {
      const pts = new Float64Array(n * 3);
      const tmp = [0, 0, 0];
      for (let k = 0; k < n; k++) {
        Orb.positionAtE(b._p, (Orb.TAU * k) / n, tmp);
        pts[k * 3] = tmp[0]; pts[k * 3 + 1] = tmp[1]; pts[k * 3 + 2] = tmp[2];
      }
      return pts;
    }
    function orbitPairExtremes(a, b) {
      // Over long times the two bodies visit every combination of orbit positions, so the extremes
      // are the extremes of the distance between the two orbit curves.
      const key = a.id + '|' + b.id;
      const cached = world.extremesCache.get(key);
      if (cached) return cached;
      const n = 480;
      const A = curvePoints(a, n), B = curvePoints(b, n);
      let min = Infinity, max = 0;
      for (let i = 0; i < n; i++) {
        const ax = A[i * 3], ay = A[i * 3 + 1], az = A[i * 3 + 2];
        for (let j = 0; j < n; j++) {
          const dx = ax - B[j * 3], dy = ay - B[j * 3 + 1], dz = az - B[j * 3 + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < min) min = d2;
          if (d2 > max) max = d2;
        }
      }
      const res = { min: Math.sqrt(min), max: Math.sqrt(max) };
      world.extremesCache.set(key, res);
      world.extremesCache.set(b.id + '|' + a.id, res);
      return res;
    }

    /** Actual separation (m) between two body centres at time t. */
    world.distanceAt = function (idA, idB, t) {
      const a = index.get(idA), b = index.get(idB);
      if (!a || !b) return null;
      const pos = world.positions(t);
      return Math.hypot(pos[a.idx * 3] - pos[b.idx * 3], pos[a.idx * 3 + 1] - pos[b.idx * 3 + 1], pos[a.idx * 3 + 2] - pos[b.idx * 3 + 2]);
    };

    /** Closest / midpoint / farthest separation between two bodies, ever (2-body model). */
    world.distanceRange = function (idA, idB) {
      const a = index.get(idA), b = index.get(idB);
      if (!a || !b) return null;
      let min, max;
      if (a === b) { min = max = 0; }
      else if (b.parentBody === a) { min = b.orbit.a * (1 - b.orbit.e); max = b.orbit.a * (1 + b.orbit.e); }
      else if (a.parentBody === b) { min = a.orbit.a * (1 - a.orbit.e); max = a.orbit.a * (1 + a.orbit.e); }
      else if (a.star || b.star) {
        const other = a.star ? b : a;
        const pl = planetOf(other);
        const r = radialInterval(other);
        const pa = pl.orbit.a * (1 - pl.orbit.e), pb = pl.orbit.a * (1 + pl.orbit.e);
        min = Math.max(0, pa - r.max); max = pb + r.max;
      } else {
        const pa = planetOf(a), pb = planetOf(b);
        const ra = radialInterval(a), rb = radialInterval(b);
        if (pa === pb) {
          max = ra.max + rb.max;
          min = Math.max(0, rb.min - ra.max, ra.min - rb.max);
        } else {
          const ex = orbitPairExtremes(pa, pb);
          max = ex.max + ra.max + rb.max;
          min = Math.max(0, ex.min - ra.max - rb.max);
        }
      }
      return { min: min, mid: (min + max) / 2, max: max };
    };

    return world;
  }

  return { createWorld: createWorld };
});
