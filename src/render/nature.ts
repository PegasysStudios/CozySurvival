import * as THREE from 'three';
import { smoothstep } from '../core/math';
import { Rng } from '../core/rng';
import { PREFABS } from '../data/prefabs';
import { RESOURCE_KINDS, TREES, type ResourceKind, type TreeSpecies } from '../data/resources';
import type { GameState } from '../sim/state';
import { PLAY_HALF, type Terrain } from '../sim/terrain';
import { barkStripped, TRUNK_AXIS_LIFT, trunkSpan } from '../sim/trunks';
import type { WorldGen } from '../sim/worldgen';
import { tf, withWind } from './geo';
import { ChunkedInstances, type InstanceSpec } from './instances';
import { creosoteGeometry, desertFlowerGeometry, desertGrassGeometry, SAGUARO_HEIGHT, saguaroGeometry, shrubGeometry } from './desertModels';
import { fallenLogGeometry, flowerGeometry, grassGeometry, resourceGeometry, rockGeometry, stumpGeometry, treeGeometry, trunkGeometry } from './models';

const ALL_SPECIES = Object.keys(TREES) as TreeSpecies[];
/** Plants that shrink to a stub when picked instead of vanishing. */
const SHRINK_WHEN_PICKED = new Set<ResourceKind>(['fern', 'yucca']);
const SWAYING = new Set<ResourceKind>(['berryBush', 'fern', 'onion', 'yucca', 'chia', 'wolfberry']);
const GRASS_VIEW = 85;
const FLOWER_VIEW = 70;
const RESOURCE_VIEW = 140;
const SCRUB_VIEW = 120;
const SCRUB_LOD_DIST = 60;
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
  /** Tree species on this map, in a fixed order. */
  private readonly species: TreeSpecies[];
  private readonly treeGeos = {} as Record<TreeSpecies, THREE.BufferGeometry>;
  private readonly trees = {} as Record<TreeSpecies, ChunkedInstances>;
  private readonly stumps = {} as Record<TreeSpecies, ChunkedInstances>;
  /**
   * Hand-harvested trees (peeled birch, juniper and cottonwood; mesquite without pods; pinyon without cones), drawn
   * from twin instance sets.
   */
  private readonly strippedTrees: Partial<Record<TreeSpecies, ChunkedInstances>> = {};
  private readonly strippedGeos: Partial<Record<TreeSpecies, THREE.BufferGeometry>> = {};
  private readonly treeLocal: Int32Array;
  private readonly resources = {} as Record<ResourceKind, ChunkedInstances>;
  /** Fruit, berries and buds that disappear when a plant is picked. */
  private readonly extras: Partial<Record<ResourceKind, ChunkedInstances>> = {};
  private readonly resLocal: Int32Array;
  private readonly grass: ChunkedInstances[] = [];
  private readonly flowers: ChunkedInstances[] = [];
  /** Desert scrub (creosote, bursage, sagebrush). */
  private readonly scrub: ChunkedInstances[] = [];
  /** Ground cover a structure hides when built over it. */
  private readonly grassPos: { inst: ChunkedInstances; local: number; x: number; z: number }[] = [];
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
    const present = new Set(gen.trees.map((tr) => tr.species));
    this.species = gen.biome === 'pnw' ? ['fir', 'cedar', 'birch', 'maple'] : ALL_SPECIES.filter((s) => present.has(s));
    this.felled = new Uint8Array(gen.trees.length);
    this.stripped = new Uint8Array(gen.trees.length);
    this.resourceUp = new Int8Array(gen.resources.length).fill(-1);
    this.treeLocal = new Int32Array(gen.trees.length);
    this.resLocal = new Int32Array(gen.resources.length);
    this.buildTrees();
    this.buildRocksAndLogs();
    this.buildResources();
    if (gen.biome === 'desert') {
      this.buildCacti();
      this.buildDesertGround();
    } else {
      this.buildGround();
    }
  }

  private own<T extends THREE.BufferGeometry>(g: T): T {
    this.ownedGeos.push(g);
    return g;
  }

  private buildTrees(): void {
    const t = this.terrain;
    const specs = {} as Record<TreeSpecies, InstanceSpec[]>;
    for (const s of this.species) specs[s] = [];
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
    for (const s of this.species) {
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
      if (TREES[s].bark <= 0 || !specs[s].length) continue;
      const geo = this.own(treeGeometry(s, 0, true));
      const strippedSpecs = specs[s].map((sp) => ({ matrix: sp.matrix.clone(), color: sp.color?.clone() }));
      const inst = new ChunkedInstances(geo, this.mats.foliage, strippedSpecs, {
        chunkSize: 48, castShadow: true, name: `trees-${s}-stripped`, lod: this.own(treeGeometry(s, 1, true)),
      });
      for (let i = 0; i < strippedSpecs.length; i++) inst.setHidden(i, true);
      this.strippedGeos[s] = geo;
      this.strippedTrees[s] = inst;
      this.group.add(inst.group);
    }
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
    const desert = this.gen.biome === 'desert';
    const palettes = desert ? (['sandstone', 'basalt'] as const) : (['pnw'] as const);
    const bins: InstanceSpec[][] = palettes.flatMap(() => [[], [], []]);
    for (const r of this.gen.rocks) {
      const y = t.heightAt(r.x, r.z) - r.r * 0.12;
      const k = 0.88 + r.tint * 0.22;
      const p = desert && t.landformAt(r.x, r.z).volcanic ? 1 : 0;
      bins[p * 3 + r.variant].push({ matrix: tf(r.x, y, r.z, 0, r.rot, 0, r.r, r.r * r.scaleY, r.r), color: new THREE.Color(k, k, k * 1.02) });
    }
    bins.forEach((specs, i) => {
      if (!specs.length) return;
      const inst = new ChunkedInstances(this.own(rockGeometry(i % 3, palettes[Math.floor(i / 3)])), this.mats.solid, specs, { chunkSize: 64, castShadow: true, name: 'rocks' });
      this.others.push(inst);
      this.group.add(inst.group);
    });
    const logSpecs = this.gen.logs.map((l) => {
      const y = t.heightAt(l.x, l.z) + l.r * 0.7;
      return { matrix: tf(l.x, y, l.z, 0, l.rot, 0, l.length, l.r, l.r) };
    });
    if (logSpecs.length) {
      const inst = new ChunkedInstances(this.own(fallenLogGeometry(desert)), this.mats.solid, logSpecs, { chunkSize: 64, castShadow: true, name: 'logs' });
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
      const mat = model.doubleSided ? this.mats.plant : SWAYING.has(k) ? this.mats.foliage : this.mats.solid;
      const shadow = k === 'berryBush' || k === 'pricklyPear' || k === 'cholla' || k === 'wolfberry' || k === 'agave';
      this.resources[k] = new ChunkedInstances(model.main, mat, specs[k], { chunkSize: 48, castShadow: shadow, name: 'res-' + k });
      this.group.add(this.resources[k].group);
      if (model.extra) {
        this.own(model.extra);
        const extra = new ChunkedInstances(model.extra, SWAYING.has(k) ? this.mats.foliage : this.mats.solid, specs[k], { chunkSize: 48, name: k === 'berryBush' ? 'berries' : 'fruit-' + k });
        this.extras[k] = extra;
        this.group.add(extra.group);
      }
    }
  }

  /** Saguaros: instanced per arm count, scaled to their height. */
  private buildCacti(): void {
    const bins: InstanceSpec[][] = [[], [], [], [], []];
    for (const c of this.gen.cacti) {
      const y = this.terrain.heightAt(c.x, c.z) - 0.1;
      const k = c.r / 0.3;
      bins[Math.min(4, c.arms)].push({ matrix: tf(c.x, y, c.z, 0, c.rot, 0, k, c.height / SAGUARO_HEIGHT, k) });
    }
    bins.forEach((specs, arms) => {
      if (!specs.length) return;
      const inst = new ChunkedInstances(this.own(saguaroGeometry(arms)), this.mats.solid, specs, {
        chunkSize: 64, castShadow: true, name: 'saguaro', lod: this.own(saguaroGeometry(arms, 1)),
      });
      this.others.push(inst);
      this.group.add(inst.group);
    });
  }

  /**
   * Desert ground cover. Creosote fills 80% of a jittered 5.2 m grid on the low flats (about 300 bushes per hectare,
   * a little under measured Sonoran stands of 440/ha) with white bursage between; big sagebrush and bunchgrass take over in the high
   * country; wildflowers are scattered thinly; bare slickrock, cliffs and pools stay open.
   */
  private buildDesertGround(): void {
    const t = this.terrain;
    const rng = new Rng(this.gen.seed ^ 0x6a56);
    const open = (x: number, z: number, maxSlope: number) => {
      const h = t.heightAt(x, z);
      if (h < 0.9 || t.slopeAt(x, z) > maxSlope) return false;
      if (Math.hypot(x - t.spawn.x, z - t.spawn.z) < 3.5) return false;
      return t.landformAt(x, z).rock < 0.3 && t.slickrock(x, z) < 0.45;
    };
    const creo: InstanceSpec[][] = [[], []];
    const burs: InstanceSpec[][] = [[], []];
    const sage: InstanceSpec[][] = [[], []];
    const grass: InstanceSpec[][] = [[], [], []];
    const flowers: InstanceSpec[][] = [[], [], [], []];
    const pos: { list: InstanceSpec[][]; set: number; local: number; x: number; z: number }[] = [];
    const put = (list: InstanceSpec[][], set: number, x: number, z: number, s: number, sy = s, track = true) => {
      if (track) pos.push({ list, set, local: list[set].length, x, z });
      list[set].push({ matrix: tf(x, t.heightAt(x, z) - 0.03, z, 0, rng.range(0, 6.28), 0, s, sy, s) });
    };
    const cell = 5.2;
    for (let gx = -PLAY_HALF; gx < PLAY_HALF; gx += cell) {
      for (let gz = -PLAY_HALF; gz < PLAY_HALF; gz += cell) {
        const x = gx + rng.range(0.4, cell - 0.4);
        const z = gz + rng.range(0.4, cell - 0.4);
        const u = t.upland(x, z);
        const roll = rng.next();
        if (!open(x, z, 0.6)) continue;
        if (u < 0.3) {
          if (roll < 0.8 * (1 - u * 2)) put(creo, rng.chance(0.3) ? 1 : 0, x, z, rng.range(0.8, 1.25));
        } else if (roll < 0.62 * (1 - smoothstep(0.8, 1, u) * 0.6)) {
          put(sage, rng.int(0, 1), x, z, rng.range(0.8, 1.3));
        }
      }
    }
    for (let i = 0; i < 9000; i++) {
      const x = rng.range(-PLAY_HALF, PLAY_HALF);
      const z = rng.range(-PLAY_HALF, PLAY_HALF);
      if (!open(x, z, 0.62)) continue;
      const u = t.upland(x, z);
      const plains = t.field(x, z, 3);
      if (u < 0.3 && rng.chance(0.3)) put(burs, rng.int(0, 1), x, z, rng.range(0.8, 1.3));
      const g = u > 0.25 ? 0.35 + 0.5 * smoothstep(0.25, 0.7, u) : 0.1 + 0.55 * smoothstep(0.55, 0.8, plains);
      if (rng.chance(g)) put(grass, rng.int(0, 2), x, z, rng.range(0.75, 1.3), undefined);
    }
    for (let i = 0; i < 4000 && flowers.reduce((a, b) => a + b.length, 0) < 650; i++) {
      const x = rng.range(-PLAY_HALF, PLAY_HALF);
      const z = rng.range(-PLAY_HALF, PLAY_HALF);
      if (!open(x, z, 0.5)) continue;
      const v = t.upland(x, z) > 0.35 ? rng.pick([2, 3]) : rng.pick([0, 0, 1, 2]);
      put(flowers, v, x, z, rng.range(0.8, 1.2), undefined, false);
    }
    const add = (list: InstanceSpec[][], geo: (v: number) => THREE.BufferGeometry, into: ChunkedInstances[], name: string, mat = this.mats.foliage, lod?: (v: number) => THREE.BufferGeometry) => {
      return list.map((specs, v) => {
        if (!specs.length) return null;
        const inst = new ChunkedInstances(this.own(geo(v)), mat, specs, { chunkSize: 40, name, lod: lod ? this.own(lod(v)) : undefined });
        into.push(inst);
        this.group.add(inst.group);
        return inst;
      });
    };
    const made = new Map<InstanceSpec[][], (ChunkedInstances | null)[]>([
      [creo, add(creo, (v) => creosoteGeometry(v), this.scrub, 'creosote', this.mats.foliage, (v) => creosoteGeometry(v, 1))],
      [burs, add(burs, (v) => shrubGeometry('bursage', v), this.scrub, 'bursage')],
      [sage, add(sage, (v) => shrubGeometry('sage', v), this.scrub, 'sagebrush')],
      [grass, add(grass, (v) => desertGrassGeometry(v), this.grass, 'grass', this.mats.plant)],
    ]);
    add(flowers, (v) => desertFlowerGeometry(v), this.flowers, 'flowers', this.mats.plant);
    for (const p of pos) {
      const inst = made.get(p.list)?.[p.set];
      if (inst) this.grassPos.push({ inst, local: p.local, x: p.x, z: p.z });
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
    for (const g of grassIdx) this.grassPos.push({ inst: this.grass[g.set], local: g.local, x: g.x, z: g.z });
  }

  /** Bring instance visibility in line with the simulation state. */
  sync(state: GameState, animate: boolean): void {
    for (let i = 0; i < this.gen.trees.length; i++) {
      const sp = this.gen.trees[i].species;
      const strip = barkStripped(sp, state.trees[i]) ? 1 : 0;
      const twin = this.strippedTrees[sp];
      if (strip !== this.stripped[i] && !state.trees[i].felled) {
        this.stripped[i] = strip;
        this.trees[sp].setHidden(this.treeLocal[i], !!strip);
        twin?.setHidden(this.treeLocal[i], !strip);
      }
      const felled = state.trees[i].felled ? 1 : 0;
      if (felled !== this.felled[i]) {
        this.felled[i] = felled;
        this.trees[sp].setHidden(this.treeLocal[i], !!felled || !!this.stripped[i]);
        if (this.stripped[i]) twin?.setHidden(this.treeLocal[i], !!felled);
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
      const extra = this.extras[kind];
      if (SHRINK_WHEN_PICKED.has(kind)) inst.setMatrix(local, this.resourceMatrix(i, !up));
      else if (extra) extra.setHidden(local, !up);
      else inst.setHidden(local, !up);
    }
    for (const st of state.structures) {
      if (this.structuresSeen.has(st.id)) continue;
      this.structuresSeen.add(st.id);
      const r = PREFABS[st.prefab].footprint.type === 'circle' ? (PREFABS[st.prefab].footprint as { r: number }).r : Math.hypot((PREFABS[st.prefab].footprint as { hw: number }).hw, (PREFABS[st.prefab].footprint as { hd: number }).hd);
      for (const g of this.grassPos) {
        const dx = g.x - st.x;
        const dz = g.z - st.z;
        if (dx * dx + dz * dz < (r + 0.2) * (r + 0.2)) g.inst.setHidden(g.local, true);
      }
    }
  }

  private startFall(i: number, state: GameState): void {
    const tr = this.gen.trees[i];
    const y = this.terrain.heightAt(tr.x, tr.z) - 0.15;
    const mesh = new THREE.Mesh((this.stripped[i] && this.strippedGeos[tr.species]) || this.treeGeos[tr.species], this.mats.foliage);
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
      height: TREES[tr.species].height * tr.scale,
      species: tr.species,
    });
  }

  /** `viewDist` is where fog fully hides the world; nothing past it needs drawing. */
  update(dt: number, px: number, pz: number, viewDist: number): void {
    for (const g of this.grass) g.cullByDistance(px, pz, GRASS_VIEW);
    for (const f of this.flowers) f.cullByDistance(px, pz, FLOWER_VIEW);
    for (const s of this.scrub) s.cullByDistance(px, pz, Math.min(SCRUB_VIEW, viewDist), SCRUB_LOD_DIST);
    for (const s of this.species) {
      this.trees[s].cullByDistance(px, pz, viewDist, TREE_LOD_DIST);
      this.stumps[s].cullByDistance(px, pz, viewDist);
      this.strippedTrees[s]?.cullByDistance(px, pz, viewDist, TREE_LOD_DIST);
    }
    for (const k of RESOURCE_KINDS) {
      this.resources[k]?.cullByDistance(px, pz, Math.min(RESOURCE_VIEW, viewDist));
      this.extras[k]?.cullByDistance(px, pz, Math.min(RESOURCE_VIEW, viewDist));
    }
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
    for (const s of this.species) {
      this.trees[s].dispose();
      this.stumps[s].dispose();
      this.strippedTrees[s]?.dispose();
    }
    for (const k of RESOURCE_KINDS) {
      this.resources[k]?.dispose();
      this.extras[k]?.dispose();
    }
    for (const g of [...this.grass, ...this.flowers, ...this.scrub, ...this.others]) g.dispose();
    for (const g of this.ownedGeos) g.dispose();
  }
}

