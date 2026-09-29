import * as THREE from 'three';
import { hash2 } from '../core/rng';

/**
 * Collects flat-shaded, vertex-colored parts into one non-indexed BufferGeometry.
 * Each part is transformed, optionally jittered (seam-safe: jitter is a function of position),
 * and colored per face with a small brightness variation for the faceted low-poly look.
 */
export class GeoBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly sway: number[] = [];
  private seed = 1;

  constructor(seed = 1) {
    this.seed = seed;
  }

  add(
    src: THREE.BufferGeometry,
    opts: {
      matrix?: THREE.Matrix4;
      color: THREE.ColorRepresentation | ((x: number, y: number, z: number, n: THREE.Vector3) => THREE.Color);
      jitter?: number;
      /** Per-face brightness variation (0..1). */
      vary?: number;
      /** Wind sway weight: constant or derived from local height. */
      sway?: number | ((y: number) => number);
      /** Applied to local positions before the matrix (for droop, bends, noise). */
      warp?: (v: THREE.Vector3) => void;
    },
  ): this {
    const g = src.index ? src.toNonIndexed() : src.clone();
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const jitter = opts.jitter ?? 0;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (opts.warp) opts.warp(v);
      if (jitter > 0) {
        const kx = Math.round(v.x * 1000);
        const ky = Math.round(v.y * 1000);
        const kz = Math.round(v.z * 1000);
        v.x += (hash2(kx + ky * 7, kz, this.seed) - 0.5) * jitter;
        v.y += (hash2(ky + kz * 13, kx, this.seed + 11) - 0.5) * jitter;
        v.z += (hash2(kz + kx * 3, ky, this.seed + 23) - 0.5) * jitter;
      }
      if (opts.matrix) v.applyMatrix4(opts.matrix);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    const base = new THREE.Color();
    const vary = opts.vary ?? 0.08;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let f = 0; f < p.count; f += 3) {
      a.fromBufferAttribute(p, f);
      b.fromBufferAttribute(p, f + 1);
      c.fromBufferAttribute(p, f + 2);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      n.crossVectors(ab, ac).normalize();
      const cx = (a.x + b.x + c.x) / 3;
      const cy = (a.y + b.y + c.y) / 3;
      const cz = (a.z + b.z + c.z) / 3;
      if (typeof opts.color === 'function') base.copy(opts.color(cx, cy, cz, n));
      else base.set(opts.color);
      const k = 1 + (hash2(Math.round(cx * 97) + f, Math.round(cz * 89), this.seed) - 0.5) * 2 * vary;
      for (let j = 0; j < 3; j++) {
        const vi = f + j;
        this.pos.push(p.getX(vi), p.getY(vi), p.getZ(vi));
        this.col.push(base.r * k, base.g * k, base.b * k);
        const s = opts.sway;
        this.sway.push(typeof s === 'function' ? s(p.getY(vi)) : (s ?? 0));
      }
    }
    g.dispose();
    this.seed++;
    return this;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  build(withSway = false): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (withSway) g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const sv = new THREE.Vector3();
const tv = new THREE.Vector3();

/** Compose a transform matrix (returns a fresh Matrix4 for use in builders). */
export function tf(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  e.set(rx, ry, rz, 'YXZ');
  q.setFromEuler(e);
  tv.set(x, y, z);
  sv.set(sx, sy, sz);
  return m4.clone().compose(tv, q, sv);
}

/** A matrix that places a unit-height, Y-up primitive between two points. */
export function between(ax: number, ay: number, az: number, bx: number, by: number, bz: number, radiusScale = 1): THREE.Matrix4 {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = dir.length();
  dir.normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return new THREE.Matrix4().compose(
    new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2),
    quat,
    new THREE.Vector3(radiusScale, len, radiusScale),
  );
}

export function col(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

export function mix(a: string, b: string, t: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, t)));
}

/** Shared wind uniforms; materials patched with `withWind` read these. */
export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
};

/** Adds a gentle vertex sway driven by the `aSway` attribute (instanced or not). */
export function withWind<T extends THREE.Material>(mat: T, key: string): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aSway;\nuniform float uTime;\nuniform float uWind;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float ph = ip.x * 0.21 + ip.z * 0.17;
          float s = aSway * uWind;
          transformed.x += (sin(uTime * 1.35 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25) * s;
          transformed.z += (cos(uTime * 1.1 + ph * 1.3) * 0.45) * s;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'wind-' + key;
  return mat;
}
