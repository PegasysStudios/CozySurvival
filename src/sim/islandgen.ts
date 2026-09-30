import { smoothstep } from '../core/math';
import { Rng } from '../core/rng';
import { RESOURCES, TREES, type ResourceKind, type TreeSpecies } from '../data/resources';
import { Occupancy } from './occupancy';
import { getTerrain, type Terrain } from './terrain';
import type { LogGen, ResourceGen, RockGen, TreeGen, WorldGen } from './worldgen';

/** Dry ground within the island's walkable square, no steeper than `maxSlope`. */
function dry(t: Terrain, x: number, z: number, minHeight: number, maxSlope: number): boolean {
  if (!t.inPlayBounds(x, z, 2) || t.heightAt(x, z) < minHeight) return false;
  return t.slopeAt(x, z) <= maxSlope;
}

/**
 * The island, zoned like a real high island from the sea inward: bare beach sand with only driftwood, stones and
 * fallen coconuts on it; a grassy littoral strip behind it with the coconut palms, sea grape, pandanus, purslane and
 * beach hibiscus (hau); dense windward jungle of kukui (candlenut) and breadfruit with tree ferns, wild bananas and
 * taro by the water; and open leeward grassland (purslane underfoot) with only a few lone trees. Basalt boulders
 * gather on the headlands, below the knolls and around the waterfall, and every cave holds a few loose stones.
 */
export function generateIsland(seed: number): WorldGen {
  const t = getTerrain(seed, 'island');
  const isl = t.island!;
  const rng = new Rng(seed ^ 0x51a4d7e3);
  const growRng = new Rng(seed ^ 0x2f6b1c09);
  const occ = new Occupancy();
  const trees: TreeGen[] = [];
  const rocks: RockGen[] = [];
  const logs: LogGen[] = [];
  const resources: ResourceGen[] = [];
  const sx = t.spawn.x;
  const sz = t.spawn.z;
  const spawnDist = (x: number, z: number) => Math.hypot(x - sx, z - sz);
  const ph = t.playHalf;
  // Nothing grows through the ring of a cave's rock shell, or on the beach sand.
  const inCave = (x: number, z: number, pad: number) => isl.caves.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad);
  const sand = (x: number, z: number) => isl.onSand(x, z, t.heightAt(x, z));
  /** Kinds that may lie on the sand; everything else is a plant. */
  const onSandOk = (kind: ResourceKind) => kind === 'stickPile' || kind === 'stonePile' || kind === 'coconut';

  let spots = 0;
  const addResource = (x: number, z: number, kind: ResourceKind, grows: boolean): boolean => {
    if (!onSandOk(kind) && sand(x, z)) return false;
    if (!occ.free(x, z, 0.8)) return false;
    occ.add(x, z, 0.5);
    const r: ResourceGen = { x, z, kind, rot: rng.range(0, Math.PI * 2), scale: rng.range(0.85, 1.15), spot: spots++ };
    if (grows) resources.push(r);
    return true;
  };

  // Loose stones on each cave floor, then the cave itself is off limits.
  for (const c of isl.caves) {
    let placed = 0;
    for (let i = 0; i < 40 && placed < 5; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0.6, c.r - 2);
      if (addResource(c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, 'stonePile', true)) placed++;
    }
    occ.add(c.x, c.z, c.r + 0.6);
  }

  const addTree = (x: number, z: number, species: TreeSpecies, scale: number): boolean => {
    const trunkR = TREES[species].trunkRadius * scale;
    if (sand(x, z) || !occ.free(x, z, trunkR + 1.4) || inCave(x, z, 2.5)) return false;
    occ.add(x, z, trunkR + 0.4);
    trees.push({ x, z, species, scale, rot: rng.range(0, Math.PI * 2), trunkR, tint: rng.next() });
    return true;
  };

  // Boulders.
  const rockCell = 13;
  for (let gx = -ph; gx < ph; gx += rockCell) {
    for (let gz = -ph; gz < ph; gz += rockCell) {
      const x = gx + rng.range(0, rockCell);
      const z = gz + rng.range(0, rockCell);
      const L = isl.land(x, z);
      if (L < 1) continue;
      const cliff = isl.cliffAt(Math.atan2(z, x)) * (1 - smoothstep(14, 34, L));
      const knoll = isl.knolls.some((k) => Math.hypot(k.x - x, k.z - z) < k.r * 1.7) ? 0.5 : 0;
      const fall = Math.hypot(x - isl.waterfall.pool.x, z - isl.waterfall.pool.z) < 40 ? 0.35 : 0;
      const chance = 0.03 + cliff * 0.45 + knoll + fall + isl.jungle(x, z) * 0.05 + (L < 22 ? 0.05 : 0);
      if (!rng.chance(chance) || spawnDist(x, z) < 10 || inCave(x, z, 2)) continue;
      if (!dry(t, x, z, 0.3, 1.3)) continue;
      const r = rng.range(0.7, 2.1);
      if (!occ.free(x, z, r + 0.4)) continue;
      occ.add(x, z, r);
      rocks.push({ x, z, r, scaleY: rng.range(0.55, 0.9), rot: rng.range(0, Math.PI * 2), variant: rng.int(0, 2), tint: rng.next() });
    }
  }

  // Palms and a couple of beach hibiscus along the top of the spawn beach, so the first coconuts and bark are close.
  let near = 0;
  for (let i = 0; i < 400 && near < 6; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(9, 36);
    const x = sx + Math.cos(a) * d;
    const z = sz + Math.sin(a) * d;
    if (!dry(t, x, z, 0.5, 0.6) || isl.land(x, z) < 3) continue;
    if (addTree(x, z, 'palm', rng.range(0.9, 1.15))) near++;
  }
  near = 0;
  for (let i = 0; i < 400 && near < 2; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(14, 40);
    const x = sx + Math.cos(a) * d;
    const z = sz + Math.sin(a) * d;
    if (!dry(t, x, z, 0.8, 0.6) || isl.land(x, z) < 8) continue;
    if (addTree(x, z, 'hau', rng.range(0.9, 1.1))) near++;
  }

  // The littoral strip: coconut palms thickest just above the sand, thinning into the littoral forest.
  const palmCell = 6;
  for (let gx = -ph; gx < ph; gx += palmCell) {
    for (let gz = -ph; gz < ph; gz += palmCell) {
      const x = gx + rng.range(0.4, palmCell - 0.4);
      const z = gz + rng.range(0.4, palmCell - 0.4);
      const L = isl.land(x, z);
      if (L < 2 || L > 50 || sand(x, z)) continue;
      const cliff = isl.cliffAt(Math.atan2(z, x));
      // Where the leeward grassland runs down to the beach the palms thin out, so it stays open country.
      const open = 1 - 0.6 * smoothstep(0.5, 0.9, isl.plains(x, z));
      const density = (0.9 * (1 - smoothstep(28, 46, L)) + 0.05) * open * (1 - cliff * 0.8) * smoothstep(8, 22, spawnDist(x, z));
      if (!rng.chance(density) || !dry(t, x, z, 0.35, 0.7)) continue;
      if (rng.chance(0.08) && L > 10) addTree(x, z, 'hau', rng.range(0.85, 1.15));
      else addTree(x, z, 'palm', rng.range(0.85, 1.22));
    }
  }

  // Jungle, the grassland's few trees, and beach hibiscus along the streams.
  const treeCell = 5.2;
  for (let gx = -ph; gx < ph; gx += treeCell) {
    for (let gz = -ph; gz < ph; gz += treeCell) {
      const x = gx + rng.range(0.4, treeCell - 0.4);
      const z = gz + rng.range(0.4, treeCell - 0.4);
      const L = isl.land(x, z);
      if (L < 14) continue;
      const j = isl.jungle(x, z);
      const fresh = isl.freshNear(x, z);
      const density = 0.012 + 0.64 * smoothstep(0.2, 0.75, j);
      if (!rng.chance(density * smoothstep(12, 26, spawnDist(x, z)))) continue;
      if (!dry(t, x, z, 0.6, 0.85)) continue;
      const roll = rng.next();
      let species: TreeSpecies;
      if (fresh < 12) species = roll < 0.35 ? 'hau' : roll < 0.7 ? 'treeFern' : roll < 0.85 ? 'breadfruit' : 'kukui';
      else if (j < 0.25) species = roll < 0.55 ? 'kukui' : roll < 0.8 ? 'hau' : 'breadfruit';
      else species = roll < 0.5 ? 'kukui' : roll < 0.68 ? 'breadfruit' : roll < 0.92 ? 'treeFern' : 'hau';
      const scale = species === 'kukui' ? rng.range(0.85, 1.35) : species === 'treeFern' ? rng.range(0.75, 1.25) : rng.range(0.85, 1.15);
      addTree(x, z, species, scale);
    }
  }

  // The lagoon islet is a tight clump of palms.
  for (let i = 0; i < 120; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0, isl.islet.r - 2);
    const x = isl.islet.x + Math.cos(a) * d;
    const z = isl.islet.z + Math.sin(a) * d;
    if (dry(t, x, z, 0.35, 0.7)) addTree(x, z, 'palm', rng.range(0.85, 1.2));
  }

  // Sun-bleached driftwood on the beaches, mossy logs in the jungle.
  for (let i = 0; i < 900 && logs.length < 26; i++) {
    const a = rng.range(0, Math.PI * 2);
    const beach = logs.length < 10;
    const r = beach ? isl.coastAt(a) - rng.range(4, 16) : Math.sqrt(rng.next()) * isl.coastAt(a) * 0.9;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (spawnDist(x, z) < 14 || inCave(x, z, 3)) continue;
    if (!beach && isl.jungle(x, z) < 0.5) continue;
    if (!dry(t, x, z, 0.5, 0.35)) continue;
    const length = rng.range(3, 5.2);
    if (!occ.free(x, z, length * 0.5 + 0.6)) continue;
    occ.add(x, z, length * 0.5);
    logs.push({ x, z, rot: rng.range(0, Math.PI), length, r: rng.range(0.24, 0.38) });
  }

  // Starter patch on the spawn beach: its first RESOURCES[kind].starter spots of each kind grow.
  // Plants go on the grass at the top of the beach, so they reach a little further than the driftwood and stones.
  const starter: [ResourceKind, number][] = [
    ['stickPile', 5], ['stonePile', 5], ['pandanus', 4], ['seaGrape', 3], ['purslane', 4], ['coconut', 2],
  ];
  const palmsNear = trees.filter((p) => p.species === 'palm' && spawnDist(p.x, p.z) < 38);
  for (const [kind, count] of starter) {
    let placed = 0;
    for (let attempt = 0; attempt < 400 && placed < count; attempt++) {
      let x: number;
      let z: number;
      if (kind === 'coconut' && palmsNear.length) {
        const p = rng.pick(palmsNear);
        const a = rng.range(0, Math.PI * 2);
        x = p.x + Math.cos(a) * rng.range(1, 2.2);
        z = p.z + Math.sin(a) * rng.range(1, 2.2);
      } else {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(4, onSandOk(kind) ? 20 : 34);
        x = sx + Math.cos(a) * d;
        z = sz + Math.sin(a) * d;
      }
      if (!dry(t, x, z, 0.5, 0.6)) continue;
      if (addResource(x, z, kind, placed < RESOURCES[kind].starter)) placed++;
    }
  }

  // Forage across the island by zone; each spot grows with its kind's RESOURCES[kind].scatter chance.
  const resCell = 8;
  for (let gx = -ph; gx < ph; gx += resCell) {
    for (let gz = -ph; gz < ph; gz += resCell) {
      if (!rng.chance(0.62)) continue;
      const x = gx + rng.range(0.5, resCell - 0.5);
      const z = gz + rng.range(0.5, resCell - 0.5);
      if (!dry(t, x, z, 0.4, 0.7) || inCave(x, z, 1)) continue;
      const L = isl.land(x, z);
      const fresh = isl.freshNear(x, z);
      const j = isl.jungle(x, z);
      const roll = rng.next();
      let kind: ResourceKind;
      if (sand(x, z)) kind = roll < 0.6 ? 'stickPile' : 'stonePile';
      else if (fresh < 10) kind = roll < 0.45 ? 'taro' : roll < 0.65 ? 'banana' : roll < 0.82 ? 'pandanus' : 'stickPile';
      else if (L < 46) kind = roll < 0.22 ? 'seaGrape' : roll < 0.6 ? 'purslane' : roll < 0.8 ? 'pandanus' : roll < 0.9 ? 'stickPile' : 'stonePile';
      else if (j > 0.5) kind = roll < 0.22 ? 'banana' : roll < 0.5 ? 'stickPile' : roll < 0.62 ? 'taro' : roll < 0.74 ? 'pandanus' : 'stonePile';
      else kind = roll < 0.34 ? 'purslane' : roll < 0.58 ? 'stonePile' : roll < 0.76 ? 'stickPile' : roll < 0.9 ? 'pandanus' : 'seaGrape';
      addResource(x, z, kind, growRng.chance(RESOURCES[kind].scatter));
    }
  }

  // Now and then a coconut has dropped by itself and lies under its palm.
  for (const p of trees) {
    if (p.species !== 'palm' || !rng.chance(0.55)) continue;
    const a = rng.range(0, Math.PI * 2);
    const x = p.x + Math.cos(a) * rng.range(1, 2.4);
    const z = p.z + Math.sin(a) * rng.range(1, 2.4);
    if (dry(t, x, z, 0.3, 0.7)) addResource(x, z, 'coconut', growRng.chance(RESOURCES.coconut.scatter));
  }

  return { seed, biome: 'island', trees, resources, resourceSpots: spots, rocks, logs, cacti: [] };
}
