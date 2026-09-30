import { clamp, damp } from '../core/math';
import { BALANCE } from '../data/balance';
import { BIOME_IDS, BIOMES, biomeDef, speciesName, type BiomeId } from '../data/biomes';
import { ITEMS, TOOLS, getDisplayBiome, itemName, setDisplayBiome, type ItemId } from '../data/items';
import { OBJECTIVES, objectiveText } from '../data/objectives';
import { PLACE_ROTATE_BIG_STEP, PLACE_ROTATE_STEP, PREFABS } from '../data/prefabs';
import { RECIPE_BY_ID } from '../data/recipes';
import type { SpeciesId } from '../data/species';
import { AudioSystem, type Sfx } from '../audio/audio';
import { volumePercent } from '../audio/mix';
import { randomSeed } from '../core/rng';
import { localNetRequested, supabaseConfig } from '../net/config';
import { GuestSession } from '../net/guest';
import { HostSession } from '../net/host';
import { checkBackend, LobbyWatcher, type ServerInfo } from '../net/lobby';
import type { Avatar, Profile } from '../net/protocol';
import type { Session, SessionEvent } from '../net/session';
import { createSupabaseTransport } from '../net/supabase';
import { broadcastBus, LocalTransport, type Transport } from '../net/transport';
import { avatarPortrait } from '../render/avatars';
import type { SimEvent } from '../sim/events';
import { PLACEMENT_REASON_TEXT } from '../sim/placement';
import { browserStorage, RunManager, type DeathSummary, type Settings } from '../sim/run';
import { IDLE_INPUT, Simulation, type SimInput } from '../sim/simulation';
import { formatClock, hoursSurvived } from '../sim/time';
import { GameView, type CameraPose } from '../render/view';
import type { ViewModelInput } from '../render/viewmodel';
import { DevPanel, TIME_SCALES } from '../ui/dev';
import { effectSummary, Hud } from '../ui/hud';
import { itemIcon, prefabIcon, toolIcon } from '../ui/icons';
import { MpHud, MpMenu } from '../ui/multiplayer';
import { Panels } from '../ui/panels';
import { Screens } from '../ui/screens';
import { EscapeRouter, type UiMode } from './escape';
import { Input } from './input';

type Mode = UiMode;

const BASE_FOV = 72;
const AUTOSAVE_SECONDS = 30;
const LOOK_SPEED = 0.0022;
/** Hidden or occluded tabs get no animation frames; a multiplayer host still has to run the shared world. */
const BACKGROUND_TICK_MS = 250;

function errText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Check your connection and try again.';
}

/** Banner lines that differ per map; the Pacific Northwest keeps its original wording. */
const COPY: Record<BiomeId, { start: string; dawn: string; dawnLater: string; nightfall: string }> = {
  pnw: {
    start: 'Stranded, but the forest provides. Start by gathering sticks and stones.',
    dawn: 'A new morning in the forest.',
    dawnLater: 'Morning mist over the lake. Bears wander these woods now.',
    nightfall: 'Stay close to your fire. Wolves hunt in the dark; a torch keeps them at bay.',
  },
  desert: {
    start: 'Stranded, but the desert provides. Start by gathering sticks and stones, and find the spring.',
    dawn: 'Sunrise over the red rock. The day will be hot; the evening turns cold fast.',
    dawnLater: 'Dawn light on the mesas. A black bear roams the juniper high country now.',
    nightfall: 'The desert sheds its heat fast after dark. Stay by your fire; a mountain lion hunts at dusk and a torch keeps it at bay.',
  },
};

const FUR: Partial<Record<SpeciesId, string>> = {
  bear: '#2a2420', wolf: '#8e8a83', fish: '#cfe6f2', cougar: '#b48d5f', javelina: '#4a4039', jackrabbit: '#a58d6c',
  quail: '#6e6a6a', roadrunner: '#6b5843', lizard: '#a8946a', snake: '#9a8360',
};

const MAP_FADE_MS = 900;

/** Wires the simulation to rendering, audio, UI, input and persistence. */
export class Game {
  readonly run: RunManager;
  sim: Simulation;
  readonly view: GameView;
  readonly input: Input;
  readonly audio = new AudioSystem();
  readonly hud: Hud;
  readonly panels: Panels;
  readonly screens: Screens;
  readonly dev: DevPanel | null;
  mode: Mode = 'title';
  ready = false;

  private isPreview = true;
  private yaw = 0;
  private pitch = 0;
  private camY = 0;
  private bobPhase = 0;
  private bobK = 0;
  private swimK = 0;
  private landDip = 0;
  private shake = 0;
  private fov = BASE_FOV;
  private lastWalked = 0;
  private stepAcc = 0;
  private saveTimer = AUTOSAVE_SECONDS;
  private time = 0;
  private last = 0;
  private timeScale = 1;
  private fpsOn = false;
  private fpsAvg = 60;
  private expectUnlock = false;
  private deathT = 0;
  private deathShown = false;
  private death: DeathSummary | null = null;
  private readonly events: SimEvent[] = [];
  private readonly simInput: SimInput = { ...IDLE_INPUT };
  private readonly cooldowns = new Map<string, number>();
  private readonly esc = new EscapeRouter();
  private readonly pose: CameraPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: BASE_FOV };
  private readonly vmInput: ViewModelInput = { tool: 'hands', speed: 0, grounded: true, sprinting: false, lookDX: 0, lookDY: 0, draw: -1, sitting: false, hasArrows: false };
  private settings: Settings;
  private lastDay = 0;

  readonly mpMenu: MpMenu;
  readonly mpHud: MpHud;
  mp: Session | null = null;
  private mpJoining = false;
  private joinName = '';
  private mpDeathCause: string | null = null;
  /** The single-player world to return to after leaving a server. */
  private solo: { sim: Simulation; preview: boolean } | null = null;
  private net: Promise<Transport> | null = null;
  private lobby: LobbyWatcher | null = null;
  private lobbyGen = 0;
  private joinGen = 0;
  private readonly netCfg = supabaseConfig();
  private readonly localNet = localNetRequested();
  private readonly portraits = new Map<Avatar, string>();
  private readonly idle: SimInput = { ...IDLE_INPUT };

  constructor(root: HTMLElement, devMode: boolean) {
    this.run = new RunManager(browserStorage());
    this.settings = { ...this.run.meta.settings };
    this.view = new GameView(root);
    const ui = document.createElement('div');
    ui.className = 'ui';
    root.append(ui);
    this.input = new Input(this.view.renderer.domElement);
    this.hud = new Hud(ui);
    this.panels = new Panels(ui, {
      sim: () => this.sim,
      sfx: (n) => this.sfx(n),
      close: () => this.closePanel(),
      toast: (t, tone) => this.hud.toast(t, tone ?? 'info'),
    });
    this.screens = new Screens(ui, {
      onContinue: () => this.continueRun(),
      onNewRun: () => this.beginPlay(this.run.restartFromDay1(), true),
      onNewWorld: () => this.beginPlay(this.run.startFromScratch(), true),
      onResume: () => this.resume(),
      onQuitToTitle: () => this.quitToTitle(),
      onRetryDay: () => this.retryDay(),
      onRestartDay1: () => this.beginPlay(this.run.restartFromDay1(), true),
      onStartFromScratch: () => this.beginPlay(this.run.startFromScratch(), true),
      onSelectMap: (step) => this.selectMap(step),
      onSettings: (s) => this.applySettings(s),
      onLeaveServer: () => this.leaveMp(null),
      onRespawn: () => this.respawnMp(),
      sfx: () => {
        this.audio.start();
        this.sfx('click');
      },
    }, this.settings);
    this.mpMenu = new MpMenu(ui, {
      onCreate: (p, name) => void this.hostServer(p, name),
      onJoin: (p, server) => void this.joinServer(p, server),
      onCancel: () => this.cancelJoin(),
      onRetry: () => this.refreshLobby(true),
      portrait: (kind) => this.portrait(kind),
      sfx: () => {
        this.audio.start();
        this.sfx('click');
      },
    });
    this.screens.setTitleExtra(this.mpMenu.section);
    this.mpHud = new MpHud(ui, {
      onSend: (text) => this.sendChat(text),
      onCloseChat: () => this.closeChat(),
      onGetUp: () => this.sim.getUp(),
    });
    this.dev = devMode
      ? new DevPanel(ui, {
          sim: () => this.sim,
          setTimeScale: (v) => this.setTimeScale(v),
          timeScale: () => this.timeScale,
          toggleFps: () => (this.fpsOn = !this.fpsOn),
          toast: (t) => this.hud.toast(t, 'info'),
        })
      : null;
    this.screens.clickToPlay.addEventListener('click', () => {
      this.audio.start();
      this.input.requestLock();
    });
    this.view.renderer.domElement.addEventListener('click', () => {
      if (this.mode === 'playing' && !this.input.locked) this.input.requestLock();
    });

    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onKey = (code, ev) => this.onKey(code, ev);
    this.input.onKeyUp = (code) => {
      if (code === 'Escape' && this.esc.up(performance.now()) && this.mode === 'playing') this.input.requestLock();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.saveNow();
        if (this.mode === 'playing' && !this.mp) this.pause();
      }
    });
    window.addEventListener('pagehide', () => {
      this.saveNow();
      if (this.mp && !this.mp.ended) this.mp.leave();
    });
    setInterval(() => {
      if (this.mp && performance.now() - this.last > BACKGROUND_TICK_MS * 1.5) this.backgroundTick();
    }, BACKGROUND_TICK_MS);

    const current = this.run.loadCurrent();
    this.sim = current ?? Simulation.newGame(this.run.record.worldSeed, this.run.biome);
    this.isPreview = !current;
    this.view.setWorld(this.sim);
    this.syncCameraToPlayer();
    this.audio.setVolume(this.settings);
    this.hud.setVisible(false);
    if (current && current.state.dead) {
      this.isPreview = false;
      const hours = hoursSurvived(current.state.totalHours);
      this.death = { cause: current.state.deathCause ?? 'unknown', hours, day: current.day, best: this.run.record.best, newBest: false };
      this.mode = 'dead';
      this.deathT = 10;
      this.deathShown = true;
      this.screens.showDeath(this.death, this.run.snapshotDay() ?? current.day, biomeDef(current.biome).place);
    } else {
      this.showTitle();
    }
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    this.screens.hideLoading();
    this.ready = true;
  }

  // ------------------------------------------------------------------ flow

  private showTitle(): void {
    this.mode = 'title';
    this.hud.setVisible(false);
    const alive = !this.isPreview && !this.sim.state.dead;
    const def = BIOMES[this.run.biome];
    const rec = this.run.record;
    this.screens.showTitle({
      continueLabel: alive ? `Day ${this.sim.day} · ${formatClock(this.sim.hour)}` : null,
      best: rec.best,
      deaths: rec.deaths,
      map: { id: def.id, name: def.name, tagline: def.tagline, place: def.place, index: BIOME_IDS.indexOf(def.id), count: BIOME_IDS.length },
    });
    this.mpMenu.setMap(def.id);
    this.refreshLobby(false);
  }

  /** Title-screen map arrows: each map keeps its own save, so switching shows that map's run (or a fresh preview). */
  private selectMap(step: -1 | 1): void {
    if (this.mode !== 'title' || this.mp) return;
    const i = BIOME_IDS.indexOf(this.run.biome);
    const next = BIOME_IDS[(i + step + BIOME_IDS.length) % BIOME_IDS.length];
    if (next === this.run.biome) return;
    this.saveNow();
    this.crossFade();
    this.run.selectBiome(next);
    const current = this.run.loadCurrent();
    const alive = !!current && !current.state.dead;
    this.sim = alive ? current! : Simulation.newGame(this.run.record.worldSeed, next);
    this.isPreview = !alive;
    this.sim.timeScale = this.timeScale;
    this.view.setWorld(this.sim);
    this.syncCameraToPlayer();
    this.showTitle();
  }

  /** Freeze the current picture over the canvas and fade it out while the next map renders underneath. */
  private crossFade(): void {
    const canvas = this.view.renderer.domElement;
    let url: string;
    try {
      // Without preserveDrawingBuffer the canvas only holds a picture within the task that drew it.
      this.view.frame(this.sim, 0, this.time, this.pose, null);
      url = canvas.toDataURL('image/jpeg', 0.86);
    } catch {
      return;
    }
    const img = document.createElement('img');
    img.className = 'map-fade';
    img.alt = '';
    img.src = url;
    canvas.after(img);
    // Building the next world blocks for a moment; the fade starts once it has drawn.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      img.classList.add('out');
      setTimeout(() => img.remove(), MAP_FADE_MS + 200);
    }));
  }

  private continueRun(): void {
    if (this.isPreview) {
      this.beginPlay(this.run.newRun(), true);
      return;
    }
    this.beginPlay(this.sim, false);
  }

  private beginPlay(sim: Simulation, fresh: boolean): void {
    this.audio.start();
    this.stopLobby();
    const worldChanged = sim !== this.sim;
    this.sim = sim;
    this.isPreview = false;
    sim.timeScale = this.timeScale;
    if (worldChanged || fresh) this.view.setWorld(sim);
    this.syncCameraToPlayer();
    this.lastWalked = sim.distanceWalked;
    this.death = null;
    this.deathShown = false;
    this.deathT = 0;
    this.lastDay = sim.day;
    this.screens.hideTitle();
    this.screens.hideDeath();
    this.screens.hidePause();
    this.panels.close();
    this.hud.setVisible(true);
    this.mode = 'playing';
    this.saveTimer = AUTOSAVE_SECONDS;
    this.input.requestLock();
    if (fresh) {
      this.hud.showControlsHint();
      this.hud.showBanner(`Day ${sim.day}`, COPY[sim.biome].start);
    }
  }

  private retryDay(): void {
    const sim = this.run.retryDay();
    this.beginPlay(sim, false);
    this.hud.showBanner(`Day ${sim.day}`, `Back to this morning. The ${biomeDef(sim.biome).place} remembers nothing.`);
  }

  private pause(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.saveNow();
    this.screens.syncSettings(this.settings);
    if (this.mp) {
      this.dropCharge();
      this.mpHud.closeChat();
    }
    this.screens.showPause(this.mp ? { host: this.mp.role === 'host', players: this.mp.roster().length } : null);
  }

  private resume(): void {
    this.screens.hidePause();
    this.mode = 'playing';
    this.input.requestLock();
  }

  private quitToTitle(): void {
    this.saveNow();
    this.screens.hidePause();
    this.panels.close();
    this.showTitle();
  }

  /** Let go of a half-drawn bow or a wound-up cast without firing it. */
  private dropCharge(): void {
    this.sim.bowDraw = -1;
    if (this.sim.fishing?.phase === 'charging') this.sim.cancelFishing();
  }

  private openPanel(kind: 'inventory' | 'crafting' | 'campfire' | 'structure', targetId?: number): void {
    if (this.mode !== 'playing' && this.mode !== 'panel') return;
    this.sim.cancelPlacement();
    this.dropCharge();
    if (this.dev?.open) this.dev.toggle();
    this.panels.open(kind, { targetId });
    this.mode = 'panel';
    this.expectUnlock = true;
    this.input.exitLock();
  }

  private closePanel(relock = true): void {
    this.panels.close();
    if (this.dev?.open) this.dev.toggle();
    if (this.mode === 'panel') {
      this.mode = 'playing';
      if (relock) this.input.requestLock();
    }
  }

  private onLockChange(locked: boolean): void {
    if (locked) {
      this.screens.setClickToPlay(false);
      return;
    }
    if (this.expectUnlock) {
      this.expectUnlock = false;
      return;
    }
    if (this.mode === 'playing' && this.esc.pausesOnUnlock(performance.now())) this.pause();
  }

  private onKey(code: string, ev: KeyboardEvent): void {
    if (code === 'Escape') {
      const action = this.esc.down(this.mode, this.input.locked, performance.now());
      if (action === 'closeMenu') this.closePanel(false);
      else if (action === 'resume') this.resume();
      else if (action === 'pause') this.pause();
      return;
    }
    if (this.mode === 'title' && (code === 'ArrowLeft' || code === 'ArrowRight') && this.screens.titleShown && !this.mpMenu.overlayOpen) {
      this.audio.start();
      this.sfx('click');
      this.selectMap(code === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (code === 'KeyM') {
      this.applySettings({ ...this.settings, muted: !this.settings.muted });
      this.hud.toast(this.settings.muted ? 'Sound off (M)' : `Sound on · ${volumePercent(this.settings.masterVolume)}`);
      return;
    }
    if (code === 'Backquote' && this.dev && (this.mode === 'playing' || this.mode === 'panel')) {
      const open = this.dev.toggle();
      if (open) {
        this.panels.close();
        this.mode = 'panel';
        this.expectUnlock = true;
        this.input.exitLock();
      } else if (this.mode === 'panel') {
        this.mode = 'playing';
        this.input.requestLock();
      }
      return;
    }
    if (this.mode === 'panel') {
      if (code === 'Tab') this.panels.mode === 'inventory' ? this.closePanel() : this.openPanel('inventory');
      else if (code === 'KeyC') this.panels.mode === 'crafting' ? this.closePanel() : this.openPanel('crafting');
      return;
    }
    if (this.mode !== 'playing') return;
    const sim = this.sim;
    if (this.mp && !this.mpJoining) {
      if (code === 'Enter' || code === 'NumpadEnter') {
        this.openChat();
        return;
      }
      if (code === 'Space' && sim.sleepingIn !== null) {
        sim.getUp();
        return;
      }
      if (code === 'KeyG' && !sim.state.dead) {
        this.mp.wave();
        this.throttledToast('wave', 'You wave to the others.', 'info', 2);
        return;
      }
    }
    if (code === 'Tab') this.openPanel('inventory');
    else if (code === 'KeyC') this.openPanel('crafting');
    else if (code === 'KeyF') sim.quickConsume();
    else if (code === 'KeyR' && sim.placement) sim.rotatePlacement(ev.shiftKey ? -PLACE_ROTATE_BIG_STEP : PLACE_ROTATE_BIG_STEP);
    else if (code === 'KeyQ' && sim.placement) {
      sim.cancelPlacement();
      this.hud.toast('Placement cancelled');
    } else if (code === 'KeyT' && this.dev && this.mp?.role !== 'guest') {
      const i = TIME_SCALES.indexOf(this.timeScale);
      this.setTimeScale(TIME_SCALES[(i + 1) % TIME_SCALES.length]);
    } else if (code.startsWith('Digit')) {
      const slot = Number(code.slice(5));
      const tool = sim.toolForSlot(slot);
      if (!tool) return;
      if (!sim.selectTool(tool)) this.throttledToast('tool-' + tool, `You haven't made a ${TOOLS[tool].name} yet.`, 'warn', 2);
    }
  }

  private setTimeScale(v: number): void {
    this.timeScale = v;
    this.sim.timeScale = v;
    this.hud.toast(`Dev: time ×${v}`);
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    this.run.meta.settings = { ...s };
    this.run.saveMeta();
    this.audio.setVolume(s);
    this.screens.syncSettings(s);
  }

  private saveNow(): void {
    if (this.isPreview || this.mp) return;
    this.run.save(this.sim);
  }

  private syncCameraToPlayer(): void {
    const p = this.sim.state.player;
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.camY = p.y + BALANCE.player.eyeHeight;
  }

  // ------------------------------------------------------------------ frame

  private frame(now: number): void {
    const rawDt = (now - this.last) / 1000;
    this.last = now;
    const dt = clamp(rawDt, 0, 0.1);
    this.time += dt;
    if (rawDt > 0) this.fpsAvg = this.fpsAvg * 0.95 + (1 / Math.max(rawDt, 1e-3)) * 0.05;
    let sim = this.sim;
    const input = this.input;
    if (getDisplayBiome() !== sim.biome) setDisplayBiome(sim.biome);

    const chatting = this.mpHud.chatting;
    const playing = this.mode === 'playing' && input.locked && !chatting;
    this.screens.setClickToPlay(this.mode === 'playing' && !input.locked && !chatting);
    if (playing) {
      const sens = LOOK_SPEED * this.settings.sensitivity;
      this.yaw -= input.mouseDX * sens;
      this.pitch = clamp(this.pitch - input.mouseDY * sens * (this.settings.invertY ? -1 : 1), -1.5, 1.5);
      const inp = this.simInput;
      inp.moveX = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
      inp.moveZ = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
      inp.jumpPressed = input.pressed('Space');
      inp.sprint = input.held.has('ShiftLeft') || input.held.has('ShiftRight');
      inp.yaw = this.yaw;
      inp.pitch = this.pitch;
      inp.primary = input.primary;
      inp.primaryPressed = input.primaryPressed;
      inp.primaryReleased = input.primaryReleased;
      if (sim.placement) {
        if (input.secondaryPressed) {
          sim.cancelPlacement();
          this.hud.toast('Placement cancelled');
        } else if (input.wheel !== 0) sim.rotatePlacement(input.wheel * PLACE_ROTATE_STEP);
      } else if (input.wheel !== 0) {
        sim.cycleTool(input.wheel);
      }
      sim.step(dt, inp);
    } else if (this.mpInWorld) {
      // No pausing in multiplayer: menus, chat and death screens leave the shared world running.
      sim.step(dt, this.idleInput());
    }

    sim.takeEvents(this.events);
    if (this.events.length) {
      for (const e of this.events) this.handleEvent(e);
      if (!this.isPreview && !this.mp) {
        const summary = this.run.handleEvents(sim, this.events);
        if (summary) this.onDeath(summary);
      }
    }
    if (this.mp) {
      this.updateMp(dt);
      sim = this.sim;
    }

    if (playing) {
      const walked = sim.distanceWalked - this.lastWalked;
      this.lastWalked = sim.distanceWalked;
      this.stepAcc += walked;
      const p = sim.state.player;
      const stride = p.swimming ? 2.3 : p.sprinting ? 2.5 : 1.95;
      if (this.stepAcc >= stride && (p.grounded || p.swimming)) {
        this.stepAcc = 0;
        if (p.swimming) this.audio.stroke();
        else this.audio.footstep(p.wading, p.sprinting);
      }
      this.saveTimer -= dt;
      if (this.saveTimer <= 0) {
        this.saveTimer = AUTOSAVE_SECONDS;
        this.saveNow();
      }
    }

    this.updateCamera(dt);
    const vm = this.vmInput;
    const ps = sim.state.player;
    vm.tool = sim.state.activeTool;
    vm.speed = Math.hypot(ps.vx, ps.vz);
    vm.grounded = ps.grounded;
    vm.sprinting = ps.sprinting;
    vm.lookDX = playing ? input.mouseDX : 0;
    vm.lookDY = playing ? input.mouseDY : 0;
    vm.draw = sim.fishing?.phase === 'charging' ? sim.fishing.power : sim.bowDraw >= 0 ? Math.min(1, sim.bowDraw / BALANCE.combat.bow.fullDraw) : -1;
    vm.sitting = ps.sitting;
    vm.hasArrows = sim.state.inventory.slots.some((s) => s?.item === 'arrow');
    this.view.showViewModel = this.mode !== 'title' && this.mode !== 'dead' && !sim.placement && sim.sleepingIn === null;
    if (this.mpInWorld) this.view.avatars.update(this.mp!.peers.values(), dt, this.pose.x, this.pose.y, this.pose.z);
    this.view.frame(sim, dt, this.time, this.pose, vm);

    if (this.mode !== 'title') this.hud.update(sim, dt, this.timeScale);
    this.hud.setFps(this.fpsOn ? this.fpsAvg : null);
    this.updateAudio(dt);
    if (this.mode === 'dead') {
      this.deathT += dt;
      if (!this.deathShown && this.deathT > 1.8 && (this.death || this.mpDeathCause !== null)) {
        this.deathShown = true;
        this.hud.setVisible(false);
        if (this.death) this.screens.showDeath(this.death, this.run.snapshotDay() ?? sim.day, biomeDef(sim.biome).place);
        else this.screens.showMpDeath(this.mpDeathCause!, this.mp?.role === 'host');
      }
    }
    for (const [k, v] of this.cooldowns) {
      if (v - dt <= 0) this.cooldowns.delete(k);
      else this.cooldowns.set(k, v - dt);
    }
    input.endFrame();
  }

  private updateCamera(dt: number): void {
    const sim = this.sim;
    const p = sim.state.player;
    const pose = this.pose;
    if (this.mode === 'title') {
      const t = this.time;
      pose.x = p.x;
      pose.z = p.z;
      pose.y = p.y + BALANCE.player.eyeHeight + 0.3;
      pose.yaw = p.yaw + Math.sin(t * 0.045) * 0.9;
      pose.pitch = 0.04 + Math.sin(t * 0.07) * 0.03;
      pose.roll = 0;
      pose.fov = BASE_FOV;
      return;
    }
    const dead = this.mode === 'dead';
    const eye = dead ? 0.35 : p.sitting ? 1.02 : BALANCE.player.eyeHeight;
    const target = p.y + eye;
    if (Math.abs(target - this.camY) > 1.5 && !dead) this.camY = target;
    else this.camY = damp(this.camY, target, dead ? 1.4 : 26, dt);
    const speed = Math.hypot(p.vx, p.vz);
    const moving = p.grounded && speed > 0.3 && !dead;
    if (moving) this.bobPhase += dt * speed * 1.42;
    this.bobK = damp(this.bobK, moving ? Math.min(1.25, speed / BALANCE.player.walkSpeed) : 0, 9, dt);
    if (sim.lastLanding > 5) this.landDip = Math.min(0.28, this.landDip + sim.lastLanding * 0.018);
    this.landDip = damp(this.landDip, 0, 7, dt);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.swimK = damp(this.swimK, p.swimming && !dead ? 1 : 0, 4, dt);
    const bobY = Math.sin(this.bobPhase * 2) * 0.038 * this.bobK + Math.sin(this.time * 1.7) * 0.06 * this.swimK;
    const bobX = Math.cos(this.bobPhase) * 0.024 * this.bobK;
    const cr = Math.cos(this.yaw);
    const sr = Math.sin(this.yaw);
    pose.x = p.x + cr * bobX;
    pose.z = p.z - sr * bobX;
    pose.y = this.camY + bobY - this.landDip;
    const sx = (Math.random() - 0.5) * this.shake * 0.05;
    const sy = (Math.random() - 0.5) * this.shake * 0.05;
    pose.yaw = this.yaw + sx;
    pose.pitch = (dead ? damp(pose.pitch, 0.25, 1.2, dt) : this.pitch) + sy;
    pose.roll = dead ? damp(pose.roll, 0.55, 1.1, dt) : bobX * 0.35;
    const fovTarget = BASE_FOV + (p.sprinting && speed > 5 ? 7 : 0);
    this.fov = damp(this.fov, fovTarget, 6, dt);
    pose.fov = this.fov;
    if (dead) this.pitch = pose.pitch;
  }

  private updateAudio(dt: number): void {
    if (!this.audio.started) return;
    const sim = this.sim;
    const p = sim.state.player;
    let fireDist = 99;
    const fires = this.view.entities?.fires ?? [];
    for (const f of fires) fireDist = Math.min(fireDist, Math.hypot(f.x - p.x, f.z - p.z));
    if (sim.state.activeTool === 'torch') fireDist = Math.min(fireDist, 7);
    let waterDist = 99;
    for (const l of sim.terrain.lakes) waterDist = Math.min(waterDist, Math.max(0, Math.hypot(l.x - p.x, l.z - p.z) - l.r));
    const sheltered = !!sim.nearestStructure((id) => !!PREFABS[id].shelter, BALANCE.needs.shelterWarmRadius);
    this.audio.update(dt, {
      hour: sim.hour,
      night: this.view.dayNight.night,
      fireDist,
      waterDist,
      indoors: sheltered,
      paused: this.mode === 'paused' || this.mode === 'title' || this.mode === 'dead',
    });
  }

  // ------------------------------------------------------------------ events

  private sfx(name: Sfx, strength = 1): void {
    this.audio.play(name, strength);
  }

  private throttledToast(key: string, text: string, tone: 'info' | 'warn' | 'good', seconds: number): void {
    if (this.cooldowns.has(key)) return;
    this.cooldowns.set(key, seconds);
    this.hud.toast(text, tone);
  }

  private onDeath(summary: DeathSummary): void {
    this.death = summary;
    this.mode = 'dead';
    this.deathT = 0;
    this.deathShown = false;
    this.panels.close();
    this.expectUnlock = true;
    this.input.exitLock();
    this.sfx('death');
  }

  private handleEvent(e: SimEvent): void {
    const fx = this.view.effects;
    const sim = this.sim;
    const p = sim.state.player;
    switch (e.type) {
      case 'gathered': {
        if (e.source !== 'craft') this.hud.gathered(e.item, e.count);
        const wood: ItemId[] = ['stick', 'log', 'bark', 'arrow'];
        if (e.source === 'water') this.sfx('fill');
        else if (e.source === 'craft') break;
        else if (e.item === 'stone') this.sfx('gatherStone');
        else if (wood.includes(e.item)) this.sfx('gatherWood');
        else this.sfx('gatherPlant');
        if (e.source !== 'water' && e.source !== 'tree') fx.pop(e.x, e.y, e.z, ITEMS[e.item].color);
        if (e.source === 'water') fx.splash(e.x, e.y, e.z, 8);
        this.panels.refresh();
        break;
      }
      case 'packFull':
        this.throttledToast('packFull', `Pack full: no room for ${ITEMS[e.item].plural.toLowerCase()}. Open your pack (Tab) or craft a basket.`, 'warn', 3);
        this.sfx('packFull');
        break;
      case 'swing':
        this.mp?.noteSwing();
        this.view.viewModel.swing(e.tool, e.hit);
        if (!e.hit) this.sfx('swing');
        break;
      case 'chop': {
        this.sfx('chop');
        const dx = p.x - e.x;
        const dz = p.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        fx.chips(e.x + (dx / d) * 0.4, e.y, e.z + (dz / d) * 0.4);
        if (!e.trunk) fx.leaves(e.x, e.y + 4, e.z, '#4f7a3c', 5, 2.5);
        this.shake = Math.max(this.shake, 0.25);
        break;
      }
      case 'skillUp':
        this.sfx('skillUp');
        this.panels.refresh();
        break;
      case 'wornLow':
        this.sfx('deny');
        break;
      case 'broke':
        this.sfx('broke');
        this.panels.refresh();
        break;
      case 'splash':
        this.sfx('splash', e.impact / 10);
        fx.splash(p.x, 0, p.z, 18);
        break;
      case 'cast':
        this.sfx('cast', e.power);
        break;
      case 'lureLanded':
        if (e.water) {
          this.sfx('plop');
          fx.splash(e.x, 0, e.z, 5);
        }
        break;
      case 'fishBite':
        this.sfx('bite');
        fx.splash(e.x, 0, e.z, 7);
        break;
      case 'fishDone':
        if (e.result !== 'escaped') this.sfx('reel');
        if (e.result === 'caught' || e.result === 'slipped') fx.splash(e.x, 0, e.z, 12);
        break;
      case 'treeFell':
        this.sfx('treeFall');
        setTimeout(() => (this.shake = Math.max(this.shake, 0.7)), 1700);
        this.hud.toast('Timber!', 'good');
        break;
      case 'needTool':
        this.throttledToast('needTool', e.message, 'warn', 2.5);
        this.sfx('deny');
        break;
      case 'crafted': {
        const r = RECIPE_BY_ID[e.recipe];
        this.sfx('craft');
        const o = r.output;
        if (e.burnt) this.hud.toast(`Oops, the ${r.name.toLowerCase()} charred. Still edible, and your cooking is improving.`, 'warn', itemIcon('charredMeal'));
        else if (o.kind === 'tool') this.hud.toast(`Crafted ${r.name}. Press ${TOOLS[o.tool].slot} to equip.`, 'good', toolIcon(o.tool));
        else if (o.kind === 'gear') this.hud.toast(`Made ${r.name}!`, 'good');
        else if (o.kind === 'item') this.hud.toast(`${r.station === 'fire' ? 'Cooked' : 'Made'} ${o.count > 1 ? o.count + ' ' : ''}${itemName(o.item, o.count)}`, 'good', itemIcon(o.item));
        this.panels.refresh();
        break;
      }
      case 'placed': {
        const st = sim.state.structures.find((s) => s.id === e.structure);
        this.sfx('place');
        if (st) fx.dust(st.x, st.y + 0.1, st.z, 22, 2.4);
        this.hud.toast(`Built a ${PREFABS[e.prefab].name}`, 'good');
        if (e.prefab === 'campfire') this.hud.toast('Click the fire to cook. Add sticks or logs to keep it burning.', 'info');
        break;
      }
      case 'placeFailed':
        this.sfx('placeFail');
        this.throttledToast('placeFail', PLACEMENT_REASON_TEXT[e.reason], 'warn', 1.2);
        break;
      case 'objective': {
        this.sfx('objective');
        const done = objectiveText(OBJECTIVES[e.index], sim.biome);
        const next = OBJECTIVES[e.index + 1];
        this.hud.showBanner(`${done.title}`, next ? `Next: ${objectiveText(next, sim.biome).title}` : 'You have the basics. Now: survive as many days as you can.');
        break;
      }
      case 'ate':
        this.sfx('eat');
        this.hud.toast(`Ate ${ITEMS[e.item].name}${effectSummary(e.item) ? ' · ' + effectSummary(e.item) : ''}`, ITEMS[e.item].meal ? 'good' : 'info', itemIcon(e.item));
        this.panels.refresh();
        break;
      case 'drank':
        this.sfx('drink');
        if (!e.byHand) this.panels.refresh();
        break;
      case 'filled':
        this.hud.toast(`Filled the canteen (${e.count})`, 'good', itemIcon('lakeWater'));
        break;
      case 'fuelAdded': {
        this.sfx('fuel');
        const st = sim.state.structures.find((s) => s.id === e.structure);
        if (st) for (let i = 0; i < 14; i++) fx.glow.emit(st.x, st.y + 0.4, st.z, 1, 0.6, 0.2, { vy: 2.6, spread: 1, size: 0.06, life: 1, drag: 0.5 });
        this.panels.refresh();
        break;
      }
      case 'openCooking':
        this.openPanel('campfire', e.structure);
        break;
      case 'openStructure':
        this.openPanel('structure', e.structure);
        break;
      case 'upgraded': {
        if ('tool' in e) {
          this.sfx('craft');
        } else {
          const st = sim.state.structures.find((s) => s.id === e.structure);
          this.sfx('place');
          if (st) fx.dust(st.x, st.y + 0.1, st.z, 28, 2.8);
          this.hud.toast(`Upgraded the ${PREFABS[e.from].name} into a ${PREFABS[e.prefab].name}`, 'good', prefabIcon(e.prefab));
        }
        this.panels.refresh();
        break;
      }
      case 'forageUnlocked':
        this.panels.refresh();
        break;
      case 'sat':
        this.hud.toast('You sit and rest. Energy recovers faster here.', 'good');
        break;
      case 'hurt': {
        this.sfx('hurt');
        this.shake = Math.max(this.shake, 0.6);
        const dx = e.fromX - p.x;
        const dz = e.fromZ - p.z;
        const fwd = -Math.sin(this.yaw) * dx - Math.cos(this.yaw) * dz;
        const right = Math.cos(this.yaw) * dx - Math.sin(this.yaw) * dz;
        this.hud.flashHurt(e.amount, e.source === 'dev' ? null : Math.atan2(right, fwd));
        break;
      }
      case 'death':
        if (this.mp) this.onMpDeath(e.cause);
        break;
      case 'dayStart':
        if (e.day !== this.lastDay) {
          this.lastDay = e.day;
          if (this.mode !== 'sleeping') {
            const copy = COPY[sim.biome];
            this.hud.showBanner(`Day ${e.day}`, e.day >= (sim.biome === 'desert' ? 3 : 2) ? copy.dawnLater : copy.dawn);
            this.sfx('dawn');
          }
        }
        break;
      case 'nightfall':
        this.hud.showBanner('Night falls', COPY[sim.biome].nightfall);
        this.sfx('nightfall');
        break;
      case 'slept':
        if (this.mp && this.mode !== 'playing') this.hud.showBanner(`Day ${e.day}`, 'Everyone slept through the night.');
        else this.sleepTransition(e.day, e.byFire);
        break;
      case 'sleepWait':
        this.sfx('sleep');
        this.throttledToast('sleepWait', 'You lie down. The night passes once everyone is asleep. Space gets you up.', 'info', 4);
        break;
      case 'sleepDenied':
        this.throttledToast('sleep', e.reason, 'warn', 2);
        this.sfx('deny');
        break;
      case 'animalHit': {
        this.sfx('hit');
        const col = FUR[e.species] ?? '#8a6d52';
        if (e.species === 'fish') fx.splash(e.x, 0, e.z, 16);
        else fx.fur(e.x, e.y, e.z, col, e.killed ? 18 : 8);
        if (e.killed && e.species !== 'fish') this.hud.toast(`You brought down a ${speciesName(e.species, sim.biome)}. Click it to butcher.`, 'good');
        break;
      }
      case 'animalFlee':
        if (e.species === 'deer') this.throttledToast('deer', 'The deer bolted. They spook from far away; try a bow.', 'info', 60);
        else if (e.species === 'javelina') this.throttledToast('javelina', 'The javelina scattered. They see poorly but smell you from far off; try a bow.', 'info', 60);
        break;
      case 'rattle': {
        const k = clamp(1 - Math.hypot(e.x - p.x, e.z - p.z) / 20, 0.3, 1);
        this.sfx('rattle', k);
        this.throttledToast('rattle', 'A rattlesnake is coiled and buzzing. Back away slowly; it strikes if you step closer.', 'warn', 20);
        break;
      }
      case 'predatorAlert': {
        const d = Math.hypot(e.x - p.x, e.z - p.z);
        const k = clamp(1 - d / 40, 0.2, 1);
        if (e.species === 'wolf') {
          this.sfx('howl', k);
          this.throttledToast('wolf', 'A grey wolf is stalking you. Stand by your fire or raise a torch.', 'warn', 25);
        } else if (e.species === 'cougar') {
          this.sfx('growl', k * 0.6);
          this.throttledToast('cougar', 'A mountain lion is stalking you from cover. Face it, stand by your fire or raise a torch.', 'warn', 25);
        } else {
          this.sfx('growl', k);
          this.throttledToast('bear', 'A black bear rears up! Back away slowly or keep a fire between you.', 'warn', 25);
        }
        break;
      }
      case 'predatorAttack':
        this.sfx('growl', 0.6);
        break;
      case 'arrowFired':
        this.sfx('arrow', e.power);
        break;
      case 'arrowHit':
        if (e.target === 'water') fx.splash(e.x, e.y, e.z, 10);
        else if (e.target === 'tree') fx.chips(e.x, e.y, e.z, '#c9a06a', 6);
        else if (e.target === 'ground') fx.dust(e.x, e.y, e.z, 5, 0.4);
        break;
      case 'jump':
        this.sfx('jump');
        break;
      case 'land':
        this.sfx('land', e.impact / 10);
        break;
      case 'message':
        this.throttledToast('msg-' + e.text, e.text, e.tone === 'good' ? 'good' : e.tone === 'warn' ? 'warn' : 'info', 2);
        break;
    }
  }

  private sleepTransition(day: number, byFire: boolean): void {
    this.sfx('sleep');
    this.mode = 'sleeping';
    this.sim.cancelPlacement();
    const text = byFire
      ? 'You drift off to the crackle of the fire and wake at first light, fully rested.'
      : 'You sleep without a fire and wake at first light, rested but chilled to the bone.';
    void this.screens.playSleep(day, text).then(() => {
      if (this.mode === 'sleeping') {
        this.mode = 'playing';
        this.hud.showBanner(`Day ${day}`, byFire ? 'Rested and ready. The forest is waking up.' : 'Rested, but cold. Sleep beside a burning campfire to keep your warmth.');
        this.sfx('dawn');
      }
    });
  }

  // ------------------------------------------------------------------ multiplayer

  /** In a server's world (not still joining, not on the title screen). */
  private get mpInWorld(): boolean {
    return !!this.mp && !this.mpJoining && this.mode !== 'title';
  }

  private idleInput(): SimInput {
    const inp = this.idle;
    inp.yaw = this.yaw;
    inp.pitch = this.pitch;
    return inp;
  }

  private transport(): Promise<Transport> {
    if (!this.net) {
      const net = this.localNet ? Promise.resolve<Transport>(new LocalTransport(broadcastBus(), 1000)) : createSupabaseTransport(this.netCfg!);
      net.catch(() => {
        if (this.net === net) this.net = null;
      });
      this.net = net;
    }
    return this.net;
  }

  /** Title screen: check the backend (once, or on retry) and keep the server list live. */
  private refreshLobby(force: boolean): void {
    if (this.mode !== 'title' || this.mp) return;
    if (this.localNet) {
      this.mpMenu.setStatus({ kind: 'online', local: true });
      this.startLobby();
      return;
    }
    const cfg = this.netCfg;
    if (!cfg) {
      this.mpMenu.setStatus({ kind: 'unconfigured' });
      return;
    }
    if (this.lobby && !force) return;
    this.stopLobby();
    const gen = this.lobbyGen;
    this.mpMenu.setStatus({ kind: 'checking' });
    void checkBackend(cfg).then((st) => {
      if (gen !== this.lobbyGen || this.mode !== 'title' || this.mp) return;
      if (st.state === 'online') {
        this.mpMenu.setStatus({ kind: 'online', local: false });
        this.startLobby();
      } else {
        this.mpMenu.setStatus({ kind: st.state, message: st.message });
      }
    });
  }

  private startLobby(): void {
    if (this.lobby) return;
    const gen = this.lobbyGen;
    this.mpMenu.setServers(null);
    this.transport()
      .then(async (t) => {
        if (gen !== this.lobbyGen || this.lobby || this.mode !== 'title' || this.mp) return;
        let heard = false;
        const w = new LobbyWatcher(t, (list) => {
          heard = true;
          if (this.lobby === w) this.mpMenu.setServers(list);
        });
        this.lobby = w;
        await w.start();
        setTimeout(() => {
          if (!heard && this.lobby === w) this.mpMenu.setServers([]);
        }, 1500);
      })
      .catch((err: unknown) => {
        if (gen === this.lobbyGen) this.mpMenu.setStatus({ kind: 'offline', message: `Couldn't reach the lobby. ${errText(err)}` });
      });
  }

  private stopLobby(): void {
    this.lobbyGen++;
    this.lobby?.close();
    this.lobby = null;
  }

  private portrait(kind: Avatar): string {
    let url = this.portraits.get(kind);
    if (!url) {
      url = avatarPortrait(this.view.renderer, kind);
      this.portraits.set(kind, url);
    }
    return url;
  }

  private async hostServer(profile: Profile, serverName: string): Promise<void> {
    if (this.mp) return;
    const gen = ++this.joinGen;
    this.mpMenu.showBusy('Opening your server…');
    try {
      const t = await this.transport();
      if (gen !== this.joinGen) return;
      this.stopLobby();
      const biome = this.run.biome;
      const host = new HostSession(t, Simulation.newGame(randomSeed(), biome), profile, serverName);
      await host.start();
      if (gen !== this.joinGen) {
        host.leave();
        return;
      }
      this.mp = host;
      this.enterMp(host, serverName, `A brand-new ${BIOMES[biome].name} world. Friends can join from their main menu.`);
    } catch (err) {
      if (gen !== this.joinGen) return;
      this.mpMenu.showError(`Couldn't open the server. ${errText(err)}`);
      this.refreshLobby(true);
    }
  }

  private async joinServer(profile: Profile, server: ServerInfo): Promise<void> {
    if (this.mp) return;
    const gen = ++this.joinGen;
    this.mpMenu.showBusy(`Joining ${server.name}…`);
    try {
      const t = await this.transport();
      if (gen !== this.joinGen) return;
      this.stopLobby();
      const guest = new GuestSession(t, profile, server.sid);
      this.mp = guest;
      this.mpJoining = true;
      this.joinName = server.name;
      await guest.start();
    } catch (err) {
      if (gen !== this.joinGen) return;
      this.abandonJoin();
      this.mpMenu.showError(`Couldn't join ${server.name}. ${errText(err)}`);
    }
  }

  private cancelJoin(): void {
    this.joinGen++;
    this.abandonJoin();
    this.mpMenu.closeOverlay();
  }

  private abandonJoin(): void {
    if (this.mp && this.mpJoining) {
      if (!this.mp.ended) this.mp.leave();
      this.mp = null;
      this.mpJoining = false;
    }
    this.refreshLobby(true);
  }

  private enterMp(mp: Session, title: string, text: string): void {
    this.mpJoining = false;
    if (!this.solo) {
      if (!this.isPreview) this.run.save(this.sim);
      this.solo = { sim: this.sim, preview: this.isPreview };
    }
    this.mpMenu.closeOverlay();
    this.mpMenu.setNotice(null);
    this.mpHud.reset();
    for (const line of mp.chatLog) this.mpHud.addChat(line.name, line.t, line.pid === mp.pid);
    this.mpDeathCause = null;
    this.beginPlay(mp.sim!, false);
    this.mpHud.setVisible(true);
    this.hud.showBanner(title, text);
    this.hud.toast('Enter to chat · G to wave · Esc for settings (the world keeps running)', 'info');
  }

  private updateMp(dt: number): void {
    const mp = this.mp!;
    mp.update(dt);
    for (const e of mp.takeEvents()) {
      this.onMpEvent(mp, e);
      if (this.mp !== mp) return;
    }
    if (!this.mpJoining) this.mpHud.update(dt, mp.roster(), this.sim.sleepingIn !== null && !this.sim.state.dead);
  }

  private onMpEvent(mp: Session, e: SessionEvent): void {
    switch (e.type) {
      case 'chat':
        this.mpHud.addChat(e.name, e.text, e.pid === mp.pid);
        break;
      case 'system':
        this.mpHud.addSystem(e.text);
        break;
      case 'emote':
        this.mpHud.addSystem(`${e.name} waves.`);
        break;
      case 'ready':
        if (!e.resync) {
          this.enterMp(mp, this.joinName || 'Joined', 'You join the others in their world. Your pack starts empty.');
        } else if (mp.sim && mp.sim !== this.sim) {
          this.sim = mp.sim;
          this.view.setWorld(this.sim);
        }
        break;
      case 'failed':
        this.mp = null;
        this.mpJoining = false;
        this.mpMenu.showError(e.reason);
        this.refreshLobby(true);
        break;
      case 'ended':
        if (this.mpJoining) {
          this.mp = null;
          this.mpJoining = false;
          this.mpMenu.showError(e.reason);
          this.refreshLobby(true);
        } else {
          this.leaveMp(e.reason);
        }
        break;
      case 'hostAway':
        this.mpHud.setHostAway(e.away);
        break;
      case 'dawn':
        break;
    }
  }

  /** Leave (guest) or close (host) the server and go back to the single-player title screen. */
  private leaveMp(reason: string | null): void {
    const mp = this.mp;
    if (!mp) return;
    this.mp = null;
    this.mpJoining = false;
    this.mpDeathCause = null;
    if (!mp.ended) mp.leave();
    this.view.avatars.clear();
    this.mpHud.reset();
    this.screens.hidePause();
    this.screens.hideDeath();
    this.panels.close();
    const solo = this.solo;
    this.solo = null;
    if (solo) {
      this.sim = solo.sim;
      this.isPreview = solo.preview;
    }
    this.sim.timeScale = this.timeScale;
    this.view.setWorld(this.sim);
    this.syncCameraToPlayer();
    if (this.input.locked) {
      this.expectUnlock = true;
      this.input.exitLock();
    }
    this.mpMenu.setNotice(reason);
    this.showTitle();
  }

  private onMpDeath(cause: string): void {
    this.mpDeathCause = cause;
    this.death = null;
    this.mode = 'dead';
    this.deathT = 0;
    this.deathShown = false;
    this.panels.close();
    this.screens.hidePause();
    this.mpHud.closeChat();
    if (this.input.locked) {
      this.expectUnlock = true;
      this.input.exitLock();
    }
    this.sfx('death');
  }

  private respawnMp(): void {
    const mp = this.mp;
    if (!mp) return;
    mp.respawn();
    this.mpDeathCause = null;
    this.screens.hideDeath();
    this.hud.setVisible(true);
    this.mode = 'playing';
    this.syncCameraToPlayer();
    this.pose.roll = 0;
    this.lastWalked = this.sim.distanceWalked;
    this.panels.refresh();
    this.hud.showBanner('Back on your feet', 'A fresh start in the same world. Your old pack is where you fell.');
    this.input.requestLock();
  }

  private openChat(): void {
    if (!this.mp || this.mpJoining) return;
    this.input.releaseAll();
    this.dropCharge();
    if (this.input.locked) {
      this.expectUnlock = true;
      this.input.exitLock();
    }
    this.mpHud.openChat();
  }

  private closeChat(): void {
    if (!this.mpHud.chatting) return;
    this.mpHud.closeChat();
    if (this.mode === 'playing') this.input.requestLock();
  }

  private sendChat(text: string): void {
    if (this.mp?.sendChat(text) === 'slow') this.hud.toast('Easy there: one message a second.', 'warn');
  }

  /** Keeps a multiplayer world (and the connection) alive while the tab is hidden. */
  private backgroundTick(): void {
    const now = performance.now();
    const total = Math.min(1, (now - this.last) / 1000);
    this.last = now;
    if (total <= 0) return;
    this.time += total;
    if (this.mpInWorld) {
      const inp = this.idleInput();
      for (let t = total; t > 1e-6; t -= 0.1) this.sim.step(Math.min(0.1, t), inp);
      this.sim.takeEvents(this.events);
      for (const e of this.events) this.handleEvent(e);
    }
    if (this.mp) this.updateMp(total);
  }
}
