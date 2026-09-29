import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  busGains, clampVolume, DEFAULT_MASTER_VOLUME, DEFAULT_MUSIC_VOLUME, DEFAULT_SFX_VOLUME, MASTER_HEADROOM, masterGain, MUSIC_FADE_SECONDS, MUSIC_LEVEL, MUSIC_URL,
  musicFadeLevel, volumePercent,
} from '../src/audio/mix';
import { DEFAULT_SETTINGS, MemoryStorage, normalizeSettings, RunManager, STORAGE_KEYS } from '../src/sim/run';

describe('master volume and mute', () => {
  it('defaults to 50%', () => {
    expect(DEFAULT_MASTER_VOLUME).toBe(0.5);
    expect(DEFAULT_SETTINGS.masterVolume).toBe(0.5);
    expect(DEFAULT_SETTINGS.muted).toBe(false);
  });

  it('scales the master bus linearly with a little headroom at 100%', () => {
    expect(masterGain(1, false)).toBeCloseTo(MASTER_HEADROOM);
    expect(masterGain(0.5, false)).toBeCloseTo(MASTER_HEADROOM / 2);
    expect(masterGain(0, false)).toBe(0);
    expect(masterGain(0.25, false)).toBeLessThan(masterGain(0.75, false));
  });

  it('mute silences everything regardless of volume', () => {
    for (const v of [0, 0.3, 0.5, 1]) expect(masterGain(v, true)).toBe(0);
  });

  it('clamps out-of-range and junk values', () => {
    expect(masterGain(3, false)).toBeCloseTo(MASTER_HEADROOM);
    expect(masterGain(-1, false)).toBe(0);
    expect(masterGain(Number.NaN, false)).toBeCloseTo(DEFAULT_MASTER_VOLUME * MASTER_HEADROOM);
    expect(clampVolume(0.42)).toBe(0.42);
    expect(clampVolume(1.5)).toBe(1);
    expect(clampVolume(-0.2)).toBe(0);
    expect(clampVolume('0.8')).toBe(DEFAULT_MASTER_VOLUME);
    expect(clampVolume(undefined)).toBe(DEFAULT_MASTER_VOLUME);
    expect(clampVolume(Infinity, 0.7)).toBe(0.7);
    expect(clampVolume(null, 0.3)).toBe(0.3);
  });

  it('formats the slider label as a whole percentage', () => {
    expect(volumePercent(0.5)).toBe('50%');
    expect(volumePercent(0.333)).toBe('33%');
    expect(volumePercent(1)).toBe('100%');
    expect(volumePercent(2)).toBe('100%');
  });
});

describe('background music', () => {
  it('fades in smoothly from silence to its mix level', () => {
    expect(musicFadeLevel(0)).toBe(0);
    expect(musicFadeLevel(-3)).toBe(0);
    expect(musicFadeLevel(MUSIC_FADE_SECONDS / 2)).toBeCloseTo(MUSIC_LEVEL / 2);
    expect(musicFadeLevel(MUSIC_FADE_SECONDS)).toBeCloseTo(MUSIC_LEVEL);
    expect(musicFadeLevel(MUSIC_FADE_SECONDS * 10)).toBeCloseTo(MUSIC_LEVEL);
    expect(musicFadeLevel(1, 0)).toBe(MUSIC_LEVEL);
    // gentle: starts slow, never jumps
    expect(musicFadeLevel(MUSIC_FADE_SECONDS * 0.1)).toBeLessThan(MUSIC_LEVEL * 0.1);
    let prev = 0;
    for (let t = 0.1; t <= MUSIC_FADE_SECONDS; t += 0.1) {
      const v = musicFadeLevel(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v - prev).toBeLessThan(MUSIC_LEVEL * 0.05);
      prev = v;
    }
    expect(MUSIC_LEVEL).toBeLessThan(1);
  });

  it('the track ships with the game at the URL the player loads', () => {
    expect(MUSIC_URL.endsWith('audio/forest-ambience.mp3')).toBe(true);
    const file = resolve(__dirname, '../public', MUSIC_URL.replace(/^.*?audio\//, 'audio/'));
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(1_000_000);
  });
});

describe('volume settings persistence', () => {
  it('normalizes missing, malformed and legacy settings', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ masterVolume: 0.3, musicVolume: 0.6, sfxVolume: 0.8, muted: true, sensitivity: 1.4, invertY: true }))
      .toEqual({ masterVolume: 0.3, musicVolume: 0.6, sfxVolume: 0.8, muted: true, sensitivity: 1.4, invertY: true });
    expect(normalizeSettings({ masterVolume: 'loud', muted: 'yes' })).toMatchObject({ masterVolume: 0.5, muted: false });
    expect(normalizeSettings({ masterVolume: 7 }).masterVolume).toBe(1);
    // the pre-music `volume` (80% default) is dropped for the new 50% master volume
    const legacy = normalizeSettings({ volume: 0.8, muted: true });
    expect(legacy).toEqual({ ...DEFAULT_SETTINGS, muted: true });
    expect('volume' in legacy).toBe(false);
  });

  it('a new player starts at 50%, and a chosen volume survives a reload', () => {
    const store = new MemoryStorage();
    const rm = new RunManager(store, () => 5);
    expect(rm.meta.settings.masterVolume).toBe(0.5);
    rm.meta.settings.masterVolume = 0.3;
    rm.saveMeta();
    expect(new RunManager(store).meta.settings.masterVolume).toBe(0.3);
  });

  it('muting keeps the chosen volume, and unmuting restores it', () => {
    const store = new MemoryStorage();
    const rm = new RunManager(store, () => 5);
    rm.meta.settings.masterVolume = 0.7;
    rm.meta.settings.muted = true;
    rm.saveMeta();
    const reloaded = new RunManager(store);
    const s = reloaded.meta.settings;
    expect(s).toMatchObject({ muted: true, masterVolume: 0.7 });
    expect(masterGain(s.masterVolume, s.muted)).toBe(0);
    s.muted = false;
    expect(masterGain(s.masterVolume, s.muted)).toBeCloseTo(0.7 * MASTER_HEADROOM);
  });

  it('upgrades stored meta from before the master volume', () => {
    const store = new MemoryStorage();
    store.setItem(STORAGE_KEYS.meta, JSON.stringify({ version: 1, worldSeed: 9, best: null, deaths: 2, settings: { muted: false, volume: 0.8, sensitivity: 1.2, invertY: false } }));
    const rm = new RunManager(store);
    expect(rm.meta.worldSeed).toBe(9);
    expect(rm.meta.deaths).toBe(2);
    expect(rm.meta.settings).toEqual({ muted: false, masterVolume: 0.5, musicVolume: 0.1, sfxVolume: 1, sensitivity: 1.2, invertY: false });
  });
});

describe('separate music and effects volume', () => {
  const base = { masterVolume: 0.5, musicVolume: 0.1, sfxVolume: 1, muted: false };

  it('music defaults to 10% and effects to 100%', () => {
    expect(DEFAULT_MUSIC_VOLUME).toBe(0.1);
    expect(DEFAULT_SFX_VOLUME).toBe(1);
    expect(DEFAULT_SETTINGS).toMatchObject({ musicVolume: 0.1, sfxVolume: 1 });
    expect(new RunManager(new MemoryStorage(), () => 5).meta.settings).toMatchObject({ masterVolume: 0.5, musicVolume: 0.1, sfxVolume: 1 });
  });

  it('the music slider moves only the music bus, and the effects slider only the effects bus', () => {
    const a = busGains(base);
    const louderMusic = busGains({ ...base, musicVolume: 0.9 });
    expect(louderMusic.music).toBeCloseTo(0.9);
    expect(louderMusic.sfx).toBe(a.sfx);
    expect(louderMusic.master).toBe(a.master);
    const quietFx = busGains({ ...base, sfxVolume: 0.2 });
    expect(quietFx.sfx).toBeCloseTo(0.2);
    expect(quietFx.music).toBe(a.music);
    expect(quietFx.master).toBe(a.master);
    // silence either one without touching the other
    expect(busGains({ ...base, musicVolume: 0 })).toMatchObject({ music: 0, sfx: 1 });
    expect(busGains({ ...base, sfxVolume: 0 })).toMatchObject({ music: 0.1, sfx: 0 });
  });

  it('master and mute still apply to both', () => {
    expect(busGains({ ...base, masterVolume: 1 }).master).toBeCloseTo(MASTER_HEADROOM);
    expect(busGains({ ...base, muted: true }).master).toBe(0);
    expect(busGains({ ...base, muted: true })).toMatchObject({ music: 0.1, sfx: 1 });
  });

  it('effects at the 100% default are exactly as loud as before, and music at 10% is a tenth of its old level', () => {
    const g = busGains(base);
    expect(g.master * g.sfx).toBe(masterGain(0.5, false));
    expect(g.master * g.music * MUSIC_LEVEL).toBeCloseTo(masterGain(0.5, false) * MUSIC_LEVEL * 0.1);
  });

  it('clamps junk values to each bus default', () => {
    expect(busGains({ ...base, musicVolume: Number.NaN, sfxVolume: 'loud' as unknown as number })).toMatchObject({ music: 0.1, sfx: 1 });
    expect(busGains({ ...base, musicVolume: 4, sfxVolume: -1 })).toMatchObject({ music: 1, sfx: 0 });
  });

  it('migrates saved settings: master volume stays, music starts at 10%, effects keep their level', () => {
    const store = new MemoryStorage();
    store.setItem(STORAGE_KEYS.meta, JSON.stringify({ version: 1, worldSeed: 3, best: null, deaths: 0, settings: { muted: true, masterVolume: 0.8, sensitivity: 1, invertY: false } }));
    const rm = new RunManager(store);
    expect(rm.meta.settings).toEqual({ muted: true, masterVolume: 0.8, musicVolume: 0.1, sfxVolume: 1, sensitivity: 1, invertY: false });
    rm.meta.settings.musicVolume = 0.35;
    rm.meta.settings.sfxVolume = 0.6;
    rm.saveMeta();
    expect(new RunManager(store).meta.settings).toMatchObject({ masterVolume: 0.8, musicVolume: 0.35, sfxVolume: 0.6 });
  });
});
