import { volumePercent } from '../audio/mix';
import type { BestRecord, DeathSummary, Settings } from '../sim/run';
import { formatDuration } from '../sim/time';
import { button, el, escapeHtml } from './dom';

export interface TitleInfo {
  continueLabel: string | null;
  best: BestRecord | null;
  deaths: number;
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
  onSettings(s: Settings): void;
  sfx(): void;
}

const CAUSES: Record<string, string> = {
  starvation: 'Hunger wore you down.',
  dehydration: 'You ran out of water.',
  cold: 'The cold crept in and never left.',
  wolf: 'A grey wolf caught you in the open.',
  bear: 'A black bear defended its territory.',
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
    this.lastTitle = info;
    this.confirmNewWorld = false;
    this.confirmNewRun = false;
    this.renderTitle();
    this.title.classList.add('show');
  }

  private renderTitle(): void {
    const info = this.lastTitle!;
    const t = this.title;
    t.innerHTML = '';
    const card = el('div', 'title-card');
    card.innerHTML = `<div class="logo">CozySurvival</div><div class="tagline">Stranded in the Pacific Northwest woods. Keep warm, keep fed, and see how many days you can last.</div>`;
    const actions = el('div', 'title-actions');
    if (info.continueLabel) {
      actions.append(button(`Continue <span class="btn-sub">${escapeHtml(info.continueLabel)}</span>`, 'btn primary big', () => {
        this.host.sfx();
        this.host.onContinue();
      }));
    }
    const newLabel = info.continueLabel ? (this.confirmNewRun ? 'Abandon current run and start over?' : 'New run') : 'Start surviving';
    actions.append(button(`${newLabel} <span class="btn-sub">Day 1 in this same forest</span>`, `btn ${info.continueLabel ? '' : 'primary'} big ${this.confirmNewRun ? 'danger' : ''}`, () => {
      this.host.sfx();
      if (info.continueLabel && !this.confirmNewRun) {
        this.confirmNewRun = true;
        this.renderTitle();
        return;
      }
      this.host.onNewRun();
    }));
    actions.append(button(this.confirmNewWorld ? 'Really wipe everything? Click again' : 'New world <span class="btn-sub">Fresh map · clears saves and records</span>', `btn subtle ${this.confirmNewWorld ? 'danger' : ''}`, () => {
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
    card.append(actions, meta, help);
    t.append(card);
  }

  hideTitle(): void {
    this.title.classList.remove('show');
  }

  showPause(): void {
    const p = this.pause;
    p.innerHTML = '';
    const card = el('div', 'pause-card');
    card.innerHTML = '<h2>Paused</h2>';
    const actions = el('div', 'title-actions');
    actions.append(button('Resume', 'btn primary big', () => {
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
    actions.append(button('Save and return to title', 'btn subtle', () => {
      this.host.sfx();
      this.host.onQuitToTitle();
    }));
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

  showDeath(d: DeathSummary, day: number): void {
    this.lastDeath = d;
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
    actions.append(button('Restart from day 1 <span class="btn-sub">Same forest · best record kept</span>', 'btn big', () => {
      this.host.sfx();
      this.host.onRestartDay1();
    }));
    actions.append(button(this.confirmScratch ? 'Wipe all saves and records? Click again' : 'Start from scratch <span class="btn-sub">New world · clears every save and record</span>', `btn subtle ${this.confirmScratch ? 'danger' : ''}`, () => {
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
