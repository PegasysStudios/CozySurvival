import { SpatialGrid } from '../core/spatialGrid';

interface Occ {
  x: number;
  z: number;
  r: number;
}

/** Discs already taken by world generation, so trees, rocks and forage never overlap. */
export class Occupancy {
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
