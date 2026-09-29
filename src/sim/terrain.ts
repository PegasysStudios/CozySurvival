import { lerp, smoothstep } from '../core/math';
import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';

export const WORLD_SIZE = 320;
export const WORLD_HALF = WORLD_SIZE / 2;
export const TERRAIN_CELL = 2;
export const TERRAIN_CELLS = WORLD_SIZE / TERRAIN_CELL;
export const TERRAIN_VERTS = TERRAIN_CELLS + 1;
export const WATER_LEVEL = 0;
/** Walkable area stops a little before the mountain rim. */
export const PLAY_HALF = WORLD_HALF - 12;

export interface Lake {
  x: number;
  z: number;
  r: number;
  depth: number;
  phase: number;
}

/**
 * Heightfield terrain. `heightAt` interpolates the exact triangles used by the render mesh
 * (each cell split along its (x0,z0)-(x1,z1) diagonal) so feet never float or sink.
 */
export class Terrain {
  readonly seed: number;
  readonly heights: Float32Array;
  readonly lakes: Lake[];
  readonly spawn = { x: 0, z: 0 };
  /** Forest density field in [0, 1] used by worldgen and scatter. */
  private readonly noise: Noise2D;
  private readonly detail: Noise2D;

  constructor(seed: number) {
    this.seed = seed;
    this.noise = new Noise2D(seed ^ 0x9e3779b9);
    this.detail = new Noise2D(seed ^ 0x51ed270b);
    const rng = new Rng(seed ^ 0xa5a5a5);
    const mainAngle = rng.range(0, Math.PI * 2);
    const mainDist = rng.range(44, 50);
    this.lakes = [
      { x: Math.cos(mainAngle) * mainDist, z: Math.sin(mainAngle) * mainDist, r: rng.range(27, 31), depth: 4.5, phase: rng.range(0, 10) },
    ];
    const pondAngle = mainAngle + Math.PI + rng.range(-0.8, 0.8);
    const pondDist = rng.range(78, 95);
    this.lakes.push({ x: Math.cos(pondAngle) * pondDist, z: Math.sin(pondAngle) * pondDist, r: rng.range(13, 17), depth: 3, phase: rng.range(0, 10) });

    this.heights = new Float32Array(TERRAIN_VERTS * TERRAIN_VERTS);
    for (let j = 0; j < TERRAIN_VERTS; j++) {
      for (let i = 0; i < TERRAIN_VERTS; i++) {
        const x = -WORLD_HALF + i * TERRAIN_CELL;
        const z = -WORLD_HALF + j * TERRAIN_CELL;
        this.heights[j * TERRAIN_VERTS + i] = this.sampleRaw(x, z);
      }
    }
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

const cache = new Map<number, Terrain>();

export function getTerrain(seed: number): Terrain {
  let t = cache.get(seed);
  if (!t) {
    t = new Terrain(seed);
    cache.set(seed, t);
  }
  return t;
}
