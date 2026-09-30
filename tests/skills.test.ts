import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BALANCE } from '../src/data/balance';
import { RESOURCES } from '../src/data/resources';
import { createAnimal } from '../src/sim/animals';
import { countItem } from '../src/sim/inventory';
import type { Simulation } from '../src/sim/simulation';
import {
  addSkillXp, burnChance, durabilityMultiplier, gatherBonusChance, huntDamageMultiplier, MAX_SKILL_LEVEL,
  skillEffect, skillFactor, skillLevel, skillProgress, SKILL_IDS,
} from '../src/sim/skills';
import { drain, give, giveRecipe, keepAlive, nearestResource, placeStructure, quietSim } from './helpers';

const K = BALANCE.skills;
const MAX_XP = K.thresholds[K.thresholds.length - 1];

describe('skill levels', () => {
  it('start at level 1 and climb through the thresholds to level 10', () => {
    expect(skillLevel(0)).toBe(1);
    expect(skillLevel(K.thresholds[0] - 0.01)).toBe(1);
    expect(skillLevel(K.thresholds[0])).toBe(2);
    expect(skillLevel(K.thresholds[1])).toBe(3);
    expect(skillLevel(MAX_XP)).toBe(MAX_SKILL_LEVEL);
    expect(skillLevel(MAX_XP * 10)).toBe(MAX_SKILL_LEVEL);
    expect(MAX_SKILL_LEVEL).toBe(10);
  });

  it('report progress toward the next level and are full at max', () => {
    expect(skillProgress(0)).toBe(0);
    expect(skillProgress(K.thresholds[0] / 2)).toBeCloseTo(0.5);
    expect(skillProgress((K.thresholds[0] + K.thresholds[1]) / 2)).toBeCloseTo(0.5);
    expect(skillProgress(MAX_XP)).toBe(1);
    expect(skillFactor(0)).toBe(0);
    expect(skillFactor(MAX_XP)).toBe(1);
  });

  it('effects scale gently from level 1 to level 10', () => {
    expect(gatherBonusChance(0)).toBe(0);
    expect(gatherBonusChance(MAX_XP)).toBeCloseTo(0.4);
    expect(huntDamageMultiplier(0)).toBe(1);
    expect(huntDamageMultiplier(MAX_XP)).toBeCloseTo(1.4);
    expect(burnChance(0)).toBeCloseTo(0.2);
    expect(burnChance(MAX_XP)).toBe(0);
    expect(durabilityMultiplier(0)).toBe(1);
    expect(durabilityMultiplier(MAX_XP)).toBeCloseTo(4);
    // monotonic across every level
    for (let i = 1; i < K.thresholds.length; i++) {
      expect(burnChance(K.thresholds[i])).toBeLessThan(burnChance(K.thresholds[i - 1]));
      expect(durabilityMultiplier(K.thresholds[i])).toBeGreaterThan(durabilityMultiplier(K.thresholds[i - 1]));
    }
    for (const id of SKILL_IDS) expect(skillEffect(id, 0)).toMatch(/\S/);
  });

  it('addSkillXp returns the new level only when it goes up', () => {
    const sim = quietSim();
    expect(sim.state.skills).toEqual({ gathering: 0, hunting: 0, cooking: 0, crafting: 0, fishing: 0, skinning: 0 });
    expect(addSkillXp(sim.state, 'cooking', K.thresholds[0] - 1)).toBeNull();
    expect(addSkillXp(sim.state, 'cooking', 1)).toBe(2);
    expect(addSkillXp(sim.state, 'cooking', 1)).toBeNull();
    expect(addSkillXp(sim.state, 'crafting', MAX_XP)).toBe(MAX_SKILL_LEVEL);
  });
});

function gatherOnce(sim: Simulation, kind: keyof typeof RESOURCES): number {
  const i = nearestResource(sim, kind);
  const item = RESOURCES[kind].item;
  sim.state.resources[i].charges = RESOURCES[kind].charges;
  sim.perform({ kind: 'resource', index: i, dist: 1 });
  const got = countItem(sim.state.inventory, item);
  sim.state.inventory.slots = sim.state.inventory.slots.map(() => null);
  return got;
}

describe('gathering skill', () => {
  it('improves by gathering and announces each new level', () => {
    const sim = quietSim();
    const events = [];
    for (let k = 0; k < K.thresholds[0]; k++) {
      gatherOnce(sim, 'stonePile');
      events.push(...drain(sim));
    }
    expect(sim.state.skills.gathering).toBe(K.thresholds[0] * K.xp.gather);
    const ups = events.filter((e) => e.type === 'skillUp');
    expect(ups).toEqual([{ type: 'skillUp', skill: 'gathering', level: 2 }]);
    expect(events.some((e) => e.type === 'message' && /Gathering is now level 2/.test(e.text))).toBe(true);
  });

  it('never finds a bonus at level 1, and sometimes does when skilled', () => {
    const y = RESOURCES.stonePile.yield;
    const novice = quietSim();
    let got = 0;
    for (let k = 0; k < 40; k++) {
      novice.state.skills.gathering = 0;
      got += gatherOnce(novice, 'stonePile');
    }
    expect(got).toBe(40 * y);

    const expert = quietSim();
    expert.state.skills.gathering = MAX_XP;
    let bonus = 0;
    for (let k = 0; k < 40; k++) bonus += gatherOnce(expert, 'stonePile') - y;
    expect(bonus).toBeGreaterThan(4);
    expect(bonus).toBeLessThan(30);
  });
});

describe('hunting skill', () => {
  it('adds damage to your hits on animals', () => {
    const sim = quietSim();
    const p = sim.state.player;
    const a = createAnimal(900, 'deer', p.x + 2, p.z, new Rng(1), sim.terrain);
    const b = createAnimal(901, 'deer', p.x - 2, p.z, new Rng(2), sim.terrain);
    sim.state.animals.push(a, b);
    sim.hitAnimal(a, 1);
    expect(a.health).toBeCloseTo(2);
    sim.state.skills.hunting = MAX_XP;
    sim.hitAnimal(b, 1);
    expect(b.health).toBeCloseTo(3 - 1.4);
  });

  it('grows from hits, kills and butchering', () => {
    const sim = quietSim();
    const p = sim.state.player;
    const hare = createAnimal(902, 'rabbit', p.x + 1, p.z, new Rng(1), sim.terrain);
    sim.state.animals.push(hare);
    sim.hitAnimal(hare, 5);
    expect(sim.state.skills.hunting).toBe(K.xp.hit + K.xp.kill);
    sim.state.tools.push('knife');
    sim.selectTool('knife');
    const id = sim.state.carcasses[0].id;
    sim.perform({ kind: 'carcass', id, dist: 1 });
    expect(sim.state.skills.hunting).toBe(K.xp.hit + K.xp.kill);
    sim.perform({ kind: 'carcass', id, dist: 1 });
    expect(sim.state.skills.hunting).toBe(K.xp.hit + K.xp.kill + K.xp.butcher);
  });

  it('a skilled hunter sometimes gets extra meat; a novice never does', () => {
    const meatFrom = (xp: number) => {
      const sim = quietSim();
      const p = sim.state.player;
      const counts: number[] = [];
      for (let k = 0; k < 30; k++) {
        sim.state.skills.hunting = xp;
        const hare = createAnimal(1000 + k, 'rabbit', p.x + 1, p.z, new Rng(k), sim.terrain);
        sim.state.animals.push(hare);
        sim.hitAnimal(hare, 5);
        const c = sim.state.carcasses.pop()!;
        counts.push(c.remaining.find((r) => r.item === 'rawMeat')!.count);
      }
      return counts;
    };
    expect(meatFrom(0).every((n) => n === 1)).toBe(true);
    const skilled = meatFrom(MAX_XP);
    expect(skilled.filter((n) => n === 2).length).toBeGreaterThan(5);
    expect(skilled.every((n) => n === 1 || n === 2)).toBe(true);
  });
});

describe('cooking skill and burnt meals', () => {
  function cookMany(sim: Simulation, recipe: string, input: Parameters<typeof give>[1], n: number, xp: number, firstEveryTime = false) {
    let burnt = 0;
    for (let k = 0; k < n; k++) {
      sim.state.skills.cooking = xp;
      if (firstEveryTime) sim.state.stats.crafted[recipe] = 0;
      keepAlive(sim);
      give(sim, input);
      expect(sim.craft(recipe).ok).toBe(true);
      if (drain(sim).some((e) => e.type === 'crafted' && e.burnt)) burnt++;
      sim.state.inventory.slots = sim.state.inventory.slots.map(() => null);
      sim.state.canteen = { lakeWater: 0, boiledWater: 0 };
    }
    return burnt;
  }

  it('the first time you cook a dish it always comes out right', () => {
    const sim = quietSim();
    placeStructure(sim, 'campfire');
    expect(cookMany(sim, 'cookedMeat', { rawMeat: 1 }, 40, 0, true)).toBe(0);
  });

  it('a novice cook sometimes chars a meal; the charred meal is still edible', () => {
    const sim = quietSim();
    placeStructure(sim, 'campfire');
    sim.state.stats.crafted.cookedMeat = 1;
    let charred = 0;
    for (let k = 0; k < 60 && !charred; k++) {
      sim.state.skills.cooking = 0;
      give(sim, { rawMeat: 1 });
      sim.craft('cookedMeat');
      if (countItem(sim.state.inventory, 'charredMeal') > 0) charred++;
      else sim.state.inventory.slots = sim.state.inventory.slots.map(() => null);
    }
    expect(charred).toBe(1);
    expect(countItem(sim.state.inventory, 'cookedMeat')).toBe(0);
    expect(sim.state.stats.gathered.charredMeal).toBe(1);
    sim.state.needs.hunger = 50;
    const slot = sim.state.inventory.slots.findIndex((s) => s?.item === 'charredMeal');
    expect(sim.useSlot(slot)).toBe(true);
    expect(sim.state.needs.hunger).toBeCloseTo(58);
  });

  it('burns roughly one meal in five at level 1', () => {
    const sim = quietSim();
    placeStructure(sim, 'campfire');
    const burnt = cookMany(sim, 'cookedMeat', { rawMeat: 1 }, 80, 0);
    expect(burnt).toBeGreaterThan(5);
    expect(burnt).toBeLessThan(30);
  });

  it('a master cook never burns anything, and drinks never burn', () => {
    const sim = quietSim();
    placeStructure(sim, 'campfire');
    sim.state.gear.push('canteen');
    expect(cookMany(sim, 'cookedMeat', { rawMeat: 1 }, 40, MAX_XP)).toBe(0);
    expect(cookMany(sim, 'boilWater', { lakeWater: 1 }, 30, 0)).toBe(0);
    expect(cookMany(sim, 'berryTea', { boiledWater: 1, berries: 2 }, 30, 0)).toBe(0);
  });

  it('cooking raises the cooking skill; crafting and building raise crafting', () => {
    const sim = quietSim();
    placeStructure(sim, 'campfire');
    expect(sim.state.skills.crafting).toBe(K.xp.build);
    give(sim, { rawMeat: 1 });
    giveRecipe(sim, 'axe');
    sim.craft('cookedMeat');
    expect(sim.state.skills.cooking).toBe(K.xp.cook);
    sim.craft('axe');
    expect(sim.state.skills.crafting).toBe(K.xp.build + K.xp.craft);
  });
});
