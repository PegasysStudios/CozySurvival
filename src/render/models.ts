import * as THREE from 'three';
import { clamp } from '../core/math';
import { hash2, Rng } from '../core/rng';
import type { ResourceKind, TreeSpecies } from '../data/resources';
import { desertResourceGeometry, desertTreeGeometry, isDesertTree } from './desertModels';
import { between, col, GeoBuilder, mix, tf } from './geo';
import { blades, coniferTiers, foliage, frond, roots } from './plantParts';

const { CylinderGeometry, ConeGeometry, IcosahedronGeometry, DodecahedronGeometry, OctahedronGeometry } = THREE;

/** Where a peeled birch's bare wood gives way to the bark still out of reach. */
const STRIP_TOP = 3.6;

/**
 * `lod` 1 is the distant variant: same silhouette and colours, far fewer faces, no roots or limbs.
 * `stripped` shows a birch with the lower half of its trunk peeled to bare wood.
 */
export function treeGeometry(species: TreeSpecies, lod = 0, stripped = false): THREE.BufferGeometry {
  if (isDesertTree(species)) return desertTreeGeometry(species, lod, stripped);
  const b = new GeoBuilder(species.length * 31);
  const near = lod === 0;
  if (species === 'fir') {
    b.add(new CylinderGeometry(0.09, 0.4, 5.2, near ? 7 : 5, near ? 3 : 1), { matrix: tf(0, 2.6, 0), color: (_x, y) => mix('#4a3025', '#6b4632', y / 6), jitter: 0.04, vary: 0.12 });
    if (near) roots(b, '#4f3427', 0.4, 4, 3);
    coniferTiers(b, { tiers: 7, y0: 2.3, y1: 10.2, r0: 2.55, r1: 0.55, h0: 2.9, h1: 1.7, droop: 1.1, dark: '#1f3f2b', light: '#3e6b3b', under: '#172b20', seed: 5 }, lod);
    b.add(new ConeGeometry(0.28, 1.6, near ? 6 : 4), { matrix: tf(0, 12.1, 0), color: '#3f6a3a', sway: 0.14 });
  } else if (species === 'cedar') {
    b.add(new CylinderGeometry(0.12, 0.46, 5.4, near ? 8 : 5, near ? 3 : 1), { matrix: tf(0, 2.7, 0), color: (_x, y) => mix('#6d3a26', '#8a5236', y / 6), jitter: 0.05, vary: 0.12 });
    if (near) {
      b.add(new CylinderGeometry(0.46, 0.78, 0.9, 8), { matrix: tf(0, 0.35, 0), color: '#653523', jitter: 0.08 });
      roots(b, '#5f3322', 0.5, 5, 9);
    }
    coniferTiers(b, { tiers: 8, y0: 2.0, y1: 10.8, r0: 2.9, r1: 0.5, h0: 2.3, h1: 1.4, droop: 1.9, dark: '#2d5a2f', light: '#5e8b43', under: '#1f3a23', seed: 17, lean: 0.35 }, lod);
    b.add(new ConeGeometry(0.22, 1.8, near ? 6 : 4), { matrix: tf(0.3, 12.6, 0.1, 0, 0, -0.35), color: '#56813f', sway: 0.16 });
  } else if (species === 'birch') {
    const bark = (x: number, y: number, z: number) => {
      const a = Math.atan2(z, x);
      if (stripped && y < STRIP_TOP + (hash2(Math.floor(a * 3), 5, 11) - 0.5) * 0.5) {
        return mix('#b98a5c', '#d8b184', hash2(Math.floor(y * 3.1), Math.floor(a * 2), 13));
      }
      const band = hash2(Math.floor(y * 2.7), Math.floor(a * 1.3), 7);
      return col(band < 0.2 ? '#3b342e' : band < 0.3 ? '#bdb5a6' : '#ece7dc');
    };
    b.add(new CylinderGeometry(0.1, 0.22, 7.2, near ? 7 : 5, near ? 9 : 4), { matrix: tf(0, 3.6, 0), color: bark, jitter: 0.03, vary: 0.05 });
    if (near) {
      const limbs: [number, number, number, number][] = [
        [0.9, 4.2, 5.8, 0.3], [-0.8, 4.8, 6.4, 2.1], [0.2, 5.3, 7.0, 4.0],
      ];
      for (const [dx, y0, y1, a] of limbs) {
        b.add(new CylinderGeometry(0.05, 0.08, 1, 5), { matrix: between(0, y0, 0, Math.cos(a) * Math.abs(dx) * 1.3, y1, Math.sin(a) * Math.abs(dx) * 1.3), color: '#e3ddd0' });
      }
    }
    const rng = new Rng(41);
    const blobs: [number, number, number, number][] = [
      [0, 7.6, 0, 1.45], [1.1, 6.6, 0.5, 1.2], [-1.0, 6.9, -0.6, 1.25], [0.3, 6.1, -1.1, 1.05], [-0.5, 5.8, 1.0, 1.0], [0.6, 8.3, 0.4, 0.8],
    ];
    for (const [x, y, z, r] of blobs) {
      b.add(new IcosahedronGeometry(r, near ? 1 : 0), {
        matrix: tf(x, y, z, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.82, 1),
        color: foliage('#6c9a3e', '#b2cc63', '#4d7430'),
        jitter: near ? 0.28 : 0.12, vary: 0.1, sway: 0.1,
      });
    }
  } else {
    b.add(new CylinderGeometry(0.2, 0.34, 3.6, near ? 8 : 5, near ? 2 : 1), { matrix: tf(0, 1.8, 0), color: (_x, y, _z, n) => (n.x > 0.5 && y < 2 ? col('#5d7a3a') : mix('#4d3d30', '#6a5442', y / 4)), jitter: 0.05, vary: 0.1 });
    if (near) {
      roots(b, '#4a3a2e', 0.34, 4, 13);
      const limbs: [number, number, number][] = [[1.4, 6.0, 0.4], [-1.3, 6.3, -0.5], [0.2, 6.8, 1.3], [-0.3, 6.1, -1.4]];
      for (const [x, y, z] of limbs) b.add(new CylinderGeometry(0.1, 0.17, 1, 6), { matrix: between(0, 3.3, 0, x, y, z), color: '#5a4636' });
    }
    const rng = new Rng(77);
    const blobs: [number, number, number, number][] = [
      [0, 8.2, 0, 2.1], [1.8, 7.0, 0.6, 1.8], [-1.7, 7.2, -0.7, 1.85], [0.6, 6.8, 1.8, 1.6], [-0.6, 6.7, -1.9, 1.6], [1.2, 8.6, -1.0, 1.4], [-1.1, 8.5, 1.1, 1.4],
    ];
    for (const [x, y, z, r] of blobs) {
      b.add(near ? new DodecahedronGeometry(r, 1) : new IcosahedronGeometry(r * 1.04, 0), {
        matrix: tf(x, y, z, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.78, 1),
        color: foliage('#3f6d2c', '#86ad49', '#2f5022'),
        jitter: near ? 0.35 : 0.14, vary: 0.1, sway: 0.09,
      });
    }
  }
  return b.build(true);
}

const BARK: Record<TreeSpecies, string> = {
  fir: '#5a3a2a', cedar: '#7a4430', birch: '#e6e0d4', maple: '#584536',
  joshua: '#6f604c', mesquite: '#4a3a2e', cottonwood: '#8a8378', juniper: '#7a5e4a', pinyon: '#5e4636', ponderosa: '#a8603a',
};
const TRUNK_R: Record<TreeSpecies, number> = {
  fir: 0.4, cedar: 0.5, birch: 0.2, maple: 0.33,
  joshua: 0.24, mesquite: 0.18, cottonwood: 0.4, juniper: 0.28, pinyon: 0.28, ponderosa: 0.45,
};

export function stumpGeometry(species: TreeSpecies): THREE.BufferGeometry {
  const r = TRUNK_R[species];
  const b = new GeoBuilder(7);
  b.add(new CylinderGeometry(r * 0.95, r * 1.18, 0.7, 8), {
    matrix: tf(0, 0.25, 0),
    color: (_x, _y, _z, n) => (n.y > 0.9 ? col('#d9bb8e') : col(BARK[species])),
    jitter: 0.04,
  });
  b.add(new CylinderGeometry(r * 0.5, r * 0.5, 0.02, 8), { matrix: tf(0, 0.61, 0), color: '#b9925f' });
  return b.build();
}

/** A felled trunk: unit radius, running from x=0 (stump end) to x=1 (tip), scaled per instance. */
export function trunkGeometry(species: TreeSpecies): THREE.BufferGeometry {
  const b = new GeoBuilder(31);
  b.add(new CylinderGeometry(1, 1, 1, 8, 4), {
    matrix: tf(0.5, 0, 0, 0, 0, Math.PI / 2),
    jitter: 0.04,
    color: (x, _y, _z, n) => {
      if (Math.abs(n.x) > 0.9) return col('#d9bb8e');
      if (species === 'birch' && Math.sin(x * 47) > 0.8) return col('#3b3631');
      if (species === 'ponderosa' && Math.sin(x * 31) > 0.7) return col('#5a3322');
      return col(BARK[species]);
    },
    vary: 0.06,
  });
  return b.build();
}

/** Sandstone (red, banded, with a pale varnish-free top) or basalt boulders for the desert. */
const DESERT_ROCK = {
  sandstone: (y: number, n: THREE.Vector3) =>
    n.y > 0.62 ? mix('#d9a27a', '#e8bf98', n.y) : n.y < -0.3 ? col('#8a4a34') : mix(Math.sin(y * 9) > 0.35 ? '#b8663f' : '#c47a4f', '#d08c5e', 0.5 + n.x * 0.3),
  basalt: (_y: number, n: THREE.Vector3) => (n.y > 0.62 ? mix('#5a5450', '#6e6660', n.y) : n.y < -0.3 ? col('#2a2626') : mix('#3e3a38', '#524c48', 0.5 + n.x * 0.3)),
};

export function rockGeometry(variant: number, palette: 'pnw' | 'sandstone' | 'basalt' = 'pnw'): THREE.BufferGeometry {
  const b = new GeoBuilder(100 + variant);
  const src = variant === 2 ? new DodecahedronGeometry(1, 1) : new IcosahedronGeometry(1, 1);
  const sx = [1.0, 1.25, 0.9][variant];
  const sz = [1.0, 0.8, 1.1][variant];
  b.add(src, {
    warp: (v) => {
      const k = 1 + (hash2(Math.round(v.x * 100), Math.round(v.z * 100) + Math.round(v.y * 100) * 3, variant) - 0.5) * 0.42;
      v.multiplyScalar(k);
      v.x *= sx;
      v.z *= sz;
      if (v.y < -0.35) v.y = -0.35;
    },
    color: palette === 'pnw'
      ? (_x, _y, _z, n) => (n.y > 0.62 ? mix('#5f7d45', '#7a9651', n.y) : n.y < -0.3 ? col('#5b5f63') : mix('#7d8287', '#9a9fa3', 0.5 + n.x * 0.3))
      : (_x, y, _z, n) => DESERT_ROCK[palette](y, n),
    vary: 0.07,
  });
  return b.build();
}

/** `weathered` is a sun-bleached juniper snag instead of a mossy PNW log. */
export function fallenLogGeometry(weathered = false): THREE.BufferGeometry {
  const b = new GeoBuilder(211);
  const bark = weathered ? '#9a8a78' : '#5a4332';
  b.add(new CylinderGeometry(1, 1, 1, 9, 3), {
    matrix: tf(0, 0, 0, 0, 0, Math.PI / 2),
    jitter: 0.05,
    color: weathered
      ? (x, _y, _z, n) => (Math.abs(n.x) > 0.9 ? col('#d9c7a8') : Math.sin(x * 13) > 0.5 ? col('#b3a590') : col(bark))
      : (x, _y, _z, n) => (Math.abs(n.x) > 0.9 ? col('#c19b6c') : n.y > 0.55 && Math.sin(x * 9) > -0.3 ? col('#5d7c3f') : col(bark)),
  });
  b.add(new CylinderGeometry(0.1, 0.18, 0.7, 5), { matrix: tf(0.18, 0.9, 0.3, 0.5, 0, 0.4), color: bark });
  return b.build();
}

export interface ResourceModel {
  main: THREE.BufferGeometry;
  /** Optional detachable part hidden when depleted (berries). */
  extra?: THREE.BufferGeometry;
  doubleSided?: boolean;
}

export function resourceGeometry(kind: ResourceKind): ResourceModel {
  const rng = new Rng(kind.length * 1013);
  const b = new GeoBuilder(kind.length * 7);
  switch (kind) {
    case 'stickPile': {
      for (let i = 0; i < 6; i++) {
        const a = rng.range(0, Math.PI);
        const len = rng.range(0.6, 1.05);
        const x = rng.range(-0.2, 0.2);
        const z = rng.range(-0.2, 0.2);
        const y = 0.04 + i * 0.03;
        b.add(new CylinderGeometry(0.03, 0.04, 1, 5), { matrix: between(x - Math.cos(a) * len / 2, y, z - Math.sin(a) * len / 2, x + Math.cos(a) * len / 2, y + rng.range(-0.02, 0.05), z + Math.sin(a) * len / 2), color: rng.pick(['#7a5534', '#8e6a44', '#6b4a2e']) });
      }
      b.add(new CylinderGeometry(0.02, 0.025, 0.25, 4), { matrix: tf(0.1, 0.12, 0.05, 0.6, 0.3, 0.8), color: '#7a5534' });
      return { main: b.build() };
    }
    case 'stonePile': {
      for (let i = 0; i < 5; i++) {
        const r = rng.range(0.1, 0.19);
        b.add(new IcosahedronGeometry(r, 0), { matrix: tf(rng.range(-0.22, 0.22), r * 0.45, rng.range(-0.22, 0.22), rng.range(0, 3), rng.range(0, 3), 0, 1, 0.65, 1), color: rng.pick(['#a3a8ac', '#8a8f94', '#b3aea4']), vary: 0.08 });
      }
      return { main: b.build() };
    }
    case 'berryBush': {
      const blobs: [number, number, number, number][] = [[0, 0.55, 0, 0.55], [0.35, 0.4, 0.2, 0.42], [-0.3, 0.42, -0.2, 0.44], [0.1, 0.35, -0.38, 0.38], [-0.15, 0.78, 0.15, 0.36]];
      for (const [x, y, z, r] of blobs) b.add(new IcosahedronGeometry(r, 1), { matrix: tf(x, y, z, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.85, 1), color: foliage('#355f2c', '#5f8f40', '#28451f'), jitter: 0.12, sway: (yy) => yy * 0.05 });
      const berries = new GeoBuilder(3);
      for (let i = 0; i < 16; i++) {
        const a = rng.range(0, Math.PI * 2);
        const y = rng.range(0.35, 0.95);
        const r = 0.5 * Math.sin(Math.acos(clamp((y - 0.5) / 0.6, -1, 1))) + 0.08;
        berries.add(new OctahedronGeometry(0.055, 0), { matrix: tf(Math.cos(a) * r, y, Math.sin(a) * r, a, a), color: rng.pick(['#f08a3c', '#e8683a', '#f5a04a']), vary: 0.05, sway: y * 0.05 });
      }
      return { main: b.build(true), extra: berries.build(true) };
    }
    case 'fern': {
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
        frond(b, a, rng.range(0.75, 1.05), rng.range(0.45, 0.7), 0.1, '#2f5f2c', '#5f9a45', 0.12);
      }
      return { main: b.build(true), doubleSided: true };
    }
    case 'mushroom': {
      for (let i = 0; i < 4; i++) {
        const x = rng.range(-0.15, 0.15);
        const z = rng.range(-0.15, 0.15);
        const s = rng.range(0.7, 1.2);
        b.add(new CylinderGeometry(0.022 * s, 0.03 * s, 0.09 * s, 6), { matrix: tf(x, 0.045 * s, z), color: '#e9b85a' });
        b.add(new ConeGeometry(0.075 * s, 0.07 * s, 8, 1), {
          matrix: tf(x, 0.1 * s, z, Math.PI + rng.range(-0.2, 0.2), rng.range(0, 3), rng.range(-0.2, 0.2)),
          color: (_x, _y, _z, n) => (n.y > 0.3 ? col('#f5bb3f') : col('#e0982a')),
          jitter: 0.01,
        });
      }
      return { main: b.build() };
    }
    case 'onion': {
      blades(b, rng, 7, [0.25, 0.4], 0.012, '#4f7f3a', '#86b35a', 0.05);
      for (let i = 0; i < 3; i++) {
        const a = rng.range(0, Math.PI * 2);
        const h = rng.range(0.38, 0.5);
        const tx = Math.cos(a) * 0.1;
        const tz = Math.sin(a) * 0.1;
        b.add(new CylinderGeometry(0.007, 0.009, 1, 4), { matrix: between(0, 0, 0, tx, h, tz), color: '#6f9a4a', sway: 0.04 });
        b.add(new IcosahedronGeometry(0.045, 0), { matrix: tf(tx * 1.3, h - 0.04, tz * 1.3), color: rng.pick(['#e2b4e8', '#d69ce0', '#efd0f2']), sway: 0.05 });
      }
      return { main: b.build(true), doubleSided: true };
    }
    default:
      return desertResourceGeometry(kind);
  }
}

export function grassGeometry(variant: number): THREE.BufferGeometry {
  const rng = new Rng(900 + variant);
  const b = new GeoBuilder(900 + variant);
  const palettes: [string, string][] = [['#5f8a3c', '#9dbb5b'], ['#557f38', '#8fb052'], ['#6b8f3f', '#b5c46a']];
  const [d, l] = palettes[variant % palettes.length];
  blades(b, rng, 7, [0.28, 0.55], 0.035, d, l, 0.16);
  return b.build(true);
}

export function flowerGeometry(variant: number): THREE.BufferGeometry {
  const rng = new Rng(700 + variant);
  const b = new GeoBuilder(700 + variant);
  const colors = ['#7d72d6', '#d6569a', '#f2d04b', '#f4f1ea'];
  const c = colors[variant % colors.length];
  blades(b, rng, 4, [0.18, 0.3], 0.02, '#4f7a38', '#7fa650', 0.08);
  for (let i = 0; i < 3; i++) {
    const x = rng.range(-0.12, 0.12);
    const z = rng.range(-0.12, 0.12);
    const h = rng.range(0.35, 0.6);
    b.add(new CylinderGeometry(0.008, 0.01, 1, 4), { matrix: between(0, 0, 0, x, h, z), color: '#5a8540', sway: 0.06 });
    if (variant % 4 <= 1) {
      for (let k = 0; k < 4; k++) b.add(new OctahedronGeometry(0.035 - k * 0.006, 0), { matrix: tf(x, h - 0.12 + k * 0.05, z), color: mix(c, '#ffffff', k * 0.1), sway: 0.07 });
    } else {
      b.add(new CylinderGeometry(0.06, 0.04, 0.02, 7), { matrix: tf(x, h, z), color: c, sway: 0.07 });
      b.add(new CylinderGeometry(0.02, 0.02, 0.025, 6), { matrix: tf(x, h + 0.01, z), color: '#e39b2a', sway: 0.07 });
    }
  }
  return b.build(true);
}

export function cloudGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const b = new GeoBuilder(seed);
  const n = rng.int(4, 7);
  for (let i = 0; i < n; i++) {
    const r = rng.range(5, 9);
    b.add(new IcosahedronGeometry(r, 1), {
      matrix: tf((i - n / 2) * rng.range(5, 7), rng.range(-1, 2), rng.range(-4, 4), 0, rng.range(0, 3), 0, 1, 0.6, 1),
      color: (_x, _y, _z, n2) => (n2.y < -0.2 ? col('#c9d2dc') : col('#ffffff')),
      jitter: 0.8, vary: 0.04,
    });
  }
  return b.build();
}
