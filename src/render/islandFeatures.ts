import * as THREE from 'three';
import { smoothstep } from '../core/math';
import { Rng } from '../core/rng';
import type { Terrain } from '../sim/terrain';
import { batGeometry, caveShellGeometry } from './islandModels';
import type { Effects } from './particles';

const flowVertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const flowFragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uSpeed;
  uniform float uLight;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    vec2 p = vec2(vUv.x * 9.0, vUv.y * 5.0 - uTime * uSpeed);
    float streak = noise(p) * 0.6 + noise(p * 2.3 + 4.1) * 0.4;
    float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
    vec3 col = mix(vec3(0.62, 0.78, 0.84), vec3(0.97, 0.99, 1.0), smoothstep(0.35, 0.8, streak)) * uLight;
    float alpha = edge * (0.55 + 0.4 * streak);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

interface Bat {
  body: THREE.Mesh;
  wings: [THREE.Mesh, THREE.Mesh];
  root: THREE.Group;
  roost: THREE.Vector3;
  phase: number;
  radius: number;
  height: number;
  speed: number;
}

interface CaveView {
  x: number;
  z: number;
  floor: number;
  r: number;
  bats: Bat[];
  /** 0 roosting .. 1 flying, eased. */
  out: number;
  /** Seconds left of flying after being disturbed. */
  flushed: number;
}

/** How close you get to a cave before its bats burst out. */
const FLUSH_DIST = 3;
const FLUSH_SECONDS = 16;

/**
 * The island's set pieces: the waterfall (a falling sheet, the stream spilling over its lip, foam and spray where it
 * lands) and the caves (rock shells over their hollows, each with a roost of fruit bats that stream out at dusk or
 * when you walk in).
 */
export class IslandFeatures {
  readonly group = new THREE.Group();
  private readonly flowMat: THREE.ShaderMaterial;
  private readonly ribbonMat: THREE.ShaderMaterial;
  private readonly foamMat = new THREE.MeshBasicMaterial({ color: '#f4f8f8', transparent: true, opacity: 0.6, depthWrite: false });
  private readonly rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  private readonly batMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly caves: CaveView[] = [];
  private readonly foam: THREE.Mesh;
  private readonly foot = new THREE.Vector3();
  private mistT = 0;

  constructor(t: Terrain) {
    const isl = t.island!;
    const w = isl.waterfall;
    const make = (speed: number) => new THREE.ShaderMaterial({
      vertexShader: flowVertex,
      fragmentShader: flowFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uSpeed: { value: speed }, uLight: { value: 1 } }]),
    });
    this.flowMat = make(1.7);
    this.ribbonMat = make(0.7);

    // The falling sheet leaves the lip and curves out as it drops (the horizontal reach grows with the root of the
    // drop), so it always clears the cliff behind it.
    const acrossX = -w.dirZ;
    const acrossZ = w.dirX;
    const top = w.top - 0.3;
    const reach = Math.hypot(w.footX - w.x, w.footZ - w.z);
    const along = 18;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= along; i++) {
      const s = i / along;
      const d = reach * Math.sqrt(s);
      const y = top * (1 - s);
      const half = w.width * (0.5 + 0.25 * s);
      for (let k = 0; k <= 4; k++) {
        const a = (k / 4 - 0.5) * 2 * half;
        pos.push(w.x + w.dirX * d + acrossX * a, y, w.z + w.dirZ * d + acrossZ * a);
        uv.push(k / 4, s * 3);
      }
    }
    for (let i = 0; i < along; i++) {
      for (let k = 0; k < 4; k++) {
        const a = i * 5 + k;
        idx.push(a, a + 5, a + 1, a + 1, a + 5, a + 6);
      }
    }
    const sheet = new THREE.BufferGeometry();
    sheet.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sheet.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    sheet.setIndex(idx);
    this.geos.push(sheet);
    const fall = new THREE.Mesh(sheet, this.flowMat);
    fall.renderOrder = 3;
    fall.name = 'waterfall';
    this.group.add(fall);

    // The stream running along the notch to the lip.
    const rpos: number[] = [];
    const ruv: number[] = [];
    const ridx: number[] = [];
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const back = 14 * (1 - i / steps);
      const cx = w.x - w.dirX * back;
      const cz = w.z - w.dirZ * back;
      for (let k = 0; k <= 2; k++) {
        const a = (k / 2 - 0.5) * w.width * 0.9;
        const x = cx + acrossX * a;
        const z = cz + acrossZ * a;
        rpos.push(x, t.heightAt(cx, cz) + 0.12, z);
        ruv.push(k / 2, i / steps);
      }
    }
    for (let i = 0; i < steps; i++) {
      for (let k = 0; k < 2; k++) {
        const a = i * 3 + k;
        ridx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    }
    const ribbon = new THREE.BufferGeometry();
    ribbon.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3));
    ribbon.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
    ribbon.setIndex(ridx);
    this.geos.push(ribbon);
    const upper = new THREE.Mesh(ribbon, this.ribbonMat);
    upper.renderOrder = 3;
    this.group.add(upper);

    const foamGeo = new THREE.CircleGeometry(2.6, 20);
    foamGeo.rotateX(-Math.PI / 2);
    this.geos.push(foamGeo);
    this.foam = new THREE.Mesh(foamGeo, this.foamMat);
    this.foot.set(w.footX, 0.05, w.footZ);
    this.foam.position.copy(this.foot);
    this.foam.renderOrder = 3;
    this.group.add(this.foam);

    // Caves and their bats.
    const bat = batGeometry();
    this.geos.push(bat.body, bat.wing);
    isl.caves.forEach((c, i) => {
      const geo = caveShellGeometry(c.r, c.height, 0.55, 3000 + i);
      this.geos.push(geo);
      const shell = new THREE.Mesh(geo, this.rockMat);
      shell.position.set(c.x, c.floorY - 0.15, c.z);
      shell.rotation.y = -c.facing;
      shell.castShadow = true;
      shell.receiveShadow = true;
      shell.name = 'cave';
      this.group.add(shell);
      const rng = new Rng(4000 + i * 17 + t.seed);
      const view: CaveView = { x: c.x, z: c.z, floor: c.floorY, r: c.r, bats: [], out: 0, flushed: 0 };
      for (let k = 0; k < 8; k++) {
        const root = new THREE.Group();
        const body = new THREE.Mesh(bat.body, this.batMat);
        const l = new THREE.Mesh(bat.wing, this.batMat);
        const r = new THREE.Mesh(bat.wing, this.batMat);
        r.scale.x = -1;
        root.add(body, l, r);
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(0, c.r * 0.55);
        const roost = new THREE.Vector3(c.x + Math.cos(a) * d, c.floorY + c.height * 0.82 - d * 0.12, c.z + Math.sin(a) * d);
        root.position.copy(roost);
        this.group.add(root);
        view.bats.push({ body, wings: [l, r], root, roost, phase: rng.range(0, 6), radius: rng.range(c.r + 3, c.r + 11), height: rng.range(3, 7), speed: rng.range(0.9, 1.4) * (rng.chance(0.5) ? 1 : -1) });
      }
      this.caves.push(view);
    });
  }

  update(dt: number, time: number, camX: number, camZ: number, hour: number, night: number, effects: Effects): void {
    this.flowMat.uniforms.uTime.value = time;
    this.ribbonMat.uniforms.uTime.value = time;
    const light = 1 - night * 0.7;
    this.flowMat.uniforms.uLight.value = light;
    this.ribbonMat.uniforms.uLight.value = light;
    this.foamMat.opacity = (0.45 + 0.2 * Math.sin(time * 3.1)) * light;
    this.foam.scale.setScalar(1 + 0.08 * Math.sin(time * 2.3));
    const fd = Math.hypot(this.foot.x - camX, this.foot.z - camZ);
    if (fd < 70) {
      this.mistT -= dt;
      while (this.mistT <= 0) {
        this.mistT += 0.12;
        effects.mist(this.foot.x, 0.3, this.foot.z, 3.5);
      }
    }
    // Fruit bats forage from dusk to dawn, and burst out whenever someone walks into their cave.
    const dusk = hour >= 18.6 || hour < 5.4;
    for (const c of this.caves) {
      const d = Math.hypot(c.x - camX, c.z - camZ);
      if (d < c.r + FLUSH_DIST && c.flushed <= 0) c.flushed = FLUSH_SECONDS;
      c.flushed = Math.max(0, c.flushed - dt);
      const target = dusk || c.flushed > 0 ? 1 : 0;
      c.out += (target - c.out) * Math.min(1, dt * 0.8);
      if (d > 140) continue;
      for (const b of c.bats) {
        b.phase += dt * b.speed * (0.6 + c.out * 0.6);
        const ang = b.phase;
        const fx = c.x + Math.cos(ang) * b.radius;
        const fz = c.z + Math.sin(ang) * b.radius;
        const fy = c.floor + b.height + Math.sin(ang * 3) * 0.8;
        const k = smoothstep(0, 1, c.out);
        b.root.position.set(b.roost.x + (fx - b.roost.x) * k, b.roost.y + (fy - b.roost.y) * k, b.roost.z + (fz - b.roost.z) * k);
        b.root.rotation.set(k > 0.5 ? 0 : Math.PI * (1 - k * 2), -ang - (b.speed > 0 ? 0 : Math.PI), 0);
        const flap = k > 0.1 ? Math.sin(time * 18 + b.phase * 7) * 0.9 : 0.1;
        b.wings[0].rotation.z = flap;
        b.wings[1].rotation.z = -flap;
      }
    }
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.flowMat.dispose();
    this.ribbonMat.dispose();
    this.foamMat.dispose();
    this.rockMat.dispose();
    this.batMat.dispose();
  }
}
