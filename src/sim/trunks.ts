import { box, type BoxShape } from '../core/geom2d';
import { BALANCE } from '../data/balance';
import { TREES, type TreeSpecies } from '../data/resources';
import type { SolidTop } from './colliders';
import type { TreeDyn } from './state';
import type { RockGen, TreeGen } from './worldgen';

/** A fallen trunk lies half a radius into the ground: its axis sits this many radii above the terrain. */
export const TRUNK_AXIS_LIFT = 0.7;
/** Height of the trunk's top above the terrain, in radii. */
export const TRUNK_TOP_LIFT = 1.7;

export function freshTree(species: TreeSpecies): TreeDyn {
  const def = TREES[species];
  return { hp: def.hp, felled: false, bark: def.bark, barkAt: 0, logs: 0, cuts: 0, fall: 0 };
}

export interface TrunkSpan {
  /** Stump-side end of the uncut trunk. */
  x0: number;
  z0: number;
  /** Tip end. */
  x1: number;
  z1: number;
  /** Unit direction from stump to tip. */
  dx: number;
  dz: number;
  len: number;
  r: number;
  /** three.js rotation.y that turns local +X along the trunk. */
  rot: number;
}

/**
 * Where the uncut part of a fallen trunk lies, or null if there is none.
 * Logs come off the stump end first, so the trunk shortens away from the stump.
 */
export function trunkSpan(tree: TreeGen, dyn: TreeDyn): TrunkSpan | null {
  if (!dyn.felled || dyn.logs <= 0) return null;
  const def = TREES[tree.species];
  const dx = Math.sin(dyn.fall);
  const dz = Math.cos(dyn.fall);
  const full = def.fallLength * tree.scale;
  const piece = full / def.logs;
  const base = tree.trunkR + BALANCE.trees.trunkOffset;
  const s0 = base + piece * Math.max(0, def.logs - dyn.logs);
  const s1 = base + full;
  return {
    x0: tree.x + dx * s0, z0: tree.z + dz * s0,
    x1: tree.x + dx * s1, z1: tree.z + dz * s1,
    dx, dz, len: s1 - s0, r: tree.trunkR, rot: dyn.fall - Math.PI / 2,
  };
}

export function trunkBox(span: TrunkSpan, pad = 0): BoxShape {
  return box((span.x0 + span.x1) / 2, (span.z0 + span.z1) / 2, span.len / 2 + pad, span.r + pad, span.rot);
}

export function trunkTop(span: TrunkSpan): SolidTop {
  return { type: 'slab', shape: trunkBox(span), lift: span.r * TRUNK_TOP_LIFT };
}

/** Per-variant extents of the boulder model at unit scale (x, top y, z), measured from the render mesh. */
const ROCK_EXTENT = [
  [1.126, 0.99, 1.067],
  [1.225, 0.934, 0.782],
  [0.983, 1.079, 1.229],
] as const;

/** A boulder's standable surface, matching the rendered rock (sunk 12% of its radius into the ground). */
export function rockTop(rock: RockGen, groundY: number): SolidTop {
  const e = ROCK_EXTENT[rock.variant] ?? ROCK_EXTENT[0];
  return {
    type: 'dome',
    x: rock.x,
    z: rock.z,
    base: groundY - rock.r * 0.12,
    height: rock.r * rock.scaleY * e[1] * 0.95,
    ax: rock.r * e[0] * 0.95,
    az: rock.r * e[2] * 0.95,
    rot: rock.rot,
  };
}
