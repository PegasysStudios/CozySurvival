import { trainSkill, drain, give, keepAlive, placeStructure, quietSim, teleport } from './helpers';
import { describe, expect, it } from 'vitest';
import { PREFABS } from '../src/data/prefabs';
import { BIN_TIERS, BIN_UPGRADES } from '../src/data/upgrades';
import { countItem } from '../src/sim/inventory';
import { deserializeState, serializeState } from '../src/sim/save';
import type { StructureState } from '../src/sim/state';
import { storeTotals } from '../src/sim/storage';
import { storageMenu } from '../src/ui/structure';
import type { Simulation } from '../src/sim/simulation';

/** A storage bin, with the player stepped well clear of it so upgrades have room. */
function binSim(): { sim: Simulation; bin: StructureState } {
  const sim = quietSim();
    trainSkill(sim, 'crafting', 20);
  const bin = placeStructure(sim, 'storageBin');
  teleport(sim, bin.x + 6, bin.z);
  keepAlive(sim);
  return { sim, bin };
}

function roomy(sim: Simulation): void {
  for (const g of ['basket', 'backpack'] as const) if (!sim.state.gear.includes(g)) sim.state.gear.push(g);
  while (sim.state.inventory.slots.length < 16) sim.state.inventory.slots.push(null);
}

const slotOf = (sim: Simulation, item: string) => sim.state.inventory.slots.findIndex((s) => s?.item === item);

describe('the storage bin (round 8)', () => {
  it('is a craftable structure with ten slots that opens on click', () => {
    const { sim, bin } = binSim();
    expect(bin.prefab).toBe('storageBin');
    expect(bin.store).toHaveLength(10);
    expect(bin.store!.every((s) => s === null)).toBe(true);
    sim.perform({ kind: 'structure', id: bin.id, dist: 1 });
    expect(drain(sim)).toContainEqual({ type: 'openStructure', structure: bin.id });
    expect(storageMenu(sim, bin.id)).toMatchObject({ tier: 1, tiers: 3, slots: 10, used: 0 });
  });

  it('moves whole stacks or single items in and out of the pack', () => {
    const { sim, bin } = binSim();
    sim.state.inventory.slots.fill(null);
    give(sim, { stick: 12, rawMeat: 3, cordage: 2 });
    expect(sim.storeItem(bin.id, slotOf(sim, 'stick'))).toBe(12);
    expect(sim.storeItem(bin.id, slotOf(sim, 'rawMeat'), 1)).toBe(1);
    expect(countItem(sim.state.inventory, 'stick')).toBe(0);
    expect(countItem(sim.state.inventory, 'rawMeat')).toBe(2);
    expect(storeTotals(bin.store)).toEqual(new Map([['stick', 12], ['rawMeat', 1]]));
    expect(storageMenu(sim, bin.id)!.used).toBe(2);

    const sticks = bin.store!.findIndex((s) => s?.item === 'stick');
    expect(sim.takeItem(bin.id, sticks, 1)).toBe(1);
    expect(countItem(sim.state.inventory, 'stick')).toBe(1);
    expect(sim.takeItem(bin.id, sticks)).toBe(11);
    expect(bin.store![sticks]).toBeNull();
    expect(countItem(sim.state.inventory, 'stick')).toBe(12);
    expect(sim.takeItem(bin.id, sticks)).toBe(0);
  });

  it('refuses when the bin or the pack is full, and loses nothing', () => {
    const { sim, bin } = binSim();
    bin.store!.fill(null).forEach((_, i) => (bin.store![i] = { item: 'stone', count: 1 }));
    bin.store![9] = null;
    bin.store![0] = { item: 'fiber', count: 1 };
    sim.state.inventory.slots.fill(null);
    give(sim, { bark: 2, cordage: 1 });
    expect(sim.storeItem(bin.id, slotOf(sim, 'bark'))).toBe(2);
    expect(sim.storeItem(bin.id, slotOf(sim, 'cordage'))).toBe(0);
    expect(countItem(sim.state.inventory, 'cordage')).toBe(1);

    const pack = sim.state.inventory.slots;
    pack.forEach((_, i) => (pack[i] = { item: 'log', count: 99 }));
    expect(sim.takeItem(bin.id, 0)).toBe(0);
    expect(bin.store![0]).toEqual({ item: 'fiber', count: 1 });
    expect(drain(sim).some((e) => e.type === 'packFull')).toBe(true);
  });

  it('upgrades in place from 10 slots to 15 to 20, keeping what is inside', () => {
    const { sim, bin } = binSim();
    roomy(sim);
    sim.state.inventory.slots.fill(null);
    give(sim, { stick: 5 });
    sim.storeItem(bin.id, slotOf(sim, 'stick'));
    const sizes = [bin.store!.length];
    for (const next of BIN_TIERS.slice(1)) {
      sim.state.inventory.slots.fill(null);
      give(sim, Object.fromEntries(BIN_UPGRADES[next]!.map((i) => [i.item, i.count])));
      expect(storageMenu(sim, bin.id)!.next!.prefab).toBe(next);
      expect(sim.upgradeStructure(bin.id)).toEqual({ ok: true, reason: null });
      expect(bin.prefab).toBe(next);
      sizes.push(bin.store!.length);
      expect(storeTotals(bin.store).get('stick')).toBe(5);
    }
    expect(sizes).toEqual([10, 15, 20]);
    expect(BIN_TIERS.map((p) => PREFABS[p].storage!.slots)).toEqual([10, 15, 20]);
    expect(sim.canUpgradeStructure(bin.id)).toEqual({ ok: false, reason: 'maxed' });
    expect(storageMenu(sim, bin.id)).toMatchObject({ tier: 3, slots: 20, next: null });
  });

  it('keeps its contents through a save, and drops anything a save could not have held', () => {
    const { sim, bin } = binSim();
    bin.store![3] = { item: 'hide', count: 4 };
    const raw = JSON.parse(serializeState(sim.state));
    const saved = raw.structures.find((s: { id: number }) => s.id === bin.id);
    expect(saved.store[3]).toEqual({ item: 'hide', count: 4 });
    saved.store[4] = { item: 'lakeWater', count: 2 };
    saved.store[5] = { item: 'notAThing', count: 1 };
    const loaded = deserializeState(JSON.stringify(raw))!.structures.find((s) => s.id === bin.id)!;
    expect(loaded.store).toHaveLength(10);
    expect(storeTotals(loaded.store)).toEqual(new Map([['hide', 4]]));
  });
});
