import { box, circle, footprintSamples, type Shape2D } from '../core/geom2d';
import { smoothstep } from '../core/math';
import { Rng } from '../core/rng';
import { DEFAULT_BIOME, type BiomeId } from '../data/biomes';
import { RESOURCES, TREES, type ResourceKind, type TreeSpecies } from '../data/resources';
import { PNW_GENERATION, type PnwGeneration } from './pnw';
import { generateIsland } from './islandgen';
import { Occupancy } from './occupancy';
import { generateSnow, type SnowPatch } from './snow';
import { generateSettlements, type SettlementGen } from './settlements';
import { getTerrain, isDrinkable, PLAY_HALF, WATER_LEVEL, type Terrain } from './terrain';

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
  /** Snow can rest on scenery above the terrain; ordinary forage omits these fields. */
  y?: number;
  snow?: SnowPatch;
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

/** A saguaro: solid scenery (they are protected, so there is nothing to harvest). */
export interface CactusGen {
  x: number;
  z: number;
  height: number;
  arms: number;
  rot: number;
  r: number;
}

export interface WorldGen {
  seed: number;
  biome: BiomeId;
  trees: TreeGen[];
  resources: ResourceGen[];
  /** Number of candidate forage spots, including the ones where nothing grows. */
  resourceSpots: number;
  rocks: RockGen[];
  logs: LogGen[];
  cacti: CactusGen[];
  /** Independent placement leaves tree/resource indices and all other maps untouched. */
  settlements?: SettlementGen[];
}

export const SPAWN_CLEAR_RADIUS = 12;
/** Desert rocks smaller than this are gatherable stone piles, not boulders. */
export const MIN_DESERT_BOULDER = 1;

const groundSamples: number[] = [];
/** Static scenery must sit on dry terrain, even when winter makes the water surface walkable. */
export function dryFootprint(t: Pick<Terrain, 'heightAt'>, shape: Shape2D): boolean {
  footprintSamples(shape, groundSamples);
  for (let i = 0; i < groundSamples.length; i += 2) {
    if (t.heightAt(groundSamples[i], groundSamples[i + 1]) < WATER_LEVEL + 0.15) return false;
  }
  return true;
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

export function generateWorld(seed: number, pnwGen: PnwGeneration = PNW_GENERATION): WorldGen {
  const t = getTerrain(seed, 'pnw', pnwGen);
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
  for (let gx = -t.playHalf; gx < t.playHalf; gx += rockCell) {
    for (let gz = -t.playHalf; gz < t.playHalf; gz += rockCell) {
      const x = gx + rng.range(0, rockCell);
      const z = gz + rng.range(0, rockCell);
      const rocky = t.field(x, z, 3);
      const shore = t.heightAt(x, z) < 1.6 ? 0.25 : 0;
      if (!rng.chance(0.08 + rocky * 0.28 + shore)) continue;
      if (spawnDist(x, z) < 10 || (t.pnw && t.pnw.meadowAt(x, z) > 0.65)) continue;
      if (!dryAndGentle(t, x, z, -0.6, 1.3)) continue;
      const r = rng.range(0.7, 2.1);
      if (!occ.free(x, z, r + 0.4)) continue;
      occ.add(x, z, r);
      rocks.push({ x, z, r, scaleY: rng.range(0.55, 0.9), rot: rng.range(0, Math.PI * 2), variant: rng.int(0, 2), tint: rng.next() });
    }
  }

  const addTree = (x: number, z: number, species: TreeSpecies, scale: number): boolean => {
    const trunkR = TREES[species].trunkRadius * scale;
    if (t.pnw && t.pnw.meadowAt(x, z) > 0.65) return false;
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
  for (let gx = -t.playHalf; gx < t.playHalf; gx += treeCell) {
    for (let gz = -t.playHalf; gz < t.playHalf; gz += treeCell) {
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
  for (let attempt = 0; attempt < (t.pnw ? 1600 : 400) && logs.length < (t.pnw ? 112 : 28); attempt++) {
    const x = rng.range(-t.playHalf + 6, t.playHalf - 6);
    const z = rng.range(-t.playHalf + 6, t.playHalf - 6);
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
  for (let gx = -t.playHalf; gx < t.playHalf; gx += resCell) {
    for (let gz = -t.playHalf; gz < t.playHalf; gz += resCell) {
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

  // Keep the original RNG draws and occupancy so saved tree/forage indices stay in place. Only remove unsafe
  // scenery after generation. The conservative footprint covers the warped meshes, beyond the collision body.
  const dryRocks = rocks.filter((r) => dryFootprint(t, circle(r.x, r.z, r.r * 1.6)));
  const dryLogs = t.pnw ? logs.filter((l) => dryFootprint(t, box(l.x, l.z, l.length / 2 + 0.2, l.r + 0.1, l.rot))) : logs;
  const gen: WorldGen = { seed, biome: 'pnw', trees, resources, resourceSpots: spots, rocks: dryRocks, logs: dryLogs, cacti: [] };
  const snow = generateSnow(t, gen);
  gen.resources.push(...snow);
  gen.resourceSpots += snow.length;
  gen.settlements = generateSettlements(t, gen);
  return gen;
}

/** Walkable desert ground: dry, gentle, and not up on a mesa, butte or the spire. */
function openDesert(t: Terrain, x: number, z: number, maxSlope: number): boolean {
  return dryAndGentle(t, x, z, 0.6, maxSlope) && t.landformAt(x, z).rock < 0.2;
}

function pickDesertTree(u: number, rng: Rng): TreeSpecies {
  const r = rng.next();
  if (u < 0.5) return r < 0.72 ? 'juniper' : 'pinyon';
  if (u < 0.8) return r < 0.3 ? 'juniper' : r < 0.78 ? 'pinyon' : 'ponderosa';
  return r < 0.1 ? 'juniper' : r < 0.4 ? 'pinyon' : 'ponderosa';
}

/**
 * The desert: open scrub with scattered Joshua trees and mesquite (one log each), cottonwoods only at the spring,
 * pinyon-juniper woodland climbing into ponderosa pine on the high side of the map, and forage that follows
 * habitat (prickly pear and cholla on the flats, agave and yucca on rocky ground, wolfberry and chia near water).
 */
export function generateDesert(seed: number): WorldGen {
  const t = getTerrain(seed, 'desert');
  const rng = new Rng(seed ^ 0x3d5e27a1);
  const growRng = new Rng(seed ^ 0x6c8e9cf5);
  const occ = new Occupancy();
  const trees: TreeGen[] = [];
  const rocks: RockGen[] = [];
  const logs: LogGen[] = [];
  const resources: ResourceGen[] = [];
  const cacti: CactusGen[] = [];
  const spawnDist = (x: number, z: number) => Math.hypot(x - t.spawn.x, z - t.spawn.z);
  const spring = t.lakes.find((l) => l.kind === 'spring')!;
  const nearDrinkable = (x: number, z: number) => t.lakes.some((l) => isDrinkable(l) && Math.hypot(l.x - x, l.z - z) < l.r * 2.6);
  const along = (x: number, z: number) => x * t.upDir.x + z * t.upDir.z;
  const looseStones: { x: number; z: number }[] = [];

  // Boulders: sandstone talus below the cliffs, loose rock on the slickrock, a few on the plains. Anything smaller
  // than a boulder is a pile of stones you can pick up instead (placed with the other stones at the end).
  const rockCell = 12;
  for (let gx = -PLAY_HALF; gx < PLAY_HALF; gx += rockCell) {
    for (let gz = -PLAY_HALF; gz < PLAY_HALF; gz += rockCell) {
      const x = gx + rng.range(0, rockCell);
      const z = gz + rng.range(0, rockCell);
      const lf = t.landformAt(x, z);
      const talus = lf.rock > 0.02 && lf.rock < 0.9 ? 0.55 : 0;
      if (!rng.chance(0.05 + talus + t.slickrock(x, z) * 0.2 + t.upland(x, z) * 0.12)) continue;
      if (spawnDist(x, z) < 10) continue;
      if (!dryAndGentle(t, x, z, 0.4, 1.3) || lf.rock > 0.9) continue;
      const r = rng.range(0.6, talus > 0 ? 2.4 : 1.7);
      if (r < MIN_DESERT_BOULDER) {
        looseStones.push({ x, z });
        continue;
      }
      if (!occ.free(x, z, r + 0.4)) continue;
      occ.add(x, z, r);
      rocks.push({ x, z, r, scaleY: rng.range(0.5, 0.85), rot: rng.range(0, Math.PI * 2), variant: rng.int(0, 2), tint: rng.next() });
    }
  }

  const addTree = (x: number, z: number, species: TreeSpecies, scale: number): boolean => {
    const trunkR = TREES[species].trunkRadius * scale;
    if (!occ.free(x, z, trunkR + 1.4)) return false;
    occ.add(x, z, trunkR + 0.4);
    trees.push({ x, z, species, scale, rot: rng.range(0, Math.PI * 2), trunkR, tint: rng.next() });
    return true;
  };

  // Cottonwoods mark the spring from a distance; small trees near the start give the first logs.
  let placed = 0;
  for (let i = 0; i < 200 && placed < 3; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = spring.r * rng.range(1.35, 2.1);
    const x = spring.x + Math.cos(a) * d;
    const z = spring.z + Math.sin(a) * d;
    if (spawnDist(x, z) < 9 || !openDesert(t, x, z, 0.6)) continue;
    if (addTree(x, z, 'cottonwood', rng.range(0.85, 1.1))) placed++;
  }
  const starterTrees: [TreeSpecies, number][] = [['mesquite', 3], ['joshua', 2]];
  for (const [species, count] of starterTrees) {
    placed = 0;
    for (let i = 0; i < 200 && placed < count; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(14, 30);
      const x = t.spawn.x + Math.cos(a) * d;
      const z = t.spawn.z + Math.sin(a) * d;
      if (!openDesert(t, x, z, 0.6)) continue;
      if (addTree(x, z, species, rng.range(0.85, 1.15))) placed++;
    }
  }

  const treeCell = 7;
  for (let gx = -PLAY_HALF; gx < PLAY_HALF; gx += treeCell) {
    for (let gz = -PLAY_HALF; gz < PLAY_HALF; gz += treeCell) {
      const x = gx + rng.range(0.5, treeCell - 0.5);
      const z = gz + rng.range(0.5, treeCell - 0.5);
      const u = t.upland(x, z);
      const f = t.field(x, z, 1);
      const clearing = smoothstep(SPAWN_CLEAR_RADIUS, SPAWN_CLEAR_RADIUS + 16, spawnDist(x, z));
      const density = u > 0.2 ? 0.12 + 0.5 * smoothstep(0.2, 0.85, u) * (0.6 + 0.4 * f) : 0.03 + 0.06 * f;
      if (!rng.chance(density * clearing)) continue;
      if (!openDesert(t, x, z, 0.8) || t.slickrock(x, z) > 0.5) continue;
      if (u > 0.2) {
        const species = pickDesertTree(u, rng);
        addTree(x, z, species, species === 'ponderosa' ? rng.range(0.85, 1.3) : rng.range(0.8, 1.2));
      } else {
        addTree(x, z, nearDrinkable(x, z) || rng.chance(0.55) ? 'mesquite' : 'joshua', rng.range(0.8, 1.2));
      }
    }
  }

  // Saguaros: only on the low, warm side of the map, a few per hectare as at the Sonoran desert's upper edge.
  for (let i = 0; i < 900 && cacti.length < 26; i++) {
    const x = rng.range(-PLAY_HALF + 8, PLAY_HALF - 8);
    const z = rng.range(-PLAY_HALF + 8, PLAY_HALF - 8);
    if (along(x, z) > -5 || spawnDist(x, z) < 20 || !openDesert(t, x, z, 0.45) || t.slickrock(x, z) > 0.3 || nearDrinkable(x, z)) continue;
    const r = rng.range(0.24, 0.34);
    if (!occ.free(x, z, r + 1.6)) continue;
    occ.add(x, z, r + 0.3);
    cacti.push({ x, z, r, height: rng.range(4.2, 8.5), arms: rng.int(0, 4), rot: rng.range(0, Math.PI * 2) });
  }

  // Dead juniper snags lying in the high country.
  for (let i = 0; i < 300 && logs.length < 10; i++) {
    const x = rng.range(-PLAY_HALF + 6, PLAY_HALF - 6);
    const z = rng.range(-PLAY_HALF + 6, PLAY_HALF - 6);
    if (t.upland(x, z) < 0.35 || !openDesert(t, x, z, 0.35)) continue;
    const length = rng.range(2.6, 4.2);
    if (!occ.free(x, z, length * 0.5 + 0.6)) continue;
    occ.add(x, z, length * 0.5);
    logs.push({ x, z, rot: rng.range(0, Math.PI), length, r: rng.range(0.22, 0.32) });
  }

  let spots = 0;
  const addResource = (x: number, z: number, kind: ResourceKind, grows: boolean): boolean => {
    if (!occ.free(x, z, 0.8)) return false;
    occ.add(x, z, 0.5);
    const r: ResourceGen = { x, z, kind, rot: rng.range(0, Math.PI * 2), scale: rng.range(0.85, 1.15), spot: spots++ };
    if (grows) resources.push(r);
    return true;
  };

  const starter: [ResourceKind, number][] = [
    ['stickPile', 5], ['stonePile', 5], ['yucca', 4], ['pricklyPear', 3], ['cholla', 2], ['wolfberry', 2],
  ];
  for (const [kind, count] of starter) {
    placed = 0;
    for (let attempt = 0; attempt < 300 && placed < count; attempt++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(4, 20);
      const x = t.spawn.x + Math.cos(a) * d;
      const z = t.spawn.z + Math.sin(a) * d;
      if (!openDesert(t, x, z, 0.6)) continue;
      if (addResource(x, z, kind, placed < RESOURCES[kind].starter)) placed++;
    }
  }

  const resCell = 8;
  for (let gx = -PLAY_HALF; gx < PLAY_HALF; gx += resCell) {
    for (let gz = -PLAY_HALF; gz < PLAY_HALF; gz += resCell) {
      if (!rng.chance(0.55)) continue;
      const x = gx + rng.range(0.5, resCell - 0.5);
      const z = gz + rng.range(0.5, resCell - 0.5);
      if (!openDesert(t, x, z, 0.7)) continue;
      const roll = rng.next();
      let kind: ResourceKind;
      if (nearDrinkable(x, z)) kind = roll < 0.35 ? 'wolfberry' : roll < 0.6 ? 'chia' : roll < 0.8 ? 'stickPile' : 'pricklyPear';
      else if (t.slickrock(x, z) > 0.4) kind = roll < 0.45 ? 'stonePile' : roll < 0.75 ? 'agave' : 'yucca';
      else if (t.upland(x, z) > 0.35) kind = roll < 0.3 ? 'stickPile' : roll < 0.48 ? 'yucca' : roll < 0.64 ? 'agave' : roll < 0.78 ? 'stonePile' : roll < 0.9 ? 'chia' : 'pricklyPear';
      else kind = roll < 0.22 ? 'pricklyPear' : roll < 0.38 ? 'cholla' : roll < 0.56 ? 'yucca' : roll < 0.7 ? 'stonePile' : roll < 0.84 ? 'stickPile' : roll < 0.92 ? 'wolfberry' : roll < 0.97 ? 'chia' : 'agave';
      addResource(x, z, kind, growRng.chance(RESOURCES[kind].scatter));
    }
  }

  // Loose stones lie all over open ground, thickest on the slickrock, in the washes and below the cliffs, and
  // every one can be picked up. They come last, from their own rng, so the forage above keeps its spots.
  const stoneRng = new Rng(seed ^ 0x2b7e1516);
  for (const p of looseStones) addResource(p.x, p.z, 'stonePile', true);
  const stoneCell = 5.6;
  for (let gx = -PLAY_HALF; gx < PLAY_HALF; gx += stoneCell) {
    for (let gz = -PLAY_HALF; gz < PLAY_HALF; gz += stoneCell) {
      const x = gx + stoneRng.range(0.5, stoneCell - 0.5);
      const z = gz + stoneRng.range(0.5, stoneCell - 0.5);
      const rocky = t.landformAt(x, z).rock > 0.02 || t.slickrock(x, z) > 0.3 || t.wash(x, z) > 0.3;
      const chance = rocky ? 0.95 : nearDrinkable(x, z) ? 0.35 : 0.72 - t.upland(x, z) * 0.22;
      if (!stoneRng.chance(chance) || spawnDist(x, z) < 3.5 || !openDesert(t, x, z, 0.75)) continue;
      addResource(x, z, 'stonePile', true);
    }
  }

  return { seed, biome: 'desert', trees, resources, resourceSpots: spots, rocks, logs, cacti };
}

/**
 * Raised when a map's generation moves its trees and forage, so an older save of that map (tree and resource states
 * are stored by index) knows they no longer line up and starts them fresh. Saves record it as `worldRev`; maps
 * without an entry write nothing, so their saves are unchanged. Island 2: bare beaches and more purslane.
 */
export const WORLD_REVISION: Partial<Record<BiomeId, number>> = { island: 2 };

const cache = new Map<string, WorldGen>();

export function getWorldGen(seed: number, biome: BiomeId = DEFAULT_BIOME, pnwGen: PnwGeneration = PNW_GENERATION): WorldGen {
  const key = `${biome}:${seed}:${biome === 'pnw' ? pnwGen : 1}`;
  let w = cache.get(key);
  if (!w) {
    w = biome === 'island' ? generateIsland(seed) : biome === 'desert' ? generateDesert(seed) : generateWorld(seed, pnwGen);
    cache.set(key, w);
  }
  return w;
}
