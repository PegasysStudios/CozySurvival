import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { TREES } from '../src/data/resources';
import type { Collider } from '../src/sim/colliders';
import { countItem } from '../src/sim/inventory';
import { checkPlacement } from '../src/sim/placement';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { barkStripped, TRUNK_AXIS_LIFT } from '../src/sim/trunks';
import { aimAt, drain, nearestTree, quietSim, run, teleport } from './helpers';

const CUTS = BALANCE.trees.cutsPerLog;

function felledFir() {
  const sim = quietSim();
  sim.state.tools.push('axe');
  sim.selectTool('axe');
  const i = nearestTree(sim, 'fir');
  for (let k = 0; k < TREES.fir.hp; k++) sim.perform({ kind: 'tree', index: i, dist: 1 });
  return { sim, i, events: drain(sim) };
}

function trunkColliders(sim: Simulation, i: number): Collider[] {
  const t = sim.gen.trees[i];
  const out: Collider[] = [];
  sim.queryColliders(t.x, t.z, 12, out);
  return out.filter((c) => c.kind === 'trunk' && c.ref === i);
}

describe('two-step trees', () => {
  it('felling leaves a whole trunk on the ground and gives no wood yet', () => {
    const { sim, i, events } = felledFir();
    const t = sim.gen.trees[i];
    const p = sim.state.player;
    expect(events.some((e) => e.type === 'treeFell')).toBe(true);
    expect(countItem(sim.state.inventory, 'log')).toBe(0);
    expect(sim.state.trees[i]).toMatchObject({ felled: true, logs: TREES.fir.logs, cuts: 0 });
    const span = sim.trunk(i)!;
    expect(span).not.toBeNull();
    expect(span.len).toBeCloseTo(TREES.fir.fallLength * t.scale);
    // falls away from the player
    expect(span.dx * (t.x - p.x) + span.dz * (t.z - p.z)).toBeGreaterThan(0);
    const cs = trunkColliders(sim, i);
    expect(cs).toHaveLength(1);
    expect(cs[0].top?.type).toBe('slab');
    expect(cs[0].body).not.toBeNull();
  });

  it('chopping the trunk frees a log every few hits, shortening it from the stump end', () => {
    const { sim, i } = felledFir();
    const before = sim.trunk(i)!;
    const piece = before.len / TREES.fir.logs;
    for (let k = 0; k < CUTS - 1; k++) sim.perform({ kind: 'tree', index: i, dist: 1 });
    const ev = drain(sim);
    expect(ev.filter((e) => e.type === 'chop' && e.trunk)).toHaveLength(CUTS - 1);
    expect(ev.some((e) => e.type === 'treeFell')).toBe(false);
    expect(countItem(sim.state.inventory, 'log')).toBe(0);
    sim.perform({ kind: 'tree', index: i, dist: 1 });
    expect(countItem(sim.state.inventory, 'log')).toBe(1);
    expect(sim.state.trees[i]).toMatchObject({ logs: TREES.fir.logs - 1, cuts: 0 });
    const after = sim.trunk(i)!;
    expect(after.len).toBeCloseTo(before.len - piece);
    expect(after.x1).toBeCloseTo(before.x1);
    expect(after.z1).toBeCloseTo(before.z1);
    expect(Math.hypot(after.x0 - before.x0, after.z0 - before.z0)).toBeCloseTo(piece);
    expect(trunkColliders(sim, i)).toHaveLength(1);
  });

  it('the last log brings the branches as sticks and clears the trunk away', () => {
    const { sim, i } = felledFir();
    for (let k = 0; k < TREES.fir.logs * CUTS; k++) sim.perform({ kind: 'tree', index: i, dist: 1 });
    expect(countItem(sim.state.inventory, 'log')).toBe(TREES.fir.logs);
    expect(countItem(sim.state.inventory, 'stick')).toBe(TREES.fir.sticks);
    expect(sim.trunk(i)).toBeNull();
    expect(trunkColliders(sim, i)).toHaveLength(0);
    expect(drain(sim).some((e) => e.type === 'message' && /all cut up/.test(e.text))).toBe(true);
    // further swings do nothing
    sim.perform({ kind: 'tree', index: i, dist: 1 });
    expect(countItem(sim.state.inventory, 'log')).toBe(TREES.fir.logs);
  });

  it('needs an axe in hand to cut up the trunk', () => {
    const { sim, i } = felledFir();
    sim.selectTool('hands');
    sim.perform({ kind: 'tree', index: i, dist: 1 });
    expect(drain(sim).some((e) => e.type === 'needTool' && /cut up the trunk/.test(e.message))).toBe(true);
    expect(sim.state.trees[i].cuts).toBe(0);
  });

  it('with a full pack the log drops beside the trunk instead of vanishing', () => {
    const { sim, i } = felledFir();
    for (let k = 0; k < sim.state.inventory.slots.length; k++) sim.state.inventory.slots[k] = { item: 'stone', count: 10 };
    for (let k = 0; k < CUTS; k++) sim.perform({ kind: 'tree', index: i, dist: 1 });
    expect(sim.state.drops).toHaveLength(1);
    expect(sim.state.drops[0]).toMatchObject({ item: 'log', count: 1 });
    const t = sim.gen.trees[i];
    expect(Math.hypot(sim.state.drops[0].x - t.x, sim.state.drops[0].z - t.z)).toBeLessThan(3);
  });

  it('you can aim at the fallen trunk to chop it up', () => {
    const { sim, i } = felledFir();
    const span = sim.trunk(i)!;
    const mx = (span.x0 + span.x1) / 2;
    const mz = (span.z0 + span.z1) / 2;
    teleport(sim, mx - span.dz * 1.6, mz + span.dx * 1.6);
    aimAt(sim, mx, sim.terrain.heightAt(mx, mz) + span.r * TRUNK_AXIS_LIFT, mz);
    const p = sim.state.player;
    run(sim, 0.05, { yaw: p.yaw, pitch: p.pitch });
    expect(sim.target).toMatchObject({ kind: 'tree', index: i });
    expect(sim.describeTarget()).toEqual({ name: 'Fallen Douglas Fir', action: `Chop up (${TREES.fir.logs} logs left)`, enabled: true });
    sim.selectTool('hands');
    expect(sim.describeTarget()).toMatchObject({ action: 'Equip axe [2] to chop up', enabled: false });
  });

  it('blocks building until it is cut up', () => {
    const { sim, i } = felledFir();
    const span = sim.trunk(i)!;
    const mx = (span.x0 + span.x1) / 2;
    const mz = (span.z0 + span.z1) / 2;
    const env = { ...sim.placementEnv(), playerX: mx - span.dz * 3, playerZ: mz + span.dx * 3 };
    expect(checkPlacement(env, 'campfire', mx, mz, 0).reason).toBe('trunk');
    for (let k = 0; k < TREES.fir.logs * CUTS; k++) sim.perform({ kind: 'tree', index: i, dist: 1 });
    expect(checkPlacement({ ...sim.placementEnv(), playerX: env.playerX, playerZ: env.playerZ }, 'campfire', mx, mz, 0).reason).not.toBe('trunk');
  });

  it('a half-cut trunk survives save and load', () => {
    const { sim, i } = felledFir();
    for (let k = 0; k < CUTS + 1; k++) sim.perform({ kind: 'tree', index: i, dist: 1 });
    const loaded = new Simulation(deserializeState(serializeState(sim.state))!);
    expect(loaded.state.trees[i]).toEqual(sim.state.trees[i]);
    expect(loaded.state.trees[i]).toMatchObject({ logs: TREES.fir.logs - 1, cuts: 1 });
    expect(loaded.trunk(i)).toEqual(sim.trunk(i));
    expect(trunkColliders(loaded, i)).toHaveLength(1);
    loaded.selectTool('axe');
    loaded.perform({ kind: 'tree', index: i, dist: 1 });
    expect(countItem(loaded.state.inventory, 'log')).toBe(2);
  });
});

describe('stripped birch', () => {
  function peeledBirch() {
    const sim = quietSim();
    sim.selectTool('hands');
    const i = nearestTree(sim, 'birch');
    const t = sim.gen.trees[i];
    teleport(sim, t.x + 1.2, t.z);
    for (let k = 0; k < TREES.birch.bark; k++) sim.perform({ kind: 'tree', index: i, dist: 1 });
    drain(sim);
    return { sim, i };
  }

  it('shows bare wood only once all the bark is peeled, and never on other species or felled trees', () => {
    const sim = quietSim();
    const i = nearestTree(sim, 'birch');
    const dyn = sim.state.trees[i];
    expect(barkStripped('birch', dyn)).toBe(false);
    dyn.bark = 1;
    expect(barkStripped('birch', dyn)).toBe(false);
    dyn.bark = 0;
    expect(barkStripped('birch', dyn)).toBe(true);
    expect(barkStripped('birch', { ...dyn, felled: true })).toBe(false);
    for (const s of ['fir', 'cedar', 'maple'] as const) expect(barkStripped(s, { ...dyn, bark: 0 })).toBe(false);
  });

  it('peeling a birch leaves it stripped, and the look survives a save and load', () => {
    const { sim, i } = peeledBirch();
    expect(countItem(sim.state.inventory, 'bark')).toBe(TREES.birch.bark);
    expect(barkStripped('birch', sim.state.trees[i])).toBe(true);
    const loaded = new Simulation(deserializeState(serializeState(sim.state))!);
    expect(loaded.state.trees[i]).toMatchObject({ bark: 0, barkAt: sim.state.trees[i].barkAt });
    expect(barkStripped('birch', loaded.state.trees[i])).toBe(true);
  });

  it('the bark grows back after a day and the trunk looks whole again, also after loading', () => {
    const { sim, i } = peeledBirch();
    const loaded = new Simulation(deserializeState(serializeState(sim.state))!);
    const v = loaded.worldVersion;
    loaded.state.totalHours = loaded.state.trees[i].barkAt + 0.01;
    run(loaded, 3);
    expect(loaded.state.trees[i].bark).toBe(TREES.birch.bark);
    expect(barkStripped('birch', loaded.state.trees[i])).toBe(false);
    expect(loaded.worldVersion).toBeGreaterThan(v);
  });
});
