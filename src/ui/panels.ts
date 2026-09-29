import { BALANCE } from '../data/balance';
import { GEAR, ITEMS, TOOLS, TOOL_ORDER, itemName, type ToolId } from '../data/items';
import { PREFABS } from '../data/prefabs';
import { CATEGORY_LABELS, RECIPES, RECIPE_BY_ID, type Recipe, type RecipeCategory } from '../data/recipes';
import { CRAFT_FAILURE_TEXT, craftableCount } from '../sim/crafting';
import { newStructureWear, newToolWear, prefabWears, toolWears, wearFraction } from '../sim/durability';
import { countItem, usedSlots } from '../sim/inventory';
import { MAX_SKILL_LEVEL, SKILL_IDS, SKILL_INFO, skillEffect, skillLevel, skillProgress } from '../sim/skills';
import type { Simulation } from '../sim/simulation';
import { campfireMenu, isCampfireRecipe } from './campfire';
import { button, el, escapeHtml } from './dom';
import { effectSummary } from './hud';
import { gearIcon, itemIcon, MISC_ICONS, toolIcon } from './icons';

export type PanelMode = 'none' | 'inventory' | 'crafting' | 'campfire';

export interface PanelHost {
  sim(): Simulation;
  sfx(name: 'click' | 'craft' | 'deny' | 'eat' | 'drink' | 'fuel'): void;
  close(): void;
  toast(text: string, tone?: 'info' | 'good' | 'warn'): void;
}

const TABS: ('all' | RecipeCategory)[] = ['all', 'tools', 'gear', 'materials', 'cooking', 'structures'];

function recipeIcon(r: Recipe): string {
  const o = r.output;
  if (o.kind === 'item') return itemIcon(o.item);
  if (o.kind === 'tool') return toolIcon(o.tool);
  if (o.kind === 'gear') return gearIcon(o.gear);
  return MISC_ICONS[o.prefab];
}

export class Panels {
  readonly root = el('div', 'panel-overlay');
  mode: PanelMode = 'none';
  private readonly card = el('div', 'panel');
  private readonly host: PanelHost;
  private tab: 'all' | RecipeCategory = 'all';
  private selectedRecipe: string | null = null;
  private selectedSlot = -1;
  private fireId: number | null = null;

  constructor(parent: HTMLElement, host: PanelHost) {
    this.host = host;
    this.root.append(this.card);
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) host.close();
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    parent.append(this.root);
  }

  open(mode: Exclude<PanelMode, 'none'>, opts: { fireId?: number; tab?: RecipeCategory } = {}): void {
    this.mode = mode;
    this.fireId = opts.fireId ?? null;
    if (opts.tab) this.tab = opts.tab;
    this.selectedSlot = -1;
    this.root.classList.add('show');
    this.render();
  }

  close(): void {
    this.mode = 'none';
    this.fireId = null;
    this.root.classList.remove('show');
  }

  refresh(): void {
    if (this.mode !== 'none') this.render();
  }

  private render(): void {
    this.card.innerHTML = '';
    this.card.className = `panel panel-${this.mode}`;
    if (this.mode === 'inventory') this.renderInventory();
    else if (this.mode === 'crafting') this.renderCrafting();
    else if (this.mode === 'campfire') this.renderCampfire();
  }

  // ------------------------------------------------------------------ inventory

  private renderInventory(): void {
    const sim = this.host.sim();
    const s = sim.state;
    const head = el('div', 'panel-head');
    head.innerHTML = `<h2>Pack</h2><div class="panel-sub">${usedSlots(s.inventory)} / ${s.inventory.slots.length} slots · tools ride on your belt</div>`;
    head.append(button('×', 'panel-close', () => this.host.close()));
    const body = el('div', 'panel-body inv-body');
    const left = el('div', 'inv-left');
    const grid = el('div', 'inv-grid');
    s.inventory.slots.forEach((slot, i) => {
      const cell = el('button', `slot ${slot ? '' : 'empty'} ${i === this.selectedSlot ? 'selected' : ''}`);
      cell.type = 'button';
      if (slot) {
        const def = ITEMS[slot.item];
        cell.innerHTML = `${itemIcon(slot.item)}<span class="count">${slot.count}</span>${def.meal ? '<span class="meal-dot"></span>' : ''}`;
        cell.title = `${slot.count} ${itemName(slot.item, slot.count)}`;
        cell.addEventListener('click', () => {
          this.selectedSlot = i;
          this.host.sfx('click');
          this.render();
        });
        cell.addEventListener('dblclick', () => this.useSlot(i));
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.useSlot(i);
        });
      }
      grid.append(cell);
    });
    const next = BALANCE.carry;
    const upgrades = [
      !s.gear.includes('basket') ? `Grass Basket (+${next.basketSlots})` : '',
      !s.gear.includes('backpack') ? `Hide Backpack (+${next.backpackSlots})` : '',
    ].filter(Boolean);
    left.append(grid);
    if (upgrades.length) left.append(el('div', 'inv-upgrade', `Carry more with: ${upgrades.join(', ')}`));

    const belt = el('div', 'inv-section');
    const toolLabel = (t: ToolId) => {
      if (!s.tools.includes(t)) return '???';
      const w = s.toolWear[t];
      return toolWears(t) ? `${TOOLS[t].name} · ${w ? Math.max(1, Math.round(wearFraction(w) * 100)) : 100}%` : TOOLS[t].name;
    };
    belt.innerHTML = `<h3>Tool belt</h3><div class="inv-tools">${TOOL_ORDER.map((t) => `<div class="inv-tool ${s.tools.includes(t) ? '' : 'locked'}" title="${escapeHtml(TOOLS[t].description)}">${s.tools.includes(t) ? toolIcon(t) : MISC_ICONS.lock}<span>${TOOLS[t].slot} · ${escapeHtml(toolLabel(t))}</span></div>`).join('')}</div>`;
    const gear = el('div', 'inv-section');
    gear.innerHTML = `<h3>Gear</h3><div class="inv-tools">${(['basket', 'backpack', 'canteen'] as const).map((g) => `<div class="inv-tool ${s.gear.includes(g) ? '' : 'locked'}" title="${escapeHtml(GEAR[g].description)}">${s.gear.includes(g) ? gearIcon(g) : MISC_ICONS.lock}<span>${s.gear.includes(g) ? GEAR[g].name : '???'}</span></div>`).join('')}</div>`;
    const skills = el('div', 'inv-section');
    skills.innerHTML = `<h3>Skills</h3><div class="skills">${SKILL_IDS.map((id) => {
      const xp = s.skills[id];
      const level = skillLevel(xp);
      const pct = Math.round(skillProgress(xp) * 100);
      return `<div class="skill" title="${escapeHtml(SKILL_INFO[id].how)}"><div class="skill-head"><b>${SKILL_INFO[id].name}</b><span>Lv ${level}${level >= MAX_SKILL_LEVEL ? ' · max' : ''}</span></div><div class="skill-track"><i style="transform:scaleX(${pct / 100})"></i></div><div class="skill-effect">${escapeHtml(skillEffect(id, xp))}</div></div>`;
    }).join('')}</div>`;
    left.append(belt, gear, skills);

    const right = el('div', 'inv-detail');
    const slot = this.selectedSlot >= 0 ? s.inventory.slots[this.selectedSlot] : null;
    if (slot) {
      const def = ITEMS[slot.item];
      right.innerHTML = `<div class="detail-icon">${itemIcon(slot.item)}</div><h3>${escapeHtml(def.name)} <span class="muted">×${slot.count}</span></h3><p>${escapeHtml(def.description)}</p>${def.food ? `<div class="effects">${escapeHtml(effectSummary(slot.item))}</div>` : ''}${def.fuelHours ? `<div class="effects muted">Fuel: ${def.fuelHours} h of fire</div>` : ''}`;
      const actions = el('div', 'detail-actions');
      if (def.food) actions.append(button(def.water && (def.food.hunger ?? 0) < 5 ? 'Drink' : 'Eat', 'btn primary', () => this.useSlot(this.selectedSlot)));
      actions.append(button('Drop', 'btn', () => {
        sim.dropSlot(this.selectedSlot);
        this.selectedSlot = -1;
        this.host.sfx('click');
        this.render();
      }));
      right.append(actions);
    } else {
      right.innerHTML = `<div class="detail-empty"><p>Select an item to inspect it.</p><p class="muted">Right-click or double-click food to eat it. <b>F</b> eats whatever you need most.</p></div>`;
    }
    body.append(left, right);
    this.card.append(head, body);
  }

  private useSlot(i: number): void {
    const sim = this.host.sim();
    const slot = sim.state.inventory.slots[i];
    if (!slot) return;
    const def = ITEMS[slot.item];
    if (!def.food) {
      this.host.sfx('deny');
      return;
    }
    sim.useSlot(i);
    if (!sim.state.inventory.slots[i]) this.selectedSlot = -1;
    this.render();
  }

  // ------------------------------------------------------------------ crafting

  private renderCrafting(): void {
    const sim = this.host.sim();
    const s = sim.state;
    const head = el('div', 'panel-head');
    head.innerHTML = `<h2>Crafting</h2><div class="panel-sub">You learn new recipes by gathering, hunting and exploring.</div>`;
    head.append(button('×', 'panel-close', () => this.host.close()));

    const tabs = el('div', 'tabs');
    for (const t of TABS) {
      const list = RECIPES.filter((r) => s.known.includes(r.id) && (t === 'all' || r.category === t));
      const ready = list.filter((r) => sim.canCraft(r.id).ok).length;
      const b = button(`${t === 'all' ? 'All' : CATEGORY_LABELS[t]}${ready ? ` <span class="tab-badge">${ready}</span>` : ''}`, `tab ${this.tab === t ? 'active' : ''}`, () => {
        this.tab = t;
        this.selectedRecipe = null;
        this.host.sfx('click');
        this.render();
      });
      tabs.append(b);
    }

    const inTab = (r: Recipe) => this.tab === 'all' || r.category === this.tab;
    const empty = this.tab === 'cooking' ? 'Gather ingredients like chanterelles, onions and berries to learn meals.' : 'Nothing here yet. Keep gathering.';
    this.card.append(head, tabs, this.recipeBody(inTab, empty));
  }

  /** The campfire's own menu: fuel meter, adding fuel, and only the recipes cooked over a fire. */
  private renderCampfire(): void {
    const sim = this.host.sim();
    const fireId = this.fireId;
    const m = fireId !== null ? campfireMenu(sim, fireId) : null;
    const head = el('div', 'panel-head');
    head.innerHTML = `<h2>${MISC_ICONS.fire} Campfire</h2><div class="panel-sub">${m ? m.status : 'This fire is gone.'}</div>`;
    head.append(button('×', 'panel-close', () => this.host.close()));
    if (!m || fireId === null) {
      this.card.append(head);
      return;
    }

    const fuelRow = el('div', 'fire-fuel');
    fuelRow.innerHTML = `<div class="fuel-meter"><span>Fuel</span><div class="fuel-track"><div class="fuel-fill" style="transform:scaleX(${m.fraction.toFixed(3)})"></div></div><b>${m.fuel.toFixed(1)} / ${m.maxFuel} h</b></div>`;
    const actions = el('div', 'fuel-actions');
    for (const o of m.fuelOptions) {
      const b = button(`${itemIcon(o.item)} Add ${o.item === 'log' ? 'a log' : 'a stick'} <span class="muted">+${o.hours} h · ${o.have} in pack</span>`, 'btn fuel-btn', () => {
        this.host.sfx(sim.addFuel(fireId, o.item) ? 'fuel' : 'deny');
        this.render();
      });
      b.disabled = !o.enabled;
      actions.append(b);
    }
    fuelRow.append(actions);
    if (m.full) fuelRow.append(el('div', 'effects muted', 'The fire is roaring. Add more once it burns down a little.'));

    this.card.append(head, fuelRow, this.recipeBody(isCampfireRecipe, 'Gather ingredients like chanterelles, onions and berries, or fill a canteen at the lake, to learn campfire recipes.'));
  }

  /** Known recipes matching `filter` as a list with a detail pane, ready-to-make first. */
  private recipeBody(filter: (r: Recipe) => boolean, emptyText: string): HTMLElement {
    const sim = this.host.sim();
    const s = sim.state;
    const body = el('div', 'panel-body craft-body');
    const list = el('div', 'recipe-list');
    const known = RECIPES.filter((r) => s.known.includes(r.id) && filter(r));
    const sorted = [...known].sort((a, b) => Number(sim.canCraft(b.id).ok) - Number(sim.canCraft(a.id).ok));
    if (!this.selectedRecipe || !known.some((r) => r.id === this.selectedRecipe)) this.selectedRecipe = sorted[0]?.id ?? null;
    for (const r of sorted) {
      const check = sim.canCraft(r.id);
      const row = el('button', `recipe ${check.ok ? 'ready' : ''} ${r.id === this.selectedRecipe ? 'selected' : ''} ${check.reason === 'owned' ? 'owned' : ''}`);
      row.type = 'button';
      const status = check.ok ? (r.output.kind === 'place' ? 'Ready to place' : 'Ready') : check.reason === 'owned' ? 'Owned' : check.reason === 'station' ? 'Needs fire' : check.reason === 'missing' ? 'Missing items' : CRAFT_FAILURE_TEXT[check.reason!];
      row.innerHTML = `<span class="recipe-icon">${recipeIcon(r)}</span><span class="recipe-name">${escapeHtml(r.name)}</span><span class="recipe-status">${escapeHtml(status)}</span>`;
      row.addEventListener('click', () => {
        this.selectedRecipe = r.id;
        this.host.sfx('click');
        this.render();
      });
      row.addEventListener('dblclick', () => this.craft(r.id));
      list.append(row);
    }
    const unknownCount = RECIPES.filter((r) => !s.known.includes(r.id) && filter(r)).length;
    if (unknownCount > 0) list.append(el('div', 'recipe-unknown', `${unknownCount} more recipe${unknownCount === 1 ? '' : 's'} to discover`));
    if (!known.length) list.prepend(el('div', 'recipe-empty', emptyText));

    const detail = el('div', 'recipe-detail');
    const r = this.selectedRecipe ? RECIPE_BY_ID[this.selectedRecipe] : null;
    if (r) {
      const check = sim.canCraft(r.id);
      const inputs = r.inputs.map((i) => {
        const have = countItem(s.inventory, i.item);
        return `<div class="ingredient ${have >= i.count ? 'ok' : 'missing'}">${itemIcon(i.item)}<span>${escapeHtml(itemName(i.item, i.count))}</span><b>${Math.min(have, 99)}/${i.count}</b></div>`;
      }).join('');
      const out = r.output;
      const outText = out.kind === 'item' ? `Makes ${out.count} ${itemName(out.item, out.count)}${ITEMS[out.item].food ? ` · ${effectSummary(out.item)}` : ''}` : out.kind === 'tool' ? `Tool · slot ${TOOLS[out.tool].slot}` : out.kind === 'gear' ? `Gear · ${GEAR[out.gear].description}` : `Structure · ${PREFABS[out.prefab].name}`;
      const station = r.station === 'fire' ? `<div class="station ${sim.isNearLitFire() ? 'ok' : 'missing'}">${MISC_ICONS.fire} ${sim.isNearLitFire() ? 'Lit campfire nearby' : 'Needs a lit campfire nearby'}</div>` : '';
      const lasts = out.kind === 'tool' && toolWears(out.tool)
        ? `Durability ${newToolWear(out.tool, s.skills.crafting).max} uses (Crafting Lv ${skillLevel(s.skills.crafting)})`
        : out.kind === 'place' && prefabWears(out.prefab)
          ? `Condition ${newStructureWear(out.prefab, s.skills.crafting).max} (weathers over time; Crafting Lv ${skillLevel(s.skills.crafting)})`
          : '';
      const note = lasts ? `<div class="effects muted">${escapeHtml(lasts)}</div>` : '';
      detail.innerHTML = `<div class="detail-icon big">${recipeIcon(r)}</div><h3>${escapeHtml(r.name)}</h3><p>${escapeHtml(r.description)}</p><div class="effects">${escapeHtml(outText)}</div>${note}${station}<div class="ingredients">${inputs}</div>`;
      const label = out.kind === 'place' ? 'Place' : r.station === 'fire' ? 'Cook' : 'Craft';
      const maxN = out.kind === 'item' ? craftableCount(s, r) : 0;
      const actions = el('div', 'detail-actions');
      const go = button(label, `btn primary ${check.ok ? '' : 'disabled'}`, () => this.craft(r.id));
      go.disabled = !check.ok;
      actions.append(go);
      if (check.ok && maxN > 1) actions.append(button(`${label} ×${Math.min(maxN, 5)}`, 'btn', () => this.craft(r.id, Math.min(maxN, 5))));
      detail.append(actions);
      if (!check.ok && check.reason) detail.append(el('div', 'craft-reason', escapeHtml(CRAFT_FAILURE_TEXT[check.reason])));
    } else {
      detail.innerHTML = '<div class="detail-empty"><p>Pick a recipe.</p></div>';
    }
    body.append(list, detail);
    return body;
  }

  private craft(id: string, times = 1): void {
    const sim = this.host.sim();
    const recipe = RECIPE_BY_ID[id];
    let made = 0;
    for (let i = 0; i < times; i++) {
      const res = sim.craft(id);
      if (!res.ok) {
        if (made === 0) {
          this.host.sfx('deny');
          this.host.toast(CRAFT_FAILURE_TEXT[res.reason!], 'warn');
        }
        break;
      }
      made++;
      if (recipe.output.kind === 'place') {
        this.host.close();
        return;
      }
    }
    if (made > 0 && recipe.output.kind === 'tool') {
      this.host.close();
      return;
    }
    this.render();
  }
}
