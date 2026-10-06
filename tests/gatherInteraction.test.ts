import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rng } from '../src/core/rng';
import { BALANCE } from '../src/data/balance';
import { BIOME_IDS } from '../src/data/biomes';
import { RESOURCES } from '../src/data/resources';
import { countItem } from '../src/sim/inventory';
import { Simulation } from '../src/sim/simulation';
import { drain, nearestResource, run, teleport } from './helpers';

afterEach(() => vi.restoreAllMocks());

describe.each(BIOME_IDS)('%s gathering interaction speed', (biome) => {
  function aimedAtBranches() {
    const sim = Simulation.newGame(42, biome);
    sim.state.animals = [];
    sim.state.spawnCheckAt = Infinity;
    const index = nearestResource(sim, 'stickPile'), g = sim.gen.resources[index];
    teleport(sim, g.x + 2, g.z);
    const aim = {
      resolveAim(eye: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }) {
        const x = g.x - eye.x;
        const y = sim.terrain.heightAt(g.x, g.z) + RESOURCES.stickPile.hitHeight - eye.y;
        const z = g.z - eye.z;
        const length = Math.hypot(x, y, z);
        direction.x = x / length;
        direction.y = y / length;
        direction.z = z / length;
      },
    };
    run(sim, 0.05, aim);
    expect(sim.target).toMatchObject({ kind: 'resource', index });
    drain(sim);
    const rng = (sim as unknown as { rng: Rng }).rng;
    return { sim, index, aim, rng };
  }

  it('accepts successive clicks at the original cadence with unchanged failure and success behavior', () => {
    const { sim, index, aim, rng } = aimedAtBranches();
    vi.spyOn(rng, 'chance').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const click = () => run(sim, 1 / 60, { ...aim, primary: true, primaryPressed: true });
    const first = click();
    expect(first.filter((e) => e.type === 'swing')).toEqual([{ type: 'swing', tool: 'hands', hit: true }]);
    expect(countItem(sim.state.inventory, 'stick')).toBe(0);
    expect(sim.state.skills.gathering).toBe(BALANCE.skills.xp.gatherFail);
    run(sim, 0.45, aim);
    const second = click();
    expect(second.filter((e) => e.type === 'swing')).toEqual([{ type: 'swing', tool: 'hands', hit: true }]);
    expect(countItem(sim.state.inventory, 'stick')).toBe(1);
    expect(sim.state.resources[index].charges).toBe(RESOURCES.stickPile.charges - 2);
    expect(sim.state.skills.gathering).toBeCloseTo(BALANCE.skills.xp.gatherFail + BALANCE.skills.xp.gather);
    expect(rng.chance).toHaveBeenNthCalledWith(1, 0.6);
    expect(rng.chance).toHaveBeenNthCalledWith(2, 0.6);
  });

  it('holding the button repeats at the original speed and keeps one motion per attempt', () => {
    const { sim, index, aim, rng } = aimedAtBranches();
    vi.spyOn(rng, 'chance').mockReturnValue(true);
    const events = run(sim, 1 / 60, { ...aim, primary: true, primaryPressed: true });
    events.push(...run(sim, 0.95, { ...aim, primary: true }));
    expect(events.filter((e) => e.type === 'swing')).toEqual(Array.from({ length: 3 }, () => ({ type: 'swing', tool: 'hands', hit: true })));
    expect(sim.state.resources[index].charges).toBe(0);
    expect(countItem(sim.state.inventory, 'stick')).toBe(3);
    expect(sim.state.skills.gathering).toBe(3 * BALANCE.skills.xp.gather);
  });
});
