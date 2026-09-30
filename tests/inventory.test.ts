import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/data/items';
import { addItem, countItem, createInventory, hasAll, removeAll, removeFromSlot, removeItem, roomFor, setCapacity, usedSlots } from '../src/sim/inventory';

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

  it('capacity only grows', () => {
    const inv = createInventory(2);
    setCapacity(inv, 6);
    expect(inv.slots.length).toBe(6);
    setCapacity(inv, 3);
    expect(inv.slots.length).toBe(6);
  });
});

describe('plant fiber stack size (round 6)', () => {
  const ROUND_5_STACKS: Record<string, number> = {
    stick: 12, stone: 10, fiber: 16, berries: 12, mushroom: 10, onion: 10, bark: 10, log: 4, cordage: 10,
    rawMeat: 6, rawFish: 6, hide: 6, lakeWater: 4, boiledWater: 4, cookedMeat: 6, grilledTrout: 6, skewer: 6,
    forageSkewer: 6, berryTea: 4, stew: 4, cedarTrout: 4, troutChowder: 4, troutSkewer: 6, smokedTrout: 8,
    charredMeal: 6, arrow: 16,
  };

  it('fiber stacks to 30 per slot, up from 16', () => {
    expect(ROUND_5_STACKS.fiber).toBe(16);
    expect(ITEMS.fiber.stack).toBe(30);
  });

  it('every other item keeps its stack size', () => {
    const pnwItems = Object.values(ITEMS).filter((def) => def.id in ROUND_5_STACKS);
    expect(pnwItems.map((d) => d.id).sort()).toEqual(Object.keys(ROUND_5_STACKS).sort());
    for (const def of pnwItems) {
      if (def.id === 'fiber') continue;
      expect([def.id, def.stack]).toEqual([def.id, ROUND_5_STACKS[def.id]]);
    }
  });

  it('30 fiber fill one slot and the 31st starts a second', () => {
    const inv = createInventory(3);
    expect(addItem(inv, 'fiber', 30)).toBe(30);
    expect(usedSlots(inv)).toBe(1);
    expect(inv.slots[0]).toEqual({ item: 'fiber', count: 30 });
    expect(addItem(inv, 'fiber', 1)).toBe(1);
    expect(usedSlots(inv)).toBe(2);
    expect(inv.slots[1]).toEqual({ item: 'fiber', count: 1 });
  });

  it('a 16-fiber stack from an old save tops up to 30', () => {
    const inv = createInventory(2);
    inv.slots[0] = { item: 'fiber', count: 16 };
    expect(roomFor(inv, 'fiber')).toBe(14 + 30);
    expect(addItem(inv, 'fiber', 14)).toBe(14);
    expect(inv.slots[0]).toEqual({ item: 'fiber', count: 30 });
    expect(usedSlots(inv)).toBe(1);
  });
});
