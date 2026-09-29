/** Pure volume math shared by the audio system, settings persistence and tests. */

export const DEFAULT_MASTER_VOLUME = 0.5;
/** Master gain at 100% volume, leaving a little headroom for stacked effects. */
export const MASTER_HEADROOM = 0.9;
/** Background music level relative to the master bus. */
export const MUSIC_LEVEL = 0.45;
export const MUSIC_FADE_SECONDS = 6;
export const MUSIC_URL = `${import.meta.env.BASE_URL}audio/forest-ambience.mp3`;

/** A volume in [0, 1]; anything that isn't a finite number becomes `fallback`. */
export function clampVolume(v: unknown, fallback = DEFAULT_MASTER_VOLUME): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

/** Gain for the master bus, which every sound (effects, ambience and music) passes through. */
export function masterGain(volume: number, muted: boolean): number {
  return muted ? 0 : clampVolume(volume) * MASTER_HEADROOM;
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
