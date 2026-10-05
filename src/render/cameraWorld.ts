import * as THREE from 'three';
import { lookDir } from '../sim/movement';
import type { Simulation } from '../sim/simulation';
import { WATER_LEVEL } from '../sim/terrain';
import type { CameraPose } from './view';

type Point = { x: number; y: number; z: number };
const CAMERA_RADIUS = 0.24;
const AIM_DISTANCE = 120;
const DIAGONAL = Math.SQRT1_2;
const OFFSETS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
  [DIAGONAL, DIAGONAL], [-DIAGONAL, DIAGONAL], [DIAGONAL, -DIAGONAL], [-DIAGONAL, -DIAGONAL]] as const;

/** Queries only world meshes; avatars, particles, grass and the placement ghost never obstruct the camera or aim. */
export class CameraWorld {
  private readonly ray = new THREE.Raycaster();
  private readonly meshes: THREE.Object3D[] = [];
  private readonly solids: THREE.Object3D[] = [];
  private readonly hits: THREE.Intersection[] = [];
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly reverse = new THREE.Vector3();
  private readonly ground = { x: 0, y: 0, z: 0, water: false };

  setObjects(objects: readonly THREE.Object3D[]): void {
    this.meshes.length = 0;
    this.solids.length = 0;
    for (const root of objects) root.traverseVisible((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.userData.cameraIgnore) return;
      if (/^(grass|flowers|creosote|sagebrush|naupaka|understory|fruit-|berries)/.test(o.name)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => m.transparent)) return;
      this.meshes.push(o);
      if (/^(trees-|stumps-|rocks$|logs$|saguaro|cave$)/.test(o.name) || o.userData.cameraObstacle) this.solids.push(o);
    });
  }

  private meshDistance(origin: THREE.Vector3, direction: THREE.Vector3, max: number, objects = this.meshes): number {
    this.ray.set(origin, direction);
    this.ray.near = 0;
    this.ray.far = max;
    this.hits.length = 0;
    this.ray.intersectObjects(objects, false, this.hits);
    return this.hits[0]?.distance ?? Infinity;
  }

  /** Sweep a padded boom, including the camera's near plane, against both sides of roofs and cave walls. */
  clip(sim: Simulation, origin: THREE.Vector3, direction: THREE.Vector3, length: number): number {
    this.right.set(direction.z, 0, -direction.x).normalize();
    if (this.right.lengthSq() < 0.1) this.right.set(1, 0, 0);
    this.up.crossVectors(direction, this.right).normalize();
    let safe = length;
    for (const [x, y] of OFFSETS) {
      this.origin.copy(origin).addScaledVector(this.right, x * CAMERA_RADIUS).addScaledVector(this.up, y * CAMERA_RADIUS);
      safe = Math.min(safe, this.meshDistance(this.origin, direction, length, this.solids) - CAMERA_RADIUS);
      // A ray starting inside a single-sided wall sees its back face only from the other end.
      this.reverse.copy(direction).negate();
      this.origin.addScaledVector(direction, length);
      const back = this.meshDistance(this.origin, this.reverse, length, this.solids);
      if (back < length) safe = Math.min(safe, length - back - CAMERA_RADIUS);
      this.origin.addScaledVector(direction, -length);
      // Use actual ground heights, with a surface floor for swimming; do not treat water as a roof.
      for (let d = 0; d <= Math.min(length, safe + CAMERA_RADIUS); d += 0.1) {
        const px = this.origin.x + direction.x * d;
        const pz = this.origin.z + direction.z * d;
        // The radial probes already offset vertically. Test the center height with one radius of clearance.
        if (origin.y + direction.y * d < Math.max(WATER_LEVEL, sim.terrain.heightAt(px, pz)) + CAMERA_RADIUS) {
          safe = Math.min(safe, d - 0.1);
          break;
        }
      }
    }
    return Math.max(0, safe);
  }

  /** Converge the player's eye ray on the point under the rendered, centered crosshair. */
  aim(sim: Simulation, pose: CameraPose, eye: Point, out: Point): void {
    this.origin.set(pose.x, pose.y, pose.z);
    lookDir(pose.yaw, pose.pitch, this.direction);
    let distance = Math.min(AIM_DISTANCE, this.meshDistance(this.origin, this.direction, AIM_DISTANCE));
    const ground = sim.terrain.raycast(pose.x, pose.y, pose.z, this.direction.x, this.direction.y, this.direction.z, distance, this.ground);
    if (ground >= 0) distance = ground;
    const dx = pose.x + this.direction.x * distance - eye.x;
    const dy = pose.y + this.direction.y * distance - eye.y;
    const dz = pose.z + this.direction.z * distance - eye.z;
    const len = Math.hypot(dx, dy, dz);
    // Behind/inside the player: keep facing forward rather than reversing a tool or projectile.
    if (len < 0.001 || dx * this.direction.x + dy * this.direction.y + dz * this.direction.z <= 0) {
      Object.assign(out, this.direction);
    } else {
      out.x = dx / len;
      out.y = dy / len;
      out.z = dz / len;
    }
  }
}
