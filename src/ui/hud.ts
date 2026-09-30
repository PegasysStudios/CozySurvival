import { BALANCE } from '../data/balance';
import { ITEMS, TOOLS, TOOL_ORDER, itemName, type ItemId, type ToolId } from '../data/items';
import { FREEPLAY_OBJECTIVE, OBJECTIVES } from '../data/objectives';
import { PREFABS } from '../data/prefabs';
import { toolWears, wearFraction } from '../sim/durability';
import { PLACEMENT_REASON_TEXT } from '../sim/placement';
import type { Simulation } from '../sim/simulation';
import { countItem, usedSlots } from '../sim/inventory';
import type { GameState } from '../sim/state';
import { formatClock } from '../sim/time';
import { el, escapeHtml, setHtml, setText, toggle } from './dom';
import { itemIcon, MISC_ICONS, NEED_ICONS, toolIcon } from './icons';

type NeedKey = 'health' | 'hunger' | 'thirst' | 'warmth' | 'energy';
const NEEDS: { key: NeedKey; label: string }[] = [
  { key: 'health', label: 'Health' },
  { key: 'hunger', label: 'Hunger' },
  { key: 'thirst', label: 'Thirst' },
  { key: 'warmth', label: 'Warmth' },
  { key: 'energy', label: 'Energy' },
];

/** Ammo carried for a tool that uses it (arrows for the bow), or null for tools without ammo. */
export function toolAmmo(s: GameState, tool: ToolId): number | null {
  return tool === 'bow' ? countItem(s.inventory, 'arrow') : null;
}

/** The hotbar: one slot per tool with its key, icon, name, durability and (for the bow) arrow count. */
export function toolBeltHtml(s: GameState): string {
  return TOOL_ORDER.map((id) => {
    const owned = s.tools.includes(id);
    const active = s.activeTool === id;
    const w = owned ? s.toolWear[id] : undefined;
    const pct = w ? Math.round(wearFraction(w) * 100) : null;
    const dur = pct === null && !(owned && toolWears(id)) ? '' : `<span class="dur ${pct !== null && pct <= BALANCE.durability.lowFraction * 100 ? 'low' : ''}"><i style="transform:scaleX(${(pct ?? 100) / 100})"></i></span>`;
    const ammo = owned ? toolAmmo(s, id) : null;
    const ammoHtml = ammo === null ? '' : `<span class="ammo ${ammo === 0 ? 'empty' : ''}">${ammo}</span>`;
    const title = `${TOOLS[id].name}${owned && toolWears(id) ? ` · ${pct ?? 100}% durability` : ''}${ammo === null ? '' : ` · ${ammo} ${itemName('arrow', ammo).toLowerCase()}`}`;
    return `<div class="tool ${owned ? '' : 'locked'} ${active ? 'active' : ''}" title="${title}"><span class="key">${TOOLS[id].slot}</span>${ammoHtml}${owned ? toolIcon(id) : `<span class="lock">${MISC_ICONS.lock}</span>`}<span class="tool-name">${owned ? TOOLS[id].name : '???'}</span>${dur}</div>`;
  }).join('');
}

interface Toast {
  el: HTMLElement;
  key: string | null;
  count: number;
  t: number;
}

export class Hud {
  readonly root = el('div', 'hud');
  private readonly clockDay = el('div', 'clock-day');
  private readonly clockTime = el('div', 'clock-time');
  private readonly clockIcon = el('div', 'clock-icon');
  private readonly clockBar = el('div', 'clock-bar-fill');
  private readonly devBadge = el('div', 'dev-badge');
  private readonly objTitle = el('div', 'obj-title');
  private readonly objHint = el('div', 'obj-hint');
  private readonly objProgress = el('div', 'obj-progress');
  private readonly objStep = el('div', 'obj-step');
  private readonly objective = el('div', 'hud-objective');
  private readonly bars = new Map<NeedKey, { row: HTMLElement; fill: HTMLElement; value: HTMLElement; last: number }>();
  private readonly chips = el('div', 'status-chips');
  private readonly chipKey: { last?: string } = {};
  private readonly belt = el('div', 'toolbelt');
  private readonly beltKey: { last?: string } = {};
  private readonly pack = el('div', 'pack-count');
  private readonly crosshair = el('div', 'crosshair');
  private readonly charge = el('div', 'bow-charge');
  private readonly prompt = el('div', 'prompt');
  private readonly promptKey: { last?: string } = {};
  private readonly placeHelp = el('div', 'place-help');
  private readonly placeKey: { last?: string } = {};
  private readonly toasts = el('div', 'toasts');
  private readonly toastList: Toast[] = [];
  private readonly banner = el('div', 'banner');
  private bannerT = 0;
  private readonly hurt = el('div', 'vignette hurt');
  private readonly cold = el('div', 'vignette cold');
  private readonly low = el('div', 'vignette low');
  private readonly damageDir = el('div', 'damage-dir');
  private hurtT = 0;
  private readonly hint = el('div', 'controls-hint');
  private hintT = 0;
  private readonly fps = el('div', 'fps');
  private readonly craftBadge = el('div', 'craft-badge');
  private newRecipes = 0;
  private uiTimer = 0;

  constructor(parent: HTMLElement) {
    const clock = el('div', 'hud-clock');
    const clockText = el('div', 'clock-text');
    clockText.append(this.clockDay, this.clockTime);
    const clockBar = el('div', 'clock-bar');
    clockBar.append(this.clockBar);
    clock.append(this.clockIcon, clockText, this.devBadge, clockBar);

    const objLabel = el('div', 'obj-label', 'Next goal');
    objLabel.append(this.objStep);
    this.objective.append(objLabel, this.objTitle, this.objHint, this.objProgress);

    const needs = el('div', 'hud-needs');
    needs.append(this.chips);
    for (const n of NEEDS) {
      const row = el('div', `need need-${n.key}`);
      const icon = el('div', 'need-icon', NEED_ICONS[n.key]);
      const track = el('div', 'need-track');
      const fill = el('div', 'need-fill');
      track.append(fill);
      const value = el('div', 'need-value');
      row.title = n.label;
      row.append(icon, track, value);
      needs.append(row);
      this.bars.set(n.key, { row, fill, value, last: -1 });
    }

    const bottom = el('div', 'hud-bottom');
    const packWrap = el('div', 'pack-wrap');
    packWrap.append(this.pack, this.craftBadge);
    bottom.append(this.belt, packWrap);

    const center = el('div', 'hud-center');
    center.append(this.crosshair, this.charge, this.prompt, this.placeHelp);

    this.hint.innerHTML = `
      <div><b>WASD</b> move and swim · <b>Shift</b> run · <b>Space</b> jump</div>
      <div><b>Left-click</b> gather, use and interact</div>
      <div><b>C</b> crafting · <b>Tab</b> pack · <b>1–6</b> tools · <b>F</b> quick eat</div>`;

    this.root.append(this.hurt, this.cold, this.low, this.damageDir, clock, this.objective, needs, bottom, center, this.toasts, this.banner, this.hint, this.fps);
    parent.append(this.root);
  }

  showControlsHint(): void {
    this.hintT = 22;
    this.hint.classList.add('show');
  }

  setFps(fps: number | null): void {
    toggle(this.fps, 'show', fps !== null);
    if (fps !== null) setText(this.fps, `${Math.round(fps)} fps`);
  }

  noteNewRecipe(): void {
    this.newRecipes++;
    this.craftBadge.textContent = `${this.newRecipes} new recipe${this.newRecipes === 1 ? '' : 's'} · C`;
    this.craftBadge.classList.add('show');
  }

  clearNewRecipes(): void {
    this.newRecipes = 0;
    this.craftBadge.classList.remove('show');
  }

  toast(text: string, tone: 'info' | 'good' | 'warn' | 'learn' = 'info', icon = '', key: string | null = null, count = 0): void {
    if (key) {
      const existing = this.toastList.find((t) => t.key === key);
      if (existing) {
        existing.count += count;
        existing.t = 2.6;
        existing.el.querySelector('.toast-text')!.textContent = text.replace('{n}', String(existing.count));
        existing.el.classList.remove('bump');
        void existing.el.offsetWidth;
        existing.el.classList.add('bump');
        return;
      }
    }
    const e = el('div', `toast ${tone}`);
    e.innerHTML = `${icon ? `<span class="toast-icon">${icon}</span>` : ''}<span class="toast-text"></span>`;
    e.querySelector('.toast-text')!.textContent = text.replace('{n}', String(count));
    this.toasts.prepend(e);
    this.toastList.push({ el: e, key, count, t: tone === 'learn' ? 5.5 : tone === 'warn' ? 3.6 : 2.6 });
    while (this.toastList.length > 6) {
      const old = this.toastList.shift()!;
      old.el.remove();
    }
  }

  gathered(item: ItemId, count: number): void {
    this.toast(`+{n} ${ITEMS[item].plural}`, 'info', itemIcon(item), 'g-' + item, count);
  }

  showBanner(title: string, sub: string): void {
    this.banner.innerHTML = `<div class="banner-title">${escapeHtml(title)}</div><div class="banner-sub">${escapeHtml(sub)}</div>`;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerT = 4;
  }

  /** Red flash plus an arc pointing toward the attacker (angle relative to view, radians). */
  flashHurt(amount: number, relAngle: number | null): void {
    this.hurtT = Math.min(1, 0.35 + amount / 30);
    if (relAngle !== null) {
      this.damageDir.style.setProperty('--a', `${relAngle}rad`);
      this.damageDir.classList.remove('show');
      void this.damageDir.offsetWidth;
      this.damageDir.classList.add('show');
    }
  }

  update(sim: Simulation, dt: number, timeScale: number): void {
    const s = sim.state;
    this.hurtT = Math.max(0, this.hurtT - dt * 1.6);
    this.hurt.style.opacity = this.hurtT.toFixed(3);
    for (let i = this.toastList.length - 1; i >= 0; i--) {
      const t = this.toastList[i];
      t.t -= dt;
      if (t.t <= 0.35) t.el.classList.add('out');
      if (t.t <= 0) {
        t.el.remove();
        this.toastList.splice(i, 1);
      }
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.classList.remove('show');
    }
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.hint.classList.remove('show');
    }

    this.updateCenter(sim);

    this.uiTimer -= dt;
    if (this.uiTimer > 0) return;
    this.uiTimer = 0.1;

    const n = s.needs;
    for (const def of NEEDS) {
      const b = this.bars.get(def.key)!;
      const v = n[def.key];
      if (Math.abs(v - b.last) >= 0.25) {
        b.last = v;
        b.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, v / 100)).toFixed(3)})`;
        setText(b.value, String(Math.round(v)));
      }
      toggle(b.row, 'low', v < 25);
      toggle(b.row, 'critical', v < 10);
    }
    toggle(this.bars.get('energy')!.row, 'exhausted', n.exhausted);
    this.cold.style.opacity = Math.max(0, (30 - n.warmth) / 30).toFixed(2);
    this.low.style.opacity = Math.max(0, (35 - n.health) / 35).toFixed(2);

    const chips: string[] = [];
    if (sim.isNearLitFire(BALANCE.needs.fireWarmRadius)) chips.push('<span class="chip warm">By the fire</span>');
    if (sim.nearestStructure((id) => !!PREFABS[id].shelter, BALANCE.needs.shelterWarmRadius)) chips.push('<span class="chip">Sheltered</span>');
    if (s.player.sitting) chips.push('<span class="chip good">Resting</span>');
    if (n.regenBoost > 0) chips.push('<span class="chip good">Well fed</span>');
    if (s.player.swimming) chips.push('<span class="chip cold">Swimming</span>');
    else if (s.player.wading) chips.push('<span class="chip cold">Wading</span>');
    if (n.exhausted) chips.push('<span class="chip warn">Exhausted</span>');
    if (sim.night && !sim.isNearLitFire(BALANCE.needs.fireWarmRadius) && s.activeTool !== 'torch') chips.push('<span class="chip cold">Dark and cold</span>');
    setHtml(this.chips, chips.join(''), this.chipKey);

    setText(this.clockDay, `Day ${sim.day}`);
    setText(this.clockTime, formatClock(sim.hour));
    const icon = sim.night ? MISC_ICONS.moon : MISC_ICONS.sun;
    if (this.clockIcon.dataset.k !== (sim.night ? 'm' : 's')) {
      this.clockIcon.dataset.k = sim.night ? 'm' : 's';
      this.clockIcon.innerHTML = icon;
    }
    const dayFrac = (s.totalHours % 24) / 24;
    this.clockBar.style.transform = `scaleX(${dayFrac.toFixed(3)})`;
    toggle(this.devBadge, 'show', timeScale !== 1);
    setText(this.devBadge, `DEV ×${timeScale}`);

    const o = sim.currentObjective();
    setText(this.objTitle, o ? o.title : FREEPLAY_OBJECTIVE.title);
    setText(this.objHint, o ? o.hint : FREEPLAY_OBJECTIVE.hint);
    setText(this.objProgress, o?.progress ?? '');
    setText(this.objStep, o ? `${s.objective + 1}/${OBJECTIVES.length}` : '');

    setHtml(this.belt, toolBeltHtml(s), this.beltKey);
    const used = usedSlots(s.inventory);
    const cap = s.inventory.slots.length;
    setText(this.pack, `Pack ${used}/${cap} · Tab`);
    toggle(this.pack, 'full', used >= cap);
  }

  private updateCenter(sim: Simulation): void {
    const pl = sim.placement;
    if (pl) {
      const name = PREFABS[pl.prefab].name;
      const reason = pl.valid ? 'Left-click to build' : pl.reason === 'missing' ? 'Missing ingredients' : pl.reason ? PLACEMENT_REASON_TEXT[pl.reason] : '';
      setHtml(this.placeHelp, `<div class="place-name">${escapeHtml(name)}</div><div class="place-reason ${pl.valid ? 'ok' : 'bad'}">${escapeHtml(reason)}</div><div class="place-keys"><b>R</b>/<b>wheel</b> rotate · <b>right-click</b> cancel</div>`, this.placeKey);
      toggle(this.placeHelp, 'show', true);
      toggle(this.prompt, 'show', false);
      toggle(this.crosshair, 'active', false);
      toggle(this.charge, 'show', false);
      return;
    }
    toggle(this.placeHelp, 'show', false);
    const info = sim.describeFishing() ?? sim.describeTarget();
    const winding = sim.fishing?.phase === 'charging';
    const drawing = sim.bowDraw >= 0 || winding;
    toggle(this.charge, 'show', drawing);
    if (drawing) this.charge.style.setProperty('--p', String(winding ? sim.fishing!.power : Math.min(1, sim.bowDraw / BALANCE.combat.bow.fullDraw)));
    if (sim.state.player.sitting) {
      setHtml(this.prompt, '<span class="prompt-name">Resting on the bench</span><span class="prompt-action">Move to stand up</span>', this.promptKey);
      toggle(this.prompt, 'show', true);
      toggle(this.crosshair, 'active', false);
      return;
    }
    if (!info) {
      toggle(this.prompt, 'show', false);
      toggle(this.crosshair, 'active', false);
      return;
    }
    toggle(this.crosshair, 'active', info.enabled);
    const html = `<span class="prompt-name">${escapeHtml(info.name)}</span>${info.action ? `<span class="prompt-action ${info.enabled ? '' : 'disabled'}">${info.enabled ? '<span class="mouse"></span>' : ''}${escapeHtml(info.action)}</span>` : ''}`;
    setHtml(this.prompt, html, this.promptKey);
    toggle(this.prompt, 'show', true);
  }

  setVisible(v: boolean): void {
    toggle(this.root, 'visible', v);
  }
}

export function effectSummary(item: ItemId): string {
  const f = ITEMS[item].food;
  if (!f) return '';
  const parts: string[] = [];
  if (f.hunger) parts.push(`${f.hunger > 0 ? '+' : ''}${f.hunger} hunger`);
  if (f.thirst) parts.push(`${f.thirst > 0 ? '+' : ''}${f.thirst} thirst`);
  if (f.warmth) parts.push(`${f.warmth > 0 ? '+' : ''}${f.warmth} warmth`);
  if (f.health) parts.push(`${f.health > 0 ? '+' : ''}${f.health} health`);
  if (f.energy) parts.push(`${f.energy > 0 ? '+' : ''}${f.energy} energy`);
  return parts.join(' · ');
}

