import { keepAlive, teleport, drain, gatherOutcome, give, nearestResource, placeShelter, quietSim, run, trainSkill } from './helpers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rng } from '../src/core/rng';
import { BALANCE } from '../src/data/balance';
import { BIOME_IDS } from '../src/data/biomes';
import { FISH_LEVELS, RESOURCE_LEVELS, TREE_LEVELS, ANIMAL_LEVELS, STRUCTURE_LEVELS } from '../src/data/progression';
import { recipesFor, RECIPE_BY_ID } from '../src/data/recipes';
import { RESOURCES } from '../src/data/resources';
import { SPECIES } from '../src/data/species';
import { SHELTER_UPGRADES, TOOL_UPGRADES } from '../src/data/upgrades';
import { createAnimal } from '../src/sim/animals';
import { checklistNeeds, checklistReady } from '../src/sim/checklist';
import { countItem } from '../src/sim/inventory';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import type { CarcassState } from '../src/sim/state';
import { FISHING_CATCHES, type FishingCatch } from '../src/data/fishing';
import { addSkillXp, gatherSuccessChance, MAX_SKILL_LEVEL, SKILL_IDS, skillLevel, skillProgress, xpForLevel } from '../src/sim/skills';
import { nextSkillUnlock } from '../src/sim/progression';
import { recipeTile, toolTile } from '../src/ui/catalog';
import { shelterMenu } from '../src/ui/structure';

const K = BALANCE.skills;
afterEach(() => vi.restoreAllMocks());
const rngOf = (sim: Simulation) => (sim as unknown as { rng: Rng }).rng;

function stockRecipe(sim: Simulation, id: string) {
  sim.state.inventory.slots = Array(20).fill(null);
  give(sim, Object.fromEntries(RECIPE_BY_ID[id].inputs.map((i) => [i.item, i.count])));
}

function addCarcass(sim: Simulation, species: keyof typeof SPECIES) {
  const s = sim.state, p = s.player;
  const c: CarcassState = { id: s.nextId++, species, x: p.x, y: p.y, z: p.z, rot: 0, expiresAt: s.totalHours + 24, remaining: SPECIES[species].drops.map((d) => ({ ...d })) };
  s.carcasses.push(c);
  s.tools.push('knife'); sim.selectTool('knife');
  return c;
}

describe('level-50 pacing', () => {
  it('has strictly increasing thresholds and a rising cost for all 50 levels', () => {
    expect(MAX_SKILL_LEVEL).toBe(50);
    for (let level = 2; level <= 50; level++) {
      expect(skillLevel(xpForLevel(level))).toBe(level);
      expect(skillLevel(xpForLevel(level) - 0.01)).toBe(level - 1);
      expect(skillProgress(xpForLevel(level))).toBe(level === 50 ? 1 : 0);
      if (level > 2) expect(xpForLevel(level) - xpForLevel(level - 1)).toBeGreaterThan(xpForLevel(level - 1) - xpForLevel(level - 2));
    }
  });

  it('requires sustained practice for level 5 without slowing the interaction cadence', () => {
    expect(Math.ceil(xpForLevel(5) / K.xp.gather)).toBeGreaterThan(2000);
    const seconds = (24 - (BALANCE.time.startHour - BALANCE.time.dayStartHour)) / 24 * BALANCE.time.realSecondsPerDay;
    // Fastest available tree is the island tree fern: two felling swings + two cutting swings.
    const treeXp = Math.ceil(seconds / (4 * BALANCE.combat.axe.cooldown)) * (K.xp.fell + K.xp.log);
    expect(treeXp).toBeLessThan(xpForLevel(5));
  });

  it('caps levels and XP, and ignores invalid XP grants', () => {
    const sim = quietSim();
    for (const skill of SKILL_IDS) {
      for (const amount of [-1, NaN, Infinity]) expect(addSkillXp(sim.state, skill, amount)).toBeNull();
      expect(sim.state.skills[skill]).toBe(0);
      expect(addSkillXp(sim.state, skill, 1e9)).toBe(50);
      expect(sim.state.skills[skill]).toBe(xpForLevel(50));
    }
  });
});

describe.each(BIOME_IDS)('%s progression', (biome) => {
  it('requires a skill level for every recipe even with all its ingredients', () => {
    for (const r of recipesFor(biome)) {
      const sim = Simulation.newGame(42, biome);
      expect(r.requiredLevel).toBeGreaterThanOrEqual(1);
      expect(r.requiredLevel).toBeLessThanOrEqual(50);
      stockRecipe(sim, r.id);
      const skill = r.category === 'cooking' ? 'cooking' : 'crafting';
      if (r.requiredLevel > 1) {
        const before = JSON.stringify(sim.state.inventory);
        expect(sim.canCraft(r.id).reason, r.id).toBe('skill');
        expect(sim.craft(r.id).reason, r.id).toBe('skill');
        expect(JSON.stringify(sim.state.inventory)).toBe(before);
        expect(recipeTile(sim, r).badge).toBe('locked');
        trainSkill(sim, skill, r.requiredLevel);
      }
      expect(sim.canCraft(r.id).reason, r.id).not.toBe('skill');
    }
  });

  it('keeps a food, fiber, stone, stick and timber path open at Gathering level 1', () => {
    const sim = Simulation.newGame(42, biome);
    const kinds = new Set(sim.gen.resources.map((g) => g.kind));
    for (const item of ['stick', 'stone', 'fiber']) expect([...kinds].some((k) => RESOURCES[k].item === item && RESOURCE_LEVELS[k] === 1)).toBe(true);
    expect([...kinds].some((k) => ['berries', 'pricklyPear', 'seaGrapes'].includes(RESOURCES[k].item) && RESOURCE_LEVELS[k] === 1)).toBe(true);
    expect(sim.gen.trees.some((t) => TREE_LEVELS[t.species].fell === 1)).toBe(true);
    expect(sim.biomeDef.prey.some((p) => SPECIES[p.species].drops.some((d) => d.item === 'hide') && ANIMAL_LEVELS[p.species].skin === 1 && ANIMAL_LEVELS[p.species].hunt === 1)).toBe(true);
  });

  it('a failed gather consumes an attempt and energy, gives less XP, and respects regrowth', () => {
    const sim = Simulation.newGame(42, biome);
    const i = nearestResource(sim, 'stickPile'), def = RESOURCES.stickPile;
    gatherOutcome(sim, false);
    const energy = sim.state.needs.energy;
    sim.perform({ kind: 'resource', index: i, dist: 1 });
    expect(sim.state.skills.gathering).toBe(K.xp.gatherFail);
    expect(countItem(sim.state.inventory, 'stick')).toBe(0);
    expect(sim.state.resources[i].charges).toBe(def.charges - 1);
    expect(sim.state.needs.energy).toBe(energy - BALANCE.needs.energy.gatherCost);
    for (let n = 1; n < def.charges; n++) sim.perform({ kind: 'resource', index: i, dist: 1 });
    expect(sim.state.resources[i].respawnAt).toBe(sim.state.totalHours + def.respawnHours);
    const xp = sim.state.skills.gathering;
    sim.perform({ kind: 'resource', index: i, dist: 1 });
    expect(sim.state.skills.gathering).toBe(xp);
    sim.state.totalHours += def.respawnHours + 0.1;
    run(sim, 1.1);
    expect(sim.state.resources[i].charges).toBe(def.charges);
  });

  it('full packs and locked resources cannot consume charges or farm XP', () => {
    const sim = Simulation.newGame(42, biome);
    const i = sim.gen.resources.findIndex((g) => RESOURCE_LEVELS[g.kind] > 1);
    expect(i).toBeGreaterThanOrEqual(0);
    const before = JSON.stringify(sim.state.resources[i]);
    sim.perform({ kind: 'resource', index: i, dist: 1 });
    expect(JSON.stringify(sim.state.resources[i])).toBe(before);
    expect(sim.state.skills.gathering).toBe(0);
    expect(sim.state.needs.energy).toBe(100);
    sim.target = { kind: 'resource', index: i, dist: 1 };
    expect(sim.describeTarget()).toMatchObject({ enabled: false, action: expect.stringContaining('Gathering Lv') });
    const stick = nearestResource(sim, 'stickPile');
    sim.state.inventory.slots.fill({ item: 'stone', count: 10 });
    sim.perform({ kind: 'resource', index: stick, dist: 1 });
    expect(sim.state.resources[stick].charges).toBe(RESOURCES.stickPile.charges);
    expect(sim.state.skills.gathering).toBe(0);
  });
});

describe('harvest mastery and outcomes', () => {
  it('actual gather outcomes follow the novice and master success rates', () => {
    const rate = (level: number) => {
      const sim = quietSim(), i = nearestResource(sim, 'stickPile');
      let successes = 0;
      for (let n = 0; n < 2000; n++) {
        sim.state.skills.gathering = xpForLevel(level);
        sim.state.inventory.slots.fill(null);
        sim.state.resources[i].charges = 1;
        sim.perform({ kind: 'resource', index: i, dist: 1 });
        if (countItem(sim.state.inventory, 'stick') > 0) successes++;
        drain(sim);
      }
      return successes / 2000;
    };
    expect(rate(1)).toBeGreaterThan(0.57);
    expect(rate(1)).toBeLessThan(0.63);
    expect(rate(50)).toBeGreaterThan(0.87);
    expect(rate(50)).toBeLessThan(0.93);
  });

  it('gather success rises from 60% to 90%, with one base item per successful attempt', () => {
    expect(gatherSuccessChance(0)).toBe(0.6);
    expect(gatherSuccessChance(xpForLevel(50))).toBeCloseTo(0.9);
    const sim = quietSim(), i = nearestResource(sim, 'fern');
    gatherOutcome(sim);
    sim.perform({ kind: 'resource', index: i, dist: 1 });
    expect(countItem(sim.state.inventory, 'fiber')).toBe(1);
    expect(sim.state.skills.gathering).toBe(K.xp.gather);
  });

  it('locks harvesting and felling independently without damaging a locked tree', () => {
    const sim = Simulation.newGame(42, 'desert');
    sim.state.tools.push('axe'); sim.selectTool('axe');
    const i = sim.gen.trees.findIndex((t) => t.species === 'pinyon');
    const before = JSON.stringify(sim.state.trees[i]);
    sim.perform({ kind: 'tree', index: i, dist: 1 });
    expect(JSON.stringify(sim.state.trees[i])).toBe(before);
    trainSkill(sim, 'gathering', TREE_LEVELS.pinyon.fell);
    sim.selectTool('hands');
    sim.perform({ kind: 'tree', index: i, dist: 1 });
    expect(JSON.stringify(sim.state.trees[i])).toBe(before);
  });

  it('blocks a deer hunt, while a novice can defend against a bear without harvesting it', () => {
    const sim = quietSim(), p = sim.state.player;
    const deer = createAnimal(900, 'deer', p.x, p.z, new Rng(1), sim.terrain);
    sim.state.animals.push(deer);
    sim.hitAnimal(deer, 100);
    expect(deer.health).toBe(SPECIES.deer.maxHealth);
    expect(sim.state.skills.hunting).toBe(0);
    const bear = createAnimal(901, 'bear', p.x, p.z, new Rng(2), sim.terrain);
    sim.state.animals.push(bear);
    sim.target = { kind: 'animal', id: bear.id, dist: 1 };
    expect(sim.describeTarget()).toMatchObject({ enabled: true, action: 'Defend · Hunting Lv 25 for harvesting' });
    sim.hitAnimal(bear, 100);
    expect(sim.state.animals).not.toContain(bear);
    expect(sim.state.skills.hunting).toBe(0);
    const c = sim.state.carcasses[0];
    sim.state.tools.push('knife'); sim.selectTool('knife');
    sim.perform({ kind: 'carcass', id: c.id, dist: 1 });
    expect(c.skinned).toBeUndefined();
    expect(sim.state.skills.skinning).toBe(0);
  });

  it('skin failures grant less XP than whole hides; locked large hides remain intact', () => {
    const sim = quietSim(), rabbit = addCarcass(sim, 'rabbit');
    vi.spyOn(rngOf(sim), 'chance').mockReturnValueOnce(false).mockReturnValueOnce(true);
    sim.perform({ kind: 'carcass', id: rabbit.id, dist: 1 });
    expect(sim.state.skills.skinning).toBe(K.xp.skinFail);
    expect(rabbit.skinned).toBe(true);
    const next = addCarcass(sim, 'rabbit');
    sim.perform({ kind: 'carcass', id: next.id, dist: 1 });
    expect(sim.state.skills.skinning).toBe(K.xp.skinFail + K.xp.skin);
    const bear = addCarcass(sim, 'bear'), before = JSON.stringify(bear);
    sim.perform({ kind: 'carcass', id: bear.id, dist: 1 });
    expect(JSON.stringify(bear)).toBe(before);
    expect(sim.state.skills.skinning).toBe(K.xp.skinFail + K.xp.skin);
  });

  it('burnt meals give less Cooking XP, and harder recipes grant more for successful work', () => {
    const sim = quietSim();
    sim.putStructure({ id: 999, prefab: 'campfire', x: sim.state.player.x, y: sim.state.player.y, z: sim.state.player.z, rot: 0, fuel: 10 });
    sim.state.stats.crafted.cookedMeat = 1;
    vi.spyOn(rngOf(sim), 'chance').mockReturnValueOnce(true).mockReturnValueOnce(false);
    stockRecipe(sim, 'cookedMeat'); sim.craft('cookedMeat');
    expect(sim.state.skills.cooking).toBe(K.xp.cookFail);
    stockRecipe(sim, 'cookedMeat'); sim.craft('cookedMeat');
    expect(sim.state.skills.cooking).toBe(K.xp.cookFail + K.xp.cook);
    stockRecipe(sim, 'stew'); trainSkill(sim, 'cooking', 8);
    const xp = sim.state.skills.cooking;
    sim.craft('stew');
    expect(sim.state.skills.cooking - xp).toBeGreaterThan(K.xp.cook);
  });
});

describe.each([1, 2] as const)('forest generation %i fishing progression', (generation) => {
  function atLake() {
    const sim = Simulation.newGame(42, 'pnw', generation), lake = sim.terrain.lakes[0];
    sim.state.animals = [];
    sim.state.spawnCheckAt = Infinity;
    sim.state.tools.push('rod'); sim.selectTool('rod');
    let shore = 0;
    while (sim.terrain.heightAt(lake.x + shore, lake.z) < 0.3) shore += 0.25;
    teleport(sim, lake.x + shore, lake.z);
    return sim;
  }

  function bite(sim: Simulation, caught?: FishingCatch) {
    const p = sim.state.player;
    sim.actionCooldown = 0;
    sim.fishing = { phase: 'bite', t: 0, power: 1, fromX: p.x, fromZ: p.z, x: p.x - BALANCE.fishing.maxCast, z: p.z, biteAt: 0, catch: caught };
    return run(sim, 1 / 60, { primary: true, primaryPressed: true });
  }

  it('a novice only gets trout bites; bass and salmon enter the pool at their milestones', () => {
    const sim = atLake();
    for (const level of [1, 5, 10]) {
      const seen = new Set<FishingCatch>();
      for (let n = 0; n < 60; n++) {
        sim.state.skills.fishing = xpForLevel(level);
        keepAlive(sim);
        bite(sim);
        const p = sim.state.player;
        sim.fishing = { phase: 'waiting', t: 0, power: 1, fromX: p.x, fromZ: p.z, x: p.x - BALANCE.fishing.maxCast, z: p.z, biteAt: 0 };
        run(sim, 1 / 60);
        expect(sim.fishing?.phase).toBe('bite');
        const caught = sim.fishing!.catch!;
        expect(FISH_LEVELS[caught]).toBeLessThanOrEqual(level);
        seen.add(caught);
        sim.cancelFishing();
        sim.state.inventory.slots.fill(null);
      }
      expect([...seen].sort()).toEqual(level === 1 ? ['trout'] : level === 5 ? ['bass', 'trout'] : ['bass', 'salmon', 'trout']);
    }
  });

  it('rejects locked strikes without cost and awards less XP for an eligible slip than a catch', () => {
    const sim = atLake(), energy = sim.state.needs.energy;
    expect(bite(sim, 'bass')).toContainEqual(expect.objectContaining({ type: 'fishDone', result: 'reeled' }));
    expect(sim.state.needs.energy).toBeCloseTo(energy, 1);
    expect(sim.state.skills.fishing).toBe(0);
    expect(countItem(sim.state.inventory, 'rawBass')).toBe(0);
    trainSkill(sim, 'fishing', 5);
    const before = sim.state.skills.fishing;
    vi.spyOn(rngOf(sim), 'chance').mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(bite(sim, 'bass')).toContainEqual(expect.objectContaining({ type: 'fishDone', result: 'slipped' }));
    const failedXp = sim.state.skills.fishing - before;
    expect(failedXp).toBeGreaterThan(0);
    expect(bite(sim, 'bass')).toContainEqual(expect.objectContaining({ type: 'fishDone', result: 'caught' }));
    expect(sim.state.skills.fishing - before - failedXp).toBeGreaterThan(failedXp);
    expect(countItem(sim.state.inventory, FISHING_CATCHES.bass.item)).toBe(1);
  });
});

describe('upgrade and interface requirements', () => {
  it('requires Crafting 6, 15 and 30 for every tool upgrade', () => {
    for (const [tool, upgrades] of Object.entries(TOOL_UPGRADES)) {
      const sim = quietSim();
      const t = tool as keyof typeof TOOL_UPGRADES;
      sim.state.tools.push(t); sim.state.inventory.slots = Array(20).fill(null);
      for (let i = 0; i < upgrades.length; i++) {
        const up = upgrades[i];
        give(sim, Object.fromEntries(up.inputs.map((c) => [c.item, c.count])));
        const inventory = JSON.stringify(sim.state.inventory);
        expect(sim.upgradeTool(t).reason).toBe('skill');
        expect(JSON.stringify(sim.state.inventory)).toBe(inventory);
        expect(toolTile(sim, t).badge).toBe('locked');
        trainSkill(sim, 'crafting', up.requiredLevel);
        expect(sim.upgradeTool(t).ok).toBe(true);
        sim.state.inventory.slots.fill(null);
      }
    }
  });

  it('gates bark huts at Crafting 16 and shows the level in the shelter menu', () => {
    const sim = quietSim(), st = placeShelter(sim, 'aFrame');
    sim.state.inventory.slots = Array(20).fill(null);
    give(sim, Object.fromEntries(SHELTER_UPGRADES.barkHut!.map((c) => [c.item, c.count])));
    expect(sim.upgradeStructure(st.id).reason).toBe('skill');
    expect(st.prefab).toBe('aFrame');
    expect(shelterMenu(sim, st.id)?.next?.reason).toBe('Requires Crafting Lv 16.');
    trainSkill(sim, 'crafting', STRUCTURE_LEVELS.barkHut);
    expect(sim.upgradeStructure(st.id).ok).toBe(true);
  });

  it('a pinned recipe cannot appear ready while its skill is locked', () => {
    const sim = quietSim(); stockRecipe(sim, 'bow'); sim.togglePin('bow');
    expect(checklistReady(checklistNeeds(sim.state, false))).toBe(false);
    trainSkill(sim, 'crafting', 5);
    expect(checklistReady(checklistNeeds(sim.state, false))).toBe(true);
    expect(nextSkillUnlock(sim, 'crafting')).toContain('Lv 6');
  });

  it('rechecks skill requirements when confirming an existing placement preview', () => {
    const sim = quietSim(); stockRecipe(sim, 'bench'); trainSkill(sim, 'crafting', 2);
    expect(sim.beginPlacement('bench')).toBe(true);
    sim.state.skills.crafting = 0;
    const inventory = JSON.stringify(sim.state.inventory);
    expect(sim.confirmPlacement()).toBe(false);
    expect(JSON.stringify(sim.state.inventory)).toBe(inventory);
    expect(sim.state.structures).toHaveLength(0);
  });
});

describe('save migration', () => {
  it.each(BIOME_IDS)('preserves old levels/progress once and new XP exactly on %s', (biome) => {
    const sim = Simulation.newGame(42, biome);
    const raw = JSON.parse(serializeState(sim.state));
    raw.version = 6;
    raw.skills = { gathering: 80, hunting: 17.5, cooking: 320, crafting: 0, fishing: 5, skinning: 45 };
    const saved = JSON.stringify(raw), loaded = deserializeState(saved)!;
    expect(skillLevel(loaded.skills.gathering)).toBe(5);
    expect(skillProgress(loaded.skills.gathering)).toBeCloseTo(1 / 3);
    expect(skillLevel(loaded.skills.cooking)).toBe(10);
    expect(skillProgress(loaded.skills.hunting)).toBeCloseTo(0.5);
    expect(deserializeState(serializeState(loaded))?.skills).toEqual(loaded.skills);
    expect(loaded.inventory).toEqual(sim.state.inventory);
    expect(loaded.trees).toEqual(sim.state.trees);
  });
});
