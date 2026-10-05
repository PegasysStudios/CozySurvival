import * as THREE from 'three';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import { PREFABS } from '../data/prefabs';
import type { StructureState } from '../sim/state';
import { WATER_LEVEL, type Terrain } from '../sim/terrain';
import type { Weather } from '../sim/weather';
import type { DayNight } from './sky';

export const WEATHER_LOOK = {
  sunny: { cover: 0, clear: 1, clouds: 0.25, cloudScale: 1, sun: 1, ambient: 1, near: 30, far: 210 },
  cloudy: { cover: 0.82, clear: 0.12, clouds: 1, cloudScale: 1.75, sun: 0.32, ambient: 1.12, near: 24, far: 175 },
  rainy: { cover: 0.96, clear: 0.04, clouds: 1, cloudScale: 1.9, sun: 0.22, ambient: 1.02, near: 18, far: 145 },
  foggy: { cover: 0.75, clear: 0.18, clouds: 0.65, cloudScale: 1.4, sun: 0.36, ambient: 1.16, near: 8, far: 88 },
  snowy: { cover: 0.9, clear: 0.08, clouds: 1, cloudScale: 1.75, sun: 0.3, ambient: 1.18, near: 18, far: 145 },
} as const;

const mistDay = new THREE.Color('#b9c8ce');
const mistNight = new THREE.Color('#243047');
const overcastDay = new THREE.Color('#8eabbc');
const overcastNight = new THREE.Color('#17233a');
const paleSun = new THREE.Color('#e0edf2');
const tint = new THREE.Color();
const topTint = new THREE.Color();

/** Apply to the freshly evaluated clock palette, so a dev switch restores sunny lighting immediately. */
export function applyWeatherLight(dn: DayNight, id: Weather | null): void {
  if (!id || id === 'sunny') return;
  const look = WEATHER_LOOK[id];
  tint.copy(mistDay).lerp(mistNight, dn.night);
  topTint.copy(overcastDay).lerp(overcastNight, dn.night);
  dn.top.lerp(topTint, look.cover);
  dn.horizon.lerp(tint, look.cover);
  dn.fog.lerp(tint, look.cover);
  dn.hemiSky.lerp(tint, look.cover * 0.75);
  dn.sun.lerp(paleSun, look.cover * (1 - dn.night) * 0.8);
  dn.sunIntensity *= look.sun;
  dn.hemiIntensity *= look.ambient;
}

/** Approximate the procedural shelter roofs in local coordinates; precipitation stops above their interiors. */
export function precipitationSurface(terrain: Terrain, shelters: readonly StructureState[], x: number, z: number): number {
  let y = Math.max(WATER_LEVEL, terrain.heightAt(x, z));
  for (const st of shelters) {
    const def = PREFABS[st.prefab];
    if (!def.shelter || Math.abs(x - st.x) > 3 || Math.abs(z - st.z) > 3) continue;
    const dx = x - st.x, dz = z - st.z;
    const c = Math.cos(st.rot), s = Math.sin(st.rot);
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    if (st.prefab === 'hideTent') {
      const radius = Math.hypot(lx, lz);
      if (radius < 1.85) y = Math.max(y, st.y + 2.65 * (1 - radius / 1.85) + 0.12);
    } else if (Math.abs(lx) < 1.75 && Math.abs(lz) < 1.5) {
      const roof = st.prefab === 'leanTo' ? clamp((lz + 1.3) / 2.35, 0, 1) * 1.95 + 0.16
        : st.prefab === 'aFrame' ? 2.2 * (1 - Math.abs(lx) / 1.75) + 0.14
        : 2.15 - Math.abs(lx) * 0.6;
      y = Math.max(y, st.y + roof);
    }
  }
  return y;
}

const snowVertex = /* glsl */ `
  attribute float aSize;
  uniform float uScale;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp(aSize * uScale / max(-mvPosition.z, 0.1), 1.0, 11.0);
    #include <fog_vertex>
  }
`;
const snowFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  #include <fog_pars_fragment>
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(uColor, (1.0 - smoothstep(0.15, 0.5, d)) * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const RAIN_COUNT = 560;
const SNOW_COUNT = 640;
const PARTICLE_CAPACITY = Math.max(RAIN_COUNT, SNOW_COUNT);
const RADIUS = 23;
const HEIGHT = 24;

/** Two reusable draw calls, independent of gameplay time scale and the action-effect particle pools. PNW only. */
export class WeatherView {
  readonly group = new THREE.Group();
  readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly snow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positions = new Float32Array(PARTICLE_CAPACITY * 3);
  private readonly rainVertices = new Float32Array(RAIN_COUNT * 6);
  private readonly snowVertices = new Float32Array(SNOW_COUNT * 3);
  private readonly speeds = new Float32Array(PARTICLE_CAPACITY);
  private readonly phases = new Float32Array(PARTICLE_CAPACITY);
  private readonly rng: Rng;
  private active: Weather | null = null;
  private readonly anchor = new THREE.Vector3(Infinity, Infinity, Infinity);
  private readonly shelters: StructureState[] = [];
  private readonly terrain: Terrain;

  constructor(terrain: Terrain, seed: number) {
    this.terrain = terrain;
    this.rng = new Rng(seed ^ 0x706e7778);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainVertices, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#bbd4e1', transparent: true, opacity: 0.3, depthWrite: false, fog: true }));
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(this.snowVertices, 3).setUsage(THREE.DynamicDrawUsage));
    const sizes = new Float32Array(SNOW_COUNT);
    for (let i = 0; i < PARTICLE_CAPACITY; i++) {
      this.speeds[i] = this.rng.range(0.75, 1.25);
      this.phases[i] = this.rng.range(0, Math.PI * 2);
      if (i < SNOW_COUNT) sizes[i] = this.rng.range(0.035, 0.075);
    }
    snowGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.snow = new THREE.Points(snowGeo, new THREE.ShaderMaterial({
      vertexShader: snowVertex, fragmentShader: snowFragment,
      transparent: true, depthWrite: false, fog: true,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uScale: { value: 600 }, uColor: { value: new THREE.Color('#eef5f8') }, uOpacity: { value: 0.72 } },
    }));
    this.rain.frustumCulled = this.snow.frustumCulled = false;
    this.rain.visible = this.snow.visible = false;
    this.group.add(this.rain, this.snow);
  }

  private respawn(i: number, camera: THREE.Camera, fill: boolean): void {
    const j = i * 3;
    const x = camera.position.x + this.rng.range(-RADIUS, RADIUS);
    const z = camera.position.z + this.rng.range(-RADIUS, RADIUS);
    const floor = precipitationSurface(this.terrain, this.shelters, x, z) + 0.55;
    const top = Math.max(camera.position.y + 17, floor + HEIGHT);
    this.positions[j] = x;
    this.positions[j + 1] = fill ? this.rng.range(Math.max(camera.position.y - 7, floor), top) : top;
    this.positions[j + 2] = z;
  }

  update(id: Weather | null, dt: number, time: number, camera: THREE.PerspectiveCamera, pixelHeight: number, night: number, structures: readonly StructureState[]): void {
    this.rain.visible = id === 'rainy';
    this.snow.visible = id === 'snowy';
    if (!this.rain.visible && !this.snow.visible) { this.active = id; return; }
    this.shelters.length = 0;
    for (const st of structures) if (PREFABS[st.prefab].shelter && Math.abs(st.x - camera.position.x) < RADIUS + 3 && Math.abs(st.z - camera.position.z) < RADIUS + 3) this.shelters.push(st);
    const reset = id !== this.active || camera.position.distanceToSquared(this.anchor) > RADIUS * RADIUS;
    const snow = id === 'snowy';
    const count = snow ? SNOW_COUNT : RAIN_COUNT;
    const step = clamp(dt, 0, 0.1);
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      if (reset) this.respawn(i, camera, true);
      this.positions[j] += step * (snow ? Math.sin(time * 0.6 + this.phases[i]) * 0.35 + 0.12 : 0.45);
      this.positions[j + 1] -= step * this.speeds[i] * (snow ? 1.15 : 11);
      this.positions[j + 2] += step * (snow ? Math.cos(time * 0.5 + this.phases[i]) * 0.25 : 0.15);
      const x = this.positions[j], y = this.positions[j + 1], z = this.positions[j + 2];
      if (Math.abs(x - camera.position.x) > RADIUS || Math.abs(z - camera.position.z) > RADIUS || y < camera.position.y - 7 || y < precipitationSurface(this.terrain, this.shelters, x, z) + 0.5) this.respawn(i, camera, false);
      if (snow) {
        this.snowVertices[j] = this.positions[j];
        this.snowVertices[j + 1] = this.positions[j + 1];
        this.snowVertices[j + 2] = this.positions[j + 2];
      } else {
        const k = i * 6;
        this.rainVertices[k] = this.positions[j];
        this.rainVertices[k + 1] = this.positions[j + 1];
        this.rainVertices[k + 2] = this.positions[j + 2];
        this.rainVertices[k + 3] = this.positions[j] - 0.025;
        this.rainVertices[k + 4] = this.positions[j + 1] + 0.5 * this.speeds[i];
        this.rainVertices[k + 5] = this.positions[j + 2] - 0.008;
      }
    }
    this.active = id;
    this.anchor.copy(camera.position);
    this.rain.geometry.attributes.position.needsUpdate = !snow;
    this.snow.geometry.attributes.position.needsUpdate = snow;
    this.rain.material.opacity = 0.3 - night * 0.12;
    this.snow.material.uniforms.uScale.value = pixelHeight / (2 * Math.tan(camera.fov * Math.PI / 360));
    this.snow.material.uniforms.uOpacity.value = 0.72 - night * 0.18;
    this.snow.material.uniforms.uColor.value.set('#eef5f8').lerp(mistNight, night * 0.45);
  }

  dispose(): void {
    this.rain.geometry.dispose();
    this.rain.material.dispose();
    this.snow.geometry.dispose();
    this.snow.material.dispose();
  }
}
