import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BALANCE } from '../src/data/balance';
import { ICON_DIR, iconFile } from '../src/data/icons';
import { TOOL_ORDER, TOOLS } from '../src/data/items';
import { RECIPE_BY_ID } from '../src/data/recipes';
import { MAX_TOOL_LEVEL, TOOL_UPGRADES } from '../src/data/upgrades';
import { createAnimal } from '../src/sim/animals';
import { countItem } from '../src/sim/inventory';
import { repairCost, repairSeconds } from '../src/sim/repair';
import { skinChance, toolLevel, weaponDamageMultiplier } from '../src/sim/upgrades';
import { toolIcon } from '../src/ui/icons';
import { drain, give, giveRecipe, keepAlive, placeStructure, quietSim, run } from './helpers';

const C = BALANCE.combat;
const asGive = (inputs: { item: string; count: number }[]) => Object.fromEntries(inputs.map((i) => [i.item, i.count]));

/** A sim holding a freshly crafted knife, equipped. */
function withKnife() {
  const sim = quietSim();
  keepAlive(sim);
  giveRecipe(sim, 'knife');
  expect(sim.craft('knife').ok).toBe(true);
  sim.selectTool('knife');
  drain(sim);
  return sim;
}

describe('the Stone Knife recipe (round 10)', () => {
  it('is in the Tools tab: 10 stone, 5 sticks and 3 cordage, on key 7', () => {
    const r = RECIPE_BY_ID.knife;
    expect(r).toMatchObject({ name: 'Stone Knife', category: 'tools', output: { kind: 'tool', tool: 'knife' } });
    expect(r.inputs).toEqual([
      { item: 'stone', count: 10 },
      { item: 'stick', count: 5 },
      { item: 'cordage', count: 3 },
    ]);
    expect(TOOLS.knife.slot).toBe(7);
    expect(TOOL_ORDER.at(-1)).toBe('knife');
  });

  it('crafts from exactly its materials into a wearing tool you can equip', () => {
    const sim = quietSim();
    expect(sim.canCraft('knife')).toEqual({ ok: false, reason: 'missing' });
    giveRecipe(sim, 'knife');
    expect(sim.craft('knife').ok).toBe(true);
    for (const i of RECIPE_BY_ID.knife.inputs) expect(countItem(sim.state.inventory, i.item)).toBe(0);
    expect(sim.state.tools).toContain('knife');
    expect(sim.state.toolWear.knife).toMatchObject({ dur: BALANCE.durability.tools.knife.uses, max: BALANCE.durability.tools.knife.uses });
    expect(sim.canCraft('knife')).toEqual({ ok: false, reason: 'owned' });
    sim.selectTool('knife');
    expect(sim.state.activeTool).toBe('knife');
  });

  it('has its own icon in the style of the other tools, at every upgrade level', () => {
    expect(iconFile('knife', 1)).toBe('knife.png');
    expect(existsSync(`public/${ICON_DIR}knife.png`)).toBe(true);
    for (const lv of [0, 1, 2, 3]) expect(toolIcon('knife', lv)).toContain(`/${ICON_DIR}knife.png`);
  });
});

describe('knife upgrades (round 10)', () => {
  it('has three tiers: Knapped Edge, Wrapped Grip and Skinner\'s Blade, each costlier than the last', () => {
    const tiers = TOOL_UPGRADES.knife;
    expect(tiers.map((t) => t.name)).toEqual(['Knapped Edge', 'Wrapped Grip', "Skinner's Blade"]);
    expect(tiers.map((t) => t.inputs)).toEqual([
      [{ item: 'stone', count: 8 }, { item: 'stick', count: 6 }, { item: 'cordage', count: 2 }],
      [{ item: 'stone', count: 16 }, { item: 'stick', count: 8 }, { item: 'cordage', count: 6 }, { item: 'bark', count: 6 }],
      [{ item: 'stone', count: 24 }, { item: 'cordage', count: 12 }, { item: 'bark', count: 8 }, { item: 'hide', count: 3 }],
    ]);
    const total = tiers.map((t) => t.inputs.reduce((n, i) => n + i.count, 0));
    expect(total).toEqual([16, 36, 47]);
  });

  it('each tier adds skinning chance and slash damage', () => {
    const s = quietSim().state;
    expect([0, 1, 2, 3].map((lv) => skinChance(s, lv))).toEqual([0.35, 0.42, 0.49, 0.55]);
    expect([0, 1, 2, 3].map((lv) => weaponDamageMultiplier(s, 'knife', lv))).toEqual([1, 1.15, 1.3, 1.45]);
  });

  it('upgrades in the game tier by tier, paying each tier in full, up to level III', () => {
    const sim = withKnife();
    sim.state.gear.push('basket');
    while (sim.state.inventory.slots.length < BALANCE.carry.baseSlots + BALANCE.carry.basketSlots) sim.state.inventory.slots.push(null);
    for (let lv = 0; lv < MAX_TOOL_LEVEL; lv++) {
      sim.state.inventory.slots.fill(null);
      expect(sim.upgradeTool('knife')).toEqual({ ok: false, reason: 'missing' });
      give(sim, asGive(TOOL_UPGRADES.knife[lv].inputs));
      keepAlive(sim);
      expect(sim.upgradeTool('knife').ok).toBe(true);
      expect(toolLevel(sim.state, 'knife')).toBe(lv + 1);
      expect(drain(sim)).toContainEqual({ type: 'upgraded', tool: 'knife', level: lv + 1 });
    }
    expect(sim.canUpgradeTool('knife')).toEqual({ ok: false, reason: 'maxed' });
  });
});

describe('knife repair (round 10)', () => {
  it('costs 3, 4, 5 and 6 items of its recipe at levels 0 to III', () => {
    expect([0, 1, 2, 3].map((lv) => repairCost('knife', lv))).toEqual([
      [{ item: 'stone', count: 2 }, { item: 'stick', count: 1 }],
      [{ item: 'stone', count: 2 }, { item: 'stick', count: 1 }, { item: 'cordage', count: 1 }],
      [{ item: 'stone', count: 3 }, { item: 'stick', count: 1 }, { item: 'cordage', count: 1 }],
      [{ item: 'stone', count: 3 }, { item: 'stick', count: 2 }, { item: 'cordage', count: 1 }],
    ]);
  });

  it('a worn knife is mended to full at the workbench', () => {
    const sim = withKnife();
    const bench = placeStructure(sim, 'workbench');
    const w = sim.state.toolWear.knife!;
    w.dur = 5;
    give(sim, asGive(repairCost('knife', 0)));
    keepAlive(sim);
    expect(sim.startRepair('knife', bench.id).ok).toBe(true);
    const ev = run(sim, repairSeconds(0) + 0.1);
    expect(ev).toContainEqual({ type: 'repaired', tool: 'knife' });
    expect(w.dur).toBeCloseTo(w.max, 1);
  });
});

describe('the knife as a weapon (round 10)', () => {
  it('is weak: harder than a punch or a torch, far below the axe and spear, with a punch\'s reach', () => {
    expect(C.knife.damage).toBeGreaterThan(C.hand.damage);
    expect(C.knife.damage).toBeGreaterThan(C.torch.damage);
    expect(C.knife.damage).toBeLessThan(C.axe.damage / 1.5);
    expect(C.knife.damage).toBeLessThan(C.spear.damage / 3);
    expect(C.knife.reach).toBe(C.hand.reach);
  });

  it('takes two slashes to kill a hare, wears a use per slash, and misses beyond reach', () => {
    const sim = withKnife();
    const p = sim.state.player;
    const hare = createAnimal(800, 'rabbit', p.x + 1.5, p.z, new Rng(1), sim.terrain);
    sim.state.animals.push(hare);
    sim.perform({ kind: 'animal', id: 800, dist: C.knife.reach + 0.5 });
    expect(hare.health).toBe(1);
    sim.perform({ kind: 'animal', id: 800, dist: 1.5 });
    expect(hare.health).toBeCloseTo(1 - C.knife.damage, 5);
    sim.perform({ kind: 'animal', id: 800, dist: 1.5 });
    expect(sim.state.animals).toHaveLength(0);
    expect(sim.state.carcasses).toHaveLength(1);
    expect(sim.state.toolWear.knife!.dur).toBe(BALANCE.durability.tools.knife.uses - 2);
  });

  it('upgrades and the Hunting skill make it hit harder', () => {
    const sim = withKnife();
    const p = sim.state.player;
    const a = createAnimal(801, 'bear', p.x + 1.5, p.z, new Rng(1), sim.terrain);
    const b = createAnimal(802, 'bear', p.x - 1.5, p.z, new Rng(2), sim.terrain);
    sim.state.animals.push(a, b);
    const full = a.health;
    sim.hitAnimal(a, C.knife.damage);
    sim.state.toolLevels.knife = 3;
    sim.hitAnimal(b, C.knife.damage);
    expect(full - b.health).toBeCloseTo((full - a.health) * 1.45, 5);
  });
});

describe('knife wear (round 10)', () => {
  it('each cut on a carcass costs a use, and it breaks after 30', () => {
    const sim = withKnife();
    const p = sim.state.player;
    let broke = false;
    for (let i = 0; i < BALANCE.durability.tools.knife.uses && !broke; i++) {
      sim.state.carcasses.push({ id: 900 + i, species: 'quail', x: p.x + 1, y: p.y, z: p.z, rot: 0, remaining: [{ item: 'rawMeat', count: 1 }], expiresAt: 999 });
      sim.perform({ kind: 'carcass', id: 900 + i, dist: 1 });
      broke = drain(sim).some((e) => e.type === 'broke' && e.tool === 'knife');
      if (!broke) expect(sim.state.toolWear.knife!.dur).toBe(BALANCE.durability.tools.knife.uses - i - 1);
    }
    expect(broke).toBe(true);
    expect(sim.state.tools).not.toContain('knife');
    expect(sim.state.activeTool).toBe('hands');
  });
});
