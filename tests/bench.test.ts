import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { PREFABS } from '../src/data/prefabs';
import { F_SIT } from '../src/net/protocol';
import { localPose } from '../src/net/session';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation, seatFor } from '../src/sim/simulation';
import type { StructureState } from '../src/sim/state';
import { drain, placeStructure, quietSim, run } from './helpers';

/** Bench-local coordinates of a world point (the bench runs along local x, its long sides face local ±z). */
function local(st: StructureState, x: number, z: number): { lx: number; lz: number } {
  const c = Math.cos(st.rot);
  const s = Math.sin(st.rot);
  const dx = x - st.x;
  const dz = z - st.z;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

function world(st: StructureState, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(st.rot);
  const s = Math.sin(st.rot);
  return { x: st.x + lx * c + lz * s, z: st.z - lx * s + lz * c };
}

/** Stand the player at bench-local (lx, lz), facing the bench, and click it. */
function sitFrom(sim: Simulation, bench: StructureState, lx: number, lz: number): void {
  const p = sim.state.player;
  const w = world(bench, lx, lz);
  p.x = w.x;
  p.z = w.z;
  p.y = sim.terrain.heightAt(w.x, w.z);
  p.yaw = Math.atan2(-(bench.x - w.x), -(bench.z - w.z));
  sim.perform({ kind: 'structure', id: bench.id, dist: 1 });
}

const box = (f: (typeof PREFABS)['bench']['footprint']) => (f.type === 'box' ? f : { hw: f.r, hd: f.r });
const forward = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

describe('sitting on a bench (round 8)', () => {
  for (const side of [1, -1]) {
    it(`sits on the seat facing out over the ${side > 0 ? 'front' : 'back'} side it was approached from`, () => {
      const sim = quietSim();
      const bench = placeStructure(sim, 'bench');
      sitFrom(sim, bench, 0.3, side * 1.2);
      const p = sim.state.player;
      expect(p.sitting).toBe(true);
      expect(p.seat?.id).toBe(bench.id);
      // on the seat: on its centre line, level with where the player stood along it, at the bench's own height
      const at = local(bench, p.x, p.z);
      expect(at.lx).toBeCloseTo(0.3, 5);
      expect(Math.abs(at.lz)).toBeLessThan(0.1);
      expect(p.y).toBeCloseTo(bench.y, 5);
      // facing outward, toward the side approached from
      const f = forward(p.seat!.yaw);
      const out = local(bench, bench.x + f.x, bench.z + f.z);
      expect(out.lz).toBeCloseTo(side, 5);
      expect(out.lx).toBeCloseTo(0, 5);
      expect(p.yaw).toBeCloseTo(p.seat!.yaw, 5);
      expect(drain(sim).find((e) => e.type === 'sat')).toMatchObject({ type: 'sat', yaw: p.seat!.yaw });
    });
  }

  it('seatFor clamps to the bench so you never sit off its ends', () => {
    const bench = { id: 1, prefab: 'bench', x: 10, y: 0, z: -4, rot: 0.7, fuel: 0 } as StructureState;
    const far = world(bench, 5, 1);
    const seat = seatFor(bench, far);
    const at = local(bench, seat.x, seat.z);
    expect(at.lx).toBeLessThanOrEqual(box(PREFABS.bench.footprint).hw - 0.35);
    expect(at.lx).toBeGreaterThan(0.5);
  });

  it('stays put while seated, even when bumped, until a move key stands you up in front of the bench', () => {
    const sim = quietSim();
    const bench = placeStructure(sim, 'bench');
    sitFrom(sim, bench, -0.2, -1.1);
    const p = sim.state.player;
    const seat = { x: p.x, z: p.z };
    p.vx = 3;
    run(sim, 1);
    expect(p.sitting).toBe(true);
    expect(Math.hypot(p.x - seat.x, p.z - seat.z)).toBeLessThan(1e-9);
    // looking around doesn't stand you up or turn the body
    run(sim, 0.5, { yaw: p.seat!.yaw + 1.2 });
    expect(p.sitting).toBe(true);
    const yaw = p.seat!.yaw;
    run(sim, 0.05, { moveZ: 1, yaw });
    expect(p.sitting).toBe(false);
    expect(p.seat).toBeUndefined();
    const at = local(bench, p.x, p.z);
    expect(at.lz).toBeLessThan(-(box(PREFABS.bench.collider).hd + BALANCE.player.radius) + 0.01);
  });

  it('clicking the bench again, getting hurt, or the bench going away stands you up', () => {
    const sim = quietSim();
    const bench = placeStructure(sim, 'bench');
    sitFrom(sim, bench, 0, 1.2);
    sim.target = { kind: 'structure', id: bench.id, dist: 0.5 };
    expect(sim.describeTarget()).toMatchObject({ action: 'Stand up' });
    sim.perform(sim.target);
    expect(sim.state.player.sitting).toBe(false);
    sitFrom(sim, bench, 0, 1.2);
    sim.devDamage(1);
    expect(sim.state.player.sitting).toBe(false);
    sitFrom(sim, bench, 0, 1.2);
    sim.deleteStructure(bench.id);
    expect(sim.state.player.sitting).toBe(false);
    expect(sim.state.player.seat).toBeUndefined();
  });

  it('other players see you seated, body facing out from the bench', () => {
    const sim = quietSim();
    const bench = placeStructure(sim, 'bench');
    sitFrom(sim, bench, 0, -1.2);
    sim.state.player.yaw += 0.8;
    const pose = localPose(sim, 0);
    expect(pose.flags & F_SIT).toBe(F_SIT);
    expect(pose.yaw).toBeCloseTo(sim.state.player.seat!.yaw, 5);
    expect([pose.x, pose.z]).toEqual([sim.state.player.x, sim.state.player.z]);
  });

  it('saves keep you on the bench; a pre-round-8 save that was "sitting" in place stands up', () => {
    const sim = quietSim();
    const bench = placeStructure(sim, 'bench');
    sitFrom(sim, bench, 0, 1.2);
    const s = deserializeState(serializeState(sim.state))!;
    expect(s.player.seat).toEqual(sim.state.player.seat);
    expect(s.player.sitting).toBe(true);
    const old = JSON.parse(serializeState(sim.state));
    old.version = 3;
    delete old.player.seat;
    const o = deserializeState(JSON.stringify(old))!;
    expect(o.player.sitting).toBe(false);
  });
});
