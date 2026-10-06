import { trainSkill, gatherOutcome, drain, nearestResource, nearestTree, quietSim } from './helpers';
import { RESOURCE_LEVELS } from '../src/data/progression';
import { describe, expect, it } from 'vitest';
import { FORAGE_GUIDE, forageForResource, forageGuideFor } from '../src/data/forage';
import { ITEMS } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { RESOURCES, type ResourceKind } from '../src/data/resources';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { foragePage, forageGuide } from '../src/ui/forage';

function harvest(sim: Simulation, kind: ResourceKind) {
  trainSkill(sim, 'gathering', RESOURCE_LEVELS[kind]);
  gatherOutcome(sim);
  const i = nearestResource(sim, kind);
  sim.state.resources[i].charges = Math.max(1, sim.state.resources[i].charges);
  sim.perform({ kind: 'resource', index: i, dist: 1 });
  return drain(sim);
}

describe('Foraging guide', () => {
  it('has a page for every harvestable plant, and none for sticks or stones', () => {
    const plants = (Object.keys(RESOURCES) as ResourceKind[]).filter((k) => forageForResource(k));
    expect(plants.sort()).toEqual(['agave', 'banana', 'berryBush', 'chia', 'cholla', 'coconut', 'fern', 'mushroom', 'onion', 'pandanus', 'pricklyPear', 'purslane', 'seaGrape', 'taro', 'wolfberry', 'yucca']);
    expect(forageGuideFor('pnw').map((e) => e.id).sort()).toEqual(['berryBush', 'birch', 'fern', 'mushroom', 'onion']);
    expect(forageGuideFor('desert').map((e) => e.id).sort()).toEqual(['agave', 'chia', 'cholla', 'juniper', 'mesquite', 'pinyon', 'pricklyPear', 'wolfberry', 'yucca']);
    expect(forageGuideFor('island').map((e) => e.id).sort()).toEqual(['banana', 'breadfruit', 'coconut', 'hau', 'pandanus', 'purslane', 'seaGrape', 'taro']);
    for (const k of plants) expect(FORAGE_GUIDE.some((e) => e.id === forageForResource(k))).toBe(true);
    for (const e of FORAGE_GUIDE) {
      expect(e.name.length).toBeGreaterThan(3);
      expect(e.latin).toMatch(/^[A-Z][a-z]+ [a-z]+/);
      expect(e.use.length).toBeGreaterThan(20);
      expect(e.notes.length).toBeGreaterThan(20);
      expect(ITEMS[e.item]).toBeDefined();
    }
    expect(forageForResource('stickPile')).toBeNull();
    expect(forageForResource('stonePile')).toBeNull();
  });

  it('starts empty and unlocks a plant the first time you harvest it, once', () => {
    const sim = quietSim();
    gatherOutcome(sim);
    expect(sim.state.forage).toEqual([]);
    expect(forageGuide(sim.state)).toMatchObject({ unlocked: 0, total: 5 });
    expect(harvest(sim, 'stickPile').some((e) => e.type === 'forageUnlocked')).toBe(false);
    const first = harvest(sim, 'berryBush');
    expect(first).toContainEqual({ type: 'forageUnlocked', id: 'berryBush' });
    expect(first.some((e) => e.type === 'message' && /Foraging guide/.test(e.text))).toBe(true);
    expect(sim.state.forage).toEqual(['berryBush']);
    expect(harvest(sim, 'berryBush').some((e) => e.type === 'forageUnlocked')).toBe(false);
    harvest(sim, 'fern');
    harvest(sim, 'mushroom');
    harvest(sim, 'onion');
    expect(sim.state.forage.sort()).toEqual(['berryBush', 'fern', 'mushroom', 'onion']);
  });

  it('peeling birch bark unlocks the birch page', () => {
    const sim = quietSim();
    gatherOutcome(sim);
    sim.selectTool('hands');
    const b = nearestTree(sim, 'birch');
    sim.state.trees[b].bark = 2;
    sim.perform({ kind: 'tree', index: b, dist: 1 });
    expect(drain(sim)).toContainEqual({ type: 'forageUnlocked', id: 'birch' });
    expect(sim.state.forage).toContain('birch');
  });

  it('pages show effects and hunger, recipes that use the plant, and notes; locked pages hide them', () => {
    const sim = quietSim();
    gatherOutcome(sim);
    const berry = FORAGE_GUIDE.find((e) => e.id === 'berryBush')!;
    expect(foragePage(sim.state, berry).unlocked).toBe(false);
    harvest(sim, 'berryBush');
    const page = foragePage(sim.state, berry);
    expect(page.unlocked).toBe(true);
    const food = ITEMS.berries.food!;
    expect(page.effects).toContain(`+${food.hunger} hunger`);
    expect(page.effects).toContain(`+${food.thirst} thirst`);
    expect(page.recipes).toContain("Forager's Skewer");
    const using = RECIPES.filter((r) => r.inputs.some((i) => i.item === 'berries'));
    expect(page.recipes).toEqual(using.map((r) => r.name));
    expect(page.regrowHours).toBe(RESOURCES.berryBush.respawnHours);
    const fern = foragePage(sim.state, FORAGE_GUIDE.find((e) => e.id === 'fern')!);
    expect(fern.effects).toEqual([]);
    expect(fern.upgrades).toBeGreaterThanOrEqual(0);
    const mushroom = foragePage(sim.state, FORAGE_GUIDE.find((e) => e.id === 'mushroom')!);
    expect(mushroom.effects.some((x) => x.startsWith('-'))).toBe(true);
  });

  it('unlocks persist through save and load', () => {
    const sim = quietSim();
    gatherOutcome(sim);
    harvest(sim, 'berryBush');
    harvest(sim, 'onion');
    const loaded = deserializeState(serializeState(sim.state))!;
    expect(loaded.forage).toEqual(['berryBush', 'onion']);
    expect(forageGuide(loaded).unlocked).toBe(2);
    const raw = JSON.parse(serializeState(sim.state));
    raw.forage = ['onion', 'kelp', 3];
    expect(deserializeState(JSON.stringify(raw))!.forage).toEqual(['onion']);
  });

  it('old saves unlock every plant already harvested', () => {
    const sim = quietSim();
    gatherOutcome(sim);
    sim.state.stats.gathered = { fiber: 12, mushroom: 1, bark: 4, stick: 9 };
    const raw = JSON.parse(serializeState(sim.state));
    raw.version = 2;
    delete raw.forage;
    delete raw.toolLevels;
    const loaded = deserializeState(JSON.stringify(raw))!;
    expect(loaded.forage.sort()).toEqual(['birch', 'fern', 'mushroom']);
    expect(new Simulation(loaded).state.forage).toHaveLength(3);
  });

  it('respawning after a multiplayer death starts a fresh guide, like skills and recipes', () => {
    const sim = quietSim();
    gatherOutcome(sim);
    harvest(sim, 'berryBush');
    sim.state.needs.health = 0;
    sim.respawn();
    expect(sim.state.forage).toEqual([]);
  });
});
