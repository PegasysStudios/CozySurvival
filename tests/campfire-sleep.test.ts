import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { hourOf } from '../src/sim/time';
import { campfireMenu } from '../src/ui/campfire';
import { drain, placeStructure, quietSim, run, teleport } from './helpers';

const S = BALANCE.needs.sleep;

function byTheFire() {
  const sim = quietSim();
  sim.devSetSeason('summer'); // Original 30-point sleep cost; seasonal costs are covered separately.
  const fire = placeStructure(sim, 'campfire');
  teleport(sim, fire.x + 1.6, fire.z);
  Object.assign(sim.state.needs, { hunger: 80, thirst: 80, health: 50, warmth: 70, energy: 15 });
  return { sim, fire };
}

describe('sleeping by the campfire', () => {
  it('the campfire menu offers Sleep, enabled from 7 PM', () => {
    const { sim, fire } = byTheFire();
    sim.devSetHour(12);
    expect(campfireMenu(sim, fire.id)).toMatchObject({ canSleep: false, sleepLabel: 'Sleep (after 7 PM)' });
    sim.devSetHour(21);
    const m = campfireMenu(sim, fire.id)!;
    expect(m).toMatchObject({ canSleep: true, sleepLabel: 'Sleep by the fire' });
    expect(m.sleepNote).toMatch(/keeps you warm/);
    fire.fuel = 0;
    expect(campfireMenu(sim, fire.id)!.sleepNote).toMatch(/wake up cold/);
  });

  it('uses the normal sleep cycle: skip to dawn, full energy, the fire keeps burning down', () => {
    const { sim, fire } = byTheFire();
    sim.devSetHour(21);
    const day = sim.day;
    const fuel = fire.fuel;
    drain(sim);
    expect(sim.trySleep(fire.id)).toBe(true);
    const ev = drain(sim);
    expect(ev).toContainEqual({ type: 'slept', day: day + 1, byFire: true });
    expect(sim.day).toBe(day + 1);
    expect(hourOf(sim.state.totalHours)).toBeCloseTo(BALANCE.time.dayStartHour, 3);
    expect(sim.state.needs.energy).toBe(100);
    expect(fire.fuel).toBeLessThan(fuel);
    expect(sim.state.stats.events.slept).toBe(1);
  });

  it('a burning fire keeps your warmth, but gives none of a shelter\'s healing bonus', () => {
    const { sim, fire } = byTheFire();
    sim.devSetHour(21);
    expect(sim.trySleep(fire.id)).toBe(true);
    expect(sim.state.needs.warmth).toBeGreaterThanOrEqual(70);
    expect(sim.state.needs.health).toBe(50 + S.healthGain);
  });

  it('a fire that has gone out means the usual cold night', () => {
    const { sim, fire } = byTheFire();
    sim.devSetHour(21);
    fire.fuel = 0;
    run(sim, 1 / 60);
    drain(sim);
    expect(sim.trySleep(fire.id)).toBe(true);
    expect(drain(sim)).toContainEqual(expect.objectContaining({ type: 'slept', byFire: false }));
    expect(sim.state.needs.warmth).toBeCloseTo(70 - S.coldWarmthCost, 1);
  });

  it('follows the usual rules: not before 7 PM, and not with a predator on the prowl', () => {
    const { sim, fire } = byTheFire();
    sim.devSetHour(15);
    expect(sim.trySleep(fire.id)).toBe(false);
    expect(drain(sim)).toContainEqual({ type: 'sleepDenied', reason: 'You can only sleep after 7 PM.' });
    sim.devSetHour(22);
    const wolf = sim.devSpawn('wolf', 12)!;
    wolf.mode = 'chase';
    expect(sim.trySleep(fire.id)).toBe(false);
    expect(drain(sim).some((e) => e.type === 'sleepDenied' && /predator/.test(e.reason))).toBe(true);
  });

  it('a campfire takes no wear from a night slept beside it', () => {
    const { sim, fire } = byTheFire();
    sim.devSetHour(21);
    expect(sim.trySleep(fire.id)).toBe(true);
    expect(fire.wear).toBeUndefined();
    expect(sim.state.structures).toContain(fire);
  });
});
