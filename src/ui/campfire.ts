import { BALANCE } from '../data/balance';
import { PREFABS } from '../data/prefabs';
import { recipesFor, type Recipe } from '../data/recipes';
import { countItem } from '../sim/inventory';
import type { Simulation } from '../sim/simulation';
import { canSleepAt } from '../sim/time';

export interface FuelOption {
  item: 'stick' | 'log';
  hours: number;
  have: number;
  enabled: boolean;
}

/** Everything the campfire menu shows, kept free of DOM so it can be tested. */
export interface CampfireMenu {
  fuel: number;
  maxFuel: number;
  /** Fuel meter fill, 0..1. */
  fraction: number;
  lit: boolean;
  /** Too full to take more fuel right now. */
  full: boolean;
  status: string;
  fuelOptions: FuelOption[];
  /** Every campfire recipe, in recipe-book order. */
  recipes: Recipe[];
  canSleep: boolean;
  sleepLabel: string;
  sleepNote: string;
}

export const isCampfireRecipe = (r: Recipe): boolean => r.station === 'fire';

export function campfireMenu(sim: Simulation, fireId: number): CampfireMenu | null {
  const s = sim.state;
  const fire = sim.structures.find((x) => x.id === fireId);
  if (!fire || !PREFABS[fire.prefab].fire) return null;
  const f = BALANCE.fire;
  const full = fire.fuel >= f.maxFuelHours - 0.5;
  const fuelOptions: FuelOption[] = (['stick', 'log'] as const).map((item) => {
    const have = countItem(s.inventory, item);
    return { item, hours: item === 'log' ? f.logFuelHours : f.stickFuelHours, have, enabled: have > 0 && !full };
  });
  const recipes = recipesFor(sim.biome).filter(isCampfireRecipe);
  const canSleep = canSleepAt(sim.hour);
  return {
    fuel: fire.fuel,
    maxFuel: f.maxFuelHours,
    fraction: Math.min(1, Math.max(0, fire.fuel / f.maxFuelHours)),
    lit: fire.fuel > 0,
    full,
    status: fire.fuel > 0 ? `Burning · about ${fire.fuel.toFixed(1)} h of fuel left` : 'The fire is out',
    fuelOptions,
    recipes,
    canSleep,
    sleepLabel: canSleep ? 'Sleep by the fire' : 'Sleep (after 7 PM)',
    sleepNote: fire.fuel > 0
      ? 'Bed down beside the flames until dawn. A burning fire keeps you warm, but you get none of a shelter\'s bonuses.'
      : 'The fire is out. Sleep here and you will wake up cold, so add fuel first.',
  };
}
