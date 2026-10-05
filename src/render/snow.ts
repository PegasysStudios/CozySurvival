import * as THREE from 'three';
import { snowAmount, snowSurface } from '../sim/snow';
import type { GameState } from '../sim/state';
import type { Terrain } from '../sim/terrain';
import type { ResourceGen, WorldGen } from '../sim/worldgen';
import { TRUNK_AXIS_LIFT } from '../sim/trunks';
import { fallenLogGeometry, rockGeometry } from './models';

interface SurfaceFace {
  x: number; y: number; z: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
  ux: number; uz: number; vx: number; vz: number;
  uy: number; vy: number;
}

/** Cache projected triangle planes once, so changing snow can follow warped scenery without scene raycasts. */
function surfaceFaces(geometry: THREE.BufferGeometry): SurfaceFace[] {
  const p = geometry.getAttribute('position');
  const faces: SurfaceFace[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const bx = p.getX(i + 1), by = p.getY(i + 1), bz = p.getZ(i + 1);
    const cx = p.getX(i + 2), cy = p.getY(i + 2), cz = p.getZ(i + 2);
    const determinant = (bx - x) * (cz - z) - (bz - z) * (cx - x);
    if (Math.abs(determinant) < 1e-9) continue;
    faces.push({ x, y, z, minX: Math.min(x, bx, cx), maxX: Math.max(x, bx, cx), minZ: Math.min(z, bz, cz), maxZ: Math.max(z, bz, cz),
      ux: (cz - z) / determinant, uz: -(cx - x) / determinant, vx: -(bz - z) / determinant, vz: (bx - x) / determinant,
      uy: by - y, vy: cy - y });
  }
  geometry.dispose();
  return faces;
}

function surfaceHeight(faces: SurfaceFace[], x: number, z: number): number {
  let height = -Infinity;
  for (const face of faces) {
    if (x < face.minX || x > face.maxX || z < face.minZ || z > face.maxZ) continue;
    const dx = x - face.x, dz = z - face.z;
    const u = dx * face.ux + dz * face.uz, v = dx * face.vx + dz * face.vz;
    if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
    height = Math.max(height, face.y + u * face.uy + v * face.vy);
  }
  return height;
}

interface Patch {
  resource: ResourceGen;
  index: number;
  offset: number;
  amount: number;
}

interface Chunk {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  patches: Patch[];
}

/** Soft lobed clumps, merged into small world chunks. No transparent fades or hundreds of draw calls. */
export class SnowView {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly chunks: Chunk[] = [];
  private readonly template: number[] = [];
  private readonly supports = new Map<string, SurfaceFace[]>();
  private minute = -1;
  private active = 0;
  private readonly terrain: Terrain;
  private readonly gen: WorldGen;

  constructor(terrain: Terrain, gen: WorldGen) {
    this.terrain = terrain;
    this.gen = gen;
    this.group.name = 'snow-clumps';
    this.group.visible = false;
    if (gen.biome !== 'pnw') return;
    const indexed = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    const dome = indexed.toNonIndexed();
    indexed.dispose();
    const pos = dome.getAttribute('position');
    for (const [x, z, size, depth] of [[0, 0, 0.72, 1], [-0.43, 0.18, 0.45, 0.7], [0.4, -0.2, 0.42, 0.6]]) {
      for (let i = 0; i < pos.count; i++) this.template.push(x + pos.getX(i) * size, pos.getY(i) * depth, z + pos.getZ(i) * size);
    }
    dome.dispose();
    const bins = new Map<string, { resource: ResourceGen; index: number }[]>();
    gen.resources.forEach((resource, index) => {
      if (!resource.snow) return;
      if (resource.snow.surface === 'log' && !this.supports.has('log')) this.supports.set('log', surfaceFaces(fallenLogGeometry()));
      if (resource.snow.surface === 'rock') {
        const variant = gen.rocks[resource.snow.ref].variant, key = `rock-${variant}`;
        if (!this.supports.has(key)) this.supports.set(key, surfaceFaces(rockGeometry(variant)));
      }
      const key = `${Math.floor(resource.x / 32)},${Math.floor(resource.z / 32)}`;
      const bin = bins.get(key) ?? [];
      bin.push({ resource, index });
      bins.set(key, bin);
    });
    for (const bin of bins.values()) {
      const positions = new Float32Array(bin.length * this.template.length);
      const colors = new Float32Array(positions.length);
      for (let i = 0; i < colors.length; i += 3) {
        const top = this.template[i % this.template.length + 1];
        colors[i] = 0.68 + top * 0.2;
        colors[i + 1] = 0.82 + top * 0.13;
        colors[i + 2] = 0.9 + top * 0.08;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = 'snow-clumps';
      mesh.castShadow = mesh.receiveShadow = true;
      const patches = bin.map((entry, i) => ({ ...entry, offset: i * this.template.length, amount: -1 }));
      this.chunks.push({ mesh, patches });
      this.group.add(mesh);
    }
  }

  get activeClumps(): number { return this.active; }

  private supportHeight(r: ResourceGen, x: number, z: number): number {
    const p = r.snow!;
    if (p.surface === 'ground') return this.terrain.heightAt(x, z);
    const isLog = p.surface === 'log';
    const support = isLog ? this.gen.logs[p.ref] : this.gen.rocks[p.ref];
    const dx = x - support.x, dz = z - support.z;
    const c = Math.cos(support.rot), s = Math.sin(support.rot);
    const sx = isLog ? this.gen.logs[p.ref].length : support.r;
    const sy = isLog ? support.r : support.r * this.gen.rocks[p.ref].scaleY;
    const key = isLog ? 'log' : `rock-${this.gen.rocks[p.ref].variant}`;
    const localY = surfaceHeight(this.supports.get(key)!, (dx * c - dz * s) / sx, (dx * s + dz * c) / support.r);
    if (!Number.isFinite(localY)) return snowSurface(this.terrain, this.gen, r, x, z);
    return this.terrain.heightAt(support.x, support.z) + support.r * (isLog ? TRUNK_AXIS_LIFT : -0.12) + localY * sy;
  }

  /** Melting follows game time (including sleep/time skips), with at most one geometry refresh per game minute. */
  update(state: GameState, force = false): void {
    const minute = Math.floor(state.totalHours * 60);
    if (!force && minute === this.minute) return;
    this.minute = minute;
    this.active = 0;
    for (const chunk of this.chunks) {
      const attribute = chunk.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const positions = attribute.array;
      let changed = false, visible = false;
      for (const patch of chunk.patches) {
        const r = patch.resource, snow = r.snow!;
        const amount = snowAmount(r, state, patch.index);
        if (amount > 0) { visible = true; this.active++; }
        if (amount === patch.amount) continue;
        patch.amount = amount;
        changed = true;
        const c = Math.cos(r.rot), s = Math.sin(r.rot);
        for (let i = 0; i < this.template.length; i += 3) {
          const lx = this.template[i] * snow.ax * amount, lz = this.template[i + 2] * snow.az * amount;
          const x = r.x + lx * c + lz * s, z = r.z - lx * s + lz * c;
          const y = this.supportHeight(r, x, z) + this.template[i + 1] * snow.depth * amount - 0.02;
          const o = patch.offset + i;
          positions[o] = x;
          positions[o + 1] = y;
          positions[o + 2] = z;
        }
      }
      chunk.mesh.visible = visible;
      if (changed) {
        attribute.needsUpdate = true;
        chunk.mesh.geometry.computeVertexNormals();
        chunk.mesh.geometry.computeBoundingSphere();
      }
    }
    this.group.visible = this.active > 0;
  }

  dispose(): void {
    for (const chunk of this.chunks) chunk.mesh.geometry.dispose();
    this.material.dispose();
    this.group.clear();
  }
}
