import { lerp, smoothstep } from '../core/math';
import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';
import { DEFAULT_BIOME, type BiomeId } from '../data/biomes';

export const WORLD_SIZE = 320;
export const WORLD_HALF = WORLD_SIZE / 2;
export const TERRAIN_CELL = 2;
export const TERRAIN_CELLS = WORLD_SIZE / TERRAIN_CELL;
export const TERRAIN_VERTS = TERRAIN_CELLS + 1;
export const WATER_LEVEL = 0;
/** Walkable area stops a little before the mountain rim. */
export const PLAY_HALF = WORLD_HALF - 12;

/** `spring` and `tinaja` (a rock pool) are the desert's drinkable water; an `alkali` pool is too salty to drink. */
export type WaterKind = 'lake' | 'spring' | 'tinaja' | 'alkali';

export interface Lake {
  x: number;
  z: number;
  r: number;
  depth: number;
  phase: number;
  /** Absent on the PNW lakes: a drinkable lake with trout. */
  kind?: WaterKind;
  drinkable?: boolean;
  fish?: boolean;
}

export const isDrinkable = (l: Lake): boolean => l.drinkable !== false;
export const holdsFish = (l: Lake): boolean => l.fish !== false;

/** A desert landform raised out of the plain. */
export interface Landform {
  kind: 'mesa' | 'butte' | 'spire';
  x: number;
  z: number;
  r: number;
  h: number;
  phase: number;
}

/** A volcanic dike: a low wall of dark rock running out from the spire. */
interface Dike {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  h: number;
}

/**
 * Heightfield terrain. `heightAt` interpolates the exact triangles used by the render mesh
 * (each cell split along its (x0,z0)-(x1,z1) diagonal) so feet never float or sink.
 */
export class Terrain {
  readonly seed: number;
  readonly biome: BiomeId;
  readonly heights: Float32Array;
  readonly lakes: Lake[];
  /** Lakes fish can live in (all of them on the PNW map). */
  readonly fishLakes: Lake[];
  readonly spawn = { x: 0, z: 0 };
  /** Desert mesas, buttes and the volcanic spire; empty on the PNW map. */
  readonly landforms: Landform[] = [];
  /** Desert: unit vector toward the pinyon-juniper and ponderosa high country. */
  readonly upDir = { x: 0, z: 0 };
  private readonly slickPatches: { x: number; z: number; r: number }[] = [];
  private dike: Dike | null = null;
  /** Forest density field in [0, 1] used by worldgen and scatter. */
  private readonly noise: Noise2D;
  private readonly detail: Noise2D;

  constructor(seed: number, biome: BiomeId = DEFAULT_BIOME) {
    this.seed = seed;
    this.biome = biome;
    this.noise = new Noise2D(seed ^ 0x9e3779b9);
    this.detail = new Noise2D(seed ^ 0x51ed270b);
    if (biome === 'desert') {
      this.lakes = this.layoutDesert(seed);
      this.fishLakes = this.lakes.filter(holdsFish);
    } else {
      this.lakes = this.layoutLakes(seed);
      this.fishLakes = this.lakes;
    }
    const sample = biome === 'desert' ? (x: number, z: number) => this.sampleDesert(x, z) : (x: number, z: number) => this.sampleRaw(x, z);

    this.heights = new Float32Array(TERRAIN_VERTS * TERRAIN_VERTS);
    for (let j = 0; j < TERRAIN_VERTS; j++) {
      for (let i = 0; i < TERRAIN_VERTS; i++) {
        const x = -WORLD_HALF + i * TERRAIN_CELL;
        const z = -WORLD_HALF + j * TERRAIN_CELL;
        this.heights[j * TERRAIN_VERTS + i] = sample(x, z);
      }
    }
  }

  private layoutLakes(seed: number): Lake[] {
    const rng = new Rng(seed ^ 0xa5a5a5);
    const mainAngle = rng.range(0, Math.PI * 2);
    const mainDist = rng.range(44, 50);
    const lakes: Lake[] = [
      { x: Math.cos(mainAngle) * mainDist, z: Math.sin(mainAngle) * mainDist, r: rng.range(27, 31), depth: 4.5, phase: rng.range(0, 10) },
    ];
    const pondAngle = mainAngle + Math.PI + rng.range(-0.8, 0.8);
    const pondDist = rng.range(78, 95);
    lakes.push({ x: Math.cos(pondAngle) * pondDist, z: Math.sin(pondAngle) * pondDist, r: rng.range(13, 17), depth: 3, phase: rng.range(0, 10) });
    return lakes;
  }

  /**
   * Desert water is rare and small, like the springs, seeps and tinajas of the Sonoran and Chihuahuan deserts: a
   * spring pool a short walk from the start (the one sure source, with trout and cottonwoods), a shallow rock pool
   * (tinaja) out on the slickrock, and a white-rimmed alkali pool you can't drink. Then mesas, buttes and one
   * volcanic spire go where they won't wall off the water or the spawn.
   */
  private layoutDesert(seed: number): Lake[] {
    const rng = new Rng(seed ^ 0x5eedd35e);
    const upAngle = rng.range(0, Math.PI * 2);
    this.upDir.x = Math.cos(upAngle);
    this.upDir.z = Math.sin(upAngle);
    const polar = (a: number, d: number) => ({ x: Math.cos(a) * d, z: Math.sin(a) * d });

    const springAngle = upAngle + rng.range(-1.2, 1.2);
    const sp = polar(springAngle, rng.range(24, 27));
    const lakes: Lake[] = [{ ...sp, r: rng.range(6.2, 7.2), depth: 2.6, phase: rng.range(0, 10), kind: 'spring', drinkable: true, fish: true }];
    const clearOf = (x: number, z: number, r: number) => lakes.every((l) => Math.hypot(l.x - x, l.z - z) > (l.r + r) * 1.7 + 14);

    for (let i = 0; i < 40; i++) {
      const a = springAngle + Math.PI + rng.range(-1.3, 1.3);
      const p = polar(a, rng.range(44, 78));
      const r = rng.range(5, 6.4);
      if (!clearOf(p.x, p.z, r) && i < 39) continue;
      lakes.push({ ...p, r, depth: 0.7, phase: rng.range(0, 10), kind: 'alkali', drinkable: false, fish: false });
      break;
    }
    for (let i = 0; i < 40; i++) {
      const p = polar(rng.range(0, Math.PI * 2), rng.range(62, 112));
      const r = rng.range(3, 3.8);
      if (!clearOf(p.x, p.z, r) && i < 39) continue;
      lakes.push({ ...p, r, depth: 1.3, phase: rng.range(0, 10), kind: 'tinaja', drinkable: true, fish: false });
      this.slickPatches.push({ x: p.x, z: p.z, r: rng.range(15, 21) });
      break;
    }
    for (let i = 0; i < 30 && this.slickPatches.length < 3; i++) {
      const p = polar(rng.range(0, Math.PI * 2), rng.range(50, 125));
      if (this.upland(p.x, p.z) > 0.3) continue;
      this.slickPatches.push({ x: p.x, z: p.z, r: rng.range(14, 22) });
    }

    const plan: [Landform['kind'], number, number, number, number][] = [
      // kind, radius range, height range
      ['mesa', 15, 22, 14, 19],
      ['mesa', 12, 17, 12, 17],
      ['butte', 5, 7.5, 15, 22],
      ['butte', 4.5, 7, 11, 17],
      ['spire', 4.5, 5.5, 30, 36],
    ];
    for (const [kind, r0, r1, h0, h1] of plan) {
      for (let i = 0; i < 60; i++) {
        const p = polar(rng.range(0, Math.PI * 2), kind === 'spire' ? rng.range(95, 128) : rng.range(62, 132));
        const r = rng.range(r0, r1);
        const reach = r * 1.9;
        if (Math.abs(p.x) + reach > PLAY_HALF + 6 || Math.abs(p.z) + reach > PLAY_HALF + 6) continue;
        if (lakes.some((l) => Math.hypot(l.x - p.x, l.z - p.z) < l.r * 1.7 + reach + 12)) continue;
        if (this.landforms.some((m) => Math.hypot(m.x - p.x, m.z - p.z) < m.r * 1.9 + reach + 10)) continue;
        this.landforms.push({ kind, x: p.x, z: p.z, r, h: rng.range(h0, h1), phase: rng.range(0, 10) });
        break;
      }
    }
    const spire = this.landforms.find((m) => m.kind === 'spire');
    if (spire) {
      const a = Math.atan2(spire.z, spire.x) + rng.range(-1.1, 1.1);
      const len = rng.range(34, 48);
      this.dike = { x0: spire.x, z0: spire.z, x1: spire.x + Math.cos(a) * len, z1: spire.z + Math.sin(a) * len, h: rng.range(2.6, 3.6) };
    }
    return lakes;
  }

  /** Analytic height function used to build the grid. */
  sampleRaw(x: number, z: number): number {
    const n = this.noise;
    let h = 4 + n.fbm(x * 0.0065, z * 0.0065, 4) * 9;
    h += n.fbm(x * 0.021 + 71.3, z * 0.021 - 12.7, 3) * 1.8;
    if (h < 1) h = 1 + (h - 1) * 0.3;

    const ds = Math.hypot(x - this.spawn.x, z - this.spawn.z);
    h = lerp(2.3 + this.detail.get(x * 0.1, z * 0.1) * 0.15, h, smoothstep(8, 24, ds));

    for (const lake of this.lakes) {
      const dx = x - lake.x;
      const dz = z - lake.z;
      const ang = Math.atan2(dz, dx);
      const wobble = 1 + 0.16 * this.detail.get(Math.cos(ang) * 1.3 + lake.phase, Math.sin(ang) * 1.3 - lake.phase);
      const d = Math.hypot(dx, dz) / (lake.r * wobble);
      if (d < 1.7) {
        const floor = -lake.depth + this.detail.get(x * 0.05, z * 0.05) * 0.6;
        const bowl = lerp(floor, h, smoothstep(0.3, 1.45, d));
        h = Math.min(h, bowl);
      }
    }

    const e = Math.max(Math.abs(x), Math.abs(z)) / WORLD_HALF;
    const rim = smoothstep(0.74, 1.0, e);
    h += rim * rim * 42 * (0.8 + 0.4 * this.detail.get(x * 0.03, z * 0.03));
    return h;
  }

  /**
   * Desert heights: open, gently rolling red-sand plains (dry washes cut shallow channels), slickrock domes, a
   * higher rim of pinyon-juniper country on one side, steep-walled mesas and buttes, a volcanic spire with its dike,
   * the flat spawn, the pools, and a stepped cliff rim around the edge.
   */
  sampleDesert(x: number, z: number): number {
    const n = this.noise;
    let h = 3.4 + n.fbm(x * 0.006, z * 0.006, 4) * 3.4 + n.fbm(x * 0.03 + 13.1, z * 0.03 - 7.7, 2) * 0.45;
    h -= this.wash(x, z) * 0.9;
    const u = this.upland(x, z);
    h += u * 6.5 + u * n.fbm(x * 0.02 + 5.1, z * 0.02 + 9.4, 3) * 2.4;
    const slick = this.slickrock(x, z);
    if (slick > 0) h += slick * (0.5 + Math.abs(n.get(x * 0.085 + 3.3, z * 0.085 - 8.8)) * 1.8);
    for (const m of this.landforms) h += this.landformLift(m, x, z);
    if (this.dike) h += this.dikeLift(x, z);
    h = Math.max(h, 1.1);

    const ds = Math.hypot(x - this.spawn.x, z - this.spawn.z);
    h = lerp(2.8 + this.detail.get(x * 0.1, z * 0.1) * 0.12, h, smoothstep(8, 24, ds));

    for (const lake of this.lakes) {
      const dx = x - lake.x;
      const dz = z - lake.z;
      const ang = Math.atan2(dz, dx);
      const wobble = 1 + 0.14 * this.detail.get(Math.cos(ang) * 1.3 + lake.phase, Math.sin(ang) * 1.3 - lake.phase);
      const d = Math.hypot(dx, dz) / (lake.r * wobble);
      if (d < 1.9) {
        const floor = -lake.depth + this.detail.get(x * 0.07, z * 0.07) * 0.25;
        // Rock pools are steep-sided; the alkali pan is a wide, flat, shallow dish.
        const edge = lake.kind === 'tinaja' ? smoothstep(0.35, 1.25, d) : lake.kind === 'alkali' ? smoothstep(0.55, 1.8, d) : smoothstep(0.3, 1.5, d);
        h = Math.min(h, lerp(floor, h, edge));
      }
    }

    const e = Math.max(Math.abs(x), Math.abs(z)) / WORLD_HALF;
    const rim = smoothstep(0.74, 1.0, e);
    const lift = rim * rim * 40 * (0.8 + 0.4 * this.detail.get(x * 0.03, z * 0.03));
    const step = lift / 6.5;
    const fl = Math.floor(step);
    h += (fl + smoothstep(0.55, 0.92, step - fl)) * 6.5;
    return h;
  }

  private landformLift(m: Landform, x: number, z: number): number {
    const dx = x - m.x;
    const dz = z - m.z;
    const far = m.r * 2;
    if (dx > far || dx < -far || dz > far || dz < -far) return 0;
    const ang = Math.atan2(dz, dx);
    const amp = m.kind === 'mesa' ? 0.16 : m.kind === 'butte' ? 0.1 : 0.22;
    const wob = 1 + amp * this.detail.get(Math.cos(ang) * 1.7 + m.phase, Math.sin(ang) * 1.7 - m.phase);
    const d = Math.hypot(dx, dz) / (m.r * wob);
    if (d > 1.9) return 0;
    const talus = 1 - smoothstep(0.95, 1.9, d);
    if (m.kind === 'spire') return m.h * Math.pow(1 - smoothstep(0, 1.05, d), 0.55) + m.h * 0.08 * talus * talus;
    const cap = 1 - smoothstep(0.86, 1.0, d);
    return m.h * (0.8 * cap + 0.2 * talus * talus);
  }

  private dikeLift(x: number, z: number): number {
    const k = this.dike!;
    const vx = k.x1 - k.x0;
    const vz = k.z1 - k.z0;
    const len2 = vx * vx + vz * vz;
    const t = Math.max(0, Math.min(1, ((x - k.x0) * vx + (z - k.z0) * vz) / len2));
    const d = Math.hypot(x - (k.x0 + vx * t), z - (k.z0 + vz * t));
    if (d > 2.6) return 0;
    const taper = 1 - smoothstep(0.75, 1, t);
    return k.h * taper * (1 - smoothstep(0.7, 2.6, d)) * (0.85 + 0.3 * this.detail.get(t * 9, 3.7));
  }

  /** 0..1 inside a dry wash channel (desert only). */
  wash(x: number, z: number): number {
    if (this.biome !== 'desert') return 0;
    return smoothstep(0.93, 0.99, 1 - Math.abs(this.noise.get(x * 0.011 + 50.3, z * 0.011 - 21.9)));
  }

  /** 0 on the low desert, rising to 1 in the pinyon-juniper and ponderosa high country (desert only). */
  upland(x: number, z: number): number {
    if (this.biome !== 'desert') return 0;
    const along = x * this.upDir.x + z * this.upDir.z;
    return smoothstep(45, 100, along + this.noise.get(x * 0.01 + 91.7, z * 0.01 - 33.1) * 22);
  }

  /** 0..1 bare sandstone slickrock (desert only). */
  slickrock(x: number, z: number): number {
    let s = 0;
    for (const p of this.slickPatches) {
      const d = Math.hypot(x - p.x, z - p.z) / (p.r * (1 + 0.25 * this.detail.get(x * 0.05 + p.r, z * 0.05)));
      if (d < 1) s = Math.max(s, 1 - smoothstep(0.55, 1, d));
    }
    return s;
  }

  /**
   * How much a point belongs to a mesa, butte or spire (1 on its cliffs and top, fading out over the talus);
   * `volcanic` marks the spire and its dike.
   */
  landformAt(x: number, z: number): { rock: number; volcanic: boolean } {
    let rock = 0;
    let volcanic = false;
    for (const m of this.landforms) {
      const d = Math.hypot(x - m.x, z - m.z) / m.r;
      const v = 1 - smoothstep(1.0, 1.35, d);
      if (v > rock) {
        rock = v;
        volcanic = m.kind === 'spire';
      }
    }
    if (this.dike && this.dikeLift(x, z) > 0.4) {
      rock = Math.max(rock, 1);
      volcanic = true;
    }
    return { rock, volcanic };
  }

  /** The pool or lake a water point belongs to, or null on dry land. */
  lakeAt(x: number, z: number): Lake | null {
    let best: Lake | null = null;
    let bd = 1.35;
    for (const l of this.lakes) {
      const d = Math.hypot(x - l.x, z - l.z) / l.r;
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    return best;
  }

  private vert(i: number, j: number): number {
    if (i < 0) i = 0;
    else if (i > TERRAIN_CELLS) i = TERRAIN_CELLS;
    if (j < 0) j = 0;
    else if (j > TERRAIN_CELLS) j = TERRAIN_CELLS;
    return this.heights[j * TERRAIN_VERTS + i];
  }

  heightAt(x: number, z: number): number {
    const gx = (x + WORLD_HALF) / TERRAIN_CELL;
    const gz = (z + WORLD_HALF) / TERRAIN_CELL;
    let i = Math.floor(gx);
    let j = Math.floor(gz);
    if (i < 0) i = 0;
    else if (i > TERRAIN_CELLS - 1) i = TERRAIN_CELLS - 1;
    if (j < 0) j = 0;
    else if (j > TERRAIN_CELLS - 1) j = TERRAIN_CELLS - 1;
    const fx = Math.min(1, Math.max(0, gx - i));
    const fz = Math.min(1, Math.max(0, gz - j));
    const h00 = this.vert(i, j);
    const h10 = this.vert(i + 1, j);
    const h01 = this.vert(i, j + 1);
    const h11 = this.vert(i + 1, j + 1);
    if (fz > fx) return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
    return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
  }

  /** Terrain gradient magnitude (rise over run) at a point. */
  slopeAt(x: number, z: number): number {
    const e = 0.5;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.sqrt(dx * dx + dz * dz);
  }

  waterDepth(x: number, z: number): number {
    const d = WATER_LEVEL - this.heightAt(x, z);
    return d > 0 ? d : 0;
  }

  inPlayBounds(x: number, z: number, margin = 0): boolean {
    return Math.abs(x) <= PLAY_HALF - margin && Math.abs(z) <= PLAY_HALF - margin;
  }

  /** Low-frequency field for biome decisions (forest density, meadows). */
  field(x: number, z: number, layer: number): number {
    return this.noise.get(x * 0.012 + layer * 37.1, z * 0.012 - layer * 11.3) * 0.5 + 0.5;
  }

  /** First terrain/water hit along a ray within maxDist, or -1. Writes hit point to out. */
  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number, out: { x: number; y: number; z: number; water: boolean },
  ): number {
    const step = 0.2;
    let prevT = 0;
    for (let t = step; t <= maxDist + 1e-6; t += step) {
      const x = ox + dx * t;
      const y = oy + dy * t;
      const z = oz + dz * t;
      const ground = this.heightAt(x, z);
      const surface = Math.max(ground, WATER_LEVEL);
      const above = y - surface;
      if (above <= 0) {
        // refine between prevT and t
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) * 0.5;
          const mx = ox + dx * mid;
          const mz = oz + dz * mid;
          const my = oy + dy * mid;
          const s = Math.max(this.heightAt(mx, mz), WATER_LEVEL);
          if (my - s <= 0) hi = mid;
          else lo = mid;
        }
        out.x = ox + dx * hi;
        out.y = oy + dy * hi;
        out.z = oz + dz * hi;
        out.water = this.heightAt(out.x, out.z) < WATER_LEVEL;
        return hi;
      }
      prevT = t;
    }
    return -1;
  }
}

const cache = new Map<string, Terrain>();

export function getTerrain(seed: number, biome: BiomeId = DEFAULT_BIOME): Terrain {
  const key = `${biome}:${seed}`;
  let t = cache.get(key);
  if (!t) {
    t = new Terrain(seed, biome);
    cache.set(key, t);
  }
  return t;
}
