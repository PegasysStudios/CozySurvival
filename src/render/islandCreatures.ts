import * as THREE from 'three';
import { hash2 } from '../core/rng';
import { between, col, GeoBuilder, mix, tf } from './geo';
import type { RigParts } from './creatures';

const { CylinderGeometry, ConeGeometry, IcosahedronGeometry, OctahedronGeometry, BoxGeometry } = THREE;

const eye = (b: GeoBuilder, x: number, y: number, z: number, r = 0.018) => b.add(new OctahedronGeometry(r, 0), { matrix: tf(x, y, z), color: '#16110e', vary: 0 });

function leg(len: number, rTop: number, rBot: number, color: string, hoof: string, hoofLen = 0.06): THREE.BufferGeometry {
  const b = new GeoBuilder(len * 100 + 7);
  b.add(new CylinderGeometry(rBot, rTop, len, 6, 2), { matrix: tf(0, -len / 2, 0), color: (_x, y) => (y < -len + hoofLen ? col(hoof) : mix(color, hoof, (-y / len) * 0.3)), jitter: rTop * 0.1 });
  return b.build();
}

const empty = () => new GeoBuilder(1).add(new OctahedronGeometry(0.001, 0), { color: '#000000' }).build();

/** A feral pig: bigger and darker than a javelina, with a long snout, a bristly mane and small tusks. */
export function boar(): RigParts {
  const bristle = (_x: number, y: number, _z: number, n: THREE.Vector3) => (n.y < -0.4 ? col('#2a2420') : mix('#2e2824', '#5a4a3e', 0.35 + n.y * 0.3 + Math.abs(n.x) * 0.1 + (y > 0.7 ? 0.1 : 0)));
  const body = new GeoBuilder(1101);
  body.add(new IcosahedronGeometry(0.36, 1), { matrix: tf(0, 0.56, -0.05, 0, 0, 0, 0.8, 0.84, 1.55), color: bristle, jitter: 0.05 });
  body.add(new IcosahedronGeometry(0.14, 0), { matrix: tf(0, 0.86, 0.1, 0, 0, 0, 0.4, 0.6, 2.6), color: '#1e1a16' });
  const head = new GeoBuilder(1102);
  head.add(new IcosahedronGeometry(0.2, 1), { matrix: tf(0, 0, 0, 0, 0, 0, 0.85, 0.9, 1.15), color: bristle });
  head.add(new CylinderGeometry(0.07, 0.15, 0.34, 7), { matrix: tf(0, -0.05, 0.26, Math.PI / 2, 0, 0), color: '#3a3230' });
  head.add(new CylinderGeometry(0.075, 0.075, 0.02, 8), { matrix: tf(0, -0.05, 0.43, Math.PI / 2, 0, 0), color: '#7a5a52' });
  for (const s of [-1, 1]) {
    head.add(new ConeGeometry(0.05, 0.11, 4), { matrix: tf(s * 0.11, 0.17, -0.06, -0.3, 0, -s * 0.35), color: '#2a2420' });
    head.add(new ConeGeometry(0.014, 0.07, 4), { matrix: tf(s * 0.07, -0.06, 0.34, -0.6, 0, s * 0.3), color: '#e8e0cc' });
    eye(head, s * 0.1, 0.06, 0.12, 0.018);
  }
  const tail = new GeoBuilder(1103);
  tail.add(new CylinderGeometry(0.012, 0.02, 0.2, 4), { matrix: tf(0, -0.1, 0), color: '#2a2420' });
  const legGeo = leg(0.36, 0.06, 0.035, '#2e2824', '#1a1614', 0.05);
  return {
    body: body.build(),
    head: head.build(),
    headPivot: [0, 0.62, 0.52],
    legs: [
      { geo: legGeo, hip: [-0.14, 0.36, 0.32], phase: 0 },
      { geo: legGeo, hip: [0.14, 0.36, 0.32], phase: Math.PI },
      { geo: legGeo, hip: [-0.14, 0.36, -0.36], phase: Math.PI },
      { geo: legGeo, hip: [0.14, 0.36, -0.36], phase: 0 },
    ],
    tail: { geo: tail.build(), pivot: [0, 0.62, -0.58] },
    pivot: [0, 0.36, -0.36],
  };
}

/** A feral goat: slim, long-legged, patchy white and brown, with swept-back horns and a beard. */
export function goat(): RigParts {
  const coat = (x: number, y: number, z: number, n: THREE.Vector3) => (hash2(Math.round(x * 8), Math.round((y + z) * 8), 13) < 0.45 ? col('#7a5a3e') : n.y < -0.4 ? col('#d8d0c0') : mix('#e6e0d4', '#f4f0e6', 0.5 + n.y * 0.3));
  const body = new GeoBuilder(1201);
  body.add(new CylinderGeometry(0.2, 0.22, 0.72, 8, 2), { matrix: tf(0, 0.72, 0, Math.PI / 2, 0, 0, 1, 1, 0.9), color: coat, jitter: 0.03 });
  body.add(new IcosahedronGeometry(0.21, 1), { matrix: tf(0, 0.74, 0.33), color: coat });
  body.add(new IcosahedronGeometry(0.2, 1), { matrix: tf(0, 0.72, -0.33), color: coat });
  body.add(new CylinderGeometry(0.07, 0.1, 1, 6), { matrix: between(0, 0.8, 0.38, 0, 1.0, 0.52), color: coat });
  const head = new GeoBuilder(1202);
  head.add(new IcosahedronGeometry(0.1, 1), { matrix: tf(0, 0, 0.02, 0, 0, 0, 0.85, 0.95, 1.3), color: '#e6e0d4' });
  head.add(new CylinderGeometry(0.035, 0.06, 0.14, 6), { matrix: tf(0, -0.04, 0.13, Math.PI / 2, 0, 0), color: '#d0c8b8' });
  head.add(new ConeGeometry(0.03, 0.12, 4), { matrix: tf(0, -0.12, 0.11, Math.PI, 0, 0), color: '#8a7a64' });
  for (const s of [-1, 1]) {
    head.add(new CylinderGeometry(0.008, 0.025, 1, 5), { matrix: between(s * 0.04, 0.08, -0.01, s * 0.08, 0.26, -0.16), color: '#6a5a48' });
    head.add(new BoxGeometry(0.1, 0.025, 0.04), { matrix: tf(s * 0.1, 0.03, -0.02, 0, 0, s * 0.4), color: '#c8b8a0' });
    eye(head, s * 0.065, 0.03, 0.07, 0.014);
  }
  const tail = new GeoBuilder(1203);
  tail.add(new ConeGeometry(0.035, 0.12, 5), { matrix: tf(0, 0.05, 0), color: '#e6e0d4' });
  const legGeo = leg(0.52, 0.045, 0.028, '#d8d0c0', '#3a3028', 0.06);
  return {
    body: body.build(),
    head: head.build(),
    headPivot: [0, 1.04, 0.56],
    legs: [
      { geo: legGeo, hip: [-0.1, 0.56, 0.3], phase: 0 },
      { geo: legGeo, hip: [0.1, 0.56, 0.3], phase: Math.PI },
      { geo: legGeo, hip: [-0.1, 0.56, -0.3], phase: Math.PI },
      { geo: legGeo, hip: [0.1, 0.56, -0.3], phase: 0 },
    ],
    tail: { geo: tail.build(), pivot: [0, 0.82, -0.5] },
    pivot: [0, 0.56, -0.3],
  };
}

/** A red junglefowl cock: russet back, a golden-orange neck, a red comb and an arching dark green tail. */
export function junglefowl(): RigParts {
  const body = new GeoBuilder(1301);
  body.add(new IcosahedronGeometry(0.13, 1), {
    matrix: tf(0, 0.22, 0, 0.25, 0, 0, 0.85, 0.85, 1.25),
    color: (_x, y, _z, n) => (n.y < -0.3 ? col('#1e2a22') : y > 0.26 ? col('#b8442a') : mix('#8a3a22', '#a84a2a', 0.5 + n.x * 0.3)),
  });
  body.add(new CylinderGeometry(0.05, 0.075, 1, 6), { matrix: between(0, 0.27, 0.08, 0, 0.36, 0.13), color: '#e0902e' });
  const tail = new GeoBuilder(1302);
  for (let i = 0; i < 4; i++) {
    tail.add(new BoxGeometry(0.03, 0.2 + i * 0.04, 0.012), { matrix: tf((i - 1.5) * 0.02, 0.1 + i * 0.02, -0.04 - i * 0.015, -0.7 - i * 0.12, 0, (i - 1.5) * 0.1), color: i % 2 ? '#1e3a2a' : '#2a4a3a' });
  }
  const head = new GeoBuilder(1303);
  head.add(new IcosahedronGeometry(0.055, 1), { color: '#e8a040' });
  head.add(new ConeGeometry(0.014, 0.04, 4), { matrix: tf(0, -0.006, 0.065, Math.PI / 2, 0, 0), color: '#d8c890' });
  head.add(new BoxGeometry(0.012, 0.05, 0.07), { matrix: tf(0, 0.06, 0.01), color: '#d02a2a' });
  head.add(new IcosahedronGeometry(0.018, 0), { matrix: tf(0, -0.05, 0.04, 0, 0, 0, 0.7, 1.2, 0.7), color: '#d02a2a' });
  for (const s of [-1, 1]) eye(head, s * 0.04, 0.012, 0.03, 0.009);
  const legGeo = leg(0.12, 0.014, 0.01, '#a89060', '#8a7a50', 0.02);
  return {
    body: body.build(),
    head: head.build(),
    headPivot: [0, 0.4, 0.15],
    legs: [
      { geo: legGeo, hip: [-0.04, 0.12, 0], phase: 0 },
      { geo: legGeo, hip: [0.04, 0.12, 0], phase: Math.PI },
    ],
    tail: { geo: tail.build(), pivot: [0, 0.26, -0.14] },
    pivot: [0, 0.12, 0],
  };
}

/** A red land crab, drawn a little over life size: a broad shell on six walking legs, the claws held up in front. */
export function crab(): RigParts {
  const shell = (_x: number, _y: number, _z: number, n: THREE.Vector3) => (n.y > 0.4 ? mix('#c8402a', '#e0603a', 0.5 + n.x * 0.3) : col('#e8c8a0'));
  const body = new GeoBuilder(1401);
  body.add(new IcosahedronGeometry(0.1, 1), { matrix: tf(0, 0.08, 0, 0, 0, 0, 1.45, 0.5, 1.05), color: shell, jitter: 0.008 });
  const head = new GeoBuilder(1402);
  for (const s of [-1, 1]) {
    head.add(new CylinderGeometry(0.012, 0.016, 1, 5), { matrix: between(s * 0.06, 0, 0, s * 0.11, 0.04, 0.06), color: '#d04a2a' });
    head.add(new IcosahedronGeometry(0.035, 0), { matrix: tf(s * 0.12, 0.05, 0.09, 0, 0, 0, 1, 0.7, 1.3), color: '#e05a32' });
    head.add(new CylinderGeometry(0.004, 0.004, 0.05, 3), { matrix: tf(s * 0.025, 0.04, 0.02), color: '#1a1410' });
    eye(head, s * 0.025, 0.066, 0.02, 0.01);
  }
  const legs: RigParts['legs'] = [];
  [-0.05, 0, 0.05].forEach((hz, i) => {
    for (const s of [-1, 1]) {
      const b = new GeoBuilder(1410 + i * 2 + (s > 0 ? 1 : 0));
      b.add(new CylinderGeometry(0.008, 0.011, 1, 4), { matrix: between(0, 0, 0, s * 0.09, 0.03, hz * 0.5), color: '#d04a2a' });
      b.add(new CylinderGeometry(0.005, 0.008, 1, 4), { matrix: between(s * 0.09, 0.03, hz * 0.5, s * 0.14, -0.06, hz), color: '#c84028' });
      legs.push({ geo: b.build(), hip: [s * 0.1, 0.08, hz], phase: (i + (s > 0 ? 1 : 0)) % 2 ? Math.PI : 0 });
    }
  });
  return { body: body.build(), head: head.build(), headPivot: [0, 0.08, 0.08], legs, pivot: [0, 0.08, 0] };
}

export const VIPER_SEG = 0.18;
const VIPER_SEGS = 8;

/** A fer-de-lance: olive-brown with dark-edged triangles down its sides, a broad arrow-shaped head and a pale chin. */
export function viper(): RigParts {
  const blotch = (_x: number, _y: number, z: number, n: THREE.Vector3) =>
    n.y < -0.35 ? col('#e8d88a') : Math.abs(n.x) > 0.35 && Math.floor(-z * 11) % 3 === 0 ? col('#2e2a1e') : n.y > 0.35 ? col('#7a6a44') : col('#948058');
  const body = new GeoBuilder(1501);
  body.add(new CylinderGeometry(0.042, 0.047, 1, 7), { matrix: between(0, 0, 0.02, 0, 0, -0.02), color: '#7a6a44' });
  const head = new GeoBuilder(1502);
  head.add(new IcosahedronGeometry(0.055, 1), { matrix: tf(0, 0, 0.045, 0, 0, 0, 1.3, 0.5, 1.5), color: (_x, _y, _z, n) => (n.y < -0.3 ? col('#f0e090') : col('#6a5a3a')) });
  for (const s of [-1, 1]) eye(head, s * 0.05, 0.012, 0.07, 0.008);
  const legs: RigParts['legs'] = [];
  for (let i = 0; i < VIPER_SEGS; i++) {
    const r = 0.048 - i * 0.0045;
    const seg = new GeoBuilder(1510 + i);
    seg.add(new CylinderGeometry(r * 0.9, r, VIPER_SEG, 7), { matrix: tf(0, 0, -VIPER_SEG / 2, Math.PI / 2, 0, 0), color: blotch, vary: 0.05 });
    seg.add(new IcosahedronGeometry(r, 0), { matrix: tf(0, 0, 0), color: '#7a6a44', vary: 0.05 });
    legs.push({ geo: seg.build(), hip: [0, 0.048, -i * VIPER_SEG], phase: i * 0.9 });
  }
  const tip = new GeoBuilder(1520);
  tip.add(new ConeGeometry(0.012, 0.12, 5), { matrix: tf(0, 0, -0.06, -Math.PI / 2, 0, 0), color: '#5a4a30' });
  legs.push({ geo: tip.build(), hip: [0, 0.048, -VIPER_SEGS * VIPER_SEG], phase: VIPER_SEGS * 0.9 });
  return { body: body.build(), head: head.build(), headPivot: [0, 0.05, 0.02], legs, pivot: [0, 0.048, 0], chain: VIPER_SEG };
}

/** A parrotfish: turquoise and green with pink fin edges and a pale beak. */
export function reefFish(): RigParts {
  const body = new GeoBuilder(1601);
  body.add(new IcosahedronGeometry(0.17, 1), {
    matrix: tf(0, 0, 0.02, 0, 0, 0, 0.45, 0.72, 1.6),
    color: (x, y, z, n) => (n.y < -0.5 ? col('#8ae0c8') : hash2(Math.round(x * 30), Math.round((y + z) * 30), 21) < 0.25 ? col('#e87aa8') : mix('#1ab0a0', '#3ad0e0', 0.5 + n.y * 0.4)),
  });
  body.add(new ConeGeometry(0.05, 0.16, 4), { matrix: tf(0, 0.13, 0, -0.2, 0, 0, 1, 1, 0.3), color: '#e87aa8' });
  body.add(new ConeGeometry(0.03, 0.05, 5), { matrix: tf(0, -0.01, 0.28, Math.PI / 2, 0, 0), color: '#e0e8d0' });
  for (const s of [-1, 1]) eye(body, s * 0.06, 0.03, 0.2, 0.013);
  const tail = new GeoBuilder(1602);
  tail.add(new ConeGeometry(0.14, 0.2, 4), { matrix: tf(0, 0, -0.09, -Math.PI / 2, 0, 0, 1, 0.25, 1), color: '#2ab8c8' });
  return { body: body.build(), head: empty(), headPivot: [0, 0, 0.22], legs: [], tail: { geo: tail.build(), pivot: [0, 0, -0.25] }, pivot: [0, 0, 0] };
}

/** A box jellyfish: a pale, faintly blue bell trailing four long tentacles. */
export function jellyfish(): RigParts {
  const body = new GeoBuilder(1701);
  body.add(new IcosahedronGeometry(0.16, 1), { matrix: tf(0, 0.05, 0, 0, 0.4, 0, 1, 1.1, 1), color: (_x, y) => (y > 0.1 ? col('#d8eef4') : col('#b8dcea')), vary: 0.05 });
  const tail = new GeoBuilder(1702);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    tail.add(new CylinderGeometry(0.006, 0.01, 1, 3), { matrix: between(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1, Math.cos(a) * 0.14, -0.7, Math.sin(a) * 0.14), color: '#c8e4ee' });
  }
  return { body: body.build(), head: empty(), headPivot: [0, 0, 0], legs: [], tail: { geo: tail.build(), pivot: [0, -0.02, 0] }, pivot: [0, 0, 0] };
}

/** A tiger shark swimming just below the surface, so its dorsal fin cuts the water. */
export function shark(): RigParts {
  const skin = (x: number, _y: number, z: number, n: THREE.Vector3) => (n.y < -0.3 ? col('#e0e4e0') : Math.sin(z * 14 + x * 3) > 0.7 ? col('#4a4e50') : mix('#5e666a', '#7a8286', 0.5 + n.y * 0.4));
  const body = new GeoBuilder(1801);
  body.add(new IcosahedronGeometry(0.35, 1), { matrix: tf(0, 0, 0.1, 0, 0, 0, 0.8, 0.7, 3.4), color: skin, jitter: 0.02 });
  body.add(new ConeGeometry(0.2, 0.55, 4), { matrix: tf(0, 0.42, 0.05, -0.35, 0, 0, 0.25, 1, 1), color: '#5a6266' });
  for (const s of [-1, 1]) body.add(new ConeGeometry(0.14, 0.5, 4), { matrix: tf(s * 0.3, -0.12, 0.4, 0, 0, s * (Math.PI / 2 + 0.4), 1, 1, 0.25), color: '#5a6266' });
  for (const s of [-1, 1]) eye(body, s * 0.18, 0.05, 1.05, 0.022);
  const tail = new GeoBuilder(1802);
  tail.add(new ConeGeometry(0.1, 0.5, 4), { matrix: tf(0, 0.18, -0.32, -Math.PI / 2 - 0.6, 0, 0, 0.25, 1, 1), color: '#5a6266' });
  tail.add(new ConeGeometry(0.08, 0.32, 4), { matrix: tf(0, -0.1, -0.24, -Math.PI / 2 + 0.7, 0, 0, 0.25, 1, 1), color: '#5a6266' });
  return { body: body.build(), head: empty(), headPivot: [0, 0, 1.2], legs: [], tail: { geo: tail.build(), pivot: [0, 0, -1.05] }, pivot: [0, 0, 0] };
}
