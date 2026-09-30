import {
  busGains, DEFAULT_MASTER_VOLUME, DEFAULT_MUSIC_VOLUME, DEFAULT_SFX_VOLUME, LAKE_URL, lakeAmbienceLevel, MUSIC_FADE_SECONDS, MUSIC_URL, musicFadeLevel,
  type VolumeSettings,
} from './mix';

/**
 * Web Audio: a looping background music track, a recorded lake loop that swells near water, procedural layered
 * ambience (wind, fire, birds, crickets, owls) and synthesized SFX. Music and effects/ambience each have their own volume bus, and both
 * run through one master gain, so master volume and mute apply to all of it.
 */

export type Sfx =
  | 'gatherPlant' | 'gatherWood' | 'gatherStone' | 'chop' | 'treeFall' | 'craft' | 'learned' | 'objective'
  | 'place' | 'placeFail' | 'eat' | 'drink' | 'fill' | 'hurt' | 'death' | 'sleep' | 'dawn' | 'nightfall'
  | 'arrow' | 'hit' | 'growl' | 'howl' | 'jump' | 'land' | 'click' | 'fuel' | 'swing' | 'deny' | 'packFull'
  | 'splash' | 'skillUp' | 'broke' | 'cast' | 'plop' | 'bite' | 'reel';

export interface AmbienceInput {
  hour: number;
  night: number;
  fireDist: number;
  waterDist: number;
  indoors: boolean;
  paused: boolean;
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private fxVolume!: GainNode;
  private musicVolume!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private lakeGain!: GainNode;
  private lake: HTMLAudioElement | null = null;
  private fireGain!: GainNode;
  private musicGain!: GainNode;
  private music: HTMLAudioElement | null = null;
  private musicFaded = false;
  private volume: VolumeSettings = { masterVolume: DEFAULT_MASTER_VOLUME, musicVolume: DEFAULT_MUSIC_VOLUME, sfxVolume: DEFAULT_SFX_VOLUME, muted: false };
  private muted = false;
  private nextBird = 2;
  private nextCricket = 0;
  private nextOwl = 20;
  private nextCrackle = 0;
  private t = 0;
  private fireNear = 0;

  get started(): boolean {
    return !!this.ctx;
  }

  /** Must be called from a user gesture (browsers only allow audio to begin after one). */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      this.playMusic();
      this.playLake();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.fxVolume = ctx.createGain();
    this.fxVolume.connect(this.master);
    this.musicVolume = ctx.createGain();
    this.musicVolume.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.fxVolume);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.8;
    this.ambBus.connect(this.fxVolume);
    this.applyVolume();

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = (b + 0.02 * w) / 1.02;
      d[i] = w * 0.6 + b * 3;
    }
    const loop = (filterType: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.5 + Math.random() * 0.2;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.ambBus);
      src.start();
      return { f, g };
    };
    const wind = loop('lowpass', 500, 0.6);
    this.windGain = wind.g;
    this.windFilter = wind.f;
    this.fireGain = loop('lowpass', 900, 0.4).g;
    this.startMusic(ctx);
    this.startLake(ctx);
  }

  /** The lake loop plays on the ambience bus (Effects slider), silent until you come near water. */
  private startLake(ctx: AudioContext): void {
    if (typeof Audio === 'undefined') return;
    const el = new Audio(LAKE_URL);
    el.loop = true;
    el.preload = 'auto';
    this.lakeGain = ctx.createGain();
    this.lakeGain.gain.value = 0;
    this.lakeGain.connect(this.ambBus);
    try {
      ctx.createMediaElementSource(el).connect(this.lakeGain);
    } catch {
      return;
    }
    this.lake = el;
    this.playLake();
  }

  private playLake(): void {
    const el = this.lake;
    if (el?.paused) el.play().catch(() => undefined);
  }

  private startMusic(ctx: AudioContext): void {
    if (typeof Audio === 'undefined') return;
    const el = new Audio(MUSIC_URL);
    el.loop = true;
    el.preload = 'auto';
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.musicVolume);
    try {
      ctx.createMediaElementSource(el).connect(this.musicGain);
    } catch {
      return;
    }
    this.music = el;
    this.playMusic();
  }

  /** Starts (or retries) the music; a rejected play() just waits for the next user gesture. */
  private playMusic(): void {
    const el = this.music;
    if (!el || !el.paused) return;
    el.play().then(
      () => this.fadeInMusic(),
      () => undefined,
    );
  }

  private fadeInMusic(): void {
    const ctx = this.ctx;
    if (!ctx || this.musicFaded) return;
    this.musicFaded = true;
    const steps = 32;
    const curve = new Float32Array(steps + 1);
    for (let i = 0; i <= steps; i++) curve[i] = musicFadeLevel((i / steps) * MUSIC_FADE_SECONDS);
    const g = this.musicGain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueCurveAtTime(curve, ctx.currentTime, MUSIC_FADE_SECONDS);
  }

  get musicPlaying(): boolean {
    return !!this.music && !this.music.paused;
  }

  setVolume(s: VolumeSettings): void {
    this.volume = { masterVolume: s.masterVolume, musicVolume: s.musicVolume, sfxVolume: s.sfxVolume, muted: s.muted };
    this.muted = s.muted;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.ctx) return;
    const g = busGains(this.volume);
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(g.master, t, 0.05);
    this.musicVolume.gain.setTargetAtTime(g.music, t, 0.05);
    this.fxVolume.gain.setTargetAtTime(g.sfx, t, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  // ------------------------------------------------------------------ primitives

  private tone(freq: number, dur: number, o: { type?: OscillatorType; gain?: number; attack?: number; to?: number; delay?: number; pan?: number; bus?: AudioNode; lp?: number; vibrato?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    const g = ctx.createGain();
    const peak = o.gain ?? 0.2;
    const a = o.attack ?? 0.01;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node: AudioNode = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      node.connect(f);
      node = f;
    }
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const lg = ctx.createGain();
      lg.gain.value = o.vibrato;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    node.connect(g);
    this.out(g, o.pan, o.bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private burst(dur: number, o: { type?: BiquadFilterType; freq?: number; to?: number; q?: number; gain?: number; delay?: number; attack?: number; pan?: number; bus?: AudioNode; rate?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = o.rate ?? 1;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq ?? 1000, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    const a = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.3, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g);
    this.out(g, o.pan, o.bus);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  private out(node: AudioNode, pan: number | undefined, bus: AudioNode | undefined): void {
    const ctx = this.ctx!;
    const dest = bus ?? this.sfxBus;
    if (pan !== undefined && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p).connect(dest);
    } else {
      node.connect(dest);
    }
  }

  // ------------------------------------------------------------------ effects

  play(name: Sfx, strength = 1): void {
    if (!this.ctx || this.muted) return;
    const r = () => 0.92 + Math.random() * 0.16;
    switch (name) {
      case 'gatherPlant':
        this.burst(0.12, { type: 'highpass', freq: 2500, gain: 0.12 });
        this.tone(520 * r(), 0.14, { type: 'triangle', to: 700, gain: 0.08 });
        break;
      case 'gatherWood':
        this.tone(190 * r(), 0.1, { gain: 0.25, to: 140 });
        this.burst(0.08, { freq: 900, q: 2, gain: 0.25 });
        this.tone(640 * r(), 0.12, { type: 'triangle', gain: 0.05, delay: 0.04 });
        break;
      case 'gatherStone':
        this.tone(1100 * r(), 0.06, { type: 'square', gain: 0.04, to: 700, lp: 3000 });
        this.burst(0.06, { freq: 2600, q: 3, gain: 0.25 });
        this.burst(0.05, { freq: 3100, q: 3, gain: 0.18, delay: 0.07 });
        break;
      case 'chop':
        this.tone(130 * r(), 0.18, { gain: 0.5, to: 65 });
        this.burst(0.13, { freq: 650, q: 1.3, gain: 0.45 });
        this.burst(0.05, { type: 'highpass', freq: 3000, gain: 0.12 });
        break;
      case 'treeFall':
        this.tone(95, 1.3, { type: 'sawtooth', gain: 0.12, to: 55, lp: 380, attack: 0.3, vibrato: 6 });
        this.burst(1.8, { type: 'lowpass', freq: 700, to: 120, gain: 0.7, delay: 1.65, attack: 0.02 });
        this.tone(60, 0.6, { gain: 0.6, to: 35, delay: 1.65 });
        this.burst(1.2, { type: 'highpass', freq: 2500, gain: 0.08, delay: 1.7, attack: 0.05 });
        break;
      case 'craft':
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', gain: 0.1, delay: i * 0.07 }));
        this.burst(0.15, { freq: 1400, gain: 0.08 });
        break;
      case 'learned':
        this.tone(880, 1.4, { gain: 0.1, attack: 0.02 });
        this.tone(1320, 1.1, { gain: 0.06, delay: 0.1 });
        this.tone(1760, 0.9, { gain: 0.035, delay: 0.2 });
        break;
      case 'objective':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 1.6, { gain: 0.07, delay: i * 0.09, attack: 0.02 }));
        break;
      case 'place':
        this.tone(95, 0.3, { gain: 0.5, to: 50 });
        this.burst(0.25, { type: 'lowpass', freq: 500, gain: 0.35 });
        this.tone(660, 0.4, { type: 'triangle', gain: 0.05, delay: 0.1 });
        break;
      case 'placeFail':
      case 'deny':
        this.tone(240, 0.16, { type: 'triangle', gain: 0.1, to: 190 });
        this.tone(180, 0.2, { type: 'triangle', gain: 0.08, delay: 0.09, to: 150 });
        break;
      case 'packFull':
        this.tone(330, 0.12, { type: 'triangle', gain: 0.08 });
        this.tone(262, 0.18, { type: 'triangle', gain: 0.08, delay: 0.1 });
        break;
      case 'eat':
        for (let i = 0; i < 3; i++) this.burst(0.06, { freq: 1600 + Math.random() * 800, q: 1.5, gain: 0.22, delay: i * 0.13 });
        break;
      case 'drink':
        for (let i = 0; i < 2; i++) this.tone(280 * r(), 0.1, { gain: 0.18, to: 520, delay: i * 0.22 });
        this.burst(0.35, { type: 'lowpass', freq: 600, gain: 0.08 });
        break;
      case 'fill':
        for (let i = 0; i < 5; i++) this.tone(400 + Math.random() * 500, 0.07, { gain: 0.07, to: 900, delay: i * 0.07 });
        this.burst(0.5, { freq: 1200, to: 500, gain: 0.12 });
        break;
      case 'hurt':
        this.tone(170, 0.28, { type: 'sawtooth', gain: 0.18, to: 80, lp: 700 });
        this.burst(0.18, { type: 'lowpass', freq: 500, gain: 0.4 });
        break;
      case 'death':
        [220, 262, 330].forEach((f, i) => this.tone(f, 3.2, { type: 'triangle', gain: 0.07, to: f * 0.75, delay: i * 0.25, attack: 0.3 }));
        break;
      case 'sleep':
        [392, 330, 262, 330, 392].forEach((f, i) => this.tone(f, 0.9, { gain: 0.08, delay: i * 0.38, attack: 0.05 }));
        break;
      case 'dawn':
        [523, 784, 659, 1047].forEach((f, i) => this.tone(f, 1.4, { gain: 0.06, delay: i * 0.18, attack: 0.03 }));
        this.bird(0.4);
        this.bird(-0.3);
        break;
      case 'nightfall':
        this.owl(0.3);
        break;
      case 'arrow':
        this.burst(0.35, { freq: 1800, to: 400, q: 2, gain: 0.2 * strength + 0.05 });
        this.tone(120, 0.08, { type: 'triangle', gain: 0.1 });
        break;
      case 'hit':
        this.burst(0.08, { freq: 900, q: 1.5, gain: 0.35 });
        this.tone(210, 0.1, { gain: 0.2, to: 120 });
        break;
      case 'growl':
        this.tone(68, 1.6, { type: 'sawtooth', gain: 0.22 * strength, lp: 320, attack: 0.15, vibrato: 9, to: 55 });
        this.burst(1.5, { type: 'lowpass', freq: 380, gain: 0.25 * strength, attack: 0.15 });
        break;
      case 'howl':
        this.howl(strength);
        break;
      case 'jump':
        this.burst(0.08, { type: 'lowpass', freq: 600, gain: 0.08 });
        break;
      case 'land':
        this.burst(0.14, { type: 'lowpass', freq: 260, gain: 0.3 * Math.min(1, strength) });
        break;
      case 'click':
        this.tone(700, 0.05, { type: 'triangle', gain: 0.06 });
        break;
      case 'fuel':
        this.burst(0.5, { type: 'lowpass', freq: 300, to: 1600, gain: 0.35, attack: 0.08 });
        this.tone(110, 0.4, { gain: 0.15, to: 180 });
        break;
      case 'swing':
        this.burst(0.18, { freq: 700, to: 1700, q: 0.8, gain: 0.09 });
        break;
      case 'splash':
        this.burst(0.5, { type: 'lowpass', freq: 900, to: 250, gain: 0.35 * Math.min(1, strength) + 0.1 });
        this.burst(0.35, { type: 'highpass', freq: 1800, gain: 0.12, delay: 0.03 });
        break;
      case 'cast':
        this.burst(0.3, { freq: 900, to: 2600, q: 1.2, gain: 0.06 + 0.06 * strength });
        this.tone(2400, 0.4, { type: 'triangle', gain: 0.012, to: 1500, delay: 0.05 });
        break;
      case 'plop':
        this.tone(420 * r(), 0.09, { gain: 0.08, to: 900 });
        this.burst(0.18, { type: 'lowpass', freq: 1100, to: 400, gain: 0.12 });
        break;
      case 'bite':
        for (let i = 0; i < 3; i++) this.burst(0.06, { type: 'lowpass', freq: 800, to: 300, gain: 0.14, delay: i * 0.11 });
        this.tone(330, 0.05, { type: 'triangle', gain: 0.05, delay: 0.02 });
        break;
      case 'reel':
        for (let i = 0; i < 6; i++) this.tone(1500 * r(), 0.02, { type: 'square', gain: 0.012, lp: 2500, delay: i * 0.045 });
        break;
      case 'skillUp':
        [659, 880, 1175].forEach((f, i) => this.tone(f, 0.8, { type: 'triangle', gain: 0.06, delay: i * 0.08, attack: 0.02 }));
        break;
      case 'broke':
        this.burst(0.12, { freq: 1300, q: 2, gain: 0.3 });
        this.tone(200, 0.25, { type: 'triangle', gain: 0.12, to: 110, delay: 0.05 });
        break;
    }
  }

  /** A gentle swimming stroke. */
  stroke(): void {
    if (!this.ctx || this.muted) return;
    this.burst(0.4, { type: 'lowpass', freq: 700, to: 300, gain: 0.1, attack: 0.08 });
    this.burst(0.25, { type: 'highpass', freq: 1400 + Math.random() * 400, gain: 0.05, delay: 0.1 });
  }

  footstep(water: boolean, sprint: boolean): void {
    if (!this.ctx || this.muted) return;
    if (water) this.burst(0.16, { type: 'highpass', freq: 900 + Math.random() * 400, gain: 0.14, attack: 0.01 });
    else {
      this.burst(0.07, { freq: 350 + Math.random() * 500, q: 0.9, gain: sprint ? 0.16 : 0.1 });
      if (Math.random() < 0.3) this.burst(0.04, { type: 'highpass', freq: 3500, gain: 0.04, delay: 0.02 });
    }
  }

  private bird(pan: number): void {
    const bus = this.ambBus;
    const kind = Math.floor(Math.random() * 4);
    const g = 0.03 + Math.random() * 0.03;
    if (kind === 0) {
      this.tone(3950, 0.28, { gain: g, pan, bus, attack: 0.03 });
      this.tone(3450, 0.35, { gain: g, pan, bus, delay: 0.32, attack: 0.03 });
    } else if (kind === 1) {
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const f = 2100 + Math.random() * 1100;
        this.tone(f, 0.12, { gain: g, pan, bus, to: f * (0.8 + Math.random() * 0.4), delay: i * 0.17 });
      }
    } else if (kind === 2) {
      for (let i = 0; i < 6; i++) this.tone(1800 + i * 420, 0.14, { gain: g * 0.8, pan, bus, delay: i * 0.1, to: 2000 + i * 460, vibrato: 60 });
    } else {
      for (let i = 0; i < 12; i++) this.tone(i % 2 ? 4400 : 3900, 0.05, { gain: g * 0.6, pan, bus, delay: i * 0.055 });
    }
  }

  private cricket(pan: number, g: number): void {
    const f = 4300 + Math.random() * 500;
    for (let i = 0; i < 3; i++) this.tone(f, 0.035, { gain: g, pan, bus: this.ambBus, delay: i * 0.05 });
  }

  private owl(pan: number): void {
    const bus = this.ambBus;
    this.tone(390, 0.4, { gain: 0.05, pan, bus, to: 350, attack: 0.08 });
    this.tone(370, 0.55, { gain: 0.045, pan, bus, to: 330, delay: 0.55, attack: 0.1 });
  }

  private howl(strength: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(380, t0);
    osc.frequency.linearRampToValueAtTime(690, t0 + 0.8);
    osc.frequency.linearRampToValueAtTime(640, t0 + 2.0);
    osc.frequency.linearRampToValueAtTime(420, t0 + 2.8);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    const lg = ctx.createGain();
    lg.gain.value = 8;
    lfo.connect(lg).connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.06 * strength + 0.01, t0 + 0.5);
    g.gain.setValueAtTime(0.06 * strength + 0.01, t0 + 2.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.9);
    osc.connect(g);
    this.out(g, Math.random() * 1.4 - 0.7, this.ambBus);
    osc.start(t0);
    lfo.start(t0);
    osc.stop(t0 + 3);
    lfo.stop(t0 + 3);
  }

  // ------------------------------------------------------------------ ambience

  update(dt: number, a: AmbienceInput): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.t += dt;
    const now = ctx.currentTime;
    const quiet = a.paused ? 0.35 : 1;
    const windLevel = (0.05 + 0.035 * Math.sin(this.t * 0.13) + 0.02 * Math.sin(this.t * 0.41)) * (a.indoors ? 0.5 : 1) * quiet;
    this.windGain.gain.setTargetAtTime(windLevel, now, 0.5);
    this.windFilter.frequency.setTargetAtTime(380 + 260 * (0.5 + 0.5 * Math.sin(this.t * 0.21)), now, 0.8);
    if (this.lake) this.lakeGain.gain.setTargetAtTime(lakeAmbienceLevel(a.waterDist) * quiet, now, 0.6);
    this.fireNear = Math.max(0, 1 - a.fireDist / 12);
    this.fireGain.gain.setTargetAtTime(this.fireNear * this.fireNear * 0.12 * quiet, now, 0.3);
    if (a.paused) return;

    const day = 1 - a.night;
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      const dawnChorus = a.hour > 5.5 && a.hour < 9 ? 0.45 : 1;
      this.nextBird = (2 + Math.random() * 6) * dawnChorus;
      if (day > 0.4 && Math.random() < day) this.bird(Math.random() * 1.6 - 0.8);
    }
    this.nextCricket -= dt;
    if (this.nextCricket <= 0) {
      this.nextCricket = 0.35 + Math.random() * 0.6;
      if (a.night > 0.4) {
        const n = 1 + Math.floor(Math.random() * 2);
        for (let i = 0; i < n; i++) this.cricket(Math.random() * 1.8 - 0.9, 0.012 * a.night);
      }
    }
    this.nextOwl -= dt;
    if (this.nextOwl <= 0) {
      this.nextOwl = 25 + Math.random() * 40;
      if (a.night > 0.7) this.owl(Math.random() * 1.6 - 0.8);
    }
    this.nextCrackle -= dt;
    if (this.nextCrackle <= 0) {
      this.nextCrackle = 0.06 + Math.random() * 0.25;
      if (this.fireNear > 0.05) this.burst(0.03 + Math.random() * 0.04, { type: 'highpass', freq: 1800 + Math.random() * 2500, gain: 0.12 * this.fireNear, bus: this.ambBus });
    }
  }
}
