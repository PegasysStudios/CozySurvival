// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { BiomeId } from '../src/data/biomes';
import { NIGHT_STEP, OBJECTIVES } from '../src/data/objectives';
import { recipesFor } from '../src/data/recipes';
import { CRAFT_FAILURE_TEXT } from '../src/sim/crafting';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { craftTiles } from '../src/ui/catalog';
import { Panels } from '../src/ui/panels';
import { give, giveRecipe, keepAlive, quietSim, run } from './helpers';
import { dayOneLimit } from './setup';

const unlocked = (sim: Simulation) => recipesFor(sim.biome).filter((r) => sim.canCraft(r.id).reason !== 'tomorrow').map((r) => r.id);
const locked = (sim: Simulation) => recipesFor(sim.biome).filter((r) => sim.canCraft(r.id).reason === 'tomorrow').map((r) => r.id);

function newGame(biome: BiomeId = 'pnw'): Simulation {
  dayOneLimit(true);
  const sim = biome === 'pnw' ? quietSim() : Simulation.newGame(42, biome);
  sim.state.animals.length = 0;
  keepAlive(sim);
  return sim;
}

describe('the day-1 crafting limit (round 10)', () => {
  it('on day 1 only the recipes the onboarding has reached can be made, step by step, on both maps', () => {
    for (const biome of ['pnw', 'desert'] as const) {
      const sim = newGame(biome);
      const onMap = new Set(recipesFor(biome).map((r) => r.id));
      const want = new Set<string>();
      for (let i = 0; i <= NIGHT_STEP; i++) {
        sim.state.objective = i;
        for (const id of OBJECTIVES[i].unlocks ?? []) if (onMap.has(id)) want.add(id);
        expect(unlocked(sim).sort(), `${biome} step ${OBJECTIVES[i].id}`).toEqual([...want].sort());
      }
      expect(locked(sim).length, biome).toBeGreaterThan(unlocked(sim).length);
    }
    const sim = newGame();
    sim.state.objective = 0;
    expect(unlocked(sim)).toEqual([]);
    sim.state.objective = NIGHT_STEP;
    expect(unlocked(sim).sort()).toEqual(['axe', 'campfire', 'cordage', 'forageSkewer', 'leanTo', 'skewer', 'torch']);
    for (const id of ['knife', 'spear', 'bow', 'arrows', 'rod', 'basket', 'canteen', 'workbench', 'storageBin']) expect(locked(sim), id).toContain(id);
  });

  it('a locked recipe cannot be crafted or placed even with every material, and says it unlocks tomorrow', () => {
    const sim = newGame();
    sim.state.objective = 1;
    sim.state.gear.push('basket', 'backpack');
    sim.state.inventory.slots.push(...new Array(10).fill(null));
    giveRecipe(sim, 'spear');
    giveRecipe(sim, 'leanTo');
    const before = JSON.stringify(sim.state.inventory);
    expect(sim.canCraft('spear')).toEqual({ ok: false, reason: 'tomorrow' });
    expect(sim.craft('spear')).toEqual({ ok: false, reason: 'tomorrow' });
    expect(CRAFT_FAILURE_TEXT.tomorrow).toBe('Unlocks tomorrow.');
    expect(sim.beginPlacement('leanTo')).toBe(false);
    expect(JSON.stringify(sim.state.inventory)).toBe(before);
    expect(sim.state.tools).not.toContain('spear');
    sim.state.objective = NIGHT_STEP;
    expect(sim.canCraft('spear').reason).toBe('tomorrow');
    expect(sim.beginPlacement('leanTo')).toBe(true);
  });

  it('a step unlocks its recipes the moment the onboarding reaches it', () => {
    const sim = newGame();
    sim.state.objective = 4;
    sim.state.stats.events.fuelAdded = 1;
    giveRecipe(sim, 'axe');
    run(sim, 0.05);
    expect(sim.canCraft('axe').reason).toBe('tomorrow');
    sim.state.stats.events.fuelAdded = 2;
    run(sim, 0.05);
    expect(sim.state.objective).toBe(5);
    expect(sim.craft('axe').ok).toBe(true);
  });

  it('everything unlocks on the morning of day 2, wherever the onboarding is', () => {
    const sim = newGame();
    sim.state.objective = 0;
    sim.state.totalHours = 23.9;
    expect(sim.day).toBe(1);
    expect(unlocked(sim)).toEqual([]);
    sim.state.totalHours = 24;
    expect(sim.day).toBe(2);
    expect(locked(sim)).toEqual([]);
    giveRecipe(sim, 'knife');
    expect(sim.craft('knife').ok).toBe(true);
  });

  it('a track already past the night step is never locked, even on day 1', () => {
    const sim = newGame();
    sim.state.objective = NIGHT_STEP + 1;
    expect(locked(sim)).toEqual([]);
    sim.state.objective = OBJECTIVES.length;
    expect(locked(sim)).toEqual([]);
  });

  it('Jon can switch it off', () => {
    const sim = newGame();
    dayOneLimit(false);
    expect(locked(sim)).toEqual([]);
  });
});

describe('old saves and the day-1 limit (round 10)', () => {
  /** The game as a save from before round 10 (version 5) would have stored it, at `objective` on the old track. */
  function asVersion5(sim: Simulation, objective: number): string {
    const raw = JSON.parse(serializeState(sim.state));
    raw.version = 5;
    raw.objective = objective;
    delete raw.stats.events.nightFrom;
    delete raw.skills.skinning;
    raw.resources = raw.resources.map((e: number[]) => e.slice(0, 3));
    return JSON.stringify(raw);
  }

  it('a save already past day 1 loads with nothing locked and no night to wait for, wherever its track was', () => {
    for (const old of [0, 2, 4, 5, 6, 8, 9]) {
      const sim = newGame();
      sim.state.totalHours = 24 + 10;
      const loaded = new Simulation(deserializeState(asVersion5(sim, old))!);
      expect(loaded.state.stats.events.nightFrom, `old step ${old}`).toBe(1);
      expect(locked(loaded), `old step ${old}`).toEqual([]);
    }
  });

  it('an old day-2 save that reaches the night step later passes it straight away', () => {
    const sim = newGame();
    sim.state.totalHours = 24 + 10;
    const loaded = new Simulation(deserializeState(asVersion5(sim, 5))!);
    expect(loaded.state.objective).toBe(5);
    keepAlive(loaded);
    run(loaded, 0.05);
    expect(loaded.state.objective).toBe(5);
    loaded.state.stats.crafted.axe = 1;
    loaded.state.stats.gathered.log = 1;
    run(loaded, 0.05);
    expect(loaded.state.objective).toBe(NIGHT_STEP + 1);
    expect(OBJECTIVES[loaded.state.objective].id).toBe('fish');
  });

  it('old track positions move onto the new track: before the night they stay, after it they shift one on', () => {
    const sim = newGame();
    sim.state.totalHours = 3 * 24;
    const at = (old: number) => OBJECTIVES[deserializeState(asVersion5(sim, old))!.objective]?.id ?? 'done';
    expect([0, 1, 2, 3, 4, 5].map(at)).toEqual(['drink', 'camp', 'forage', 'skewer', 'firewood', 'axe']);
    expect(at(6)).toBe('fish');
    expect(at(7)).toBe('spear');
    expect(at(8)).toBe('bow');
    // A finished old track picks up the one new step at the end: the knife.
    expect(at(9)).toBe('knife');
  });

  it('an old save from day 1 plays like a new day 1 below the night step, and is never held back once past it', () => {
    const sim = newGame();
    sim.state.stats.events.drankByHand = 1;
    sim.state.stats.crafted.campfire = 1;
    const early = new Simulation(deserializeState(asVersion5(sim, 2))!);
    expect(early.state.objective).toBe(2);
    expect(early.canCraft('campfire').reason).not.toBe('tomorrow');
    expect(early.canCraft('axe').reason).toBe('tomorrow');

    const late = new Simulation(deserializeState(asVersion5(sim, 6))!);
    expect(late.state.objective).toBe(NIGHT_STEP + 1);
    expect(locked(late)).toEqual([]);
    keepAlive(late);
    run(late, 0.05);
    expect(late.state.objective).toBe(NIGHT_STEP + 1);
  });

  it('a round-10 save on day 1 keeps its limit after loading', () => {
    const sim = newGame();
    sim.state.objective = 3;
    const loaded = new Simulation(deserializeState(serializeState(sim.state))!);
    expect(loaded.state.objective).toBe(3);
    expect(locked(loaded)).toEqual(locked(sim));
    expect(locked(loaded)).toContain('axe');
  });
});

describe('the crafting menu on day 1 (round 10)', () => {
  function openCrafting(sim: Simulation): HTMLElement {
    const root = document.createElement('div');
    document.body.append(root);
    const panels = new Panels(root, { sim: () => sim, sfx: () => {}, close: () => panels.close(), toast: () => {} });
    panels.open('crafting');
    return root;
  }

  it('shows locked recipes greyed with a lock and "Unlocks tomorrow", even with the materials in the pack', () => {
    const sim = newGame();
    sim.state.objective = NIGHT_STEP;
    give(sim, { stone: 20, stick: 20, fiber: 20, cordage: 4 });
    const tiles = craftTiles(sim, 'all').filter((t) => t.kind === 'recipe');
    const spear = tiles.find((t) => t.id === 'spear')!;
    expect(spear).toMatchObject({ name: 'Spear · Unlocks tomorrow', greyed: true, ready: false, badge: 'locked' });
    expect(tiles.find((t) => t.id === 'axe')).toMatchObject({ name: 'Stone Axe', greyed: false, ready: true, badge: null });
    expect(tiles.filter((t) => t.badge === 'locked').map((t) => t.id).sort()).toEqual(locked(sim).sort());

    const root = openCrafting(sim);
    expect(root.textContent).toContain('Day 1: only what your onboarding steps have reached so far can be made; locked tiles unlock tomorrow.');
    const tile = root.querySelector<HTMLElement>('.tile[data-key="r:spear"]')!;
    expect(tile.classList.contains('greyed')).toBe(true);
    expect(tile.querySelector('.tile-badge.locked')).not.toBeNull();
    tile.click();
    const detail = root.querySelector('.recipe-detail')!;
    expect(detail.querySelector('.craft-reason')!.textContent).toBe('Unlocks tomorrow.');
    expect(detail.querySelector<HTMLButtonElement>('.btn.primary')!.disabled).toBe(true);
  });

  it('from day 2 there are no locks and the usual header returns', () => {
    const sim = newGame();
    sim.state.totalHours = 30;
    expect(craftTiles(sim, 'all').some((t) => t.badge === 'locked' || t.name.includes('tomorrow'))).toBe(false);
    const root = openCrafting(sim);
    expect(root.textContent).toContain('Every recipe is here from the start.');
    expect(root.querySelector('.tile-badge.locked')).toBeNull();
  });
});
