import * as THREE from 'three';

export interface InstanceSpec {
  matrix: THREE.Matrix4;
  color?: THREE.Color;
}

interface Chunk {
  mesh: THREE.InstancedMesh;
  /** Low-detail twin sharing the same instance buffers, drawn instead of `mesh` far away. */
  far: THREE.InstancedMesh | null;
  cx: number;
  cz: number;
  shown: number;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Instances binned into square world chunks so frustum culling and distance culling work per chunk.
 * Individual instances can be hidden (zero-scale) or re-posed without reallocating, and chunks with
 * nothing visible are skipped entirely.
 */
export class ChunkedInstances {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  private readonly chunkOf: Int32Array;
  private readonly localOf: Int32Array;
  private readonly base: Float32Array;
  private readonly hidden: Uint8Array;
  private readonly chunkSize: number;
  private readonly tmp = new THREE.Matrix4();

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    specs: readonly InstanceSpec[],
    opts: { chunkSize: number; castShadow?: boolean; receiveShadow?: boolean; name?: string; lod?: THREE.BufferGeometry },
  ) {
    this.chunkSize = opts.chunkSize;
    const n = specs.length;
    this.chunkOf = new Int32Array(n);
    this.localOf = new Int32Array(n);
    this.base = new Float32Array(n * 16);
    this.hidden = new Uint8Array(n);
    const bins = new Map<string, number[]>();
    specs.forEach((s, i) => {
      s.matrix.toArray(this.base, i * 16);
      const x = s.matrix.elements[12];
      const z = s.matrix.elements[14];
      const key = Math.floor(x / this.chunkSize) + ',' + Math.floor(z / this.chunkSize);
      let bin = bins.get(key);
      if (!bin) bins.set(key, (bin = []));
      bin.push(i);
    });
    for (const [key, ids] of bins) {
      const [kx, kz] = key.split(',').map(Number);
      const mesh = new THREE.InstancedMesh(geometry, material, ids.length);
      mesh.name = opts.name ?? 'instances';
      mesh.castShadow = !!opts.castShadow;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      const colorable = ids.some((i) => specs[i].color);
      ids.forEach((id, local) => {
        mesh.setMatrixAt(local, specs[id].matrix);
        if (colorable) mesh.setColorAt(local, specs[id].color ?? new THREE.Color(1, 1, 1));
        this.chunkOf[id] = this.chunks.length;
        this.localOf[id] = local;
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      let far: THREE.InstancedMesh | null = null;
      if (opts.lod) {
        far = new THREE.InstancedMesh(opts.lod, material, ids.length);
        far.name = mesh.name + '-far';
        far.instanceMatrix = mesh.instanceMatrix;
        far.instanceColor = mesh.instanceColor;
        far.castShadow = mesh.castShadow;
        far.receiveShadow = mesh.receiveShadow;
        far.computeBoundingSphere();
        far.visible = false;
        this.group.add(far);
      }
      this.chunks.push({ mesh, far, cx: (kx + 0.5) * this.chunkSize, cz: (kz + 0.5) * this.chunkSize, shown: ids.length });
      this.group.add(mesh);
    }
  }

  setHidden(i: number, hide: boolean): void {
    if ((this.hidden[i] === 1) === hide) return;
    this.hidden[i] = hide ? 1 : 0;
    const c = this.chunks[this.chunkOf[i]];
    c.shown += hide ? -1 : 1;
    if (hide) c.mesh.setMatrixAt(this.localOf[i], ZERO);
    else {
      this.tmp.fromArray(this.base, i * 16);
      c.mesh.setMatrixAt(this.localOf[i], this.tmp);
    }
    c.mesh.instanceMatrix.needsUpdate = true;
    if (c.shown === 0) {
      c.mesh.visible = false;
      if (c.far) c.far.visible = false;
    } else if (!hide && c.shown === 1 && !(c.far?.visible ?? false)) {
      c.mesh.visible = true;
    }
  }

  /** Replace an instance's base transform (e.g. a cut fern shrinks). */
  setMatrix(i: number, m: THREE.Matrix4): void {
    m.toArray(this.base, i * 16);
    if (this.hidden[i]) return;
    const c = this.chunks[this.chunkOf[i]];
    c.mesh.setMatrixAt(this.localOf[i], m);
    c.mesh.instanceMatrix.needsUpdate = true;
  }

  baseMatrix(i: number, out: THREE.Matrix4): THREE.Matrix4 {
    return out.fromArray(this.base, i * 16);
  }

  /**
   * Show chunks within `maxDist` (plus half a chunk diagonal). Chunks whose centre is beyond
   * `lodDist` draw their low-detail twin when one exists.
   */
  cullByDistance(px: number, pz: number, maxDist: number, lodDist = Infinity): void {
    const pad = this.chunkSize * 0.72;
    const lim = (maxDist + pad) * (maxDist + pad);
    const lodLim = lodDist * lodDist;
    for (const c of this.chunks) {
      const dx = c.cx - px;
      const dz = c.cz - pz;
      const d2 = dx * dx + dz * dz;
      const show = c.shown > 0 && d2 < lim;
      const useFar = c.far !== null && d2 > lodLim;
      c.mesh.visible = show && !useFar;
      if (c.far) c.far.visible = show && useFar;
    }
  }

  dispose(): void {
    for (const c of this.chunks) {
      c.mesh.dispose();
      c.far?.dispose();
    }
  }
}
