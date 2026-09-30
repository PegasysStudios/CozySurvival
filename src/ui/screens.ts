import { volumePercent } from '../audio/mix';
import type { BiomeId } from '../data/biomes';
import type { BestRecord, DeathSummary, Settings } from '../sim/run';
import { formatDuration } from '../sim/time';
import { button, el, escapeHtml } from './dom';

/** The map shown on the title screen; the arrows cycle through `count` maps. */
export interface TitleMap {
  id: BiomeId;
  name: string;
  tagline: string;
  index: number;
  count: number;
  /** "forest" or "desert", as in "Day 1 in this same forest". */
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
  onResume(): void;
  onQuitToTitle(): void;
  onRetryDay(): void;
  onRestartDay1(): void;
  onStartFromScratch(): void;
  /** Step to the previous (-1) or next (1) map on the title screen. */
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
    <span>Gather · use · interact</span><b>Left-click (hold to repeat)</b>
    <span>Tools</span><b>1–5 · mouse wheel</b>
    <span>Crafting</span><b>C</b>
    <span>Pack</span><b>Tab</b>
    <span>Quick eat / drink</span><b>F</b>
    <span>Rotate placement</span><b>R · wheel</b>
    <span>Cancel placement</span><b>Right-click · Q</b>
    <span>Mute</span><b>M</b>
    <span>Pause</span><b>Esc</b>
  </div>`;

function bestLine(best: BestRecord | null): string {
  return best ? `Best run: ${formatDuration(best.hours)} · reached day ${best.day}` : 'No runs recorded yet';
}

export class Screens {
  readonly title = el('div', 'screen title-screen');
  readonly pause = el('div', 'screen pause-screen');
  readonly death = el('div', 'screen death-screen');
  readonly sleep = el('div', 'sleep-overlay');
  readonly clickToPlay = el('div', 'click-to-play');
  readonly loading = el('div', 'loading-screen');
  private readonly host: ScreenHost;
  private settings: Settings;
  private confirmNewWorld = false;
  private confirmScratch = false;
  private confirmNewRun = false;
  private lastTitle: TitleInfo | null = null;
  private lastDeath: DeathSummary | null = null;
  private deathPlace = 'forest';
  private titleExtra: HTMLElement | null = null;
  private confirmClose = false;

  constructor(parent: HTMLElement, host: ScreenHost, settings: Settings) {
    this.host = host;
    this.settings = { ...settings };
    this.loading.innerHTML = '<div class="loading-inner"><div class="logo">CozySurvival</div><div class="loading-bar"><div></div></div><div class="loading-text">Growing the forest…</div></div>';
    this.clickToPlay.innerHTML = '<div class="ctp-inner">Click to continue</div>';
    parent.append(this.title, this.pause, this.death, this.sleep, this.clickToPlay, this.loading);
  }

  hideLoading(): void {
    this.loading.classList.add('done');
    setTimeout(() => this.loading.remove(), 900);
  }

  showTitle(info: TitleInfo): void {
    const mapChanged = !!this.lastTitle && this.lastTitle.map.id !== info.map.id;
    this.lastTitle = info;
    this.confirmNewWorld = false;
    this.confirmNewRun = false;
    this.renderTitle(mapChanged);
    this.title.classList.add('show');
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
    const dots = Array.from({ length: m.count }, (_, i) => `<i class="${i === m.index ? 'on' : ''}"></i>`).join('');
    card.innerHTML = `<div class="logo">CozySurvival</div>
      <div class="map-pick" aria-live="polite"><span class="map-name">${escapeHtml(m.name)}</span><span class="map-dots" aria-label="Map ${m.index + 1} of ${m.count}">${dots}</span></div>
      <div class="tagline">${escapeHtml(m.tagline)}</div>`;
    const arrow = (step: -1 | 1) => {
      const b = button(step < 0 ? '&#8249;' : '&#8250;', `map-arrow ${step < 0 ? 'prev' : 'next'}`, () => {
        this.host.sfx();
        this.host.onSelectMap(step);
      });
      b.setAttribute('aria-label', step < 0 ? 'Previous map' : 'Next map');
      b.dataset.map = step < 0 ? 'prev' : 'next';
      b.disabled = m.count < 2;
      return b;
    };
    const actions = el('div', 'title-actions');
    if (info.continueLabel) {
      actions.append(button(`Continue <span class="btn-sub">${escapeHtml(info.continueLabel)}</span>`, 'btn primary big', () => {
        this.host.sfx();
        this.host.onContinue();
      }));
    }
    const newLabel = info.continueLabel ? (this.confirmNewRun ? 'Abandon current run and start over?' : 'New run') : 'Start surviving';
    actions.append(button(`${newLabel} <span class="btn-sub">Day 1 in this same ${escapeHtml(m.place)}</span>`, `btn ${info.continueLabel ? '' : 'primary'} big ${this.confirmNewRun ? 'danger' : ''}`, () => {
      this.host.sfx();
      if (info.continueLabel && !this.confirmNewRun) {
        this.confirmNewRun = true;
        this.renderTitle();
        return;
      }
      this.host.onNewRun();
    }));
    actions.append(button(this.confirmNewWorld ? `Really wipe this map's save and records? Click again` : `New world <span class="btn-sub">Fresh ${escapeHtml(m.name)} map · clears its save and records</span>`, `btn subtle ${this.confirmNewWorld ? 'danger' : ''}`, () => {
      this.host.sfx();
      if (!this.confirmNewWorld) {
        this.confirmNewWorld = true;
        this.renderTitle();
        return;
      }
      this.host.onNewWorld();
    }));
    const meta = el('div', 'title-meta', `${escapeHtml(bestLine(info.best))}${info.deaths ? ` · ${info.deaths} run${info.deaths === 1 ? '' : 's'} ended` : ''}`);
    const help = el('details', 'title-help');
    help.innerHTML = `<summary>Controls</summary>${CONTROLS}`;
    card.append(actions, meta);
    if (this.titleExtra) card.append(this.titleExtra);
    card.append(help);
    row.append(arrow(-1), card, arrow(1));
    t.append(row);
  }

  /** Extra block on the title card (the multiplayer section); kept across re-renders. */
  setTitleExtra(e: HTMLElement): void {
    this.titleExtra = e;
    if (this.lastTitle) this.renderTitle();
  }

  hideTitle(): void {
    this.title.classList.remove('show');
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
    const settings = el('div', 'settings');
    const s = this.settings;
    settings.innerHTML = `
      <label>Master volume <span class="vol-pct" data-pct="masterVolume">${s.muted ? 'Muted' : volumePercent(s.masterVolume)}</span><input type="range" min="0" max="1" step="0.05" value="${s.masterVolume}" data-k="masterVolume" aria-label="Master volume"></label>
      <label>Music <span class="vol-pct" data-pct="musicVolume">${volumePercent(s.musicVolume)}</span><input type="range" min="0" max="1" step="0.05" value="${s.musicVolume}" data-k="musicVolume" aria-label="Music volume"></label>
      <label>Effects <span class="vol-pct" data-pct="sfxVolume">${volumePercent(s.sfxVolume)}</span><input type="range" min="0" max="1" step="0.05" value="${s.sfxVolume}" data-k="sfxVolume" aria-label="Effects volume"></label>
      <label>Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.05" value="${s.sensitivity}" data-k="sensitivity"></label>
      <label class="check"><input type="checkbox" ${s.muted ? 'checked' : ''} data-k="muted"> Mute audio</label>
      <label class="check"><input type="checkbox" ${s.invertY ? 'checked' : ''} data-k="invertY"> Invert mouse Y</label>`;
    settings.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k as keyof Settings;
        if (k === 'muted' || k === 'invertY') this.settings[k] = inp.checked;
        else this.settings[k] = Number(inp.value);
        this.host.onSettings({ ...this.settings });
      });
    });
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

  /** Keep the pause-menu controls in step with settings changed elsewhere (e.g. the M key). */
  syncSettings(s: Settings): void {
    this.settings = { ...s };
    this.pause.querySelectorAll<HTMLInputElement>('.settings input').forEach((inp) => {
      const k = inp.dataset.k as keyof Settings;
      if (k === 'muted' || k === 'invertY') inp.checked = s[k];
      else if (document.activeElement !== inp) inp.value = String(s[k]);
    });
    this.pause.querySelectorAll<HTMLElement>('.vol-pct').forEach((pct) => {
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
