import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/data/items';
import { addItem, countItem, createInventory, hasAll, removeAll, removeFromSlot, removeItem, roomFor, setCapacity, usedSlots, waterUnits } from '../src/sim/inventory';

describe('inventory', () => {
  it('stacks up to the item stack size, then uses new slots', () => {
    const inv = createInventory(3);
    const stack = ITEMS.stick.stack;
    expect(addItem(inv, 'stick', stack + 3)).toBe(stack + 3);
    expect(inv.slots[0]).toEqual({ item: 'stick', count: stack });
    expect(inv.slots[1]).toEqual({ item: 'stick', count: 3 });
    expect(usedSlots(inv)).toBe(2);
  });

  it('enforces the carry limit and reports partial adds', () => {
    const inv = createInventory(2);
    addItem(inv, 'stone', 1);
    addItem(inv, 'berries', 1);
    expect(addItem(inv, 'fiber', 5)).toBe(0);
    expect(roomFor(inv, 'fiber')).toBe(0);
    expect(roomFor(inv, 'stone')).toBe(ITEMS.stone.stack - 1);
    expect(addItem(inv, 'stone', 100)).toBe(ITEMS.stone.stack - 1);
    expect(countItem(inv, 'stone')).toBe(ITEMS.stone.stack);
  });

  it('fills partial stacks before empty slots', () => {
    const inv = createInventory(3);
    inv.slots[2] = { item: 'stick', count: 5 };
    addItem(inv, 'stick', 2);
    expect(inv.slots[2]!.count).toBe(7);
    expect(inv.slots[0]).toBeNull();
  });

  it('removeItem is all-or-nothing and frees empty slots', () => {
    const inv = createInventory(3);
    addItem(inv, 'stick', 4);
    expect(removeItem(inv, 'stick', 5)).toBe(false);
    expect(countItem(inv, 'stick')).toBe(4);
    expect(removeItem(inv, 'stick', 4)).toBe(true);
    expect(inv.slots[0]).toBeNull();
  });

  it('removeAll is atomic across several ingredients', () => {
    const inv = createInventory(4);
    addItem(inv, 'stick', 3);
    addItem(inv, 'stone', 1);
    const reqs = [{ item: 'stick' as const, count: 2 }, { item: 'stone' as const, count: 2 }];
    expect(hasAll(inv, reqs)).toBe(false);
    expect(removeAll(inv, reqs)).toBe(false);
    expect(countItem(inv, 'stick')).toBe(3);
    addItem(inv, 'stone', 1);
    expect(removeAll(inv, reqs)).toBe(true);
    expect(countItem(inv, 'stick')).toBe(1);
    expect(countItem(inv, 'stone')).toBe(0);
  });

  it('removeFromSlot takes from a single slot', () => {
    const inv = createInventory(2);
    addItem(inv, 'berries', 5);
    expect(removeFromSlot(inv, 0, 2)).toEqual({ item: 'berries', count: 2 });
    expect(removeFromSlot(inv, 0, 99)).toEqual({ item: 'berries', count: 3 });
    expect(inv.slots[0]).toBeNull();
    expect(removeFromSlot(inv, 1, 1)).toBeNull();
  });

  it('capacity only grows and water units are counted', () => {
    const inv = createInventory(2);
    setCapacity(inv, 6);
    expect(inv.slots.length).toBe(6);
    setCapacity(inv, 3);
    expect(inv.slots.length).toBe(6);
    addItem(inv, 'lakeWater', 2);
    addItem(inv, 'boiledWater', 1);
    addItem(inv, 'berryTea', 1);
    expect(waterUnits(inv)).toBe(4);
  });
});
