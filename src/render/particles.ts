import * as THREE from 'three';

const vertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
  }
`;

const fragment = /* glsl */ `
  uniform float uSoft;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = mix(1.0 - step(0.42, d), smoothstep(0.5, 0.0, d), uSoft) * vAlpha;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }
`;

export interface EmitOpts {
  vx?: number;
  vy?: number;
  vz?: number;
  spread?: number;
  size?: number;
  life?: number;
  gravity?: number;
  drag?: number;
  grow?: number;
  alpha?: number;
}

/** Fixed-capacity CPU particle pool rendered as round point sprites. No allocations after construction. */
export class Particles {
  readonly points: THREE.Points;
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly grow: Float32Array;
  private readonly baseAlpha: Float32Array;
  private readonly baseSize: Float32Array;
  private cursor = 0;
  private readonly mat: THREE.ShaderMaterial;

  constructor(capacity: number, additive: boolean, soft = true) {
    this.n = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.baseAlpha = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 }, uSoft: { value: soft ? 1 : 0.35 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(x: number, y: number, z: number, r: number, g: number, b: number, o: EmitOpts): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const s = o.spread ?? 0;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = (o.vx ?? 0) + (Math.random() - 0.5) * 2 * s;
    this.vel[i * 3 + 1] = (o.vy ?? 0) + (Math.random() - 0.5) * 2 * s;
    this.vel[i * 3 + 2] = (o.vz ?? 0) + (Math.random() - 0.5) * 2 * s;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
    const life = o.life ?? 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.grow[i] = o.grow ?? 0;
    this.baseAlpha[i] = o.alpha ?? 1;
    this.baseSize[i] = o.size ?? 0.1;
    this.size[i] = this.baseSize[i];
    this.alpha[i] = this.baseAlpha[i];
  }

  update(dt: number): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      this.life[i] -= dt;
      const k = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] *= d;
      this.vel[j + 1] = this.vel[j + 1] * d - this.grav[i] * dt;
      this.vel[j + 2] *= d;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * k);
      const fadeIn = Math.min(1, k * 8);
      this.alpha[i] = this.baseAlpha[i] * fadeIn * (1 - k * k);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

const tmpC = new THREE.Color();

/** Named effects on top of the two pools (soft = normal blending, glow = additive). */
export class Effects {
  readonly soft = new Particles(1400, false);
  readonly glow = new Particles(700, true);
  readonly chunky = new Particles(500, false, false);
  readonly group = new THREE.Group();

  constructor() {
    this.group.add(this.soft.points, this.glow.points, this.chunky.points);
  }

  setViewport(h: number, fov: number): void {
    this.soft.setViewport(h, fov);
    this.glow.setViewport(h, fov);
    this.chunky.setViewport(h, fov);
  }

  private c(hex: string): THREE.Color {
    return tmpC.set(hex);
  }

  chips(x: number, y: number, z: number, hex = '#c9a06a', count = 10): void {
    const c = this.c(hex);
    for (let i = 0; i < count; i++) {
      this.chunky.emit(x, y, z, c.r * (0.8 + Math.random() * 0.4), c.g, c.b, { vy: 2.8, spread: 2.2, size: 0.07, life: 0.9, gravity: 9.8, drag: 1.2 });
    }
  }

  leaves(x: number, y: number, z: number, hex = '#4f7a3c', count = 18, spread = 2.5): void {
    const c = this.c(hex);
    for (let i = 0; i < count; i++) {
      this.chunky.emit(x + (Math.random() - 0.5) * spread, y + Math.random() * 1.5, z + (Math.random() - 0.5) * spread, c.r, c.g * (0.85 + Math.random() * 0.3), c.b, {
        vy: 0.6, spread: 1.4, size: 0.09, life: 2.2 + Math.random(), gravity: 1.1, drag: 1.8,
      });
    }
  }

  dust(x: number, y: number, z: number, count = 16, spread = 1.6, hex = '#bfae8c'): void {
    const c = this.c(hex);
    for (let i = 0; i < count; i++) {
      this.soft.emit(x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread, c.r, c.g, c.b, { vy: 0.7, spread: 0.9, size: 0.45, life: 1.4, drag: 1.5, grow: 1.6, alpha: 0.45 });
    }
  }

  pop(x: number, y: number, z: number, hex: string, count = 8): void {
    const c = this.c(hex);
    for (let i = 0; i < count; i++) {
      this.chunky.emit(x, y, z, c.r, c.g, c.b, { vy: 2.2, spread: 1.3, size: 0.06, life: 0.6, gravity: 6, drag: 1 });
    }
    for (let i = 0; i < 4; i++) this.glow.emit(x, y + 0.1, z, 1, 0.95, 0.8, { vy: 1.2, spread: 0.6, size: 0.08, life: 0.5, drag: 2, alpha: 0.6 });
  }

  splash(x: number, y: number, z: number, count = 14): void {
    for (let i = 0; i < count; i++) {
      this.soft.emit(x, y + 0.05, z, 0.85, 0.93, 1, { vy: 2.4, spread: 1.2, size: 0.12, life: 0.7, gravity: 8, drag: 0.6, alpha: 0.8 });
    }
  }

  fur(x: number, y: number, z: number, hex: string, count = 10): void {
    const c = this.c(hex);
    for (let i = 0; i < count; i++) this.soft.emit(x, y, z, c.r, c.g, c.b, { vy: 0.8, spread: 1.2, size: 0.14, life: 1, gravity: 0.8, drag: 2, alpha: 0.8 });
  }

  fire(x: number, y: number, z: number, strength: number): void {
    if (Math.random() < 0.55 * strength) {
      this.glow.emit(x + (Math.random() - 0.5) * 0.4, y + 0.4, z + (Math.random() - 0.5) * 0.4, 1, 0.55 + Math.random() * 0.3, 0.2, { vy: 1.6, spread: 0.35, size: 0.05, life: 1.2 + Math.random(), drag: 0.4, alpha: 0.9 });
    }
    if (Math.random() < 0.35 * strength) {
      this.soft.emit(x + (Math.random() - 0.5) * 0.3, y + 1.0, z + (Math.random() - 0.5) * 0.3, 0.52, 0.5, 0.48, { vy: 1.0, vx: 0.2, spread: 0.2, size: 0.4, life: 3.2, drag: 0.2, grow: 3.2, alpha: 0.22 });
    }
  }

  torch(x: number, y: number, z: number): void {
    if (Math.random() < 0.5) this.glow.emit(x, y, z, 1, 0.6, 0.25, { vy: 0.9, spread: 0.12, size: 0.03, life: 0.6, alpha: 0.9 });
  }

  /** Spray drifting up from where a waterfall lands. */
  mist(x: number, y: number, z: number, spread = 3): void {
    this.soft.emit(x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread, 0.92, 0.96, 1, { vy: 0.9, spread: 0.7, size: 0.9, life: 2.4, drag: 0.8, grow: 2.2, alpha: 0.2 });
  }

  firefly(x: number, y: number, z: number): void {
    this.glow.emit(x, y, z, 0.75, 1, 0.45, { spread: 0.25, size: 0.09, life: 4 + Math.random() * 3, drag: 0.05, alpha: 0.85 });
  }

  update(dt: number): void {
    this.soft.update(dt);
    this.glow.update(dt);
    this.chunky.update(dt);
  }

  dispose(): void {
    this.soft.dispose();
    this.glow.dispose();
    this.chunky.dispose();
  }
}
