import * as THREE from 'three';
import { hash2, Rng } from '../core/rng';
import type { ResourceKind, TreeSpecies } from '../data/resources';
import { between, col, GeoBuilder, mix, tf } from './geo';
import type { ResourceModel } from './models';
import { blades, foliage, frond, roots } from './plantParts';

const { CylinderGeometry, ConeGeometry, IcosahedronGeometry, DodecahedronGeometry, OctahedronGeometry } = THREE;

type V3 = [number, number, number];

const DESERT_TREES = new Set<TreeSpecies>(['joshua', 'mesquite', 'cottonwood', 'juniper', 'pinyon', 'ponderosa']);

export function isDesertTree(species: TreeSpecies): boolean {
  return DESERT_TREES.has(species);
}

function limb(b: GeoBuilder, a: V3, c: V3, rTop: number, rBot: number, color: THREE.ColorRepresentation | ((x: number, y: number, z: number, n: THREE.Vector3) => THREE.Color), segs = 6, sway = 0): void {
  b.add(new CylinderGeometry(rTop, rBot, 1, segs), { matrix: between(a[0], a[1], a[2], c[0], c[1], c[2]), color, vary: 0.1, sway });
}

/** Points on a jittered hemisphere, used for rosettes and blob crowns. */
function fan(n: number, minTilt: number, maxTilt: number, seed: number): V3[] {
  const rng = new Rng(seed);
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + rng.range(-0.2, 0.2);
    const tilt = minTilt + (maxTilt - minTilt) * ((i + 0.5) / n) + rng.range(-0.08, 0.08);
    out.push([Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a)]);
  }
  return out;
}

function joshua(b: GeoBuilder, near: boolean): void {
  const shag = (x: number, y: number, z: number) => {
    const k = hash2(Math.floor(y * 5), Math.floor(Math.atan2(z, x) * 2.5), 17);
    return k < 0.3 ? col('#4f4436') : mix('#6f604c', '#9a8a70', k);
  };
  b.add(new CylinderGeometry(0.17, 0.27, 2.3, near ? 7 : 5, near ? 3 : 1), { matrix: tf(0, 1.15, 0), color: shag, jitter: 0.05 });
  b.add(new CylinderGeometry(0.27, 0.36, 0.3, near ? 7 : 5), { matrix: tf(0, 0.12, 0), color: '#5a4c3c' });
  const segs: [V3, V3, boolean][] = [
    [[0, 2.15, 0], [0.75, 2.9, 0.15], false],
    [[0.75, 2.9, 0.15], [1.05, 3.85, 0.35], true],
    [[0.75, 2.9, 0.15], [0.55, 3.55, -0.45], true],
    [[0, 2.15, 0], [-0.7, 3.0, -0.2], false],
    [[-0.7, 3.0, -0.2], [-1.15, 3.7, -0.35], true],
    [[-0.7, 3.0, -0.2], [-0.55, 4.0, 0.25], true],
    [[0, 2.15, 0], [0.1, 3.4, 0.8], false],
    [[0.1, 3.4, 0.8], [0.25, 4.2, 1.0], true],
  ];
  segs.forEach(([a, c, tip], i) => {
    limb(b, a, c, tip ? 0.075 : 0.095, tip ? 0.095 : 0.12, shag, near ? 6 : 4, 0.02);
    if (!tip) return;
    // A skirt of dead leaves hangs under each living rosette.
    b.add(new ConeGeometry(0.2, 0.55, near ? 6 : 4), { matrix: tf(c[0], c[1] - 0.18, c[2], Math.PI, 0, 0), color: '#8f7e5e', jitter: 0.04, sway: 0.03 });
    if (near) {
      for (const d of fan(11, 0.1, 1.7, 90 + i)) {
        const len = 0.5;
        limbSpike(b, c, d, len);
      }
    } else {
      b.add(new OctahedronGeometry(0.42, 0), { matrix: tf(c[0], c[1] + 0.12, c[2], 0.3, i, 0), color: foliage('#5f7a34', '#a4b45a', '#44582a'), sway: 0.05 });
    }
  });
}

function limbSpike(b: GeoBuilder, base: V3, d: V3, len: number): void {
  b.add(new ConeGeometry(0.045, 1, 4), {
    matrix: between(base[0], base[1], base[2], base[0] + d[0] * len, base[1] + d[1] * len, base[2] + d[2] * len),
    color: (_x, _y, _z, n) => mix('#5f7a34', '#b0bc62', 0.45 + n.y * 0.35),
    vary: 0.08,
    sway: 0.05,
  });
}

function mesquite(b: GeoBuilder, near: boolean, stripped: boolean): void {
  const wood = (_x: number, y: number) => mix('#3e3026', '#5a4636', y / 2.4);
  const trunks: [V3, V3][] = [
    [[0.5, 1.3, 0.2], [0.95, 2.45, 0.45]],
    [[-0.4, 1.2, 0.35], [-0.85, 2.35, 0.55]],
    [[0.05, 1.4, -0.5], [0.15, 2.6, -0.95]],
  ];
  for (const [mid, top] of trunks) {
    limb(b, [0, 0, 0], mid, 0.08, 0.12, wood, near ? 6 : 4);
    if (near) limb(b, mid, top, 0.04, 0.07, wood, 5);
  }
  if (near) limb(b, [0.5, 1.3, 0.2], [0.05, 2.8, 0.1], 0.035, 0.06, wood, 5);
  const blobs: [number, number, number, number][] = [
    [0.95, 2.6, 0.45, 1.1], [-0.85, 2.5, 0.55, 1.0], [0.15, 2.75, -0.95, 1.05], [0.05, 3.05, 0.1, 1.2], [1.35, 2.3, -0.55, 0.8], [-1.25, 2.3, -0.45, 0.85],
  ];
  const rng = new Rng(61);
  for (const [x, y, z, r] of blobs) {
    b.add(new IcosahedronGeometry(r, near ? 1 : 0), {
      matrix: tf(x, y, z, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.48, 1),
      color: foliage('#56702f', '#9aae54', '#3f5424'),
      jitter: near ? 0.34 : 0.14, vary: 0.12, sway: 0.08,
    });
  }
  if (near && !stripped) {
    for (let i = 0; i < 18; i++) {
      const [x, y, z, r] = blobs[i % blobs.length];
      const a = rng.range(0, Math.PI * 2);
      const px = x + Math.cos(a) * r * rng.range(0.4, 0.85);
      const pz = z + Math.sin(a) * r * rng.range(0.4, 0.85);
      const py = y - r * 0.32;
      b.add(new CylinderGeometry(0.02, 0.016, 0.3, 4), {
        matrix: tf(px, py - 0.12, pz, rng.range(-0.5, 0.5), a, rng.range(-0.4, 0.4)),
        color: rng.pick(['#d8b86a', '#c9a458', '#e2c67e']),
        vary: 0.06, sway: 0.09,
      });
    }
  }
}

function cottonwood(b: GeoBuilder, near: boolean, stripped: boolean): void {
  const bark = (x: number, y: number, z: number) => {
    const a = Math.atan2(z, x);
    if (stripped && y < 3.2 + (hash2(Math.floor(a * 3), 5, 29) - 0.5) * 0.5) return mix('#cdb88e', '#e0cfa6', hash2(Math.floor(y * 3), Math.floor(a * 2), 31));
    return hash2(Math.floor(a * 4), Math.floor(y * 1.6), 23) < 0.45 ? col('#6f6a60') : col('#968f82');
  };
  b.add(new CylinderGeometry(0.24, 0.4, 5.4, near ? 8 : 5, near ? 5 : 2), { matrix: tf(0, 2.7, 0), color: bark, jitter: 0.04, vary: 0.06 });
  if (near) {
    b.add(new CylinderGeometry(0.4, 0.6, 0.7, 8), { matrix: tf(0, 0.3, 0), color: '#6a655b', jitter: 0.06 });
    roots(b, '#6a655b', 0.4, 5, 41);
    const limbs: V3[] = [[2.2, 7.2, 0.4], [-2.0, 7.5, -0.6], [0.4, 7.9, 2.0], [-0.5, 7.4, -2.1], [1.2, 8.4, -1.2]];
    for (const p of limbs) limb(b, [0, 4.6, 0], p, 0.1, 0.18, '#7d776c', 6);
  }
  const rng = new Rng(83);
  const blobs: [number, number, number, number][] = [
    [0, 9.2, 0, 2.2], [2.1, 7.9, 0.6, 1.9], [-2.0, 8.1, -0.7, 2.0], [0.6, 7.7, 2.1, 1.8], [-0.7, 7.6, -2.1, 1.8], [1.4, 9.3, -1.2, 1.5], [-1.3, 9.2, 1.2, 1.5], [0, 6.9, 0, 1.9],
  ];
  for (const [x, y, z, r] of blobs) {
    b.add(near ? new DodecahedronGeometry(r, 1) : new IcosahedronGeometry(r * 1.04, 0), {
      matrix: tf(x, y, z, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.8, 1),
      color: foliage('#4a8a34', '#a8cc60', '#356626'),
      jitter: near ? 0.36 : 0.14, vary: 0.1, sway: 0.1,
    });
  }
}

function juniper(b: GeoBuilder, near: boolean, stripped: boolean): void {
  const bark = (x: number, y: number, z: number) => {
    const a = Math.atan2(z, x);
    if (stripped && y < 2.0) return mix('#a8603c', '#c47e52', hash2(Math.floor(y * 4), Math.floor(a * 2), 37));
    return hash2(Math.floor(a * 5), Math.floor(y * 6), 43) < 0.4 ? col('#5e4a3c') : mix('#7a5e4a', '#9a806a', hash2(Math.floor(y * 3), 1, 7));
  };
  const path: V3[] = [[0, 0, 0], [0.25, 1.2, 0.1], [-0.1, 2.4, 0.2], [0.1, 3.4, -0.1]];
  for (let i = 0; i < path.length - 1; i++) limb(b, path[i], path[i + 1], 0.2 - i * 0.04, 0.26 - i * 0.04, bark, near ? 7 : 5);
  if (near) {
    limb(b, [0.1, 0.2, 0], [-0.6, 1.5, -0.35], 0.1, 0.16, bark, 6);
    limb(b, [0.25, 1.2, 0.1], [1.0, 2.2, 0.4], 0.07, 0.12, bark, 5);
  }
  const rng = new Rng(97);
  const blobs: [number, number, number, number][] = [
    [0.1, 4.9, 0, 1.05], [0.7, 4.0, 0.4, 1.2], [-0.7, 3.9, -0.3, 1.25], [0.2, 3.2, -0.9, 1.15], [-0.5, 3.0, 0.9, 1.1], [1.1, 2.6, 0.2, 0.95], [-1.0, 2.2, -0.5, 1.0], [0.3, 2.0, 0.8, 0.9],
  ];
  for (const [x, y, z, r] of blobs) {
    b.add(new IcosahedronGeometry(r, near ? 1 : 0), {
      matrix: tf(x, y, z, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.9, 1),
      color: foliage('#46604a', '#8aa682', '#334634'),
      jitter: near ? 0.42 : 0.16, vary: 0.12, sway: 0.06,
    });
  }
  if (near) {
    for (let i = 0; i < 16; i++) {
      const [x, y, z, r] = blobs[i % blobs.length];
      const a = rng.range(0, Math.PI * 2);
      b.add(new OctahedronGeometry(0.05, 0), { matrix: tf(x + Math.cos(a) * r * 0.92, y + rng.range(-0.3, 0.4), z + Math.sin(a) * r * 0.92), color: '#9fb2c9', vary: 0.05, sway: 0.06 });
    }
  }
}

function pinyon(b: GeoBuilder, near: boolean, stripped: boolean): void {
  b.add(new CylinderGeometry(0.16, 0.3, 3.2, near ? 7 : 5, near ? 2 : 1), {
    matrix: tf(0, 1.6, 0),
    color: (x, y, z) => (hash2(Math.floor(Math.atan2(z, x) * 3), Math.floor(y * 3), 53) < 0.3 ? col('#3e2e24') : mix('#5e4636', '#7a5c44', y / 3.2)),
    jitter: 0.04,
  });
  if (near) roots(b, '#4e3a2c', 0.3, 4, 59);
  const rng = new Rng(71);
  const blobs: [number, number, number, number][] = [
    [0, 6.0, 0, 1.15], [0.9, 5.1, 0.4, 1.3], [-0.9, 5.2, -0.3, 1.3], [0.3, 4.3, -1.0, 1.35], [-0.4, 4.1, 1.0, 1.3], [1.1, 3.3, -0.3, 1.15], [-1.1, 3.2, 0.4, 1.15], [0, 2.7, 0, 1.3],
  ];
  for (const [x, y, z, r] of blobs) {
    b.add(new IcosahedronGeometry(r, near ? 1 : 0), {
      matrix: tf(x, y, z, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.85, 1),
      color: foliage('#30492b', '#678a4a', '#22341f'),
      jitter: near ? 0.34 : 0.14, vary: 0.1, sway: 0.07,
    });
  }
  if (near && !stripped) {
    for (let i = 0; i < 14; i++) {
      const [x, y, z, r] = blobs[i % blobs.length];
      const a = rng.range(0, Math.PI * 2);
      b.add(new IcosahedronGeometry(0.11, 0), {
        matrix: tf(x + Math.cos(a) * r * 0.95, y + rng.range(-0.35, 0.2), z + Math.sin(a) * r * 0.95, 0, a, 0, 1, 0.8, 1),
        color: rng.pick(['#8a5a33', '#7a4e2c', '#9c6a3c']),
        vary: 0.06, sway: 0.07,
      });
    }
  }
}

function ponderosa(b: GeoBuilder, near: boolean): void {
  b.add(new CylinderGeometry(0.2, 0.44, 9.2, near ? 9 : 6, near ? 6 : 2), {
    matrix: tf(0, 4.6, 0),
    color: (x, y, z) => {
      const plate = hash2(Math.floor(Math.atan2(z, x) * 3.2), Math.floor(y * 2.2), 67);
      return plate < 0.2 ? col('#3e2a20') : mix('#a45e36', '#c98a58', plate);
    },
    jitter: 0.04, vary: 0.08,
  });
  if (near) {
    roots(b, '#7a4a2c', 0.44, 5, 73);
    const stubs: V3[] = [[1.6, 7.6, 0.4], [-1.5, 8.2, -0.6], [0.3, 8.8, 1.6], [-0.4, 9.6, -1.5], [1.2, 10.3, -0.9], [-1.1, 7.0, 1.0]];
    for (const p of stubs) limb(b, [0, p[1] - 0.8, 0], p, 0.05, 0.1, '#6a3e26', 5);
  }
  const rng = new Rng(79);
  const clumps: [number, number, number, number][] = [
    [0, 11.4, 0, 1.0], [1.5, 10.2, -0.8, 1.2], [-1.3, 10.5, 1.0, 1.2], [1.8, 8.9, 0.5, 1.45], [-1.6, 8.4, -0.7, 1.5], [0.4, 8.0, 1.8, 1.4], [-0.5, 7.2, -1.8, 1.35], [1.2, 7.0, -0.9, 1.2], [0, 9.6, 0, 1.4],
  ];
  for (const [x, y, z, r] of clumps) {
    b.add(new IcosahedronGeometry(r, near ? 1 : 0), {
      matrix: tf(x, y, z, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.72, 1),
      color: foliage('#34582d', '#709a4a', '#253f20'),
      jitter: near ? 0.38 : 0.15, vary: 0.1, sway: (yy) => Math.max(0, (yy - 6) / 7) * 0.14,
    });
  }
  b.add(new ConeGeometry(0.7, 1.9, near ? 6 : 4), { matrix: tf(0, 12.2, 0), color: '#4f7a3c', jitter: 0.1, sway: 0.14 });
}

/**
 * `stripped` shows a tree after a hand harvest: mesquite without pods, pinyon without cones, juniper and cottonwood
 * with the lower trunk peeled to bare wood.
 */
export function desertTreeGeometry(species: TreeSpecies, lod = 0, stripped = false): THREE.BufferGeometry {
  const b = new GeoBuilder(species.length * 37 + (stripped ? 5 : 0));
  const near = lod === 0;
  if (species === 'joshua') joshua(b, near);
  else if (species === 'mesquite') mesquite(b, near, stripped);
  else if (species === 'cottonwood') cottonwood(b, near, stripped);
  else if (species === 'juniper') juniper(b, near, stripped);
  else if (species === 'pinyon') pinyon(b, near, stripped);
  else ponderosa(b, near);
  return b.build(true);
}

/** Model height saguaros are built at; instances scale to their own height. */
export const SAGUARO_HEIGHT = 6;
const SAGUARO_R = 0.3;

const ribbed = (dark: string, light: string, ribs: number) => (x: number, _y: number, z: number) => {
  const a = Math.atan2(z, x);
  const k = Math.round((a / (Math.PI * 2)) * ribs * 2);
  return k % 2 === 0 ? col(light) : col(dark);
};

function ribWarp(ribs: number, depth: number) {
  return (v: THREE.Vector3) => {
    const a = Math.atan2(v.z, v.x);
    const k = Math.round((a / (Math.PI * 2)) * ribs * 2);
    const s = k % 2 === 0 ? 1 : 1 - depth;
    v.x *= s;
    v.z *= s;
  };
}

/** A saguaro column with `arms` (0-4) upturned arms. */
export function saguaroGeometry(arms: number, lod = 0): THREE.BufferGeometry {
  const near = lod === 0;
  const b = new GeoBuilder(401 + arms);
  const ribs = near ? 12 : 6;
  const H = SAGUARO_HEIGHT;
  const color = ribbed('#3f6636', '#5f8a4a', ribs);
  b.add(new CylinderGeometry(SAGUARO_R * 0.94, SAGUARO_R, H - 0.3, ribs * 2, near ? 5 : 1), { matrix: tf(0, (H - 0.3) / 2, 0), color, warp: ribWarp(ribs, 0.12), vary: 0.05 });
  b.add(new IcosahedronGeometry(SAGUARO_R * 0.95, 1), { matrix: tf(0, H - 0.32, 0, 0, 0, 0, 1, 0.7, 1), color: '#5f8a4a', vary: 0.05 });
  const rng = new Rng(500 + arms);
  const armR = SAGUARO_R * 0.7;
  for (let i = 0; i < arms; i++) {
    const a = (i / Math.max(1, arms)) * Math.PI * 2 + rng.range(-0.5, 0.5);
    const y0 = H * rng.range(0.38, 0.62);
    const out = rng.range(0.55, 0.8);
    const up = rng.range(1.1, Math.min(2.3, H - y0 - 0.3));
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const elbow: V3 = [dx * out, y0 + 0.35, dz * out];
    b.add(new CylinderGeometry(armR, armR, 1, ribs * 2, 1), { matrix: between(0, y0, 0, elbow[0], elbow[1], elbow[2]), color, warp: ribWarp(ribs, 0.1), vary: 0.05 });
    b.add(new IcosahedronGeometry(armR * 1.02, near ? 1 : 0), { matrix: tf(elbow[0], elbow[1], elbow[2]), color: '#4f7a40', vary: 0.05 });
    b.add(new CylinderGeometry(armR * 0.95, armR, up, ribs * 2, near ? 2 : 1), { matrix: tf(elbow[0], elbow[1] + up / 2, elbow[2]), color, warp: ribWarp(ribs, 0.1), vary: 0.05 });
    b.add(new IcosahedronGeometry(armR * 0.95, 1), { matrix: tf(elbow[0], elbow[1] + up, elbow[2], 0, 0, 0, 1, 0.7, 1), color: '#5f8a4a', vary: 0.05 });
  }
  if (near) {
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7;
      b.add(new CylinderGeometry(0.06, 0.035, 0.08, 6), { matrix: tf(Math.cos(a) * 0.14, H - 0.12, Math.sin(a) * 0.14), color: '#f4efe0', vary: 0.02 });
      b.add(new CylinderGeometry(0.025, 0.025, 0.03, 5), { matrix: tf(Math.cos(a) * 0.14, H - 0.07, Math.sin(a) * 0.14), color: '#e8c03a', vary: 0.02 });
    }
  }
  return b.build();
}

function pad(b: GeoBuilder, x: number, y: number, z: number, ry: number, rz: number, s: number): void {
  b.add(new IcosahedronGeometry(0.2 * s, 1), {
    matrix: tf(x, y, z, 0, ry, rz, 1, 1.3, 0.3),
    color: (px, py, pz, n) => (hash2(Math.round(px * 60), Math.round(py * 60) + Math.round(pz * 60), 3) < 0.1 ? col('#e9e0c0') : mix('#5a8440', '#94b45e', 0.45 + n.y * 0.3 + Math.abs(n.x) * 0.1)),
    jitter: 0.015, vary: 0.06,
  });
}

/** Desert forage models. `extra` is the fruit, buds or berries that disappear once picked. */
export function desertResourceGeometry(kind: ResourceKind): ResourceModel {
  const rng = new Rng(kind.length * 1013 + 7);
  const b = new GeoBuilder(kind.length * 11);
  switch (kind) {
    case 'yucca': {
      b.add(new IcosahedronGeometry(0.13, 0), { matrix: tf(0, 0.06, 0, 0, 0, 0, 1, 0.6, 1), color: '#6a5a40' });
      blades(b, rng, 24, [0.55, 0.85], 0.035, '#46663f', '#9ab488', 0.08);
      for (let i = 0; i < 6; i++) {
        const a = rng.range(0, Math.PI * 2);
        b.add(new CylinderGeometry(0.004, 0.004, 1, 3), { matrix: between(Math.cos(a) * 0.1, 0.25, Math.sin(a) * 0.1, Math.cos(a) * 0.3, 0.55, Math.sin(a) * 0.3), color: '#efe6cf', sway: 0.1 });
      }
      return { main: b.build(true), doubleSided: true };
    }
    case 'pricklyPear': {
      const pads: [number, number, number, number, number, number][] = [
        [0, 0.26, 0, 0, 0, 1.05], [0.3, 0.26, 0.12, 0.9, -0.55, 0.95], [-0.28, 0.25, -0.06, -0.6, 0.5, 0.95],
        [0.06, 0.66, 0.02, 0.3, 0.12, 0.9], [0.52, 0.56, 0.2, 0.9, -0.4, 0.82], [-0.46, 0.58, -0.1, -0.5, 0.45, 0.85], [0.1, 0.24, -0.34, 2.0, 0.3, 0.85],
      ];
      for (const [x, y, z, ry, rz, s] of pads) pad(b, x, y, z, ry, rz, s);
      const fruit = new GeoBuilder(71);
      const tops: V3[] = [[0.06, 0.95, 0.02], [0.52, 0.83, 0.2], [-0.46, 0.85, -0.1]];
      for (const [x, y, z] of tops) {
        for (let i = 0; i < 4; i++) {
          const off = (i - 1.5) * 0.08;
          fruit.add(new IcosahedronGeometry(0.048, 0), {
            matrix: tf(x + off * 0.8, y + Math.abs(off) * -0.3, z + off * 0.3, 0, i, 0, 1, 1.3, 1),
            color: rng.pick(['#b8285e', '#c83a6e', '#9e2050']),
            vary: 0.05,
          });
        }
      }
      return { main: b.build(), extra: fruit.build() };
    }
    case 'cholla': {
      const joint = (a: V3, c: V3, r: number) => {
        b.add(new CylinderGeometry(r * 0.9, r, 1, 6), {
          matrix: between(a[0], a[1], a[2], c[0], c[1], c[2]),
          color: (_x, _y, _z, n) => (n.y > 0.45 ? col('#d8cf9a') : mix('#6f6a3a', '#a89a5e', 0.5 + n.x * 0.3)),
          jitter: 0.02, vary: 0.1,
        });
        b.add(new IcosahedronGeometry(r * 1.05, 0), { matrix: tf(c[0], c[1], c[2]), color: '#8a7a4a' });
      };
      joint([0, 0, 0], [0, 0.42, 0], 0.07);
      const tips: V3[] = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const p1: V3 = [Math.cos(a) * 0.22, 0.42 + rng.range(0.18, 0.3), Math.sin(a) * 0.22];
        joint([0, 0.42, 0], p1, 0.055);
        const p2: V3 = [p1[0] + Math.cos(a + 0.5) * 0.18, p1[1] + rng.range(0.18, 0.28), p1[2] + Math.sin(a + 0.5) * 0.18];
        joint(p1, p2, 0.05);
        tips.push(p2);
        if (i % 2 === 0) {
          const p3: V3 = [p1[0] + Math.cos(a - 0.7) * 0.22, p1[1] + rng.range(0.1, 0.2), p1[2] + Math.sin(a - 0.7) * 0.22];
          joint(p1, p3, 0.045);
          tips.push(p3);
        }
      }
      const buds = new GeoBuilder(73);
      for (const [x, y, z] of tips) {
        for (let k = 0; k < 2; k++) {
          const a = k * 2.4 + x * 10;
          buds.add(new ConeGeometry(0.035, 0.09, 5), { matrix: tf(x + Math.cos(a) * 0.04, y + 0.05, z + Math.sin(a) * 0.04, 0, a, 0.3), color: k === 0 ? '#b0a03e' : '#c85a3a', vary: 0.05 });
        }
      }
      return { main: b.build(), extra: buds.build() };
    }
    case 'agave': {
      const rings: [number, number, number, number][] = [
        // count, tilt from vertical, length, base height
        [7, 0.35, 0.42, 0.06],
        [9, 0.85, 0.52, 0.05],
        [9, 1.25, 0.48, 0.04],
      ];
      rings.forEach(([n, tilt, len, y0], ri) => {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + ri * 0.4 + rng.range(-0.1, 0.1);
          const t = tilt + rng.range(-0.08, 0.08);
          const dx = Math.sin(t) * Math.cos(a);
          const dy = Math.cos(t);
          const dz = Math.sin(t) * Math.sin(a);
          b.add(new ConeGeometry(0.085, len, 4), {
            matrix: tf(dx * len / 2, y0 + dy * len / 2, dz * len / 2, t, Math.PI / 2 - a, 0, 1, 1, 0.42),
            color: (_x, _y, _z, nn) => mix('#7a9894', '#b8ccc0', 0.45 + nn.y * 0.4),
            vary: 0.06,
          });
          b.add(new ConeGeometry(0.018, 0.09, 3), { matrix: tf(dx * (len + 0.03), y0 + dy * (len + 0.03), dz * (len + 0.03), t, Math.PI / 2 - a, 0), color: '#3e2e26' });
        }
      });
      return { main: b.build() };
    }
    case 'chia': {
      for (let i = 0; i < 6; i++) frond(b, (i / 6) * Math.PI * 2 + rng.range(-0.2, 0.2), rng.range(0.12, 0.18), 0.04, 0.04, '#6a7a4e', '#9aa878', 0.03);
      for (let i = 0; i < 5; i++) {
        const a = rng.range(0, Math.PI * 2);
        const h = rng.range(0.25, 0.42);
        const tx = Math.cos(a) * 0.08;
        const tz = Math.sin(a) * 0.08;
        b.add(new CylinderGeometry(0.006, 0.009, 1, 4), { matrix: between(0, 0, 0, tx, h, tz), color: '#6f7a4a', sway: 0.05 });
        for (let k = 0; k < 2; k++) {
          const f = h * (0.62 + k * 0.36);
          const r = 0.034 + (1 - k) * 0.01;
          b.add(new IcosahedronGeometry(r, 0), { matrix: tf(tx * f / h, f, tz * f / h), color: rng.pick(['#5f6fd0', '#6a78d6', '#7a64c8']), vary: 0.06, sway: 0.06 });
          b.add(new CylinderGeometry(r * 1.3, r * 1.3, 0.008, 6), { matrix: tf(tx * f / h, f - r * 0.6, tz * f / h), color: '#8a4a6a', sway: 0.06 });
        }
      }
      return { main: b.build(true), doubleSided: true };
    }
    case 'wolfberry':
    default: {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const tip: V3 = [Math.cos(a) * rng.range(0.3, 0.5), rng.range(0.55, 0.9), Math.sin(a) * rng.range(0.3, 0.5)];
        limb(b, [0, 0, 0], tip, 0.012, 0.025, '#8a7a68', 4);
      }
      const clumps: [number, number, number, number][] = [[0.28, 0.62, 0.1, 0.24], [-0.26, 0.58, -0.12, 0.26], [0.05, 0.8, -0.28, 0.22], [-0.08, 0.74, 0.3, 0.22], [0.02, 0.42, 0, 0.3]];
      for (const [x, y, z, r] of clumps) {
        b.add(new IcosahedronGeometry(r, 0), { matrix: tf(x, y, z, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.8, 1), color: foliage('#5a6a48', '#93a472', '#44503a'), jitter: 0.12, vary: 0.1, sway: (yy) => yy * 0.04 });
      }
      const berries = new GeoBuilder(79);
      for (let i = 0; i < 18; i++) {
        const [x, y, z, r] = clumps[i % clumps.length];
        const a = rng.range(0, Math.PI * 2);
        berries.add(new IcosahedronGeometry(0.03, 0), { matrix: tf(x + Math.cos(a) * r * 0.95, y + rng.range(-0.12, 0.12), z + Math.sin(a) * r * 0.95, 0, 0, 0, 1, 1.4, 1), color: rng.pick(['#e0452f', '#ec5a34', '#d83c2a']), vary: 0.05, sway: y * 0.04 });
      }
      return { main: b.build(true), extra: berries.build(true) };
    }
  }
}

/** Creosote bush: an open fan of grey stems with small dark, resinous leaf clusters (and a few yellow flowers). */
export function creosoteGeometry(variant: number, lod = 0): THREE.BufferGeometry {
  const rng = new Rng(1100 + variant);
  const b = new GeoBuilder(1100 + variant);
  const n = lod ? 4 : 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const spread = rng.range(0.35, 0.65);
    const h = rng.range(0.9, 1.4);
    const tip: V3 = [Math.cos(a) * spread, h, Math.sin(a) * spread];
    if (!lod) limb(b, [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05], tip, 0.012, 0.028, '#8a8276', 4, 0);
    b.add(new IcosahedronGeometry(rng.range(0.16, 0.24), 0), {
      matrix: tf(tip[0], tip[1] - 0.08, tip[2], rng.range(0, 3), rng.range(0, 3), 0, 1, 0.75, 1),
      color: foliage('#46602a', '#7c9440', '#34481f'),
      jitter: 0.1, vary: 0.12, sway: 0.08,
    });
    if (!lod && variant === 1 && i % 2 === 0) b.add(new OctahedronGeometry(0.035, 0), { matrix: tf(tip[0] * 1.05, tip[1] + 0.07, tip[2] * 1.05), color: '#f0cc3a', vary: 0.03, sway: 0.08 });
  }
  return b.build(true);
}

/** Low grey-green mounds: white bursage on the flats, big sagebrush in the high country. */
export function shrubGeometry(kind: 'bursage' | 'sage', variant: number): THREE.BufferGeometry {
  const rng = new Rng((kind === 'sage' ? 1300 : 1200) + variant);
  const b = new GeoBuilder((kind === 'sage' ? 1300 : 1200) + variant);
  const sage = kind === 'sage';
  const n = sage ? 5 : 3;
  const r0 = sage ? 0.28 : 0.2;
  if (sage) for (let i = 0; i < 3; i++) limb(b, [0, 0, 0], [rng.range(-0.2, 0.2), 0.45, rng.range(-0.2, 0.2)], 0.02, 0.035, '#6a5e50', 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const d = i === 0 ? 0 : rng.range(0.15, 0.28);
    const r = r0 * rng.range(0.8, 1.15);
    b.add(new IcosahedronGeometry(r, sage ? 1 : 0), {
      matrix: tf(Math.cos(a) * d, (sage ? 0.42 : 0.16) + rng.range(-0.05, 0.08), Math.sin(a) * d, rng.range(0, 3), rng.range(0, 3), 0, 1, sage ? 0.8 : 0.65, 1),
      color: sage ? foliage('#7c8a78', '#b8c4ae', '#5e6a5a') : foliage('#8a8a70', '#c0bc9e', '#6a6a54'),
      jitter: sage ? 0.12 : 0.08, vary: 0.1, sway: 0.04,
    });
  }
  return b.build(true);
}

export function desertGrassGeometry(variant: number): THREE.BufferGeometry {
  const rng = new Rng(1400 + variant);
  const b = new GeoBuilder(1400 + variant);
  const palettes: [string, string][] = [['#a0884a', '#e2cc8e'], ['#948650', '#d4c07a'], ['#8a9452', '#c8c486']];
  const [d, l] = palettes[variant % palettes.length];
  blades(b, rng, 9, [0.3, 0.6], 0.03, d, l, 0.12);
  return b.build(true);
}

/** Desert marigold, globemallow, lupine and Parry's penstemon. */
export function desertFlowerGeometry(variant: number): THREE.BufferGeometry {
  const rng = new Rng(1500 + variant);
  const b = new GeoBuilder(1500 + variant);
  const colors = ['#f2c83a', '#e8783a', '#7d6ad6', '#d6569a'];
  const c = colors[variant % colors.length];
  blades(b, rng, 4, [0.12, 0.22], 0.02, '#7a8a62', '#a8b48a', 0.08);
  for (let i = 0; i < 4; i++) {
    const x = rng.range(-0.12, 0.12);
    const z = rng.range(-0.12, 0.12);
    const h = rng.range(0.25, 0.5);
    b.add(new CylinderGeometry(0.007, 0.009, 1, 4), { matrix: between(0, 0, 0, x, h, z), color: '#7a8a5a', sway: 0.06 });
    if (variant % 4 >= 2) {
      for (let k = 0; k < 4; k++) b.add(new OctahedronGeometry(0.032 - k * 0.005, 0), { matrix: tf(x, h - 0.12 + k * 0.045, z), color: mix(c, '#ffffff', k * 0.1), sway: 0.07 });
    } else {
      b.add(new CylinderGeometry(0.055, 0.035, 0.02, 8), { matrix: tf(x, h, z), color: c, sway: 0.07 });
      b.add(new CylinderGeometry(0.018, 0.018, 0.025, 6), { matrix: tf(x, h + 0.01, z), color: variant % 4 === 0 ? '#d89a2a' : '#f4e0a0', sway: 0.07 });
    }
  }
  return b.build(true);
}
