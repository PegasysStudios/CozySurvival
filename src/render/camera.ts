import * as THREE from 'three';
import { damp } from '../core/math';
import type { CameraPose } from './view';

export type CameraMode = 'firstPerson' | 'thirdPersonClose' | 'thirdPersonFar';
export const CAMERA_MODES: readonly CameraMode[] = ['firstPerson', 'thirdPersonClose', 'thirdPersonFar'];
export const CAMERA_LABELS: Record<CameraMode, string> = {
  firstPerson: 'First person', thirdPersonClose: 'Third person · close', thirdPersonFar: 'Third person · far',
};
const DISTANCES: Record<CameraMode, number> = { firstPerson: 0, thirdPersonClose: 2.8, thirdPersonFar: 5.6 };

/** A shoulder boom anchored to the player. Only its length eases, so mouse look never lags behind aiming. */
export class PlayerCamera {
  mode: CameraMode = 'firstPerson';
  private distance = 0;
  private clearance = 0;
  private readonly rotation = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly offset = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  get active(): boolean {
    return this.mode !== 'firstPerson' || this.distance > 0;
  }

  get avatarOpacity(): number {
    return THREE.MathUtils.smoothstep(this.clearance, 0.55, 1.25);
  }

  cycle(): CameraMode {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    return this.mode;
  }

  reset(): void {
    this.mode = 'firstPerson';
    this.distance = this.clearance = 0;
  }

  update(pose: CameraPose, dt: number, clip: (origin: THREE.Vector3, direction: THREE.Vector3, length: number) => number): void {
    this.distance = damp(this.distance, DISTANCES[this.mode], 10, dt);
    if (this.mode === 'firstPerson' && this.distance < 0.001) this.distance = 0;
    if (this.distance === 0) {
      this.clearance = 0;
      return;
    }
    const shoulder = Math.min(1, this.distance / DISTANCES.thirdPersonClose);
    this.rotation.set(pose.pitch, pose.yaw, 0);
    this.offset.set(0.65 * shoulder, 0.4 * shoulder, this.distance).applyEuler(this.rotation);
    const length = this.offset.length();
    this.origin.set(pose.x, pose.y, pose.z);
    this.direction.copy(this.offset).divideScalar(length);
    const safe = Math.max(0, Math.min(length, clip(this.origin, this.direction, length)));
    // Obstacles pull the camera in immediately; recovering space eases it back out.
    this.clearance = safe < this.clearance ? safe : damp(this.clearance, safe, 12, dt);
    this.offset.multiplyScalar(this.clearance / length);
    pose.x += this.offset.x;
    pose.y += this.offset.y;
    pose.z += this.offset.z;
    pose.roll = 0;
  }
}
