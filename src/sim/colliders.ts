import { boundingRadius, type Shape2D } from '../core/geom2d';
import { SpatialGrid } from '../core/spatialGrid';

export type ColliderKind = 'tree' | 'stump' | 'rock' | 'log' | 'structure' | 'resource';

export interface Collider {
  kind: ColliderKind;
  /** Index into gen arrays (tree/rock/log/resource) or structure id. */
  ref: number;
  /** Solid shape for movement; null means walk-through. */
  body: Shape2D | null;
  /** Shape that blocks building placement; null means it never blocks. */
  footprint: Shape2D | null;
  x: number;
  z: number;
  radius: number;
}

export function makeCollider(kind: ColliderKind, ref: number, body: Shape2D | null, footprint: Shape2D | null): Collider {
  const ref0 = (body ?? footprint)!;
  const radius = Math.max(body ? boundingRadius(body) : 0, footprint ? boundingRadius(footprint) : 0);
  return { kind, ref, body, footprint, x: ref0.x, z: ref0.z, radius };
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
