import { clamp } from '../core/math';
import { hash2 } from '../core/rng';
import { BIOMES, type BiomeWarmth } from '../data/biomes';
import type { ResourceKind } from '../data/resources';
import { dayOf } from './time';

export const SEASON_DAYS = 25;
export const SEASONS = ['spring', 'summer', 'fall', 'winter'] as const;
export type Season = typeof SEASONS[number];
export const SEASON_NAMES: Record<Season, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' };

/** PNW only. The active season changes during sleep; its first day starts at dawn. */
export interface SeasonState {
  id: Season;
  startDay: number;
  warned?: boolean;
}

export function parseSeason(raw: unknown, hours: number): SeasonState {
  const v = raw as Partial<SeasonState> | null;
  if (v && SEASONS.includes(v.id!) && Number.isInteger(v.startDay) && v.startDay! >= 1 && v.startDay! <= dayOf(hours)) {
    return { id: v.id!, startDay: v.startDay!, ...(v.warned === true ? { warned: true } : {}) };
  }
  // Existing runs get a complete first Spring without moving their clock or resetting the world.
  return { id: 'spring', startDay: dayOf(hours) };
}

export function nextSeason(id: Season): Season {
  return SEASONS[(SEASONS.indexOf(id) + 1) % SEASONS.length];
}

export function seasonDay(s: SeasonState, hours: number): number {
  return clamp(dayOf(hours) - s.startDay + 1, 1, SEASON_DAYS);
}

/** 2 AM on the final night, four hours before the new season's first dawn. */
export function seasonDeadline(s: SeasonState): number {
  return (s.startDay - 1 + SEASON_DAYS) * 24 - 4;
}

export function seasonAtDawn(s: SeasonState, hours: number): SeasonState {
  const elapsed = Math.max(0, Math.floor((dayOf(hours) - s.startDay) / SEASON_DAYS));
  return elapsed ? { id: SEASONS[(SEASONS.indexOf(s.id) + elapsed) % 4], startDay: s.startDay + elapsed * SEASON_DAYS } : s;
}

const base = BIOMES.pnw.warmth;
export const SEASON_WARMTH: Record<Season, BiomeWarmth> = {
  spring: { ...base, day: 68, night: 0 },
  summer: base,
  fall: { ...base, day: 55, night: 0 },
  winter: { ...base, day: 12, night: 0, warmUp: [7, 11], coolDown: [14, 18], coolRate: 36 },
};

export const SEASON_SLEEP_COLD: Record<Season, number> = { spring: 35, summer: 30, fall: 40, winter: 60 };

/** Stable subsets of existing forage spots: changes never reroll the world or reset harvested charges. */
export function seasonalForage(id: Season | null, seed: number, spot: number, kind: ResourceKind): boolean {
  if (!id || (kind !== 'berryBush' && kind !== 'mushroom' && kind !== 'onion')) return true;
  const abundance = id === 'winter' ? 0.05 : id === 'summer' ? 0.65 : 1;
  return hash2(spot, 71, seed) < abundance;
}
