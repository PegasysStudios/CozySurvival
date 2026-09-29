import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { ITEMS } from '../src/data/items';
import { PREFABS } from '../src/data/prefabs';
import { applyFood, applySleep, createNeeds, updateEnergy, updateNeeds, type NeedsContext } from '../src/sim/needs';
import type { NeedsState } from '../src/sim/state';

const N = BALANCE.needs;
const ctx = (over: Partial<NeedsContext> = {}): NeedsContext => ({
  gameHours: 0,
  realDt: 0,
  activity: 'idle',
  warmthTarget: 80,
  warmthRatePerHour: N.warmthRatePerHour,
  sitting: false,
  ...over,
});

function hours(n: NeedsState, h: number, over: Partial<NeedsContext> = {}, steps = 100) {
  let cause = null;
  for (let i = 0; i < steps; i++) {
    const c = updateNeeds(n, ctx({ gameHours: h / steps, ...over }));
    if (c) cause = c;
  }
  return cause;
}

describe('hunger, thirst, health', () => {
  it('drains slowly: roughly a day of food, half a day of water from full', () => {
    const n = createNeeds();
    n.hunger = 100;
    n.thirst = 100;
    n.warmth = 80;
    hours(n, 10);
    expect(n.hunger).toBeCloseTo(100 - N.hungerPerHour * 10, 5);
    expect(n.thirst).toBeCloseTo(100 - N.thirstPerHour * 10, 5);
    expect(n.health).toBe(100);
    expect(100 / N.hungerPerHour).toBeGreaterThan(16);
    expect(100 / N.thirstPerHour).toBeGreaterThan(11);
  });

  it('starvation drains health and reports the cause at death', () => {
    const n = createNeeds();
    n.hunger = 0;
    n.thirst = 100;
    n.warmth = 80;
    hours(n, 1);
    expect(n.health).toBeCloseTo(100 - N.starvingDamagePerHour, 0);
    const cause = hours(n, 10);
    expect(n.health).toBe(0);
    expect(cause).toBe('starvation');
  });

  it('dehydration outpaces starvation and wins the cause when both are empty', () => {
    const n = createNeeds();
    n.hunger = 0;
    n.thirst = 0;
    n.warmth = 80;
    const cause = hours(n, 10);
    expect(cause).toBe('dehydration');
  });

  it('health regenerates only when fed, watered, and warm', () => {
    const n = createNeeds();
    n.health = 50;
    hours(n, 2);
    expect(n.health).toBeCloseTo(50 + N.healthRegenPerHour * 2, 1);
    n.hunger = 10;
    const before = n.health;
    hours(n, 1);
    expect(n.health).toBe(before);
  });

  it('eating applies food values, clamps to 100, and never kills from raw food', () => {
    const n = createNeeds();
    n.hunger = 90;
    n.health = 3;
    applyFood(n, ITEMS.stew.food!);
    expect(n.hunger).toBe(100);
    applyFood(n, ITEMS.rawMeat.food!);
    expect(n.health).toBeGreaterThanOrEqual(1);
  });
});

describe('warmth', () => {
  it('drifts toward the target at the given rate without overshooting', () => {
    const n = createNeeds();
    n.warmth = 80;
    hours(n, 1, { warmthTarget: 0 });
    expect(n.warmth).toBeCloseTo(80 - N.warmthRatePerHour, 3);
    hours(n, 20, { warmthTarget: 0 });
    expect(n.warmth).toBe(0);
    hours(n, 0.5, { warmthTarget: 100, warmthRatePerHour: N.warmthFireRatePerHour });
    expect(n.warmth).toBeCloseTo(N.warmthFireRatePerHour * 0.5, 3);
  });

  it('freezing damages health and reports cold', () => {
    const n = createNeeds();
    n.warmth = 0;
    n.hunger = 100;
    n.thirst = 100;
    const cause = hours(n, 6, { warmthTarget: 0 });
    expect(cause).toBe('cold');
    expect(n.health).toBeLessThan(100);
  });
});

describe('energy', () => {
  const E = N.energy;
  it('running drains faster than walking; resting regenerates', () => {
    const walk = createNeeds();
    const run = createNeeds();
    updateEnergy(walk, 'walk', 60);
    updateEnergy(run, 'sprint', 60);
    expect(100 - run.energy).toBeGreaterThan((100 - walk.energy) * 5);
    const rest = createNeeds();
    rest.energy = 50;
    updateEnergy(rest, 'idle', 10);
    expect(rest.energy).toBeCloseTo(50 + E.idleRegenPerSec * 10);
  });

  it('eating or drinking speeds up regeneration for a while', () => {
    const a = createNeeds();
    const b = createNeeds();
    a.energy = b.energy = 20;
    applyFood(b, { thirst: 5 });
    b.energy = 20;
    updateEnergy(a, 'idle', 10);
    updateEnergy(b, 'idle', 10);
    expect(b.energy - 20).toBeCloseTo((a.energy - 20) * E.boostMultiplier);
    updateEnergy(b, 'idle', E.boostSeconds);
    expect(b.regenBoost).toBe(0);
  });

  it('sitting on a bench regenerates faster', () => {
    const a = createNeeds();
    const b = createNeeds();
    a.energy = b.energy = 10;
    updateEnergy(a, 'idle', 5, false);
    updateEnergy(b, 'idle', 5, true);
    expect(b.energy).toBeGreaterThan(a.energy);
  });

  it('exhaustion locks sprinting until energy recovers (hysteresis)', () => {
    const n = createNeeds();
    n.energy = 1;
    updateEnergy(n, 'sprint', 5);
    expect(n.energy).toBe(0);
    expect(n.exhausted).toBe(true);
    updateEnergy(n, 'idle', (E.exhaustedRecoverAt - 1) / E.idleRegenPerSec);
    expect(n.exhausted).toBe(true);
    updateEnergy(n, 'idle', 3);
    expect(n.exhausted).toBe(false);
  });

  it('is generous: a normal hour of mostly walking with some sprinting never runs dry', () => {
    const n = createNeeds();
    let min = 100;
    for (let cycle = 0; cycle < 60; cycle++) {
      for (let i = 0; i < 42; i++) updateEnergy(n, 'walk', 1);
      for (let i = 0; i < 6; i++) updateEnergy(n, 'sprint', 1);
      for (let i = 0; i < 12; i++) updateEnergy(n, 'idle', 1);
      min = Math.min(min, n.energy);
    }
    expect(min).toBeGreaterThan(60);
  });

  it('swimming drains more than walking but far less than sprinting; a long swim is fine', () => {
    const walk = createNeeds();
    const swim = createNeeds();
    const sprint = createNeeds();
    updateEnergy(walk, 'walk', 60);
    updateEnergy(swim, 'swim', 60);
    updateEnergy(sprint, 'sprint', 60);
    expect(swim.energy).toBeCloseTo(100 - E.swimDrainPerSec * 60);
    expect(swim.energy).toBeLessThan(walk.energy);
    expect(swim.energy).toBeGreaterThan(sprint.energy);
    const long = createNeeds();
    updateEnergy(long, 'swim', 600);
    expect(long.energy).toBeGreaterThan(0);
  });

  it('tasks drain less than before; crafting and building now cost a little', () => {
    expect(E.swingCost).toBeLessThan(0.5);
    expect(E.gatherCost).toBeLessThan(0.25);
    expect(E.craftCost).toBeGreaterThan(0);
    expect(E.buildCost).toBeGreaterThan(E.craftCost);
  });

  it('about three minutes of continuous sprinting from full is possible', () => {
    const n = createNeeds();
    let t = 0;
    while (n.energy > 0 && t < 1000) {
      updateEnergy(n, 'sprint', 1);
      t++;
    }
    expect(t).toBeGreaterThan(150);
  });
});

describe('sleep', () => {
  it('fully restores energy, costs some food and water, and never drops needs below the floor', () => {
    const n = createNeeds();
    n.energy = 5;
    n.hunger = 60;
    n.thirst = 12;
    n.health = 70;
    applySleep(n, PREFABS.leanTo.shelter!);
    expect(n.energy).toBe(100);
    expect(n.hunger).toBe(60 - N.sleep.hungerCost);
    expect(n.thirst).toBe(N.sleep.floor);
    expect(n.health).toBe(70);
  });

  it('heals when fed, more in a hide tent', () => {
    const a = createNeeds();
    const b = createNeeds();
    a.health = b.health = 50;
    applySleep(a, PREFABS.leanTo.shelter!);
    applySleep(b, PREFABS.hideTent.shelter!);
    expect(a.health).toBe(50 + N.sleep.healthGain);
    expect(b.health).toBeGreaterThan(a.health);
  });
});
