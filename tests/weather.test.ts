import { describe, expect, it } from 'vitest';
import { stateFromSnapshot, takeSnapshot } from '../src/net/worldSync';
import { deserializeState, serializeState } from '../src/sim/save';
import { MemoryStorage, RunManager } from '../src/sim/run';
import { SEASONS, type SeasonState } from '../src/sim/seasons';
import { IDLE_INPUT, Simulation } from '../src/sim/simulation';
import { parseWeather, weatherForSeason, weatherPattern, WEATHER, WEATHER_DAYS, type Weather } from '../src/sim/weather';
import { drain, keepAlive, placeStructure, quietSim } from './helpers';

describe('balanced daily PNW weather', () => {
  it('randomizes every seasonal mix, limits streaks across seasons, and replaces winter rain with snow', () => {
    const starts = new Set<string>();
    for (let seed = 0; seed < 400; seed++) {
      let recent: Weather[] = ['rainy', 'rainy'];
      for (let cycle = 0; cycle < 2; cycle++) for (const [index, id] of SEASONS.entries()) {
        const pattern = weatherPattern(seed, { id, startDay: 1 + (cycle * 4 + index) * 25 }, recent);
        expect(pattern).toHaveLength(25);
        for (const weather of WEATHER) expect(pattern.filter((w) => w === weather)).toHaveLength(WEATHER_DAYS[id][weather]);
        const sequence = [...recent.map((w) => weatherForSeason(w, id)), ...pattern];
        for (let i = 2; i < sequence.length; i++) expect(sequence[i] === sequence[i - 1] && sequence[i] === sequence[i - 2]).toBe(false);
        recent = pattern.slice(-2);
        if (!cycle && id === 'spring') starts.add(pattern.join(','));
      }
    }
    expect(starts.size).toBeGreaterThan(390);
  });

  it('is deterministic without consuming gameplay RNG or changing the map', () => {
    const sim = quietSim();
    const rng = sim.state.rng;
    const terrain = sim.terrain;
    const pattern = [...sim.state.weather!.pattern];
    expect(weatherPattern(sim.state.seed, sim.state.season!)).toEqual(pattern);
    for (const id of WEATHER) sim.devSetWeather(id);
    sim.devResetWeather();
    expect(sim.state.rng).toBe(rng);
    expect(sim.terrain).toBe(terrain);
    expect(sim.state.weather!.pattern).toEqual(pattern);
  });

  it('keeps one state through daylight, midnight and overnight, then selects tomorrow at 6 AM', () => {
    const sim = quietSim();
    sim.devSetWeather('rainy');
    sim.state.spawnCheckAt = Infinity;
    sim.timeScale = 60;
    for (const hour of [6, 12, 18, 23.999, 0, 2, 5.9]) {
      sim.devSetHour(hour);
      sim.step(0.01, IDLE_INPUT);
      expect(sim.weather).toBe('rainy');
      expect(sim.state.weather!.day).toBe(1);
    }
    const tomorrow = sim.state.weather!.pattern[1];
    sim.devNextMorning();
    sim.step(0.1, IDLE_INPUT);
    expect(sim.day).toBe(2);
    expect(sim.weather).toBe(tomorrow);
    expect(sim.state.weather!.day).toBe(2);
    expect(drain(sim)).toContainEqual({ type: 'dayStart', day: 2 });
  });

  it('advances the full seasonal weather calendar through ordinary sleep and forced sleep', () => {
    const sim = quietSim();
    const fire = placeStructure(sim, 'campfire');
    const weather: Weather[] = [];
    for (let day = 1; day <= 100; day++) {
      expect(sim.state.weather!.day).toBe(day);
      expect(sim.state.weather!.season).toBe(sim.season);
      expect(sim.weather).toBe(sim.state.weather!.pattern[(day - 1) % 25]);
      weather.push(sim.weather!);
      keepAlive(sim);
      sim.devSetHour(21);
      expect(sim.trySleep(fire.id)).toBe(true);
      drain(sim);
    }
    for (let i = 2; i < weather.length; i++) {
      const normalize = (id: Weather) => id === 'snowy' ? 'rainy' : id;
      expect(normalize(weather[i]) === normalize(weather[i - 1]) && normalize(weather[i]) === normalize(weather[i - 2])).toBe(false);
    }
    sim.devSetSeason('fall');
    sim.state.totalHours = (sim.state.season!.startDay + 24) * 24 - 4.001;
    sim.timeScale = 240;
    keepAlive(sim);
    sim.step(0.1, IDLE_INPUT);
    expect(sim.season).toBe('winter');
    expect(sim.state.weather!.season).toBe('winter');
    expect(sim.state.weather!.day).toBe(sim.day);
    expect(sim.weather).not.toBe('rainy');
  });

  it('persists today, developer overrides and future days through saves, retrying and late joining', () => {
    const run = new RunManager(new MemoryStorage(), () => 42);
    const sim = run.newRun();
    sim.devSetWeather('foggy');
    run.writeSnapshot(sim);
    run.save(sim);
    const loaded = run.loadCurrent()!;
    const retried = run.retryDay();
    const snapshot = takeSnapshot(sim);
    const guest = new Simulation(stateFromSnapshot(snapshot));
    for (const copy of [loaded, retried, guest]) {
      expect(copy.state.weather).toEqual(sim.state.weather);
      copy.skipNight([]);
      expect(copy.weather).toBe(sim.state.weather!.pattern[1]);
    }
    snapshot.weather!.pattern[0] = 'rainy';
    expect(sim.state.weather!.pattern).not.toEqual(snapshot.weather!.pattern);
  });

  it('migrates absent, stale and malformed weather without resetting the landscape or clock', () => {
    const sim = quietSim();
    sim.state.totalHours = 24 * 10 + 5;
    sim.state.trees[0].hp = 1;
    const raw = JSON.parse(serializeState(sim.state));
    for (const weather of [undefined, null, 'rainy', 42, {}, { id: 'snowy', day: 11, season: 'spring', startDay: 1, pattern: Array(25).fill('snowy') }]) {
      raw.weather = weather;
      const loaded = deserializeState(JSON.stringify(raw))!;
      expect(loaded.weather!.day).toBe(11);
      expect(loaded.weather!.id).toBe(loaded.weather!.pattern[10]);
      expect(loaded.totalHours).toBe(sim.state.totalHours);
      expect(loaded.trees[0].hp).toBe(1);
    }
    const winter: SeasonState = { id: 'winter', startDay: 11 };
    expect(parseWeather(sim.state.weather, sim.state.seed, sim.state.totalHours, winter).id).not.toBe('rainy');
  });

  it('keeps guests on host weather while predicting across dawn, then snaps a tiny day correction', () => {
    const host = quietSim();
    host.devSetWeather('rainy');
    const guest = new Simulation(stateFromSnapshot(takeSnapshot(host)));
    guest.authority = 'guest';
    expect(guest.devSetWeather('sunny')).toBe(false);
    expect(guest.devResetWeather()).toBe(false);
    guest.state.totalHours = 23.999;
    guest.timeScale = 240;
    guest.step(0.1, IDLE_INPUT);
    expect(guest.weather).toBe('rainy');
    guest.state.totalHours = 23.999;
    guest.followClock(24.001, 1);
    expect(guest.day).toBe(2);
    host.skipNight([]);
    guest.followSeason(host.state.season);
    guest.followWeather(host.state.weather);
    expect(guest.state.weather).toEqual(host.state.weather);
  });

  it.each(['desert', 'island'] as const)('keeps %s free of weather, including forged save/snapshot fields', (biome) => {
    const sim = Simulation.newGame(42, biome);
    const weather = quietSim().state.weather!;
    const raw = JSON.parse(serializeState(sim.state));
    raw.weather = weather;
    expect(deserializeState(JSON.stringify(raw))!.weather).toBeUndefined();
    const snap = takeSnapshot(sim);
    expect(snap.weather).toBeUndefined();
    snap.weather = weather;
    expect(stateFromSnapshot(snap).weather).toBeUndefined();
    sim.followWeather(weather);
    expect(sim.devSetWeather('rainy')).toBe(false);
    expect(sim.weather).toBeNull();
    expect(sim.state.weather).toBeUndefined();
  });
});
