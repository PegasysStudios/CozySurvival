import * as THREE from 'three';
import { smoothstep } from '../core/math';
import type { TreeSpecies } from '../data/resources';
import type { Simulation } from '../sim/simulation';
import { AvatarLayer } from './avatars';
import { EntityView } from './entities';
import { FishingView } from './fishing';
import { windUniforms } from './geo';
import { GhostView } from './ghost';
import { makeNatureMaterials, NatureView } from './nature';
import { Effects } from './particles';
import { DayNight, SkyView } from './sky';
import { IslandFeatures } from './islandFeatures';
import { IslandTerrain } from './islandTerrain';
import { IslandWaterView } from './islandWater';
import { buildTerrainMesh } from './terrainMesh';
import { ViewModel, type ViewModelInput } from './viewmodel';
import { WaterView } from './water';

const SHADOW_EXTENT = 42;
const LEAF_COLOR: Partial<Record<TreeSpecies, string>> = {
  joshua: '#8a9a48', mesquite: '#7a9040', cottonwood: '#7aa844', juniper: '#6a8466', pinyon: '#4a6a3a', ponderosa: '#4f7a3c',
  palm: '#5f9a3a', breadfruit: '#3f7a2e', kukui: '#8aa87a', hau: '#5a8a3a', treeFern: '#4a8a3a',
};
/**
 * Clear tropical air lets you see further on the island (its fog starts and ends later), which the chunked terrain
 * and instance culling keep affordable.
 */
const FOG = { near: 30, far: 210, nightNear: 12, nightFar: 85 };
const ISLAND_FOG = { near: 45, far: 250, nightNear: 14, nightFar: 95 };
const SHADOW_MAP = 2048;

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
}

/** Owns the WebGL renderer and every scene object. Reads simulation state; never mutates it. */
export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.08, 460);
  readonly dayNight = new DayNight();
  readonly effects = new Effects();
  readonly viewModel = new ViewModel();
  readonly avatars = new AvatarLayer();
  readonly fishing = new FishingView();
  private readonly sun = new THREE.DirectionalLight('#ffffff', 2);
  private readonly hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
  private readonly torchLight = new THREE.PointLight('#ffa050', 0, 16, 1.5);
  private readonly fog = new THREE.Fog('#c6dae2', 35, 210);
  private readonly natureMats = makeNatureMaterials();
  private seed = -1;
  private biome = '';
  private terrainMesh: THREE.Mesh | null = null;
  private islandTerrain: IslandTerrain | null = null;
  private islandFeatures: IslandFeatures | null = null;
  private fogKeys = FOG;
  private water: WaterView | IslandWaterView | null = null;
  private sky: SkyView | null = null;
  nature: NatureView | null = null;
  entities: EntityView | null = null;
  private ghost: GhostView | null = null;
  private worldVersion = -1;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private fireflyT = 0;
  private emberT = 0;
  showViewModel = true;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    this.renderer.domElement.className = 'view';
    container.prepend(this.renderer.domElement);

    this.camera.rotation.order = 'YXZ';
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color('#10141f');
    const s = this.sun.shadow;
    s.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    s.camera.left = -SHADOW_EXTENT;
    s.camera.right = SHADOW_EXTENT;
    s.camera.top = SHADOW_EXTENT;
    s.camera.bottom = -SHADOW_EXTENT;
    s.camera.near = 1;
    s.camera.far = 260;
    s.bias = -0.0006;
    s.normalBias = 0.035;
    this.sun.castShadow = true;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.torchLight, this.effects.group, this.camera, this.avatars.group, this.fishing.group);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewModel.resize(w / h);
    this.effects.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  /** Build (or rebuild) the world for a simulation. Static terrain is reused when the seed is unchanged. */
  setWorld(sim: Simulation): void {
    if (sim.state.seed !== this.seed || sim.biome !== this.biome) {
      this.disposeStatic();
      this.seed = sim.state.seed;
      this.biome = sim.biome;
      this.dayNight.setBiome(sim.biome);
      this.sky = new SkyView(sim.state.seed, sim.biome === 'desert' ? 5 : sim.biome === 'island' ? 22 : 16);
      if (sim.terrain.island) {
        this.islandTerrain = new IslandTerrain(sim.terrain);
        this.water = new IslandWaterView(sim.terrain);
        this.islandFeatures = new IslandFeatures(sim.terrain);
        this.fogKeys = ISLAND_FOG;
        this.scene.add(this.islandTerrain.group, this.water.group, this.islandFeatures.group, this.sky.group);
      } else {
        this.terrainMesh = buildTerrainMesh(sim.terrain);
        this.water = new WaterView(sim.terrain);
        this.fogKeys = FOG;
        this.scene.add(this.terrainMesh, this.water.group, this.sky.group);
      }
    }
    this.disposeDynamic();
    this.nature = new NatureView(sim.terrain, sim.gen, this.natureMats);
    this.nature.onImpact = (x, y, z, dx, dz, species) => {
      this.effects.leaves(x, y + 1, z, LEAF_COLOR[species] ?? '#4f7a3c', 26, 4);
      this.effects.dust(x - dx * 2, y, z - dz * 2, 18, 4);
    };
    this.entities = new EntityView(sim.terrain);
    this.ghost = new GhostView(sim.terrain);
    this.scene.add(this.nature.group, this.entities.group, this.ghost.group);
    this.nature.sync(sim.state, false);
    this.entities.sync(sim.state);
    this.worldVersion = sim.worldVersion;
    this.renderer.compile(this.scene, this.camera);
  }

  private disposeDynamic(): void {
    if (this.nature) {
      this.scene.remove(this.nature.group);
      this.nature.dispose();
    }
    if (this.entities) {
      this.scene.remove(this.entities.group);
      this.entities.dispose();
    }
    if (this.ghost) {
      this.scene.remove(this.ghost.group);
      this.ghost.dispose();
    }
  }

  private disposeStatic(): void {
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
      this.terrainMesh = null;
    }
    if (this.islandTerrain) {
      this.scene.remove(this.islandTerrain.group);
      this.islandTerrain.dispose();
      this.islandTerrain = null;
    }
    if (this.islandFeatures) {
      this.scene.remove(this.islandFeatures.group);
      this.islandFeatures.dispose();
      this.islandFeatures = null;
    }
    if (this.water) {
      this.scene.remove(this.water.group);
      this.water.dispose();
    }
    if (this.sky) {
      this.scene.remove(this.sky.group);
      this.sky.dispose();
    }
  }

  frame(sim: Simulation, dt: number, time: number, pose: CameraPose, vm: ViewModelInput | null): void {
    const dn = this.dayNight;
    dn.evaluate(sim.hour);
    const cam = this.camera;
    cam.position.set(pose.x, pose.y, pose.z);
    cam.rotation.set(pose.pitch, pose.yaw, pose.roll);
    if (Math.abs(cam.fov - pose.fov) > 0.01) {
      cam.fov = pose.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();

    // lighting
    const texel = (SHADOW_EXTENT * 2) / SHADOW_MAP;
    const tx = Math.round(pose.x / texel) * texel;
    const tz = Math.round(pose.z / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + dn.lightDir.x * 120, dn.lightDir.y * 120, tz + dn.lightDir.z * 120);
    this.sun.color.copy(dn.sun);
    this.sun.intensity = dn.sunIntensity;
    this.hemi.color.copy(dn.hemiSky);
    this.hemi.groundColor.copy(dn.hemiGround);
    this.hemi.intensity = dn.hemiIntensity;
    this.fog.color.copy(dn.fog);
    (this.scene.background as THREE.Color).copy(dn.fog);
    const fk = this.fogKeys;
    this.fog.near = fk.near - dn.night * fk.nightNear;
    this.fog.far = fk.far - dn.night * fk.nightFar;
    this.islandTerrain?.cull(pose.x, pose.z, this.fog.far + 15);
    windUniforms.uTime.value = time;
    windUniforms.uWind.value = 0.8 + 0.4 * Math.sin(time * 0.07);

    const torch = sim.state.activeTool === 'torch' && !sim.state.dead;
    if (torch) {
      this.tmpV.set(0.35, -0.1, -0.6).applyQuaternion(cam.quaternion).add(cam.position);
      this.torchLight.position.copy(this.tmpV);
      this.torchLight.intensity = 9 + Math.sin(time * 15) * 1.2 + Math.sin(time * 23) * 0.8;
    } else {
      this.torchLight.intensity = 0;
    }

    // world state
    if (this.nature && this.entities && this.ghost) {
      if (sim.worldVersion !== this.worldVersion) {
        this.worldVersion = sim.worldVersion;
        this.nature.sync(sim.state, true);
        this.entities.sync(sim.state);
      }
      // Past about 90% fog the island's jungle is only a haze, so its trees stop a little short of the fog's end.
      this.nature.update(dt, pose.x, pose.z, this.fog.far + (this.islandTerrain ? -25 : 15));
      this.entities.update(sim, dt, time, pose.x, pose.z);
      this.ghost.update(sim.placement, time);
      for (const f of this.entities.fires) {
        const dx = f.x - pose.x;
        const dz = f.z - pose.z;
        if (dx * dx + dz * dz < 80 * 80) this.effects.fire(f.x, f.y, f.z, Math.min(1, dt * 60));
      }
    }
    this.fireflyT -= dt;
    if (dn.night > 0.6 && this.fireflyT <= 0 && this.biome !== 'desert') {
      this.fireflyT = 0.12;
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 22;
      const fx = pose.x + Math.cos(a) * r;
      const fz = pose.z + Math.sin(a) * r;
      const t = this.entities ? sim.terrain : null;
      if (t) {
        const h = t.heightAt(fx, fz);
        if (h > 0.4 && t.field(fx, fz, 1) < 0.55) this.effects.firefly(fx, h + 0.4 + Math.random() * 1.2, fz);
      }
    }
    if (torch) {
      this.emberT -= dt;
      if (this.emberT <= 0) {
        this.emberT = 0.05;
        this.tmpV.set(0.3, 0.12, -0.75).applyQuaternion(cam.quaternion).add(cam.position);
        this.effects.torch(this.tmpV.x, this.tmpV.y, this.tmpV.z);
      }
    }
    this.islandFeatures?.update(dt, time, pose.x, pose.z, sim.hour, dn.night, this.effects);
    this.fishing.update(sim.state.dead ? null : sim.fishing, cam, time);
    this.effects.update(dt);
    this.water?.update(time, dn.horizon, dn.sunDir, dn.sun, (1 - dn.night) * smoothstep(0.02, 0.2, dn.sunDir.y) + dn.night * 0.25, dn.night);
    this.sky?.update(dn, cam, time);

    // viewmodel lighting mirrors the world, expressed in camera space
    const v = this.viewModel;
    v.hemi.color.copy(dn.hemiSky);
    v.hemi.groundColor.copy(dn.hemiGround);
    v.hemi.intensity = dn.hemiIntensity * 1.1;
    v.sun.color.copy(dn.sun);
    v.sun.intensity = dn.sunIntensity * 0.8;
    this.tmpQ.copy(cam.quaternion).invert();
    this.tmpV.copy(dn.lightDir).applyQuaternion(this.tmpQ);
    v.sun.position.copy(this.tmpV);
    v.camera.fov = 58;

    const r = this.renderer;
    r.clear();
    r.render(this.scene, cam);
    if (vm && this.showViewModel) {
      v.update(dt, time, vm);
      r.clearDepth();
      r.render(v.scene, v.camera);
    }
  }
}
