import * as THREE from 'three';
import { TERRAIN_CELL, TERRAIN_VERTS, WATER_LEVEL, WORLD_HALF, type Terrain } from '../sim/terrain';
import { buildDepthTexture } from './terrainMesh';

const vertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  uniform float uTime;
  varying vec3 vWorld;
  void main() {
    vec3 p = position;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    wp.y += sin(wp.x * 0.35 + uTime * 0.9) * 0.025 + cos(wp.z * 0.28 + uTime * 0.7) * 0.025;
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform sampler2D uDepth;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunStrength;
  uniform vec2 uGrid;
  varying vec3 vWorld;

  float waveH(vec2 p) {
    return sin(p.x * 1.3 + uTime * 1.1) * 0.5 + sin(p.y * 1.7 - uTime * 0.9) * 0.5
         + sin((p.x + p.y) * 2.9 + uTime * 1.9) * 0.25 + sin((p.x - p.y) * 4.1 - uTime * 2.3) * 0.15;
  }

  void main() {
    vec2 uv = ((vWorld.xz + vec2(${WORLD_HALF.toFixed(1)})) / ${TERRAIN_CELL.toFixed(1)} + 0.5) / uGrid;
    float depth = (texture2D(uDepth, uv).r * 1.2 - 0.2) * 5.0;
    float e = 0.15;
    vec2 p = vWorld.xz * 0.9;
    float hx = waveH(p + vec2(e, 0.0)) - waveH(p - vec2(e, 0.0));
    float hz = waveH(p + vec2(0.0, e)) - waveH(p - vec2(0.0, e));
    vec3 n = normalize(vec3(-hx * 0.06, 1.0, -hz * 0.06));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    float shallow = smoothstep(0.0, 2.8, depth);
    vec3 base = mix(uShallow, uDeep, shallow);
    vec3 col = mix(base, uSky, 0.15 + fres * 0.55);
    vec3 h = normalize(uSunDir + viewDir);
    float spec = pow(max(dot(n, h), 0.0), 180.0) * uSunStrength;
    col += uSunColor * spec * 1.6;
    float foamLine = 1.0 - smoothstep(0.0, 0.32, depth);
    float ripple = 0.5 + 0.5 * sin(depth * 24.0 - uTime * 2.2 + vWorld.x * 0.4);
    col = mix(col, vec3(0.93, 0.95, 0.94), foamLine * (0.35 + 0.4 * ripple));
    float alpha = mix(0.55, 0.9, shallow) + fres * 0.08;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Day colours (deep, shallow) per water kind; alkali pools are milky and pale, fresh water clear blue-green. */
const PALETTE = {
  fresh: { deep: [0.035, 0.11, 0.13], shallow: [0.12, 0.3, 0.26] },
  alkali: { deep: [0.36, 0.46, 0.44], shallow: [0.62, 0.68, 0.62] },
} as const;

export class WaterView {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  /** Milky alkali water (desert only). */
  private readonly alkali: THREE.ShaderMaterial | null = null;
  private readonly depthTex: THREE.DataTexture;

  constructor(t: Terrain) {
    this.depthTex = buildDepthTexture(t);
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uDepth: { value: null },
          uDeep: { value: new THREE.Color('#1f4f5e') },
          uShallow: { value: new THREE.Color('#5d9a8f') },
          uSky: { value: new THREE.Color('#bcd7ea') },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color('#fff4dc') },
          uSunStrength: { value: 1 },
          uGrid: { value: new THREE.Vector2(TERRAIN_VERTS, TERRAIN_VERTS) },
        },
      ]),
    });
    this.material.uniforms.uDepth.value = this.depthTex;
    if (t.lakes.some((l) => l.kind === 'alkali')) {
      this.alkali = this.material.clone();
      this.alkali.uniforms.uDepth.value = this.depthTex;
    }
    for (const lake of t.lakes) {
      const size = lake.r * 3.6;
      const segs = lake.r < 10 ? 18 : 36;
      const geo = new THREE.PlaneGeometry(size, size, segs, segs);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, lake.kind === 'alkali' && this.alkali ? this.alkali : this.material);
      mesh.position.set(lake.x, WATER_LEVEL, lake.z);
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }
  }

  update(time: number, sky: THREE.Color, sunDir: THREE.Vector3, sunColor: THREE.Color, sunStrength: number, night: number): void {
    this.updateMaterial(this.material, time, sky, sunDir, sunColor, sunStrength, night, 'fresh');
    if (this.alkali) this.updateMaterial(this.alkali, time, sky, sunDir, sunColor, sunStrength, night, 'alkali');
  }

  private updateMaterial(m: THREE.ShaderMaterial, time: number, sky: THREE.Color, sunDir: THREE.Vector3, sunColor: THREE.Color, sunStrength: number, night: number, kind: keyof typeof PALETTE): void {
    const u = m.uniforms;
    u.uTime.value = time;
    (u.uSky.value as THREE.Color).copy(sky);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    (u.uSunColor.value as THREE.Color).copy(sunColor);
    u.uSunStrength.value = sunStrength;
    if (kind === 'fresh') {
      (u.uDeep.value as THREE.Color).setRGB(0.035 - night * 0.025, 0.11 - night * 0.09, 0.13 - night * 0.09);
      (u.uShallow.value as THREE.Color).setRGB(0.12 - night * 0.1, 0.3 - night * 0.25, 0.26 - night * 0.19);
      return;
    }
    const p = PALETTE[kind];
    const k = 1 - night * 0.8;
    (u.uDeep.value as THREE.Color).setRGB(p.deep[0] * k, p.deep[1] * k, p.deep[2] * k);
    (u.uShallow.value as THREE.Color).setRGB(p.shallow[0] * k, p.shallow[1] * k, p.shallow[2] * k);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.material.dispose();
    this.alkali?.dispose();
    this.depthTex.dispose();
  }
}
