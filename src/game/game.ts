import { clamp, damp } from '../core/math';
import { BALANCE } from '../data/balance';
import { ITEMS, TOOLS, itemName, type ItemId } from '../data/items';
import { OBJECTIVES } from '../data/objectives';
import { PLACE_ROTATE_BIG_STEP, PLACE_ROTATE_STEP, PREFABS } from '../data/prefabs';
import { RECIPE_BY_ID } from '../data/recipes';
import { SPECIES } from '../data/species';
import { AudioSystem, type Sfx } from '../audio/audio';
import { volumePercent } from '../audio/mix';
import type { SimEvent } from '../sim/events';
import { PLACEMENT_REASON_TEXT } from '../sim/placement';
import { browserStorage, RunManager, type DeathSummary, type Settings } from '../sim/run';
import { IDLE_INPUT, Simulation, type SimInput } from '../sim/simulation';
import { formatClock, hoursSurvived } from '../sim/time';
import { GameView, type CameraPose } from '../render/view';
import type { ViewModelInput } from '../render/viewmodel';
import { DevPanel, TIME_SCALES } from '../ui/dev';
import { effectSummary, Hud } from '../ui/hud';
import { itemIcon, toolIcon } from '../ui/icons';
import { Panels } from '../ui/panels';
import { Screens } from '../ui/screens';
import { EscapeRouter, type UiMode } from './escape';
import { Input } from './input';

type Mode = UiMode;

const BASE_FOV = 72;
const AUTOSAVE_SECONDS = 30;
const LOOK_SPEED = 0.0022;

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
      onSettings: (s) => this.applySettings(s),
      sfx: () => {
        this.audio.start();
        this.sfx('click');
      },
    }, this.settings);
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
        if (this.mode === 'playing') this.pause();
      }
    });
    window.addEventListener('pagehide', () => this.saveNow());

    const current = this.run.loadCurrent();
    this.sim = current ?? Simulation.newGame(this.run.meta.worldSeed);
    this.isPreview = !current;
    this.view.setWorld(this.sim);
    this.syncCameraToPlayer();
    this.audio.setVolume(this.settings.masterVolume, this.settings.muted);
    this.hud.setVisible(false);
    if (current && current.state.dead) {
      this.isPreview = false;
      const hours = hoursSurvived(current.state.totalHours);
      this.death = { cause: current.state.deathCause ?? 'unknown', hours, day: current.day, best: this.run.meta.best, newBest: false };
      this.mode = 'dead';
      this.deathT = 10;
      this.deathShown = true;
      this.screens.showDeath(this.death, this.run.snapshotDay() ?? current.day);
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
    this.screens.showTitle({
      continueLabel: alive ? `Day ${this.sim.day} · ${formatClock(this.sim.hour)}` : null,
      best: this.run.meta.best,
      deaths: this.run.meta.deaths,
    });
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
      this.hud.showBanner(`Day ${sim.day}`, 'Stranded, but the forest provides. Start by gathering sticks and stones.');
    }
  }

  private retryDay(): void {
    const sim = this.run.retryDay();
    this.beginPlay(sim, false);
    this.hud.showBanner(`Day ${sim.day}`, 'Back to this morning. The forest remembers nothing.');
  }

  private pause(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.saveNow();
    this.screens.syncSettings(this.settings);
    this.screens.showPause();
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

  private openPanel(kind: 'inventory' | 'crafting', fireId?: number): void {
    if (this.mode !== 'playing' && this.mode !== 'panel') return;
    this.sim.cancelPlacement();
    this.sim.bowDraw = -1;
    if (this.dev?.open) this.dev.toggle();
    this.panels.open(kind, { fireId });
    if (kind === 'crafting') this.hud.clearNewRecipes();
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
    if (code === 'Tab') this.openPanel('inventory');
    else if (code === 'KeyC') this.openPanel('crafting');
    else if (code === 'KeyF') sim.quickConsume();
    else if (code === 'KeyR' && sim.placement) sim.rotatePlacement(ev.shiftKey ? -PLACE_ROTATE_BIG_STEP : PLACE_ROTATE_BIG_STEP);
    else if (code === 'KeyQ' && sim.placement) {
      sim.cancelPlacement();
      this.hud.toast('Placement cancelled');
    } else if (code === 'KeyT' && this.dev) {
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
    this.audio.setVolume(s.masterVolume, s.muted);
    this.screens.syncSettings(s);
  }

  private saveNow(): void {
    if (this.isPreview) return;
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
    const sim = this.sim;
    const input = this.input;

    const playing = this.mode === 'playing' && input.locked;
    this.screens.setClickToPlay(this.mode === 'playing' && !input.locked);
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
    }

    sim.takeEvents(this.events);
    if (this.events.length) {
      for (const e of this.events) this.handleEvent(e);
      if (!this.isPreview) {
        const summary = this.run.handleEvents(sim, this.events);
        if (summary) this.onDeath(summary);
      }
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
    vm.draw = sim.bowDraw >= 0 ? Math.min(1, sim.bowDraw / BALANCE.combat.bow.fullDraw) : -1;
    vm.sitting = ps.sitting;
    vm.hasArrows = sim.state.inventory.slots.some((s) => s?.item === 'arrow');
    this.view.showViewModel = this.mode !== 'title' && this.mode !== 'dead' && !sim.placement;
    this.view.frame(sim, dt, this.time, this.pose, vm);

    if (this.mode !== 'title') this.hud.update(sim, dt, this.timeScale);
    this.hud.setFps(this.fpsOn ? this.fpsAvg : null);
    this.updateAudio(dt);
    if (this.mode === 'dead') {
      this.deathT += dt;
      if (!this.deathShown && this.deathT > 1.8 && this.death) {
        this.deathShown = true;
        this.hud.setVisible(false);
        this.screens.showDeath(this.death, this.run.snapshotDay() ?? sim.day);
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
      case 'treeFell':
        this.sfx('treeFall');
        setTimeout(() => (this.shake = Math.max(this.shake, 0.7)), 1700);
        this.hud.toast('Timber!', 'good');
        break;
      case 'needTool':
        this.throttledToast('needTool', e.message, 'warn', 2.5);
        this.sfx('deny');
        break;
      case 'learned': {
        const r = RECIPE_BY_ID[e.recipe];
        const o = r.output;
        const icon = o.kind === 'item' ? itemIcon(o.item) : o.kind === 'tool' ? toolIcon(o.tool) : '';
        this.hud.toast(`New recipe: ${r.name}. ${r.learnHint}`, 'learn', icon);
        this.hud.noteNewRecipe();
        this.sfx('learned');
        this.panels.refresh();
        break;
      }
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
        const done = OBJECTIVES[e.index];
        const next = OBJECTIVES[e.index + 1];
        this.hud.showBanner(`${done.title}`, next ? `Next: ${next.title}` : 'You have the basics. Now: survive as many days as you can.');
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
        this.openPanel('crafting', e.structure);
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
        break;
      case 'dayStart':
        if (e.day !== this.lastDay) {
          this.lastDay = e.day;
          if (this.mode !== 'sleeping') {
            this.hud.showBanner(`Day ${e.day}`, e.day >= 2 ? 'Morning mist over the lake. Bears wander these woods now.' : 'A new morning in the forest.');
            this.sfx('dawn');
          }
        }
        break;
      case 'nightfall':
        this.hud.showBanner('Night falls', 'Stay close to your fire. Wolves hunt in the dark; a torch keeps them at bay.');
        this.sfx('nightfall');
        break;
      case 'slept':
        this.sleepTransition(e.day);
        break;
      case 'sleepDenied':
        this.throttledToast('sleep', e.reason, 'warn', 2);
        this.sfx('deny');
        break;
      case 'animalHit': {
        this.sfx('hit');
        const col = e.species === 'bear' ? '#2a2420' : e.species === 'wolf' ? '#8e8a83' : e.species === 'fish' ? '#cfe6f2' : '#8a6d52';
        if (e.species === 'fish') fx.splash(e.x, 0, e.z, 16);
        else fx.fur(e.x, e.y, e.z, col, e.killed ? 18 : 8);
        if (e.killed && e.species !== 'fish') this.hud.toast(`You brought down a ${SPECIES[e.species].name}. Click it to butcher.`, 'good');
        break;
      }
      case 'animalFlee':
        if (e.species === 'deer') this.throttledToast('deer', 'The deer bolted. They spook from far away; try a bow.', 'info', 60);
        break;
      case 'predatorAlert': {
        const d = Math.hypot(e.x - p.x, e.z - p.z);
        const k = clamp(1 - d / 40, 0.2, 1);
        if (e.species === 'wolf') {
          this.sfx('howl', k);
          this.throttledToast('wolf', 'A grey wolf is stalking you. Stand by your fire or raise a torch.', 'warn', 25);
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

  private sleepTransition(day: number): void {
    this.sfx('sleep');
    this.mode = 'sleeping';
    this.sim.cancelPlacement();
    void this.screens.playSleep(day, 'You drift off to the crackle of the fire and wake at first light, fully rested.').then(() => {
      if (this.mode === 'sleeping') {
        this.mode = 'playing';
        this.hud.showBanner(`Day ${day}`, 'Rested and ready. The forest is waking up.');
        this.sfx('dawn');
      }
    });
  }
}
