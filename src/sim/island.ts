import { clamp, lerp, smoothstep } from '../core/math';
import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';

/**
 * The island map: a volcanic high island ringed by a fringing reef. Everything here is laid out once per seed and
 * then sampled analytically, so `Terrain` can build its grid and gameplay can ask where the reef, the streams and the
 * jungle are without storing any extra maps.
 *
 * All water sits at the one world water level (0), like the lakes on the other maps: the ocean, the lagoon, the cove,
 * and the freshwater streams and pools, which run in carved channels and basins. The waterfall drops from a cliff
 * into its plunge pool.
 */

/** Side of the island world square in metres (the other maps are 320). */
export const ISLAND_WORLD_SIZE = 960;
const HALF = ISLAND_WORLD_SIZE / 2;
/** Mean coast radius before the headlands, bays and harmonics. */
const R0 = 330;
/** No part of the coast reaches past this radius, leaving room for the reef and deep water inside the world. */
const R_MAX = HALF - 100;
/** The reef crest stays at least this far inside the world edge, so a band of deep water always rings it. */
const REEF_MAX = HALF - 45;
const COAST_N = 1024;
const GRID_CELL = 4;
const GRID_N = ISLAND_WORLD_SIZE / GRID_CELL;

export type IslandWaterKind = 'sea' | 'stream' | 'pool' | 'plunge';

/** A body of water on the island, shaped like the other maps' `Lake` so drinking and fishing treat them the same. */
export interface IslandWater {
  x: number;
  z: number;
  r: number;
  depth: number;
  phase: number;
  kind: IslandWaterKind;
  drinkable: boolean;
  fish: boolean;
}

export interface Stream {
  /** Centreline points, x/z interleaved, about 3 m apart, from the source to past the beach. */
  pts: Float32Array;
  halfWidth: number;
  depth: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  water: IslandWater;
  /** Where the stream crosses the beach (the last fresh water before the sea). */
  mouthX: number;
  mouthZ: number;
}

export interface Cave {
  x: number;
  z: number;
  /** Direction the entrance faces, as an angle (the mouth lies along cos/sin of it). */
  facing: number;
  /** Radius of the rock shell and height of its roof above the floor. */
  r: number;
  height: number;
  floorY: number;
}

export interface Waterfall {
  /** The lip at the top of the cliff. */
  x: number;
  z: number;
  top: number;
  /** Where the falling water meets the pool. */
  footX: number;
  footZ: number;
  /** Unit vector pointing out of the cliff, toward the pool. */
  dirX: number;
  dirZ: number;
  width: number;
  pool: IslandWater;
}

interface Knoll {
  x: number;
  z: number;
  r: number;
  h: number;
}

interface Bump {
  a: number;
  amp: number;
  w: number;
}

const POOL_BANK = { bank: 0.35, grade: 0.2, reach: 20 };
/** Plunge-pool amphitheatre: the pool reaches almost to the cliff, which rises at `cliffGrade`. */
const PIT_LEDGE = 1.5;
const PIT_FLOOR = 0.8;
const CLIFF_GRADE = 3.2;

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? clamp(((px - ax) * vx + (pz - az) * vz) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

/** Smooth bump over |t| < 1. */
const bump = (t: number) => (t >= 1 || t <= -1 ? 0 : (1 - t * t) * (1 - t * t));

function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class IslandLayout {
  readonly seed: number;
  /** Direction of the trade winds: the windward side is jungle, the leeward side grass. */
  readonly windward: number;
  readonly peak: { x: number; z: number; r: number; h: number; craterR: number; craterD: number };
  readonly spits: { x0: number; z0: number; x1: number; z1: number; w: number }[] = [];
  readonly islet: { x: number; z: number; r: number };
  readonly cove: { x: number; z: number; r: number; mx: number; mz: number; w: number; inX: number; inZ: number; wallH: number };
  readonly stacks: { x: number; z: number; r: number; h: number }[] = [];
  readonly waterfall: Waterfall;
  readonly streams: Stream[] = [];
  /** Freshwater pools: the plunge pool, a pool partway down the main stream, and the spring that feeds the other. */
  readonly pools: IslandWater[] = [];
  readonly knolls: Knoll[] = [];
  readonly caves: Cave[] = [];
  readonly spawn = { x: 0, z: 0 };
  /** Everything salt: the lagoon, the cove and the open ocean. */
  readonly ocean: IslandWater = { x: 0, z: 0, r: HALF * 2, depth: 20, phase: 0, kind: 'sea', drinkable: false, fish: true };

  private readonly coast = new Float32Array(COAST_N + 1);
  private readonly reef = new Float32Array(COAST_N + 1);
  private readonly cliffs = new Float32Array(COAST_N + 1);
  private readonly noise: Noise2D;
  private readonly detail: Noise2D;
  private readonly headlands: Bump[] = [];
  /** Set while the caves are being placed, so their pads don't feed back into the heights they are sited on. */
  private siting = true;

  constructor(seed: number) {
    this.seed = seed;
    this.noise = new Noise2D(seed ^ 0x2a5ec7e1);
    this.detail = new Noise2D(seed ^ 0x7b1d4c93);
    const rng = new Rng(seed ^ 0x15a1a2d5);
    this.windward = rng.range(0, Math.PI * 2);

    // Coastline: a lumpy radius with rocky headlands (promontories) and bays cut in between.
    const harmonics = [2, 3, 4, 5, 7, 9, 13, 17].map((k, i) => ({ k, amp: [0.07, 0.08, 0.055, 0.045, 0.034, 0.024, 0.016, 0.01][i] * rng.range(0.6, 1.1), phase: rng.range(0, Math.PI * 2) }));
    const heads = rng.int(4, 5);
    const base = rng.range(0, Math.PI * 2);
    for (let i = 0; i < heads; i++) this.headlands.push({ a: base + (i / heads) * Math.PI * 2 + rng.range(-0.35, 0.35), amp: rng.range(34, 56), w: rng.range(0.06, 0.1) });
    const bays: Bump[] = [];
    const nBays = rng.int(3, 4);
    for (let i = 0; i < nBays; i++) {
      const a = base + ((i + 0.5) / heads) * Math.PI * 2 + rng.range(-0.25, 0.25);
      bays.push({ a, amp: rng.range(34, 58), w: rng.range(0.14, 0.24) });
    }
    const reefHarm = [3, 5, 8].map((k) => ({ k, amp: rng.range(3, 6), phase: rng.range(0, Math.PI * 2) }));
    let isletA = base + rng.range(0.3, 0.9) * Math.PI;
    for (let i = 0; i <= COAST_N; i++) {
      const a = (i / COAST_N) * Math.PI * 2;
      let r = R0;
      for (const h of harmonics) r += R0 * h.amp * Math.sin(h.k * a + h.phase);
      let cliff = 0;
      for (const h of this.headlands) {
        const b = bump(angDiff(a, h.a) / h.w);
        r += h.amp * b;
        cliff = Math.max(cliff, bump(angDiff(a, h.a) / (h.w * 1.6)));
      }
      for (const b of bays) r -= b.amp * bump(angDiff(a, b.a) / b.w);
      this.coast[i] = clamp(r, R0 * 0.6, R_MAX);
      let reef = 40;
      for (const h of reefHarm) reef += h.amp * Math.sin(h.k * a + h.phase);
      this.reef[i] = Math.min(reef, REEF_MAX - this.coast[i]);
      this.cliffs[i] = cliff;
    }

    // A volcanic peak near the middle with a small summit crater and grassy upper slopes.
    const pa = rng.range(0, Math.PI * 2);
    const pd = rng.range(0, 55);
    this.peak = { x: Math.cos(pa) * pd, z: Math.sin(pa) * pd, r: rng.range(165, 190), h: rng.range(56, 68), craterR: rng.range(18, 24), craterD: rng.range(6, 9) };

    // A palm islet out in the lagoon, off a stretch of coast with room around it (the reef follows its far shore).
    for (let k = 0; k < 24 && this.coastAt(isletA) > R_MAX - 45; k++) isletA += 0.26;
    const isletR = rng.range(13, 17);
    const isletD = this.coastAt(isletA) + rng.range(18, 24) + isletR;
    this.islet = { x: Math.cos(isletA) * isletD, z: Math.sin(isletA) * isletD, r: isletR };

    // Sand spits: strips of land running out from the coast.
    const nSpits = rng.int(1, 2);
    for (let i = 0; i < nSpits; i++) {
      for (let k = 0; k < 20; k++) {
        const a = rng.range(0, Math.PI * 2);
        if (Math.abs(angDiff(a, isletA)) < 0.5 || this.headlands.some((h) => Math.abs(angDiff(a, h.a)) < h.w * 2)) continue;
        if (this.spits.some((s) => Math.abs(angDiff(a, Math.atan2(s.z0, s.x0))) < 0.8)) continue;
        // Keep the spit inside its reef, and off the outermost coast, so deep water still rings it.
        if (this.coastAt(a) > R_MAX - 35) continue;
        const r = this.coastAt(a) - 8;
        const bend = rng.range(-0.45, 0.45);
        const len = Math.min(rng.range(40, 62), 8 + this.reefAt(a) * 0.6);
        const x0 = Math.cos(a) * r;
        const z0 = Math.sin(a) * r;
        this.spits.push({ x0, z0, x1: x0 + Math.cos(a + bend) * len, z1: z0 + Math.sin(a + bend) * len, w: rng.range(6, 9) });
        break;
      }
    }

    // The cove: a nearly enclosed pocket of turquoise water behind a narrow mouth, walled by rock, with a beach at
    // its head (the rocky cove of Jon's first photo).
    let ca = 0;
    for (let k = 0; k < 40; k++) {
      ca = rng.range(0, Math.PI * 2);
      if (Math.abs(angDiff(ca, isletA)) < 0.7) continue;
      if (this.spits.some((s) => Math.abs(angDiff(ca, Math.atan2(s.z0, s.x0))) < 0.6)) continue;
      if (this.headlands.some((h) => Math.abs(angDiff(ca, h.a)) < h.w * 1.5)) continue;
      break;
    }
    const cr = rng.range(20, 25);
    const coastR = this.coastAt(ca);
    const inX = -Math.cos(ca);
    const inZ = -Math.sin(ca);
    const pcx = Math.cos(ca) * coastR;
    const pcz = Math.sin(ca) * coastR;
    this.cove = {
      x: pcx + inX * (cr + 7), z: pcz + inZ * (cr + 7), r: cr,
      mx: pcx - inX * 14, mz: pcz - inZ * 14, w: rng.range(6, 7.5), inX, inZ, wallH: rng.range(6.5, 9),
    };
    const tx = -inZ;
    const tz = inX;
    for (const s of [-1, 1]) {
      const w = this.cove.w + rng.range(2.5, 4);
      this.stacks.push({ x: pcx + tx * w * s - inX * rng.range(3, 7), z: pcz + tz * w * s - inZ * rng.range(3, 7), r: rng.range(2.6, 3.6), h: rng.range(4.5, 7.5) });
    }

    // The waterfall: where the peak's flank stands 14-19 m above the lowland on the windward (jungle) side, cut an
    // amphitheatre with its plunge pool at the foot of the cliff.
    let wf: Waterfall | null = null;
    for (let k = 0; k < 80 && !wf; k++) {
      const a = this.windward + rng.range(-1.0, 1.0);
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      for (let d = this.peak.r * 0.35; d < this.peak.r * 1.05; d += 2) {
        const x = this.peak.x + dx * d;
        const z = this.peak.z + dz * d;
        const h = this.baseHeight(x, z);
        if (h > 19) continue;
        if (h < 14) break;
        const rp = rng.range(8.5, 10.5);
        const reach = rp + PIT_LEDGE + (h - PIT_FLOOR) / CLIFF_GRADE;
        const px = x + dx * reach;
        const pz = z + dz * reach;
        if (this.land(px, pz) < 90 || this.land(x, z) < 100) break;
        const pool: IslandWater = { x: px, z: pz, r: rp, depth: 2.8, phase: rng.range(0, 10), kind: 'plunge', drinkable: true, fish: true };
        wf = { x, z, top: h, footX: px - dx * (rp - 1.6), footZ: pz - dz * (rp - 1.6), dirX: dx, dirZ: dz, width: rng.range(2.6, 3.6), pool };
        break;
      }
    }
    if (!wf) {
      // Every island gets its waterfall: fall back to a spot straight out from the peak.
      const a = this.windward;
      const d = this.peak.r * 0.62;
      const x = this.peak.x + Math.cos(a) * d;
      const z = this.peak.z + Math.sin(a) * d;
      const h = Math.max(14, this.baseHeight(x, z));
      const rp = 9;
      const reach = rp + PIT_LEDGE + (h - PIT_FLOOR) / CLIFF_GRADE;
      const px = x + Math.cos(a) * reach;
      const pz = z + Math.sin(a) * reach;
      const pool: IslandWater = { x: px, z: pz, r: rp, depth: 2.8, phase: 1, kind: 'plunge', drinkable: true, fish: true };
      wf = { x, z, top: h, footX: px - Math.cos(a) * 7.4, footZ: pz - Math.sin(a) * 7.4, dirX: Math.cos(a), dirZ: Math.sin(a), width: 3, pool };
    }
    this.waterfall = wf;
    this.pools.push(wf.pool);

    // The main stream runs from the plunge pool down to the sea, with a pool partway along.
    let a: Stream | null = null;
    const width = rng.range(1.7, 2.2);
    for (let k = 0; k < 7 && !a; k++) {
      const turn = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.3;
      const hx = Math.cos(Math.atan2(wf.dirZ, wf.dirX) + turn);
      const hz = Math.sin(Math.atan2(wf.dirZ, wf.dirX) + turn);
      a = this.traceStream(wf.pool.x + wf.dirX * (wf.pool.r - 1), wf.pool.z + wf.dirZ * (wf.pool.r - 1), hx, hz, rng, width);
    }
    if (a) {
      this.streams.push(a);
      const n = a.pts.length / 2;
      const mid = Math.floor(n * rng.range(0.38, 0.5)) * 2;
      if (n > 20) this.pools.push({ x: a.pts[mid], z: a.pts[mid + 1], r: rng.range(6, 7.5), depth: 2.2, phase: rng.range(0, 10), kind: 'pool', drinkable: true, fish: true });
    }

    // A spring pool on the leeward side feeds a second stream through the grassland.
    for (let k = 0; k < 60; k++) {
      const ang = this.windward + Math.PI + rng.range(-1.2, 1.2);
      const d = this.coastAt(ang) * rng.range(0.42, 0.62);
      const sx = Math.cos(ang) * d;
      const sz = Math.sin(ang) * d;
      if (Math.hypot(sx - this.peak.x, sz - this.peak.z) < this.peak.r * 0.72) continue;
      if (this.baseHeight(sx, sz) > 16) continue;
      if (a && this.minStreamDist(a, sx, sz) < 90) continue;
      if (Math.hypot(sx - this.cove.x, sz - this.cove.z) < 90) continue;
      const out = Math.atan2(sz, sx);
      const spring: IslandWater = { x: sx, z: sz, r: rng.range(7, 8.5), depth: 2.3, phase: rng.range(0, 10), kind: 'pool', drinkable: true, fish: true };
      const b = this.traceStream(sx + Math.cos(out) * (spring.r - 1), sz + Math.sin(out) * (spring.r - 1), Math.cos(out), Math.sin(out), rng, rng.range(1.5, 1.9));
      if (!b || (a && this.minStreamDist(a, b.mouthX, b.mouthZ) < 70)) continue;
      if (Math.hypot(b.mouthX - this.cove.x, b.mouthZ - this.cove.z) < 50) continue;
      this.pools.push(spring);
      this.streams.push(b);
      break;
    }

    // Rock knolls with a cave in the side: one in the grassland, one in the jungle.
    for (const leeward of [true, false]) {
      for (let k = 0; k < 120; k++) {
        const ang = (leeward ? this.windward + Math.PI : this.windward) + rng.range(-1.1, 1.1);
        const d = this.coastAt(ang) * rng.range(0.35, 0.8);
        const x = Math.cos(ang) * d;
        const z = Math.sin(ang) * d;
        const r = rng.range(12, 15);
        if (this.land(x, z) < r + 36) continue;
        if (Math.hypot(x - this.peak.x, z - this.peak.z) < this.peak.r * 0.7) continue;
        if (this.waterNear(x, z, r + 34)) continue;
        if (this.knolls.some((o) => Math.hypot(o.x - x, o.z - z) < 110)) continue;
        if (Math.hypot(x - this.waterfall.x, z - this.waterfall.z) < 80 || Math.hypot(x - this.cove.x, z - this.cove.z) < 70) continue;
        this.knolls.push({ x, z, r, h: rng.range(9, 12) });
        break;
      }
    }

    // The spawn: a castaway's beach a short walk along the sand from where a stream meets the sea.
    this.placeSpawn(rng);

    // Caves: one in the side wall of the waterfall's amphitheatre, and one in each knoll.
    const side = rng.chance(0.5) ? 1 : -1;
    const ca2 = Math.atan2(-wf.dirZ, -wf.dirX) + side * rng.range(0.95, 1.15);
    const pool = wf.pool;
    // Deep enough into the cliff that the mouth opens onto the ledge beside the pool, not into the water.
    const caveD = pool.r + PIT_LEDGE + 7.5;
    const cx = pool.x + Math.cos(ca2) * caveD;
    const cz = pool.z + Math.sin(ca2) * caveD;
    this.caves.push({ x: cx, z: cz, facing: Math.atan2(pool.z - cz, pool.x - cx), r: 5.2, height: 4.2, floorY: PIT_FLOOR });
    for (const kn of this.knolls) {
      let face = Math.atan2(this.spawn.z - kn.z, this.spawn.x - kn.x) + rng.range(-1.2, 1.2);
      // Face the entrance away from water and the peak so it opens onto walkable ground.
      for (let k = 0; k < 12; k++) {
        const fx = kn.x + Math.cos(face) * (kn.r + 10);
        const fz = kn.z + Math.sin(face) * (kn.r + 10);
        if (this.land(fx, fz) > 12 && !this.waterNear(fx, fz, 10)) break;
        face += 0.55;
      }
      const d = kn.r * 0.55;
      const x = kn.x + Math.cos(face) * d;
      const z = kn.z + Math.sin(face) * d;
      this.caves.push({ x, z, facing: face, r: 5.2, height: 4.3, floorY: this.baseHeight(x + Math.cos(face) * 6, z + Math.sin(face) * 6) });
    }
    this.siting = false;
  }

  // ------------------------------------------------------------------ coast and reef

  private lut(arr: Float32Array, a: number): number {
    let t = (a / (Math.PI * 2)) % 1;
    if (t < 0) t += 1;
    const f = t * COAST_N;
    // A bearing a hair under zero wraps to exactly 1: that is the table's last entry, not one past it.
    const i = Math.min(COAST_N - 1, Math.floor(f));
    const k = f - i;
    return arr[i] + (arr[i + 1] - arr[i]) * k;
  }

  coastAt(a: number): number {
    return this.lut(this.coast, a);
  }

  reefAt(a: number): number {
    return this.lut(this.reef, a);
  }

  /** 0..1 how rocky (cliff-lined) the coast is at this bearing: the headlands. */
  cliffAt(a: number): number {
    return this.lut(this.cliffs, a);
  }

  /**
   * Signed metres from the coast: positive inland, negative out at sea. It is measured along the bearing from the
   * island's centre (exact enough for a coast this round), with the spits, the islet and the cove folded in.
   */
  land(x: number, z: number): number {
    const r = Math.hypot(x, z);
    // Each feature is a distance field folded in everywhere (cutting them off at a box would leave seams).
    let l = this.coastAt(Math.atan2(z, x)) - r;
    for (const s of this.spits) l = smax(l, s.w - segDist(x, z, s.x0, s.z0, s.x1, s.z1), 8);
    const i = this.islet;
    l = Math.max(l, i.r - Math.hypot(x - i.x, z - i.z));
    const c = this.cove;
    const cut = Math.min(Math.hypot(x - c.x, z - c.z) - c.r, segDist(x, z, c.x, c.z, c.mx, c.mz) - c.w);
    return smin(l, cut, 5);
  }

  /** Metres past the reef crest into deep water (negative inside the reef or on land). */
  pastReef(x: number, z: number): number {
    return -this.land(x, z) - this.reefAt(Math.atan2(z, x));
  }

  // ------------------------------------------------------------------ heights

  /** The peak's contribution at a point. */
  peakHeight(x: number, z: number): number {
    const p = this.peak;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d >= p.r) return 0;
    const u = d / p.r;
    const ang = Math.atan2(z - p.z, x - p.x);
    // Radial gullies worn down the cone, as on Koko Crater behind Hanauma Bay.
    const g = Math.sin(ang * 7 + this.detail.get(u * 3, ang) * 0.8);
    const gully = 1 - 0.07 * g * g * smoothstep(0.15, 0.6, u);
    let h = p.h * Math.pow(1 - smoothstep(0, 1, u), 1.25) * gully;
    const cu = d / p.craterR;
    if (cu < 1.4) h -= p.craterD * (1 - smoothstep(0.55, 1.4, cu));
    return h;
  }

  /** Land height from the coast profile, rolling hills and the peak, before any carved or raised features. */
  baseHeight(x: number, z: number, L = this.land(x, z)): number {
    if (L <= 0) return 0;
    const beach = 1.4 * (1 - (1 - Math.min(1, L / 16)) ** 2);
    const inland = smoothstep(10, 60, L);
    const n = this.noise;
    let h = beach + inland * (Math.min(7, Math.max(0, L - 16) * 0.04) + n.fbm(x * 0.0062, z * 0.0062, 4) * 7 * smoothstep(20, 150, L));
    h += inland * n.fbm(x * 0.022 + 31.7, z * 0.022 - 8.3, 2) * 1.2;
    h = Math.max(h, beach * 0.9);
    h += this.peakHeight(x, z) * smoothstep(8, 40, L);
    // Headlands rise straight out of the sea as rocky bluffs.
    const cliff = this.cliffAt(Math.atan2(z, x));
    if (cliff > 0) h += cliff * 7 * smoothstep(0, 6, L) * (1 - smoothstep(20, 48, L));
    return h;
  }

  private seabed(x: number, z: number, L: number): number {
    const t = -L;
    const reef = this.reefAt(Math.atan2(z, x));
    const d = this.detail;
    const lagoon = 1.5 + 0.9 * (d.get(x * 0.012, z * 0.012) * 0.5 + 0.5);
    if (t <= reef) {
      let h = -lagoon * (1 - (1 - Math.min(1, t / 14)) ** 2);
      // Coral heads in the lagoon, and the reef crest just under the surface where the surf breaks.
      h += Math.max(0, d.get(x * 0.09, z * 0.09) - 0.55) * 1.6 * smoothstep(12, 22, t);
      h = lerp(h, -0.42, smoothstep(reef - 12, reef - 1, t));
      return h;
    }
    const k = t - reef;
    return Math.max(-24, -0.42 - k * 0.95 - d.get(x * 0.03, z * 0.03) * 1.5 * smoothstep(0, 10, k));
  }

  /** Final terrain height at a point (the heightfield is sampled from this). */
  sample(x: number, z: number): number {
    const L = this.land(x, z);
    let h = L > 0 ? this.baseHeight(x, z, L) : this.seabed(x, z, L);

    for (const k of this.knolls) {
      const d = Math.hypot(x - k.x, z - k.z);
      if (d > k.r * 1.3) continue;
      const wob = 1 + 0.12 * this.detail.get(Math.atan2(z - k.z, x - k.x) * 1.5 + k.x, k.z * 0.1);
      h += k.h * (1 - smoothstep(0.62, 1.0, d / (k.r * wob)));
    }
    for (const s of this.stacks) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.r * 1.5) h = Math.max(h, lerp(s.h, h, smoothstep(s.r * 0.7, s.r * 1.5, d)));
    }
    h = this.coveWalls(x, z, h);
    h = this.amphitheatre(x, z, h);
    for (const st of this.streams) h = this.carveStream(st, x, z, h);
    for (const p of this.pools) h = this.carvePool(p, x, z, h);
    if (!this.siting) for (const c of this.caves) h = this.cavePad(c, x, z, h);

    const ds = Math.hypot(x - this.spawn.x, z - this.spawn.z);
    if (ds < 14 && h > 0.6) h = lerp(Math.max(0.9, Math.min(h, 1.3 + this.detail.get(x * 0.1, z * 0.1) * 0.1)), h, smoothstep(5, 14, ds));
    return h;
  }

  /** Rock walls around the cove (not at its head, where the beach is) and along its narrow mouth. */
  private coveWalls(x: number, z: number, h: number): number {
    const c = this.cove;
    if (Math.abs(x - c.x) > c.r + 50 || Math.abs(z - c.z) > c.r + 50) return h;
    const d = Math.hypot(x - c.x, z - c.z);
    const edge = Math.min(d - c.r, segDist(x, z, c.x, c.z, c.mx, c.mz) - c.w);
    if (edge < 0 || edge > 22) return h;
    // Bearing from the cove's centre decides beach or wall: the head of the cove (its inland side) is beach.
    const head = ((x - c.x) * c.inX + (z - c.z) * c.inZ) / (d || 1);
    const wall = 1 - smoothstep(0.3, 0.68, head);
    if (wall <= 0) return h;
    const rise = c.wallH * (0.85 + 0.3 * this.detail.get(x * 0.08, z * 0.08));
    // Walls only stand on the island itself: along the mouth they stop at the coast instead of running out to sea.
    const ashore = smoothstep(-3, 3, this.coastAt(Math.atan2(z, x)) - Math.hypot(x, z));
    return Math.max(h, lerp(h, h + rise, wall * ashore * smoothstep(0.2, 2.6, edge) * (1 - smoothstep(9, 22, edge))));
  }

  /** The plunge pool's amphitheatre: a steep cliff all round, opened at the front by the stream's gorge. */
  private amphitheatre(x: number, z: number, h: number): number {
    const p = this.waterfall.pool;
    const d = Math.hypot(x - p.x, z - p.z);
    const ra = p.r + PIT_LEDGE;
    if (d > ra + 14) return h;
    const wall = PIT_FLOOR + Math.max(0, d - ra) * CLIFF_GRADE * (0.9 + 0.2 * this.detail.get(x * 0.2, z * 0.2) * 0.5);
    h = Math.min(h, wall);
    // A notch in the lip where the water spills over.
    const w = this.waterfall;
    const along = (x - w.x) * -w.dirX + (z - w.z) * -w.dirZ;
    const across = Math.abs((x - w.x) * -w.dirZ + (z - w.z) * w.dirX);
    if (along > -2 && along < 16 && across < w.width) h -= 0.6 * (1 - smoothstep(w.width * 0.5, w.width, across)) * smoothstep(-2, 1, along);
    return h;
  }

  /** Distance from a point to the stream's centreline (Infinity outside its bounds plus `pad`). */
  streamDist(st: Stream, x: number, z: number, pad: number): number {
    if (x < st.minX - pad || x > st.maxX + pad || z < st.minZ - pad || z > st.maxZ + pad) return Infinity;
    return this.minStreamDist(st, x, z);
  }

  /**
   * Closest point on the stream: its distance, how far downstream it is (`s`, metres from the source), and whether
   * the point lies behind the source (upstream of where the stream begins).
   */
  private nearestOnStream(st: Stream, x: number, z: number): { d: number; s: number; behind: boolean } {
    const p = st.pts;
    let best = Infinity;
    let bestS = 0;
    let behind = false;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i];
      const az = p[i + 1];
      const dx = x - ax;
      const dz = z - az;
      if (dx * dx + dz * dz > (best + 3.2) * (best + 3.2)) continue;
      const vx = p[i + 2] - ax;
      const vz = p[i + 3] - az;
      const l2 = vx * vx + vz * vz;
      const raw = l2 > 0 ? (dx * vx + dz * vz) / l2 : 0;
      const t = clamp(raw, 0, 1);
      const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
      if (d < best) {
        best = d;
        bestS = (i / 2 + t) * 3;
        behind = i === 0 && raw < 0;
      }
    }
    return { d: best, s: bestS, behind };
  }

  private minStreamDist(st: Stream, x: number, z: number): number {
    const p = st.pts;
    let best = Infinity;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i];
      const az = p[i + 1];
      const bx = p[i + 2];
      const bz = p[i + 3];
      // Cheap reject: a segment is 3 m long, so anything farther than best + 3 from its start can't win.
      const dx = x - ax;
      const dz = z - az;
      if (dx * dx + dz * dz > (best + 3.2) * (best + 3.2)) continue;
      const d = segDist(x, z, ax, az, bx, bz);
      if (d < best) best = d;
    }
    return best;
  }

  private carveStream(st: Stream, x: number, z: number, h: number): number {
    const w = st.halfWidth;
    if (x < st.minX - w - 60 || x > st.maxX + w + 60 || z < st.minZ - w - 60 || z > st.maxZ + w + 60) return h;
    const near = this.nearestOnStream(st, x, z);
    const d = near.d;
    if (d > w + 60 || near.behind) return h;
    // The ground falls away gently to the banks over a broad valley, so you can walk down to the water anywhere.
    // Near the source the valley narrows to a gorge, which keeps the waterfall's cliff standing behind its pool.
    const open = smoothstep(4, 45, near.s);
    const inner = lerp(6, 24, open);
    const outer = lerp(11, 60, open);
    const bank = 0.3 + Math.max(0, d - w) * 0.16 + this.detail.get(x * 0.09, z * 0.09) * 0.08;
    h = lerp(smin(h, bank, 1.2), h, smoothstep(w + inner, w + outer, d));
    if (d < w * 1.7) {
      const bed = -st.depth + this.detail.get(x * 0.11, z * 0.11) * 0.12;
      h = Math.min(h, lerp(bed, h, smoothstep(w * 0.45, w * 1.7, d)));
    }
    return h;
  }

  private carvePool(p: IslandWater, x: number, z: number, h: number): number {
    const dist = Math.hypot(x - p.x, z - p.z);
    const S = POOL_BANK;
    if (dist > p.r * 1.25 + S.reach) return h;
    const ang = Math.atan2(z - p.z, x - p.x);
    const shore = p.r * (1 + 0.12 * this.detail.get(Math.cos(ang) * 1.3 + p.phase, Math.sin(ang) * 1.3 - p.phase));
    if (p.kind !== 'plunge') {
      const bank = S.bank + this.detail.get(x * 0.09, z * 0.09) * 0.1 + Math.max(0, dist - shore) * S.grade;
      h = lerp(smin(h, bank, 1.5), h, smoothstep(shore + S.reach * 0.55, shore + S.reach, dist));
    }
    const k = dist / shore;
    if (k < 1.6) {
      const floor = -p.depth + this.detail.get(x * 0.07, z * 0.07) * 0.3;
      h = Math.min(h, lerp(floor, h, smoothstep(0.1, 1.45, k)));
    }
    return h;
  }

  /** Flattens a cave's floor, cutting its hollow into the rock behind (the shell mesh roofs it over). */
  private cavePad(c: Cave, x: number, z: number, h: number): number {
    const dx = x - c.x;
    const dz = z - c.z;
    const d2 = dx * dx + dz * dz;
    const reach = c.r + 3;
    if (d2 > reach * reach) return h;
    const d = Math.sqrt(d2);
    const floor = c.floorY + this.detail.get(x * 0.3, z * 0.3) * 0.05;
    return lerp(floor, h, smoothstep(c.r - 0.8, reach, d));
  }

  // ------------------------------------------------------------------ streams

  /**
   * A stream from (x, z) heading along (dx, dz): it bends toward the nearest stretch of coast, meanders, and ends a
   * little way out in the lagoon.
   */
  private traceStream(x: number, z: number, dx: number, dz: number, rng: Rng, halfWidth: number): Stream | null {
    const pts: number[] = [x, z];
    let heading = Math.atan2(dz, dx);
    const phase = rng.range(0, 10);
    const wiggle = rng.range(0.25, 0.45);
    let mouth: { x: number; z: number } | null = null;
    for (let i = 0; i < 180; i++) {
      const out = Math.atan2(z, x);
      // Steer outward (toward the sea) with a lazy meander.
      heading += angDiff(out, heading) * 0.06 + Math.sin(i * 0.19 + phase) * wiggle * 0.12;
      x += Math.cos(heading) * 3;
      z += Math.sin(heading) * 3;
      pts.push(x, z);
      const L = this.land(x, z);
      if (!mouth && L < 4) mouth = { x, z };
      if (L < -7) break;
      if (Math.hypot(x - this.cove.x, z - this.cove.z) < this.cove.r + 8) return null;
    }
    if (!mouth || this.land(x, z) > -3) return null;
    const arr = new Float32Array(pts);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < arr.length; i += 2) {
      minX = Math.min(minX, arr[i]);
      maxX = Math.max(maxX, arr[i]);
      minZ = Math.min(minZ, arr[i + 1]);
      maxZ = Math.max(maxZ, arr[i + 1]);
    }
    return {
      pts: arr, halfWidth, depth: rng.range(0.95, 1.15), minX, maxX, minZ, maxZ, mouthX: mouth.x, mouthZ: mouth.z,
      water: { x: mouth.x, z: mouth.z, r: halfWidth, depth: 1, phase: 0, kind: 'stream', drinkable: true, fish: true },
    };
  }

  /** Any stream or pool within `r` of a point. */
  private waterNear(x: number, z: number, r: number): boolean {
    for (const p of this.pools) if (Math.hypot(x - p.x, z - p.z) < p.r + r) return true;
    for (const s of this.streams) if (this.streamDist(s, x, z, r) < r) return true;
    return false;
  }

  /** Metres to the nearest freshwater stream centreline or pool edge (capped at `cap`). */
  freshDist(x: number, z: number, cap = 60): number {
    let best = cap;
    for (const p of this.pools) best = Math.min(best, Math.max(0, Math.hypot(x - p.x, z - p.z) - p.r));
    for (const s of this.streams) best = Math.min(best, Math.max(0, this.streamDist(s, x, z, best) - s.halfWidth));
    return best;
  }

  private placeSpawn(rng: Rng): void {
    // Prefer the stream whose mouth is on a sandy beach rather than below a headland's bluffs.
    const byBeach = [...this.streams].sort((a, b) => this.cliffAt(Math.atan2(a.mouthZ, a.mouthX)) - this.cliffAt(Math.atan2(b.mouthZ, b.mouthX)));
    for (const st of byBeach) {
      const out = Math.atan2(st.mouthZ, st.mouthX);
      for (let k = 0; k < 16; k++) {
        const side = k % 2 ? 1 : -1;
        const along = rng.range(15, 24) * side;
        const a = out + along / this.coastAt(out);
        const r = this.coastAt(a) - rng.range(10, 14);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (this.land(x, z) < 7 || this.baseHeight(x, z) > 3 || this.freshDist(x, z) < 6) continue;
        if (Math.hypot(x - this.cove.x, z - this.cove.z) < this.cove.r + 20) continue;
        this.spawn.x = x;
        this.spawn.z = z;
        return;
      }
    }
    const a = this.windward + Math.PI;
    const r = this.coastAt(a) - 12;
    this.spawn.x = Math.cos(a) * r;
    this.spawn.z = Math.sin(a) * r;
  }

  // ------------------------------------------------------------------ regions

  private jungleRaw(x: number, z: number, L: number, fresh: number): number {
    if (L < 10) return 0;
    const a = Math.cos(Math.atan2(z, x) - this.windward);
    let j = smoothstep(-0.5, 0.15, a) + (this.noise.get(x * 0.011 + 17.3, z * 0.011 - 4.1) - 0.1) * 0.5;
    j = Math.max(j, 1 - smoothstep(10, 36, fresh));
    j *= smoothstep(12, 34, L);
    j *= 1 - smoothstep(30, 44, this.peakHeight(x, z));
    return clamp(j, 0, 1);
  }

  /** Region fields cached on a 4 m grid (jungle, distance to fresh water, land), since worldgen and colouring ask a lot. */
  private grid: Float32Array | null = null;

  private regions(): Float32Array {
    if (this.grid) return this.grid;
    const n = GRID_N + 1;
    const g = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -HALF + i * GRID_CELL;
        const z = -HALF + j * GRID_CELL;
        const L = this.land(x, z);
        const fresh = L > -5 ? this.freshDist(x, z, 60) : 60;
        const k = (j * n + i) * 3;
        g[k] = this.jungleRaw(x, z, L, fresh);
        g[k + 1] = fresh;
        g[k + 2] = L;
      }
    }
    this.grid = g;
    return g;
  }

  private gridAt(x: number, z: number, ch: number): number {
    const g = this.regions();
    const n = GRID_N + 1;
    const gx = clamp((x + HALF) / GRID_CELL, 0, GRID_N - 1e-6);
    const gz = clamp((z + HALF) / GRID_CELL, 0, GRID_N - 1e-6);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const a = g[(j * n + i) * 3 + ch];
    const b = g[(j * n + i + 1) * 3 + ch];
    const c = g[((j + 1) * n + i) * 3 + ch];
    const d = g[((j + 1) * n + i + 1) * 3 + ch];
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
  }

  /** 0..1 dense jungle: the windward side, the stream valleys and the waterfall, never the beach or the grassy summit. */
  jungle(x: number, z: number): number {
    return this.gridAt(x, z, 0);
  }

  /** Metres to the nearest fresh water (streams and pools), from the cached grid; 60 means "far". */
  freshNear(x: number, z: number): number {
    return this.gridAt(x, z, 1);
  }

  /** 0..1 open grassland with few trees: the leeward side and the upper slopes of the peak. */
  plains(x: number, z: number): number {
    const L = this.gridAt(x, z, 2);
    if (L < 18) return 0;
    return (1 - this.jungle(x, z)) * smoothstep(18, 34, L);
  }

  /** The water body a point of water belongs to: a pool, a stream, or the salt sea. */
  waterAt(x: number, z: number): IslandWater {
    let best: IslandWater | null = null;
    let bd = 1.35;
    for (const p of this.pools) {
      const d = Math.hypot(x - p.x, z - p.z) / p.r;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) return best;
    if (this.land(x, z) > 2) {
      for (const s of this.streams) if (this.streamDist(s, x, z, s.halfWidth + 3) < s.halfWidth + 2.5) return s.water;
    }
    return this.ocean;
  }
}
