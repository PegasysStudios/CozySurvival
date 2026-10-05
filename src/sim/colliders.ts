import { boundingRadius, circleBox, type BoxShape, type Shape2D } from '../core/geom2d';
import { SpatialGrid } from '../core/spatialGrid';

export type ColliderKind = 'tree' | 'stump' | 'rock' | 'log' | 'trunk' | 'structure' | 'resource' | 'cactus' | 'cave';

/**
 * A solid you can stand on. The player collides with its surface instead of an infinite-height wall:
 * steep sides block like a cliff, gentle tops are walkable, and you can jump onto it.
 */
export type SolidTop =
  /** Half-ellipsoid boulder: `base` is the height of its widest ring, `ax`/`az` the local semi-axes. */
  | { type: 'dome'; x: number; z: number; base: number; height: number; ax: number; az: number; rot: number }
  /** Flat-topped block: surface = (`base` or terrain height) + `lift` anywhere inside `shape`. */
  | { type: 'slab'; shape: BoxShape; lift: number; base?: number };

export interface Collider {
  kind: ColliderKind;
  /** Index into gen arrays (tree/rock/log/resource/trunk) or structure id. */
  ref: number;
  /** Solid shape for movement; null means walk-through. */
  body: Shape2D | null;
  /** Shape that blocks building placement; null means it never blocks. */
  footprint: Shape2D | null;
  /** When set, the player stands on this surface instead of being pushed out of `body` (animals still use `body`). */
  top?: SolidTop;
  x: number;
  z: number;
  radius: number;
}

export function makeCollider(kind: ColliderKind, ref: number, body: Shape2D | null, footprint: Shape2D | null, top?: SolidTop): Collider {
  const ref0 = (body ?? footprint)!;
  const radius = Math.max(body ? boundingRadius(body) : 0, footprint ? boundingRadius(footprint) : 0);
  const c: Collider = { kind, ref, body, footprint, x: ref0.x, z: ref0.z, radius };
  if (top) c.top = top;
  return c;
}

const probe = { type: 'circle' as const, x: 0, z: 0, r: 0 };

/**
 * Height of a solid top under a circular footprint of radius `r` centred at (x, z), or -Infinity if the
 * footprint misses it. Using the footprint (not the centre) means you stay on a rock until your whole body is off it.
 */
export function topHeight(top: SolidTop, x: number, z: number, r: number, ground: { heightAt(x: number, z: number): number }): number {
  if (top.type === 'slab') {
    probe.x = x;
    probe.z = z;
    probe.r = r;
    return circleBox(probe, top.shape) ? (top.base ?? ground.heightAt(x, z)) + top.lift : -Infinity;
  }
  const dx = x - top.x;
  const dz = z - top.z;
  const c = Math.cos(top.rot);
  const s = Math.sin(top.rot);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const d = Math.hypot(lx, lz);
  if (d < 1e-6) return top.base + top.height;
  const ex = lx / d / top.ax;
  const ez = lz / d / top.az;
  const radius = 1 / Math.sqrt(ex * ex + ez * ez);
  const q = Math.max(0, d - r) / radius;
  if (q >= 1) return -Infinity;
  return top.base + top.height * Math.sqrt(1 - q * q);
}

/** Spatial index of every static and dynamic obstacle in the world. */
export class ColliderIndex {
  private readonly grid = new SpatialGrid<Collider>(8);
  private readonly all = new Set<Collider>();

  add(c: Collider): Collider {
    this.grid.insert(c, c.x, c.z, c.radius);
    this.all.add(c);
    return c;
  }

  remove(c: Collider): void {
    if (!this.all.has(c)) return;
    this.grid.remove(c, c.x, c.z, c.radius);
    this.all.delete(c);
  }

  query(x: number, z: number, r: number, out: Collider[]): Collider[] {
    return this.grid.query(x, z, r, out);
  }

  get size(): number {
    return this.all.size;
  }
}
