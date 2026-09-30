import { Rng } from '../core/rng';
import type { ResourceKind } from '../data/resources';
import type { Terrain } from '../sim/terrain';
import type { WorldGen } from '../sim/worldgen';

/** The island's ground-cover plants, each drawn from its own instance sets (`variant` picks the set). */
export type IslandGroundKind = 'naupaka' | 'sedge' | 'tall' | 'understory' | 'flower';

export const ISLAND_GROUND_VARIANTS: Record<IslandGroundKind, number> = { naupaka: 2, sedge: 3, tall: 3, understory: 3, flower: 4 };

export interface IslandGroundPlant {
  kind: IslandGroundKind;
  variant: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  scaleY: number;
}

/** Bare ground kept around low forage so the grass doesn't hide it; purslane gets the widest ring. */
export const GROUND_CLEAR: Partial<Record<ResourceKind, number>> = { purslane: 1.4, coconut: 0.9, stickPile: 0.8, stonePile: 0.8 };

const SAMPLES = 80000;
const CELL = 4;

/**
 * Where the island's decorative ground cover grows, zoned like the trees. The beach sand stays bare. Naupaka shrubs,
 * sedges and beach morning glory grow on the grassy strip behind it; ferns, ti plants and elephant ears grow under the
 * jungle; and waist-high golden grass covers the leeward grassland. Nothing grows right at the spawn, or close enough
 * to purslane, fallen coconuts, sticks or stones to hide them.
 */
export function planIslandGround(t: Terrain, gen: WorldGen): IslandGroundPlant[] {
  const isl = t.island!;
  const rng = new Rng(gen.seed ^ 0x6a57);
  const clear = new Map<number, { x: number; z: number; r: number }[]>();
  const key = (cx: number, cz: number) => (cx + 512) * 1024 + (cz + 512);
  for (const r of gen.resources) {
    const rad = GROUND_CLEAR[r.kind];
    if (!rad) continue;
    const k = key(Math.floor(r.x / CELL), Math.floor(r.z / CELL));
    let list = clear.get(k);
    if (!list) clear.set(k, (list = []));
    list.push({ x: r.x, z: r.z, r: rad });
  }
  const cleared = (x: number, z: number): boolean => {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = clear.get(key(cx + dx, cz + dz));
        if (list?.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) return true;
      }
    }
    return false;
  };

  const out: IslandGroundPlant[] = [];
  const put = (kind: IslandGroundKind, variant: number, x: number, y: number, z: number, scale: number, scaleY = scale) => {
    out.push({ kind, variant, x, y, z, rot: rng.range(0, Math.PI * 2), scale, scaleY });
  };
  for (let i = 0; i < SAMPLES; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * (isl.coastAt(a) + 4);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = t.heightAt(x, z);
    if (h < 0.25 || t.slopeAt(x, z) > 0.7) continue;
    if (Math.hypot(x - t.spawn.x, z - t.spawn.z) < 3.5) continue;
    const L = isl.land(x, z);
    if (isl.onSand(x, z, h) || cleared(x, z)) continue;
    const roll = rng.next();
    if (L < 46) {
      if (roll < 0.14) put('naupaka', rng.chance(0.4) ? 1 : 0, x, h, z, rng.range(0.8, 1.3));
      else if (roll < 0.44) put('sedge', rng.int(0, 2), x, h, z, rng.range(0.8, 1.3));
      else if (roll < 0.49) put('flower', rng.chance(0.7) ? 0 : 3, x, h, z, rng.range(0.8, 1.2));
      continue;
    }
    const j = isl.jungle(x, z);
    if (j > 0.45) {
      if (roll < 0.13) put('understory', 0, x, h, z, rng.range(0.9, 1.4));
      else if (roll < 0.18) put('understory', 1, x, h, z, rng.range(0.8, 1.2));
      else if (roll < 0.23) put('understory', 2, x, h, z, rng.range(0.9, 1.4));
      continue;
    }
    if (isl.plains(x, z) > 0.4) {
      if (roll < 0.78) put('tall', rng.int(0, 2), x, h, z, rng.range(0.8, 1.25), rng.range(0.8, 1.3));
      else if (roll < 0.8) put('flower', rng.pick([1, 2]), x, h, z, rng.range(0.8, 1.1));
      else if (roll < 0.815) put('naupaka', 0, x, h, z, rng.range(0.7, 1.0));
      continue;
    }
    if (roll < 0.4) put('sedge', rng.int(0, 2), x, h, z, rng.range(0.9, 1.3));
    else if (roll < 0.45) put('understory', 0, x, h, z, rng.range(0.7, 1.1));
  }
  return out;
}
