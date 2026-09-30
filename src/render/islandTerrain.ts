import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';
import { hash2 } from '../core/rng';
import { TERRAIN_CELL, WATER_LEVEL, type Terrain } from '../sim/terrain';

const C = {
  abyss: new THREE.Color('#123452'),
  deep: new THREE.Color('#2a5a74'),
  lagoonSand: new THREE.Color('#e9dcb2'),
  lagoonSandDim: new THREE.Color('#cfc29a'),
  coral: new THREE.Color('#c09482'),
  coralGreen: new THREE.Color('#8a9a6a'),
  reef: new THREE.Color('#b8a48a'),
  sand: new THREE.Color('#efe2bc'),
  sandPink: new THREE.Color('#f0d8c0'),
  wetSand: new THREE.Color('#cdb98e'),
  bed: new THREE.Color('#6a5a40'),
  bedStone: new THREE.Color('#57524a'),
  littoral: new THREE.Color('#7a9a44'),
  grass: new THREE.Color('#a6b05a'),
  grassGold: new THREE.Color('#c2b666'),
  grassGreen: new THREE.Color('#86a548'),
  jungle: new THREE.Color('#3a6428'),
  jungleDuff: new THREE.Color('#4f4a2c'),
  moss: new THREE.Color('#355a2a'),
  basalt: new THREE.Color('#4a4642'),
  basaltLight: new THREE.Color('#6a645c'),
  limestone: new THREE.Color('#8e8a82'),
  limestoneLight: new THREE.Color('#a8a298'),
  mossCliff: new THREE.Color('#2f5228'),
};

function releaseArray(this: THREE.BufferAttribute): void {
  (this as unknown as { array: ArrayLike<number> | null }).array = null;
}

/** Chunks of this many cells a side; deep ocean chunks (all corners under `SKIP_BELOW`) aren't built at all. */
const CHUNK_CELLS = 60;
const SKIP_BELOW = -12;
/** The flat floor drawn under the whole ocean, below the deepest terrain that is skipped. */
const SEABED_Y = -14;

/** Colour for a terrain triangle on the island: from the reef and lagoon floor up through beach, grass and jungle to rock. */
function islandColor(t: Terrain, c: THREE.Color, mx: number, my: number, mz: number, up: number, patch: number, L: number, jungle: number, fresh: number): void {
  const isl = t.island!;
  if (my < WATER_LEVEL - 0.05) {
    if (fresh < 2 && L > 0) {
      c.copy(C.bed).lerp(C.bedStone, patch);
      return;
    }
    const past = isl.pastReef(mx, mz);
    if (past > 0) {
      c.copy(C.reef).lerp(C.deep, smoothstep(0, 8, past)).lerp(C.abyss, smoothstep(8, 22, -my));
      return;
    }
    c.copy(C.lagoonSand).lerp(C.lagoonSandDim, smoothstep(0.5, 2.6, -my) * 0.6 + patch * 0.25);
    // Coral heads and the reef flat near the crest.
    const coral = smoothstep(-8, -1, past) + (hash2(Math.floor(mx * 0.35), Math.floor(mz * 0.35), 3) > 0.86 ? 0.6 : 0);
    if (coral > 0) c.lerp(patch > 0.5 ? C.coral : C.coralGreen, clamp(coral, 0, 0.75));
    return;
  }
  const steep = 1 - smoothstep(0.62, 0.86, up);
  const beach = L < 26 && my < 2.2 ? 1 - smoothstep(1.3, 2.2, my) : 0;
  const plains = L > 18 ? (1 - jungle) * smoothstep(18, 34, L) : 0;
  c.copy(C.littoral).lerp(C.grassGreen, patch * 0.5);
  if (plains > 0) {
    c.lerp(patch > 0.5 ? C.grassGold : C.grass, plains);
  }
  if (jungle > 0) c.lerp(patch > 0.55 ? C.jungleDuff : C.jungle, smoothstep(0.1, 0.7, jungle));
  if (jungle > 0.6 && patch < 0.3) c.lerp(C.moss, 0.4);
  if (beach > 0) c.copy(c).lerp(patch > 0.6 ? C.sandPink : C.sand, beach);
  if (my < 0.35 && L < 30) c.lerp(C.wetSand, 1 - smoothstep(0.05, 0.35, my));
  if (fresh < 3 && my < 1.2) c.lerp(C.bed, 0.35);
  if (steep > 0) {
    const cove = Math.hypot(mx - isl.cove.x, mz - isl.cove.z) < isl.cove.r + 24;
    const fall = Math.hypot(mx - isl.waterfall.pool.x, mz - isl.waterfall.pool.z) < isl.waterfall.pool.r + 22;
    const rock = cove ? (patch > 0.5 ? C.limestone : C.limestoneLight) : fall ? C.mossCliff : patch > 0.5 ? C.basalt : C.basaltLight;
    c.lerp(rock, steep);
    // Plants cling to the ledges of the cove's limestone and the waterfall's cliff.
    if ((cove || fall) && patch > 0.7) c.lerp(C.moss, 0.35 * steep);
  }
}

/**
 * The island's ground as square chunks, so the camera draws only what the fog lets it see. Each chunk matches
 * `Terrain.heightAt` triangle for triangle, like the single mesh on the other maps.
 */
export class IslandTerrain {
  readonly group = new THREE.Group();
  private readonly chunks: { mesh: THREE.Mesh; cx: number; cz: number }[] = [];
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly seabed: THREE.Mesh;
  /** Triangles built, for the performance numbers. */
  readonly triangles: number;

  constructor(t: Terrain) {
    this.group.name = 'terrain';
    const n = t.cells;
    const V = t.verts;
    const h = t.heights;
    const isl = t.island!;
    const c = new THREE.Color();
    let total = 0;
    for (let cj = 0; cj < n; cj += CHUNK_CELLS) {
      for (let ci = 0; ci < n; ci += CHUNK_CELLS) {
        const cells: number[] = [];
        for (let jz = cj; jz < Math.min(n, cj + CHUNK_CELLS); jz++) {
          for (let ix = ci; ix < Math.min(n, ci + CHUNK_CELLS); ix++) {
            const k = jz * V + ix;
            if (h[k] < SKIP_BELOW && h[k + 1] < SKIP_BELOW && h[k + V] < SKIP_BELOW && h[k + V + 1] < SKIP_BELOW) continue;
            cells.push(ix, jz);
          }
        }
        if (!cells.length) continue;
        const tris = cells.length;
        const pos = new Float32Array(tris * 9);
        const col = new Float32Array(tris * 9);
        let o = 0;
        const put = (x: number, y: number, z: number) => {
          pos[o] = x;
          pos[o + 1] = y;
          pos[o + 2] = z;
          o += 3;
        };
        const shade = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, k: number, L: number, jungle: number, fresh: number, patch: number) => {
          const ux = bx - ax, uy = by - ay, uz = bz - az;
          const wx = cx - ax, wy = cy - ay, wz = cz - az;
          const nx = uy * wz - uz * wy;
          const ny = uz * wx - ux * wz;
          const nz = ux * wy - uy * wx;
          const up = Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
          islandColor(t, c, (ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3, up, patch, L, jungle, fresh);
          const j = 1 + (k - 0.5) * 0.09;
          for (let v = 0; v < 3; v++) {
            const ci2 = o - 9 + v * 3;
            col[ci2] = c.r * j;
            col[ci2 + 1] = c.g * j;
            col[ci2 + 2] = c.b * j;
          }
        };
        for (let q = 0; q < cells.length; q += 2) {
          const ix = cells[q];
          const jz = cells[q + 1];
          const x0 = -t.half + ix * TERRAIN_CELL;
          const z0 = -t.half + jz * TERRAIN_CELL;
          const x1 = x0 + TERRAIN_CELL;
          const z1 = z0 + TERRAIN_CELL;
          const k = jz * V + ix;
          const h00 = h[k], h10 = h[k + 1], h01 = h[k + V], h11 = h[k + V + 1];
          // Region fields once per cell (both triangles share them).
          const mx = x0 + 1;
          const mz = z0 + 1;
          const L = isl.land(mx, mz);
          const jungle = L > 8 ? isl.jungle(mx, mz) : 0;
          const fresh = L > -4 ? isl.freshNear(mx, mz) : 60;
          const patch = t.field(mx * 3.1, mz * 3.1, 6);
          put(x0, h00, z0);
          put(x0, h01, z1);
          put(x1, h11, z1);
          shade(x0, h00, z0, x0, h01, z1, x1, h11, z1, hash2(ix, jz, 1), L, jungle, fresh, patch);
          put(x0, h00, z0);
          put(x1, h11, z1);
          put(x1, h10, z0);
          shade(x0, h00, z0, x1, h11, z1, x1, h10, z0, hash2(ix, jz, 2), L, jungle, fresh, patch);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.computeVertexNormals();
        g.computeBoundingSphere();
        // The ground never changes and nothing reads these arrays back (the sim has its own height grid), so drop
        // the CPU copies once they are on the GPU.
        for (const name of ['position', 'color', 'normal']) (g.getAttribute(name) as THREE.BufferAttribute).onUpload(releaseArray);
        const mesh = new THREE.Mesh(g, this.material);
        mesh.receiveShadow = true;
        mesh.name = 'terrain-chunk';
        this.group.add(mesh);
        const s = CHUNK_CELLS * TERRAIN_CELL;
        this.chunks.push({ mesh, cx: -t.half + ci * TERRAIN_CELL + s / 2, cz: -t.half + cj * TERRAIN_CELL + s / 2 });
        total += tris * 2;
      }
    }
    this.triangles = total;
    const bed = new THREE.PlaneGeometry(2600, 2600, 1, 1);
    bed.rotateX(-Math.PI / 2);
    this.seabed = new THREE.Mesh(bed, new THREE.MeshLambertMaterial({ color: C.abyss }));
    this.seabed.position.y = SEABED_Y;
    this.seabed.name = 'seabed';
    this.group.add(this.seabed);
  }

  /** Hide chunks past `maxDist` (the fog's end); frustum culling handles the rest. */
  cull(px: number, pz: number, maxDist: number): void {
    const pad = CHUNK_CELLS * TERRAIN_CELL * 0.72;
    const lim = (maxDist + pad) * (maxDist + pad);
    for (const ch of this.chunks) {
      const dx = ch.cx - px;
      const dz = ch.cz - pz;
      ch.mesh.visible = dx * dx + dz * dz < lim;
    }
  }

  dispose(): void {
    for (const ch of this.chunks) ch.mesh.geometry.dispose();
    this.seabed.geometry.dispose();
    (this.seabed.material as THREE.Material).dispose();
    this.material.dispose();
  }
}

/**
 * The island water's lookup texture over the terrain grid: R is depth (0..24 m), G marks fresh water, B is the surf
 * line along the reef crest.
 */
export function islandWaterTexture(t: Terrain): THREE.DataTexture {
  const n = t.verts;
  const isl = t.island!;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -t.half + i * TERRAIN_CELL;
      const z = -t.half + j * TERRAIN_CELL;
      const depth = WATER_LEVEL - t.heights[j * n + i];
      const k = (j * n + i) * 4;
      data[k] = Math.round(clamp((depth + 1) / 25, 0, 1) * 255);
      if (depth > -1) {
        const L = isl.land(x, z);
        const fresh = L > 2 && depth > -1 && isl.freshNear(x, z) < 4 ? 1 : 0;
        data[k + 1] = fresh * 255;
        const past = -L - isl.reefAt(Math.atan2(z, x));
        data[k + 2] = Math.round((1 - smoothstep(0, 5, Math.abs(past + 1))) * 255);
      }
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
