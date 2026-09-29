import { BALANCE } from '../data/balance';
import { PREFABS } from '../data/prefabs';
import { RECIPES, type Recipe } from '../data/recipes';
import { countItem } from '../sim/inventory';
import type { Simulation } from '../sim/simulation';

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
  /** Known campfire recipes, ready-to-cook first. */
  recipes: Recipe[];
  undiscovered: number;
}

export const isCampfireRecipe = (r: Recipe): boolean => r.station === 'fire';

export function campfireMenu(sim: Simulation, fireId: number): CampfireMenu | null {
  const s = sim.state;
  const fire = s.structures.find((x) => x.id === fireId);
  if (!fire || !PREFABS[fire.prefab].fire) return null;
  const f = BALANCE.fire;
  const full = fire.fuel >= f.maxFuelHours - 0.5;
  const fuelOptions: FuelOption[] = (['stick', 'log'] as const).map((item) => {
    const have = countItem(s.inventory, item);
    return { item, hours: item === 'log' ? f.logFuelHours : f.stickFuelHours, have, enabled: have > 0 && !full };
  });
  const cooking = RECIPES.filter(isCampfireRecipe);
  const known = cooking.filter((r) => s.known.includes(r.id));
  const recipes = [...known].sort((a, b) => Number(sim.canCraft(b.id).ok) - Number(sim.canCraft(a.id).ok));
  return {
    fuel: fire.fuel,
    maxFuel: f.maxFuelHours,
    fraction: Math.min(1, Math.max(0, fire.fuel / f.maxFuelHours)),
    lit: fire.fuel > 0,
    full,
    status: fire.fuel > 0 ? `Burning · about ${fire.fuel.toFixed(1)} h of fuel left` : 'The fire is out',
    fuelOptions,
    recipes,
    undiscovered: cooking.length - known.length,
  };
}
