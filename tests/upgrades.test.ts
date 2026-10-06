import { trainSkill, drain, give, keepAlive, nearestTree, placeShelter, placeStructure, quietSim, teleport } from './helpers';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BALANCE } from '../src/data/balance';
import type { ItemId } from '../src/data/items';
import { PREFABS } from '../src/data/prefabs';
import { RECIPE_BY_ID } from '../src/data/recipes';
import { TREES } from '../src/data/resources';
import { MAX_TOOL_LEVEL, SHELTER_TIERS, SHELTER_UPGRADES, TOOL_UPGRADES, UPGRADABLE_TOOLS, type Cost } from '../src/data/upgrades';
import { createAnimal } from '../src/sim/animals';
import type { Collider } from '../src/sim/colliders';
import { countItem } from '../src/sim/inventory';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { newToolWear, toolWear, wearFraction } from '../src/sim/durability';
import { chopPowerBonus, huntDamageBonus, skillLevel } from '../src/sim/skills';
import { arrowSpeedMultiplier, chopPower, landChance, toolBreakdown, toolLevel, torchBurnMultiplier, weaponDamageMultiplier } from '../src/sim/upgrades';
import { shelterMenu, slotsNeeded } from '../src/ui/structure';

const K = BALANCE.skills;
const MAX_XP = K.thresholds[K.thresholds.length - 1];
const LV5_XP = K.thresholds.find((t) => skillLevel(t) === 5)!;
const U = BALANCE.upgrades;
const C = BALANCE.carry;
const WEAR = BALANCE.durability.structures as Record<string, { max: number }>;

/** Rough gathering effort, in harvest actions: fiber comes two a pick, cordage is 4 fiber, a log about 4 swings, a hide a hunt. */
const EFFORT: Partial<Record<ItemId, number>> = { stone: 1, stick: 1, fiber: 0.5, bark: 0.5, cordage: 2, log: 4, hide: 8 };
const effort = (cost: Cost) => cost.reduce((n, i) => n + i.count * EFFORT[i.item]!, 0);
const asGive = (cost: Cost) => Object.fromEntries(cost.map((i) => [i.item, i.count]));

function roomyPack(sim: Simulation): void {
  sim.state.gear.push('basket', 'backpack');
  const slots = sim.state.inventory.slots;
  while (slots.length < C.baseSlots + C.basketSlots + C.backpackSlots) slots.push(null);
}

function structureCollider(sim: Simulation, id: number): Collider {
  const st = sim.state.structures.find((s) => s.id === id)!;
  const out: Collider[] = [];
  sim.queryColliders(st.x, st.z, 4, out);
  return out.find((c) => c.kind === 'structure' && c.ref === id)!;
}

// ------------------------------------------------------------------ shelters

describe('shelter tiers', () => {
  it('run lean-to, A-frame, bark hut, hide tent, each warmer and more restful than the last', () => {
    expect(SHELTER_TIERS).toEqual(['leanTo', 'aFrame', 'barkHut', 'hideTent']);
    for (let i = 1; i < SHELTER_TIERS.length; i++) {
      const a = PREFABS[SHELTER_TIERS[i - 1]].shelter!;
      const b = PREFABS[SHELTER_TIERS[i]].shelter!;
      expect(b.warmthBonus).toBeGreaterThan(a.warmthBonus);
      expect(b.healthBonus).toBeGreaterThan(a.healthBonus);
      expect(WEAR[SHELTER_TIERS[i]].max).toBeGreaterThan(WEAR[SHELTER_TIERS[i - 1]].max);
    }
  });

  it('only the lean-to is a recipe; every later tier is built by upgrading the one before', () => {
    expect(RECIPE_BY_ID.leanTo.output).toEqual({ kind: 'place', prefab: 'leanTo' });
    for (const t of SHELTER_TIERS.slice(1)) {
      expect(RECIPE_BY_ID[t]).toBeUndefined();
      expect(SHELTER_UPGRADES[t]).toBeDefined();
    }
  });

  it('costs climb steeply, and each tier needs more pack room than the one before', () => {
    const costs = [RECIPE_BY_ID.leanTo.inputs, ...SHELTER_TIERS.slice(1).map((t) => SHELTER_UPGRADES[t]!)];
    const e = costs.map(effort);
    for (let i = 1; i < e.length; i++) expect(e[i] / e[i - 1], SHELTER_TIERS[i]).toBeGreaterThanOrEqual(1.45);
    expect(e[3]).toBeGreaterThan(e[0] * 3.5);
    expect(slotsNeeded(SHELTER_UPGRADES.aFrame!)).toBeLessThanOrEqual(C.baseSlots + C.basketSlots);
    expect(slotsNeeded(SHELTER_UPGRADES.aFrame!)).toBeGreaterThan(C.baseSlots);
    for (const t of ['barkHut', 'hideTent'] as const) {
      expect(slotsNeeded(SHELTER_UPGRADES[t]!)).toBeGreaterThan(C.baseSlots + C.basketSlots);
      expect(slotsNeeded(SHELTER_UPGRADES[t]!)).toBeLessThanOrEqual(C.baseSlots + C.basketSlots + C.backpackSlots);
    }
    expect(SHELTER_UPGRADES.hideTent!.find((i) => i.item === 'hide')!.count).toBeGreaterThanOrEqual(15);
  });

  it('clicking a shelter opens its menu instead of sleeping straight away', () => {
    const sim = quietSim();
    trainSkill(sim, 'crafting', 30);
    const hut = placeStructure(sim, 'leanTo');
    sim.devSetHour(21);
    drain(sim);
    sim.perform({ kind: 'structure', id: hut.id, dist: 1 });
    const ev = drain(sim);
    expect(ev).toContainEqual({ type: 'openStructure', structure: hut.id });
    expect(ev.some((e) => e.type === 'slept')).toBe(false);
  });

  it('upgrades in place, tier by tier, needing every material, up to the hide tent', () => {
    const sim = quietSim();
    trainSkill(sim, 'crafting', 30);
    roomyPack(sim);
    keepAlive(sim);
    const hut = placeStructure(sim, 'leanTo');
    teleport(sim, hut.x + 6, hut.z);
    const { id, x, z, rot } = hut;
    for (const next of SHELTER_TIERS.slice(1)) {
      const cost = SHELTER_UPGRADES[next]!;
      sim.state.inventory.slots.fill(null);
      // one short of the last material: refused, nothing taken
      give(sim, asGive(cost.map((i, k) => (k === cost.length - 1 ? { ...i, count: i.count - 1 } : i))));
      expect(sim.canUpgradeStructure(id)).toEqual({ ok: false, reason: 'missing' });
      expect(sim.upgradeStructure(id).ok).toBe(false);
      expect(countItem(sim.state.inventory, cost[0].item)).toBe(cost[0].count);
      give(sim, { [cost[cost.length - 1].item]: 1 });
      const m = shelterMenu(sim, id)!;
      expect(m.next!.prefab).toBe(next);
      expect(m.next!.check.ok).toBe(true);
      keepAlive(sim);
      expect(sim.upgradeStructure(id).ok).toBe(true);
      const ev = drain(sim);
      const st = sim.state.structures.find((s) => s.id === id)!;
      expect(st).toMatchObject({ prefab: next, x, z, rot });
      expect(st.wear!.max).toBeGreaterThanOrEqual(WEAR[next].max);
      expect(st.wear!.dur).toBe(st.wear!.max);
      expect(ev.some((e) => e.type === 'upgraded' && 'structure' in e && e.structure === id && e.prefab === next)).toBe(true);
      for (const i of cost) expect(countItem(sim.state.inventory, i.item), `${next} ${i.item}`).toBe(0);
      expect(sim.state.structures.filter((s) => PREFABS[s.prefab].shelter)).toHaveLength(1);
    }
    expect(sim.canUpgradeStructure(id)).toEqual({ ok: false, reason: 'maxed' });
    expect(shelterMenu(sim, id)!.next).toBeNull();
    expect(shelterMenu(sim, id)!.tier).toBe(4);
  });

  it('swaps the collider for the new shape', () => {
    const sim = quietSim();
    trainSkill(sim, 'crafting', 30);
    const tent = placeShelter(sim, 'leanTo');
    expect(structureCollider(sim, tent.id).body).toMatchObject({ type: 'box', hw: PREFABS.leanTo.collider.type === 'box' ? PREFABS.leanTo.collider.hw : 0 });
    const t2 = placeShelter(sim, 'hideTent');
    expect(structureCollider(sim, t2.id).body).toMatchObject({ type: 'circle', r: 1.35 });
  });

  it('sleeping in a better shelter keeps you warmer and heals more', () => {
    const rest = (tier: (typeof SHELTER_TIERS)[number]) => {
      const sim = quietSim();
    trainSkill(sim, 'crafting', 30);
      const st = placeShelter(sim, tier);
      teleport(sim, st.x + 30, st.z + 30);
      sim.devSetHour(21);
      Object.assign(sim.state.needs, { hunger: 80, thirst: 80, health: 40, warmth: 60 });
      expect(sim.trySleep(st.id)).toBe(true);
      return sim.state.needs.health;
    };
    const healed = SHELTER_TIERS.map(rest);
    for (let i = 1; i < healed.length; i++) expect(healed[i]).toBeGreaterThan(healed[i - 1]);
  });

  it('needs room to grow: a blocked spot, or you standing where the bigger shelter goes, stops the upgrade', () => {
    const sim = quietSim();
    trainSkill(sim, 'crafting', 30);
    roomyPack(sim);
    const hut = placeShelter(sim, 'barkHut');
    give(sim, asGive(SHELTER_UPGRADES.hideTent!));
    teleport(sim, hut.x, hut.z);
    expect(sim.canUpgradeStructure(hut.id)).toEqual({ ok: false, reason: 'blocked' });
    expect(sim.upgradeBlocker(hut.id)).toBe('player');
    expect(shelterMenu(sim, hut.id)!.next!.reason).toMatch(/room to grow/);
    expect(sim.upgradeStructure(hut.id).ok).toBe(false);
    expect(countItem(sim.state.inventory, 'hide')).toBe(18);
    teleport(sim, hut.x + 8, hut.z);
    expect(sim.canUpgradeStructure(hut.id).ok).toBe(true);
  });

  it('the menu says when the pack is too small to carry the next tier at once', () => {
    const sim = quietSim();
    trainSkill(sim, 'crafting', 30);
    const hut = placeShelter(sim, 'leanTo');
    expect(shelterMenu(sim, hut.id)!.next!.room).toMatch(/Grass Basket/);
    roomyPack(sim);
    expect(shelterMenu(sim, hut.id)!.next!.room).toBeNull();
  });

  it('old saves keep their lean-tos and hide tents as the first and last tiers', () => {
    const sim = quietSim();
    trainSkill(sim, 'crafting', 30);
    const a = placeShelter(sim, 'leanTo');
    const raw = JSON.parse(serializeState(sim.state));
    raw.version = 2;
    delete raw.toolLevels;
    delete raw.forage;
    raw.structures.push({ ...raw.structures[0], id: 9001, prefab: 'hideTent', x: a.x + 12 }, { ...raw.structures[0], id: 9002, prefab: 'teleporter' });
    const loaded = deserializeState(JSON.stringify(raw))!;
    expect(loaded.structures.map((s) => s.prefab)).toEqual(['leanTo', 'hideTent']);
    expect(loaded.toolLevels).toEqual({});
  });
});

// ------------------------------------------------------------------ tools

describe('tool upgrades', () => {
  it('every tool and weapon has three levels, each much costlier than the last', () => {
    expect([...UPGRADABLE_TOOLS].sort()).toEqual(['axe', 'bow', 'knife', 'rod', 'spear', 'torch']);
    for (const t of UPGRADABLE_TOOLS) {
      const levels = TOOL_UPGRADES[t];
      expect(levels).toHaveLength(MAX_TOOL_LEVEL);
      const e = levels.map((l) => effort(l.inputs));
      expect(e[1] / e[0], `${t} II`).toBeGreaterThanOrEqual(1.8);
      expect(e[2] / e[1], `${t} III`).toBeGreaterThanOrEqual(1.5);
      expect(levels[2].inputs.some((i) => i.item === 'hide'), `${t} III needs hides`).toBe(true);
      expect(slotsNeeded(levels[0].inputs), `${t} I`).toBeLessThanOrEqual(C.baseSlots);
      for (const l of levels) expect(slotsNeeded(l.inputs), `${t} ${l.name}`).toBeLessThanOrEqual(C.baseSlots + C.basketSlots);
    }
  });

  it('a fully upgraded kit is far beyond a couple of days of gathering', () => {
    const all = UPGRADABLE_TOOLS.flatMap((t) => TOOL_UPGRADES[t].map((l) => effort(l.inputs)));
    const total = all.reduce((a, b) => a + b, 0);
    const stones = UPGRADABLE_TOOLS.flatMap((t) => TOOL_UPGRADES[t].flatMap((l) => l.inputs)).filter((i) => i.item === 'stone').reduce((n, i) => n + i.count, 0);
    expect(total).toBeGreaterThan(600);
    expect(stones).toBeGreaterThan(150);
  });

  it('gates on owning the tool, having every material, and the level cap', () => {
    const sim = quietSim();
    trainSkill(sim, 'crafting', 30);
    roomyPack(sim);
    expect(sim.canUpgradeTool('axe')).toEqual({ ok: false, reason: 'notOwned' });
    expect(sim.canUpgradeTool('hands')).toEqual({ ok: false, reason: 'fixed' });
    sim.state.tools.push('axe');
    expect(sim.canUpgradeTool('axe')).toEqual({ ok: false, reason: 'missing' });
    for (let lv = 0; lv < MAX_TOOL_LEVEL; lv++) {
      const up = TOOL_UPGRADES.axe[lv];
      sim.state.inventory.slots.fill(null);
      give(sim, asGive(up.inputs.slice(1)));
      expect(sim.upgradeTool('axe')).toEqual({ ok: false, reason: 'missing' });
      expect(toolLevel(sim.state, 'axe')).toBe(lv);
      give(sim, asGive(up.inputs.slice(0, 1)));
      keepAlive(sim);
      expect(sim.upgradeTool('axe').ok).toBe(true);
      expect(toolLevel(sim.state, 'axe')).toBe(lv + 1);
      for (const i of up.inputs) expect(countItem(sim.state.inventory, i.item)).toBe(0);
      const ev = drain(sim);
      expect(ev).toContainEqual({ type: 'upgraded', tool: 'axe', level: lv + 1 });
    }
    expect(sim.canUpgradeTool('axe')).toEqual({ ok: false, reason: 'maxed' });
  });

  it('an upgrade brings any tool, weapon or the knife back to full durability for its new level, on every map (round 11)', () => {
    const wearing = UPGRADABLE_TOOLS.filter((t) => t in BALANCE.durability.tools);
    expect(wearing.sort()).toEqual(['axe', 'bow', 'knife', 'rod', 'spear', 'torch']);
    for (const biome of ['pnw', 'desert', 'island'] as const) {
      const sim = biome === 'pnw' ? quietSim() : Simulation.newGame(42, biome);
      sim.state.animals.length = 0;
      roomyPack(sim);
      for (const tool of wearing) {
        sim.state.tools.push(tool);
        for (let lv = 0; lv < MAX_TOOL_LEVEL; lv++) {
          trainSkill(sim, 'crafting', TOOL_UPGRADES[tool][lv].requiredLevel);
          const w = toolWear(sim.state, tool)!;
          // Well worn (nearly broken on the last level) before each upgrade.
          w.dur = lv === MAX_TOOL_LEVEL - 1 ? 1 : w.max * 0.3;
          const before = w.max;
          sim.state.inventory.slots.fill(null);
          give(sim, asGive(TOOL_UPGRADES[tool][lv].inputs));
          keepAlive(sim);
          expect(sim.upgradeTool(tool).ok, `${biome} ${tool} level ${lv + 1}`).toBe(true);
          const after = sim.state.toolWear[tool]!;
          expect(after.dur, `${biome} ${tool} level ${lv + 1}`).toBe(after.max);
          expect(after.max).toBeGreaterThanOrEqual(before);
          expect(wearFraction(after)).toBe(1);
        }
      }
      // Made at a higher crafting skill, the new level's maximum is the higher one.
      const pro = biome === 'pnw' ? quietSim() : Simulation.newGame(42, biome);
      roomyPack(pro);
      pro.state.tools.push('knife');
      toolWear(pro.state, 'knife')!.dur = 3;
      pro.state.skills.crafting = MAX_XP;
      give(pro, asGive(TOOL_UPGRADES.knife[0].inputs));
      keepAlive(pro);
      expect(pro.upgradeTool('knife').ok).toBe(true);
      expect(pro.state.toolWear.knife).toEqual(newToolWear('knife', MAX_XP));
      expect(pro.state.toolWear.knife!.max).toBe(BALANCE.durability.tools.knife.uses * 4);
    }
  });

  it('upgrades are personal and survive save and load; old tools start at level 0', () => {
    const sim = quietSim();
    trainSkill(sim, 'crafting', 30);
    sim.state.tools.push('bow', 'rod');
    sim.state.toolLevels = { bow: 2, rod: 1 };
    const loaded = deserializeState(serializeState(sim.state))!;
    expect(loaded.toolLevels).toEqual({ bow: 2, rod: 1 });
    const raw = JSON.parse(serializeState(sim.state));
    raw.toolLevels = { bow: 7, hands: 2, rod: 'x' };
    expect(deserializeState(JSON.stringify(raw))!.toolLevels).toEqual({ bow: 3 });
  });
});

describe('skill and upgrade bonuses add up on the same base', () => {
  it('axe: chop power = 1 + Gathering bonus + axe bonus', () => {
    const sim = quietSim();
    trainSkill(sim, 'crafting', 30);
    const s = sim.state;
    expect(chopPower(s)).toBe(1);
    s.skills.gathering = LV5_XP;
    const g5 = chopPowerBonus(LV5_XP);
    expect(g5).toBeCloseTo(0.5 * 4 / 49, 5);
    expect(chopPower(s, 2)).toBeCloseTo(1 + g5 + U.axe.chopPower[1], 2);
    s.skills.gathering = MAX_XP;
    expect(chopPower(s, 0)).toBe(1.5);
    expect(chopPower(s, 3)).toBe(2.1);
    expect(toolBreakdown(s, 'axe')).toBe('1 base + 0.50 Gathering + 0.00 upgrade');
  });

  it('axe: a fir unlocks at Gathering Lv 5, takes 5 swings with a level II axe, and 3 when both are maxed', () => {
    const swings = (xp: number, level: number) => {
      const sim = quietSim();
    trainSkill(sim, 'crafting', 30);
      teleport(sim, sim.terrain.spawn.x, sim.terrain.spawn.z);
      keepAlive(sim);
      sim.state.tools.push('axe');
      sim.selectTool('axe');
      sim.state.toolLevels.axe = level;
      const i = nearestTree(sim, 'fir');
      let n = 0;
      while (!sim.state.trees[i].felled && n < 20) {
        sim.state.skills.gathering = xp;
        sim.perform({ kind: 'tree', index: i, dist: 1 });
        n++;
      }
      return n;
    };
    expect(TREES.fir.hp).toBe(6);
    expect(swings(0, 0)).toBe(20);
    expect(swings(LV5_XP, 0)).toBe(6);
    expect(swings(LV5_XP, 2)).toBe(5);
    expect(swings(MAX_XP, 3)).toBe(3);
  });

  it('spear and bow: damage x (1 + Hunting bonus + weapon bonus)', () => {
    const s = quietSim().state;
    expect(weaponDamageMultiplier(s, 'spear', 0)).toBe(1);
    expect(weaponDamageMultiplier(s, 'spear', 3)).toBe(1.45);
    s.skills.hunting = MAX_XP;
    expect(huntDamageBonus(MAX_XP)).toBe(0.4);
    expect(weaponDamageMultiplier(s, 'spear', 3)).toBe(1.85);
    expect(weaponDamageMultiplier(s, 'bow', 3)).toBe(1.85);
    expect(weaponDamageMultiplier(s, 'hands', 3)).toBe(1.4);
    expect(arrowSpeedMultiplier(s, 0)).toBe(1);
    expect(arrowSpeedMultiplier(s, 3)).toBe(1.25);
  });

  it('a maxed spear hits harder in the game', () => {
    const sim = quietSim();
    trainSkill(sim, 'crafting', 30);
    sim.state.tools.push('spear');
    sim.selectTool('spear');
    const p = sim.state.player;
    const a = createAnimal(950, 'bear', p.x + 1.5, p.z, new Rng(1), sim.terrain);
    const b = createAnimal(951, 'bear', p.x - 1.5, p.z, new Rng(2), sim.terrain);
    sim.state.animals.push(a, b);
    const full = a.health;
    sim.hitAnimal(a, BALANCE.combat.spear.damage);
    sim.state.toolLevels.spear = 3;
    sim.hitAnimal(b, BALANCE.combat.spear.damage);
    expect(full - b.health).toBeCloseTo((full - a.health) * 1.45, 5);
  });

  it('rod: 35% base, 70% at max Fishing, 55% with a level III pole alone, 90% with both', () => {
    const s = quietSim().state;
    expect(landChance(s, 0)).toBe(0.35);
    expect(landChance(s, 3)).toBe(0.55);
    s.skills.fishing = MAX_XP;
    expect(landChance(s, 0)).toBe(0.7);
    expect(landChance(s, 3)).toBe(0.9);
    expect(landChance(s, 3)).toBeLessThanOrEqual(K.maxCatchChance);
  });

  it('torch: no skill, upgrades make it burn slower and warmer', () => {
    const sim = quietSim();
    trainSkill(sim, 'crafting', 30);
    const s = sim.state;
    expect(torchBurnMultiplier(s, 0)).toBe(1);
    expect(torchBurnMultiplier(s, 3)).toBeCloseTo(0.4);
    s.tools.push('torch');
    sim.selectTool('torch');
    sim.devSetHour(23);
    const warm0 = sim.warmthTarget().target;
    s.toolLevels.torch = 3;
    expect(sim.warmthTarget().target).toBeCloseTo(warm0 + U.torch.warmth[2], 5);
  });
});
