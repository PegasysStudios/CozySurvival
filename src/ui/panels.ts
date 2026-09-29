import { BALANCE } from '../data/balance';
import { GEAR, ITEMS, TOOLS, TOOL_ORDER, itemName } from '../data/items';
import { PREFABS } from '../data/prefabs';
import { CATEGORY_LABELS, RECIPES, RECIPE_BY_ID, type Recipe, type RecipeCategory } from '../data/recipes';
import { CRAFT_FAILURE_TEXT, craftableCount } from '../sim/crafting';
import { countItem, usedSlots } from '../sim/inventory';
import type { Simulation } from '../sim/simulation';
import { button, el, escapeHtml } from './dom';
import { effectSummary } from './hud';
import { gearIcon, itemIcon, MISC_ICONS, toolIcon } from './icons';

export type PanelMode = 'none' | 'inventory' | 'crafting';

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
    if (mode === 'crafting' && this.fireId !== null) this.tab = 'cooking';
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
    belt.innerHTML = `<h3>Tool belt</h3><div class="inv-tools">${TOOL_ORDER.map((t) => `<div class="inv-tool ${s.tools.includes(t) ? '' : 'locked'}" title="${escapeHtml(TOOLS[t].description)}">${s.tools.includes(t) ? toolIcon(t) : MISC_ICONS.lock}<span>${TOOLS[t].slot} · ${s.tools.includes(t) ? TOOLS[t].name : '???'}</span></div>`).join('')}</div>`;
    const gear = el('div', 'inv-section');
    gear.innerHTML = `<h3>Gear</h3><div class="inv-tools">${(['basket', 'backpack', 'canteen'] as const).map((g) => `<div class="inv-tool ${s.gear.includes(g) ? '' : 'locked'}" title="${escapeHtml(GEAR[g].description)}">${s.gear.includes(g) ? gearIcon(g) : MISC_ICONS.lock}<span>${s.gear.includes(g) ? GEAR[g].name : '???'}</span></div>`).join('')}</div>`;
    left.append(belt, gear);

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
    const atFire = this.fireId !== null ? s.structures.find((x) => x.id === this.fireId) : null;
    if (atFire) {
      const pct = Math.min(1, atFire.fuel / BALANCE.fire.maxFuelHours);
      head.innerHTML = `<h2>${MISC_ICONS.fire} Campfire</h2><div class="panel-sub">${atFire.fuel > 0 ? `Burning · about ${atFire.fuel.toFixed(1)} h of fuel left` : 'The fire is out'}</div><div class="fuel-track"><div class="fuel-fill" style="transform:scaleX(${pct.toFixed(3)})"></div></div>`;
      const sticks = countItem(s.inventory, 'stick');
      const logs = countItem(s.inventory, 'log');
      const fuel = button(logs > 0 ? `Add a log (+${BALANCE.fire.logFuelHours} h)` : sticks > 0 ? `Add a stick (+${BALANCE.fire.stickFuelHours} h)` : 'No fuel in pack', 'btn fuel-btn', () => {
        if (sim.addFuel(atFire.id)) this.host.sfx('fuel');
        else this.host.sfx('deny');
        this.render();
      });
      fuel.disabled = sticks + logs === 0;
      head.append(fuel);
    } else {
      head.innerHTML = `<h2>Crafting</h2><div class="panel-sub">You learn new recipes by gathering, hunting and exploring.</div>`;
    }
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

    const body = el('div', 'panel-body craft-body');
    const list = el('div', 'recipe-list');
    const known = RECIPES.filter((r) => s.known.includes(r.id) && (this.tab === 'all' || r.category === this.tab));
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
    const unknownCount = RECIPES.filter((r) => !s.known.includes(r.id) && (this.tab === 'all' || r.category === this.tab)).length;
    if (unknownCount > 0) list.append(el('div', 'recipe-unknown', `${unknownCount} more recipe${unknownCount === 1 ? '' : 's'} to discover`));
    if (!known.length) list.prepend(el('div', 'recipe-empty', this.tab === 'cooking' ? 'Gather ingredients like chanterelles, onions and berries to learn meals.' : 'Nothing here yet. Keep gathering.'));

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
      detail.innerHTML = `<div class="detail-icon big">${recipeIcon(r)}</div><h3>${escapeHtml(r.name)}</h3><p>${escapeHtml(r.description)}</p><div class="effects">${escapeHtml(outText)}</div>${station}<div class="ingredients">${inputs}</div>`;
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
    this.card.append(head, tabs, body);
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
