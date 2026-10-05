import { describe, expect, it } from 'vitest';
import { GuestSession } from '../src/net/guest';
import { HostSession } from '../src/net/host';
import { LobbyWatcher, type ServerInfo } from '../src/net/lobby';
import { LocalTransport, MemoryHub } from '../src/net/transport';
import { stateFromSnapshot, takeSnapshot } from '../src/net/worldSync';
import type { SimEvent } from '../src/sim/events';
import { MemoryStorage, RunManager, STORAGE_KEYS, storageKeys } from '../src/sim/run';
import { serializeState } from '../src/sim/save';
import { IDLE_INPUT, Simulation } from '../src/sim/simulation';
import { keepAlive } from './helpers';

function seeds(...list: number[]) {
  let i = 0;
  return () => list[i++ % list.length];
}

function play(rm: RunManager, sim: Simulation, seconds: number, dt = 0.1) {
  const buf: SimEvent[] = [];
  let death = null;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    sim.step(dt, { ...IDLE_INPUT, yaw: sim.state.player.yaw });
    sim.takeEvents(buf);
    death = rm.handleEvents(sim, buf) ?? death;
  }
  return death;
}

function die(rm: RunManager, sim: Simulation) {
  sim.devDamage(1000);
  return play(rm, sim, 0.2);
}

/** Storage as a build from before maps existed left it: a meta without map fields and a PNW run. */
function legacyStorage(): { storage: MemoryStorage; save: string } {
  const storage = new MemoryStorage();
  const sim = Simulation.newGame(1111);
  sim.state.totalHours += 30;
  // Old saves predate daily weather; migration adds it without changing the original run.
  delete sim.state.weather;
  const save = serializeState(sim.state);
  storage.setItem(STORAGE_KEYS.meta, JSON.stringify({ version: 1, worldSeed: 1111, best: { hours: 40, day: 2 }, deaths: 3, settings: { muted: true } }));
  storage.setItem(STORAGE_KEYS.save, save);
  storage.setItem(STORAGE_KEYS.snapshot, save);
  return { storage, save };
}

describe('per-map saves', () => {
  it('an old save is the Pacific Northwest save and loads unchanged', () => {
    const { storage, save } = legacyStorage();
    expect('biome' in JSON.parse(save)).toBe(false);
    const rm = new RunManager(storage, seeds(9));
    expect(rm.biome).toBe('pnw');
    expect(rm.record).toMatchObject({ worldSeed: 1111, best: { hours: 40, day: 2 }, deaths: 3 });
    expect(rm.meta.settings.muted).toBe(true);
    const sim = rm.loadCurrent()!;
    expect(sim.biome).toBe('pnw');
    expect(sim.state.seed).toBe(1111);
    const loaded = JSON.parse(serializeState(sim.state));
    expect(loaded.weather).toMatchObject({ day: 2, season: 'spring' });
    delete loaded.weather;
    expect(loaded).toEqual(JSON.parse(save));
    expect(rm.hasContinue('pnw')).toBe(true);
    expect(rm.hasContinue('desert')).toBe(false);
    expect(storageKeys('pnw')).toEqual({ save: STORAGE_KEYS.save, snapshot: STORAGE_KEYS.snapshot });
  });

  it('starting the desert leaves the Pacific Northwest run, records and seed untouched', () => {
    const { storage, save } = legacyStorage();
    const rm = new RunManager(storage, seeds(2222, 3333));
    rm.selectBiome('desert');
    const desert = rm.newRun();
    expect(desert.biome).toBe('desert');
    expect(desert.state.seed).toBe(2222);
    expect(storage.getItem(storageKeys('desert').save)).toBeTruthy();
    expect(storageKeys('desert').save).toBe(`${STORAGE_KEYS.save}.desert`);
    expect(storage.getItem(STORAGE_KEYS.save)).toBe(save);
    expect(rm.recordFor('pnw')).toMatchObject({ worldSeed: 1111, deaths: 3 });
  });

  it('quit the desert, and both maps can be continued (the last map picked is remembered)', () => {
    const { storage } = legacyStorage();
    const rm = new RunManager(storage, seeds(2222));
    rm.selectBiome('desert');
    const desert = rm.newRun();
    keepAlive(desert);
    play(rm, desert, 2);
    rm.save(desert);
    const hours = desert.state.totalHours;

    const again = new RunManager(storage, seeds(4444));
    expect(again.biome).toBe('desert');
    expect(again.hasContinue('desert')).toBe(true);
    expect(again.hasContinue('pnw')).toBe(true);
    const d = again.loadCurrent()!;
    expect(d.biome).toBe('desert');
    expect(d.state.totalHours).toBeCloseTo(hours, 6);
    again.selectBiome('pnw');
    const p = again.loadCurrent()!;
    expect(p.biome).toBe('pnw');
    expect(p.state.seed).toBe(1111);
    expect(new RunManager(storage).biome).toBe('pnw');
  });

  it('records are kept per map', () => {
    const { storage } = legacyStorage();
    const rm = new RunManager(storage, seeds(2222));
    rm.selectBiome('desert');
    const sim = rm.newRun();
    const death = die(rm, sim);
    expect(death).toMatchObject({ newBest: true });
    expect(rm.recordFor('desert').deaths).toBe(1);
    expect(rm.recordFor('desert').best).not.toBeNull();
    expect(rm.recordFor('pnw')).toMatchObject({ deaths: 3, best: { hours: 40, day: 2 } });
    expect(new RunManager(storage).recordFor('desert').deaths).toBe(1);
    expect(rm.hasContinue('desert')).toBe(false);
    expect(rm.hasContinue('pnw')).toBe(true);
  });

  it('New world on the desert wipes only the desert', () => {
    const { storage, save } = legacyStorage();
    const rm = new RunManager(storage, seeds(2222, 5555));
    rm.selectBiome('desert');
    die(rm, rm.newRun());
    const fresh = rm.startFromScratch();
    expect(fresh.biome).toBe('desert');
    expect(fresh.state.seed).toBe(5555);
    expect(rm.recordFor('desert')).toMatchObject({ worldSeed: 5555, deaths: 0, best: null });
    expect(storage.getItem(STORAGE_KEYS.save)).toBe(save);
    expect(rm.recordFor('pnw')).toMatchObject({ worldSeed: 1111, deaths: 3 });
  });

  it('Retry the day on the desert restores the desert morning, not the woods', () => {
    const { storage } = legacyStorage();
    const rm = new RunManager(storage, seeds(2222));
    rm.selectBiome('desert');
    const sim = rm.newRun();
    const t0 = sim.state.totalHours;
    keepAlive(sim);
    play(rm, sim, 3);
    die(rm, sim);
    const retry = rm.retryDay();
    expect(retry.biome).toBe('desert');
    expect(retry.state.seed).toBe(2222);
    expect(retry.state.totalHours).toBeCloseTo(t0, 6);
    expect(retry.state.dead).toBe(false);
  });

  it('a slot holding another map\'s run counts as empty', () => {
    const storage = new MemoryStorage();
    const rm = new RunManager(storage, seeds(7));
    storage.setItem(STORAGE_KEYS.save, serializeState(Simulation.newGame(8, 'desert').state));
    expect(rm.hasContinue('pnw')).toBe(false);
    expect(rm.loadCurrent('pnw')).toBeNull();
  });
});

describe('multiplayer carries the map', () => {
  async function host(sim: Simulation) {
    const hub = new MemoryHub(true);
    const h = new HostSession(new LocalTransport(hub.bus()), sim, { name: 'Anna', avatar: 'f' }, "Anna's camp", 'camp1');
    await h.start();
    hub.flush();
    return { hub, h };
  }

  it('a desert server is listed as the desert, and a guest joins the host\'s desert', async () => {
    const sim = Simulation.newGame(4242, 'desert');
    sim.state.animals.length = 0;
    const { hub, h } = await host(sim);
    const lists: ServerInfo[][] = [];
    const watcher = new LobbyWatcher(new LocalTransport(hub.bus()), (l) => lists.push(l));
    await watcher.start();
    hub.flush();
    expect(lists.at(-1)?.[0]).toMatchObject({ sid: 'camp1', map: 'desert' });

    const g = new GuestSession(new LocalTransport(hub.bus()), { name: 'Ben', avatar: 'm' }, 'camp1');
    await g.start();
    for (let i = 0; i < 40; i++) {
      hub.flush();
      h.update(0.05);
      g.update(0.05);
    }
    hub.flush();
    expect(g.joined).toBe(true);
    expect(g.sim!.biome).toBe('desert');
    expect(g.sim!.state.seed).toBe(4242);
    expect(g.sim!.terrain.lakes.map((l) => l.kind)).toEqual(sim.terrain.lakes.map((l) => l.kind));
    watcher.close();
  });

  it('a Pacific Northwest server is listed as such and its snapshot carries no map field', async () => {
    const sim = Simulation.newGame(4243);
    const { hub } = await host(sim);
    const lists: ServerInfo[][] = [];
    const watcher = new LobbyWatcher(new LocalTransport(hub.bus()), (l) => lists.push(l));
    await watcher.start();
    hub.flush();
    expect(lists.at(-1)?.[0].map).toBe('pnw');
    const snap = takeSnapshot(sim);
    expect('b' in snap).toBe(false);
    expect(stateFromSnapshot(snap).biome ?? 'pnw').toBe('pnw');
    const desertSnap = takeSnapshot(Simulation.newGame(5, 'desert'));
    expect(desertSnap.b).toBe('desert');
    expect(stateFromSnapshot(desertSnap).biome).toBe('desert');
    watcher.close();
  });
});
