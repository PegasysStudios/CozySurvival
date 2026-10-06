import { describe, expect, it } from 'vitest';
import { box, toLocal, toWorld, type BoxShape } from '../src/core/geom2d';
import type { BiomeId } from '../src/data/biomes';
import { BALANCE } from '../src/data/balance';
import { topHeight, type Collider } from '../src/sim/colliders';
import { createPlayer, stepPlayer, type MoveInput } from '../src/sim/movement';
import { Simulation } from '../src/sim/simulation';
import { colliderQuery, fakeTerrain } from './helpers';

const P = BALANCE.player;
const opts = { canSprint: true, exhausted: false };

function firstLog() {
  const world = Simulation.newGame(42, 'pnw', 1);
  const log = world.gen.logs[0];
  const hits: Collider[] = [];
  world.queryColliders(log.x, log.z, 0.1, hits);
  const collider = hits.find((c) => c.kind === 'log' && c.ref === 0)!;
  const shape = collider.body as BoxShape;
  const ground = world.terrain.heightAt(log.x, log.z);
  const height = ground + log.r * 1.7;
  const env = { terrain: fakeTerrain(() => ground), query: colliderQuery([collider]) };
  const [x, z] = toWorld(shape, 0, -3, []);
  const player = createPlayer(x, ground, z, shape.rot + Math.PI);
  const move = (over: Partial<MoveInput> = {}): MoveInput => ({
    moveX: 0, moveZ: 0, jumpPressed: false, sprint: false, yaw: player.yaw, ...over,
  });
  const local = () => toLocal(shape, player.x, player.z, []);
  return { log, collider, shape, ground, height, env, player, move, local };
}

describe('map fallen logs', () => {
  it.each<BiomeId>(['pnw', 'desert', 'island'])('gives every %s log a finite top matching its rendered height and rotation', (biome) => {
    const world = Simulation.newGame(42, biome);
    const hits: Collider[] = [];
    expect(world.gen.logs.length).toBeGreaterThan(0);
    world.gen.logs.forEach((log, i) => {
      world.queryColliders(log.x, log.z, 0.1, hits);
      const c = hits.find((hit) => hit.kind === 'log' && hit.ref === i)!;
      expect(c.body).toEqual(box(log.x, log.z, log.length / 2, log.r, log.rot));
      expect(c.footprint).toEqual(box(log.x, log.z, log.length / 2 + 0.1, log.r + 0.1, log.rot));
      expect(c.top).toBeDefined();
      const height = world.terrain.heightAt(log.x, log.z) + log.r * 1.7;
      expect(topHeight(c.top!, log.x, log.z, P.radius, world.terrain)).toBeCloseTo(height, 6);
      const shape = c.body as BoxShape;
      // The rendered log is horizontal, anchored to the ground at its centre, even on a slope.
      for (const lx of [-log.length / 2 + 0.1, log.length / 2 - 0.1]) {
        const [x, z] = toWorld(shape, lx, 0, []);
        expect(topHeight(c.top!, x, z, P.radius, world.terrain)).toBeCloseTo(height, 6);
      }
      for (const [lx, lz] of [[log.length / 2 + P.radius + 0.1, 0], [0, log.r + P.radius + 0.1]]) {
        const [x, z] = toWorld(shape, lx, lz, []);
        expect(topHeight(c.top!, x, z, P.radius, world.terrain)).toBe(-Infinity);
      }
    });
  });

  it('still blocks walking into a log at ground level', () => {
    const { player, env, move, local, log, ground } = firstLog();
    for (let i = 0; i < 120; i++) stepPlayer(player, move({ moveZ: 1 }), env, 1 / 60, opts);
    expect(local()[1]).toBeLessThanOrEqual(-log.r - P.radius + 0.05);
    expect(player.y).toBeCloseTo(ground, 6);
    expect(player.grounded).toBe(true);
  });

  it.each([30, 60, 144])('can jump onto a rotated log and stay standing at %i fps', (fps) => {
    const { player, env, shape, height, ground, move, local, log } = firstLog();
    const [x, z] = toWorld(shape, 0, -log.r - P.radius - 0.15, []);
    Object.assign(player, { x, z });
    let jumped = false;
    for (let i = 0; i < fps * 2; i++) {
      const result = stepPlayer(player, move({ moveZ: local()[1] < 0 ? 0.5 : 0, jumpPressed: i === 0 }), env, 1 / fps, opts);
      jumped ||= result.jumped;
    }
    expect(jumped).toBe(true);
    expect(player.grounded).toBe(true);
    expect(Math.abs(local()[1])).toBeLessThan(log.r + P.radius);
    expect(player.y).toBeCloseTo(height, 6);
    for (let i = 0; i < fps; i++) stepPlayer(player, move(), env, 1 / fps, opts);
    expect(player.y).toBeCloseTo(height, 6);
    expect(player.grounded).toBe(true);

    // Walk along the log's length, then off its end back to the terrain.
    for (let i = 0; i < fps * 2; i++) {
      stepPlayer(player, move({ moveZ: 1, yaw: shape.rot - Math.PI / 2 }), env, 1 / fps, opts);
    }
    expect(local()[0]).toBeGreaterThan(shape.hw + P.radius);
    expect(player.y).toBeCloseTo(ground, 6);
    expect(player.grounded).toBe(true);
  });

  it.each([30, 60, 144])('can jump over a rotated log without hitting a wall above it at %i fps', (fps) => {
    const { player, env, height, ground, move, local, log } = firstLog();
    let jumped = false;
    let crossedAbove = false;
    for (let i = 0; i < fps * 2; i++) {
      const result = stepPlayer(player, move({ moveZ: 1, jumpPressed: !jumped && local()[1] >= -1.3 }), env, 1 / fps, opts);
      jumped ||= result.jumped;
      crossedAbove ||= local()[1] >= 0 && !player.grounded && player.y > height + 0.05;
    }
    expect(jumped).toBe(true);
    expect(crossedAbove).toBe(true);
    expect(local()[1]).toBeGreaterThan(log.r + P.radius + 1);
    expect(player.y).toBeCloseTo(ground, 6);
    expect(player.grounded).toBe(true);
  });
});
