import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { applyWear, newStructureWear, newToolWear, prefabWears, toolWear, toolWears, wearFraction } from '../src/sim/durability';
import { checkPlacement } from '../src/sim/placement';
import type { Simulation } from '../src/sim/simulation';
import { drain, give, keepAlive, nearestTree, placeStructure, quietSim, run } from './helpers';

const D = BALANCE.durability;
const MAX_XP = BALANCE.skills.thresholds[BALANCE.skills.thresholds.length - 1];

describe('wear math', () => {
  it('warns once when an item drops below a quarter, then breaks at zero', () => {
    const w = { dur: 10, max: 10 };
    expect(applyWear(w, 0)).toBe('ok');
    expect(applyWear(w, -5)).toBe('ok');
    expect(w.dur).toBe(10);
    expect(applyWear(w, 7)).toBe('ok');
    expect(applyWear(w, 0.6)).toBe('low');
    expect(applyWear(w, 0.5)).toBe('ok');
    expect(applyWear(w, 5)).toBe('broken');
    expect(w.dur).toBe(0);
    expect(wearFraction(w)).toBe(0);
    expect(wearFraction(null)).toBe(1);
    expect(wearFraction(undefined)).toBe(1);
  });

  it('crafting skill makes tools and shelters last longer', () => {
    expect(newToolWear('axe', 0)).toEqual({ dur: D.tools.axe.uses, max: D.tools.axe.uses });
    expect(newToolWear('axe', MAX_XP).max).toBe(D.tools.axe.uses * 4);
    expect(newToolWear('spear', BALANCE.skills.thresholds[3]).max).toBeGreaterThan(D.tools.spear.uses);
    expect(newStructureWear('leanTo', 0).max).toBe(D.structures.leanTo.max);
    expect(newStructureWear('hideTent', MAX_XP).max).toBe(D.structures.hideTent.max * 4);
  });

  it('only crafted tools and shelters/benches wear; hands and campfires do not', () => {
    expect(toolWears('hands')).toBe(false);
    expect(toolWears('axe')).toBe(true);
    expect(prefabWears('campfire')).toBe(false);
    expect(prefabWears('bench')).toBe(true);
  });
});

function withAxe(sim: Simulation) {
  if (!sim.state.known.includes('axe')) sim.state.known.push('axe');
  give(sim, { stick: 2, stone: 2, fiber: 2 });
  expect(sim.craft('axe').ok).toBe(true);
  drain(sim);
}

describe('tool durability', () => {
  it('a crafted axe gets durability from your crafting skill and wears one per chop', () => {
    const sim = quietSim();
    withAxe(sim);
    expect(sim.state.toolWear.axe).toEqual({ dur: D.tools.axe.uses, max: D.tools.axe.uses });
    sim.perform({ kind: 'tree', index: nearestTree(sim), dist: 1 });
    expect(sim.state.toolWear.axe!.dur).toBe(D.tools.axe.uses - 1);

    const pro = quietSim();
    pro.state.skills.crafting = MAX_XP;
    withAxe(pro);
    expect(pro.state.toolWear.axe!.max).toBe(D.tools.axe.uses * 4);
  });

  it('warns when worn, and a broken axe is gone until you craft a new one', () => {
    const sim = quietSim();
    withAxe(sim);
    const tree = nearestTree(sim);
    const w = sim.state.toolWear.axe!;
    w.dur = w.max * D.lowFraction + 0.5;
    sim.perform({ kind: 'tree', index: tree, dist: 1 });
    const low = drain(sim);
    expect(low.some((e) => e.type === 'wornLow' && e.name === 'Stone Axe')).toBe(true);
    expect(low.some((e) => e.type === 'message' && /wearing out/.test(e.text))).toBe(true);

    w.dur = 1;
    sim.perform({ kind: 'tree', index: tree, dist: 1 });
    const broke = drain(sim);
    expect(broke.some((e) => e.type === 'broke' && e.tool === 'axe')).toBe(true);
    expect(sim.state.tools).not.toContain('axe');
    expect(sim.state.activeTool).toBe('hands');
    expect(sim.state.toolWear.axe).toBeUndefined();
    expect(sim.selectTool('axe')).toBe(false);

    const hp = sim.state.trees[tree].hp;
    sim.perform({ kind: 'tree', index: tree, dist: 1 });
    expect(sim.state.trees[tree].hp).toBe(hp);

    withAxe(sim);
    expect(sim.state.tools).toContain('axe');
    expect(sim.state.toolWear.axe).toEqual({ dur: D.tools.axe.uses, max: D.tools.axe.uses });
  });

  it('melee hits wear the weapon you swing', () => {
    const sim = quietSim();
    sim.state.tools.push('spear');
    sim.selectTool('spear');
    const wolf = sim.devSpawn('wolf', 2)!;
    sim.perform({ kind: 'animal', id: wolf.id, dist: 2 });
    expect(sim.state.toolWear.spear).toEqual({ dur: D.tools.spear.uses - 1, max: D.tools.spear.uses });
  });

  it('tools without a record (old saves, dev panel) get level-1 durability on first use', () => {
    const sim = quietSim();
    sim.state.tools.push('bow');
    expect(sim.state.toolWear.bow).toBeUndefined();
    expect(toolWear(sim.state, 'bow')).toEqual({ dur: D.tools.bow.uses, max: D.tools.bow.uses });
    expect(toolWear(sim.state, 'hands')).toBeNull();
    expect(toolWear(sim.state, 'spear')).toBeNull();
    expect(sim.wearTool('hands', 5)).toBe('ok');
    expect(sim.wearTool('spear', 5)).toBe('ok');
    expect(sim.state.toolWear.spear).toBeUndefined();
  });

  it('a held torch burns down over time; stowed tools only age slowly', () => {
    const sim = quietSim();
    sim.state.tools.push('torch', 'axe');
    sim.selectTool('torch');
    sim.timeScale = 60; // one game hour per real second
    run(sim, 1, {}, 0.05);
    const torch = sim.state.toolWear.torch!;
    const axe = sim.state.toolWear.axe!;
    expect(D.tools.torch.uses - torch.dur).toBeCloseTo(D.tools.torch.burnPerHour + D.tools.torch.perHour, 1);
    expect(axe.max - axe.dur).toBeCloseTo(D.tools.axe.perHour, 2);

    sim.selectTool('hands');
    const before = torch.dur;
    run(sim, 1, {}, 0.05);
    expect(before - torch.dur).toBeCloseTo(D.tools.torch.perHour, 2);
  });

  it('a torch left burning eventually breaks', () => {
    const sim = quietSim();
    sim.state.tools.push('torch');
    sim.selectTool('torch');
    sim.timeScale = 600;
    const events = [];
    for (let k = 0; k < 20 && sim.state.tools.includes('torch'); k++) {
      keepAlive(sim);
      events.push(...run(sim, 1, {}, 0.1));
    }
    expect(sim.state.tools).not.toContain('torch');
    expect(sim.state.activeTool).toBe('hands');
    expect(events.filter((e) => e.type === 'wornLow')).toHaveLength(1);
    expect(events.some((e) => e.type === 'broke' && e.tool === 'torch')).toBe(true);
  });
});

describe('structure durability', () => {
  it('new shelters and benches start at full condition, scaled by crafting skill; campfires never wear', () => {
    const sim = quietSim();
    const fire = placeStructure(sim, 'campfire');
    expect(fire.wear).toBeUndefined();
    const hut = placeStructure(sim, 'leanTo');
    expect(hut.wear).toEqual({ dur: D.structures.leanTo.max, max: D.structures.leanTo.max });
    sim.state.skills.crafting = MAX_XP;
    const bench = placeStructure(sim, 'bench');
    expect(bench.wear!.max).toBe(D.structures.bench.max * 4);
    sim.target = { kind: 'structure', id: hut.id, dist: 1 };
    expect(sim.describeTarget()!.name).toBe('Lean-to Shelter · 100% condition');
  });

  it('weathers slowly, warns when rickety, and collapses at zero', () => {
    const sim = quietSim();
    const hut = placeStructure(sim, 'leanTo');
    sim.timeScale = 60;
    run(sim, 2, {}, 0.05);
    expect(hut.wear!.max - hut.wear!.dur).toBeCloseTo(2 * D.structures.leanTo.perHour, 1);

    hut.wear!.dur = hut.wear!.max * D.lowFraction + 0.2;
    const low = run(sim, 1, {}, 0.05);
    expect(low.some((e) => e.type === 'wornLow' && e.name === 'Lean-to Shelter')).toBe(true);

    hut.wear!.dur = 0.5;
    const gone = run(sim, 2, {}, 0.05);
    expect(gone.some((e) => e.type === 'broke' && e.structure === hut.id)).toBe(true);
    expect(sim.state.structures).not.toContain(hut);
    const env = { ...sim.placementEnv(), playerX: hut.x + 3, playerZ: hut.z };
    expect(checkPlacement(env, 'leanTo', hut.x, hut.z, hut.rot).reason).not.toBe('structure');
  });

  it('each night of sleep wears the shelter', () => {
    const sim = quietSim();
    const hut = placeStructure(sim, 'leanTo');
    sim.state.tools.push('torch');
    sim.selectTool('torch');
    toolWear(sim.state, 'torch');
    sim.devSetHour(22);
    const start = hut.wear!.dur;
    expect(sim.trySleep(hut.id)).toBe(true);
    const elapsed = 8;
    expect(start - hut.wear!.dur).toBeCloseTo(D.structures.leanTo.useCost + elapsed * D.structures.leanTo.perHour, 1);
    // the torch doesn't burn while you sleep
    expect(D.tools.torch.uses - sim.state.toolWear.torch!.dur).toBeCloseTo(elapsed * D.tools.torch.perHour, 1);
  });

  it('sitting wears a bench, and a bench that falls apart stands you up', () => {
    const sim = quietSim();
    const bench = placeStructure(sim, 'bench');
    sim.perform({ kind: 'structure', id: bench.id, dist: 1 });
    expect(sim.state.player.sitting).toBe(true);
    expect(bench.wear!.max - bench.wear!.dur).toBe(D.structures.bench.useCost);
    sim.state.player.sitting = false;
    bench.wear!.dur = 0.5;
    sim.perform({ kind: 'structure', id: bench.id, dist: 1 });
    expect(sim.state.structures).not.toContain(bench);
    expect(sim.state.player.sitting).toBe(false);
    expect(drain(sim).some((e) => e.type === 'message' && /fell apart/.test(e.text))).toBe(true);
  });
});
