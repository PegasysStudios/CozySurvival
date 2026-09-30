import * as THREE from 'three';
import { clamp, lerp } from '../core/math';
import { Rng } from '../core/rng';
import { col, GeoBuilder, mix, tf } from './geo';

const { ConeGeometry } = THREE;

type N = THREE.Vector3;

export const foliage = (dark: string, light: string, underside: string) => (_x: number, _y: number, _z: number, n: N) =>
  n.y < -0.2 ? col(underside) : mix(dark, light, 0.25 + 0.6 * Math.max(0, n.y) + 0.15 * Math.abs(n.x));

/** Droop the rim of a cone so branch tiers read as layered boughs with a shadowed underside. */
export const droop = (amount: number, h: number, r: number) => (v: N) => {
  const radial = Math.hypot(v.x, v.z) / r;
  if (v.y < -h / 2 + 0.01) v.y -= amount * radial;
  else v.y -= amount * 0.35 * radial * radial;
};

export function coniferTiers(
  b: GeoBuilder,
  o: { tiers: number; y0: number; y1: number; r0: number; r1: number; h0: number; h1: number; droop: number; dark: string; light: string; under: string; seed: number; lean?: number },
  lod: number,
): void {
  const rng = new Rng(o.seed);
  for (let i = 0; i < o.tiers; i++) {
    const t = i / (o.tiers - 1);
    const r = lerp(o.r0, o.r1, Math.pow(t, 0.9)) * rng.range(0.92, 1.08);
    const h = lerp(o.h0, o.h1, t);
    const y = lerp(o.y0, o.y1, t);
    const lean = (o.lean ?? 0) * t;
    b.add(new ConeGeometry(r, h, lod ? 7 : 9, lod ? 1 : 2), {
      matrix: tf(lean * 0.6, y + h / 2, lean * 0.2, 0, rng.range(0, Math.PI * 2), 0),
      color: foliage(o.dark, o.light, o.under),
      jitter: 0.12 + r * 0.06,
      vary: 0.09,
      warp: droop(o.droop * r * 0.35, h, r),
      sway: (yy) => clamp((yy - 2) / 12, 0, 1) * 0.14,
    });
  }
}

export function roots(b: GeoBuilder, color: string, r: number, n: number, seed: number): void {
  const rng = new Rng(seed);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    b.add(new ConeGeometry(r * 0.45, r * 2.2, 5), {
      matrix: tf(Math.cos(a) * r * 0.75, 0.15, Math.sin(a) * r * 0.75, Math.PI / 2 - 0.35, -a + Math.PI / 2, 0),
      color,
      vary: 0.1,
    });
  }
}

export function frond(b: GeoBuilder, angle: number, len: number, lift: number, w: number, dark: string, light: string, sway: number): void {
  const segs = 5;
  const pos: number[] = [];
  const pt = (t: number, side: number): [number, number, number] => {
    const along = len * t;
    const y = lift * Math.sin(t * Math.PI * 0.75) - t * t * lift * 0.45;
    const half = w * (1 - t * 0.85) * side;
    const cx = Math.cos(angle) * along - Math.sin(angle) * half;
    const cz = Math.sin(angle) * along + Math.cos(angle) * half;
    return [cx, y + Math.abs(side) * w * 0.25 * (1 - t), cz];
  };
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const a = pt(t0, 0), l0 = pt(t0, -1), r0 = pt(t0, 1), a1 = pt(t1, 0), l1 = pt(t1, -1), r1 = pt(t1, 1);
    pos.push(...a, ...l0, ...a1, ...l0, ...l1, ...a1, ...a, ...a1, ...r0, ...r0, ...a1, ...r1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  b.add(g, { color: (x, _y, z) => mix(dark, light, Math.hypot(x, z) / len), vary: 0.1, sway: (y) => sway * (0.3 + y) });
  g.dispose();
}

export function blades(b: GeoBuilder, rng: Rng, n: number, h: [number, number], w: number, dark: string, light: string, spread = 0.12): void {
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const hh = rng.range(h[0], h[1]);
    const lean = rng.range(0.1, 0.45);
    const bx = Math.cos(a) * rng.range(0, spread);
    const bz = Math.sin(a) * rng.range(0, spread);
    const tx = bx + Math.cos(a) * lean * hh;
    const tz = bz + Math.sin(a) * lean * hh;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, hh, tz], 3));
    b.add(g, { color: (_x, y) => mix(dark, light, y * 2.2), vary: 0.12, sway: (y) => y * 0.35 });
    g.dispose();
  }
}
