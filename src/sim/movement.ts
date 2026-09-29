import { pushCircleOut } from '../core/geom2d';
import { damp } from '../core/math';
import { BALANCE } from '../data/balance';
import type { Collider } from './colliders';
import type { PlayerState } from './state';
import { PLAY_HALF, type Terrain } from './terrain';

const P = BALANCE.player;
export const JUMP_VELOCITY = Math.sqrt(2 * P.gravity * P.jumpHeight);

export interface MoveInput {
  /** Strafe axis: +1 right. */
  moveX: number;
  /** Forward axis: +1 forward. */
  moveZ: number;
  jumpPressed: boolean;
  sprint: boolean;
  yaw: number;
}

export interface MoveEnv {
  terrain: Terrain;
  query(x: number, z: number, r: number, out: Collider[]): Collider[];
}

export interface MoveOptions {
  canSprint: boolean;
  exhausted: boolean;
}

export interface MoveResult {
  jumped: boolean;
  /** Downward speed at touchdown (0 if no landing this step). */
  landed: number;
  /** Horizontal distance travelled. */
  distance: number;
}

export function createPlayer(x: number, y: number, z: number, yaw: number): PlayerState {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0,
    grounded: true, coyote: 0, jumpBuffer: 0, sprinting: false, wading: false, sitting: false, hurtTimer: 0,
  };
}

const tmpColliders: Collider[] = [];
const push = [0, 0];

function blocked(env: MoveEnv, p: PlayerState, fx: number, fz: number, tx: number, tz: number): boolean {
  const t = env.terrain;
  if (Math.abs(tx) > PLAY_HALF || Math.abs(tz) > PLAY_HALF) return true;
  const depthTo = -t.heightAt(tx, tz);
  if (depthTo > P.maxWadeDepth) {
    // allow moving toward shallower water if somehow already deep
    const depthFrom = -t.heightAt(fx, fz);
    if (depthTo >= depthFrom) return true;
  }
  const hFrom = t.heightAt(fx, fz);
  const hTo = t.heightAt(tx, tz);
  const rise = hTo - hFrom;
  if (rise <= 0) return false;
  const run = Math.hypot(tx - fx, tz - fz);
  if (run < 1e-6) return false;
  if (!p.grounded && hTo < p.y - 0.05) return false;
  return rise / run > P.maxSlope;
}

function resolveCollisions(env: MoveEnv, p: PlayerState): void {
  const r = P.radius;
  for (let iter = 0; iter < 3; iter++) {
    env.query(p.x, p.z, r + 2.5, tmpColliders);
    let moved = false;
    for (let i = 0; i < tmpColliders.length; i++) {
      const c = tmpColliders[i];
      if (!c.body) continue;
      if (pushCircleOut(p.x, p.z, r, c.body, push)) {
        p.x += push[0];
        p.z += push[1];
        const len = Math.hypot(push[0], push[1]);
        if (len > 1e-6) {
          const nx = push[0] / len;
          const nz = push[1] / len;
          const vn = p.vx * nx + p.vz * nz;
          if (vn < 0) {
            p.vx -= nx * vn;
            p.vz -= nz * vn;
          }
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Minecraft-flavored kinematic controller: snappy exponential accel/decel on the ground, weak air control,
 * fixed-height jump with coyote time and jump buffering, ground snapping on slopes (no bounce),
 * slope and deep-water blocking with axis sliding, and circle/box obstacle push-out.
 * Integrates in substeps so feel is identical at 30, 60, or 144 fps.
 */
export function stepPlayer(p: PlayerState, input: MoveInput, env: MoveEnv, dt: number, opts: MoveOptions): MoveResult {
  const result: MoveResult = { jumped: false, landed: 0, distance: 0 };
  if (dt <= 0) return result;
  if (input.jumpPressed) p.jumpBuffer = P.jumpBuffer;

  let mx = input.moveX;
  let mz = input.moveZ;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) {
    mx /= ml;
    mz /= ml;
  }
  const moving = ml > 0.05;
  if (moving && p.sitting) p.sitting = false;
  if (p.sitting) {
    mx = 0;
    mz = 0;
  }

  const sinY = Math.sin(input.yaw);
  const cosY = Math.cos(input.yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  const wx = cosY * mx - sinY * mz;
  const wz = -sinY * mx - cosY * mz;

  const steps = Math.max(1, Math.ceil(dt / P.maxSubstep));
  const h = dt / steps;
  const t = env.terrain;

  for (let s = 0; s < steps; s++) {
    const depth = -t.heightAt(p.x, p.z);
    p.wading = depth > P.wadeDepth;
    p.sprinting = input.sprint && opts.canSprint && !opts.exhausted && mz > 0.3 && !p.wading;
    let speed = p.sprinting ? P.sprintSpeed : P.walkSpeed;
    if (opts.exhausted) speed *= BALANCE.needs.energy.exhaustedSpeedMul;
    if (p.wading) speed *= P.wadeSpeedMul;
    const tvx = wx * speed;
    const tvz = wz * speed;
    const rate = p.grounded ? (moving ? P.groundAccel : P.groundDecel) : P.airAccel;
    p.vx = damp(p.vx, tvx, rate, h);
    p.vz = damp(p.vz, tvz, rate, h);
    if (!moving && p.grounded && Math.abs(p.vx) < 0.01 && Math.abs(p.vz) < 0.01) {
      p.vx = 0;
      p.vz = 0;
    }

    if (p.grounded) p.coyote = P.coyoteTime;
    else p.coyote = Math.max(0, p.coyote - h);
    if (p.jumpBuffer > 0 && (p.grounded || p.coyote > 0) && !p.sitting) {
      p.vy = JUMP_VELOCITY;
      p.grounded = false;
      p.coyote = 0;
      p.jumpBuffer = 0;
      result.jumped = true;
    }
    p.jumpBuffer = Math.max(0, p.jumpBuffer - h);

    // horizontal with slope/water blocking and axis sliding
    const ox = p.x;
    const oz = p.z;
    const nx = p.x + p.vx * h;
    const nz = p.z + p.vz * h;
    if (!blocked(env, p, ox, oz, nx, nz)) {
      p.x = nx;
      p.z = nz;
    } else if (!blocked(env, p, ox, oz, nx, oz)) {
      p.x = nx;
      p.vz *= 0.5;
    } else if (!blocked(env, p, ox, oz, ox, nz)) {
      p.z = nz;
      p.vx *= 0.5;
    } else {
      p.vx = 0;
      p.vz = 0;
    }
    resolveCollisions(env, p);
    result.distance += Math.hypot(p.x - ox, p.z - oz);

    // vertical
    const ground = t.heightAt(p.x, p.z);
    if (p.grounded) {
      if (p.y - ground <= P.stepDown) {
        p.y = ground;
        p.vy = 0;
      } else {
        p.grounded = false;
      }
    }
    if (!p.grounded) {
      p.vy -= P.gravity * h;
      p.y += p.vy * h;
      if (p.y <= ground) {
        result.landed = Math.max(result.landed, -p.vy);
        p.y = ground;
        p.vy = 0;
        p.grounded = true;
      }
    }
  }
  return result;
}

export function horizontalSpeed(p: PlayerState): number {
  return Math.hypot(p.vx, p.vz);
}

/** Camera look direction for yaw/pitch (three.js YXZ order, camera looks down -Z). */
export function lookDir(yaw: number, pitch: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}
