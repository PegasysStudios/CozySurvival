import { pushCircleOut } from '../core/geom2d';
import { damp } from '../core/math';
import { BALANCE } from '../data/balance';
import { topHeight, type Collider } from './colliders';
import type { PlayerState } from './state';
import { WATER_LEVEL, type Terrain } from './terrain';

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
  /** Seasonal ice is per simulation, never a mutation of the shared terrain cache. */
  readonly frozen?: boolean;
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
  /** Downward speed when dropping into deep water (0 if not this step). */
  splash: number;
}

/** Feet height while floating in deep water. */
export const SWIM_FLOAT_Y = WATER_LEVEL - P.swimDepth;
/** Extra depth needed before wading turns into swimming, so the two don't flicker at the threshold. */
const SWIM_ENTER_MARGIN = 0.1;

export function createPlayer(x: number, y: number, z: number, yaw: number): PlayerState {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0,
    grounded: true, coyote: 0, jumpBuffer: 0, sprinting: false, wading: false, swimming: false, sitting: false, hurtTimer: 0,
  };
}

const tmpColliders: Collider[] = [];
const tmpTops: Collider[] = [];
const push = [0, 0];

/** Height you stand at: the terrain, or the top of a boulder, log or fallen trunk under your footprint. */
export function surfaceAt(env: MoveEnv, x: number, z: number): number {
  const t = env.terrain;
  let h = t.heightAt(x, z);
  if (env.frozen) h = Math.max(h, WATER_LEVEL);
  env.query(x, z, P.radius + 0.5, tmpTops);
  for (let i = 0; i < tmpTops.length; i++) {
    const top = tmpTops[i].top;
    if (!top) continue;
    const th = topHeight(top, x, z, P.radius, t);
    if (th > h) h = th;
  }
  return h;
}

const SLOPE_PROBE = 0.05;
const flank = { x: 0, z: 0, slope: 0 };

/** Whether `ground` at (x, z) is a boulder flank too steep to stand on. If so, `flank` holds the downhill direction and slope. */
function onSteepFlank(env: MoveEnv, x: number, z: number, ground: number): boolean {
  env.query(x, z, P.radius + 0.5, tmpTops);
  let dome = false;
  for (let i = 0; i < tmpTops.length && !dome; i++) {
    const top = tmpTops[i].top;
    dome = !!top && top.type === 'dome' && Math.abs(topHeight(top, x, z, P.radius, env.terrain) - ground) < 1e-9;
  }
  if (!dome) return false;
  const e = SLOPE_PROBE;
  const gx = (surfaceAt(env, x + e, z) - surfaceAt(env, x - e, z)) / (2 * e);
  const gz = (surfaceAt(env, x, z + e) - surfaceAt(env, x, z - e)) / (2 * e);
  const g = Math.hypot(gx, gz);
  if (g <= P.maxSlope) return false;
  flank.x = -gx / g;
  flank.z = -gz / g;
  flank.slope = g;
  return true;
}

/**
 * A falling player who meets a steep boulder flank is pushed out beside it and keeps falling, as if it were a wall.
 * Without this you could land on the side of a boulder taller than a jump and hop your way up it.
 */
function slipOffFlank(env: MoveEnv, p: PlayerState): void {
  for (let k = 0; k < 4; k++) {
    const g = surfaceAt(env, p.x, p.z);
    if (g <= p.y || !onSteepFlank(env, p.x, p.z, g)) break;
    const d = (g - p.y) / flank.slope + 0.01;
    p.x += flank.x * d;
    p.z += flank.z * d;
    const into = -(p.vx * flank.x + p.vz * flank.z);
    if (into > 0) {
      p.vx += flank.x * into;
      p.vz += flank.z * into;
    }
  }
}

function blocked(env: MoveEnv, p: PlayerState, hFrom: number, fx: number, fz: number, tx: number, tz: number): boolean {
  if (!env.terrain.inPlayBounds(tx, tz)) return true;
  const hTo = surfaceAt(env, tx, tz);
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
      if (!c.body || c.top) continue;
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
 * slope blocking with axis sliding, standable boulder/trunk tops, floating in deep water,
 * and circle/box obstacle push-out.
 * Integrates in substeps so feel is identical at 30, 60, or 144 fps.
 */
export function stepPlayer(p: PlayerState, input: MoveInput, env: MoveEnv, dt: number, opts: MoveOptions): MoveResult {
  const result: MoveResult = { jumped: false, landed: 0, distance: 0, splash: 0 };
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
  for (let s = 0; s < steps; s++) {
    const surface = surfaceAt(env, p.x, p.z);
    p.wading = WATER_LEVEL - surface > P.wadeDepth;
    p.sprinting = input.sprint && opts.canSprint && !opts.exhausted && mz > 0.3 && !p.wading;
    let speed = p.swimming ? P.swimSpeed : p.sprinting ? P.sprintSpeed : P.walkSpeed;
    if (opts.exhausted) speed *= BALANCE.needs.energy.exhaustedSpeedMul;
    if (p.wading && !p.swimming) speed *= P.wadeSpeedMul;
    const tvx = wx * speed;
    const tvz = wz * speed;
    const rate = p.swimming ? P.swimAccel : p.grounded ? (moving ? P.groundAccel : P.groundDecel) : P.airAccel;
    p.vx = damp(p.vx, tvx, rate, h);
    p.vz = damp(p.vz, tvz, rate, h);
    if (!moving && p.grounded && Math.abs(p.vx) < 0.01 && Math.abs(p.vz) < 0.01) {
      p.vx = 0;
      p.vz = 0;
    }

    if (p.grounded) p.coyote = P.coyoteTime;
    else p.coyote = Math.max(0, p.coyote - h);
    if (p.jumpBuffer > 0 && (p.grounded || p.coyote > 0) && !p.sitting && !p.swimming) {
      p.vy = JUMP_VELOCITY;
      p.grounded = false;
      p.coyote = 0;
      p.jumpBuffer = 0;
      result.jumped = true;
    }
    p.jumpBuffer = Math.max(0, p.jumpBuffer - h);

    // horizontal with slope blocking and axis sliding
    const ox = p.x;
    const oz = p.z;
    const nx = p.x + p.vx * h;
    const nz = p.z + p.vz * h;
    const hFrom = p.swimming ? Math.max(surface, p.y) : surface;
    if (!blocked(env, p, hFrom, ox, oz, nx, nz)) {
      p.x = nx;
      p.z = nz;
    } else if (!blocked(env, p, hFrom, ox, oz, nx, oz)) {
      p.x = nx;
      p.vz *= 0.5;
    } else if (!blocked(env, p, hFrom, ox, oz, ox, nz)) {
      p.z = nz;
      p.vx *= 0.5;
    } else {
      p.vx = 0;
      p.vz = 0;
    }
    resolveCollisions(env, p);
    result.distance += Math.hypot(p.x - ox, p.z - oz);

    // vertical
    const ground = surfaceAt(env, p.x, p.z);
    if (p.swimming) {
      if (ground >= SWIM_FLOAT_Y) {
        p.swimming = false;
        p.grounded = true;
        p.y = ground;
        p.vy = 0;
      } else {
        p.vy = 0;
        p.y = damp(p.y, SWIM_FLOAT_Y, 6, h);
      }
    } else if (p.grounded) {
      if (ground < SWIM_FLOAT_Y - SWIM_ENTER_MARGIN) {
        p.swimming = true;
        p.grounded = false;
        p.vy = 0;
      } else if (p.y - ground <= P.stepDown) {
        p.y = ground;
        p.vy = 0;
      } else {
        p.grounded = false;
      }
    }
    if (!p.grounded && !p.swimming) {
      p.vy -= P.gravity * h;
      p.y += p.vy * h;
      if (ground < SWIM_FLOAT_Y && p.y <= SWIM_FLOAT_Y) {
        result.splash = Math.max(result.splash, -p.vy);
        p.swimming = true;
        p.y = SWIM_FLOAT_Y;
        p.vy = 0;
      } else if (p.y <= ground && onSteepFlank(env, p.x, p.z, ground)) {
        slipOffFlank(env, p);
      } else if (p.y <= ground) {
        result.landed = Math.max(result.landed, -p.vy);
        p.y = ground;
        p.vy = 0;
        p.grounded = true;
      }
    }
    if (p.swimming) p.wading = true;
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
