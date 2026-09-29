import { smoothstep } from '../core/math';
import { BALANCE, GAME_HOURS_PER_REAL_SECOND } from '../data/balance';

const T = BALANCE.time;

/** Day number (1-based). A day begins at dawn (06:00). */
export function dayOf(totalHours: number): number {
  return Math.floor(totalHours / 24) + 1;
}

/** Clock hour in [0, 24). */
export function hourOf(totalHours: number): number {
  const h = (T.dayStartHour + (totalHours % 24) + 24) % 24;
  return h;
}

export function advanceHours(totalHours: number, realDt: number, timeScale: number): number {
  return totalHours + realDt * timeScale * GAME_HOURS_PER_REAL_SECOND;
}

export function realSecondsForHours(hours: number, timeScale = 1): number {
  return hours / (GAME_HOURS_PER_REAL_SECOND * timeScale);
}

export function isNight(hour: number): boolean {
  return hour >= T.nightStartHour || hour < T.nightEndHour;
}

export function canSleepAt(hour: number): boolean {
  return hour >= T.sleepFromHour || hour < T.sleepUntilHour;
}

/** Total hours at the start of the next day (next dawn). */
export function nextDayStart(totalHours: number): number {
  return (Math.floor(totalHours / 24) + 1) * 24;
}

export function hoursSurvived(totalHours: number): number {
  return Math.max(0, totalHours - (T.startHour - T.dayStartHour));
}

/** 0 at night, 1 in full daylight, smooth through dawn and dusk. */
export function daylight(hour: number): number {
  const rise = smoothstep(4.8, 7.5, hour);
  const set = 1 - smoothstep(18, 20.8, hour);
  return Math.min(rise, set);
}

/** Ambient warmth the player drifts toward with no fire or shelter. */
export function ambientWarmth(hour: number): number {
  const w = BALANCE.needs.warmth;
  const warmUp = smoothstep(5, 9, hour);
  const coolDown = 1 - smoothstep(17, 21.5, hour);
  const k = Math.min(warmUp, coolDown);
  return w.night + (w.day - w.night) * k;
}

export function formatClock(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m < 10 ? '0' : ''}${m} ${period}`;
}

export function formatDuration(hours: number): string {
  const days = Math.floor(hours / 24);
  const rem = Math.floor(hours - days * 24);
  if (days === 0) return `${rem} hour${rem === 1 ? '' : 's'}`;
  return `${days} day${days === 1 ? '' : 's'}, ${rem} hour${rem === 1 ? '' : 's'}`;
}
