import * as THREE from 'three';
import { TERRAIN_CELL, WATER_LEVEL, type Terrain } from '../sim/terrain';
import { islandWaterTexture } from './islandTerrain';

const vertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  uniform float uTime;
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    wp.y += sin(wp.x * 0.21 + uTime * 0.8) * 0.03 + cos(wp.z * 0.17 + uTime * 0.6) * 0.03;
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
  uniform sampler2D uTex;
  uniform vec2 uGrid;
  uniform float uHalf;
  uniform float uCell;
  uniform vec3 uShallow;
  uniform vec3 uLagoon;
  uniform vec3 uDeep;
  uniform vec3 uFresh;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunStrength;
  uniform float uNight;
  varying vec3 vWorld;

  float waveH(vec2 p) {
    return sin(p.x * 1.1 + uTime * 1.0) * 0.5 + sin(p.y * 1.5 - uTime * 0.8) * 0.5
         + sin((p.x + p.y) * 2.6 + uTime * 1.7) * 0.25 + sin((p.x - p.y) * 3.7 - uTime * 2.1) * 0.15;
  }

  void main() {
    vec2 uv = ((vWorld.xz + vec2(uHalf)) / uCell + 0.5) / uGrid;
    vec4 s = texture2D(uTex, uv);
    float depth = s.r * 25.0 - 1.0;
    float fresh = s.g;
    float reef = s.b;
    float e = 0.15;
    vec2 p = vWorld.xz * 0.8;
    float hx = waveH(p + vec2(e, 0.0)) - waveH(p - vec2(e, 0.0));
    float hz = waveH(p + vec2(0.0, e)) - waveH(p - vec2(0.0, e));
    vec3 n = normalize(vec3(-hx * 0.07, 1.0, -hz * 0.07));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    // Sand-bright turquoise in the shallows, deeper teal over the lagoon, ocean blue past the reef.
    vec3 sea = mix(uShallow, uLagoon, smoothstep(0.2, 2.4, depth));
    sea = mix(sea, uDeep, smoothstep(3.0, 12.0, depth));
    vec3 base = mix(sea, uFresh, fresh);
    vec3 col = mix(base, uSky, 0.1 + fres * 0.5);
    vec3 h = normalize(uSunDir + viewDir);
    float spec = pow(max(dot(n, h), 0.0), 200.0) * uSunStrength;
    col += uSunColor * spec * 1.8;
    // Foam: a lapping line at every shore, and breaking surf along the reef crest.
    float shore = 1.0 - smoothstep(0.0, 0.3, depth);
    float ripple = 0.5 + 0.5 * sin(depth * 22.0 - uTime * 2.2 + vWorld.x * 0.35);
    float surfWave = 0.5 + 0.5 * sin(vWorld.x * 0.23 + vWorld.z * 0.19 - uTime * 1.6);
    float surf = reef * (1.0 - fresh) * smoothstep(0.35, 0.9, surfWave * (0.7 + 0.3 * sin(uTime * 0.7 + vWorld.z * 0.05)));
    float foam = max(shore * (0.35 + 0.45 * ripple), surf * 0.75);
    col = mix(col, vec3(0.95, 0.97, 0.97) * (1.0 - uNight * 0.6), foam);
    float alpha = mix(0.42, 0.93, smoothstep(0.0, 6.0, depth));
    alpha = mix(alpha, 0.72, fresh);
    alpha = clamp(alpha + fres * 0.08 + foam * 0.3, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Day colours: shallow sand-turquoise, lagoon teal, deep ocean blue and clear green-brown stream water. */
const DAY = {
  shallow: new THREE.Color('#62d6c4'),
  lagoon: new THREE.Color('#17a6bc'),
  deep: new THREE.Color('#0b4f8e'),
  fresh: new THREE.Color('#2c6a5c'),
};

/** One sheet of water over the whole island map: the ocean, the lagoon and cove, and every stream and pool. */
export class IslandWaterView {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  private readonly tex: THREE.DataTexture;
  private readonly tmp = new THREE.Color();

  constructor(t: Terrain) {
    this.tex = islandWaterTexture(t);
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
          uTex: { value: null },
          uGrid: { value: new THREE.Vector2(t.verts, t.verts) },
          uHalf: { value: t.half },
          uCell: { value: TERRAIN_CELL },
          uShallow: { value: DAY.shallow.clone() },
          uLagoon: { value: DAY.lagoon.clone() },
          uDeep: { value: DAY.deep.clone() },
          uFresh: { value: DAY.fresh.clone() },
          uSky: { value: new THREE.Color('#bcd7ea') },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color('#fff4dc') },
          uSunStrength: { value: 1 },
          uNight: { value: 0 },
        },
      ]),
    });
    this.material.uniforms.uTex.value = this.tex;
    const geo = new THREE.PlaneGeometry(2400, 2400, 48, 48);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.y = WATER_LEVEL;
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    mesh.name = 'ocean';
    this.group.add(mesh);
  }

  update(time: number, sky: THREE.Color, sunDir: THREE.Vector3, sunColor: THREE.Color, sunStrength: number, night: number): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    (u.uSky.value as THREE.Color).copy(sky);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    (u.uSunColor.value as THREE.Color).copy(sunColor);
    u.uSunStrength.value = sunStrength;
    u.uNight.value = night;
    const k = 1 - night * 0.82;
    (u.uShallow.value as THREE.Color).copy(this.tmp.copy(DAY.shallow).multiplyScalar(k));
    (u.uLagoon.value as THREE.Color).copy(this.tmp.copy(DAY.lagoon).multiplyScalar(k));
    (u.uDeep.value as THREE.Color).copy(this.tmp.copy(DAY.deep).multiplyScalar(1 - night * 0.7));
    (u.uFresh.value as THREE.Color).copy(this.tmp.copy(DAY.fresh).multiplyScalar(k));
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.material.dispose();
    this.tex.dispose();
  }
}
