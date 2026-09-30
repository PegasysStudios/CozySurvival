import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import type { BiomeId } from '../src/data/biomes';
import { PREFABS } from '../src/data/prefabs';
import type { SimEvent } from '../src/sim/events';
import { applyFood, applySleep, createNeeds, restWhileWaiting, updateNeeds, type NeedsContext } from '../src/sim/needs';
import { Simulation, IDLE_INPUT } from '../src/sim/simulation';
import type { DamageSource, NeedsState } from '../src/sim/state';
import { drain, placeShelter } from './helpers';

const N = BALANCE.needs;
const SLEEP_SHARE = N.sleep.emptyDrainShare;
const RATE: Record<'hunger' | 'thirst' | 'warmth', { perHour: number; cause: DamageSource }> = {
  hunger: { perHour: N.starvingDamagePerHour, cause: 'starvation' },
  thirst: { perHour: N.dehydrationDamagePerHour, cause: 'dehydration' },
  warmth: { perHour: N.freezingDamagePerHour, cause: 'cold' },
};
type Meter = keyof typeof RATE;
const METERS = Object.keys(RATE) as Meter[];
const leanTo = PREFABS.leanTo.shelter!;

/** Total hours for a clock hour on a given day (days start at 6 AM). */
const at = (day: number, hour: number) => (day - 1) * 24 + ((hour - BALANCE.time.dayStartHour + 24) % 24);

/** Needs with every meter full except `empty`, which sit at 0, and the warmth target kept wherever warmth is. */
function needsWith(empty: Meter[], health = 100): NeedsState {
  const n = createNeeds();
  Object.assign(n, { hunger: 100, thirst: 100, warmth: 100, health });
  for (const m of empty) n[m] = 0;
  return n;
}

/** `hours` of awake time in small steps, holding hunger/thirst where they are so only the empty meters matter. */
function awake(n: NeedsState, hours: number, over: Partial<NeedsContext> = {}): DamageSource | null {
  const steps = 240;
  let cause: DamageSource | null = null;
  for (let i = 0; i < steps && !cause; i++) {
    const hold = { hunger: n.hunger, thirst: n.thirst };
    cause = updateNeeds(n, { gameHours: hours / steps, realDt: 0, activity: 'idle', warmthTarget: n.warmth, warmthRatePerHour: 0, sitting: false, ...over });
    if (hold.hunger > 0) n.hunger = hold.hunger;
    if (hold.thirst > 0) n.thirst = hold.thirst;
  }
  return cause;
}

function quiet(biome: BiomeId): Simulation {
  const sim = Simulation.newGame(42, biome);
  sim.state.animals.length = 0;
  sim.state.spawnCheckAt = Infinity;
  return sim;
}

/** Run the game at an hour per real second; returns every event, and checks the player is alive exactly while health is above 0. */
function play(sim: Simulation, hours: number, hold: Partial<NeedsState> = {}): SimEvent[] {
  sim.timeScale = 60;
  const all: SimEvent[] = [];
  const dt = 1 / 60;
  for (let t = 0; t < hours && !sim.state.dead; t += dt) {
    Object.assign(sim.state.needs, hold);
    sim.step(dt, { ...IDLE_INPUT, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch });
    const ev = drain(sim);
    all.push(...ev);
    if (sim.state.dead) expect(sim.state.needs.health).toBe(0);
    else expect(sim.state.needs.health).toBeGreaterThan(0);
  }
  return all;
}

describe('health and needs audit (round 10): awake', () => {
  it.each(METERS)('an empty %s meter drains health slowly, at its own hourly rate', (m) => {
    const n = needsWith([m]);
    expect(awake(n, 1)).toBeNull();
    expect(n.health).toBeCloseTo(100 - RATE[m].perHour, 6);
    // Slowly: several game hours (real minutes) from full health to nothing.
    expect(100 / RATE[m].perHour).toBeGreaterThan(4);
  });

  it('the drains of several empty meters add up', () => {
    const pairs: Meter[][] = [['hunger', 'thirst'], ['hunger', 'warmth'], ['thirst', 'warmth'], ['hunger', 'thirst', 'warmth']];
    for (const empty of pairs) {
      const n = needsWith(empty);
      expect(awake(n, 1)).toBeNull();
      const sum = empty.reduce((a, m) => a + RATE[m].perHour, 0);
      expect(n.health, empty.join('+')).toBeCloseTo(100 - sum, 6);
    }
  });

  it('an empty meter never kills by itself: you die only when health reaches 0, blamed on the biggest drain', () => {
    for (const empty of [['hunger'], ['thirst'], ['warmth'], ['hunger', 'thirst'], ['hunger', 'warmth']] as Meter[][]) {
      const n = needsWith(empty);
      const hoursToZero = 100 / empty.reduce((a, m) => a + RATE[m].perHour, 0);
      expect(awake(n, hoursToZero * 0.95)).toBeNull();
      expect(n.health).toBeGreaterThan(0);
      const cause = awake(n, hoursToZero * 0.1);
      expect(n.health).toBe(0);
      const worst = empty.reduce((a, b) => (RATE[b].perHour > RATE[a].perHour ? b : a));
      expect(cause, empty.join('+')).toBe(RATE[worst].cause);
    }
  });

  it('no healing while any meter is empty', () => {
    for (const m of METERS) {
      const n = needsWith([m], 50);
      awake(n, 0.5);
      expect(n.health).toBeLessThan(50);
    }
    const fed = needsWith([], 50);
    awake(fed, 1);
    expect(fed.health).toBeCloseTo(50 + N.healthRegenPerHour, 6);
  });

  it('the round 3 cold rule: in the grace nights cold stops at 1 health, even on top of hunger or thirst, which can still kill', () => {
    const cold = needsWith(['warmth'], 30);
    expect(awake(cold, 10, { coldLethal: false })).toBeNull();
    expect(cold.health).toBe(1);
    const both = needsWith(['warmth', 'hunger'], 30);
    const cause = awake(both, 10, { coldLethal: false });
    expect(both.health).toBe(0);
    expect(cause).toBe('starvation');
    const lethal = needsWith(['warmth'], 30);
    expect(awake(lethal, 10, { coldLethal: true })).toBe('cold');
    expect(lethal.health).toBe(0);
  });

  it('food and drink never take the last of your health, whatever they cost', () => {
    const n = needsWith([], 5);
    applyFood(n, { health: -40, hunger: -100, thirst: -100 });
    expect(n.health).toBe(1);
    expect(n.hunger).toBe(0);
  });
});

describe('health and needs audit (round 10): asleep', () => {
  const NIGHT = 9;

  it.each(METERS)('asleep, an empty %s meter drains health at a quarter of the awake rate, with no healing', (m) => {
    const n = needsWith([m], 80);
    const r = applySleep(n, leanTo, false, NIGHT);
    const cost = RATE[m].perHour * SLEEP_SHARE * NIGHT;
    // Warmth at 0 away from a fire sits at 0 all night; hunger and thirst at 0 stay at 0 (the sleep floor only holds them up).
    expect(n.health).toBeCloseTo(80 - cost, 6);
    expect(r.lost).toBeCloseTo(80 - n.health, 6);
    expect(r.cause).toBeNull();
    expect(r.from[0]).toBe(RATE[m].cause);
    expect(SLEEP_SHARE).toBe(0.25);
  });

  it('asleep, the drains add up too, worst first', () => {
    const n = needsWith(['hunger', 'thirst'], 90);
    const r = applySleep(n, leanTo, true, NIGHT);
    expect(n.health).toBeCloseTo(90 - (N.starvingDamagePerHour + N.dehydrationDamagePerHour) * SLEEP_SHARE * NIGHT, 6);
    expect(r.from).toEqual(['dehydration', 'starvation']);
  });

  it('a fed, warm sleeper still heals and loses nothing', () => {
    const n = needsWith([], 60);
    const r = applySleep(n, leanTo, true, NIGHT);
    expect(n.health).toBe(60 + N.sleep.healthGain + leanTo.healthBonus);
    expect(r).toEqual({ lost: 0, cause: null, from: [] });
  });

  it('the sleep cost itself never empties hunger or thirst, so a little left in them costs no health', () => {
    const n = needsWith([], 70);
    Object.assign(n, { hunger: 3, thirst: 2 });
    const r = applySleep(n, leanTo, true, NIGHT);
    expect(n.hunger).toBe(3);
    expect(n.thirst).toBe(2);
    expect(r.lost).toBe(0);
  });

  it('away from a fire, warmth runs out part-way through the night and only the rest of the night costs health', () => {
    const n = needsWith([], 80);
    n.warmth = 12;
    const r = applySleep(n, leanTo, false, NIGHT);
    expect(n.warmth).toBe(0);
    expect(r.lost).toBeCloseTo(warmthCost(12, NIGHT), 6);
    expect(r.lost).toBeGreaterThan(0);
    // By a burning fire you wake warm, with no cold at all.
    const fire = needsWith([], 80);
    fire.warmth = 0;
    expect(applySleep(fire, leanTo, true, NIGHT).lost).toBe(0);
    // Warm enough at bedtime, the night's warmth cost never reaches 0.
    const warm = needsWith([], 80);
    warm.warmth = 40;
    expect(applySleep(warm, leanTo, false, NIGHT).lost).toBe(0);
  });

  it('you can die in your sleep only when health reaches 0, and in the grace nights never of cold', () => {
    const n = needsWith(['thirst'], 20);
    const r = applySleep(n, leanTo, true, NIGHT);
    expect(n.health).toBe(0);
    expect(r.cause).toBe('dehydration');
    const graceCold = needsWith(['warmth'], 10);
    const g = applySleep(graceCold, leanTo, false, NIGHT, false);
    expect(graceCold.health).toBe(1);
    expect(g.cause).toBeNull();
    const lethalCold = needsWith(['warmth'], 10);
    expect(applySleep(lethalCold, leanTo, false, NIGHT, true).cause).toBe('cold');
    expect(lethalCold.health).toBe(0);
  });

  it('waiting in bed in multiplayer: meters hold, but empty ones drain at the sleeping rate', () => {
    const n = needsWith(['hunger'], 50);
    n.thirst = 60;
    expect(restWhileWaiting(n, 2, false)).toBeNull();
    expect(n.health).toBeCloseTo(50 - N.starvingDamagePerHour * SLEEP_SHARE * 2, 6);
    expect(n.thirst).toBe(60);
    const cold = needsWith(['warmth'], 50);
    restWhileWaiting(cold, 2, true);
    expect(cold.health).toBe(50);
    restWhileWaiting(cold, 2, false, false);
    expect(cold.health).toBeCloseTo(50 - N.freezingDamagePerHour * SLEEP_SHARE * 2, 6);
    const dying = needsWith(['hunger'], 1);
    expect(restWhileWaiting(dying, 2, false)).toBe('starvation');
    expect(dying.health).toBe(0);
  });
});

/** Health the cold costs over a night that starts at `warmth` away from a fire, at the sleeping rate. */
function warmthCost(warmth: number, hours: number): number {
  const atZero = hours * Math.max(0, Math.min(1, 1 - warmth / N.sleep.coldWarmthCost));
  return N.freezingDamagePerHour * SLEEP_SHARE * atZero;
}

for (const biome of ['pnw', 'desert'] as const) {
  describe(`health and needs audit (round 10): in the game on the ${biome === 'pnw' ? 'Pacific Northwest' : 'desert'} map`, () => {
    it('starving by day wears health down at 15 an hour, and death comes only as health reaches 0', () => {
      const sim = quiet(biome);
      Object.assign(sim.state.needs, { hunger: 0, thirst: 100, warmth: 80, health: 100 });
      play(sim, 1, { hunger: 0, thirst: 100 });
      expect(sim.state.needs.health).toBeCloseTo(100 - N.starvingDamagePerHour, 0);
      expect(sim.state.dead).toBe(false);
      const ev = play(sim, 8, { hunger: 0, thirst: 100 });
      expect(sim.state.dead).toBe(true);
      expect(ev.find((e) => e.type === 'death')).toMatchObject({ cause: 'starvation' });
    });

    it('hungry and thirsty at once, the drains add up', () => {
      const sim = quiet(biome);
      Object.assign(sim.state.needs, { hunger: 0, thirst: 0, warmth: 80, health: 100 });
      play(sim, 1, { hunger: 0, thirst: 0 });
      expect(sim.state.needs.health).toBeCloseTo(100 - N.starvingDamagePerHour - N.dehydrationDamagePerHour, 0);
    });

    it('a night 1 with no fire and no warmth drains health but cannot freeze you to death', () => {
      const sim = quiet(biome);
      sim.state.totalHours = at(1, 20.5);
      Object.assign(sim.state.needs, { hunger: 100, thirst: 100, warmth: 0, health: 60 });
      const ev = play(sim, 9, { hunger: 100, thirst: 100 });
      expect(ev.some((e) => e.type === 'death')).toBe(false);
      expect(sim.state.needs.health).toBe(1);
    });

    it('sleeping starving in a lean-to costs health at the sleeping rate, with a warning on waking', () => {
      const sim = quiet(biome);
      const hut = placeShelter(sim, 'leanTo');
      sim.devSetHour(21);
      Object.assign(sim.state.needs, { hunger: 0, thirst: 90, warmth: 90, health: 90 });
      drain(sim);
      const before = sim.state.totalHours;
      expect(sim.trySleep(hut.id)).toBe(true);
      const hours = sim.state.totalHours - before;
      expect(sim.state.needs.health).toBeCloseTo(90 - N.starvingDamagePerHour * SLEEP_SHARE * hours, 6);
      const ev = drain(sim);
      expect(ev.some((e) => e.type === 'message' && /slept hungry and woke up weaker/.test(e.text))).toBe(true);
      expect(sim.state.dead).toBe(false);
    });

    it('sleeping hungry and thirsty on low health: you die in your sleep, as health reaches 0', () => {
      const sim = quiet(biome);
      const hut = placeShelter(sim, 'leanTo');
      sim.devSetHour(21);
      Object.assign(sim.state.needs, { hunger: 0, thirst: 0, warmth: 90, health: 30 });
      drain(sim);
      expect(sim.trySleep(hut.id)).toBe(true);
      expect(sim.state.dead).toBe(true);
      expect(sim.state.needs.health).toBe(0);
      expect(sim.state.deathCause).toBe('dehydration');
      const ev = drain(sim);
      expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(['slept', 'dayStart', 'death']));
    });

    it('sleeping cold with no fire: never lethal in the grace nights, lethal from night 3', () => {
      for (const [day, dies] of [[1, false], [2, false], [3, true]] as const) {
        const sim = quiet(biome);
        sim.state.totalHours = at(day, 21);
        const hut = placeShelter(sim, 'leanTo');
        Object.assign(sim.state.needs, { hunger: 90, thirst: 90, warmth: 0, health: 8 });
        drain(sim);
        expect(sim.trySleep(hut.id), `day ${day}`).toBe(true);
        expect(sim.state.dead, `day ${day}`).toBe(dies);
        expect(sim.state.needs.health, `day ${day}`).toBe(dies ? 0 : 1);
        if (dies) expect(sim.state.deathCause).toBe('cold');
      }
    });
  });
}
