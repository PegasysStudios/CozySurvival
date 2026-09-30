import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { PREFABS } from '../src/data/prefabs';
import { F_WORK } from '../src/net/protocol';
import { localPose } from '../src/net/session';
import { toolWears, type WearingTool } from '../src/sim/durability';
import { countItem } from '../src/sim/inventory';
import { repairCost, repairSeconds, toolCraftCost } from '../src/sim/repair';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { TOOL_ORDER } from '../src/data/items';
import { workbenchMenu } from '../src/ui/structure';
import { drain, give, giveRecipe, keepAlive, placeStructure, quietSim, run } from './helpers';

const R = BALANCE.repair;
const LEVELS = [0, 1, 2, 3];
const WEARING = TOOL_ORDER.filter((t): t is WearingTool => toolWears(t));
const total = (c: { count: number }[]) => c.reduce((n, i) => n + i.count, 0);

/** A sim with a workbench, the tool crafted and worn down to a quarter, and the repair materials in the pack. */
function worn(tool: WearingTool = 'axe', level = 0) {
  const sim = quietSim();
  const bench = placeStructure(sim, 'workbench');
  giveRecipe(sim, tool);
  expect(sim.craft(tool).ok).toBe(true);
  if (level) sim.state.toolLevels[tool] = level;
  const w = sim.state.toolWear[tool]!;
  w.dur = Math.round(w.max / 4);
  give(sim, Object.fromEntries(repairCost(tool, level).map((c) => [c.item, c.count])));
  keepAlive(sim);
  drain(sim);
  return { sim, bench, w };
}

describe('repair costs and times (round 8)', () => {
  it('costs a small share of the crafting cost, never all of it, and a little more per upgrade', () => {
    for (const tool of WEARING) {
      const craft = total(toolCraftCost(tool));
      let prev = 0;
      for (const lv of LEVELS) {
        const cost = repairCost(tool, lv);
        const n = total(cost);
        expect(n, `${tool} L${lv}`).toBeGreaterThanOrEqual(Math.ceil(craft * R.costFraction[lv] - 1e-9));
        expect(n, `${tool} L${lv}`).toBeLessThan(craft);
        expect(n / craft, `${tool} L${lv}`).toBeLessThanOrEqual(0.35);
        expect(n, `${tool} L${lv} rises`).toBeGreaterThan(prev);
        for (const c of cost) expect(toolCraftCost(tool).some((i) => i.item === c.item && i.count >= c.count)).toBe(true);
        prev = n;
      }
    }
    expect(R.costFraction.every((f, i) => i === 0 || f > R.costFraction[i - 1])).toBe(true);
    expect(repairCost('axe', 0)).toEqual([
      { item: 'stick', count: 1 },
      { item: 'stone', count: 1 },
      { item: 'fiber', count: 1 },
    ]);
    expect(total(repairCost('axe', 3))).toBe(6);
  });

  it('takes a few seconds, a bit longer for each upgrade tier', () => {
    const t = LEVELS.map(repairSeconds);
    expect(t).toEqual([...R.seconds]);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    expect(t[0]).toBeGreaterThanOrEqual(3);
    expect(t.at(-1)!).toBeLessThanOrEqual(10);
  });
});

describe('the repair workbench (round 8)', () => {
  it('is a craftable structure you click to open its menu', () => {
    const sim = quietSim();
    const bench = placeStructure(sim, 'workbench');
    expect(PREFABS[bench.prefab].workbench).toBe(true);
    sim.perform({ kind: 'structure', id: bench.id, dist: 1 });
    expect(drain(sim)).toContainEqual({ type: 'openStructure', structure: bench.id });
  });

  it('lists every carried tool that wears, with its condition, cost and time', () => {
    const { sim, bench } = worn('axe');
    giveRecipe(sim, 'torch');
    expect(sim.craft('torch').ok).toBe(true);
    const m = workbenchMenu(sim, bench.id)!;
    expect(m.rows.map((r) => r.tool)).toEqual(['axe', 'torch']);
    const axe = m.rows[0];
    expect(axe.condition).toBe(25);
    expect(axe.check.ok).toBe(true);
    expect(axe.seconds).toBe(R.seconds[0]);
    expect(m.rows[1].check).toEqual({ ok: false, reason: 'full' });
  });

  it('pays up front, locks walking but not looking, and restores full condition when done', () => {
    const { sim, bench, w } = worn('axe');
    const p = sim.state.player;
    expect(sim.startRepair('axe', bench.id).ok).toBe(true);
    for (const c of repairCost('axe', 0)) expect(countItem(sim.state.inventory, c.item)).toBe(0);
    expect(drain(sim)).toContainEqual({ type: 'repairStarted', tool: 'axe', duration: R.seconds[0] });
    expect(sim.startRepair('axe', bench.id)).toEqual({ ok: false, reason: 'busy' });
    const at = { x: p.x, z: p.z };
    const ev = run(sim, R.seconds[0] / 2, { moveZ: -1, sprint: true, jumpPressed: true, yaw: 1.2, pitch: 0.4 });
    expect(Math.hypot(p.x - at.x, p.z - at.z)).toBeLessThan(0.01);
    expect(p.yaw).toBeCloseTo(1.2);
    expect(p.pitch).toBeCloseTo(0.4);
    expect(ev.some((e) => e.type === 'jump')).toBe(false);
    expect(sim.repairProgress).toBeGreaterThan(0.4);
    expect(sim.repairProgress).toBeLessThan(0.6);
    expect(sim.trySleep(bench.id)).toBe(false);
    expect(localPose(sim, 0).flags & F_WORK).toBe(F_WORK);
    const done = run(sim, R.seconds[0] / 2 + 0.1);
    expect(done).toContainEqual({ type: 'repaired', tool: 'axe' });
    expect(w.dur).toBeCloseTo(w.max, 1);
    expect(sim.state.repair).toBeUndefined();
    expect(sim.repairProgress).toBeNull();
    run(sim, 0.5, { moveZ: -1 });
    expect(Math.hypot(p.x - at.x, p.z - at.z)).toBeGreaterThan(0.5);
  });

  it('an upgraded tool costs more and takes longer', () => {
    const { sim, bench } = worn('axe', 2);
    expect(sim.startRepair('axe', bench.id).ok).toBe(true);
    expect(sim.state.repair!.duration).toBe(R.seconds[2]);
    expect(total(sim.state.repair!.paid)).toBe(total(repairCost('axe', 2)));
    expect(total(repairCost('axe', 2))).toBeGreaterThan(total(repairCost('axe', 0)));
  });

  it('refuses without the materials, and hands everything back if you are hurt or the bench goes', () => {
    const { sim, bench, w } = worn('axe');
    const before = w.dur;
    sim.state.inventory.slots.fill(null);
    expect(sim.startRepair('axe', bench.id)).toEqual({ ok: false, reason: 'missing' });
    give(sim, Object.fromEntries(repairCost('axe', 0).map((c) => [c.item, c.count])));
    expect(sim.startRepair('axe', bench.id).ok).toBe(true);
    run(sim, 1);
    sim.devDamage(1);
    expect(sim.state.repair).toBeUndefined();
    expect(drain(sim).some((e) => e.type === 'repairCancelled')).toBe(true);
    for (const c of repairCost('axe', 0)) expect(countItem(sim.state.inventory, c.item)).toBe(c.count);
    expect(w.dur).toBeCloseTo(before, 1);

    keepAlive(sim);
    expect(sim.startRepair('axe', bench.id).ok).toBe(true);
    sim.deleteStructure(bench.id);
    run(sim, 0.1);
    expect(sim.state.repair).toBeUndefined();
    for (const c of repairCost('axe', 0)) expect(countItem(sim.state.inventory, c.item)).toBe(c.count);
    expect(sim.startRepair('axe', bench.id)).toEqual({ ok: false, reason: 'gone' });
  });

  it('a repair under way survives a save, and resumes where it was', () => {
    const { sim, bench, w } = worn('axe');
    expect(sim.startRepair('axe', bench.id).ok).toBe(true);
    run(sim, 1);
    const loaded = new Simulation(deserializeState(serializeState(sim.state))!);
    expect(loaded.state.repair).toMatchObject({ tool: 'axe', structure: bench.id, duration: R.seconds[0] });
    expect(loaded.state.repair!.elapsed).toBeCloseTo(sim.state.repair!.elapsed, 3);
    keepAlive(loaded);
    run(loaded, R.seconds[0]);
    expect(loaded.state.toolWear.axe!.dur).toBeCloseTo(w.max, 1);
  });
});
