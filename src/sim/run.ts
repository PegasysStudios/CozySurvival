import { clampVolume, DEFAULT_MASTER_VOLUME } from '../audio/mix';
import { randomSeed } from '../core/rng';
import type { SimEvent } from './events';
import { deserializeState, serializeState } from './save';
import { Simulation } from './simulation';
import { hoursSurvived } from './time';

export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements KVStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

/** localStorage with a silent in-memory fallback (private mode, quota errors). */
export function browserStorage(): KVStorage {
  const mem = new MemoryStorage();
  try {
    const ls = window.localStorage;
    const probe = '__cozy_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      getItem: (k) => {
        try {
          return ls.getItem(k);
        } catch {
          return mem.getItem(k);
        }
      },
      setItem: (k, v) => {
        try {
          ls.setItem(k, v);
        } catch {
          mem.setItem(k, v);
        }
      },
      removeItem: (k) => {
        try {
          ls.removeItem(k);
        } catch {
          mem.removeItem(k);
        }
      },
    };
  } catch {
    return mem;
  }
}

export const STORAGE_KEYS = {
  save: 'cozysurvival.v1.save',
  snapshot: 'cozysurvival.v1.daySnapshot',
  meta: 'cozysurvival.v1.meta',
} as const;

export interface Settings {
  muted: boolean;
  /** Scales all game audio (effects, ambience and music), 0..1. */
  masterVolume: number;
  sensitivity: number;
  invertY: boolean;
}

export interface BestRecord {
  hours: number;
  day: number;
}

export interface MetaState {
  version: 1;
  worldSeed: number;
  best: BestRecord | null;
  deaths: number;
  settings: Settings;
}

export interface DeathSummary {
  cause: string;
  hours: number;
  day: number;
  best: BestRecord | null;
  newBest: boolean;
}

export const DEFAULT_SETTINGS: Settings = { muted: false, masterVolume: DEFAULT_MASTER_VOLUME, sensitivity: 1, invertY: false };

/**
 * Settings read back from storage, with anything missing or malformed replaced by its default.
 * The old `volume` field (default 80%, before music) is deliberately dropped so everyone starts at the new 50% default.
 */
export function normalizeSettings(raw: unknown): Settings {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    muted: typeof s.muted === 'boolean' ? s.muted : d.muted,
    masterVolume: clampVolume(s.masterVolume, d.masterVolume),
    sensitivity: typeof s.sensitivity === 'number' && Number.isFinite(s.sensitivity) ? s.sensitivity : d.sensitivity,
    invertY: typeof s.invertY === 'boolean' ? s.invertY : d.invertY,
  };
}

/**
 * Owns persistence across runs: autosave, the start-of-day snapshot, best record, and the three
 * death-screen options (restart from day 1, start from scratch, retry the day).
 */
export class RunManager {
  meta: MetaState;
  private readonly storage: KVStorage;
  private readonly seedSource: () => number;

  constructor(storage: KVStorage, seedSource: () => number = randomSeed) {
    this.storage = storage;
    this.seedSource = seedSource;
    this.meta = this.loadMeta();
  }

  private loadMeta(): MetaState {
    try {
      const raw = this.storage.getItem(STORAGE_KEYS.meta);
      if (raw) {
        const m = JSON.parse(raw) as Partial<MetaState>;
        if (m && m.version === 1 && typeof m.worldSeed === 'number') {
          return {
            version: 1,
            worldSeed: m.worldSeed,
            best: m.best ?? null,
            deaths: m.deaths ?? 0,
            settings: normalizeSettings(m.settings),
          };
        }
      }
    } catch {
      // fall through to fresh meta
    }
    const fresh: MetaState = { version: 1, worldSeed: this.seedSource(), best: null, deaths: 0, settings: { ...DEFAULT_SETTINGS } };
    this.storage.setItem(STORAGE_KEYS.meta, JSON.stringify(fresh));
    return fresh;
  }

  saveMeta(): void {
    this.storage.setItem(STORAGE_KEYS.meta, JSON.stringify(this.meta));
  }

  /** A resumable (living) run exists. */
  hasContinue(): boolean {
    const s = deserializeState(this.storage.getItem(STORAGE_KEYS.save));
    return !!s && !s.dead;
  }

  loadCurrent(): Simulation | null {
    const s = deserializeState(this.storage.getItem(STORAGE_KEYS.save));
    return s ? new Simulation(s) : null;
  }

  loadOrNew(): Simulation {
    return this.loadCurrent() ?? this.newRun();
  }

  newRun(seed: number = this.meta.worldSeed): Simulation {
    if (seed !== this.meta.worldSeed) {
      this.meta.worldSeed = seed;
      this.saveMeta();
    }
    const sim = Simulation.newGame(seed);
    this.writeSnapshot(sim);
    this.save(sim);
    return sim;
  }

  save(sim: Simulation): void {
    this.storage.setItem(STORAGE_KEYS.save, serializeState(sim.state));
  }

  writeSnapshot(sim: Simulation): void {
    sim.state.snapshotDay = sim.day;
    this.storage.setItem(STORAGE_KEYS.snapshot, serializeState(sim.state));
  }

  snapshotDay(): number | null {
    const s = deserializeState(this.storage.getItem(STORAGE_KEYS.snapshot));
    return s ? s.snapshotDay : null;
  }

  /** React to simulation events that matter for persistence. Returns a death summary if the run just ended. */
  handleEvents(sim: Simulation, events: readonly SimEvent[]): DeathSummary | null {
    let death: DeathSummary | null = null;
    let dirty = false;
    for (const e of events) {
      if (e.type === 'dayStart') {
        // A run that ends on the tick a new day begins keeps the previous morning, so a retry never restores a corpse.
        if (!sim.state.dead) this.writeSnapshot(sim);
        dirty = true;
      } else if (e.type === 'death') {
        death = this.recordDeath(sim);
        dirty = true;
      } else if (e.type === 'placed' || e.type === 'crafted' || e.type === 'slept') {
        dirty = true;
      }
    }
    if (dirty) this.save(sim);
    return death;
  }

  recordDeath(sim: Simulation): DeathSummary {
    const hours = hoursSurvived(sim.state.totalHours);
    const day = sim.day;
    const prev = this.meta.best;
    const newBest = !prev || hours > prev.hours;
    if (newBest) this.meta.best = { hours, day };
    this.meta.deaths++;
    this.saveMeta();
    return { cause: sim.state.deathCause ?? 'unknown', hours, day, best: this.meta.best, newBest };
  }

  /** New run in the same world; best record kept. */
  restartFromDay1(): Simulation {
    return this.newRun(this.meta.worldSeed);
  }

  /** Wipe every save, snapshot and record, then start a brand-new world. Preferences are kept. */
  startFromScratch(): Simulation {
    const settings = { ...this.meta.settings };
    this.storage.removeItem(STORAGE_KEYS.save);
    this.storage.removeItem(STORAGE_KEYS.snapshot);
    this.storage.removeItem(STORAGE_KEYS.meta);
    let seed = this.seedSource();
    if (seed === this.meta.worldSeed) seed = (seed + 1) >>> 0;
    this.meta = { version: 1, worldSeed: seed, best: null, deaths: 0, settings };
    this.saveMeta();
    return this.newRun(seed);
  }

  /** Reload the snapshot taken at the start of the current day and continue the same run. */
  retryDay(): Simulation {
    const snap = deserializeState(this.storage.getItem(STORAGE_KEYS.snapshot));
    const current = deserializeState(this.storage.getItem(STORAGE_KEYS.save));
    if (!snap || (current && current.runId !== snap.runId) || snap.seed !== this.meta.worldSeed) {
      return this.restartFromDay1();
    }
    snap.dead = false;
    snap.deathCause = null;
    const sim = new Simulation(snap);
    this.save(sim);
    return sim;
  }
}
