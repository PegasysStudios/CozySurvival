import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { RECIPES } from '../src/data/recipes';
import { countItem } from '../src/sim/inventory';
import { campfireMenu } from '../src/ui/campfire';
import { drain, give, placeStructure, quietSim } from './helpers';

const F = BALANCE.fire;

function atFire() {
  const sim = quietSim();
  const fire = placeStructure(sim, 'campfire');
  return { sim, fire };
}

describe('campfire menu', () => {
  it('interacting with a lit campfire opens its own menu', () => {
    const { sim, fire } = atFire();
    sim.perform({ kind: 'structure', id: fire.id, dist: 1 });
    expect(drain(sim)).toContainEqual({ type: 'openCooking', structure: fire.id });
    expect(campfireMenu(sim, fire.id)).not.toBeNull();
  });

  it('fuel meter tracks the fire and reads out hours left', () => {
    const { sim, fire } = atFire();
    fire.fuel = 4;
    let m = campfireMenu(sim, fire.id)!;
    expect(m.fraction).toBeCloseTo(4 / F.maxFuelHours);
    expect(m.maxFuel).toBe(F.maxFuelHours);
    expect(m.lit).toBe(true);
    expect(m.status).toBe('Burning · about 4.0 h of fuel left');
    fire.fuel = 0;
    m = campfireMenu(sim, fire.id)!;
    expect(m).toMatchObject({ fraction: 0, lit: false, status: 'The fire is out' });
    fire.fuel = F.maxFuelHours;
    expect(campfireMenu(sim, fire.id)!.fraction).toBe(1);
  });

  it('adds the fuel you pick: a stick or a log', () => {
    const { sim, fire } = atFire();
    fire.fuel = 2;
    give(sim, { stick: 2, log: 1 });
    expect(campfireMenu(sim, fire.id)!.fuelOptions).toEqual([
      { item: 'stick', hours: F.stickFuelHours, have: 2, enabled: true },
      { item: 'log', hours: F.logFuelHours, have: 1, enabled: true },
    ]);
    expect(sim.addFuel(fire.id, 'stick')).toBe(true);
    expect(fire.fuel).toBeCloseTo(2 + F.stickFuelHours);
    expect(countItem(sim.state.inventory, 'stick')).toBe(1);
    expect(countItem(sim.state.inventory, 'log')).toBe(1);
    expect(sim.addFuel(fire.id, 'log')).toBe(true);
    expect(fire.fuel).toBeCloseTo(2 + F.stickFuelHours + F.logFuelHours);
    expect(countItem(sim.state.inventory, 'log')).toBe(0);
    expect(drain(sim).filter((e) => e.type === 'fuelAdded').map((e) => e.type === 'fuelAdded' && e.item)).toEqual(['stick', 'log']);
    expect(campfireMenu(sim, fire.id)!.fraction).toBeCloseTo((2 + F.stickFuelHours + F.logFuelHours) / F.maxFuelHours);
  });

  it('fuel buttons are off when you have none of it or the fire is full, and nothing is wasted', () => {
    const { sim, fire } = atFire();
    fire.fuel = 2;
    give(sim, { stick: 1 });
    const opts = campfireMenu(sim, fire.id)!.fuelOptions;
    expect(opts.find((o) => o.item === 'log')!.enabled).toBe(false);
    expect(sim.addFuel(fire.id, 'log')).toBe(false);
    expect(countItem(sim.state.inventory, 'stick')).toBe(1);
    expect(fire.fuel).toBe(2);
    fire.fuel = F.maxFuelHours;
    const full = campfireMenu(sim, fire.id)!;
    expect(full.full).toBe(true);
    expect(full.fuelOptions.every((o) => !o.enabled)).toBe(true);
    expect(sim.addFuel(fire.id, 'stick')).toBe(false);
    expect(countItem(sim.state.inventory, 'stick')).toBe(1);
  });

  it('relights a fire that went out', () => {
    const { sim, fire } = atFire();
    fire.fuel = 0;
    give(sim, { log: 1 });
    expect(sim.addFuel(fire.id, 'log')).toBe(true);
    expect(campfireMenu(sim, fire.id)!.lit).toBe(true);
    expect(sim.isNearLitFire()).toBe(true);
  });

  it('lists only campfire recipes, ready-to-cook first, and cooks them', () => {
    const { sim, fire } = atFire();
    give(sim, { berries: 3, lakeWater: 1 });
    sim.craft('boilWater');
    drain(sim);
    const m = campfireMenu(sim, fire.id)!;
    expect(m.recipes.length).toBeGreaterThan(0);
    expect(m.recipes.every((r) => r.station === 'fire')).toBe(true);
    expect(m.recipes.map((r) => r.id)).not.toContain('axe');
    expect(m.recipes.map((r) => r.id)).not.toContain('campfire');
    expect(m.recipes.map((r) => r.id)).toContain('berryTea');
    expect(m.recipes.map((r) => r.id)).toEqual(RECIPES.filter((r) => r.station === 'fire').map((r) => r.id));
    expect(sim.craft('berryTea').ok).toBe(true);
    expect(countItem(sim.state.inventory, 'berryTea') + countItem(sim.state.inventory, 'charredMeal')).toBe(1);
  });

  it('cooking needs the fire lit', () => {
    const { sim, fire } = atFire();
    give(sim, { lakeWater: 1 });
    fire.fuel = 0;
    const m = campfireMenu(sim, fire.id)!;
    expect(m.recipes.map((r) => r.id)).toContain('boilWater');
    expect(sim.canCraft('boilWater')).toMatchObject({ ok: false, reason: 'station' });
  });

  it('is only for fires', () => {
    const { sim } = atFire();
    const bench = placeStructure(sim, 'bench');
    expect(campfireMenu(sim, bench.id)).toBeNull();
    expect(campfireMenu(sim, 99999)).toBeNull();
  });
});
