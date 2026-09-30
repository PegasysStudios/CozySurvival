import * as THREE from 'three';
import { Rng } from '../core/rng';
import { ITEMS, type ItemId, type ToolId } from '../data/items';
import type { PrefabId } from '../data/prefabs';
import { between, col, GeoBuilder, mix, tf } from './geo';

const { CylinderGeometry, ConeGeometry, IcosahedronGeometry, OctahedronGeometry, BoxGeometry, DodecahedronGeometry } = THREE;

const WOOD = '#6e4a30';
const WOOD_LIGHT = '#9a7048';

function logPiece(b: GeoBuilder, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, color = WOOD): void {
  b.add(new CylinderGeometry(r, r * 1.05, 1, 7), {
    matrix: between(ax, ay, az, bx, by, bz),
    color: (_x, _y, _z, n) => (Math.abs(n.y) > 0.95 && r > 0.05 ? col('#c49a68') : col(color)),
    jitter: r * 0.12,
  });
}

function stone(b: GeoBuilder, rng: Rng, x: number, y: number, z: number, r: number): void {
  b.add(new IcosahedronGeometry(r, 0), {
    matrix: tf(x, y, z, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.7, 1),
    color: rng.pick(['#8e9398', '#a2a6a9', '#7c8186']),
    vary: 0.08,
  });
}

export function campfireGeometry(): THREE.BufferGeometry {
  const rng = new Rng(55);
  const b = new GeoBuilder(55);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    stone(b, rng, Math.cos(a) * 0.62, 0.08, Math.sin(a) * 0.62, rng.range(0.14, 0.19));
  }
  b.add(new CylinderGeometry(0.52, 0.55, 0.04, 10), { matrix: tf(0, 0.02, 0), color: (_x, _y, _z, n) => (n.y > 0.5 ? col('#3a332e') : col('#2b2623')) });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    logPiece(b, Math.cos(a) * 0.42, 0.05, Math.sin(a) * 0.42, Math.cos(a) * 0.05, 0.55, Math.sin(a) * 0.05, 0.05, i % 2 ? '#5a3a26' : '#3f2a1e');
  }
  for (let i = 0; i < 6; i++) b.add(new OctahedronGeometry(0.06, 0), { matrix: tf(rng.range(-0.2, 0.2), 0.06, rng.range(-0.2, 0.2)), color: '#d9602a', vary: 0.2 });
  return b.build();
}

export function flameGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder(56);
  b.add(new ConeGeometry(0.28, 0.9, 7, 2), { matrix: tf(0, 0.45, 0), color: '#ffb347', jitter: 0.06, vary: 0.1 });
  b.add(new ConeGeometry(0.16, 0.7, 6, 1), { matrix: tf(0.08, 0.5, -0.05, 0, 0.5, 0.15), color: '#ffe08a', jitter: 0.04 });
  b.add(new ConeGeometry(0.14, 0.55, 6, 1), { matrix: tf(-0.1, 0.35, 0.06, 0, 1.3, -0.2), color: '#ff7a2e', jitter: 0.04 });
  return b.build();
}

export function leanToGeometry(): THREE.BufferGeometry {
  const rng = new Rng(77);
  const b = new GeoBuilder(77);
  // forked front posts and ridge pole (open side faces local +Z)
  for (const s of [-1, 1]) {
    logPiece(b, s * 1.45, 0, 0.9, s * 1.4, 1.95, 0.95, 0.07);
    logPiece(b, s * 1.4, 1.7, 0.95, s * 1.55, 2.05, 0.95, 0.03);
  }
  logPiece(b, -1.75, 1.88, 0.95, 1.75, 1.9, 0.95, 0.075, WOOD_LIGHT);
  // slanted rafters down to the back
  for (let i = 0; i < 8; i++) {
    const x = -1.4 + (i / 7) * 2.8 + rng.range(-0.06, 0.06);
    logPiece(b, x, 1.95, 1.05, x + rng.range(-0.1, 0.1), 0.02, -1.25, 0.055, i % 2 ? WOOD : '#5e3f29');
  }
  // fir-bough thatch layered over the rafters
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i < 6; i++) {
      const t = (row + 0.5) / 5;
      const x = -1.35 + (i / 5) * 2.7 + rng.range(-0.1, 0.1);
      const y = 1.95 - t * 1.9 + 0.12;
      const z = 1.0 - t * 2.25;
      b.add(new ConeGeometry(0.42, 0.9, 6), {
        matrix: tf(x, y, z, -0.75 - Math.PI / 2 + 0.2, rng.range(-0.3, 0.3), rng.range(-0.3, 0.3), 1, 1, 0.35),
        color: (_x, _y, _z, n) => mix('#28472d', '#4c7a42', 0.4 + n.y * 0.5),
        jitter: 0.08,
      });
    }
  }
  // side panels (branches) and fern bedding
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) logPiece(b, s * 1.6, 0.02, 0.8 - i * 0.7, s * 1.5, 1.7 - i * 0.55, 0.9 - i * 0.7, 0.035, '#5e3f29');
  }
  for (let i = 0; i < 9; i++) {
    b.add(new ConeGeometry(0.35, 0.9, 5), {
      matrix: tf(rng.range(-1.1, 1.1), 0.05, rng.range(-0.6, 0.6), Math.PI / 2, rng.range(0, 6), 0, 1, 1, 0.2),
      color: '#5d8a44',
      vary: 0.12,
    });
  }
  return b.build();
}

/** A ridge pole on two crossed pairs of poles, fir-bough thatch down both sides; open at the front (local +Z). */
export function aFrameGeometry(): THREE.BufferGeometry {
  const rng = new Rng(81);
  const b = new GeoBuilder(81);
  const ridgeY = 2.05;
  for (const z of [1.15, -1.15]) {
    for (const s of [-1, 1]) logPiece(b, s * 1.45, 0, z, -s * 0.18, ridgeY + 0.2, z, 0.065);
  }
  logPiece(b, 0, ridgeY, 1.35, 0, ridgeY, -1.35, 0.075, WOOD_LIGHT);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const z = 1.0 - (i / 5) * 2.0 + rng.range(-0.05, 0.05);
      logPiece(b, s * 0.05, ridgeY, z, s * 1.5, 0.02, z + rng.range(-0.08, 0.08), 0.045, i % 2 ? WOOD : '#5e3f29');
    }
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 5; i++) {
        const t = (row + 0.5) / 4;
        const z = -1.05 + (i / 4) * 2.1 + rng.range(-0.08, 0.08);
        b.add(new ConeGeometry(0.4, 0.85, 6), {
          matrix: tf(s * (0.12 + t * 1.3), ridgeY - t * 1.95 + 0.14, z, 0, 0, s * (0.95 - Math.PI / 2) + rng.range(-0.2, 0.2), 1, 1, 0.35),
          color: (_x, _y, _z, n) => mix('#28472d', '#4c7a42', 0.4 + n.y * 0.5),
          jitter: 0.08,
        });
      }
    }
  }
  // branches woven across the back end
  for (let i = 0; i < 5; i++) {
    const y = 0.2 + i * 0.36;
    const w = 1.35 * (1 - y / (ridgeY + 0.1));
    logPiece(b, -w, y, -1.2, w, y + rng.range(-0.05, 0.05), -1.2, 0.035, '#5e3f29');
  }
  for (let i = 0; i < 7; i++) {
    b.add(new ConeGeometry(0.33, 0.85, 5), {
      matrix: tf(rng.range(-0.8, 0.8), 0.05, rng.range(-0.8, 0.7), Math.PI / 2, rng.range(0, 6), 0, 1, 1, 0.2),
      color: '#5d8a44',
      vary: 0.12,
    });
  }
  return b.build();
}

/** Low stacked-log walls under a pitched roof shingled with birch bark; doorway at the front (local +Z). */
export function barkHutGeometry(): THREE.BufferGeometry {
  const rng = new Rng(84);
  const b = new GeoBuilder(84);
  const hw = 1.45;
  const hd = 1.15;
  const courses = 4;
  for (let c = 0; c < courses; c++) {
    const y = 0.12 + c * 0.22;
    const tint = c % 2 ? WOOD : '#7a5236';
    logPiece(b, -hw - 0.1, y, -hd, hw + 0.1, y, -hd, 0.11, tint);
    for (const s of [-1, 1]) logPiece(b, s * hw, y + 0.11, -hd - 0.1, s * hw, y + 0.11, hd + 0.1, 0.11, tint);
    for (const s of [-1, 1]) logPiece(b, s * (hw + 0.1), y, hd, s * 0.45, y, hd, 0.11, tint);
  }
  const wallTop = 0.12 + courses * 0.22;
  for (const s of [-1, 1]) logPiece(b, s * 0.42, 0, hd + 0.05, s * 0.42, wallTop + 0.5, hd + 0.05, 0.06, WOOD_LIGHT);
  // gables and ridge
  const ridgeY = wallTop + 1.05;
  for (const z of [hd + 0.12, -hd - 0.12]) {
    for (const s of [-1, 1]) logPiece(b, s * (hw + 0.25), wallTop - 0.05, z, 0, ridgeY + 0.08, z, 0.06);
  }
  logPiece(b, 0, ridgeY, hd + 0.35, 0, ridgeY, -hd - 0.35, 0.07, WOOD_LIGHT);
  // bark shingles, overlapping rows on both roof slopes
  const slope = Math.atan2(ridgeY - wallTop, hw + 0.3);
  for (const s of [-1, 1]) {
    for (let row = 0; row < 4; row++) {
      const t = (row + 0.5) / 4;
      for (let i = 0; i < 6; i++) {
        const z = -hd - 0.2 + (i / 5) * (2 * hd + 0.4) + rng.range(-0.04, 0.04);
        const bark = mix('#e8dfd0', '#d8cdb8', rng.next() * 0.6);
        b.add(new BoxGeometry(0.62, 0.05, 0.46), {
          matrix: tf(s * (hw + 0.3) * (1 - t), wallTop + (ridgeY - wallTop) * t + 0.06, z, 0, 0, -s * slope, 1, 1, 1),
          color: (x, _y, zz) => (Math.abs(Math.sin(x * 9 + zz * 7)) > 0.93 ? col('#3b342e') : bark),
          vary: 0.05,
        });
      }
    }
  }
  b.add(new BoxGeometry(0.8, 1.05, 0.04), { matrix: tf(0, wallTop / 2 + 0.05, hd - 0.12), color: '#3a2a1f' });
  for (let i = 0; i < 6; i++) stone(b, rng, rng.range(-1.3, 1.3), 0.05, hd + 0.35 + rng.range(0, 0.2), 0.1);
  return b.build();
}

export function hideTentGeometry(): THREE.BufferGeometry {
  const rng = new Rng(88);
  const b = new GeoBuilder(88);
  const sides = 9;
  b.add(new ConeGeometry(1.55, 2.6, sides, 3, true), {
    matrix: tf(0, 1.3, 0, 0, Math.PI / sides),
    color: (x, y, z) => {
      const a = Math.atan2(x, z);
      const door = Math.abs(a) < 0.35 && y < 1.2;
      if (door) return col('#3a2a1f');
      const panel = Math.floor(((a + Math.PI) / (Math.PI * 2)) * sides);
      return mix('#b88a5a', '#d2a878', (panel % 3) / 3 + (y > 2.1 ? 0.3 : 0));
    },
    jitter: 0.04,
    vary: 0.05,
  });
  b.add(new ConeGeometry(1.5, 2.5, sides, 1, true), { matrix: tf(0, 1.27, 0, Math.PI, Math.PI / sides, 0, 1, -1, 1), color: '#6d5238' });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.2;
    logPiece(b, Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5, -Math.cos(a) * 0.25, 3.25, -Math.sin(a) * 0.25, 0.035, WOOD_LIGHT);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    stone(b, rng, Math.cos(a) * 1.62, 0.06, Math.sin(a) * 1.62, 0.13);
  }
  b.add(new BoxGeometry(0.5, 0.02, 0.4), { matrix: tf(0, 1.9, 1.02, -0.55, 0, 0), color: '#8a6038' });
  return b.build();
}

export function benchGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder(99);
  b.add(new CylinderGeometry(0.28, 0.28, 2.1, 9, 1, false, 0, Math.PI), {
    matrix: tf(0, 0.42, 0, 0, 0, Math.PI / 2),
    color: (_x, _y, _z, n) => (n.y > 0.9 ? col('#c9a172') : Math.abs(n.x) > 0.9 ? col('#b58b5c') : col('#5a3e2a')),
    jitter: 0.02,
  });
  b.add(new BoxGeometry(2.1, 0.02, 0.56), { matrix: tf(0, 0.42, 0), color: '#c9a172' });
  for (const s of [-1, 1]) {
    b.add(new CylinderGeometry(0.22, 0.26, 0.42, 8), { matrix: tf(s * 0.75, 0.21, 0), color: (_x, _y, _z, n) => (n.y > 0.9 ? col('#d2b48a') : col('#5e4330')) });
  }
  return b.build();
}

/** A split-log bench on stumps with an anvil stone, a grindstone on its axle and a mallet: the work side faces +Z. */
export function workbenchGeometry(): THREE.BufferGeometry {
  const rng = new Rng(101);
  const b = new GeoBuilder(101);
  b.add(new BoxGeometry(1.6, 0.12, 0.72), {
    matrix: tf(0, 0.8, 0),
    color: (_x, _y, _z, n) => (n.y > 0.9 ? col('#c9a172') : Math.abs(n.x) > 0.9 ? col('#b58b5c') : col('#8a6440')),
    jitter: 0.012,
  });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) logPiece(b, sx * 0.64, 0, sz * 0.24, sx * 0.6, 0.76, sz * 0.22, 0.065, '#5e4330');
    logPiece(b, sx * 0.62, 0.28, -0.25, sx * 0.62, 0.28, 0.25, 0.035, WOOD_LIGHT);
  }
  logPiece(b, -0.62, 0.3, 0, 0.62, 0.3, 0, 0.04, WOOD_LIGHT);
  // back rail with a coil of cordage hanging from a peg
  for (const sx of [-1, 1]) logPiece(b, sx * 0.7, 0.8, -0.32, sx * 0.7, 1.28, -0.32, 0.035, WOOD);
  logPiece(b, -0.74, 1.22, -0.32, 0.74, 1.22, -0.32, 0.03, WOOD_LIGHT);
  b.add(new THREE.TorusGeometry(0.09, 0.022, 5, 10), { matrix: tf(-0.3, 1.1, -0.3), color: '#c9b27a' });
  // anvil stone
  b.add(new DodecahedronGeometry(0.15, 0), { matrix: tf(-0.45, 0.93, -0.06, 0.2, 0.5, 0, 1.3, 0.62, 1), color: '#8e9398', vary: 0.06 });
  // grindstone on its axle
  b.add(new CylinderGeometry(0.19, 0.19, 0.07, 12), { matrix: tf(0.5, 1.07, -0.12, 0, 0, Math.PI / 2), color: (_x, _y, _z, n) => (Math.abs(n.x) > 0.9 ? col('#a2a6a9') : col('#7c8186')) });
  for (const dx of [-0.09, 0.09]) logPiece(b, 0.5 + dx, 0.86, -0.12, 0.5 + dx, 1.08, -0.12, 0.025, WOOD);
  logPiece(b, 0.38, 1.07, -0.12, 0.64, 1.07, -0.12, 0.018, '#3f2a1e');
  // a mallet and a spare stone head
  logPiece(b, -0.05, 0.88, 0.2, 0.28, 0.88, 0.12, 0.02, WOOD_LIGHT);
  b.add(new BoxGeometry(0.1, 0.1, 0.16), { matrix: tf(-0.08, 0.91, 0.2, 0, 0.25, 0), color: '#6e4a30' });
  stone(b, rng, 0.08, 0.89, -0.2, 0.06);
  return b.build();
}

/** Tier 1 storage: a lidded basket woven from grass and sticks. */
export function storageBinGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder(102);
  b.add(new CylinderGeometry(0.44, 0.37, 0.62, 12, 4), {
    matrix: tf(0, 0.31, 0),
    color: (x, y, z) => ((Math.floor((Math.atan2(x, z) + Math.PI) * 3) + Math.floor(y * 12)) % 2 ? col('#c9a86a') : col('#a88650')),
    jitter: 0.012,
  });
  b.add(new CylinderGeometry(0.47, 0.47, 0.06, 12), { matrix: tf(0, 0.62, 0), color: '#9a7a44' });
  b.add(new CylinderGeometry(0.43, 0.46, 0.06, 12), { matrix: tf(0.02, 0.67, 0.01, 0.06, 0, -0.05), color: (_x, _y, _z, n) => (n.y > 0.5 ? col('#bf9d5e') : col('#8e7040')) });
  b.add(new IcosahedronGeometry(0.05, 0), { matrix: tf(0.02, 0.73, 0.01), color: '#6e4a30' });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    logPiece(b, Math.cos(a) * 0.38, 0, Math.sin(a) * 0.38, Math.cos(a) * 0.46, 0.64, Math.sin(a) * 0.46, 0.02, WOOD);
  }
  return b.build();
}

/** Tier 2 storage: a crate of split logs with corner posts and a cordage band. */
export function storageCrateGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder(103);
  b.add(new BoxGeometry(1.08, 0.6, 0.78), {
    matrix: tf(0, 0.32, 0),
    color: (_x, y, _z, n) => (Math.abs(n.y) > 0.9 ? col('#8a6440') : Math.floor(y * 6.5) % 2 ? col('#9a7048') : col('#86603c')),
    jitter: 0.01,
  });
  b.add(new BoxGeometry(1.16, 0.08, 0.86), { matrix: tf(0, 0.66, 0), color: (_x, _y, _z, n) => (n.y > 0.9 ? col('#b58b5c') : col('#7a5634')) });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) logPiece(b, sx * 0.54, 0, sz * 0.39, sx * 0.54, 0.7, sz * 0.39, 0.045, '#5e4330');
  b.add(new BoxGeometry(1.11, 0.04, 0.81), { matrix: tf(0, 0.45, 0), color: '#c9b27a' });
  b.add(new BoxGeometry(0.16, 0.06, 0.05), { matrix: tf(0, 0.6, 0.43), color: '#5e4330' });
  return b.build();
}

/** Tier 3 storage: a hide-lined chest with a rounded bark lid, straps and a stone latch. */
export function storageChestGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder(104);
  b.add(new BoxGeometry(1.28, 0.54, 0.88), {
    matrix: tf(0, 0.29, 0),
    color: (_x, y, _z, n) => (Math.abs(n.y) > 0.9 ? col('#6e4a30') : Math.floor(y * 7) % 2 ? col('#8a5a33') : col('#7a4e2c')),
    jitter: 0.01,
  });
  b.add(new CylinderGeometry(0.44, 0.44, 1.3, 10, 1, false, 0, Math.PI), {
    matrix: tf(0, 0.56, 0, 0, 0, Math.PI / 2, 0.55, 1, 1),
    color: (_x, _y, _z, n) => (Math.abs(n.x) > 0.9 ? col('#b58b5c') : col('#d8cdb8')),
    jitter: 0.01,
  });
  for (const x of [-0.38, 0.38]) {
    b.add(new BoxGeometry(0.12, 0.56, 0.9), { matrix: tf(x, 0.29, 0), color: '#c9a06a' });
    b.add(new CylinderGeometry(0.445, 0.445, 0.12, 10, 1, false, 0, Math.PI), { matrix: tf(x, 0.56, 0, 0, 0, Math.PI / 2, 0.57, 1, 1), color: '#c9a06a' });
  }
  b.add(new BoxGeometry(0.14, 0.16, 0.06), { matrix: tf(0, 0.54, 0.46), color: '#8e9398' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(new BoxGeometry(0.12, 0.06, 0.12), { matrix: tf(sx * 0.56, 0.03, sz * 0.36), color: '#5e4330' });
  return b.build();
}

export function structureGeometry(prefab: PrefabId): THREE.BufferGeometry {
  switch (prefab) {
    case 'campfire':
      return campfireGeometry();
    case 'leanTo':
      return leanToGeometry();
    case 'aFrame':
      return aFrameGeometry();
    case 'barkHut':
      return barkHutGeometry();
    case 'hideTent':
      return hideTentGeometry();
    case 'bench':
      return benchGeometry();
    case 'workbench':
      return workbenchGeometry();
    case 'storageBin':
      return storageBinGeometry();
    case 'storageCrate':
      return storageCrateGeometry();
    case 'storageChest':
      return storageChestGeometry();
  }
}

// ------------------------------------------------------------------ first-person tools

function sleeveAndHand(b: GeoBuilder, grip = true): void {
  b.add(new CylinderGeometry(0.052, 0.062, 0.34, 7), { matrix: tf(0, -0.2, 0.12, -0.5, 0, 0), color: (x, y) => ((Math.floor(y * 30) + Math.floor(x * 30)) % 2 ? col('#9b2f2a') : col('#6e1f1d')), vary: 0.04 });
  b.add(new CylinderGeometry(0.055, 0.055, 0.05, 7), { matrix: tf(0, -0.04, 0.03, -0.5, 0, 0), color: '#3a2f2a' });
  b.add(new BoxGeometry(0.085, 0.1, 0.06), { matrix: tf(0, 0.03, -0.01, -0.4, 0, 0), color: '#e0ad8a', vary: 0.03 });
  if (grip) b.add(new BoxGeometry(0.03, 0.05, 0.06), { matrix: tf(-0.05, 0.03, -0.03, 0, 0, 0.5), color: '#d99f7c' });
}

export function toolGeometry(tool: ToolId): THREE.BufferGeometry {
  const b = new GeoBuilder(tool.length * 3);
  switch (tool) {
    case 'hands':
      sleeveAndHand(b, false);
      b.add(new BoxGeometry(0.075, 0.07, 0.04), { matrix: tf(0, 0.1, -0.04, -0.25, 0, 0), color: '#e0ad8a' });
      break;
    case 'axe':
      sleeveAndHand(b);
      b.add(new CylinderGeometry(0.018, 0.022, 0.62, 6), { matrix: tf(0, 0.2, -0.03, 0.05, 0, 0), color: '#8a6440' });
      b.add(new DodecahedronGeometry(0.075, 0), { matrix: tf(0.06, 0.47, -0.04, 0, 0, 0.2, 1.5, 0.9, 0.45), color: '#8c9196', vary: 0.1 });
      b.add(new CylinderGeometry(0.026, 0.026, 0.08, 6), { matrix: tf(0, 0.43, -0.03), color: '#c9b27a' });
      break;
    case 'spear':
      sleeveAndHand(b);
      b.add(new CylinderGeometry(0.016, 0.02, 1.5, 6), { matrix: tf(0, 0.35, -0.2, -0.28, 0, 0), color: '#9a7048' });
      b.add(new OctahedronGeometry(0.06, 0), { matrix: tf(0, 1.08, -0.42, -0.28, 0, 0, 0.6, 1.7, 0.25), color: '#6f757b' });
      b.add(new CylinderGeometry(0.024, 0.024, 0.07, 6), { matrix: tf(0, 0.98, -0.39, -0.28, 0, 0), color: '#c9b27a' });
      break;
    case 'bow': {
      sleeveAndHand(b);
      const segs = 8;
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs - 0.5;
        pts.push([0, 0.04 + t * 0.95, -0.02 - Math.cos(t * Math.PI) * 0.16]);
      }
      for (let i = 0; i < segs; i++) {
        const [ax, ay, az] = pts[i];
        const [bx, by, bz] = pts[i + 1];
        b.add(new CylinderGeometry(0.014, 0.016, 1, 5), { matrix: between(ax, ay, az, bx, by, bz), color: i === 3 || i === 4 ? '#5a3a24' : '#8a5f3a' });
      }
      break;
    }
    case 'rod':
      sleeveAndHand(b);
      b.add(new CylinderGeometry(0.008, 0.022, 1.9, 6), { matrix: tf(0, 0.72, -0.5, -0.55, 0, 0), color: (_x, y) => (y < 0.12 ? col('#c9b27a') : col('#9a7048')) });
      b.add(new CylinderGeometry(0.04, 0.04, 0.035, 8), { matrix: tf(0.035, 0.08, -0.06, 0, 0, Math.PI / 2), color: '#6f757b' });
      b.add(new CylinderGeometry(0.03, 0.03, 0.02, 8), { matrix: tf(0.04, 0.08, -0.06, 0, 0, Math.PI / 2), color: '#e6ddcc' });
      break;
    case 'torch':
      sleeveAndHand(b);
      b.add(new CylinderGeometry(0.02, 0.024, 0.5, 6), { matrix: tf(0, 0.2, -0.02), color: '#7a5534' });
      b.add(new CylinderGeometry(0.045, 0.035, 0.14, 7), { matrix: tf(0, 0.46, -0.02), color: (_x, y) => (y > 0.5 ? col('#2a221c') : col('#e6ddcc')) });
      break;
  }
  return b.build();
}

export function bowStringGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.515, -0.02, 0, 0.04, -0.02, 0, -0.435, -0.02], 3));
  return g;
}

export function arrowGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder(301);
  b.add(new CylinderGeometry(0.008, 0.008, 0.7, 4), { matrix: tf(0, 0, 0, Math.PI / 2, 0, 0), color: '#a57f52' });
  b.add(new OctahedronGeometry(0.025, 0), { matrix: tf(0, 0, 0.37, 0, 0, 0, 0.6, 0.6, 1.8), color: '#6f757b' });
  for (let i = 0; i < 3; i++) b.add(new BoxGeometry(0.002, 0.04, 0.1), { matrix: tf(0, 0, -0.3, 0, 0, (i / 3) * Math.PI * 2), color: '#e9e2d4' });
  return b.build();
}

/** Small ground model for a dropped stack. */
export function dropGeometry(item: ItemId): THREE.BufferGeometry {
  const rng = new Rng(item.length * 17);
  const b = new GeoBuilder(item.length);
  const c = ITEMS[item].color;
  if (item === 'log') {
    logPiece(b, -0.45, 0.16, 0, 0.45, 0.16, 0, 0.15);
  } else if (item === 'stick' || item === 'arrow') {
    for (let i = 0; i < 3; i++) {
      const a = rng.range(0, Math.PI);
      logPiece(b, -Math.cos(a) * 0.3, 0.04 + i * 0.03, -Math.sin(a) * 0.3, Math.cos(a) * 0.3, 0.05 + i * 0.03, Math.sin(a) * 0.3, 0.025, c);
    }
  } else if (item === 'stone') {
    for (let i = 0; i < 3; i++) stone(b, rng, rng.range(-0.12, 0.12), 0.07, rng.range(-0.12, 0.12), 0.1);
  } else {
    b.add(new IcosahedronGeometry(0.17, 0), { matrix: tf(0, 0.14, 0, 0, 0, 0, 1, 0.8, 1), color: '#b99668', vary: 0.1 });
    b.add(new IcosahedronGeometry(0.1, 0), { matrix: tf(0, 0.3, 0), color: c });
    b.add(new CylinderGeometry(0.06, 0.08, 0.05, 6), { matrix: tf(0, 0.25, 0), color: '#8a6d48' });
  }
  return b.build();
}
