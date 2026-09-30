import * as THREE from 'three';
import { clamp } from '../core/math';
import { hash2, Rng } from '../core/rng';
import { TREES, type ResourceKind, type TreeSpecies } from '../data/resources';
import { between, col, GeoBuilder, mix, tf } from './geo';
import type { ResourceModel } from './models';
import { blades, foliage } from './plantParts';

const { CylinderGeometry, ConeGeometry, IcosahedronGeometry, DodecahedronGeometry, OctahedronGeometry } = THREE;

type V3 = [number, number, number];

const ISLAND_TREES = new Set<TreeSpecies>(['palm', 'breadfruit', 'kukui', 'hau', 'treeFern']);

export function isIslandTree(species: TreeSpecies): boolean {
  return ISLAND_TREES.has(species);
}

/** Palm crown geometry at scale 1: the fronds meet at `PALM_TOP`, `PALM_LEAN` out along local +x. */
const PALM = TREES.palm.crown!;
const PALM_TOP = PALM.height + 0.35;

/**
 * A leaf blade as a strip of quads from `base` along `dir` (unit, in the xz plane), arching up by `lift` and drooping
 * by `droop` at the tip, folded into a shallow V, drawn from both sides.
 */
function leafStrip(b: GeoBuilder, base: V3, dir: [number, number], len: number, width: number, lift: number, droop: number, segs: number, color: (t: number) => THREE.Color, sway: number, fold = 0.25, twoSided = true): void {
  const pos: number[] = [];
  const px = -dir[1];
  const pz = dir[0];
  const pt = (t: number, side: number): V3 => {
    const along = len * t;
    const y = base[1] + lift * Math.sin(t * Math.PI * 0.6) - droop * t * t;
    const w = width * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)) * side;
    return [base[0] + dir[0] * along + px * w, y - Math.abs(side) * fold * width * (1 - t * 0.5), base[2] + dir[1] * along + pz * w];
  };
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const c0 = pt(t0, 0), l0 = pt(t0, -1), r0 = pt(t0, 1), c1 = pt(t1, 0), l1 = pt(t1, -1), r1 = pt(t1, 1);
    const quads: V3[][] = [[c0, l0, c1], [l0, l1, c1], [c0, c1, r0], [r0, c1, r1]];
    for (const [a, bb, c] of quads) {
      pos.push(...a, ...bb, ...c);
      if (twoSided) pos.push(...a, ...c, ...bb);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  b.add(g, { color: (x, _y, z) => color(clamp(Math.hypot(x - base[0], z - base[2]) / len, 0, 1)), vary: 0.08, sway: (y) => sway * clamp((y - base[1] + 1) / 3, 0, 1) });
  g.dispose();
}

function palm(b: GeoBuilder, near: boolean): void {
  const segs = near ? 9 : 5;
  const ring = (y: number) => (Math.sin(y * 9) > 0.55 ? col('#6a5e4c') : mix('#8f826c', '#a89a80', hash2(Math.floor(y * 4), 3, 7)));
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const r = 0.23 - 0.08 * t0;
    b.add(new CylinderGeometry(r * 0.94, r, 1, near ? 7 : 5), {
      matrix: between(PALM.lean * t0 * t0, PALM_TOP * t0, 0, PALM.lean * t1 * t1, PALM_TOP * t1, 0),
      color: (_x, y) => ring(y), jitter: 0.02, vary: 0.05, sway: (y) => clamp(y / 12, 0, 1) * 0.12,
    });
  }
  b.add(new CylinderGeometry(0.26, 0.34, 0.5, near ? 7 : 5), { matrix: tf(0, 0.2, 0), color: '#6a5e4c' });
  const top: V3 = [PALM.lean, PALM_TOP, 0];
  b.add(new IcosahedronGeometry(0.3, near ? 1 : 0), { matrix: tf(top[0], top[1] - 0.1, top[2], 0, 0, 0, 1, 1.2, 1), color: '#6f7a3a', sway: 0.12 });
  const n = near ? 9 : 7;
  const rng = new Rng(311);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const old = i % 5 === 3;
    const len = rng.range(3.1, 3.8);
    leafStrip(b, top, [Math.cos(a), Math.sin(a)], len, near ? 0.42 : 0.36, old ? 0.1 : rng.range(0.55, 0.9), old ? 2.6 : rng.range(1.5, 2.1), near ? 4 : 3,
      (t) => (old ? mix('#9a8a4a', '#c0a860', t) : mix('#3f7a32', '#8fbe52', t * 0.9 + 0.1)), 0.14);
  }
  if (near) {
    // A dried-out frond hangs against the trunk, as on real palms.
    leafStrip(b, [top[0] - 0.1, top[1] - 0.3, 0], [-0.3, 0.95], 1.8, 0.28, -0.3, 2.2, 3, (t) => mix('#8a7650', '#a89060', t), 0.08);
  }
}

/** One of a palm's three coconuts, at scale 1 in the palm's own frame (instanced with the palm's matrix). */
export function coconutCrownGeometry(k: number): THREE.BufferGeometry {
  const b = new GeoBuilder(700 + k);
  const a = k * 2.1 + 0.4;
  b.add(new IcosahedronGeometry(0.19, 0), {
    matrix: tf(PALM.lean + Math.cos(a) * 0.3, PALM_TOP - 0.45 - (k === 1 ? 0.12 : 0), Math.sin(a) * 0.3, 0, a, 0, 1, 1.12, 1),
    color: (_x, _y, _z, n) => (n.y > 0.5 ? col('#7a8a3a') : mix('#5f6a2e', '#8a7a3a', 0.5 + n.x * 0.3)),
    jitter: 0.02, vary: 0.06, sway: 0.1,
  });
  return b.build(true);
}

function breadfruit(b: GeoBuilder, near: boolean, stripped: boolean): void {
  b.add(new CylinderGeometry(0.24, 0.34, 4.6, near ? 8 : 5, near ? 2 : 1), { matrix: tf(0, 2.3, 0), color: (_x, y) => mix('#5a5046', '#7a6e5e', y / 5), jitter: 0.04 });
  const limbs: [number, number, number][] = [[1.6, 5.8, 0.4], [-1.5, 6.1, -0.6], [0.3, 6.6, 1.6], [-0.4, 6.2, -1.7]];
  if (near) for (const [x, y, z] of limbs) b.add(new CylinderGeometry(0.08, 0.15, 1, 6), { matrix: between(0, 4.2, 0, x, y, z), color: '#62584a' });
  const rng = new Rng(521);
  const blobs: [number, number, number, number][] = [[0, 8.2, 0, 2.2], [1.9, 7.2, 0.6, 1.8], [-1.8, 7.3, -0.7, 1.9], [0.5, 7.0, 1.9, 1.7], [-0.6, 7.0, -2.0, 1.7], [1.1, 8.8, -0.9, 1.3]];
  for (const [x, y, z, r] of blobs) {
    b.add(near ? new DodecahedronGeometry(r, 1) : new IcosahedronGeometry(r, 0), {
      matrix: tf(x, y, z, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.74, 1),
      color: foliage('#23551f', '#5f9a3a', '#1a3f18'),
      jitter: near ? 0.4 : 0.16, vary: 0.1, sway: 0.08,
    });
  }
  if (stripped) return;
  for (let i = 0; i < (near ? 9 : 5); i++) {
    const [x, y, z, r] = blobs[i % 5];
    const a = rng.range(0, Math.PI * 2);
    b.add(new IcosahedronGeometry(0.2, near ? 1 : 0), {
      matrix: tf(x + Math.cos(a) * r * 0.75, y - r * 0.55, z + Math.sin(a) * r * 0.75),
      color: (px, py, pz) => (hash2(Math.round(px * 40), Math.round((py + pz) * 40), 5) < 0.3 ? col('#7a9a3a') : col('#a8c05a')),
      vary: 0.05, sway: 0.08,
    });
  }
}

function kukui(b: GeoBuilder, near: boolean): void {
  b.add(new CylinderGeometry(0.22, 0.4, 6.2, near ? 8 : 5, near ? 3 : 1), { matrix: tf(0, 3.1, 0), color: (_x, y, _z, n) => (n.x > 0.6 && y < 3 ? col('#6a7a4a') : mix('#8a8478', '#a8a296', y / 7)), jitter: 0.05 });
  if (near) {
    const limbs: [number, number, number][] = [[1.9, 8.2, 0.5], [-1.8, 8.4, -0.4], [0.3, 8.9, 1.9], [-0.2, 8.1, -1.9], [1.2, 9.6, -1.1]];
    for (const [x, y, z] of limbs) b.add(new CylinderGeometry(0.09, 0.16, 1, 6), { matrix: between(0, 5.6, 0, x, y, z), color: '#948e82' });
  }
  const rng = new Rng(733);
  const blobs: [number, number, number, number][] = [[0, 10.4, 0, 2.5], [2.2, 9.2, 0.7, 2.1], [-2.1, 9.4, -0.6, 2.1], [0.6, 9.0, 2.2, 1.9], [-0.7, 9.1, -2.2, 1.9], [1.4, 10.9, -1.2, 1.6], [-1.3, 10.8, 1.3, 1.6]];
  for (const [x, y, z, r] of blobs) {
    b.add(near ? new DodecahedronGeometry(r, 1) : new IcosahedronGeometry(r * 1.04, 0), {
      matrix: tf(x, y, z, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.7, 1),
      color: foliage('#5a7a4a', '#b4c894', '#3f5a36'),
      jitter: near ? 0.42 : 0.16, vary: 0.1, sway: 0.08,
    });
  }
}

/** Where a peeled hau shows bare wood. */
const HAU_STRIP = 1.8;

function hau(b: GeoBuilder, near: boolean, stripped: boolean): void {
  const bark = (x: number, y: number, z: number) => {
    const a = Math.atan2(z, x);
    if (stripped && y < HAU_STRIP + (hash2(Math.floor(a * 3), 3, 41) - 0.5) * 0.4) return mix('#c8b08a', '#e0cca4', hash2(Math.floor(y * 3), Math.floor(a * 2), 43));
    return mix('#6a6258', '#8a8274', hash2(Math.floor(a * 3), Math.floor(y * 2), 47));
  };
  const stems: [V3, V3][] = [[[0, 0, 0], [0.9, 2.4, 0.3]], [[0, 0, 0], [-0.8, 2.2, 0.5]], [[0, 0, 0], [0.1, 2.6, -0.9]]];
  for (const [a, c] of stems) b.add(new CylinderGeometry(0.1, 0.16, 1, near ? 6 : 4), { matrix: between(a[0], a[1], a[2], c[0], c[1], c[2]), color: bark, jitter: 0.03 });
  if (near) for (const [, c] of stems) b.add(new CylinderGeometry(0.05, 0.09, 1, 5), { matrix: between(c[0], c[1], c[2], c[0] * 1.6, c[1] + 1.1, c[2] * 1.6), color: bark });
  const rng = new Rng(907);
  const blobs: [number, number, number, number][] = [[1.4, 3.7, 0.5, 1.5], [-1.3, 3.5, 0.8, 1.45], [0.2, 3.9, -1.4, 1.5], [0.1, 4.6, 0.1, 1.5], [1.6, 3.1, -1.1, 1.1], [-1.5, 3.0, -0.9, 1.1]];
  for (const [x, y, z, r] of blobs) {
    b.add(new IcosahedronGeometry(r, near ? 1 : 0), {
      matrix: tf(x, y, z, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.62, 1),
      color: foliage('#3f6f2e', '#7aac48', '#2c4f22'),
      jitter: near ? 0.34 : 0.14, vary: 0.1, sway: 0.08,
    });
  }
  if (!near) return;
  // Yellow hibiscus flowers dotted through the leaves.
  for (let i = 0; i < 14; i++) {
    const [x, y, z, r] = blobs[i % blobs.length];
    const a = rng.range(0, Math.PI * 2);
    const up = rng.range(-0.2, 0.5);
    b.add(new CylinderGeometry(0.1, 0.03, 0.08, 5), { matrix: tf(x + Math.cos(a) * r * 0.9, y + up * r * 0.6, z + Math.sin(a) * r * 0.9, rng.range(0, 1), a, rng.range(0, 1)), color: rng.pick(['#f2d23a', '#f5c030', '#e8a030']), vary: 0.05, sway: 0.08 });
  }
}

function treeFern(b: GeoBuilder, near: boolean): void {
  const H = 3.8;
  b.add(new CylinderGeometry(0.13, 0.18, H, near ? 7 : 5, near ? 3 : 1), {
    matrix: tf(0, H / 2, 0),
    color: (x, y, z) => (hash2(Math.round(x * 30) + Math.round(y * 12), Math.round(z * 30), 9) < 0.35 ? col('#3a2a1e') : col('#5a4230')),
    jitter: 0.04,
  });
  const n = near ? 8 : 6;
  const rng = new Rng(1201);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
    leafStrip(b, [0, H, 0], [Math.cos(a), Math.sin(a)], rng.range(2.0, 2.5), near ? 0.36 : 0.3, rng.range(0.5, 0.8), rng.range(1.1, 1.5), near ? 4 : 3, (t) => mix('#2f6a2a', '#7ab04a', t), 0.12, 0.12);
  }
  // Coiled fiddleheads in the middle of the crown.
  if (near) for (let i = 0; i < 3; i++) b.add(new IcosahedronGeometry(0.07, 0), { matrix: tf(Math.cos(i * 2) * 0.1, H + 0.25, Math.sin(i * 2) * 0.1), color: '#8a9a4a' });
}

export function islandTreeGeometry(species: TreeSpecies, lod = 0, stripped = false): THREE.BufferGeometry {
  const b = new GeoBuilder(species.length * 41 + (stripped ? 3 : 0));
  const near = lod === 0;
  if (species === 'palm') palm(b, near);
  else if (species === 'breadfruit') breadfruit(b, near, stripped);
  else if (species === 'kukui') kukui(b, near);
  else if (species === 'hau') hau(b, near, stripped);
  else treeFern(b, near);
  return b.build(true);
}

/** A heart-shaped leaf (taro), drawn from both sides, tipped `tilt` down from its stalk end. */
function heartLeaf(b: GeoBuilder, at: V3, facing: number, size: number, tilt: number, dark: string, light: string): void {
  const pts: [number, number][] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = size * (0.62 + 0.38 * Math.cos(t)) * (1 - 0.35 * Math.max(0, Math.cos(t * 0.5 + Math.PI) ** 8));
    pts.push([Math.cos(t) * r + size * 0.35, Math.sin(t) * r * 0.85]);
  }
  const pos: number[] = [];
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  const put = (lx: number, lz: number): V3 => {
    const y = at[1] - lx * Math.sin(tilt) - (lz * lz) * 0.25;
    const x = lx * Math.cos(tilt);
    return [at[0] + x * c - lz * s, y, at[2] + x * s + lz * c];
  };
  const center = put(size * 0.35, 0);
  for (let i = 0; i < n; i++) {
    const a = put(pts[i][0], pts[i][1]);
    const bb = put(pts[i + 1][0], pts[i + 1][1]);
    pos.push(...center, ...a, ...bb, ...center, ...bb, ...a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  b.add(g, { color: (x, _y, z) => mix(dark, light, clamp(Math.hypot(x - at[0], z - at[2]) / (size * 1.4), 0, 1)), vary: 0.08, sway: 0.08 });
  g.dispose();
}

/** Island forage models. `extra` is the fruit that disappears once picked. */
export function islandResourceGeometry(kind: ResourceKind): ResourceModel {
  const rng = new Rng(kind.length * 1709 + 3);
  const b = new GeoBuilder(kind.length * 13);
  switch (kind) {
    case 'seaGrape': {
      // Round leathery leaves on sprawling stems, with hanging bunches of purple grapes.
      const blobs: V3[] = [[0, 0.5, 0], [0.45, 0.38, 0.2], [-0.4, 0.4, -0.2], [0.1, 0.35, -0.48], [-0.2, 0.72, 0.25], [0.35, 0.7, -0.2]];
      for (const [x, y, z] of blobs) {
        for (let i = 0; i < 5; i++) {
          const a = rng.range(0, Math.PI * 2);
          b.add(new CylinderGeometry(0.17, 0.17, 0.02, 7), { matrix: tf(x + Math.cos(a) * 0.2, y + rng.range(-0.1, 0.12), z + Math.sin(a) * 0.2, rng.range(-0.8, 0.8), a, rng.range(-0.8, 0.8)), color: (_x, _y, _z, n) => (n.y > 0 ? mix('#5a7a2e', '#8aa84a', rng.next()) : col('#6a5a2a')), vary: 0.1, sway: 0.05 });
        }
      }
      const fruit = new GeoBuilder(81);
      for (let k = 0; k < 5; k++) {
        const [x, y, z] = blobs[k];
        for (let i = 0; i < 6; i++) fruit.add(new OctahedronGeometry(0.035, 0), { matrix: tf(x + rng.range(-0.05, 0.05), y - 0.12 - i * 0.045, z + rng.range(-0.05, 0.05)), color: rng.pick(['#5a1a4a', '#7a2a5a', '#4a1a3a', '#8a4a6a']), vary: 0.05, sway: 0.05 });
      }
      return { main: b.build(true), extra: fruit.build(true) };
    }
    case 'pandanus': {
      // Stilt roots, a short trunk and spiralling tufts of long strap leaves.
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
        b.add(new CylinderGeometry(0.025, 0.035, 1, 4), { matrix: between(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45, 0, 0.55, 0), color: '#8a7a5a' });
      }
      b.add(new CylinderGeometry(0.07, 0.09, 0.7, 6), { matrix: tf(0, 0.8, 0, 0, 0, 0.12), color: '#8a7a5a' });
      const tufts: V3[] = [[0.05, 1.15, 0], [0.4, 0.95, 0.2]];
      tufts.forEach(([x, y, z], k) => {
        for (let i = 0; i < 14; i++) {
          const a = i * 2.4 + k;
          leafStrip(b, [x, y, z], [Math.cos(a), Math.sin(a)], rng.range(0.7, 1.05), 0.05, rng.range(0.1, 0.35), rng.range(0.3, 0.6), 3, (t) => mix('#4a6a32', '#9ab05a', t), 0.08, 0.3);
        }
      });
      return { main: b.build(true) };
    }
    case 'taro': {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const h = rng.range(0.55, 0.8);
        const ex = Math.cos(a) * 0.18;
        const ez = Math.sin(a) * 0.18;
        b.add(new CylinderGeometry(0.012, 0.02, 1, 4), { matrix: between(0, 0, 0, ex, h, ez), color: '#5a7a4a', sway: 0.05 });
        heartLeaf(b, [ex, h, ez], a, rng.range(0.26, 0.34), 0.5, '#2f6a2e', '#6aa84a');
      }
      return { main: b.build(true), doubleSided: true };
    }
    case 'banana': {
      b.add(new CylinderGeometry(0.1, 0.14, 1.9, 7), { matrix: tf(0, 0.95, 0), color: (_x, y) => mix('#6a6a3a', '#7a9a4a', y / 2), vary: 0.08 });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const torn = i % 3 === 1;
        leafStrip(b, [0, 1.85, 0], [Math.cos(a), Math.sin(a)], rng.range(1.3, 1.7), torn ? 0.2 : 0.3, rng.range(0.5, 0.8), rng.range(0.7, 1.1), 4, (t) => (torn ? mix('#6a8a3a', '#a8a050', t) : mix('#3f8a3a', '#8ac050', t)), 0.12, 0.05);
      }
      const bunch = new GeoBuilder(91);
      bunch.add(new CylinderGeometry(0.02, 0.02, 1, 4), { matrix: between(0.05, 1.8, 0, 0.28, 1.35, 0.05), color: '#6a7a3a', sway: 0.05 });
      for (let r = 0; r < 4; r++) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          bunch.add(new CylinderGeometry(0.022, 0.018, 0.13, 5), { matrix: tf(0.26 + Math.cos(a) * 0.06, 1.55 - r * 0.09, 0.05 + Math.sin(a) * 0.06, Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9), color: r < 2 ? '#c8c84a' : '#9ab04a', vary: 0.05, sway: 0.05 });
        }
      }
      bunch.add(new ConeGeometry(0.05, 0.16, 5), { matrix: tf(0.28, 1.14, 0.05, Math.PI, 0, 0), color: '#7a2a4a', sway: 0.05 });
      return { main: b.build(true), extra: bunch.build(true) };
    }
    case 'purslane': {
      for (let i = 0; i < 16; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(0, 0.22);
        b.add(new OctahedronGeometry(0.035, 0), { matrix: tf(Math.cos(a) * r, 0.03, Math.sin(a) * r, 0, a, 0, 1.4, 0.6, 0.8), color: rng.pick(['#5a8a3a', '#6a9a42', '#7aa84a']), vary: 0.08 });
      }
      for (let i = 0; i < 4; i++) b.add(new CylinderGeometry(0.018, 0.012, 0.012, 5), { matrix: tf(rng.range(-0.15, 0.15), 0.06, rng.range(-0.15, 0.15)), color: '#f0d23a' });
      return { main: b.build() };
    }
    case 'coconut':
    default: {
      b.add(new IcosahedronGeometry(0.17, 1), { matrix: tf(0, 0.14, 0, 0.4, 0, 0.2, 1, 0.9, 1.15), color: (_x, _y, _z, n) => (n.y > 0.6 ? col('#8a7a3a') : mix('#6a5a32', '#8a6a3a', 0.5 + n.x * 0.4)), jitter: 0.015, vary: 0.08 });
      return { main: b.build() };
    }
  }
}

/** Beach naupaka (Scaevola): a rounded mound of fleshy leaf rosettes, like the shrubs in the cove photo. */
export function naupakaGeometry(variant: number, lod = 0): THREE.BufferGeometry {
  const rng = new Rng(1500 + variant);
  const b = new GeoBuilder(1500 + variant);
  const near = lod === 0;
  const n = variant ? 7 : 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const r = i === 0 ? 0 : rng.range(0.3, 0.55);
    const y = rng.range(0.4, 0.7);
    b.add(new IcosahedronGeometry(near ? 0.36 : 0.42, 0), {
      matrix: tf(Math.cos(a) * r, y, Math.sin(a) * r, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.75, 1),
      color: foliage('#4f8a34', '#9ad05a', '#3a6a28'),
      jitter: near ? 0.16 : 0.06, vary: 0.12, sway: 0.03,
    });
  }
  return b.build(true);
}

/** Sedges and pili grass on the sand and the grassland: `tall` makes the waist-high leeward grass. */
export function islandGrassGeometry(variant: number, tall = false): THREE.BufferGeometry {
  const rng = new Rng(1600 + variant + (tall ? 50 : 0));
  const b = new GeoBuilder(1600 + variant);
  const palettes: [string, string][] = tall
    ? [['#7a8a3a', '#c8c46a'], ['#8a8a42', '#d6c878'], ['#6a8a3a', '#b4c060']]
    : [['#6a8a3a', '#a8c060'], ['#7a9a42', '#c0c870'], ['#5f8a3a', '#9ab85a']];
  const [d, l] = palettes[variant % palettes.length];
  blades(b, rng, tall ? 10 : 7, tall ? [0.6, 1.05] : [0.25, 0.45], tall ? 0.03 : 0.03, d, l, tall ? 0.2 : 0.14);
  return b.build(true);
}

/**
 * Jungle understory: 0 ground ferns, 1 a ti plant (a slim stalk with a tuft of red or green strap leaves), 2 a
 * broad-leaved elephant ear.
 */
export function jungleUnderstoryGeometry(variant: number): THREE.BufferGeometry {
  const rng = new Rng(1700 + variant);
  const b = new GeoBuilder(1700 + variant);
  if (variant === 0) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rng.range(-0.2, 0.2);
      leafStrip(b, [0, 0.05, 0], [Math.cos(a), Math.sin(a)], rng.range(0.7, 1.0), 0.16, rng.range(0.3, 0.5), 0.5, 3, (t) => mix('#2a5a28', '#5a9a3a', t), 0.1, 0.1, false);
    }
  } else if (variant === 1) {
    const red = rng.chance(0.5);
    b.add(new CylinderGeometry(0.02, 0.03, 1.3, 5), { matrix: tf(0, 0.65, 0), color: '#6a5a3a', sway: 0.05 });
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4;
      leafStrip(b, [0, 1.3, 0], [Math.cos(a), Math.sin(a)], rng.range(0.4, 0.6), 0.07, rng.range(0.1, 0.35), 0.35, 2, (t) => (red ? mix('#6a1a2a', '#b83a4a', t) : mix('#2a6a2a', '#6aa84a', t)), 0.1, 0.2, false);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const h = rng.range(0.7, 1.1);
      const ex = Math.cos(a) * 0.3;
      const ez = Math.sin(a) * 0.3;
      b.add(new CylinderGeometry(0.015, 0.025, 1, 4), { matrix: between(0, 0, 0, ex, h, ez), color: '#4a7a3a', sway: 0.06 });
      heartLeaf(b, [ex, h, ez], a, rng.range(0.4, 0.55), 0.7, '#1f4f1f', '#4a8a36');
    }
  }
  return b.build(true);
}

/** Beach morning glory and hibiscus: small flower clusters on the sand and at the jungle edge. */
export function islandFlowerGeometry(variant: number): THREE.BufferGeometry {
  const rng = new Rng(1800 + variant);
  const b = new GeoBuilder(1800 + variant);
  const colors = ['#d05aa8', '#f06a4a', '#f4e060', '#f4f0ea'];
  const c = colors[variant % colors.length];
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0, 0.3);
    b.add(new OctahedronGeometry(0.06, 0), { matrix: tf(Math.cos(a) * r, 0.04, Math.sin(a) * r, 0, a, 0, 1.3, 0.35, 1), color: '#4a8a3a', vary: 0.08 });
  }
  for (let i = 0; i < 4; i++) {
    const x = rng.range(-0.22, 0.22);
    const z = rng.range(-0.22, 0.22);
    b.add(new CylinderGeometry(0.07, 0.025, 0.05, 6), { matrix: tf(x, 0.09, z, rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)), color: c, vary: 0.05, sway: 0.03 });
  }
  return b.build(true);
}

/**
 * A small cave's rock shell: a lumpy dome of dark basalt with a mossy top, open along local +x for the mouth. Drawn
 * from both sides so its hollow shows inside.
 */
export function caveShellGeometry(r: number, height: number, mouth: number, seed: number): THREE.BufferGeometry {
  const src = new IcosahedronGeometry(1, 3).toNonIndexed();
  const p = src.getAttribute('position') as THREE.BufferAttribute;
  const keep: number[] = [];
  const v = new THREE.Vector3();
  const tri: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let f = 0; f < p.count; f += 3) {
    let cy = 0;
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      tri[k].fromBufferAttribute(p, f + k);
      cx += tri[k].x / 3;
      cy += tri[k].y / 3;
      cz += tri[k].z / 3;
    }
    if (cy < -0.12) continue;
    const a = Math.atan2(cz, cx);
    // The mouth: an arch cut out of the front, tallest in the middle.
    if (Math.abs(a) < mouth && cy < 0.72 * Math.cos((a / mouth) * Math.PI * 0.5)) continue;
    for (const t of tri) {
      v.copy(t);
      const k = 1 + (hash2(Math.round(v.x * 50), Math.round(v.z * 50) + Math.round(v.y * 50) * 7, seed) - 0.5) * 0.18;
      keep.push(v.x * r * k, Math.max(-0.1, v.y) * height * k, v.z * r * k);
    }
  }
  src.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  const b = new GeoBuilder(seed);
  b.add(g, {
    color: (_x, y, _z, n) => (n.y > 0.55 && y > height * 0.55 ? mix('#4f6a34', '#6a8a42', 0.5 + n.x * 0.3) : mix('#3e3c3a', '#5a5652', 0.5 + n.y * 0.3)),
    vary: 0.1,
  });
  g.dispose();
  return b.build();
}

/** A fruit bat hanging or flying: a body and two wing panels that flap about the body's long axis. */
export function batGeometry(): { body: THREE.BufferGeometry; wing: THREE.BufferGeometry } {
  const body = new GeoBuilder(1901);
  body.add(new IcosahedronGeometry(0.07, 0), { matrix: tf(0, 0, 0, 0, 0, 0, 0.8, 0.8, 1.6), color: '#3a2a22' });
  body.add(new ConeGeometry(0.02, 0.05, 4), { matrix: tf(0.03, 0.05, 0.08), color: '#2a1e18' });
  body.add(new ConeGeometry(0.02, 0.05, 4), { matrix: tf(-0.03, 0.05, 0.08), color: '#2a1e18' });
  const wing = new GeoBuilder(1902);
  const pos = [0, 0, 0.08, 0.34, 0, 0.02, 0.26, 0, -0.1, 0, 0, 0.08, 0.26, 0, -0.1, 0, 0, -0.08];
  const g = new THREE.BufferGeometry();
  const both: number[] = [];
  for (let i = 0; i < pos.length; i += 9) both.push(...pos.slice(i, i + 9), ...pos.slice(i, i + 3), ...pos.slice(i + 6, i + 9), ...pos.slice(i + 3, i + 6));
  g.setAttribute('position', new THREE.Float32BufferAttribute(both, 3));
  wing.add(g, { color: '#4a3a30', vary: 0.05 });
  g.dispose();
  return { body: body.build(), wing: wing.build() };
}
