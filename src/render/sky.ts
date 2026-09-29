import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';
import { Rng } from '../core/rng';
import { cloudGeometry } from './models';

interface Key {
  h: number;
  top: string;
  horizon: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  fog: string;
}

const KEYS: Key[] = [
  { h: 0, top: '#070b1c', horizon: '#18203c', sun: '#8ea4d8', sunI: 0.38, hemiSky: '#34487a', hemiGround: '#141820', hemiI: 0.5, fog: '#131a2e' },
  { h: 4.4, top: '#0b1128', horizon: '#252c4d', sun: '#8ea4d8', sunI: 0.34, hemiSky: '#3a4a78', hemiGround: '#161820', hemiI: 0.5, fog: '#1b2239' },
  { h: 5.4, top: '#27325e', horizon: '#8a6f86', sun: '#f7a07a', sunI: 0.35, hemiSky: '#56628c', hemiGround: '#2a2426', hemiI: 0.55, fog: '#6a6078' },
  { h: 6.4, top: '#4b6fa6', horizon: '#f2aa73', sun: '#ffb27c', sunI: 1.2, hemiSky: '#9aaecb', hemiGround: '#4d4034', hemiI: 0.7, fog: '#d9ae8e' },
  { h: 8, top: '#5d97d3', horizon: '#cfe1ea', sun: '#fff0d4', sunI: 2.3, hemiSky: '#bed6ea', hemiGround: '#5d5341', hemiI: 0.95, fog: '#c1d4dc' },
  { h: 12, top: '#4c8bd2', horizon: '#d3e5ee', sun: '#fff8ea', sunI: 2.7, hemiSky: '#c9def0', hemiGround: '#615b48', hemiI: 1.0, fog: '#c7dae2' },
  { h: 16, top: '#5891cf', horizon: '#e0e2d4', sun: '#ffeccb', sunI: 2.45, hemiSky: '#cad8e6', hemiGround: '#625a44', hemiI: 0.95, fog: '#cfd6d2' },
  { h: 18.4, top: '#5a74ac', horizon: '#ffba73', sun: '#ffaf62', sunI: 1.85, hemiSky: '#d6bca6', hemiGround: '#4f3e30', hemiI: 0.8, fog: '#e7b88e' },
  { h: 19.7, top: '#344071', horizon: '#e27d62', sun: '#ff8a55', sunI: 0.85, hemiSky: '#8a7d98', hemiGround: '#32282a', hemiI: 0.65, fog: '#9a6f72' },
  { h: 20.5, top: '#1a2248', horizon: '#6a4b62', sun: '#b07a78', sunI: 0.22, hemiSky: '#4d5580', hemiGround: '#1d1c22', hemiI: 0.52, fog: '#3b3450' },
  { h: 21.5, top: '#0a0f26', horizon: '#1e2644', sun: '#8ea4d8', sunI: 0.36, hemiSky: '#34487a', hemiGround: '#141820', hemiI: 0.5, fog: '#161d33' },
  { h: 24, top: '#070b1c', horizon: '#18203c', sun: '#8ea4d8', sunI: 0.38, hemiSky: '#34487a', hemiGround: '#141820', hemiI: 0.5, fog: '#131a2e' },
];

type ColorKey = 'top' | 'horizon' | 'sun' | 'hemiSky' | 'hemiGround' | 'fog';
const COLOR_KEYS: ColorKey[] = ['top', 'horizon', 'sun', 'hemiSky', 'hemiGround', 'fog'];
const PARSED = KEYS.map((k) => Object.fromEntries(COLOR_KEYS.map((c) => [c, new THREE.Color(k[c])])) as Record<ColorKey, THREE.Color>);

export class DayNight {
  readonly top = new THREE.Color();
  readonly horizon = new THREE.Color();
  readonly sun = new THREE.Color();
  readonly hemiSky = new THREE.Color();
  readonly hemiGround = new THREE.Color();
  readonly fog = new THREE.Color();
  sunIntensity = 1;
  hemiIntensity = 1;
  /** 0 by day, 1 in deep night. */
  night = 0;
  readonly sunDir = new THREE.Vector3();
  readonly moonDir = new THREE.Vector3();
  /** Direction toward whichever body lights the scene. */
  readonly lightDir = new THREE.Vector3();

  evaluate(hour: number): void {
    let i = 0;
    while (i < KEYS.length - 2 && hour >= KEYS[i + 1].h) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = clamp((hour - a.h) / (b.h - a.h), 0, 1);
    const pa = PARSED[i];
    const pb = PARSED[i + 1];
    this.top.copy(pa.top).lerp(pb.top, t);
    this.horizon.copy(pa.horizon).lerp(pb.horizon, t);
    this.sun.copy(pa.sun).lerp(pb.sun, t);
    this.hemiSky.copy(pa.hemiSky).lerp(pb.hemiSky, t);
    this.hemiGround.copy(pa.hemiGround).lerp(pb.hemiGround, t);
    this.fog.copy(pa.fog).lerp(pb.fog, t);
    this.sunIntensity = a.sunI + (b.sunI - a.sunI) * t;
    this.hemiIntensity = a.hemiI + (b.hemiI - a.hemiI) * t;

    const sunA = ((hour - 5.5) / 15) * Math.PI;
    this.sunDir.set(Math.cos(sunA) * 0.85, Math.sin(sunA), 0.42).normalize();
    const moonA = ((((hour - 20.5) % 24) + 24) % 24 / 9) * Math.PI;
    this.moonDir.set(-Math.cos(moonA) * 0.8, Math.sin(moonA) * 0.9 + 0.05, -0.35).normalize();
    const sunUp = hour >= 5.5 && hour <= 20.5;
    this.lightDir.copy(sunUp ? this.sunDir : this.moonDir);
    if (this.lightDir.y < 0.12) {
      this.lightDir.y = 0.12;
      this.lightDir.normalize();
    }
    this.night = 1 - Math.min(smoothstep(4.6, 6.4, hour), 1 - smoothstep(19.6, 21.2, hour));
  }
}

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uMoonDir;
  uniform float uNight;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.5));
    if (d.y < 0.0) col = mix(uHorizon, uHorizon * 0.75, clamp(-d.y * 4.0, 0.0, 1.0));
    float sd = max(dot(d, uSunDir), 0.0);
    float day = 1.0 - uNight;
    col += uSunColor * (smoothstep(0.9985, 0.9992, sd) * 3.0 + pow(sd, 10.0) * 0.22 + pow(sd, 3.0) * 0.06) * max(day, 0.15);
    float md = max(dot(d, uMoonDir), 0.0);
    col += vec3(0.86, 0.9, 1.0) * (smoothstep(0.9992, 0.9995, md) * 1.1 + pow(md, 60.0) * 0.12) * uNight;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const starVertex = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  varying float vTw;
  void main() {
    vTw = 0.65 + 0.35 * sin(uTime * (1.2 + aPhase) + aPhase * 12.0);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
    gl_PointSize = aSize;
  }
`;

const starFragment = /* glsl */ `
  uniform float uOpacity;
  varying float vTw;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(c));
    gl_FragColor = vec4(vec3(0.92, 0.95, 1.0), a * uOpacity * vTw);
  }
`;

export class SkyView {
  readonly group = new THREE.Group();
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly starMat: THREE.ShaderMaterial;
  private readonly clouds: THREE.Mesh[] = [];
  private readonly cloudMat: THREE.MeshLambertMaterial;
  private readonly cloudBase: { x: number; z: number; speed: number }[] = [];

  constructor(seed: number) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() },
        uSunColor: { value: new THREE.Color() },
        uMoonDir: { value: new THREE.Vector3() },
        uNight: { value: 0 },
      },
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), this.skyMat);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);

    const rng = new Rng(seed ^ 0x51a);
    const n = 1100;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = rng.range(0.02, 1);
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * r * 360;
      pos[i * 3 + 1] = u * 360;
      pos[i * 3 + 2] = Math.sin(a) * r * 360;
      size[i] = rng.range(1, 2.6) * (rng.chance(0.06) ? 1.6 : 1);
      phase[i] = rng.range(0, 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: starVertex,
      fragmentShader: starFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
    });
    const stars = new THREE.Points(sg, this.starMat);
    stars.renderOrder = -9;
    stars.frustumCulled = false;
    this.group.add(stars);

    this.cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false, transparent: true, opacity: 0.92, emissive: new THREE.Color('#000000') });
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(cloudGeometry(300 + i), this.cloudMat);
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(70, 250);
      this.cloudBase.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, speed: rng.range(0.5, 1.2) });
      m.position.set(0, rng.range(85, 120), 0);
      const s = rng.range(0.8, 1.6);
      m.scale.set(s, s * rng.range(0.8, 1.1), s);
      m.rotation.y = rng.range(0, Math.PI);
      m.renderOrder = -8;
      this.clouds.push(m);
      this.group.add(m);
    }
  }

  update(dn: DayNight, camera: THREE.Camera, time: number): void {
    this.group.position.copy(camera.position);
    const u = this.skyMat.uniforms;
    (u.uTop.value as THREE.Color).copy(dn.top);
    (u.uHorizon.value as THREE.Color).copy(dn.horizon);
    (u.uSunDir.value as THREE.Vector3).copy(dn.sunDir);
    (u.uSunColor.value as THREE.Color).copy(dn.sun);
    (u.uMoonDir.value as THREE.Vector3).copy(dn.moonDir);
    u.uNight.value = dn.night;
    this.starMat.uniforms.uOpacity.value = smoothstep(0.35, 1, dn.night);
    this.starMat.uniforms.uTime.value = time;
    this.cloudMat.emissive.copy(dn.horizon).multiplyScalar(0.35);
    this.cloudMat.opacity = 0.9 - dn.night * 0.35;
    for (let i = 0; i < this.clouds.length; i++) {
      const b = this.cloudBase[i];
      let x = b.x + time * b.speed;
      x = ((x + 260) % 520 + 520) % 520 - 260;
      this.clouds[i].position.x = x;
      this.clouds[i].position.z = b.z;
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose();
    });
    this.skyMat.dispose();
    this.starMat.dispose();
    this.cloudMat.dispose();
  }
}
