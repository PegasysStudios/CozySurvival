// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { ITEMS } from '../src/data/items';
import { canteenFill, canteenServings } from '../src/sim/canteen';
import { countItem } from '../src/sim/inventory';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { STATE_VERSION } from '../src/sim/state';
import { Panels } from '../src/ui/panels';
import { drain, give, placeStructure, quietSim } from './helpers';

const CAP = BALANCE.carry.canteenCapacity;
const clickLake = (sim: Simulation) => sim.perform({ kind: 'water', dist: 1, x: 0, z: 0 });

describe('canteen water (round 8)', () => {
  it('water never takes a pack slot: it goes in the canteen, or nowhere without one', () => {
    const sim = quietSim();
    expect(sim.devGive('lakeWater', 2)).toBe(0);
    expect(drain(sim).some((e) => e.type === 'message' && /need a canteen/.test(e.text))).toBe(true);
    sim.state.gear.push('canteen');
    expect(sim.devGive('lakeWater', 6)).toBe(CAP);
    expect(sim.state.canteen.lakeWater).toBe(CAP);
    expect(countItem(sim.state.inventory, 'lakeWater')).toBe(0);
    expect(sim.state.inventory.slots.every((s) => s === null)).toBe(true);
  });

  it('fills from the lake and reports how full it is for the tile bar', () => {
    const sim = quietSim();
    sim.state.gear.push('canteen');
    expect(canteenFill(sim.state)).toBe(0);
    clickLake(sim);
    expect(canteenServings(sim.state)).toBe(CAP);
    expect(canteenFill(sim.state)).toBe(1);
  });

  it('each Drink takes one serving and restores thirst, until the canteen is empty', () => {
    const sim = quietSim();
    sim.state.gear.push('canteen');
    clickLake(sim);
    sim.state.needs.thirst = 10;
    const per = ITEMS.lakeWater.food!.thirst!;
    for (let k = 1; k <= CAP; k++) {
      expect(sim.drinkCanteen()).toBe(true);
      expect(sim.state.canteen.lakeWater).toBe(CAP - k);
      expect(sim.state.needs.thirst).toBeCloseTo(10 + per * k);
      expect(canteenFill(sim.state)).toBeCloseTo((CAP - k) / CAP);
    }
    expect(sim.drinkCanteen()).toBe(false);
    expect(sim.state.needs.thirst).toBeCloseTo(10 + per * CAP);
  });

  it('boiling water works inside the canteen, even when it is full', () => {
    const sim = quietSim();
    placeStructure(sim, 'campfire');
    give(sim, { lakeWater: CAP });
    expect(sim.craft('boilWater').ok).toBe(true);
    expect(sim.state.canteen).toEqual({ lakeWater: CAP - 1, boiledWater: 1 });
    give(sim, { berries: 2 });
    expect(sim.craft('berryTea').ok).toBe(true);
    expect(sim.state.canteen.boiledWater).toBe(0);
    expect(countItem(sim.state.inventory, 'berryTea')).toBe(1);
  });

  it('F (quick consume) drinks from the canteen when thirst is what matters most', () => {
    const sim = quietSim();
    give(sim, { lakeWater: 2, berries: 3 });
    Object.assign(sim.state.needs, { thirst: 20, hunger: 95 });
    expect(sim.quickConsume()).toBe(true);
    expect(sim.state.canteen.lakeWater).toBe(1);
    expect(countItem(sim.state.inventory, 'berries')).toBe(3);
  });

  it('the pack shows the canteen with a fill bar, and its panel has a Drink button', () => {
    const sim = quietSim();
    give(sim, { lakeWater: 3 });
    const root = document.createElement('div');
    document.body.append(root);
    const panels = new Panels(root, { sim: () => sim, sfx: () => {}, close: () => panels.close(), toast: () => {} });
    panels.open('inventory');
    const tile = () => [...root.querySelectorAll<HTMLElement>('.inv-section .tile')].find((t) => t.dataset.key === 'r:canteen')!;
    const bar = tile().querySelector<HTMLElement>('.dur.water i')!;
    expect(bar.style.transform).toBe(`scaleX(${(3 / CAP).toFixed(3)})`);
    expect(tile().dataset.tip).toContain(`3/${CAP}`);
    tile().click();
    const drink = () => [...root.querySelectorAll<HTMLButtonElement>('.canteen-detail .btn')].find((b) => b.textContent === 'Drink')!;
    expect(root.querySelector('.canteen-detail')!.textContent).toContain(`3 / ${CAP}`);
    sim.state.needs.thirst = 30;
    for (let k = 0; k < 3; k++) drink().click();
    expect(sim.state.canteen.lakeWater).toBe(0);
    expect(sim.state.needs.thirst).toBeGreaterThan(30);
    expect(drink().disabled).toBe(true);
    expect(tile().querySelector('.dur.water.empty')).not.toBeNull();
  });
});

describe('saves from before the canteen change (round 8)', () => {
  /** A version-3 save: water rode in pack slots and there was no canteen field. */
  function oldSave(sim: Simulation, water: [number, number]): string {
    const raw = JSON.parse(serializeState(sim.state)) as Record<string, unknown> & { inventory: { slots: unknown[] } };
    raw.version = 3;
    delete raw.canteen;
    raw.inventory.slots[0] = { item: 'lakeWater', count: water[0] };
    raw.inventory.slots[1] = { item: 'stone', count: 5 };
    raw.inventory.slots[2] = { item: 'boiledWater', count: water[1] };
    return JSON.stringify(raw);
  }

  for (const biome of ['pnw', 'desert'] as const) {
    it(`${biome}: pack water pours into the canteen and frees its slots`, () => {
      const sim = Simulation.newGame(42, biome);
      sim.state.gear.push('canteen');
      sim.state.objective = 3;
      const s = deserializeState(oldSave(sim, [2, 1]))!;
      expect(s).not.toBeNull();
      expect(s.version).toBe(STATE_VERSION);
      expect(s.canteen).toEqual({ lakeWater: 2, boiledWater: 1 });
      expect(s.inventory.slots[0]).toBeNull();
      expect(s.inventory.slots[1]).toEqual({ item: 'stone', count: 5 });
      expect(s.inventory.slots[2]).toBeNull();
      // Round 8 only moves the water; the onboarding position is kept.
      expect(s.objective).toBe(3);
      expect(new Simulation(s).state.canteen).toEqual({ lakeWater: 2, boiledWater: 1 });
    });
  }

  it('water past the canteen capacity, or with no canteen at all, is poured out', () => {
    const sim = quietSim();
    sim.state.gear.push('canteen');
    const full = deserializeState(oldSave(sim, [4, 3]))!;
    expect(canteenServings(full)).toBe(CAP);
    expect(full.inventory.slots.filter((x) => x && ITEMS[x.item].canteen)).toEqual([]);
    sim.state.gear = [];
    const none = deserializeState(oldSave(sim, [2, 1]))!;
    expect(none.canteen).toEqual({ lakeWater: 0, boiledWater: 0 });
    expect(none.inventory.slots.filter((x) => x && ITEMS[x.item].canteen)).toEqual([]);
  });

  it('a round 8 save round-trips the canteen', () => {
    const sim = quietSim();
    give(sim, { lakeWater: 1, boiledWater: 2 });
    const s = deserializeState(serializeState(sim.state))!;
    expect(s.canteen).toEqual({ lakeWater: 1, boiledWater: 2 });
  });
});
