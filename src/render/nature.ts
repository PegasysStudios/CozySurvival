import * as THREE from 'three';
import { smoothstep } from '../core/math';
import { Rng } from '../core/rng';
import { PREFABS } from '../data/prefabs';
import { RESOURCE_KINDS, type ResourceKind, type TreeSpecies } from '../data/resources';
import type { GameState } from '../sim/state';
import { PLAY_HALF, type Terrain } from '../sim/terrain';
import { barkStripped, TRUNK_AXIS_LIFT, trunkSpan } from '../sim/trunks';
import type { WorldGen } from '../sim/worldgen';
import { tf, withWind } from './geo';
import { ChunkedInstances, type InstanceSpec } from './instances';
import { fallenLogGeometry, flowerGeometry, grassGeometry, resourceGeometry, rockGeometry, stumpGeometry, treeGeometry, trunkGeometry } from './models';

const SPECIES: TreeSpecies[] = ['fir', 'cedar', 'birch', 'maple'];
const GRASS_VIEW = 85;
const FLOWER_VIEW = 70;
const RESOURCE_VIEW = 140;
/** Chunk-centre distance beyond which trees switch to their low-detail model. */
const TREE_LOD_DIST = 90;

interface Falling {
  index: number;
  mesh: THREE.Mesh;
  t: number;
  axis: THREE.Vector3;
  baseRot: THREE.Quaternion;
  impacted: boolean;
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  height: number;
  species: TreeSpecies;
}

export interface NatureMaterials {
  foliage: THREE.MeshLambertMaterial;
  solid: THREE.MeshLambertMaterial;
  plant: THREE.MeshLambertMaterial;
}

export function makeNatureMaterials(): NatureMaterials {
  return {
    foliage: withWind(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 'foliage'),
    solid: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    plant: withWind(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }), 'plant'),
  };
}

export class NatureView {
  readonly group = new THREE.Group();
  onImpact: ((x: number, y: number, z: number, dirX: number, dirZ: number, species: TreeSpecies) => void) | null = null;

  private readonly terrain: Terrain;
  private readonly gen: WorldGen;
  private readonly mats: NatureMaterials;
  private readonly treeGeos = {} as Record<TreeSpecies, THREE.BufferGeometry>;
  private readonly trees = {} as Record<TreeSpecies, ChunkedInstances>;
  private readonly stumps = {} as Record<TreeSpecies, ChunkedInstances>;
  /** Peeled birches, drawn from a twin instance set with a bare lower trunk. */
  private strippedBirch!: ChunkedInstances;
  private strippedBirchGeo!: THREE.BufferGeometry;
  private readonly treeLocal: Int32Array;
  private readonly resources = {} as Record<ResourceKind, ChunkedInstances>;
  private berries: ChunkedInstances | null = null;
  private readonly resLocal: Int32Array;
  private readonly grass: ChunkedInstances[] = [];
  private readonly flowers: ChunkedInstances[] = [];
  private readonly grassPos: { set: number; local: number; x: number; z: number }[] = [];
  private readonly others: ChunkedInstances[] = [];
  private readonly ownedGeos: THREE.BufferGeometry[] = [];
  private readonly falling: Falling[] = [];
  private readonly trunkGeos = {} as Record<TreeSpecies, THREE.BufferGeometry>;
  /** Fallen trunks still waiting to be chopped up, keyed by tree index. */
  private readonly trunks = new Map<number, { mesh: THREE.Mesh; logs: number }>();
  private readonly felled: Uint8Array;
  private readonly stripped: Uint8Array;
  private readonly resourceUp: Int8Array;
  private readonly structuresSeen = new Set<number>();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();

  constructor(terrain: Terrain, gen: WorldGen, mats: NatureMaterials) {
    this.terrain = terrain;
    this.gen = gen;
    this.mats = mats;
    this.felled = new Uint8Array(gen.trees.length);
    this.stripped = new Uint8Array(gen.trees.length);
    this.resourceUp = new Int8Array(gen.resources.length).fill(-1);
    this.treeLocal = new Int32Array(gen.trees.length);
    this.resLocal = new Int32Array(gen.resources.length);
    this.buildTrees();
    this.buildRocksAndLogs();
    this.buildResources();
    this.buildGround();
  }

  private own<T extends THREE.BufferGeometry>(g: T): T {
    this.ownedGeos.push(g);
    return g;
  }

  private buildTrees(): void {
    const t = this.terrain;
    const specs = {} as Record<TreeSpecies, InstanceSpec[]>;
    for (const s of SPECIES) specs[s] = [];
    this.gen.trees.forEach((tr, i) => {
      const y = t.heightAt(tr.x, tr.z) - 0.15;
      const list = specs[tr.species];
      this.treeLocal[i] = list.length;
      const k = 0.86 + tr.tint * 0.24;
      const color = new THREE.Color(k, k, k);
      if (tr.species === 'maple' && tr.tint > 0.86) color.setRGB(1.25, 0.98, 0.62);
      else if (tr.species === 'birch' && tr.tint > 0.8) color.setRGB(1.12, 1.08, 0.78);
      else if (tr.species === 'fir' || tr.species === 'cedar') color.setRGB(k * (0.95 + tr.tint * 0.08), k, k * (1.04 - tr.tint * 0.1));
      list.push({ matrix: tf(tr.x, y, tr.z, 0, tr.rot, 0, tr.scale), color });
    });
    for (const s of SPECIES) {
      this.treeGeos[s] = this.own(treeGeometry(s));
      const lod = this.own(treeGeometry(s, 1));
      this.trees[s] = new ChunkedInstances(this.treeGeos[s], this.mats.foliage, specs[s], { chunkSize: 48, castShadow: true, name: 'trees-' + s, lod });
      this.group.add(this.trees[s].group);
      const stumpGeo = this.own(stumpGeometry(s));
      const stumpSpecs = specs[s].map((sp) => ({ matrix: sp.matrix.clone() }));
      this.stumps[s] = new ChunkedInstances(stumpGeo, this.mats.solid, stumpSpecs, { chunkSize: 48, castShadow: true, name: 'stumps-' + s });
      for (let i = 0; i < stumpSpecs.length; i++) this.stumps[s].setHidden(i, true);
      this.group.add(this.stumps[s].group);
      this.trunkGeos[s] = this.own(trunkGeometry(s));
    }
    this.strippedBirchGeo = this.own(treeGeometry('birch', 0, true));
    const strippedSpecs = specs.birch.map((sp) => ({ matrix: sp.matrix.clone(), color: sp.color?.clone() }));
    this.strippedBirch = new ChunkedInstances(this.strippedBirchGeo, this.mats.foliage, strippedSpecs, {
      chunkSize: 48, castShadow: true, name: 'trees-birch-stripped', lod: this.own(treeGeometry('birch', 1, true)),
    });
    for (let i = 0; i < strippedSpecs.length; i++) this.strippedBirch.setHidden(i, true);
    this.group.add(this.strippedBirch.group);
  }

  /** Create, shorten or remove the mesh for tree `i`'s fallen trunk. */
  private syncTrunk(i: number, state: GameState): void {
    const dyn = state.trees[i];
    const logs = dyn.felled ? dyn.logs : 0;
    const cur = this.trunks.get(i);
    if (cur && cur.logs === logs) return;
    const tr = this.gen.trees[i];
    const span = trunkSpan(tr, dyn);
    if (!span) {
      if (cur) {
        this.group.remove(cur.mesh);
        this.trunks.delete(i);
      }
      return;
    }
    let mesh = cur?.mesh;
    if (!mesh) {
      mesh = new THREE.Mesh(this.trunkGeos[tr.species], this.mats.solid);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const lift = span.r * TRUNK_AXIS_LIFT;
    const y0 = this.terrain.heightAt(span.x0, span.z0) + lift;
    const y1 = this.terrain.heightAt(span.x1, span.z1) + lift;
    mesh.position.set(span.x0, y0, span.z0);
    mesh.rotation.set(0, span.rot, Math.atan2(y1 - y0, span.len), 'YXZ');
    mesh.scale.set(Math.hypot(span.len, y1 - y0), span.r, span.r);
    this.trunks.set(i, { mesh, logs });
  }

  private buildRocksAndLogs(): void {
    const t = this.terrain;
    const bins: InstanceSpec[][] = [[], [], []];
    for (const r of this.gen.rocks) {
      const y = t.heightAt(r.x, r.z) - r.r * 0.12;
      const k = 0.88 + r.tint * 0.22;
      bins[r.variant].push({ matrix: tf(r.x, y, r.z, 0, r.rot, 0, r.r, r.r * r.scaleY, r.r), color: new THREE.Color(k, k, k * 1.02) });
    }
    bins.forEach((specs, v) => {
      if (!specs.length) return;
      const inst = new ChunkedInstances(this.own(rockGeometry(v)), this.mats.solid, specs, { chunkSize: 64, castShadow: true, name: 'rocks' });
      this.others.push(inst);
      this.group.add(inst.group);
    });
    const logSpecs = this.gen.logs.map((l) => {
      const y = t.heightAt(l.x, l.z) + l.r * 0.7;
      return { matrix: tf(l.x, y, l.z, 0, l.rot, 0, l.length, l.r, l.r) };
    });
    if (logSpecs.length) {
      const inst = new ChunkedInstances(this.own(fallenLogGeometry()), this.mats.solid, logSpecs, { chunkSize: 64, castShadow: true, name: 'logs' });
      this.others.push(inst);
      this.group.add(inst.group);
    }
  }

  private resourceMatrix(i: number, cut: boolean): THREE.Matrix4 {
    const r = this.gen.resources[i];
    const y = this.terrain.heightAt(r.x, r.z) - 0.02;
    const s = cut ? r.scale * 0.38 : r.scale;
    return tf(r.x, y, r.z, 0, r.rot, 0, s, cut ? s * 0.6 : s, s);
  }

  private buildResources(): void {
    const specs = {} as Record<ResourceKind, InstanceSpec[]>;
    for (const k of RESOURCE_KINDS) specs[k] = [];
    this.gen.resources.forEach((r, i) => {
      this.resLocal[i] = specs[r.kind].length;
      specs[r.kind].push({ matrix: this.resourceMatrix(i, false) });
    });
    for (const k of RESOURCE_KINDS) {
      if (!specs[k].length) continue;
      const model = resourceGeometry(k);
      this.own(model.main);
      const swaying = k === 'berryBush' || k === 'fern' || k === 'onion';
      const mat = model.doubleSided ? this.mats.plant : swaying ? this.mats.foliage : this.mats.solid;
      this.resources[k] = new ChunkedInstances(model.main, mat, specs[k], { chunkSize: 48, castShadow: k === 'berryBush', name: 'res-' + k });
      this.group.add(this.resources[k].group);
      if (model.extra) {
        this.own(model.extra);
        this.berries = new ChunkedInstances(model.extra, this.mats.foliage, specs[k], { chunkSize: 48, name: 'berries' });
        this.group.add(this.berries.group);
      }
    }
  }

  private buildGround(): void {
    const t = this.terrain;
    const rng = new Rng(this.gen.seed ^ 0x6a55);
    const grassSpecs: InstanceSpec[][] = [[], [], []];
    const flowerSpecs: InstanceSpec[][] = [[], [], [], []];
    const grassIdx: { set: number; local: number; x: number; z: number }[] = [];
    for (let i = 0; i < 20000; i++) {
      const x = rng.range(-PLAY_HALF, PLAY_HALF);
      const z = rng.range(-PLAY_HALF, PLAY_HALF);
      const h = t.heightAt(x, z);
      if (h < 0.55 || h > 17) continue;
      if (t.slopeAt(x, z) > 0.62) continue;
      const forest = t.field(x, z, 1);
      const meadow = 1 - smoothstep(0.32, 0.66, forest);
      if (!rng.chance(0.28 + 0.72 * meadow)) continue;
      const v = rng.int(0, 2);
      const s = rng.range(0.75, 1.35) * (0.8 + meadow * 0.4);
      grassIdx.push({ set: v, local: grassSpecs[v].length, x, z });
      grassSpecs[v].push({ matrix: tf(x, h - 0.03, z, 0, rng.range(0, 6.28), 0, s, s * rng.range(0.8, 1.2), s) });
    }
    for (let i = 0; i < 5000 && flowerSpecs.reduce((a, b) => a + b.length, 0) < 1700; i++) {
      const x = rng.range(-PLAY_HALF, PLAY_HALF);
      const z = rng.range(-PLAY_HALF, PLAY_HALF);
      const h = t.heightAt(x, z);
      if (h < 0.9 || h > 14 || t.slopeAt(x, z) > 0.5) continue;
      if (t.field(x, z, 1) > 0.45) continue;
      const v = t.field(x, z, 7) > 0.5 ? rng.pick([0, 1]) : rng.pick([2, 3]);
      const s = rng.range(0.8, 1.2);
      flowerSpecs[v].push({ matrix: tf(x, h - 0.02, z, 0, rng.range(0, 6.28), 0, s) });
    }
    grassSpecs.forEach((specs, v) => {
      const inst = new ChunkedInstances(this.own(grassGeometry(v)), this.mats.plant, specs, { chunkSize: 40, name: 'grass' });
      this.grass.push(inst);
      this.group.add(inst.group);
    });
    flowerSpecs.forEach((specs, v) => {
      if (!specs.length) return;
      const inst = new ChunkedInstances(this.own(flowerGeometry(v)), this.mats.plant, specs, { chunkSize: 40, name: 'flowers' });
      this.flowers.push(inst);
      this.group.add(inst.group);
    });
    this.grassPos.push(...grassIdx);
  }

  /** Bring instance visibility in line with the simulation state. */
  sync(state: GameState, animate: boolean): void {
    for (let i = 0; i < this.gen.trees.length; i++) {
      const sp = this.gen.trees[i].species;
      const strip = barkStripped(sp, state.trees[i]) ? 1 : 0;
      if (strip !== this.stripped[i] && !state.trees[i].felled) {
        this.stripped[i] = strip;
        this.trees[sp].setHidden(this.treeLocal[i], !!strip);
        this.strippedBirch.setHidden(this.treeLocal[i], !strip);
      }
      const felled = state.trees[i].felled ? 1 : 0;
      if (felled !== this.felled[i]) {
        this.felled[i] = felled;
        this.trees[sp].setHidden(this.treeLocal[i], !!felled || !!this.stripped[i]);
        if (this.stripped[i]) this.strippedBirch.setHidden(this.treeLocal[i], !!felled);
        this.stumps[sp].setHidden(this.treeLocal[i], !felled);
        if (felled && animate) {
          this.startFall(i, state);
          this.syncTrunk(i, state);
          const t = this.trunks.get(i);
          if (t) t.mesh.visible = false;
          continue;
        }
      }
      if (felled || this.trunks.has(i)) this.syncTrunk(i, state);
    }
    for (let i = 0; i < this.gen.resources.length; i++) {
      const up = state.resources[i].charges > 0 ? 1 : 0;
      if (up === this.resourceUp[i]) continue;
      this.resourceUp[i] = up;
      const kind = this.gen.resources[i].kind;
      const inst = this.resources[kind];
      const local = this.resLocal[i];
      if (kind === 'fern') inst.setMatrix(local, this.resourceMatrix(i, !up));
      else if (kind === 'berryBush') this.berries?.setHidden(local, !up);
      else inst.setHidden(local, !up);
    }
    for (const st of state.structures) {
      if (this.structuresSeen.has(st.id)) continue;
      this.structuresSeen.add(st.id);
      const r = PREFABS[st.prefab].footprint.type === 'circle' ? (PREFABS[st.prefab].footprint as { r: number }).r : Math.hypot((PREFABS[st.prefab].footprint as { hw: number }).hw, (PREFABS[st.prefab].footprint as { hd: number }).hd);
      for (const g of this.grassPos) {
        const dx = g.x - st.x;
        const dz = g.z - st.z;
        if (dx * dx + dz * dz < (r + 0.2) * (r + 0.2)) this.grass[g.set].setHidden(g.local, true);
      }
    }
  }

  private startFall(i: number, state: GameState): void {
    const tr = this.gen.trees[i];
    const y = this.terrain.heightAt(tr.x, tr.z) - 0.15;
    const mesh = new THREE.Mesh(this.stripped[i] ? this.strippedBirchGeo : this.treeGeos[tr.species], this.mats.foliage);
    mesh.castShadow = true;
    mesh.position.set(tr.x, y, tr.z);
    mesh.scale.setScalar(tr.scale);
    const baseRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr.rot);
    mesh.quaternion.copy(baseRot);
    const dx = Math.sin(state.trees[i].fall);
    const dz = Math.cos(state.trees[i].fall);
    this.group.add(mesh);
    this.falling.push({
      index: i, mesh, t: 0, baseRot, impacted: false, x: tr.x, y, z: tr.z, dirX: dx, dirZ: dz,
      axis: new THREE.Vector3(dz, 0, -dx).normalize(),
      height: (tr.species === 'fir' || tr.species === 'cedar' ? 11 : 7.5) * tr.scale,
      species: tr.species,
    });
  }

  /** `viewDist` is where fog fully hides the world; nothing past it needs drawing. */
  update(dt: number, px: number, pz: number, viewDist: number): void {
    for (const g of this.grass) g.cullByDistance(px, pz, GRASS_VIEW);
    for (const f of this.flowers) f.cullByDistance(px, pz, FLOWER_VIEW);
    for (const s of SPECIES) {
      this.trees[s].cullByDistance(px, pz, viewDist, TREE_LOD_DIST);
      this.stumps[s].cullByDistance(px, pz, viewDist);
    }
    this.strippedBirch.cullByDistance(px, pz, viewDist, TREE_LOD_DIST);
    for (const k of RESOURCE_KINDS) this.resources[k]?.cullByDistance(px, pz, Math.min(RESOURCE_VIEW, viewDist));
    this.berries?.cullByDistance(px, pz, Math.min(RESOURCE_VIEW, viewDist));
    for (const o of this.others) o.cullByDistance(px, pz, viewDist);
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      const fallTime = 1.7;
      const k = Math.min(1, f.t / fallTime);
      let ang = (Math.PI / 2 - 0.1) * k * k;
      if (k >= 1) {
        const bounce = Math.max(0, f.t - fallTime);
        ang = Math.PI / 2 - 0.1 - Math.sin(Math.min(bounce * 9, Math.PI)) * 0.05 * Math.exp(-bounce * 3);
        if (!f.impacted) {
          f.impacted = true;
          const trunk = this.trunks.get(f.index);
          if (trunk) trunk.mesh.visible = true;
          this.onImpact?.(f.x + f.dirX * f.height * 0.55, f.y + 0.4, f.z + f.dirZ * f.height * 0.55, f.dirX, f.dirZ, f.species);
        }
      }
      this.tmpQ.setFromAxisAngle(f.axis, ang);
      this.tmpQ2.copy(this.tmpQ).multiply(f.baseRot);
      f.mesh.quaternion.copy(this.tmpQ2);
      if (f.t > 3.2) {
        const s = Math.max(0, 1 - (f.t - 3.2) / 1.2);
        f.mesh.position.y = f.y - (1 - s) * 1.2;
        f.mesh.scale.y = f.mesh.scale.x * (0.3 + 0.7 * s);
        if (s <= 0) {
          this.group.remove(f.mesh);
          this.falling.splice(i, 1);
        }
      }
    }
  }

  dispose(): void {
    for (const s of SPECIES) {
      this.trees[s].dispose();
      this.stumps[s].dispose();
    }
    this.strippedBirch.dispose();
    for (const k of RESOURCE_KINDS) this.resources[k]?.dispose();
    this.berries?.dispose();
    for (const g of [...this.grass, ...this.flowers, ...this.others]) g.dispose();
    for (const g of this.ownedGeos) g.dispose();
  }
}

