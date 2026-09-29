import { describe, expect, it } from 'vitest';
import { countItem } from '../src/sim/inventory';
import { MemoryStorage, RunManager, STORAGE_KEYS } from '../src/sim/run';
import type { Simulation } from '../src/sim/simulation';
import { deserializeState } from '../src/sim/save';
import { give, run } from './helpers';

function seeds(...list: number[]) {
  let i = 0;
  return () => list[i++ % list.length];
}

/** Step with the run manager listening, like the game loop does. */
function play(rm: RunManager, sim: Simulation, seconds: number, dt = 0.1) {
  const buf: import('../src/sim/events').SimEvent[] = [];
  let death = null;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    sim.step(dt, { moveX: 0, moveZ: 0, jumpPressed: false, sprint: false, yaw: sim.state.player.yaw, pitch: 0, primary: false, primaryPressed: false, primaryReleased: false });
    sim.takeEvents(buf);
    death = rm.handleEvents(sim, buf) ?? death;
  }
  return death;
}

function keepAlive(sim: Simulation) {
  Object.assign(sim.state.needs, { hunger: 100, thirst: 100, warmth: 100, health: 100 });
}

/** Fast-forward to the next dawn while keeping the player alive. */
function toNextDay(rm: RunManager, sim: Simulation) {
  const target = sim.day + 1;
  sim.timeScale = 600;
  while (sim.day < target) {
    keepAlive(sim);
    play(rm, sim, 0.5);
  }
  sim.timeScale = 1;
}

describe('run manager', () => {
  it('a new run writes an autosave and a day-1 snapshot', () => {
    const store = new MemoryStorage();
    const rm = new RunManager(store, seeds(111));
    const sim = rm.newRun();
    expect(sim.state.seed).toBe(111);
    expect(store.getItem(STORAGE_KEYS.save)).not.toBeNull();
    expect(rm.snapshotDay()).toBe(1);
    expect(rm.hasContinue()).toBe(true);
  });

  it('snapshots the state at the start of every new day', () => {
    const rm = new RunManager(new MemoryStorage(), seeds(5));
    const sim = rm.newRun();
    toNextDay(rm, sim);
    expect(sim.day).toBe(2);
    expect(rm.snapshotDay()).toBe(2);
    toNextDay(rm, sim);
    expect(rm.snapshotDay()).toBe(3);
  });

  it('death ends the run, records the best, and is remembered across reloads', () => {
    const store = new MemoryStorage();
    const rm = new RunManager(store, seeds(5));
    const sim = rm.newRun();
    toNextDay(rm, sim);
    sim.devDamage(1000);
    const buf = sim.takeEvents([]);
    const death = rm.handleEvents(sim, buf)!;
    expect(death).not.toBeNull();
    expect(death.cause).toBe('dev');
    expect(death.day).toBe(2);
    expect(death.newBest).toBe(true);
    expect(rm.meta.best!.day).toBe(2);
    expect(rm.hasContinue()).toBe(false);
    // a reloaded page sees the dead run (death screen), not a resumable one
    const rm2 = new RunManager(store);
    expect(rm2.loadCurrent()!.state.dead).toBe(true);
    expect(rm2.meta.best!.day).toBe(2);
    // the sim is frozen once dead
    const hours = sim.state.totalHours;
    run(sim, 1);
    expect(sim.state.totalHours).toBe(hours);
  });

  it('dying from needs (not just predators) ends the run', () => {
    const rm = new RunManager(new MemoryStorage(), seeds(5));
    const sim = rm.newRun();
    sim.state.animals.length = 0;
    sim.state.needs.thirst = 0;
    sim.state.needs.health = 5;
    sim.timeScale = 200;
    const death = play(rm, sim, 5);
    expect(death?.cause).toBe('dehydration');
    expect(sim.state.dead).toBe(true);
  });

  it('Restart from day 1: same world, fresh run, best record kept', () => {
    const store = new MemoryStorage();
    const rm = new RunManager(store, seeds(5, 6));
    const sim = rm.newRun();
    give(sim, { stick: 5 });
    toNextDay(rm, sim);
    sim.devDamage(1000);
    rm.handleEvents(sim, sim.takeEvents([]));
    const best = rm.meta.best;

    const next = rm.restartFromDay1();
    expect(next.state.seed).toBe(5);
    expect(next.state.runId).not.toBe(sim.state.runId);
    expect(next.day).toBe(1);
    expect(next.state.dead).toBe(false);
    expect(countItem(next.state.inventory, 'stick')).toBe(0);
    expect(rm.meta.best).toEqual(best);
    expect(rm.snapshotDay()).toBe(1);
    expect(rm.hasContinue()).toBe(true);
  });

  it('a worse later run does not overwrite the best record', () => {
    const rm = new RunManager(new MemoryStorage(), seeds(5));
    const sim = rm.newRun();
    toNextDay(rm, sim);
    sim.devDamage(1000);
    rm.handleEvents(sim, sim.takeEvents([]));
    const best = rm.meta.best!;
    const again = rm.restartFromDay1();
    again.devDamage(1000);
    const d = rm.handleEvents(again, again.takeEvents([]))!;
    expect(d.newBest).toBe(false);
    expect(rm.meta.best).toEqual(best);
    expect(rm.meta.deaths).toBe(2);
  });

  it('Start from scratch: wipes saves and records, new world, preferences kept', () => {
    const store = new MemoryStorage();
    const rm = new RunManager(store, seeds(5, 77));
    rm.meta.settings.muted = true;
    rm.saveMeta();
    const sim = rm.newRun();
    sim.devDamage(1000);
    rm.handleEvents(sim, sim.takeEvents([]));
    expect(rm.meta.best).not.toBeNull();

    const fresh = rm.startFromScratch();
    expect(fresh.state.seed).toBe(77);
    expect(rm.meta.worldSeed).toBe(77);
    expect(rm.meta.best).toBeNull();
    expect(rm.meta.deaths).toBe(0);
    expect(rm.meta.settings.muted).toBe(true);
    expect(fresh.day).toBe(1);
    expect(rm.snapshotDay()).toBe(1);
    const reloaded = new RunManager(store);
    expect(reloaded.meta.best).toBeNull();
    expect(reloaded.loadCurrent()!.state.seed).toBe(77);
  });

  it('start from scratch always picks a different world', () => {
    const rm = new RunManager(new MemoryStorage(), seeds(5));
    rm.newRun();
    const fresh = rm.startFromScratch();
    expect(fresh.state.seed).not.toBe(5);
  });

  it('Retry the day: restores the start-of-day snapshot and continues the same run', () => {
    const store = new MemoryStorage();
    const rm = new RunManager(store, seeds(5));
    const sim = rm.newRun();
    sim.state.animals.length = 0;
    give(sim, { stick: 3 });
    toNextDay(rm, sim);
    expect(sim.day).toBe(2);
    const snap = deserializeState(store.getItem(STORAGE_KEYS.snapshot))!;
    // later that day: gather more, then die
    give(sim, { stone: 4 });
    keepAlive(sim);
    play(rm, sim, 30);
    sim.devDamage(1000);
    rm.handleEvents(sim, sim.takeEvents([]));
    expect(sim.state.dead).toBe(true);

    const retry = rm.retryDay();
    expect(retry.state.dead).toBe(false);
    expect(retry.state.deathCause).toBeNull();
    expect(retry.state.runId).toBe(sim.state.runId);
    expect(retry.day).toBe(2);
    expect(retry.state.totalHours).toBeCloseTo(snap.totalHours, 6);
    expect(countItem(retry.state.inventory, 'stick')).toBe(3);
    expect(countItem(retry.state.inventory, 'stone')).toBe(0);
    expect(rm.meta.best!.day).toBe(2);
    expect(rm.hasContinue()).toBe(true);
    // the retried run keeps playing and can die again
    play(rm, retry, 1);
    expect(retry.state.totalHours).toBeGreaterThan(snap.totalHours);
  });

  it('Retry the day on day 1 goes back to the very start of the run', () => {
    const rm = new RunManager(new MemoryStorage(), seeds(5));
    const sim = rm.newRun();
    const start = sim.state.totalHours;
    play(rm, sim, 5);
    sim.devDamage(1000);
    rm.handleEvents(sim, sim.takeEvents([]));
    const retry = rm.retryDay();
    expect(retry.state.totalHours).toBe(start);
    expect(retry.state.runId).toBe(sim.state.runId);
  });

  it('dying on the tick a new day begins keeps the previous morning, so Retry the day revives you', () => {
    const store = new MemoryStorage();
    const rm = new RunManager(store, seeds(5));
    const sim = rm.newRun();
    sim.state.animals.length = 0;
    sim.state.totalHours = 24 - 1e-4;
    Object.assign(sim.state.needs, { thirst: 0, health: 1e-4 });
    sim.step(0.1, { moveX: 0, moveZ: 0, jumpPressed: false, sprint: false, yaw: 0, pitch: 0, primary: false, primaryPressed: false, primaryReleased: false });
    const events = sim.takeEvents([]);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['dayStart', 'death']));
    expect(rm.handleEvents(sim, events)?.cause).toBe('dehydration');
    expect(rm.snapshotDay()).toBe(1);
    expect(deserializeState(store.getItem(STORAGE_KEYS.snapshot))!.dead).toBe(false);

    const retry = rm.retryDay();
    expect(retry.day).toBe(1);
    expect(retry.state.needs.health).toBeGreaterThan(50);
    expect(play(rm, retry, 5)).toBeNull();
    expect(retry.state.dead).toBe(false);
  });

  it('Retry the day falls back to a fresh day-1 run if the snapshot is missing or corrupt', () => {
    const store = new MemoryStorage();
    const rm = new RunManager(store, seeds(5));
    const sim = rm.newRun();
    sim.devDamage(1000);
    rm.handleEvents(sim, sim.takeEvents([]));
    store.setItem(STORAGE_KEYS.snapshot, '{broken');
    const retry = rm.retryDay();
    expect(retry.day).toBe(1);
    expect(retry.state.dead).toBe(false);
    expect(retry.state.runId).not.toBe(sim.state.runId);
  });

  it('sleeping through the night snapshots the new morning', () => {
    const rm = new RunManager(new MemoryStorage(), seeds(5));
    const sim = rm.newRun();
    sim.state.animals.length = 0;
    sim.state.structures.push({ id: 900, prefab: 'leanTo', x: 50, y: 0, z: 50, rot: 0, fuel: 0 });
    sim.devSetHour(21);
    expect(sim.trySleep(900)).toBe(true);
    rm.handleEvents(sim, sim.takeEvents([]));
    expect(rm.snapshotDay()).toBe(2);
    expect(sim.hour).toBeCloseTo(6);
  });

  it('survives corrupt meta storage', () => {
    const store = new MemoryStorage();
    store.setItem(STORAGE_KEYS.meta, '{{{');
    const rm = new RunManager(store, seeds(9));
    expect(rm.meta.worldSeed).toBe(9);
    expect(rm.loadOrNew().state.seed).toBe(9);
  });
});
