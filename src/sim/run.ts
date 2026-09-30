import { clampVolume, DEFAULT_MASTER_VOLUME, DEFAULT_MUSIC_VOLUME, DEFAULT_SFX_VOLUME } from '../audio/mix';
import { randomSeed } from '../core/rng';
import { BIOME_IDS, BIOMES, DEFAULT_BIOME, isBiomeId, type BiomeId } from '../data/biomes';
import type { SimEvent } from './events';
import { deserializeState, serializeState } from './save';
import { Simulation } from './simulation';
import type { GameState } from './state';
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

/** The Pacific Northwest save keys (unchanged since before maps existed); other maps add their suffix. */
export const STORAGE_KEYS = {
  save: 'cozysurvival.v1.save',
  snapshot: 'cozysurvival.v1.daySnapshot',
  meta: 'cozysurvival.v1.meta',
} as const;

/** Where a map keeps its autosave and start-of-day snapshot. The meta (settings and records) is shared. */
export function storageKeys(biome: BiomeId): { save: string; snapshot: string } {
  const sfx = BIOMES[biome].storageSuffix;
  return { save: STORAGE_KEYS.save + sfx, snapshot: STORAGE_KEYS.snapshot + sfx };
}

export interface Settings {
  muted: boolean;
  /** Scales all game audio (effects, ambience and music), 0..1. */
  masterVolume: number;
  /** Background music only, 0..1 (on top of master). */
  musicVolume: number;
  /** Effects and ambience, everything but the music, 0..1 (on top of master). */
  sfxVolume: number;
  sensitivity: number;
  invertY: boolean;
}

export interface BestRecord {
  hours: number;
  day: number;
}

/** One map's world and records. */
export interface MapRecord {
  worldSeed: number;
  best: BestRecord | null;
  deaths: number;
}

/**
 * The top-level record is the Pacific Northwest's (as it always was); other maps keep theirs in `maps`.
 * `map` is the map last picked on the title screen.
 */
export interface MetaState extends MapRecord {
  version: 1;
  settings: Settings;
  map?: BiomeId;
  maps?: Partial<Record<BiomeId, MapRecord>>;
}

function parseRecord(v: unknown): MapRecord | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Partial<MapRecord>;
  if (typeof r.worldSeed !== 'number') return null;
  return { worldSeed: r.worldSeed, best: r.best ?? null, deaths: typeof r.deaths === 'number' ? r.deaths : 0 };
}

export interface DeathSummary {
  cause: string;
  hours: number;
  day: number;
  best: BestRecord | null;
  newBest: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  muted: false,
  masterVolume: DEFAULT_MASTER_VOLUME,
  musicVolume: DEFAULT_MUSIC_VOLUME,
  sfxVolume: DEFAULT_SFX_VOLUME,
  sensitivity: 1,
  invertY: false,
};

/**
 * Settings read back from storage, with anything missing or malformed replaced by its default.
 * The old `volume` field (default 80%, before music) is deliberately dropped so everyone starts at the new 50% default.
 * Settings saved before music had its own slider keep their master volume and pick up music at 10% and effects at 100%
 * (effects sound exactly as loud as before).
 */
export function normalizeSettings(raw: unknown): Settings {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    muted: typeof s.muted === 'boolean' ? s.muted : d.muted,
    masterVolume: clampVolume(s.masterVolume, d.masterVolume),
    musicVolume: clampVolume(s.musicVolume, d.musicVolume),
    sfxVolume: clampVolume(s.sfxVolume, d.sfxVolume),
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
  /** The map picked on the title screen; new runs, Continue and the death-screen options act on it. */
  biome: BiomeId;
  private readonly storage: KVStorage;
  private readonly seedSource: () => number;

  constructor(storage: KVStorage, seedSource: () => number = randomSeed) {
    this.storage = storage;
    this.seedSource = seedSource;
    this.meta = this.loadMeta();
    this.biome = this.meta.map ?? DEFAULT_BIOME;
  }

  private loadMeta(): MetaState {
    try {
      const raw = this.storage.getItem(STORAGE_KEYS.meta);
      if (raw) {
        const m = JSON.parse(raw) as Partial<MetaState>;
        if (m && m.version === 1 && typeof m.worldSeed === 'number') {
          const meta: MetaState = {
            version: 1,
            worldSeed: m.worldSeed,
            best: m.best ?? null,
            deaths: m.deaths ?? 0,
            settings: normalizeSettings(m.settings),
          };
          if (isBiomeId(m.map)) meta.map = m.map;
          if (m.maps && typeof m.maps === 'object') {
            for (const id of BIOME_IDS) {
              const rec = id === DEFAULT_BIOME ? null : parseRecord(m.maps[id]);
              if (rec) (meta.maps ??= {})[id] = rec;
            }
          }
          return meta;
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

  /** Pick the map for the title screen, Continue and new runs (remembered for next time). */
  selectBiome(biome: BiomeId): void {
    if (this.biome === biome && this.meta.map === biome) return;
    this.biome = biome;
    this.meta.map = biome;
    this.saveMeta();
  }

  /** The selected map's world seed and records. */
  get record(): MapRecord {
    return this.recordFor(this.biome);
  }

  /** A map's world seed and records; a map played for the first time gets its own world. */
  recordFor(biome: BiomeId): MapRecord {
    if (biome === DEFAULT_BIOME) return this.meta;
    const maps = (this.meta.maps ??= {});
    let rec = maps[biome];
    if (!rec) {
      rec = { worldSeed: this.seedSource(), best: null, deaths: 0 };
      maps[biome] = rec;
      this.saveMeta();
    }
    return rec;
  }

  /** A saved run of `biome` from its own slot (a slot holding another map's run counts as empty). */
  private loadState(biome: BiomeId, which: 'save' | 'snapshot'): GameState | null {
    const s = deserializeState(this.storage.getItem(storageKeys(biome)[which]));
    return s && (s.biome ?? DEFAULT_BIOME) === biome ? s : null;
  }

  /** A resumable (living) run exists on the map. */
  hasContinue(biome: BiomeId = this.biome): boolean {
    const s = this.loadState(biome, 'save');
    return !!s && !s.dead;
  }

  loadCurrent(biome: BiomeId = this.biome): Simulation | null {
    const s = this.loadState(biome, 'save');
    return s ? new Simulation(s) : null;
  }

  loadOrNew(): Simulation {
    return this.loadCurrent() ?? this.newRun();
  }

  newRun(seed: number = this.record.worldSeed): Simulation {
    const rec = this.record;
    if (seed !== rec.worldSeed) {
      rec.worldSeed = seed;
      this.saveMeta();
    }
    const sim = Simulation.newGame(seed, this.biome);
    this.writeSnapshot(sim);
    this.save(sim);
    return sim;
  }

  save(sim: Simulation): void {
    this.storage.setItem(storageKeys(sim.biome).save, serializeState(sim.state));
  }

  writeSnapshot(sim: Simulation): void {
    sim.state.snapshotDay = sim.day;
    this.storage.setItem(storageKeys(sim.biome).snapshot, serializeState(sim.state));
  }

  snapshotDay(biome: BiomeId = this.biome): number | null {
    const s = this.loadState(biome, 'snapshot');
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
    const rec = this.recordFor(sim.biome);
    const hours = hoursSurvived(sim.state.totalHours);
    const day = sim.day;
    const prev = rec.best;
    const newBest = !prev || hours > prev.hours;
    if (newBest) rec.best = { hours, day };
    rec.deaths++;
    this.saveMeta();
    return { cause: sim.state.deathCause ?? 'unknown', hours, day, best: rec.best, newBest };
  }

  /** New run in the same world; best record kept. */
  restartFromDay1(): Simulation {
    return this.newRun(this.record.worldSeed);
  }

  /**
   * Wipe the selected map's save, snapshot and records, then start it in a brand-new world. Preferences and the
   * other maps are kept.
   */
  startFromScratch(): Simulation {
    const keys = storageKeys(this.biome);
    this.storage.removeItem(keys.save);
    this.storage.removeItem(keys.snapshot);
    let seed = this.seedSource();
    if (seed === this.record.worldSeed) seed = (seed + 1) >>> 0;
    const fresh: MapRecord = { worldSeed: seed, best: null, deaths: 0 };
    if (this.biome === DEFAULT_BIOME) Object.assign(this.meta, fresh);
    else (this.meta.maps ??= {})[this.biome] = fresh;
    this.saveMeta();
    return this.newRun(seed);
  }

  /** Reload the snapshot taken at the start of the current day and continue the same run. */
  retryDay(): Simulation {
    const snap = this.loadState(this.biome, 'snapshot');
    const current = this.loadState(this.biome, 'save');
    if (!snap || (current && current.runId !== snap.runId) || snap.seed !== this.record.worldSeed) {
      return this.restartFromDay1();
    }
    snap.dead = false;
    snap.deathCause = null;
    const sim = new Simulation(snap);
    this.save(sim);
    return sim;
  }
}
