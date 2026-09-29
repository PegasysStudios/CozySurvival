import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { advanceHours, canSleepAt, dayOf, daylight, formatClock, hourOf, hoursSurvived, isNight, nextDayStart, realSecondsForHours } from '../src/sim/time';
import { quietSim, run } from './helpers';

describe('day cycle math', () => {
  it('one in-game day lasts 24 real minutes at 1x (one real minute per game hour)', () => {
    expect(realSecondsForHours(24)).toBeCloseTo(1440);
    expect(realSecondsForHours(1)).toBeCloseTo(60);
    expect(advanceHours(0, 1440, 1)).toBeCloseTo(24);
    expect(advanceHours(0, 60, 1)).toBeCloseTo(1);
    expect(advanceHours(0, 60, 24)).toBeCloseTo(24);
  });

  it('a day starts at dawn (06:00)', () => {
    expect(dayOf(0)).toBe(1);
    expect(hourOf(0)).toBe(6);
    expect(dayOf(23.99)).toBe(1);
    expect(hourOf(18)).toBe(0);
    expect(dayOf(24)).toBe(2);
    expect(hourOf(24)).toBe(6);
    expect(nextDayStart(30)).toBe(48);
  });

  it('night, sleep window, and daylight curve', () => {
    expect(isNight(12)).toBe(false);
    expect(isNight(22)).toBe(true);
    expect(isNight(3)).toBe(true);
    expect(canSleepAt(18.9)).toBe(false);
    expect(canSleepAt(19)).toBe(true);
    expect(canSleepAt(4)).toBe(true);
    expect(canSleepAt(6)).toBe(false);
    expect(daylight(12)).toBe(1);
    expect(daylight(1)).toBe(0);
    expect(daylight(19)).toBeGreaterThan(0);
    expect(daylight(19)).toBeLessThan(1);
  });

  it('formats a friendly clock', () => {
    expect(formatClock(7.5)).toBe('7:30 AM');
    expect(formatClock(0)).toBe('12:00 AM');
    expect(formatClock(13.25)).toBe('1:15 PM');
  });

  it('counts survived hours from the 7 AM start', () => {
    expect(hoursSurvived(BALANCE.time.startHour - BALANCE.time.dayStartHour)).toBe(0);
    expect(hoursSurvived(25)).toBe(24);
  });
});

describe('day cycle in the simulation', () => {
  it('starts on day 1 at 7 AM', () => {
    const sim = quietSim();
    expect(sim.day).toBe(1);
    expect(sim.hour).toBeCloseTo(7);
  });

  it('dev time scale speeds the day and emits dayStart/nightfall exactly once', () => {
    const sim = quietSim();
    sim.timeScale = 96; // 1 day in 15 real seconds
    const events = [];
    for (let i = 0; i < 31; i++) {
      Object.assign(sim.state.needs, { hunger: 100, thirst: 100, warmth: 100, health: 100 });
      events.push(...run(sim, 0.5, {}, 1 / 30));
    }
    expect(sim.day).toBe(2);
    expect(events.filter((e) => e.type === 'dayStart')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'nightfall')).toHaveLength(1);
    expect(sim.state.stats.events.nightfall).toBe(1);
  });

  it('at 1x, ten real minutes advance ten game hours', () => {
    const sim = quietSim();
    run(sim, 600, {}, 0.1);
    expect(sim.hour).toBeCloseTo(17, 1);
  });
});
