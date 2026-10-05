import { volumePercent } from '../audio/mix';
import type { BiomeId } from '../data/biomes';
import type { BestRecord, DeathSummary, Settings } from '../sim/run';
import { formatDuration } from '../sim/time';
import { button, el, escapeHtml } from './dom';
import { MenuModal } from './modal';
import type { MpStatus } from './multiplayer';

/** The title screen's map; selection is available in its Settings pop-up. */
export interface TitleMap {
  id: BiomeId;
  name: string;
  tagline: string;
  index: number;
  count: number;
  /** "forest", "desert" or "island", as in "Day 1 in this same forest". */
  place: string;
}

export interface TitleInfo {
  continueLabel: string | null;
  best: BestRecord | null;
  deaths: number;
  map: TitleMap;
}

export interface ScreenHost {
  onContinue(): void;
  onNewRun(): void;
  onNewWorld(): void;
  onMultiplayer(): void;
  onResume(): void;
  onQuitToTitle(): void;
  onRetryDay(): void;
  onRestartDay1(): void;
  onStartFromScratch(): void;
  /** Step to the previous (-1) or next (1) map from the title menu's Settings. */
  onSelectMap(step: -1 | 1): void;
  onSettings(s: Settings): void;
  onLeaveServer(): void;
  onRespawn(): void;
  sfx(): void;
}

/** In multiplayer the "pause" menu is only a settings overlay: the shared world keeps running. */
export interface MpPauseInfo {
  host: boolean;
  players: number;
}

const CAUSES: Record<string, string> = {
  starvation: 'Hunger wore you down.',
  dehydration: 'You ran out of water.',
  cold: 'The cold crept in and never left.',
  wolf: 'A grey wolf caught you in the open.',
  bear: 'A black bear defended its territory.',
  cougar: 'A mountain lion took you from behind.',
  snake: 'A rattlesnake bite finished you off.',
  spines: 'One cactus too many. The spines won.',
  scorpion: 'A scorpion sting was the last straw.',
  javelina: 'A javelina herd ran you down.',
  boar: 'A wild boar charged out of the jungle.',
  viper: "A fer-de-lance's venom did its work.",
  jellyfish: 'Box jellyfish stings in the shallows were too much.',
  shark: 'A tiger shark found you past the reef.',
  dev: 'Struck down by the developer.',
  unknown: 'The forest was too much this time.',
};

const CONTROLS = `
  <div class="controls-grid">
    <span>Move</span><b>W A S D</b>
    <span>Run</span><b>Shift</b>
    <span>Jump · climb onto rocks and logs</span><b>Space</b>
    <span>Swim</span><b>W A S D in deep water</b>
    <span>Look</span><b>Mouse</b>
    <span>Camera · first person / close / far</span><b>V</b>
    <span>Gather · use · interact</span><b>Left-click (hold to repeat)</b>
    <span>Tools</span><b>1–5 · mouse wheel</b>
    <span>Crafting</span><b>C</b>
    <span>Pack</span><b>Tab</b>
    <span>Show / hide Goals</span><b>K</b>
    <span>Quick eat / drink</span><b>F</b>
    <span>Rotate placement</span><b>R · wheel</b>
    <span>Cancel placement</span><b>Right-click · Q</b>
    <span>Mute</span><b>M</b>
    <span>Pause</span><b>Esc</b>
  </div>`;

const menuSvg = (body: string) => `<svg viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;
const MENU_ICONS = {
  play: menuSvg('<path d="m12 7 15 9-15 9z" fill="currentColor"/>'),
  tree: menuSvg('<path d="m16 2-7 10h4L6 22h8v8h4v-8h8l-7-10h4z" fill="currentColor"/>'),
  multiplayer: menuSvg('<circle cx="16" cy="10" r="5" fill="currentColor"/><path d="M7 28v-4a9 9 0 0 1 18 0v4z" fill="currentColor"/><circle cx="5" cy="14" r="3" fill="currentColor"/><circle cx="27" cy="14" r="3" fill="currentColor"/><path d="M1 25v-3a5 5 0 0 1 6-5M31 25v-3a5 5 0 0 0-6-5" stroke="currentColor" stroke-width="3" fill="none"/>'),
  settings: menuSvg('<path d="m14 3-1 4-4 2-4-1-2 4 3 3v3l-3 3 2 4 4-1 4 2 1 4h4l1-4 4-2 4 1 2-4-3-3v-3l3-3-2-4-4 1-4-2-1-4z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="16" r="4" fill="none" stroke="currentColor" stroke-width="2"/>'),
};

export class Screens {
  readonly title = el('div', 'screen title-screen');
  readonly pause = el('div', 'screen pause-screen');
  readonly death = el('div', 'screen death-screen');
  readonly sleep = el('div', 'sleep-overlay');
  readonly clickToPlay = el('div', 'click-to-play');
  readonly loading = el('div', 'loading-screen');
  private readonly host: ScreenHost;
  private settings: Settings;
  private confirmScratch = false;
  private lastTitle: TitleInfo | null = null;
  private lastDeath: DeathSummary | null = null;
  private deathPlace = 'forest';
  private confirmClose = false;
  private readonly titleModal: MenuModal;
  private titleDialog: 'new-run' | 'settings' | null = null;
  private mpStatus: MpStatus = { kind: 'unconfigured' };

  constructor(parent: HTMLElement, host: ScreenHost, settings: Settings) {
    this.host = host;
    this.settings = { ...settings };
    this.loading.innerHTML = '<div class="loading-inner"><div class="logo">CozySurvival</div><div class="loading-bar"><div></div></div><div class="loading-text">Growing the forest…</div></div>';
    this.clickToPlay.innerHTML = '<div class="ctp-inner">Click to continue</div>';
    parent.append(this.title, this.pause, this.death, this.sleep, this.clickToPlay, this.loading);
    this.titleModal = new MenuModal(parent, 'title-popup', () => this.closeTitleDialog());
  }

  hideLoading(): void {
    this.loading.classList.add('done');
    setTimeout(() => this.loading.remove(), 900);
  }

  showTitle(info: TitleInfo): void {
    const mapChanged = !!this.lastTitle && this.lastTitle.map.id !== info.map.id;
    const settingsOpen = mapChanged && this.titleDialog === 'settings';
    this.closeTitleDialog();
    this.lastTitle = info;
    this.renderTitle(mapChanged);
    this.title.classList.add('show');
    if (settingsOpen) this.showTitleSettings();
  }

  get titleShown(): boolean {
    return this.title.classList.contains('show');
  }

  private renderTitle(mapChanged = false): void {
    const info = this.lastTitle!;
    const t = this.title;
    t.innerHTML = '';
    const row = el('div', 'title-row');
    const card = el('div', `title-card${mapChanged ? ' map-changed' : ''}`);
    const m = info.map;
    card.innerHTML = `<div class="title-emblem"><img src="/ui/cozy-survival-logo.png" alt="" draggable="false"></div><h1 class="logo">CozySurvival</h1>
      <div class="map-pick" aria-live="polite"><span class="map-name">${escapeHtml(m.name)}</span></div>
      <div class="tagline">${escapeHtml(m.tagline)}</div>`;
    const actions = el('div', 'title-actions');
    const action = (id: string, label: string, icon: string, sub: string, onClick: () => void) => {
      const b = button(`<span class="menu-button-icon">${icon}</span><span class="menu-button-copy"><span class="menu-button-label">${label}</span>${sub ? `<span class="btn-sub">${sub}</span>` : ''}</span><span class="menu-button-arrow" aria-hidden="true">›</span>`, `btn title-menu-button title-${id}${id === 'continue' ? ' primary' : ''}`, () => {
        this.host.sfx();
        onClick();
      });
      b.dataset.action = id;
      actions.append(b);
      return b;
    };
    const resume = action('continue', 'Continue', MENU_ICONS.play, escapeHtml(info.continueLabel ?? 'No saved run'), () => this.host.onContinue());
    resume.disabled = !info.continueLabel;
    action('new-run', 'New Run', MENU_ICONS.tree, '', () => this.showNewRun());
    action('multiplayer', 'Multiplayer <span class="mp-pill"></span>', MENU_ICONS.multiplayer, `Play together in the ${escapeHtml(m.name)}.`, () => this.host.onMultiplayer());
    const settings = button(`${MENU_ICONS.settings}<span>Settings</span>`, 'btn subtle title-settings', () => {
      this.host.sfx();
      this.showTitleSettings();
    });
    card.append(actions, settings);
    row.append(card);
    t.append(row);
    this.setMultiplayerStatus(this.mpStatus);
  }

  setMultiplayerStatus(status: MpStatus): void {
    this.mpStatus = status;
    const pill = this.title.querySelector<HTMLElement>('.title-multiplayer .mp-pill');
    if (!pill) return;
    const online = status.kind === 'online';
    pill.className = `mp-pill ${online ? 'ok' : status.kind === 'checking' ? 'wait' : 'idle'}`;
    pill.textContent = online ? 'Online' : status.kind === 'checking' ? 'Connecting' : status.kind === 'outdated' ? 'Update needed' : status.kind === 'offline' ? 'Offline' : 'Unavailable';
  }

  get titlePopupOpen(): boolean {
    return this.titleModal.open;
  }

  private closeTitleDialog(): void {
    this.titleDialog = null;
    this.titleModal.close();
  }

  private titleDialogCard(title: string): HTMLElement {
    const overlay = this.titleModal.root;
    overlay.innerHTML = '';
    overlay.setAttribute('aria-labelledby', 'title-popup-heading');
    const card = el('div', 'menu-popup-card title-popup-card');
    card.innerHTML = `<h2 id="title-popup-heading">${title}</h2>`;
    overlay.append(card);
    return card;
  }

  private showNewRun(): void {
    this.titleDialog = 'new-run';
    const card = this.titleDialogCard('Start a new run?');
    const warning = this.lastTitle!.continueLabel ? 'Starting a new run will replace your current one. Are you sure?' : `Start a new run in the ${this.lastTitle!.map.name}?`;
    const note = el('p', 'menu-popup-note', escapeHtml(warning));
    note.id = 'new-run-warning';
    this.titleModal.root.setAttribute('aria-describedby', note.id);
    const actions = el('div', 'menu-popup-actions');
    const no = button('No', 'btn', () => {
      this.host.sfx();
      this.closeTitleDialog();
    });
    const yes = button('Yes', 'btn primary', () => {
      this.host.sfx();
      this.closeTitleDialog();
      this.host.onNewRun();
    });
    yes.dataset.action = 'confirm-new-run';
    no.dataset.action = 'cancel-new-run';
    actions.append(no, yes);
    card.append(note, actions);
    this.title.querySelector<HTMLElement>('.title-new-run')!.focus();
    this.titleModal.show(no);
  }

  private showTitleSettings(): void {
    this.titleDialog = 'settings';
    const card = this.titleDialogCard('Settings');
    this.titleModal.root.removeAttribute('aria-describedby');
    const map = this.lastTitle!.map;
    const mapPick = el('div', 'settings-map');
    const previous = button('‹', 'btn', () => { this.host.sfx(); this.host.onSelectMap(-1); });
    const next = button('›', 'btn', () => { this.host.sfx(); this.host.onSelectMap(1); });
    previous.classList.add('map-arrow', 'prev');
    next.classList.add('map-arrow', 'next');
    previous.setAttribute('aria-label', 'Previous map');
    next.setAttribute('aria-label', 'Next map');
    previous.disabled = next.disabled = map.count < 2;
    mapPick.append(previous, el('div', 'settings-map-name', `<span>Map</span><b>${escapeHtml(map.name)}</b>`), next);
    const help = el('details', 'title-help', `<summary>Controls</summary>${CONTROLS}`);
    const done = button('Done', 'btn primary', () => { this.host.sfx(); this.closeTitleDialog(); });
    const actions = el('div', 'menu-popup-actions');
    actions.append(done);
    card.append(mapPick, this.settingsPanel(), help, actions);
    this.title.querySelector<HTMLElement>('.title-settings')!.focus();
    this.titleModal.show(done);
  }

  hideTitle(): void {
    this.closeTitleDialog();
    this.title.classList.remove('show');
  }

  private settingsPanel(includeGoals = false): HTMLElement {
    const settings = el('div', 'settings');
    const s = this.settings;
    settings.innerHTML = `
      <label>Master volume <span class="vol-pct" data-pct="masterVolume">${s.muted ? 'Muted' : volumePercent(s.masterVolume)}</span><input type="range" min="0" max="1" step="0.05" value="${s.masterVolume}" data-k="masterVolume" aria-label="Master volume"></label>
      <label>Music <span class="vol-pct" data-pct="musicVolume">${volumePercent(s.musicVolume)}</span><input type="range" min="0" max="1" step="0.05" value="${s.musicVolume}" data-k="musicVolume" aria-label="Music volume"></label>
      <label>Effects <span class="vol-pct" data-pct="sfxVolume">${volumePercent(s.sfxVolume)}</span><input type="range" min="0" max="1" step="0.05" value="${s.sfxVolume}" data-k="sfxVolume" aria-label="Effects volume"></label>
      <label>Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.05" value="${s.sensitivity}" data-k="sensitivity"></label>
      <label class="check"><input type="checkbox" ${s.muted ? 'checked' : ''} data-k="muted"> Mute audio</label>
      <label class="check"><input type="checkbox" ${s.invertY ? 'checked' : ''} data-k="invertY"> Invert mouse Y</label>
      ${includeGoals ? `<label class="check"><input type="checkbox" ${s.showGoals ? 'checked' : ''} data-k="showGoals"> Show Goals (K)</label>` : ''}`;
    settings.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k as keyof Settings;
        if (k === 'muted' || k === 'invertY' || k === 'showGoals') this.settings[k] = inp.checked;
        else this.settings[k] = Number(inp.value);
        this.host.onSettings({ ...this.settings });
      });
    });
    return settings;
  }

  showPause(mp: MpPauseInfo | null = null): void {
    const p = this.pause;
    p.innerHTML = '';
    this.confirmClose = false;
    const card = el('div', 'pause-card');
    card.innerHTML = mp ? '<h2>Settings</h2><p class="pause-note">The world keeps running while this is open.</p>' : '<h2>Paused</h2>';
    const actions = el('div', 'title-actions');
    actions.append(button(mp ? 'Back to the game' : 'Resume', 'btn primary big', () => {
      this.host.sfx();
      this.host.onResume();
    }));
    const settings = this.settingsPanel(true);
    const help = el('details', 'title-help');
    help.innerHTML = `<summary>Controls</summary>${CONTROLS}`;
    if (mp) {
      const others = mp.players - 1;
      const closeLabel = () => this.confirmClose
        ? `Close the server for ${others === 1 ? 'the other player' : `all ${others} other players`}? Click again`
        : 'Close server <span class="btn-sub">Ends the world for everyone · not saved</span>';
      const leave = button(mp.host ? closeLabel() : 'Leave server <span class="btn-sub">Back to your own single-player world</span>', 'btn subtle', () => {
        this.host.sfx();
        if (mp.host && others > 0 && !this.confirmClose) {
          this.confirmClose = true;
          leave.innerHTML = closeLabel();
          leave.classList.add('danger');
          return;
        }
        this.host.onLeaveServer();
      });
      actions.append(leave);
    } else {
      actions.append(button('Save and return to title', 'btn subtle', () => {
        this.host.sfx();
        this.host.onQuitToTitle();
      }));
    }
    card.append(actions, settings, help);
    p.append(card);
    p.classList.add('show');
  }

  hidePause(): void {
    this.pause.classList.remove('show');
  }

  /** Keep both settings menus in step with changes made elsewhere (e.g. the M key). */
  syncSettings(s: Settings): void {
    this.settings = { ...s };
    [this.pause, this.titleModal.root].flatMap(root => [...root.querySelectorAll<HTMLInputElement>('.settings input')]).forEach((inp) => {
      const k = inp.dataset.k as keyof Settings;
      if (k === 'muted' || k === 'invertY' || k === 'showGoals') inp.checked = s[k];
      else if (document.activeElement !== inp) inp.value = String(s[k]);
    });
    [this.pause, this.titleModal.root].flatMap(root => [...root.querySelectorAll<HTMLElement>('.vol-pct')]).forEach((pct) => {
      const k = pct.dataset.pct as 'masterVolume' | 'musicVolume' | 'sfxVolume';
      pct.textContent = k === 'masterVolume' && s.muted ? 'Muted' : volumePercent(s[k]);
    });
  }

  showDeath(d: DeathSummary, day: number, place = 'forest'): void {
    this.lastDeath = d;
    this.deathPlace = place;
    this.confirmScratch = false;
    this.renderDeath(day);
    this.death.classList.add('show');
  }

  private renderDeath(day: number): void {
    const d = this.lastDeath!;
    const p = this.death;
    p.innerHTML = '';
    const card = el('div', 'death-card');
    const survived = formatDuration(d.hours);
    card.innerHTML = `
      <div class="death-kicker">The run is over</div>
      <h2>${escapeHtml(CAUSES[d.cause] ?? CAUSES.unknown)}</h2>
      <div class="death-stats">
        <div><span>Survived</span><b>${escapeHtml(survived)}</b></div>
        <div><span>Reached</span><b>Day ${d.day}</b></div>
        <div class="${d.newBest ? 'best' : ''}"><span>${d.newBest ? 'New personal best!' : 'Best record'}</span><b>${d.best ? escapeHtml(formatDuration(d.best.hours)) : '-'}</b></div>
      </div>`;
    const actions = el('div', 'death-actions');
    actions.append(button(`Retry the day <span class="btn-sub">Back to the morning of day ${day}</span>`, 'btn primary big', () => {
      this.host.sfx();
      this.host.onRetryDay();
    }));
    actions.append(button(`Restart from day 1 <span class="btn-sub">Same ${escapeHtml(this.deathPlace)} · best record kept</span>`, 'btn big', () => {
      this.host.sfx();
      this.host.onRestartDay1();
    }));
    actions.append(button(this.confirmScratch ? `Wipe this map's save and records? Click again` : `Start from scratch <span class="btn-sub">New world · clears this map's save and records</span>`, `btn subtle ${this.confirmScratch ? 'danger' : ''}`, () => {
      this.host.sfx();
      if (!this.confirmScratch) {
        this.confirmScratch = true;
        this.renderDeath(day);
        return;
      }
      this.host.onStartFromScratch();
    }));
    card.append(actions);
    p.append(card);
  }

  /** Multiplayer death: the pack stays behind as a pile and the player can jump straight back in. */
  showMpDeath(cause: string, host: boolean): void {
    const p = this.death;
    p.innerHTML = '';
    const card = el('div', 'death-card');
    card.innerHTML = `
      <div class="death-kicker">You died</div>
      <h2>${escapeHtml(CAUSES[cause] ?? CAUSES.unknown)}</h2>
      <p class="death-note">Your pack spilled where you fell. Anyone can loot the pile, you included.</p>`;
    const actions = el('div', 'death-actions');
    actions.append(button('Respawn <span class="btn-sub">Fresh start: empty pack, full needs, new skills</span>', 'btn primary big', () => {
      this.host.sfx();
      this.host.onRespawn();
    }));
    actions.append(button(host ? 'Close server <span class="btn-sub">Ends the world for everyone</span>' : 'Leave server', 'btn subtle', () => {
      this.host.sfx();
      this.host.onLeaveServer();
    }));
    card.append(actions);
    p.append(card);
    p.classList.add('show');
  }

  hideDeath(): void {
    this.death.classList.remove('show');
  }

  /** Fade to black, show the new day, fade back. Resolves when the screen is clear again. */
  playSleep(day: number, text: string): Promise<void> {
    this.sleep.innerHTML = `<div class="sleep-inner"><div class="sleep-day">Day ${day}</div><div class="sleep-text">${escapeHtml(text)}</div></div>`;
    this.sleep.classList.remove('out');
    this.sleep.classList.add('show');
    return new Promise((resolve) => {
      setTimeout(() => {
        this.sleep.classList.add('out');
        setTimeout(() => {
          this.sleep.classList.remove('show', 'out');
          resolve();
        }, 1100);
      }, 2600);
    });
  }

  setClickToPlay(v: boolean): void {
    this.clickToPlay.classList.toggle('show', v);
  }
}
