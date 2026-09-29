import { describe, expect, it } from 'vitest';
import { box, circle } from '../src/core/geom2d';
import { BALANCE } from '../src/data/balance';
import { makeCollider, type Collider } from '../src/sim/colliders';
import { createPlayer, horizontalSpeed, lookDir, stepPlayer, SWIM_FLOAT_Y, type MoveInput } from '../src/sim/movement';
import type { PlayerState } from '../src/sim/state';
import type { Terrain } from '../src/sim/terrain';
import { colliderQuery, fakeTerrain } from './helpers';

const P = BALANCE.player;
const flat = fakeTerrain(() => 2);
const opts = { canSprint: true, exhausted: false };

function mv(over: Partial<MoveInput> = {}): MoveInput {
  // yaw = -PI/2 faces +X
  return { moveX: 0, moveZ: 0, jumpPressed: false, sprint: false, yaw: -Math.PI / 2, ...over };
}

function sim(p: PlayerState, t: Terrain, seconds: number, inp: MoveInput | ((i: number) => MoveInput), dt = 1 / 60, colliders: Collider[] = [], o = opts) {
  const env = { terrain: t, query: colliderQuery(colliders) };
  const n = Math.round(seconds / dt);
  const results = [];
  for (let i = 0; i < n; i++) results.push(stepPlayer(p, typeof inp === 'function' ? inp(i) : inp, env, dt, o));
  return results;
}

describe('look direction', () => {
  it('matches three.js camera conventions', () => {
    const d = lookDir(0, 0, { x: 0, y: 0, z: 0 });
    expect(d.z).toBeCloseTo(-1);
    const r = lookDir(-Math.PI / 2, 0, { x: 0, y: 0, z: 0 });
    expect(r.x).toBeCloseTo(1);
    expect(lookDir(0, Math.PI / 2, { x: 0, y: 0, z: 0 }).y).toBeCloseTo(1);
  });
});

describe('ground movement feel', () => {
  it('accelerates snappily to walk speed and moves in the facing direction', () => {
    const p = createPlayer(0, 2, 0, 0);
    sim(p, flat, 0.25, mv({ moveZ: 1 }));
    expect(horizontalSpeed(p)).toBeGreaterThan(P.walkSpeed * 0.95);
    expect(p.x).toBeGreaterThan(0.5);
    expect(Math.abs(p.z)).toBeLessThan(1e-6);
  });

  it('sprints only when moving forward with energy', () => {
    const p = createPlayer(0, 2, 0, 0);
    sim(p, flat, 0.5, mv({ moveZ: 1, sprint: true }));
    expect(horizontalSpeed(p)).toBeCloseTo(P.sprintSpeed, 1);
    const back = createPlayer(0, 2, 0, 0);
    sim(back, flat, 0.5, mv({ moveZ: -1, sprint: true }));
    expect(horizontalSpeed(back)).toBeCloseTo(P.walkSpeed, 1);
    const tired = createPlayer(0, 2, 0, 0);
    sim(tired, flat, 0.5, mv({ moveZ: 1, sprint: true }), 1 / 60, [], { canSprint: true, exhausted: true });
    expect(horizontalSpeed(tired)).toBeLessThan(P.walkSpeed);
  });

  it('decelerates to a stop quickly with no sliding', () => {
    const p = createPlayer(0, 2, 0, 0);
    sim(p, flat, 0.5, mv({ moveZ: 1 }));
    const x0 = p.x;
    sim(p, flat, 0.3, mv());
    expect(horizontalSpeed(p)).toBeLessThan(0.05);
    expect(p.x - x0).toBeLessThan(0.35);
    sim(p, flat, 0.2, mv());
    expect(horizontalSpeed(p)).toBe(0);
  });

  it('normalizes diagonal input (no faster strafing)', () => {
    const p = createPlayer(0, 2, 0, 0);
    sim(p, flat, 0.5, mv({ moveZ: 1, moveX: 1 }));
    expect(horizontalSpeed(p)).toBeCloseTo(P.walkSpeed, 1);
  });
});

describe('jumping', () => {
  const peak = (dt: number) => {
    let max = 2;
    const q = createPlayer(0, 2, 0, 0);
    const env = { terrain: flat, query: colliderQuery([]) };
    for (let i = 0; i < Math.round(1 / dt); i++) {
      stepPlayer(q, mv({ jumpPressed: i === 0 }), env, dt, opts);
      max = Math.max(max, q.y);
    }
    return { height: max - 2, landed: q.grounded };
  };

  it('has a modest Minecraft-like jump height, identical across frame rates', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      const r = peak(dt);
      expect(r.height).toBeGreaterThan(P.jumpHeight - 0.05);
      expect(r.height).toBeLessThan(P.jumpHeight + 0.05);
      expect(r.landed).toBe(true);
    }
  });

  it('cannot double jump mid-air', () => {
    const p = createPlayer(0, 2, 0, 0);
    const res = sim(p, flat, 0.6, (i) => mv({ jumpPressed: i === 0 || i === 10 }));
    expect(res.filter((r) => r.jumped)).toHaveLength(1);
  });

  it('buffers a jump pressed just before landing', () => {
    const p = createPlayer(0, 2, 0, 0);
    const env = { terrain: flat, query: colliderQuery([]) };
    stepPlayer(p, mv({ jumpPressed: true }), env, 1 / 60, opts);
    let jumps = 0;
    for (let i = 0; i < 120; i++) {
      const nearLanding = !p.grounded && p.vy < 0 && p.y - 2 < 0.15;
      const r = stepPlayer(p, mv({ jumpPressed: nearLanding }), env, 1 / 60, opts);
      if (r.jumped) jumps++;
      if (jumps) break;
    }
    expect(jumps).toBe(1);
  });

  it('allows a coyote-time jump just after walking off a ledge', () => {
    const ledge = fakeTerrain((x) => (x < 1 ? 5 : 3));
    const p = createPlayer(0.5, 5, 0, 0);
    const env = { terrain: ledge, query: colliderQuery([]) };
    let leftAt = -1;
    let jumped = false;
    for (let i = 0; i < 60 && !jumped; i++) {
      const r = stepPlayer(p, mv({ moveZ: 1, jumpPressed: leftAt >= 0 && i === leftAt + 3 }), env, 1 / 60, opts);
      if (leftAt < 0 && !p.grounded) leftAt = i;
      if (r.jumped) jumped = true;
    }
    expect(leftAt).toBeGreaterThanOrEqual(0);
    expect(jumped).toBe(true);
  });
});

describe('terrain following and blocking', () => {
  it('stays glued to the ground walking down a moderate slope (no bouncing)', () => {
    const slope = fakeTerrain((x) => 20 - x * 0.6);
    const p = createPlayer(0, 20, 0, 0);
    const res = sim(p, slope, 3, mv({ moveZ: 1, sprint: true }), 1 / 60);
    expect(p.grounded).toBe(true);
    expect(res.every((r) => r.landed === 0)).toBe(true);
    expect(p.y).toBeCloseTo(slope.heightAt(p.x, p.z), 6);
  });

  it('does not drift or jitter while standing still on a slope', () => {
    const slope = fakeTerrain((x, z) => 10 + x * 0.5 + z * 0.3);
    const p = createPlayer(1, slope.heightAt(1, 1), 1, 0);
    sim(p, slope, 2, mv());
    expect(p.x).toBe(1);
    expect(p.z).toBe(1);
    expect(p.y).toBeCloseTo(slope.heightAt(1, 1), 9);
  });

  it('blocks walking up slopes steeper than the limit, but allows gentle hills', () => {
    const cliff = fakeTerrain((x) => (x < 3 ? 2 : 2 + (x - 3) * 2));
    const p = createPlayer(0, 2, 0, 0);
    sim(p, cliff, 3, mv({ moveZ: 1 }));
    expect(p.x).toBeLessThan(3.1);
    const hill = fakeTerrain((x) => 2 + Math.max(0, x - 3) * 0.5);
    const q = createPlayer(0, 2, 0, 0);
    sim(q, hill, 3, mv({ moveZ: 1 }));
    expect(q.x).toBeGreaterThan(8);
  });

  it('wades slowly in shallows and swims once the water is deep', () => {
    const lake = fakeTerrain((x) => 2 - x * 0.5); // water starts at x=4, swimming depth past ~6.7
    const p = createPlayer(0, 2, 0, 0);
    sim(p, lake, 6, mv({ moveZ: 1 }));
    expect(p.x).toBeGreaterThan(4 + P.swimDepth * 2);
    expect(p.wading).toBe(true);
    expect(p.swimming).toBe(true);
    expect(p.y).toBeCloseTo(SWIM_FLOAT_Y, 1);
    const shallow = fakeTerrain(() => -0.6);
    const q = createPlayer(0, -0.6, 0, 0);
    sim(q, shallow, 1, mv({ moveZ: 1 }));
    expect(horizontalSpeed(q)).toBeCloseTo(P.walkSpeed * P.wadeSpeedMul, 1);
  });
});

describe('solid collisions', () => {
  it('stops at a tree trunk without penetrating', () => {
    const tree = makeCollider('tree', 0, circle(3, 0, 0.4), null);
    const p = createPlayer(0, 2, 0, 0);
    sim(p, flat, 2, mv({ moveZ: 1 }), 1 / 60, [tree]);
    expect(Math.hypot(p.x - 3, p.z)).toBeGreaterThanOrEqual(0.4 + P.radius - 1e-3);
    expect(p.x).toBeGreaterThan(2.1);
  });

  it('slides along a wall when walking into it at an angle', () => {
    const wall = makeCollider('structure', 0, box(3, 0, 0.25, 10, 0), null);
    const p = createPlayer(0, 2, 0, 0);
    // yaw -PI/4 -> heading diagonal (+x, -z)
    sim(p, flat, 2, mv({ moveZ: 1, yaw: -Math.PI / 4 }), 1 / 60, [wall]);
    expect(p.x).toBeLessThan(3 - 0.25 - P.radius + 0.01);
    expect(p.z).toBeLessThan(-3);
  });

  it('never tunnels through obstacles even with a large frame time', () => {
    const tree = makeCollider('tree', 0, circle(1.2, 0, 0.3), null);
    const p = createPlayer(0, 2, 0, 0);
    sim(p, flat, 1, mv({ moveZ: 1, sprint: true }), 0.1, [tree]);
    expect(p.x).toBeLessThan(1.2);
  });

  it('walks through bushes and other non-solid colliders', () => {
    const bush = makeCollider('resource', 0, null, circle(2, 0, 0.6));
    const p = createPlayer(0, 2, 0, 0);
    sim(p, flat, 1.5, mv({ moveZ: 1 }), 1 / 60, [bush]);
    expect(p.x).toBeGreaterThan(4);
  });
});
