import { boundingRadius, box, circle, footprintSamples, overlaps, type Shape2D } from '../core/geom2d';
import { BALANCE } from '../data/balance';
import { PLACE_MAX_DIST, PLACE_MIN_DIST, PREFABS, type PrefabId } from '../data/prefabs';
import type { Collider, ColliderKind } from './colliders';
import { WATER_LEVEL, type Terrain } from './terrain';

export type PlacementReason =
  | 'bounds'
  | 'distance'
  | 'water'
  | 'slope'
  | 'player'
  | ColliderKind;

export const PLACEMENT_REASON_TEXT: Record<PlacementReason, string> = {
  bounds: 'Too close to the mountains',
  distance: 'Too far away',
  water: "Can't build on water",
  slope: 'Ground is too steep',
  player: "You're standing there",
  tree: 'Too close to a tree',
  stump: 'A stump is in the way',
  rock: 'A boulder is in the way',
  log: 'A fallen log is in the way',
  trunk: 'A felled trunk is in the way. Chop it up first',
  structure: 'Overlaps another structure',
  resource: 'Plants or items are in the way',
};

export interface PlacementEnv {
  terrain: Terrain;
  query(x: number, z: number, r: number, out: Collider[]): Collider[];
  playerX: number;
  playerZ: number;
  /** Colliders that should not block building right now (e.g. gathered-out plants that are hidden). */
  ignore?(c: Collider): boolean;
}

export interface PlacementResult {
  valid: boolean;
  reason: PlacementReason | null;
  /** Height to seat the structure at. */
  y: number;
}

export function footprintShape(prefab: PrefabId, x: number, z: number, rot: number): Shape2D {
  const f = PREFABS[prefab].footprint;
  return f.type === 'circle' ? circle(x, z, f.r) : box(x, z, f.hw, f.hd, rot);
}

export function colliderShape(prefab: PrefabId, x: number, z: number, rot: number): Shape2D {
  const f = PREFABS[prefab].collider;
  return f.type === 'circle' ? circle(x, z, f.r) : box(x, z, f.hw, f.hd, rot);
}

const samples: number[] = [];
const nearby: Collider[] = [];

/**
 * Validates a building spot. Checks run cheapest-first: bounds, reach, water, slope,
 * then footprint overlap against the player, trees, stumps, rocks, logs, structures, and resources.
 */
export function checkPlacement(env: PlacementEnv, prefab: PrefabId, x: number, z: number, rot: number): PlacementResult {
  const def = PREFABS[prefab];
  const t = env.terrain;
  const shape = footprintShape(prefab, x, z, rot);
  const y = t.heightAt(x, z);
  const fail = (reason: PlacementReason): PlacementResult => ({ valid: false, reason, y });

  if (!t.inPlayBounds(x, z, 3)) return fail('bounds');
  const d = Math.hypot(x - env.playerX, z - env.playerZ);
  if (d > PLACE_MAX_DIST + 0.5 || d < PLACE_MIN_DIST * 0.5) return fail('distance');

  footprintSamples(shape, samples);
  let minH = Infinity;
  let maxH = -Infinity;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 2) {
    const h = t.heightAt(samples[i], samples[i + 1]);
    if (h < WATER_LEVEL + 0.15) return fail('water');
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
    sum += h;
  }
  if (maxH - minH > def.maxHeightDelta) return fail('slope');

  if (overlaps(shape, circle(env.playerX, env.playerZ, BALANCE.player.radius + 0.05))) return fail('player');

  env.query(x, z, boundingRadius(shape) + 3, nearby);
  let found: PlacementReason | null = null;
  for (const c of nearby) {
    if (!c.footprint || env.ignore?.(c)) continue;
    if (overlaps(shape, c.footprint)) {
      found = c.kind;
      if (c.kind === 'tree' || c.kind === 'structure') break;
    }
  }
  if (found) return fail(found);
  return { valid: true, reason: null, y: sum / (samples.length / 2) };
}
