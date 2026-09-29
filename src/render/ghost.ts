import * as THREE from 'three';
import { PREFABS, type PrefabId } from '../data/prefabs';
import type { PlacementPreview } from '../sim/simulation';
import type { Terrain } from '../sim/terrain';
import { structureGeometry } from './props';

const VALID = new THREE.Color('#7be38a');
const INVALID = new THREE.Color('#ff6b5e');

/** Translucent placement preview with a footprint that hugs the terrain. */
export class GhostView {
  readonly group = new THREE.Group();
  private readonly terrain: Terrain;
  private readonly bodyMat = new THREE.MeshBasicMaterial({ color: VALID, transparent: true, opacity: 0.42, depthWrite: false });
  private readonly edgeMat = new THREE.LineBasicMaterial({ color: VALID, transparent: true, opacity: 0.8 });
  private readonly footMat = new THREE.MeshBasicMaterial({ color: VALID, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
  private prefab: PrefabId | null = null;
  private body: THREE.Mesh | null = null;
  private edges: THREE.LineSegments | null = null;
  private foot: THREE.Mesh | null = null;
  private footLocal: Float32Array | null = null;
  private readonly geos = new Map<PrefabId, { body: THREE.BufferGeometry; edges: THREE.BufferGeometry }>();

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    this.group.visible = false;
    this.group.renderOrder = 10;
  }

  private build(prefab: PrefabId): void {
    if (this.body) this.group.remove(this.body);
    if (this.edges) this.group.remove(this.edges);
    if (this.foot) {
      this.group.remove(this.foot);
      this.foot.geometry.dispose();
    }
    let g = this.geos.get(prefab);
    if (!g) {
      const body = structureGeometry(prefab);
      g = { body, edges: new THREE.EdgesGeometry(body, 35) };
      this.geos.set(prefab, g);
    }
    this.body = new THREE.Mesh(g.body, this.bodyMat);
    this.body.renderOrder = 11;
    this.edges = new THREE.LineSegments(g.edges, this.edgeMat);
    this.edges.renderOrder = 12;
    const fp = PREFABS[prefab].footprint;
    const footGeo = fp.type === 'circle' ? new THREE.CircleGeometry(fp.r, 32) : new THREE.PlaneGeometry(fp.hw * 2, fp.hd * 2, 8, 8);
    footGeo.rotateX(-Math.PI / 2);
    this.footLocal = new Float32Array(footGeo.getAttribute('position').array);
    this.foot = new THREE.Mesh(footGeo, this.footMat);
    this.foot.renderOrder = 10;
    this.group.add(this.foot, this.body, this.edges);
    this.prefab = prefab;
  }

  update(pl: PlacementPreview | null, time: number): void {
    if (!pl) {
      this.group.visible = false;
      return;
    }
    if (pl.prefab !== this.prefab) this.build(pl.prefab);
    this.group.visible = true;
    this.group.position.set(pl.x, pl.y, pl.z);
    this.group.rotation.y = pl.rot;
    const c = pl.valid ? VALID : INVALID;
    this.bodyMat.color.copy(c);
    this.edgeMat.color.copy(c);
    this.footMat.color.copy(c);
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    this.bodyMat.opacity = pl.valid ? 0.34 + pulse * 0.1 : 0.3;
    this.footMat.opacity = pl.valid ? 0.22 + pulse * 0.1 : 0.35;
    const foot = this.foot!;
    const local = this.footLocal!;
    const pos = foot.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cr = Math.cos(pl.rot);
    const sr = Math.sin(pl.rot);
    for (let i = 0; i < pos.count; i++) {
      const lx = local[i * 3];
      const lz = local[i * 3 + 2];
      const wx = pl.x + lx * cr + lz * sr;
      const wz = pl.z - lx * sr + lz * cr;
      pos.setY(i, Math.max(this.terrain.heightAt(wx, wz), 0) - pl.y + 0.05);
    }
    pos.needsUpdate = true;
  }

  dispose(): void {
    for (const g of this.geos.values()) {
      g.body.dispose();
      g.edges.dispose();
    }
    this.foot?.geometry.dispose();
    this.bodyMat.dispose();
    this.edgeMat.dispose();
    this.footMat.dispose();
  }
}
