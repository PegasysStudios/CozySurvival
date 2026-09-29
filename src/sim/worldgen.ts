import { smoothstep } from '../core/math';
import { Rng } from '../core/rng';
import { SpatialGrid } from '../core/spatialGrid';
import { RESOURCES, TREES, type ResourceKind, type TreeSpecies } from '../data/resources';
import { getTerrain, PLAY_HALF, type Terrain } from './terrain';

export interface TreeGen {
  x: number;
  z: number;
  species: TreeSpecies;
  scale: number;
  rot: number;
  trunkR: number;
  tint: number;
}

export interface ResourceGen {
  x: number;
  z: number;
  kind: ResourceKind;
  rot: number;
  scale: number;
  /** Index among all candidate forage spots (grown or not); saves key resource state by it. */
  spot: number;
}

export interface RockGen {
  x: number;
  z: number;
  r: number;
  scaleY: number;
  rot: number;
  variant: number;
  tint: number;
}

export interface LogGen {
  x: number;
  z: number;
  rot: number;
  length: number;
  r: number;
}

export interface WorldGen {
  seed: number;
  trees: TreeGen[];
  resources: ResourceGen[];
  /** Number of candidate forage spots, including the ones where nothing grows. */
  resourceSpots: number;
  rocks: RockGen[];
  logs: LogGen[];
}

interface Occ {
  x: number;
  z: number;
  r: number;
}

export const SPAWN_CLEAR_RADIUS = 12;

class Occupancy {
  private readonly grid = new SpatialGrid<Occ>(6);
  private readonly tmp: Occ[] = [];

  free(x: number, z: number, r: number): boolean {
    this.grid.query(x, z, r + 3, this.tmp);
    for (const o of this.tmp) {
      const dx = o.x - x;
      const dz = o.z - z;
      const min = o.r + r;
      if (dx * dx + dz * dz < min * min) return false;
    }
    return true;
  }

  add(x: number, z: number, r: number): void {
    this.grid.insert({ x, z, r }, x, z, r);
  }
}

function dryAndGentle(t: Terrain, x: number, z: number, minHeight: number, maxSlope: number): boolean {
  if (!t.inPlayBounds(x, z, 2)) return false;
  if (t.heightAt(x, z) < minHeight) return false;
  return t.slopeAt(x, z) <= maxSlope;
}

function pickSpecies(t: Terrain, x: number, z: number, rng: Rng): TreeSpecies {
  const h = t.heightAt(x, z);
  if (t.field(x, z, 4) > 0.64 && rng.chance(0.75)) return 'birch';
  if (t.field(x, z, 5) > 0.67 && rng.chance(0.7)) return 'maple';
  if (h < 3 && rng.chance(0.45)) return 'cedar';
  return rng.chance(0.18) ? 'cedar' : 'fir';
}

export function generateWorld(seed: number): WorldGen {
  const t = getTerrain(seed);
  const rng = new Rng(seed ^ 0x7f4a7c15);
  const occ = new Occupancy();
  const trees: TreeGen[] = [];
  const rocks: RockGen[] = [];
  const logs: LogGen[] = [];
  const resources: ResourceGen[] = [];
  const sx = t.spawn.x;
  const sz = t.spawn.z;
  const spawnDist = (x: number, z: number) => Math.hypot(x - sx, z - sz);

  // Boulders
  const rockCell = 13;
  for (let gx = -PLAY_HALF; gx < PLAY_HALF; gx += rockCell) {
    for (let gz = -PLAY_HALF; gz < PLAY_HALF; gz += rockCell) {
      const x = gx + rng.range(0, rockCell);
      const z = gz + rng.range(0, rockCell);
      const rocky = t.field(x, z, 3);
      const shore = t.heightAt(x, z) < 1.6 ? 0.25 : 0;
      if (!rng.chance(0.08 + rocky * 0.28 + shore)) continue;
      if (spawnDist(x, z) < 10) continue;
      if (!dryAndGentle(t, x, z, -0.6, 1.3)) continue;
      const r = rng.range(0.7, 2.1);
      if (!occ.free(x, z, r + 0.4)) continue;
      occ.add(x, z, r);
      rocks.push({ x, z, r, scaleY: rng.range(0.55, 0.9), rot: rng.range(0, Math.PI * 2), variant: rng.int(0, 2), tint: rng.next() });
    }
  }

  const addTree = (x: number, z: number, species: TreeSpecies, scale: number): boolean => {
    const trunkR = TREES[species].trunkRadius * scale;
    if (!occ.free(x, z, trunkR + 1.4)) return false;
    occ.add(x, z, trunkR + 0.4);
    trees.push({ x, z, species, scale, rot: rng.range(0, Math.PI * 2), trunkR, tint: rng.next() });
    return true;
  };

  // Guaranteed birches near spawn so bark (canteen, torch) is discoverable early.
  let birchesNear = 0;
  for (let attempt = 0; attempt < 200 && birchesNear < 4; attempt++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(15, 28);
    const x = sx + Math.cos(a) * d;
    const z = sz + Math.sin(a) * d;
    if (!dryAndGentle(t, x, z, 0.9, 0.6)) continue;
    if (addTree(x, z, 'birch', rng.range(0.85, 1.1))) birchesNear++;
  }

  // Forest
  const treeCell = 5.4;
  for (let gx = -PLAY_HALF; gx < PLAY_HALF; gx += treeCell) {
    for (let gz = -PLAY_HALF; gz < PLAY_HALF; gz += treeCell) {
      const x = gx + rng.range(0.4, treeCell - 0.4);
      const z = gz + rng.range(0.4, treeCell - 0.4);
      const density = 0.12 + 0.78 * smoothstep(0.28, 0.68, t.field(x, z, 1));
      const clearing = smoothstep(SPAWN_CLEAR_RADIUS, SPAWN_CLEAR_RADIUS + 16, spawnDist(x, z));
      if (!rng.chance(density * clearing)) continue;
      if (!dryAndGentle(t, x, z, 0.7, 0.85)) continue;
      const species = pickSpecies(t, x, z, rng);
      const scale = species === 'fir' || species === 'cedar' ? rng.range(0.8, 1.4) : rng.range(0.8, 1.15);
      addTree(x, z, species, scale);
    }
  }

  // Fallen logs (decor + collision)
  for (let attempt = 0; attempt < 400 && logs.length < 28; attempt++) {
    const x = rng.range(-PLAY_HALF + 6, PLAY_HALF - 6);
    const z = rng.range(-PLAY_HALF + 6, PLAY_HALF - 6);
    if (spawnDist(x, z) < 16) continue;
    if (!dryAndGentle(t, x, z, 0.8, 0.35)) continue;
    const length = rng.range(3, 5.5);
    if (!occ.free(x, z, length * 0.5 + 0.6)) continue;
    occ.add(x, z, length * 0.5);
    logs.push({ x, z, rot: rng.range(0, Math.PI), length, r: rng.range(0.28, 0.42) });
  }

  // Every candidate spot is rolled from the main rng exactly as before forage was thinned, so trees, rocks and
  // spot positions never move; a separate rng then decides which spots actually grow something.
  const growRng = new Rng(seed ^ 0x2545f491);
  let spots = 0;
  const addResource = (x: number, z: number, kind: ResourceKind, grows: boolean): boolean => {
    if (!occ.free(x, z, 0.8)) return false;
    occ.add(x, z, 0.5);
    const r: ResourceGen = { x, z, kind, rot: rng.range(0, Math.PI * 2), scale: rng.range(0.85, 1.15), spot: spots++ };
    if (grows) resources.push(r);
    return true;
  };

  // Starter patch around the spawn: candidate spots per kind; the first RESOURCES[kind].starter of them grow.
  const starter: [ResourceKind, number][] = [
    ['stickPile', 5], ['stonePile', 5], ['fern', 4], ['berryBush', 3], ['mushroom', 2], ['onion', 2],
  ];
  for (const [kind, count] of starter) {
    let placed = 0;
    for (let attempt = 0; attempt < 300 && placed < count; attempt++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(4, kind === 'mushroom' ? 26 : 19);
      const x = sx + Math.cos(a) * d;
      const z = sz + Math.sin(a) * d;
      if (!dryAndGentle(t, x, z, 0.6, 0.6)) continue;
      if (addResource(x, z, kind, placed < RESOURCES[kind].starter)) placed++;
    }
  }

  // Scatter across the map by biome; each spot grows with its kind's RESOURCES[kind].scatter chance.
  const resCell = 8;
  for (let gx = -PLAY_HALF; gx < PLAY_HALF; gx += resCell) {
    for (let gz = -PLAY_HALF; gz < PLAY_HALF; gz += resCell) {
      if (!rng.chance(0.62)) continue;
      const x = gx + rng.range(0.5, resCell - 0.5);
      const z = gz + rng.range(0.5, resCell - 0.5);
      if (!dryAndGentle(t, x, z, 0.5, 0.7)) continue;
      const forest = t.field(x, z, 1);
      const h = t.heightAt(x, z);
      let kind: ResourceKind;
      const roll = rng.next();
      if (h < 1.6) kind = roll < 0.55 ? 'stonePile' : roll < 0.8 ? 'berryBush' : 'stickPile';
      else if (forest > 0.55) kind = roll < 0.3 ? 'stickPile' : roll < 0.6 ? 'fern' : roll < 0.78 ? 'mushroom' : roll < 0.9 ? 'berryBush' : 'stonePile';
      else kind = roll < 0.24 ? 'onion' : roll < 0.48 ? 'berryBush' : roll < 0.64 ? 'stonePile' : roll < 0.82 ? 'stickPile' : 'fern';
      addResource(x, z, kind, growRng.chance(RESOURCES[kind].scatter));
    }
  }

  return { seed, trees, resources, resourceSpots: spots, rocks, logs };
}

const cache = new Map<number, WorldGen>();

export function getWorldGen(seed: number): WorldGen {
  let w = cache.get(seed);
  if (!w) {
    w = generateWorld(seed);
    cache.set(seed, w);
  }
  return w;
}
