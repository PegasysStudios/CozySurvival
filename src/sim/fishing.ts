import type { Rng } from '../core/rng';
import type { FishingCatch } from '../data/fishing';
import { holdsFish, isDrinkable, pnwLakeHoldsFish, type Terrain } from './terrain';

const NONE: readonly FishingCatch[] = [];
const TROUT: readonly FishingCatch[] = ['trout'];
const MAIN_LAKE: readonly FishingCatch[] = ['trout', 'bass', 'salmon'];
const REEF: readonly FishingCatch[] = ['parrotfish'];
const STREAM: readonly FishingCatch[] = ['goby'];

/** Species eligibility follows the lure's water body, never the player's position or nearest lake. */
export function fishingPoolAt(terrain: Terrain, x: number, z: number): readonly FishingCatch[] {
  const lake = terrain.lakeAt(x, z);
  if (lake && !holdsFish(lake)) return NONE;
  if (terrain.biome !== 'pnw') return terrain.island ? lake?.kind === 'sea' ? REEF : STREAM : TROUT;
  if (!lake || !isDrinkable(lake)) return NONE;
  // The existing continuous stream is trout habitat; its r describes channel width, not pond size.
  if (lake.kind === 'stream') return TROUT;
  if (!pnwLakeHoldsFish(lake)) return NONE;
  if (lake !== terrain.lakes[0]) return TROUT;
  // waterAt has a shoreline tolerance for terrain interpolation. A stream just outside the main lake's
  // actual outline must still yield only trout, even inside that classification tolerance.
  if (terrain.pnw) {
    const dx = x - lake.x, dz = z - lake.z;
    if (Math.hypot(dx, dz) > terrain.pnw.shoreRadius(lake, Math.atan2(dz, dx))) return TROUT;
  }
  return MAIN_LAKE;
}

/** Equal species odds in the main lake; single-species water consumes no extra gameplay RNG draw. */
export function chooseFishingCatch(pool: readonly FishingCatch[], rng: Rng): FishingCatch | null {
  return pool.length === 0 ? null : pool.length === 1 ? pool[0] : rng.pick(pool);
}
