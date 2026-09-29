/** Pure volume math shared by the audio system, settings persistence and tests. */

export const DEFAULT_MASTER_VOLUME = 0.5;
/** Music (background track only) starts quiet so it sits well under the forest. */
export const DEFAULT_MUSIC_VOLUME = 0.1;
/** Effects and ambience: everything except the music. 100% is the level they had before music got its own slider. */
export const DEFAULT_SFX_VOLUME = 1;
/** Master gain at 100% volume, leaving a little headroom for stacked effects. */
export const MASTER_HEADROOM = 0.9;
/** Background music level at 100% music volume, relative to the master bus. */
export const MUSIC_LEVEL = 0.45;
export const MUSIC_FADE_SECONDS = 6;
export const MUSIC_URL = `${import.meta.env.BASE_URL}audio/forest-ambience.mp3`;
export const LAKE_URL = `${import.meta.env.BASE_URL}audio/lake-water-moving.mp3`;
/** Lake ambience gain on the effects bus at the water's edge; it should stay a soft bed under the forest. */
export const LAKE_EDGE_LEVEL = 0.5;
/** Metres from the shore at which the lake fades to silence. */
export const LAKE_HEAR_DIST = 36;

/** A volume in [0, 1]; anything that isn't a finite number becomes `fallback`. */
export function clampVolume(v: unknown, fallback = DEFAULT_MASTER_VOLUME): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

/** Gain for the master bus, which every sound (effects, ambience and music) passes through. */
export function masterGain(volume: number, muted: boolean): number {
  return muted ? 0 : clampVolume(volume) * MASTER_HEADROOM;
}

export interface VolumeSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
}

/** Gains for the three buses: master (everything), music (background track only), sfx (effects and ambience). */
export function busGains(s: VolumeSettings): { master: number; music: number; sfx: number } {
  return {
    master: masterGain(s.masterVolume, s.muted),
    music: clampVolume(s.musicVolume, DEFAULT_MUSIC_VOLUME),
    sfx: clampVolume(s.sfxVolume, DEFAULT_SFX_VOLUME),
  };
}

/** Music level `elapsed` seconds into its fade-in (smoothstep from silence to MUSIC_LEVEL). */
export function musicFadeLevel(elapsed: number, fadeSeconds = MUSIC_FADE_SECONDS): number {
  if (fadeSeconds <= 0) return MUSIC_LEVEL;
  const k = Math.min(1, Math.max(0, elapsed / fadeSeconds));
  return MUSIC_LEVEL * k * k * (3 - 2 * k);
}

export function volumePercent(v: number): string {
  return `${Math.round(clampVolume(v) * 100)}%`;
}

/** Lake ambience level `waterDist` metres from the nearest shore (0 in or at the water): an ease-in fade out to LAKE_HEAR_DIST. */
export function lakeAmbienceLevel(waterDist: number): number {
  if (Number.isNaN(waterDist)) return 0;
  const k = 1 - Math.min(1, Math.max(0, waterDist) / LAKE_HEAR_DIST);
  return LAKE_EDGE_LEVEL * k * k;
}
