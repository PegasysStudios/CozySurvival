import { clamp, lerp, smoothstep } from '../core/math';
import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';
import type { Lake } from './terrain';

/** Missing on saved runs means the original forest. Never migrate its indexed scenery to this layout. */
export type PnwGeneration = 1 | 2;
export const PNW_GENERATION: PnwGeneration = 2;
export const PNW_PLAY_HALF = 296;
/** Double the old 296 m movement square, retaining the 12 m terrain margin on each side. */
export const PNW_WORLD_SIZE = PNW_PLAY_HALF * 2 + 24;
export const PNW_LAKE_SHARE = 0.19;

export interface Meadow {
  x: number;
  z: number;
  ax: number;
  az: number;
  angle: number;
}

export interface ForestStream {
  pts: Float32Array;
  halfWidth: number;
  ford: { x: number; z: number };
  water: Lake;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** Seeded landmarks first, then terrain and vegetation follow the same region rules, as on the island. */
export class PnwLayout {
  readonly lakes: Lake[];
  readonly meadow: Meadow;
  readonly stream: ForestStream;
  readonly spawn: { x: number; z: number };
  private readonly noise: Noise2D;
  private readonly detail: Noise2D;
  private readonly shoreFactors = new Map<Lake, number>();

  constructor(seed: number) {
    const rng = new Rng(seed ^ 0x706e7732);
    this.noise = new Noise2D(seed ^ 0x9e3779b9);
    this.detail = new Noise2D(seed ^ 0x51ed270b);
    const angle = rng.range(0, Math.PI * 2);
    const ux = Math.cos(angle), uz = Math.sin(angle);
    const vx = -uz, vz = ux;
    const polar = (along: number, across: number) => ({ x: ux * along + vx * across, z: uz * along + vz * across });
    const main: Lake = { ...polar(rng.range(65, 85), rng.range(-10, 10)), r: 1, depth: 4.8, phase: rng.range(0, 10) };
    // Normalize the irregular outline's actual polar area; radius alone is not the water footprint.
    let meanSquare = 0;
    for (let i = 0; i < 512; i++) meanSquare += this.shoreShape(main, i * Math.PI * 2 / 512) ** 2 / 512;
    this.shoreFactors.set(main, 1 / Math.sqrt(meanSquare));
    main.r = Math.sqrt((PNW_PLAY_HALF * 2) ** 2 * PNW_LAKE_SHARE / Math.PI);
    const pond: Lake = { ...polar(rng.range(-210, -190), rng.range(-22, 22)), r: rng.range(23, 28), depth: 2.7, phase: rng.range(0, 10) };
    this.lakes = [main, pond];
    if (rng.chance(0.6)) this.lakes.push({ ...polar(rng.range(5, 45), rng.range(-225, -205)), r: rng.range(16, 21), depth: 2.1, phase: rng.range(0, 10) });
    this.meadow = { ...polar(rng.range(-35, -5), rng.range(193, 207)), ax: rng.range(58, 68), az: rng.range(38, 46), angle };

    const spawnAngle = angle + Math.PI - 0.65;
    const sr = this.shoreRadius(main, spawnAngle) + 13;
    this.spawn = { x: main.x + Math.cos(spawnAngle) * sr, z: main.z + Math.sin(spawnAngle) * sr };
    const streamAngle = Math.atan2(pond.z - main.z, pond.x - main.x);
    const reach = this.shoreRadius(main, streamAngle) - 8;
    const start = { x: main.x + Math.cos(streamAngle) * reach, z: main.z + Math.sin(streamAngle) * reach };
    const dx = pond.x - start.x, dz = pond.z - start.z;
    const length = Math.hypot(dx, dz);
    const bend = rng.range(9, 16) * (rng.chance(0.5) ? 1 : -1);
    const pts = new Float32Array(42);
    for (let i = 0; i <= 20; i++) {
      const f = i / 20;
      const offset = Math.sin(f * Math.PI) * bend + Math.sin(f * Math.PI * 3) * 3;
      pts[i * 2] = start.x + dx * f - dz / length * offset;
      pts[i * 2 + 1] = start.z + dz * f + dx / length * offset;
    }
    this.stream = {
      pts, halfWidth: rng.range(2.4, 3.2), ford: { x: pts[20], z: pts[21] },
      water: { x: pts[20], z: pts[21], r: 3, depth: 0.9, phase: 0, kind: 'stream', drinkable: true, fish: true },
      minX: Math.min(...Array.from(pts).filter((_, i) => i % 2 === 0)),
      maxX: Math.max(...Array.from(pts).filter((_, i) => i % 2 === 0)),
      minZ: Math.min(...Array.from(pts).filter((_, i) => i % 2 === 1)),
      maxZ: Math.max(...Array.from(pts).filter((_, i) => i % 2 === 1)),
    };
  }

  private shoreShape(lake: Lake, angle: number): number {
    return 1 + 0.065 * Math.sin(angle * 2 + lake.phase) + 0.04 * Math.sin(angle * 3 - lake.phase)
      + 0.035 * this.detail.get(Math.cos(angle) * 2 + lake.phase, Math.sin(angle) * 2 - lake.phase);
  }

  shoreRadius(lake: Lake, angle: number): number {
    return lake.r * this.shoreShape(lake, angle) * (this.shoreFactors.get(lake) ?? 1);
  }

  meadowAt(x: number, z: number): number {
    const m = this.meadow;
    const dx = x - m.x, dz = z - m.z;
    const c = Math.cos(m.angle), s = Math.sin(m.angle);
    const d = Math.hypot((dx * c + dz * s) / m.ax, (-dx * s + dz * c) / m.az);
    const wobble = 1 + this.detail.get(x * 0.025, z * 0.025) * 0.08;
    return 1 - smoothstep(0.7, 1.15, d / wobble);
  }

  streamDistance(x: number, z: number, reach = Infinity): number {
    const s = this.stream;
    if (x < s.minX - reach || x > s.maxX + reach || z < s.minZ - reach || z > s.maxZ + reach) return Infinity;
    const pts = this.stream.pts;
    let best = Infinity;
    for (let i = 0; i + 3 < pts.length; i += 2) best = Math.min(best, segmentDistance(x, z, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]));
    return best;
  }

  waterAt(x: number, z: number): Lake | null {
    for (const lake of this.lakes) {
      const dx = x - lake.x, dz = z - lake.z;
      if (Math.hypot(dx, dz) <= this.shoreRadius(lake, Math.atan2(dz, dx)) + 3) return lake;
    }
    return this.streamDistance(x, z, this.stream.halfWidth + 3) < this.stream.halfWidth + 3 ? this.stream.water : null;
  }

  /** Broad, gentle forest floor and banks keep exploration routes usable without inflating prop sizes. */
  sample(x: number, z: number): number {
    let h = Math.max(1.2, 4 + this.noise.fbm(x * 0.0065, z * 0.0065, 4) * 4.5
      + this.noise.fbm(x * 0.021 + 71.3, z * 0.021 - 12.7, 3) * 0.9);
    h = lerp(h, 2.5 + this.detail.get(x * 0.035, z * 0.035) * 0.3, this.meadowAt(x, z));
    const spawnDist = Math.hypot(x - this.spawn.x, z - this.spawn.z);
    h = lerp(2.3 + this.detail.get(x * 0.1, z * 0.1) * 0.15, h, smoothstep(8, 24, spawnDist));
    // Rim begins outside the main exploration loop, leaving much more of the bounds usable than the old rim.
    const edge = Math.max(Math.abs(x), Math.abs(z)) / (PNW_WORLD_SIZE / 2);
    h += smoothstep(0.87, 1, edge) ** 2 * 42 * (0.8 + this.detail.get(x * 0.03, z * 0.03) * 0.4);

    for (const lake of this.lakes) {
      const dx = x - lake.x, dz = z - lake.z;
      const dist = Math.hypot(dx, dz);
      const shore = this.shoreRadius(lake, Math.atan2(dz, dx));
      if (dist < shore) {
        // Keep the shoreline shelf in metres, so scaling the lake doesn't put castable water out of reach.
        h = Math.min(h, -lake.depth * smoothstep(0, lake === this.lakes[0] ? 20 : 14, shore - dist));
      } else if (dist < shore + 40) {
        const bank = (dist - shore) * 0.2;
        h = lerp(Math.min(h, bank), h, smoothstep(18, 40, dist - shore));
      }
    }
    const width = this.stream.halfWidth;
    const sd = this.streamDistance(x, z, width + 18);
    if (sd < width + 18) {
      // A wide shallow ford preserves a land route between the two banks.
      const ford = 1 - smoothstep(5, 14, Math.hypot(x - this.stream.ford.x, z - this.stream.ford.z));
      const depth = lerp(0.9, 0.3, ford);
      const bed = sd < width ? -depth * (1 - smoothstep(0.25, 1, sd / width)) : (sd - width) * 0.18;
      h = lerp(Math.min(h, bed), h, smoothstep(width + 8, width + 18, sd));
    }
    return h;
  }
}
