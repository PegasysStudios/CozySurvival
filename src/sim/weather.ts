import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import { SEASON_DAYS, SEASONS, type Season, type SeasonState } from './seasons';
import { dayOf } from './time';

export const WEATHER = ['sunny', 'cloudy', 'rainy', 'foggy', 'snowy'] as const;
export type Weather = typeof WEATHER[number];
export const WEATHER_NAMES: Record<Weather, string> = {
  sunny: 'Sunny', cloudy: 'Cloudy', rainy: 'Rainy', foggy: 'Foggy', snowy: 'Snowy',
};

/** Exact totals in a 25-day PNW season; order is randomized separately from gameplay RNG. */
export const WEATHER_DAYS: Record<Season, Record<Weather, number>> = {
  spring: { sunny: 8, cloudy: 7, rainy: 7, foggy: 3, snowy: 0 },
  summer: { sunny: 13, cloudy: 6, rainy: 4, foggy: 2, snowy: 0 },
  fall: { sunny: 6, cloudy: 8, rainy: 7, foggy: 4, snowy: 0 },
  winter: { sunny: 6, cloudy: 8, rainy: 0, foggy: 4, snowy: 7 },
};

/** Saved and host-owned. A dev override changes only today's id, leaving tomorrow's choice intact. */
export interface WeatherState {
  id: Weather;
  day: number;
  season: Season;
  startDay: number;
  pattern: Weather[];
}

export function weatherForSeason(id: Weather, season: Season): Weather {
  if (id === 'rainy' || id === 'snowy') return season === 'winter' ? 'snowy' : 'rainy';
  return id;
}

function trailingRun(recent: readonly Weather[], id: Weather): number {
  let n = 0;
  for (let i = recent.length - 1; i >= 0 && recent[i] === id; i--) n++;
  return n;
}

/** Weighted draws without replacement, reserving enough other days to prevent a three-day streak. */
export function weatherPattern(seed: number, season: SeasonState, previous: readonly Weather[] = []): Weather[] {
  const rng = new Rng(seed ^ Math.imul(season.startDay, 0x9e3779b1) ^ Math.imul(SEASONS.indexOf(season.id) + 1, 0x85ebca6b) ^ 0x77656174);
  const left = { ...WEATHER_DAYS[season.id] };
  const recent = previous.slice(-2).map((id) => weatherForSeason(id, season.id));
  const pattern: Weather[] = [];
  for (let day = 0; day < SEASON_DAYS; day++) {
    const remaining = SEASON_DAYS - day - 1;
    const choices = WEATHER.filter((id) => {
      if (!left[id] || trailingRun(recent, id) >= 2) return false;
      left[id]--;
      recent.push(id);
      const feasible = WEATHER.every((other) => left[other] <= 2 * (remaining - left[other] + 1) - trailingRun(recent, other));
      recent.pop();
      left[id]++;
      return feasible;
    });
    let roll = rng.next() * choices.reduce((sum, id) => sum + left[id], 0);
    const id = choices.find((choice) => (roll -= left[choice]) < 0);
    if (!id) throw new Error('PNW weather mix cannot satisfy the two-day streak limit');
    left[id]--;
    pattern.push(id);
    recent.push(id);
    if (recent.length > 2) recent.shift();
  }
  return pattern;
}

function validState(raw: unknown): raw is WeatherState {
  if (!raw || typeof raw !== 'object') return false;
  const v = raw as WeatherState;
  if (!SEASONS.includes(v.season) || !WEATHER.includes(v.id) || weatherForSeason(v.id, v.season) !== v.id) return false;
  if (!Number.isInteger(v.startDay) || v.startDay < 1 || !Number.isInteger(v.day) || v.day < v.startDay || v.day >= v.startDay + SEASON_DAYS) return false;
  if (!Array.isArray(v.pattern) || v.pattern.length !== SEASON_DAYS) return false;
  const counts = { sunny: 0, cloudy: 0, rainy: 0, foggy: 0, snowy: 0 };
  for (let i = 0; i < v.pattern.length; i++) {
    const id = v.pattern[i];
    if (!WEATHER.includes(id) || (i >= 2 && id === v.pattern[i - 1] && id === v.pattern[i - 2])) return false;
    counts[id]++;
  }
  return WEATHER.every((id) => counts[id] === WEATHER_DAYS[v.season][id]);
}

/** Load/migrate or advance at dawn. Reading a valid same-day save never rerolls its weather. */
export function parseWeather(raw: unknown, seed: number, hours: number, season: SeasonState): WeatherState {
  const day = dayOf(hours);
  const old = validState(raw) ? raw : null;
  let pattern: Weather[];
  if (old && old.season === season.id && old.startDay === season.startDay) pattern = [...old.pattern];
  else {
    const previous: Weather[] = [];
    if (old && old.day === day - 1) {
      const index = old.day - old.startDay;
      if (index > 0) previous.push(old.pattern[index - 1]);
      previous.push(old.id);
    }
    pattern = weatherPattern(seed, season, previous);
  }
  const sameDay = old && old.day === day && old.season === season.id && old.startDay === season.startDay;
  return { id: sameDay ? old.id : pattern[clamp(day - season.startDay, 0, SEASON_DAYS - 1)], day, season: season.id, startDay: season.startDay, pattern };
}

export function cloneWeather(s: WeatherState): WeatherState {
  return { ...s, pattern: [...s.pattern] };
}
