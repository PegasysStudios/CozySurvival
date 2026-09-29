import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { PREFABS } from '../src/data/prefabs';
import { applySleep, createNeeds, updateNeeds, type NeedsContext } from '../src/sim/needs';
import type { Simulation } from '../src/sim/simulation';
import type { NeedsState } from '../src/sim/state';
import { drain, placeStructure, quietSim, run, teleport } from './helpers';

const N = BALANCE.needs;

/** Total hours for a clock hour on a given day (days start at 6 AM). */
const at = (day: number, hour: number) => (day - 1) * 24 + ((hour - BALANCE.time.dayStartHour + 24) % 24);

function freezing(n: NeedsState, hours: number, over: Partial<NeedsContext> = {}) {
  let cause = null;
  for (let i = 0; i < 200; i++) {
    const c = updateNeeds(n, { gameHours: hours / 200, realDt: 0, activity: 'idle', warmthTarget: 0, warmthRatePerHour: N.warmthRatePerHour, sitting: false, ...over });
    if (c) cause = c;
  }
  return cause;
}

/** A still world with no wildlife, the player well fed, standing at night at `total` hours. */
function coldNight(total: number): Simulation {
  const sim = quietSim();
  sim.state.spawnCheckAt = Infinity;
  sim.state.totalHours = total;
  Object.assign(sim.state.needs, { hunger: 100, thirst: 100, health: 100, energy: 100, warmth: 0 });
  sim.timeScale = 60;
  return sim;
}

describe('cold cannot kill during the first two nights', () => {
  it('grace applies on days 1 and 2 (their nights included) and ends at dawn of day 3', () => {
    const sim = quietSim();
    for (const [day, hour, lethal] of [[1, 7, false], [1, 23, false], [2, 2, false], [2, 22, false], [2, 5.9, false], [3, 6.1, true], [3, 23, true], [9, 1, true]] as const) {
      sim.state.totalHours = at(day, hour);
      expect(sim.coldLethal).toBe(lethal);
    }
    expect(N.coldGraceNights).toBe(2);
  });

  it('while in grace, freezing still hurts but stops at 1 health', () => {
    const n = createNeeds();
    Object.assign(n, { warmth: 0, hunger: 100, thirst: 100 });
    expect(freezing(n, 8, { coldLethal: false })).toBeNull();
    expect(n.health).toBe(1);
    // and it never heals while frozen
    expect(freezing(n, 2, { coldLethal: false })).toBeNull();
    expect(n.health).toBe(1);
  });

  it('once grace is over, cold is lethal again', () => {
    const n = createNeeds();
    Object.assign(n, { warmth: 0, hunger: 100, thirst: 100 });
    expect(freezing(n, 8, { coldLethal: true })).toBe('cold');
    expect(n.health).toBe(0);
    const m = createNeeds();
    Object.assign(m, { warmth: 0, hunger: 100, thirst: 100 });
    expect(freezing(m, 8)).toBe('cold');
  });

  it('grace covers only the cold: starvation and thirst still kill', () => {
    const n = createNeeds();
    Object.assign(n, { warmth: 0, hunger: 0, thirst: 100 });
    expect(freezing(n, 8, { coldLethal: false })).toBe('starvation');
    expect(n.health).toBe(0);
  });

  it.each([1, 2])('in the running game: a whole freezing night %i with no fire is survived', (day) => {
    const sim = coldNight(at(day, 20.5));
    const ev = run(sim, 8.5, {}, 1 / 30);
    expect(sim.state.dead).toBe(false);
    expect(ev.some((e) => e.type === 'death')).toBe(false);
    expect(sim.state.needs.health).toBeGreaterThanOrEqual(1);
    expect(sim.state.needs.health).toBeLessThan(20);
  });

  it('in the running game: night 3 with no fire can freeze you to death', () => {
    const sim = coldNight(at(3, 20.5));
    run(sim, 8.5, {}, 1 / 30);
    expect(sim.state.dead).toBe(true);
    expect(sim.state.deathCause).toBe('cold');
  });
});

describe('no warmth loss in range of a burning campfire', () => {
  function byFire(distance: number) {
    const sim = coldNight(at(1, 23));
    const fire = placeStructure(sim, 'campfire');
    teleport(sim, fire.x + distance, fire.z);
    sim.state.needs.warmth = 90;
    return { sim, fire };
  }

  it('holds warmth even at the edge of the fire, where it used to fall toward the night cold', () => {
    const { sim } = byFire(N.fireWarmRadius - 0.3);
    run(sim, 3, {}, 1 / 30);
    expect(sim.state.needs.warmth).toBeGreaterThanOrEqual(90);
  });

  it('close in, a cold player still warms up', () => {
    const { sim } = byFire(1.6);
    sim.state.needs.warmth = 10;
    run(sim, 1, {}, 1 / 30);
    expect(sim.state.needs.warmth).toBeGreaterThan(60);
  });

  it('never lowers the warmth target below where you are, at any distance in range', () => {
    const { sim, fire } = byFire(0);
    for (const warmth of [5, 50, 95, 100]) {
      sim.state.needs.warmth = warmth;
      for (let d = 1.5; d <= N.fireWarmRadius; d += 0.5) {
        teleport(sim, fire.x + d, fire.z);
        expect(sim.warmthTarget().target).toBeGreaterThanOrEqual(warmth);
      }
    }
  });

  it('out of range, or once the fire is out, the cold takes warmth again', () => {
    const far = byFire(N.fireWarmRadius + 3);
    run(far.sim, 1, {}, 1 / 30);
    expect(far.sim.state.needs.warmth).toBeLessThan(80);
    const out = byFire(2);
    out.fire.fuel = 0;
    run(out.sim, 1, {}, 1 / 30);
    expect(out.sim.state.needs.warmth).toBeLessThan(80);
  });
});

describe('sleeping away from a burning campfire costs 30% warmth', () => {
  const leanTo = PREFABS.leanTo.shelter!;

  it('the cost is 30 points of the 0-100 warmth meter, and it is a tunable', () => {
    expect(N.sleep.coldWarmthCost).toBe(30);
    const n = createNeeds();
    n.warmth = 70;
    applySleep(n, leanTo, false);
    expect(n.warmth).toBe(40);
    n.warmth = 20;
    applySleep(n, leanTo);
    expect(n.warmth).toBe(0);
  });

  it('by a burning fire you never wake colder, and the shelter still warms you', () => {
    const n = createNeeds();
    n.warmth = 95;
    applySleep(n, leanTo, true);
    expect(n.warmth).toBe(95);
    n.warmth = 10;
    applySleep(n, leanTo, true);
    expect(n.warmth).toBe(45 + leanTo.warmthBonus);
  });

  function sleeper(withFire: boolean) {
    const sim = coldNight(at(1, 21));
    const hut = placeStructure(sim, 'leanTo');
    teleport(sim, hut.x + 2, hut.z);
    let fire = null;
    if (withFire) {
      fire = placeStructure(sim, 'campfire');
      teleport(sim, fire.x + 1.6, fire.z);
    } else {
      teleport(sim, hut.x + 2, hut.z);
    }
    drain(sim);
    sim.state.needs.warmth = 70;
    return { sim, hut, fire };
  }

  it('in the game: sleeping in a shelter with no fire nearby', () => {
    const { sim, hut } = sleeper(false);
    expect(sim.trySleep(hut.id)).toBe(true);
    expect(sim.state.needs.warmth).toBe(70 - N.sleep.coldWarmthCost);
    expect(drain(sim)).toContainEqual(expect.objectContaining({ type: 'slept', byFire: false }));
  });

  it('in the game: sleeping beside a burning campfire keeps your warmth', () => {
    const { sim, hut } = sleeper(true);
    expect(sim.trySleep(hut.id)).toBe(true);
    expect(sim.state.needs.warmth).toBeGreaterThanOrEqual(70);
    expect(drain(sim)).toContainEqual(expect.objectContaining({ type: 'slept', byFire: true }));
  });

  it('in the game: a campfire that has gone out does not count', () => {
    const { sim, hut, fire } = sleeper(true);
    fire!.fuel = 0;
    expect(sim.trySleep(hut.id)).toBe(true);
    expect(sim.state.needs.warmth).toBe(70 - N.sleep.coldWarmthCost);
  });
});
