import * as THREE from 'three';
import { hash2 } from '../core/rng';
import type { SpeciesId } from '../data/species';
import { between, col, GeoBuilder, mix, tf } from './geo';

const { CylinderGeometry, ConeGeometry, IcosahedronGeometry, OctahedronGeometry, BoxGeometry } = THREE;

export interface RigParts {
  /** Body pieces that stay rigid (torso, neck, tail). */
  body: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  headPivot: [number, number, number];
  /** Each leg is built hanging down from its hip at the origin. */
  legs: { geo: THREE.BufferGeometry; hip: [number, number, number]; phase: number }[];
  tail?: { geo: THREE.BufferGeometry; pivot: [number, number, number] };
  /** Where the body tilts from when rearing (bear) or lunging (wolf). */
  pivot: [number, number, number];
  /** Snakes: the legs are body segments of this length, chained head to tail and posed every frame. */
  chain?: number;
}

const eye = (b: GeoBuilder, x: number, y: number, z: number, r = 0.018) => b.add(new OctahedronGeometry(r, 0), { matrix: tf(x, y, z), color: '#16110e', vary: 0 });

function leg(len: number, rTop: number, rBot: number, color: string, hoof: string, hoofLen = 0.06): THREE.BufferGeometry {
  const b = new GeoBuilder(len * 100);
  b.add(new CylinderGeometry(rBot, rTop, len, 6, 2), { matrix: tf(0, -len / 2, 0), color: (_x, y) => (y < -len + hoofLen ? col(hoof) : mix(color, hoof, (-y / len) * 0.35)), jitter: rTop * 0.1 });
  return b.build();
}

function rabbit(): RigParts {
  const body = new GeoBuilder(1);
  const fur = (_x: number, _y: number, _z: number, n: THREE.Vector3) => (n.y < -0.3 ? col('#cdb89c') : mix('#7d5f45', '#9a7a5a', 0.5 + n.y * 0.5));
  body.add(new IcosahedronGeometry(0.2, 1), { matrix: tf(0, 0.24, -0.02, 0.15, 0, 0, 0.82, 0.8, 1.2), color: fur, jitter: 0.02 });
  body.add(new IcosahedronGeometry(0.055, 0), { matrix: tf(0, 0.3, -0.26), color: '#f3eee6' });
  const head = new GeoBuilder(2);
  head.add(new IcosahedronGeometry(0.105, 1), { matrix: tf(0, 0.02, 0.06, 0, 0, 0, 0.85, 0.9, 1.15), color: fur, jitter: 0.01 });
  for (const s of [-1, 1]) {
    head.add(new BoxGeometry(0.045, 0.2, 0.018), { matrix: tf(s * 0.04, 0.16, -0.01, -0.25, 0, s * 0.12), color: (_x, _y, _z, n) => (n.z > 0.5 ? col('#c89a86') : col('#735840')) });
    eye(head, s * 0.07, 0.04, 0.11, 0.016);
  }
  head.add(new OctahedronGeometry(0.014, 0), { matrix: tf(0, 0.0, 0.18), color: '#3a2a24' });
  return {
    body: body.build(),
    head: head.build(),
    headPivot: [0, 0.34, 0.18],
    legs: [
      { geo: leg(0.16, 0.055, 0.04, '#6f553e', '#e8e0d4', 0.05), hip: [-0.08, 0.17, -0.12], phase: 0 },
      { geo: leg(0.16, 0.055, 0.04, '#6f553e', '#e8e0d4', 0.05), hip: [0.08, 0.17, -0.12], phase: 0 },
      { geo: leg(0.12, 0.03, 0.025, '#6f553e', '#e8e0d4', 0.04), hip: [-0.06, 0.13, 0.12], phase: Math.PI },
      { geo: leg(0.12, 0.03, 0.025, '#6f553e', '#e8e0d4', 0.04), hip: [0.06, 0.13, 0.12], phase: Math.PI },
    ],
    pivot: [0, 0.15, -0.12],
  };
}

function deer(antlers: boolean): RigParts {
  const coat = (_x: number, _y: number, _z: number, n: THREE.Vector3) => (n.y < -0.4 ? col('#d6c3a4') : mix('#7a5a3e', '#9c7a55', 0.4 + n.y * 0.4));
  const body = new GeoBuilder(3);
  body.add(new CylinderGeometry(0.29, 0.31, 1.1, 8, 2), { matrix: tf(0, 1.0, 0, Math.PI / 2, 0, 0, 1, 1, 0.92), color: coat, jitter: 0.04 });
  body.add(new IcosahedronGeometry(0.3, 1), { matrix: tf(0, 1.03, 0.5, 0, 0, 0, 0.95, 0.95, 0.8), color: coat, jitter: 0.02 });
  body.add(new IcosahedronGeometry(0.29, 1), { matrix: tf(0, 1.0, -0.5, 0, 0, 0, 0.95, 0.95, 0.8), color: coat, jitter: 0.02 });
  body.add(new CylinderGeometry(0.1, 0.16, 1, 7), { matrix: between(0, 1.15, 0.55, 0, 1.55, 0.78), color: coat });
  const head = new GeoBuilder(4);
  head.add(new IcosahedronGeometry(0.13, 1), { matrix: tf(0, 0, 0, 0, 0, 0, 0.85, 0.9, 1.05), color: coat });
  head.add(new CylinderGeometry(0.05, 0.1, 0.26, 7), { matrix: tf(0, -0.05, 0.16, Math.PI / 2 + 0.25, 0, 0), color: coat });
  head.add(new OctahedronGeometry(0.04, 0), { matrix: tf(0, -0.08, 0.3), color: '#211a16' });
  for (const s of [-1, 1]) {
    head.add(new ConeGeometry(0.06, 0.2, 5), { matrix: tf(s * 0.12, 0.1, -0.04, 0, 0, -s * 1.1, 1, 1, 0.45), color: '#8a6848' });
    eye(head, s * 0.085, 0.03, 0.08, 0.02);
    if (antlers) {
      head.add(new CylinderGeometry(0.014, 0.022, 1, 4), { matrix: between(s * 0.05, 0.1, -0.02, s * 0.16, 0.36, 0.02), color: '#d9c7a4' });
      head.add(new CylinderGeometry(0.01, 0.016, 1, 4), { matrix: between(s * 0.16, 0.36, 0.02, s * 0.14, 0.5, 0.12), color: '#e3d4b6' });
      head.add(new CylinderGeometry(0.01, 0.014, 1, 4), { matrix: between(s * 0.12, 0.28, 0.0, s * 0.2, 0.42, -0.08), color: '#e3d4b6' });
    }
  }
  const tail = new GeoBuilder(5);
  tail.add(new ConeGeometry(0.06, 0.2, 5), { matrix: tf(0, -0.09, 0, 0.3, 0, Math.PI), color: (_x, _y, _z, n) => (n.z < 0 ? col('#f3eee6') : col('#2e241d')) });
  const legGeo = leg(0.9, 0.065, 0.035, '#7a5a3e', '#2a211c', 0.07);
  return {
    body: body.build(),
    head: head.build(),
    headPivot: [0, 1.62, 0.82],
    legs: [
      { geo: legGeo, hip: [-0.17, 0.95, 0.48], phase: 0 },
      { geo: legGeo, hip: [0.17, 0.95, 0.48], phase: Math.PI },
      { geo: legGeo, hip: [-0.17, 0.95, -0.48], phase: Math.PI },
      { geo: legGeo, hip: [0.17, 0.95, -0.48], phase: 0 },
    ],
    tail: { geo: tail.build(), pivot: [0, 1.12, -0.62] },
    pivot: [0, 0.95, -0.48],
  };
}

function wolf(): RigParts {
  const pelt = (_x: number, _y: number, _z: number, n: THREE.Vector3) => (n.y > 0.55 ? col('#5d5955') : n.y < -0.3 ? col('#d3cdc2') : mix('#8e8a83', '#a9a49b', 0.5 + n.x * 0.3));
  const body = new GeoBuilder(6);
  body.add(new CylinderGeometry(0.22, 0.26, 0.95, 8, 2), { matrix: tf(0, 0.66, 0, Math.PI / 2, 0, 0, 0.9, 1, 1), color: pelt, jitter: 0.03 });
  body.add(new IcosahedronGeometry(0.28, 1), { matrix: tf(0, 0.7, 0.42, 0, 0, 0, 0.9, 0.95, 0.85), color: pelt, jitter: 0.04 });
  body.add(new IcosahedronGeometry(0.22, 1), { matrix: tf(0, 0.64, -0.42), color: pelt });
  const head = new GeoBuilder(7);
  head.add(new IcosahedronGeometry(0.17, 1), { matrix: tf(0, 0, 0, 0, 0, 0, 0.95, 0.85, 1), color: pelt });
  head.add(new CylinderGeometry(0.05, 0.1, 0.24, 6), { matrix: tf(0, -0.05, 0.19, Math.PI / 2, 0, 0), color: (_x, _y, _z, n) => (n.y < 0 ? col('#d6d0c6') : col('#7c7872')) });
  head.add(new OctahedronGeometry(0.035, 0), { matrix: tf(0, -0.03, 0.32), color: '#1b1714' });
  for (const s of [-1, 1]) {
    head.add(new ConeGeometry(0.055, 0.14, 4), { matrix: tf(s * 0.09, 0.16, -0.02, -0.15, 0, -s * 0.15), color: '#5d5955' });
    eye(head, s * 0.07, 0.04, 0.12, 0.018);
  }
  const tail = new GeoBuilder(8);
  tail.add(new ConeGeometry(0.09, 0.55, 6), { matrix: tf(0, -0.24, 0, 0, 0, Math.PI), color: (_x, y) => (y < -0.42 ? col('#3e3a37') : col('#7a766f')), jitter: 0.02 });
  const legGeo = leg(0.6, 0.06, 0.035, '#77736d', '#4a4541', 0.06);
  return {
    body: body.build(),
    head: head.build(),
    headPivot: [0, 0.82, 0.66],
    legs: [
      { geo: legGeo, hip: [-0.13, 0.6, 0.4], phase: 0 },
      { geo: legGeo, hip: [0.13, 0.6, 0.4], phase: Math.PI },
      { geo: legGeo, hip: [-0.13, 0.6, -0.42], phase: Math.PI },
      { geo: legGeo, hip: [0.13, 0.6, -0.42], phase: 0 },
    ],
    tail: { geo: tail.build(), pivot: [0, 0.72, -0.58] },
    pivot: [0, 0.6, -0.42],
  };
}

function bear(): RigParts {
  const fur = (_x: number, _y: number, _z: number, n: THREE.Vector3) => mix('#1d1a18', '#3b322b', 0.35 + n.y * 0.35 + Math.abs(n.x) * 0.1);
  const body = new GeoBuilder(9);
  body.add(new IcosahedronGeometry(0.62, 1), { matrix: tf(0, 0.82, -0.1, 0, 0, 0, 0.85, 0.78, 1.25), color: fur, jitter: 0.05 });
  body.add(new IcosahedronGeometry(0.45, 1), { matrix: tf(0, 1.02, 0.35, 0, 0, 0, 0.95, 0.8, 0.9), color: fur, jitter: 0.04 });
  const head = new GeoBuilder(10);
  head.add(new IcosahedronGeometry(0.28, 1), { matrix: tf(0, 0, 0, 0, 0, 0, 1, 0.9, 1), color: fur, jitter: 0.02 });
  head.add(new CylinderGeometry(0.09, 0.14, 0.24, 7), { matrix: tf(0, -0.06, 0.26, Math.PI / 2, 0, 0), color: '#8a6a4b' });
  head.add(new OctahedronGeometry(0.05, 0), { matrix: tf(0, -0.03, 0.39), color: '#120f0d' });
  for (const s of [-1, 1]) {
    head.add(new IcosahedronGeometry(0.08, 0), { matrix: tf(s * 0.19, 0.2, -0.05, 0, 0, 0, 1, 1, 0.5), color: '#2a2420' });
    eye(head, s * 0.1, 0.06, 0.22, 0.022);
  }
  const legGeo = leg(0.62, 0.15, 0.12, '#221e1b', '#15110f', 0.08);
  return {
    body: body.build(),
    head: head.build(),
    headPivot: [0, 1.0, 0.85],
    legs: [
      { geo: legGeo, hip: [-0.3, 0.62, 0.42], phase: 0 },
      { geo: legGeo, hip: [0.3, 0.62, 0.42], phase: Math.PI },
      { geo: legGeo, hip: [-0.3, 0.62, -0.5], phase: Math.PI },
      { geo: legGeo, hip: [0.3, 0.62, -0.5], phase: 0 },
    ],
    pivot: [0, 0.62, -0.5],
  };
}

function fish(): RigParts {
  const body = new GeoBuilder(11);
  body.add(new IcosahedronGeometry(0.15, 1), {
    matrix: tf(0, 0, 0.02, 0, 0, 0, 0.42, 0.55, 1.7),
    color: (_x, _y, _z, n) => (n.y > 0.4 ? col('#56613f') : n.y < -0.4 ? col('#e6e1d3') : mix('#b9a080', '#d08a78', 0.5 + n.x * 0.4)),
  });
  body.add(new ConeGeometry(0.035, 0.1, 4), { matrix: tf(0, 0.09, 0.02, -0.3, 0, 0, 1, 1, 0.3), color: '#56613f' });
  for (const s of [-1, 1]) eye(body, s * 0.05, 0.02, 0.2, 0.012);
  const tail = new GeoBuilder(12);
  tail.add(new ConeGeometry(0.11, 0.18, 4), { matrix: tf(0, 0, -0.08, -Math.PI / 2, 0, 0, 1, 0.25, 1), color: '#6b6f4c' });
  return {
    body: body.build(),
    head: new GeoBuilder(13).add(new OctahedronGeometry(0.001, 0), { color: '#000000' }).build(),
    headPivot: [0, 0, 0.2],
    legs: [],
    tail: { geo: tail.build(), pivot: [0, 0, -0.22] },
    pivot: [0, 0, 0],
  };
}

function jackrabbit(): RigParts {
  const fur = (_x: number, _y: number, _z: number, n: THREE.Vector3) => (n.y < -0.3 ? col('#e2d8c6') : mix('#7d6e58', '#a8977a', 0.5 + n.y * 0.5));
  const body = new GeoBuilder(21);
  body.add(new IcosahedronGeometry(0.24, 1), { matrix: tf(0, 0.3, -0.03, 0.2, 0, 0, 0.78, 0.78, 1.3), color: fur, jitter: 0.02 });
  body.add(new IcosahedronGeometry(0.055, 0), { matrix: tf(0, 0.36, -0.34), color: (_x, _y, _z, n) => (n.y > 0 ? col('#1e1a16') : col('#f3eee6')) });
  const head = new GeoBuilder(22);
  head.add(new IcosahedronGeometry(0.12, 1), { matrix: tf(0, 0.02, 0.07, 0, 0, 0, 0.8, 0.88, 1.2), color: fur, jitter: 0.01 });
  for (const s of [-1, 1]) {
    head.add(new BoxGeometry(0.06, 0.32, 0.02), { matrix: tf(s * 0.045, 0.22, -0.02, -0.3, 0, s * 0.15), color: (_x, _y, _z, n) => (n.z > 0.5 ? col('#d8a894') : col('#8a7a62')) });
    head.add(new BoxGeometry(0.062, 0.05, 0.024), { matrix: tf(s * 0.067, 0.37, -0.07, -0.3, 0, s * 0.15), color: '#1e1a16' });
    eye(head, s * 0.08, 0.04, 0.12, 0.018);
  }
  head.add(new OctahedronGeometry(0.015, 0), { matrix: tf(0, 0, 0.21), color: '#3a2a24' });
  const hind = leg(0.22, 0.06, 0.04, '#8a7a62', '#e8e0d4', 0.05);
  const front = leg(0.18, 0.032, 0.026, '#8a7a62', '#e8e0d4', 0.04);
  return {
    body: body.build(),
    head: head.build(),
    headPivot: [0, 0.42, 0.22],
    legs: [
      { geo: hind, hip: [-0.09, 0.23, -0.14], phase: 0 },
      { geo: hind, hip: [0.09, 0.23, -0.14], phase: 0 },
      { geo: front, hip: [-0.06, 0.19, 0.15], phase: Math.PI },
      { geo: front, hip: [0.06, 0.19, 0.15], phase: Math.PI },
    ],
    pivot: [0, 0.2, -0.14],
  };
}

function javelina(): RigParts {
  const bristle = (_x: number, _y: number, _z: number, n: THREE.Vector3) => (n.y < -0.4 ? col('#35302c') : mix('#3e3a36', '#6f685e', 0.4 + n.y * 0.3 + Math.abs(n.x) * 0.1));
  const body = new GeoBuilder(23);
  body.add(new IcosahedronGeometry(0.3, 1), {
    matrix: tf(0, 0.46, -0.05, 0, 0, 0, 0.8, 0.85, 1.45),
    color: (x, y, z, n) => (z > 0.14 && z < 0.26 && y > 0.36 ? col('#c9c0ae') : bristle(x, y, z, n)),
    jitter: 0.04,
  });
  body.add(new IcosahedronGeometry(0.12, 0), { matrix: tf(0, 0.72, 0.02, 0, 0, 0, 0.45, 0.6, 2.2), color: '#2a2622' });
  const head = new GeoBuilder(24);
  head.add(new IcosahedronGeometry(0.17, 1), { matrix: tf(0, 0, 0, 0, 0, 0, 0.85, 0.9, 1.1), color: bristle });
  head.add(new CylinderGeometry(0.06, 0.13, 0.26, 7), { matrix: tf(0, -0.04, 0.2, Math.PI / 2, 0, 0), color: '#4a4540' });
  head.add(new CylinderGeometry(0.065, 0.065, 0.02, 8), { matrix: tf(0, -0.04, 0.335, Math.PI / 2, 0, 0), color: '#6a4a44' });
  for (const s of [-1, 1]) {
    head.add(new ConeGeometry(0.04, 0.09, 4), { matrix: tf(s * 0.09, 0.15, -0.05, -0.2, 0, -s * 0.3), color: '#35302c' });
    eye(head, s * 0.085, 0.05, 0.1, 0.017);
  }
  const legGeo = leg(0.3, 0.05, 0.03, '#3e3a36', '#1e1a18', 0.05);
  return {
    body: body.build(),
    head: head.build(),
    headPivot: [0, 0.52, 0.42],
    legs: [
      { geo: legGeo, hip: [-0.12, 0.3, 0.26], phase: 0 },
      { geo: legGeo, hip: [0.12, 0.3, 0.26], phase: Math.PI },
      { geo: legGeo, hip: [-0.12, 0.3, -0.3], phase: Math.PI },
      { geo: legGeo, hip: [0.12, 0.3, -0.3], phase: 0 },
    ],
    pivot: [0, 0.3, -0.3],
  };
}

function quail(): RigParts {
  const body = new GeoBuilder(25);
  body.add(new IcosahedronGeometry(0.1, 1), {
    matrix: tf(0, 0.14, 0, 0.2, 0, 0, 0.9, 0.85, 1.2),
    color: (_x, y, _z, n) => (n.y < -0.3 ? col('#e8dcc0') : Math.abs(n.x) > 0.6 && y < 0.15 ? col('#9a4a2a') : mix('#6f727a', '#8a8e96', 0.5 + n.y * 0.4)),
  });
  body.add(new ConeGeometry(0.05, 0.1, 4), { matrix: tf(0, 0.15, -0.12, -Math.PI / 2 - 0.3, 0, 0, 1, 1, 0.4), color: '#5f626a' });
  const head = new GeoBuilder(26);
  head.add(new IcosahedronGeometry(0.052, 1), { color: (_x, y, _z, n) => (n.y > 0.55 ? col('#9a4a2a') : n.z > 0.45 && y < 0.005 ? col('#1a1614') : col('#7a7e86')) });
  head.add(new ConeGeometry(0.014, 0.035, 4), { matrix: tf(0, -0.006, 0.06, Math.PI / 2, 0, 0), color: '#2a2622' });
  head.add(new CylinderGeometry(0.005, 0.006, 1, 3), { matrix: between(0, 0.045, 0.0, 0, 0.09, 0.03), color: '#1a1614' });
  head.add(new IcosahedronGeometry(0.018, 0), { matrix: tf(0, 0.092, 0.04, 0, 0, 0, 0.8, 1.3, 0.8), color: '#1a1614' });
  for (const s of [-1, 1]) eye(head, s * 0.04, 0.01, 0.03, 0.009);
  const legGeo = leg(0.07, 0.012, 0.008, '#8a7a6a', '#6a5a4a', 0.02);
  return {
    body: body.build(),
    head: head.build(),
    headPivot: [0, 0.22, 0.09],
    legs: [
      { geo: legGeo, hip: [-0.03, 0.07, 0], phase: 0 },
      { geo: legGeo, hip: [0.03, 0.07, 0], phase: Math.PI },
    ],
    pivot: [0, 0.07, 0],
  };
}

function roadrunner(): RigParts {
  const streak = (x: number, y: number, z: number, n: THREE.Vector3) =>
    n.y < -0.3 ? col('#e8e0d0') : hash2(Math.round(x * 90), Math.round(y * 90) + Math.round(z * 90), 5) < 0.35 ? col('#e8e0d0') : mix('#5a4632', '#7a6044', 0.5 + n.y * 0.4);
  const body = new GeoBuilder(27);
  body.add(new IcosahedronGeometry(0.1, 1), { matrix: tf(0, 0.3, 0, -0.2, 0, 0, 0.75, 0.8, 1.6), color: streak });
  body.add(new CylinderGeometry(0.03, 0.045, 1, 6), { matrix: between(0, 0.33, 0.1, 0, 0.42, 0.16), color: streak });
  const tail = new GeoBuilder(28);
  tail.add(new BoxGeometry(0.06, 0.018, 0.36), { matrix: tf(0, 0.06, -0.17, -0.5, 0, 0), color: (_x, _y, z) => (z < -0.3 ? col('#e8e0d0') : col('#3a3a36')) });
  const head = new GeoBuilder(29);
  head.add(new IcosahedronGeometry(0.055, 1), { matrix: tf(0, 0, 0, 0, 0, 0, 0.85, 0.9, 1.1), color: streak });
  head.add(new ConeGeometry(0.03, 0.1, 4), { matrix: tf(0, 0.06, -0.03, -0.9, 0, 0), color: '#3a2e24' });
  head.add(new ConeGeometry(0.014, 0.12, 4), { matrix: tf(0, -0.005, 0.1, Math.PI / 2, 0, 0), color: '#3a3530' });
  for (const s of [-1, 1]) {
    eye(head, s * 0.04, 0.012, 0.03, 0.01);
    head.add(new OctahedronGeometry(0.012, 0), { matrix: tf(s * 0.044, 0.005, -0.005), color: '#d8743a' });
  }
  const legGeo = leg(0.2, 0.015, 0.01, '#6a6a70', '#4a4a50', 0.03);
  return {
    body: body.build(),
    head: head.build(),
    headPivot: [0, 0.44, 0.17],
    legs: [
      { geo: legGeo, hip: [-0.035, 0.21, 0.02], phase: 0 },
      { geo: legGeo, hip: [0.035, 0.21, 0.02], phase: Math.PI },
    ],
    tail: { geo: tail.build(), pivot: [0, 0.32, -0.14] },
    pivot: [0, 0.2, 0],
  };
}

function lizard(): RigParts {
  const body = new GeoBuilder(30);
  body.add(new IcosahedronGeometry(0.06, 1), {
    matrix: tf(0, 0.05, 0, 0, 0, 0, 0.9, 0.5, 1.7),
    color: (x, _y, z, n) => (n.y > 0.3 ? (hash2(Math.round(x * 200), Math.round(z * 200), 9) < 0.25 ? col('#d8d0a0') : mix('#3f8a70', '#72b066', 0.5 + n.x)) : col('#d8c89a')),
  });
  for (const dz of [0.085, 0.105]) body.add(new CylinderGeometry(0.034, 0.034, 0.01, 8), { matrix: tf(0, 0.055, dz, Math.PI / 2, 0, 0), color: '#1a1614' });
  const head = new GeoBuilder(31);
  head.add(new IcosahedronGeometry(0.035, 1), { matrix: tf(0, 0, 0.01, 0, 0, 0, 0.95, 0.7, 1.35), color: (_x, _y, _z, n) => (n.y < -0.3 ? col('#e8dcb0') : col('#d8b04a')) });
  for (const s of [-1, 1]) eye(head, s * 0.027, 0.01, 0.025, 0.007);
  const tail = new GeoBuilder(32);
  tail.add(new ConeGeometry(0.024, 0.22, 5), { matrix: tf(0, 0, -0.11, -Math.PI / 2, 0, 0), color: (_x, _y, z) => (Math.sin(z * 90) > 0.4 ? col('#6a6a48') : col('#9a9a64')) });
  const legGeo = leg(0.045, 0.01, 0.008, '#4a8a6a', '#3a6a4a', 0.01);
  return {
    body: body.build(),
    head: head.build(),
    headPivot: [0, 0.055, 0.12],
    legs: [
      { geo: legGeo, hip: [-0.05, 0.045, 0.05], phase: 0 },
      { geo: legGeo, hip: [0.05, 0.045, 0.05], phase: Math.PI },
      { geo: legGeo, hip: [-0.05, 0.045, -0.05], phase: Math.PI },
      { geo: legGeo, hip: [0.05, 0.045, -0.05], phase: 0 },
    ],
    tail: { geo: tail.build(), pivot: [0, 0.045, -0.09] },
    pivot: [0, 0.05, 0],
  };
}

const SNAKE_SEG = 0.17;
const SNAKE_SEGS = 7;

function snake(): RigParts {
  const diamonds = (_x: number, _y: number, z: number, n: THREE.Vector3) =>
    n.y < -0.35 ? col('#e0d4b4') : n.y > 0.35 ? (Math.floor(-z * 14) % 3 === 0 ? col('#4a3a2a') : col('#a8906a')) : col('#bca47e');
  const body = new GeoBuilder(33);
  body.add(new CylinderGeometry(0.04, 0.045, 1, 7), { matrix: between(0, 0, 0.02, 0, 0, -0.02), color: '#a8906a' });
  const head = new GeoBuilder(34);
  head.add(new IcosahedronGeometry(0.05, 1), { matrix: tf(0, 0, 0.04, 0, 0, 0, 1.1, 0.55, 1.45), color: (_x, _y, _z, n) => (n.y < -0.3 ? col('#d8cca8') : col('#8a7458')) });
  for (const s of [-1, 1]) eye(head, s * 0.04, 0.012, 0.06, 0.008);
  const legs: RigParts['legs'] = [];
  for (let i = 0; i < SNAKE_SEGS; i++) {
    const r = 0.045 - i * 0.0035;
    const seg = new GeoBuilder(40 + i);
    seg.add(new CylinderGeometry(r * 0.92, r, SNAKE_SEG, 7), { matrix: tf(0, 0, -SNAKE_SEG / 2, Math.PI / 2, 0, 0), color: diamonds, vary: 0.05 });
    seg.add(new IcosahedronGeometry(r, 0), { matrix: tf(0, 0, 0), color: '#a8906a', vary: 0.05 });
    legs.push({ geo: seg.build(), hip: [0, 0.045, -i * SNAKE_SEG], phase: i * 0.9 });
  }
  const rattle = new GeoBuilder(49);
  for (let k = 0; k < 4; k++) rattle.add(new CylinderGeometry(0.018 - k * 0.002, 0.02 - k * 0.002, 0.022, 6), { matrix: tf(0, 0, -0.012 - k * 0.022, Math.PI / 2, 0, 0), color: k % 2 ? '#8a7a5a' : '#c8b890', vary: 0.03 });
  legs.push({ geo: rattle.build(), hip: [0, 0.045, -SNAKE_SEGS * SNAKE_SEG], phase: SNAKE_SEGS * 0.9 });
  return { body: body.build(), head: head.build(), headPivot: [0, 0.05, 0.02], legs, pivot: [0, 0.045, 0], chain: SNAKE_SEG };
}

function cougar(): RigParts {
  const coat = (_x: number, _y: number, _z: number, n: THREE.Vector3) => (n.y < -0.35 ? col('#e6d8bc') : mix('#a47a4a', '#c49a66', 0.45 + n.y * 0.35 + n.x * 0.05));
  const body = new GeoBuilder(35);
  body.add(new CylinderGeometry(0.2, 0.23, 1.05, 8, 2), { matrix: tf(0, 0.64, 0, Math.PI / 2, 0, 0, 0.85, 1, 1), color: coat, jitter: 0.03 });
  body.add(new IcosahedronGeometry(0.25, 1), { matrix: tf(0, 0.66, 0.45, 0, 0, 0, 0.85, 0.95, 0.85), color: coat, jitter: 0.03 });
  body.add(new IcosahedronGeometry(0.24, 1), { matrix: tf(0, 0.66, -0.46), color: coat });
  body.add(new CylinderGeometry(0.1, 0.14, 1, 7), { matrix: between(0, 0.68, 0.5, 0, 0.8, 0.68), color: coat });
  const head = new GeoBuilder(36);
  head.add(new IcosahedronGeometry(0.15, 1), { matrix: tf(0, 0, 0, 0, 0, 0, 1, 0.85, 1), color: coat });
  head.add(new CylinderGeometry(0.06, 0.09, 0.13, 6), { matrix: tf(0, -0.05, 0.13, Math.PI / 2, 0, 0), color: '#efe6d6' });
  head.add(new OctahedronGeometry(0.025, 0), { matrix: tf(0, -0.02, 0.2), color: '#b07a6a' });
  for (const s of [-1, 1]) {
    head.add(new ConeGeometry(0.045, 0.09, 4), { matrix: tf(s * 0.08, 0.13, -0.02, -0.1, 0, -s * 0.2), color: '#3a2e24' });
    eye(head, s * 0.06, 0.03, 0.12, 0.017);
    head.add(new OctahedronGeometry(0.02, 0), { matrix: tf(s * 0.035, -0.03, 0.17, 0, 0, 0, 1, 1.8, 1), color: '#2a211a' });
  }
  const tail = new GeoBuilder(37);
  tail.add(new CylinderGeometry(0.05, 0.06, 0.75, 6), { matrix: tf(0, -0.36, 0), color: '#b08a5a', jitter: 0.01 });
  tail.add(new IcosahedronGeometry(0.065, 0), { matrix: tf(0, -0.74, 0.02, 0, 0, 0, 1, 1.4, 1), color: '#2a211a' });
  const legGeo = leg(0.58, 0.07, 0.04, '#b08a5a', '#8a6a48', 0.05);
  return {
    body: body.build(),
    head: head.build(),
    headPivot: [0, 0.82, 0.72],
    legs: [
      { geo: legGeo, hip: [-0.13, 0.58, 0.42], phase: 0 },
      { geo: legGeo, hip: [0.13, 0.58, 0.42], phase: Math.PI },
      { geo: legGeo, hip: [-0.13, 0.58, -0.44], phase: Math.PI },
      { geo: legGeo, hip: [0.13, 0.58, -0.44], phase: 0 },
    ],
    tail: { geo: tail.build(), pivot: [0, 0.7, -0.62] },
    pivot: [0, 0.58, -0.44],
  };
}

const BUILDERS: Partial<Record<SpeciesId, () => RigParts>> = { rabbit, wolf, bear, jackrabbit, javelina, quail, roadrunner, lizard, snake, cougar };

const cache = new Map<string, RigParts>();

export function rigParts(species: SpeciesId, variant = 0): RigParts {
  const key = species + variant;
  let r = cache.get(key);
  if (!r) {
    r = species === 'deer' ? deer(variant === 1) : (BUILDERS[species] ?? fish)();
    cache.set(key, r);
  }
  return r;
}

export interface Rig {
  root: THREE.Group;
  pivot: THREE.Group;
  head: THREE.Mesh;
  legs: { mesh: THREE.Mesh; phase: number }[];
  tail: THREE.Mesh | null;
  /** Segment length for chained (snake) bodies, else 0. */
  chain: number;
}

export function buildRig(species: SpeciesId, variant: number, material: THREE.Material): Rig {
  const parts = rigParts(species, variant);
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.set(...parts.pivot);
  root.add(pivot);
  const off = (p: [number, number, number]) => new THREE.Vector3(p[0] - parts.pivot[0], p[1] - parts.pivot[1], p[2] - parts.pivot[2]);
  const body = new THREE.Mesh(parts.body, material);
  body.position.copy(off([0, 0, 0]));
  body.castShadow = true;
  pivot.add(body);
  const head = new THREE.Mesh(parts.head, material);
  head.position.copy(off(parts.headPivot));
  head.castShadow = true;
  pivot.add(head);
  const legs = parts.legs.map((l) => {
    const m = new THREE.Mesh(l.geo, material);
    m.position.copy(off(l.hip));
    m.castShadow = true;
    pivot.add(m);
    return { mesh: m, phase: l.phase };
  });
  let tail: THREE.Mesh | null = null;
  if (parts.tail) {
    tail = new THREE.Mesh(parts.tail.geo, material);
    tail.position.copy(off(parts.tail.pivot));
    pivot.add(tail);
  }
  return { root, pivot, head, legs, tail, chain: parts.chain ?? 0 };
}
