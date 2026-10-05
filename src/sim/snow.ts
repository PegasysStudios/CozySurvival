import { circle, footprintSamples, overlaps } from '../core/geom2d';
import { clamp, smoothstep } from '../core/math';
import { hash2, Rng } from '../core/rng';
import { RESOURCES } from '../data/resources';
import { Occupancy } from './occupancy';
import { footprintShape } from './placement';
import { SEASON_DAYS, type SeasonState } from './seasons';
import type { GameState } from './state';
import { PLAY_HALF, WATER_LEVEL, type Terrain } from './terrain';
import { topHeight } from './colliders';
import { rockTop, TRUNK_AXIS_LIFT } from './trunks';
import type { ResourceGen, WorldGen } from './worldgen';

export interface SnowPatch {
  surface: 'ground' | 'log' | 'rock';
  ref: number;
  /** Elliptical footprint and maximum depth of a clump, in metres. */
  ax: number;
  az: number;
  depth: number;
}

/** Winter cover becomes scattered spring remnants. Each fixed patch has its own melt deadline. */
export function snowScale(seed: number, spot: number, season: SeasonState | undefined, hours: number): number {
  if (season?.id === 'winter') return 1;
  if (season?.id !== 'spring' || hash2(spot, 211, seed) >= 0.25) return 0;
  const elapsed = Math.max(0, hours / 24 - (season.startDay - 1));
  if (elapsed >= SEASON_DAYS - 1) return 0;
  const meltsAt = 4 + hash2(spot, 212, seed) * (SEASON_DAYS - 5);
  return 0.8 * (1 - smoothstep(0, meltsAt, elapsed));
}

export function snowCovered(r: ResourceGen, state: GameState): boolean {
  const p = r.snow;
  if (!p) return false;
  const shape = circle(r.x, r.z, Math.max(p.ax, p.az));
  return state.structures.some((s) => overlaps(shape, footprintShape(s.prefab, s.x, s.z, s.rot)));
}

export function snowAmount(r: ResourceGen, state: GameState, index: number): number {
  if (!r.snow || snowCovered(r, state)) return 0;
  const charges = state.resources[index]?.charges ?? 0;
  return snowScale(state.seed, r.spot, state.season, state.totalHours) * Math.cbrt(clamp(charges / RESOURCES.snowClump.charges, 0, 1));
}

/** The solid surface beneath a patch; shrinking never leaves it floating above its support. */
export function snowSurface(t: Terrain, gen: WorldGen, r: ResourceGen, x = r.x, z = r.z): number {
  const p = r.snow;
  if (p?.surface === 'log') {
    const log = gen.logs[p.ref];
    const dx = x - log.x, dz = z - log.z;
    const localZ = dx * Math.sin(log.rot) + dz * Math.cos(log.rot);
    return t.heightAt(log.x, log.z) + log.r * TRUNK_AXIS_LIFT + Math.sqrt(Math.max(0, log.r ** 2 - localZ ** 2));
  }
  if (p?.surface === 'rock') {
    const rock = gen.rocks[p.ref];
    return topHeight(rockTop(rock, t.heightAt(rock.x, rock.z)), x, z, 0, t);
  }
  return t.heightAt(x, z);
}

/** Appended with a separate RNG: existing forage spots, tree indices and their saved state never move. */
export function generateSnow(t: Terrain, gen: WorldGen): ResourceGen[] {
  if (gen.biome !== 'pnw') return [];
  const rng = new Rng(gen.seed ^ 0x51a07e);
  const occupied = new Occupancy();
  gen.trees.forEach((tree) => occupied.add(tree.x, tree.z, tree.trunkR + 0.5));
  gen.rocks.forEach((rock) => occupied.add(rock.x, rock.z, rock.r * 1.6));
  gen.logs.forEach((log) => occupied.add(log.x, log.z, log.length / 2 + 0.3));
  const out: ResourceGen[] = [];
  const samples: number[] = [];
  const add = (x: number, z: number, rot: number, snow: SnowPatch) => {
    const r: ResourceGen = { kind: 'snowClump', x, z, rot, scale: 1, spot: gen.resourceSpots + out.length, snow };
    r.y = snowSurface(t, gen, r);
    out.push(r);
  };
  const ground = (x: number, z: number): boolean => {
    const size = rng.range(0.7, 1.25);
    if (!t.inPlayBounds(x, z, 3) || t.slopeAt(x, z) > 0.55 || t.heightAt(x, z) > 24 || !occupied.free(x, z, size + 0.2)) return false;
    footprintSamples(circle(x, z, size), samples);
    for (let i = 0; i < samples.length; i += 2) if (t.heightAt(samples[i], samples[i + 1]) < WATER_LEVEL + 0.3) return false;
    occupied.add(x, z, size);
    add(x, z, rng.range(0, Math.PI * 2), { surface: 'ground', ref: -1, ax: size, az: size * rng.range(0.7, 1), depth: rng.range(0.2, 0.4) });
    return true;
  };
  // A reliable winter water source a short walk from the starter camp.
  for (let i = 0, placed = 0; i < 200 && placed < 8; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(5, 19);
    if (ground(t.spawn.x + Math.cos(a) * d, t.spawn.z + Math.sin(a) * d)) placed++;
  }
  for (let x = -PLAY_HALF + 4; x < PLAY_HALF - 4; x += 13) {
    for (let z = -PLAY_HALF + 4; z < PLAY_HALF - 4; z += 13) {
      const px = x + rng.range(0, 9), pz = z + rng.range(0, 9);
      if (rng.chance(0.65)) ground(px, pz);
    }
  }
  gen.logs.forEach((log, ref) => {
    for (const f of [-0.25, 0.25]) {
      const along = log.length * f;
      add(log.x + Math.cos(log.rot) * along, log.z - Math.sin(log.rot) * along, log.rot,
        { surface: 'log', ref, ax: Math.min(0.65, log.length * 0.2), az: log.r * 0.7, depth: rng.range(0.18, 0.28) });
    }
  });
  gen.rocks.forEach((rock, ref) => {
    if (!rng.chance(0.5)) return;
    const radius = rock.r * rng.range(0.35, 0.5);
    add(rock.x, rock.z, rock.rot, { surface: 'rock', ref, ax: radius, az: radius * 0.8, depth: rng.range(0.2, 0.4) });
  });
  return out;
}
