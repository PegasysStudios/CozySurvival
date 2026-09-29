/** Uniform grid bucket index for 2D (XZ) proximity queries. */
export class SpatialGrid<T> {
  private readonly cells = new Map<number, T[]>();
  readonly cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  insert(item: T, x: number, z: number, radius: number): void {
    const cs = this.cellSize;
    const x0 = Math.floor((x - radius) / cs);
    const x1 = Math.floor((x + radius) / cs);
    const z0 = Math.floor((z - radius) / cs);
    const z1 = Math.floor((z + radius) / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let bucket = this.cells.get(k);
        if (!bucket) {
          bucket = [];
          this.cells.set(k, bucket);
        }
        bucket.push(item);
      }
    }
  }

  remove(item: T, x: number, z: number, radius: number): void {
    const cs = this.cellSize;
    const x0 = Math.floor((x - radius) / cs);
    const x1 = Math.floor((x + radius) / cs);
    const z0 = Math.floor((z - radius) / cs);
    const z1 = Math.floor((z + radius) / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const bucket = this.cells.get(this.key(ix, iz));
        if (!bucket) continue;
        const i = bucket.indexOf(item);
        if (i >= 0) bucket.splice(i, 1);
      }
    }
  }

  /**
   * Collect unique items from all cells overlapping the query square. `out` is cleared first.
   * Uniqueness uses a caller-provided stamp so no Set is allocated per query.
   */
  query(x: number, z: number, radius: number, out: T[]): T[] {
    out.length = 0;
    const cs = this.cellSize;
    const x0 = Math.floor((x - radius) / cs);
    const x1 = Math.floor((x + radius) / cs);
    const z0 = Math.floor((z - radius) / cs);
    const z1 = Math.floor((z + radius) / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const bucket = this.cells.get(this.key(ix, iz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const it = bucket[i];
          if (out.indexOf(it) < 0) out.push(it);
        }
      }
    }
    return out;
  }

  clear(): void {
    this.cells.clear();
  }
}
