import * as THREE from 'three';
import type { Season } from '../sim/seasons';
import { TERRAIN_CELL, type Terrain } from '../sim/terrain';
import { buildTerrainMesh } from './terrainMesh';

const CHUNK_CELLS = 48;

/** Expanded forest terrain follows the island's fog-limited chunks, preserving the exact simulation triangles. */
export class ChunkedTerrain {
  readonly group = new THREE.Group();
  readonly triangles: number;
  private readonly chunks: { mesh: THREE.Mesh; x: number; z: number; radius: number }[] = [];

  constructor(t: Terrain, season: Season | null) {
    this.group.name = 'terrain';
    this.triangles = t.cells * t.cells * 2;
    for (let z = 0; z < t.cells; z += CHUNK_CELLS) {
      for (let x = 0; x < t.cells; x += CHUNK_CELLS) {
        const width = Math.min(CHUNK_CELLS, t.cells - x), depth = Math.min(CHUNK_CELLS, t.cells - z);
        const mesh = buildTerrainMesh(t, season, { x, z, width, depth });
        mesh.name = 'terrain-chunk';
        mesh.geometry.computeBoundingSphere();
        this.group.add(mesh);
        this.chunks.push({ mesh, x: -t.half + (x + width / 2) * TERRAIN_CELL,
          z: -t.half + (z + depth / 2) * TERRAIN_CELL, radius: Math.hypot(width, depth) * TERRAIN_CELL / 2 });
      }
    }
  }

  cull(x: number, z: number, distance: number): void {
    for (const chunk of this.chunks) chunk.mesh.visible = (chunk.x - x) ** 2 + (chunk.z - z) ** 2 < (distance + chunk.radius) ** 2;
  }

  dispose(): void {
    for (const { mesh } of this.chunks) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
