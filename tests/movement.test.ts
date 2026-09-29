import { describe, expect, it } from 'vitest';
import { box, circle } from '../src/core/geom2d';
import { BALANCE } from '../src/data/balance';
import { makeCollider, type Collider } from '../src/sim/colliders';
import { createPlayer, horizontalSpeed, lookDir, stepPlayer, SWIM_FLOAT_Y, type MoveInput } from '../src/sim/movement';
import type { PlayerState } from '../src/sim/state';
import type { Terrain } from '../src/sim/terrain';
import { rockTop } from '../src/sim/trunks';
import { colliderQuery, fakeTerrain, input, quietSim, run, teleport } from './helpers';

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

describe('standing on boulders and fallen trunks', () => {
  // a boulder at x=3 whose top is 0.8 above the ground (within jump height)
  const domeTop = { type: 'dome' as const, x: 3, z: 0, base: 1.9, height: 0.9, ax: 1, az: 1, rot: 0 };
  const rock = makeCollider('rock', 0, circle(3, 0, 0.85), circle(3, 0, 0.9), domeTop);
  const rockPeak = domeTop.base + domeTop.height;

  /** Walk toward +X, jumping once past `jumpAt`, and stop as soon as you've landed on something raised. */
  function jumpOnto(p: PlayerState, colliders: Collider[], jumpAt: number, raised: number) {
    const env = { terrain: flat, query: colliderQuery(colliders) };
    let jumped = false;
    let onTop = false;
    for (let i = 0; i < 240; i++) {
      const wantJump = !jumped && p.x >= jumpAt;
      const r = stepPlayer(p, onTop ? mv() : mv({ moveZ: 1, jumpPressed: wantJump }), env, 1 / 60, opts);
      if (r.jumped) jumped = true;
      if (jumped && p.grounded && p.y > raised) onTop = true;
    }
    return { jumped, onTop };
  }

  it('walking into a boulder is blocked like a wall', () => {
    const p = createPlayer(0, 2, 0, 0);
    sim(p, flat, 2, mv({ moveZ: 1 }), 1 / 60, [rock]);
    expect(p.x).toBeLessThan(3 - 1);
    expect(p.x).toBeGreaterThan(1);
    expect(p.y).toBeCloseTo(2, 1);
    expect(p.grounded).toBe(true);
  });

  it('you can jump onto a boulder and stand on top without sliding off or sinking in', () => {
    const p = createPlayer(0, 2, 0, 0);
    const r = jumpOnto(p, [rock], 1.2, 2.4);
    expect(r).toEqual({ jumped: true, onTop: true });
    expect(Math.abs(p.x - 3)).toBeLessThan(1);
    const y = p.y;
    sim(p, flat, 1, mv(), 1 / 60, [rock]);
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(y, 6);
    expect(p.y).toBeGreaterThan(rockPeak - 0.3);
    expect(p.y).toBeLessThanOrEqual(rockPeak + 1e-9);
  });

  it('walks off the far side of a boulder back onto the ground', () => {
    const p = createPlayer(3, rockPeak, 0, 0);
    sim(p, flat, 2, mv({ moveZ: 1 }), 1 / 60, [rock]);
    expect(p.x).toBeGreaterThan(5);
    expect(p.y).toBeCloseTo(2, 6);
    expect(p.grounded).toBe(true);
  });

  it('a boulder taller than a jump cannot be climbed by hopping onto its steep side', () => {
    const tall = makeCollider('rock', 0, circle(3, 0, 0.85), circle(3, 0, 0.9), { ...domeTop, height: 2.5 });
    const p = createPlayer(0, 2, 0, 0);
    const env = { terrain: flat, query: colliderQuery([tall]) };
    let maxY = p.y;
    let jumps = 0;
    for (let i = 0; i < 360; i++) {
      const r = stepPlayer(p, mv({ moveZ: 1, jumpPressed: p.grounded && p.x > 1 }), env, 1 / 60, opts);
      if (r.jumped) jumps++;
      maxY = Math.max(maxY, p.y);
    }
    expect(jumps).toBeGreaterThan(3);
    expect(maxY).toBeLessThan(2 + P.jumpHeight + 0.05);
    sim(p, flat, 1, mv(), 1 / 60, [tall]);
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(2, 6);
    expect(p.x).toBeLessThan(3 - 1);
  });

  it('a fallen trunk blocks walking but can be hopped onto', () => {
    // trunk lying across the path along Z at x=3, radius 0.4, top 0.68 above the ground
    const shape = box(3, 0, 3, 0.4, Math.PI / 2);
    const trunk = makeCollider('trunk', 0, shape, shape, { type: 'slab', shape, lift: 0.68 });
    const walker = createPlayer(0, 2, 0, 0);
    sim(walker, flat, 2, mv({ moveZ: 1 }), 1 / 60, [trunk]);
    expect(walker.x).toBeLessThan(3 - 0.4 - P.radius + 0.05);
    const hopper = createPlayer(0, 2, 0, 0);
    expect(jumpOnto(hopper, [trunk], 1.8, 2.4)).toEqual({ jumped: true, onTop: true });
    expect(hopper.y).toBeCloseTo(2.68, 6);
  });

  it('animals are still kept out by the boulder body (tops only affect the player)', () => {
    expect(rock.body).not.toBeNull();
    expect(rock.top).toBe(domeTop);
  });
});

describe('boulders in the world', () => {
  it('every boulder has a standable top matching its size, and still blocks animals', () => {
    const w = quietSim();
    const out: Collider[] = [];
    w.gen.rocks.slice(0, 40).forEach((r, i) => {
      w.queryColliders(r.x, r.z, 0.1, out);
      const c = out.find((k) => k.kind === 'rock' && k.ref === i)!;
      expect(c.top).toEqual(rockTop(r, w.terrain.heightAt(r.x, r.z)));
      expect(c.body).not.toBeNull();
      const peak = c.top!.type === 'dome' ? c.top!.base + c.top!.height : 0;
      expect(peak - w.terrain.heightAt(r.x, r.z)).toBeGreaterThan(0.2);
      expect(peak - w.terrain.heightAt(r.x, r.z)).toBeLessThan(r.r * 1.1);
    });
  });

  it('a small boulder near spawn can be jumped onto and stood on', () => {
    const w = quietSim();
    const t = w.terrain;
    const sp = w.state.player;
    const candidates = w.gen.rocks
      .map((r) => ({ r, top: rockTop(r, t.heightAt(r.x, r.z)) }))
      .filter(({ r, top }) => {
        if (top.type !== 'dome') return false;
        const rise = top.base + top.height - t.heightAt(r.x, r.z);
        const sx = r.x - Math.max(top.ax, top.az) - 2;
        const clear = w.gen.trees.every((tr) => Math.hypot(tr.x - r.x, tr.z - r.z) > Math.max(top.ax, top.az) + 4);
        const others = w.gen.rocks.every((o) => o === r || Math.hypot(o.x - r.x, o.z - r.z) > 7);
        return rise > 0.4 && rise < 0.85 && clear && others && t.slopeAt(r.x, r.z) < 0.15 && t.slopeAt(sx, r.z) < 0.15 && t.waterDepth(sx, r.z) === 0;
      })
      .sort((a, b) => Math.hypot(a.r.x - sp.x, a.r.z - sp.z) - Math.hypot(b.r.x - sp.x, b.r.z - sp.z));
    expect(candidates.length).toBeGreaterThan(0);
    const { r, top } = candidates[0];
    const reachX = Math.max(top.type === 'dome' ? top.ax : 0, top.type === 'dome' ? top.az : 0);
    teleport(w, r.x - reachX - 2, r.z);
    const ground = t.heightAt(r.x, r.z);
    let jumped = false;
    let on = false;
    for (let i = 0; i < 180 && !on; i++) {
      const p = w.state.player;
      const jump = !jumped && p.x > r.x - reachX - 0.9;
      w.step(1 / 60, input({ moveZ: 1, jumpPressed: jump, yaw: -Math.PI / 2 }));
      if (jump) jumped = true;
      on = jumped && p.grounded && p.y > ground + 0.3;
    }
    expect(on).toBe(true);
    run(w, 1, { yaw: -Math.PI / 2 });
    expect(w.state.player.grounded).toBe(true);
    expect(w.state.player.y).toBeGreaterThan(ground + 0.3);
  });
});

describe('swimming in the world', () => {
  function inLake() {
    const w = quietSim();
    const lake = w.terrain.lakes.find((l) => l.depth > P.swimDepth + 0.5)!;
    teleport(w, lake.x, lake.z);
    run(w, 1.5, {});
    return w;
  }

  it('deep lake water floats you, and swimming drains energy gently', () => {
    const w = inLake();
    const p = w.state.player;
    expect(p.swimming).toBe(true);
    expect(p.y).toBeCloseTo(SWIM_FLOAT_Y, 1);
    expect(w.activity).toBe('swim');
    w.state.needs.energy = 50;
    run(w, 10, {});
    expect(w.state.needs.energy).toBeCloseTo(50 - BALANCE.needs.energy.swimDrainPerSec * 10, 1);
  });

  it('cold rules are unchanged: swimming chills you exactly like wading', () => {
    const w = inLake();
    const p = w.state.player;
    expect(p.wading).toBe(true);
    const swimming = w.warmthTarget();
    p.swimming = false;
    expect(w.warmthTarget()).toEqual(swimming);
    p.wading = false;
    expect(w.warmthTarget().target).toBeCloseTo(swimming.target + BALANCE.needs.warmth.wadingPenalty);
  });

  it('jumping into deep water makes a splash event', () => {
    const w = inLake();
    const p = w.state.player;
    p.swimming = false;
    p.grounded = false;
    p.y = 2;
    const ev = run(w, 1, {});
    expect(ev.some((e) => e.type === 'splash' && e.impact > 3)).toBe(true);
    expect(ev.some((e) => e.type === 'land')).toBe(false);
  });
});

describe('swimming', () => {
  // shore at x<4, water deepens past swimming depth around x=6.5
  const lake = fakeTerrain((x) => 2 - x * 0.5);
  const floating = (x: number) => {
    const p = createPlayer(x, SWIM_FLOAT_Y, 0, 0);
    p.swimming = true;
    p.grounded = false;
    p.wading = true;
    return p;
  };

  it('floats at a steady depth, swims at swim speed and cannot sprint or jump', () => {
    const p = floating(12);
    const res = sim(p, lake, 1.5, (i) => mv({ moveZ: 1, sprint: true, jumpPressed: i % 10 === 0 }));
    expect(res.some((r) => r.jumped)).toBe(false);
    expect(p.swimming).toBe(true);
    expect(p.sprinting).toBe(false);
    expect(p.y).toBeCloseTo(SWIM_FLOAT_Y, 6);
    expect(horizontalSpeed(p)).toBeCloseTo(P.swimSpeed, 1);
  });

  it('treading water in place stays afloat', () => {
    const p = floating(12);
    sim(p, lake, 3, mv());
    expect(p.swimming).toBe(true);
    expect(p.y).toBeCloseTo(SWIM_FLOAT_Y, 6);
    expect(horizontalSpeed(p)).toBeLessThan(0.05);
  });

  it('swimming back to shore, you stand up and walk out', () => {
    const p = floating(12);
    sim(p, lake, 6, mv({ moveZ: 1, yaw: Math.PI / 2 })); // face -X
    expect(p.swimming).toBe(false);
    expect(p.grounded).toBe(true);
    expect(p.x).toBeLessThan(3);
    expect(p.wading).toBe(false);
    expect(p.y).toBeCloseTo(lake.heightAt(p.x, p.z), 6);
  });

  it('dropping into deep water splashes instead of landing', () => {
    const deep = fakeTerrain(() => -4);
    const p = createPlayer(0, 3, 0, 0);
    p.grounded = false;
    const res = sim(p, deep, 1.5, mv());
    const splash = res.filter((r) => r.splash > 0);
    expect(splash).toHaveLength(1);
    expect(splash[0].splash).toBeGreaterThan(5);
    expect(res.every((r) => r.landed === 0)).toBe(true);
    expect(p.swimming).toBe(true);
    expect(p.y).toBeCloseTo(SWIM_FLOAT_Y, 6);
  });

  it('water shallower than swimming depth never makes you swim, even landing from a jump', () => {
    const shallow = fakeTerrain(() => -(P.swimDepth - 0.2));
    const p = createPlayer(0, shallow.heightAt(0, 0), 0, 0);
    sim(p, shallow, 1, mv({ moveZ: 1, jumpPressed: true }));
    expect(p.swimming).toBe(false);
    expect(p.wading).toBe(true);
  });
});
