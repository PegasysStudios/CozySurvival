import { BALANCE } from '../data/balance';
import type { ForageId } from '../data/forage';
import { GEAR, ITEMS, TOOLS, TOOL_ORDER, itemName, type GearId, type ToolId } from '../data/items';
import { PREFABS, type PrefabId } from '../data/prefabs';
import { CATEGORY_LABELS, RECIPE_BY_ID, recipesFor, type Recipe, type RecipeCategory } from '../data/recipes';
import { isUpgradable, LEVEL_NUMERALS, MAX_TOOL_LEVEL, SHELTER_TIERS, SHELTER_UPGRADE_TEXT, SHELTER_UPGRADES, shelterTier, TOOL_UPGRADES, UPGRADABLE_TOOLS, type Cost, type UpgradableTool } from '../data/upgrades';
import { CANTEEN_ITEMS, canteenFill, canteenServings, nextServing } from '../sim/canteen';
import { isPinned, MAX_PINS } from '../sim/checklist';
import { CRAFT_FAILURE_TEXT, craftableCount } from '../sim/crafting';
import { newStructureWear, newToolWear, prefabWears, toolWears, wearFraction, type WearingTool } from '../sim/durability';
import { usedSlots } from '../sim/inventory';
import { REPAIR_FAILURE_TEXT } from '../sim/repair';
import type { Slot } from '../sim/state';
import { MAX_SKILL_LEVEL, SKILL_IDS, SKILL_INFO, skillEffect, skillLevel, skillProgress } from '../sim/skills';
import type { Simulation } from '../sim/simulation';
import { nextToolUpgrade, toolBreakdown, toolEffectLines, toolLevel, UPGRADE_FAILURE_TEXT } from '../sim/upgrades';
import { campfireMenu } from './campfire';
import { campfireTiles, craftTiles, recipeFor, recipeIcon, recipeTile, toolTile, upgradeTiles, type Tile } from './catalog';
import { attachTooltip, button, el, escapeHtml } from './dom';
import { forageGuide, type ForagePage } from './forage';
import { effectSummary } from './hud';
import { CRAFT_TAB_ICON_DIR, gearIcon, iconImg, itemIcon, MISC_ICONS, prefabIcon, toolIcon } from './icons';
import { ingredients, packRoomNote, repairTile, restText, shelterMenu, storageMenu, workbenchMenu, type Ingredient, type RepairRow, type ShelterMenu } from './structure';

export type PanelMode = 'none' | 'inventory' | 'crafting' | 'campfire' | 'structure';
export type CraftTab = RecipeCategory | 'upgrades';
export type InventoryView = 'pack' | 'forage';

export interface PanelHost {
  sim(): Simulation;
  sfx(name: 'click' | 'craft' | 'deny' | 'eat' | 'drink' | 'fuel'): void;
  close(): void;
  toast(text: string, tone?: 'info' | 'good' | 'warn'): void;
}

/** The crafting menu's icon tabs, in order. There is no foraging-supplies category, so that icon goes unused. */
export const CRAFT_TABS: { id: CraftTab; name: string; icon: string }[] = [
  { id: 'tools', name: CATEGORY_LABELS.tools, icon: 'tools.png' },
  { id: 'structures', name: CATEGORY_LABELS.structures, icon: 'building.png' },
  { id: 'cooking', name: CATEGORY_LABELS.cooking, icon: 'cooking.png' },
  { id: 'upgrades', name: 'Upgrades', icon: 'upgrades.png' },
  { id: 'gear', name: CATEGORY_LABELS.gear, icon: 'gear.png' },
  { id: 'materials', name: CATEGORY_LABELS.materials, icon: 'materials.png' },
];

function ingredientsHtml(list: Ingredient[]): string {
  return `<div class="ingredients">${list.map((i) => `<div class="ingredient ${i.have >= i.need ? 'ok' : 'missing'}">${itemIcon(i.item)}<span>${escapeHtml(i.name)}</span><b>${Math.min(i.have, 99)}/${i.need}</b></div>`).join('')}</div>`;
}

function costText(inputs: Cost): string {
  return inputs.map((i) => `${i.count} ${itemName(i.item, i.count).toLowerCase()}`).join(', ');
}

function levelPips(level: number, withTitle = true): string {
  return `<span class="level-pips"${withTitle ? ` title="Upgrade level ${level} of ${MAX_TOOL_LEVEL}"` : ''}>${Array.from({ length: MAX_TOOL_LEVEL }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('')}</span>`;
}

const TILE_BADGES: Record<NonNullable<Tile['badge']>, string> = {
  owned: '<span class="tile-badge owned">✓</span>',
  fire: `<span class="tile-badge fire">${MISC_ICONS.fire}</span>`,
  upgrade: `<span class="tile-badge up">${MISC_ICONS.upgrade}</span>`,
  max: '<span class="tile-badge max">MAX</span>',
  full: '<span class="tile-badge owned">✓</span>',
};

const lowCondition = (pct: number) => pct <= BALANCE.durability.lowFraction * 100;

/** A square grid tile. Its name is the hover tooltip (`data-tip`) and a visually hidden label. */
export function tileButton(t: Tile, selected: boolean): HTMLButtonElement {
  const b = el('button', `tile tile-${t.kind} ${t.kind === 'recipe' ? 'recipe' : ''} ${t.greyed ? 'greyed' : ''} ${t.ready ? 'ready' : ''} ${selected ? 'selected' : ''}`);
  b.type = 'button';
  b.dataset.tip = t.name;
  b.dataset.key = t.key;
  b.setAttribute('aria-label', t.name);
  const dur = t.condition === undefined ? '' : `<span class="dur ${lowCondition(t.condition) ? 'low' : ''}"><i style="transform:scaleX(${(t.condition / 100).toFixed(3)})"></i></span>`;
  b.innerHTML = `<span class="tile-icon">${t.icon}</span>${t.badge ? TILE_BADGES[t.badge] : ''}${t.level !== null ? levelPips(t.level, false) : ''}${dur}<span class="tile-label">${escapeHtml(t.name)}</span>`;
  return b;
}

export class Panels {
  readonly root = el('div', 'panel-overlay');
  mode: PanelMode = 'none';
  private readonly card = el('div', 'panel');
  private readonly tip = el('div', 'tile-tip');
  private readonly host: PanelHost;
  private tab: CraftTab = 'tools';
  private view: InventoryView = 'pack';
  /** The selected tile in the crafting, upgrades and campfire grids. */
  private selected: string | null = null;
  private selectedSlot = -1;
  private selectedTool: ToolId | null = null;
  private selectedGear: GearId | null = null;
  private selectedForage: ForageId | null = null;
  private selectedRepair: WearingTool | null = null;
  /** The campfire or structure the panel belongs to. */
  private targetId: number | null = null;

  constructor(parent: HTMLElement, host: PanelHost) {
    this.host = host;
    this.root.append(this.card, this.tip);
    attachTooltip(this.card, this.tip);
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) host.close();
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    parent.append(this.root);
  }

  open(mode: Exclude<PanelMode, 'none'>, opts: { targetId?: number; tab?: CraftTab; view?: InventoryView } = {}): void {
    this.mode = mode;
    this.targetId = opts.targetId ?? null;
    if (opts.tab) this.tab = opts.tab;
    if (opts.view) this.view = opts.view;
    this.selectedSlot = -1;
    if (mode === 'inventory') {
      this.selectedTool = null;
      this.selectedGear = null;
    }
    this.root.classList.add('show');
    this.render();
  }

  close(): void {
    this.mode = 'none';
    this.targetId = null;
    this.root.classList.remove('show');
    this.tip.classList.remove('show');
  }

  refresh(): void {
    if (this.mode !== 'none') this.render();
  }

  private render(): void {
    this.tip.classList.remove('show');
    this.card.innerHTML = '';
    this.card.className = `panel panel-${this.mode}`;
    if (this.mode === 'inventory') this.renderInventory();
    else if (this.mode === 'crafting') this.renderCrafting();
    else if (this.mode === 'campfire') this.renderCampfire();
    else if (this.mode === 'structure') this.renderStructure();
  }

  private head(title: string, sub: string): HTMLElement {
    const head = el('div', 'panel-head');
    head.innerHTML = `<h2>${title}</h2><div class="panel-sub">${sub}</div>`;
    head.append(button('×', 'panel-close', () => this.host.close()));
    return head;
  }

  // ------------------------------------------------------------------ inventory

  private renderInventory(): void {
    const s = this.host.sim().state;
    const guide = forageGuide(s);
    const sub = this.view === 'pack'
      ? `${usedSlots(s.inventory)} / ${s.inventory.slots.length} slots · click a tool on your belt to upgrade it`
      : `${guide.unlocked} of ${guide.total} plants found · harvest a plant to fill in its page`;
    const head = this.head(this.view === 'pack' ? 'Pack' : `${MISC_ICONS.leaf} Foraging`, sub);
    const tabs = el('div', 'tabs');
    const views: [InventoryView, string][] = [['pack', 'Pack'], ['forage', `Foraging <span class="tab-count">${guide.unlocked}/${guide.total}</span>`]];
    for (const [v, label] of views) {
      tabs.append(button(label, `tab ${this.view === v ? 'active' : ''}`, () => {
        this.view = v;
        this.host.sfx('click');
        this.render();
      }));
    }
    this.card.append(head, tabs, this.view === 'pack' ? this.packBody() : this.forageBody(guide.pages));
  }

  private packBody(): HTMLElement {
    const sim = this.host.sim();
    const s = sim.state;
    const body = el('div', 'panel-body inv-body');
    const left = el('div', 'inv-left');
    const grid = el('div', 'inv-grid');
    s.inventory.slots.forEach((slot, i) => {
      const cell = el('button', `slot ${slot ? '' : 'empty'} ${i === this.selectedSlot ? 'selected' : ''}`);
      cell.type = 'button';
      if (slot) {
        const def = ITEMS[slot.item];
        cell.innerHTML = `${itemIcon(slot.item)}<span class="count">${slot.count}</span>${def.meal ? '<span class="meal-dot"></span>' : ''}`;
        cell.dataset.tip = def.name;
        cell.setAttribute('aria-label', `${slot.count} ${itemName(slot.item, slot.count)}`);
        cell.addEventListener('click', () => {
          this.selectedSlot = i;
          this.selectedTool = null;
          this.selectedGear = null;
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
    const carry = [
      !s.gear.includes('basket') ? `Grass Basket (+${next.basketSlots})` : '',
      !s.gear.includes('backpack') ? `Hide Backpack (+${next.backpackSlots})` : '',
    ].filter(Boolean);
    left.append(grid);
    if (carry.length) left.append(el('div', 'inv-upgrade', `Carry more with: ${carry.join(', ')}`));

    const select = (tool: ToolId | null, gear: GearId | null) => {
      this.selectedTool = tool;
      this.selectedGear = gear;
      this.selectedSlot = -1;
      this.host.sfx('click');
      this.render();
    };
    const belt = el('div', 'inv-section');
    belt.innerHTML = '<h3>Tool belt</h3>';
    const tools = el('div', 'tile-grid small');
    for (const t of TOOL_ORDER) {
      const tile = { ...toolTile(sim, t), greyed: !s.tools.includes(t), badge: null };
      const b = tileButton(tile, this.selectedTool === t);
      b.insertAdjacentHTML('beforeend', `<span class="tile-key">${TOOLS[t].slot}</span>`);
      if (s.tools.includes(t) && sim.canUpgradeTool(t).ok) b.insertAdjacentHTML('beforeend', `<em class="up-ready">${MISC_ICONS.upgrade}</em>`);
      b.addEventListener('click', () => select(t, null));
      tools.append(b);
    }
    belt.append(tools);
    const gear = el('div', 'inv-section');
    gear.innerHTML = '<h3>Gear</h3>';
    const gearGrid = el('div', 'tile-grid small');
    for (const g of ['basket', 'backpack', 'canteen'] as const) {
      const r = recipeFor.gear(g)!;
      const tile = { ...recipeTile(sim, r), greyed: !s.gear.includes(g), ready: false, badge: null };
      if (g === 'canteen' && s.gear.includes(g)) tile.name = `${GEAR.canteen.name} · ${canteenServings(s)}/${BALANCE.carry.canteenCapacity} water`;
      const b = tileButton(tile, this.selectedGear === g);
      if (g === 'canteen' && s.gear.includes(g)) b.insertAdjacentHTML('beforeend', `<span class="dur water ${canteenServings(s) === 0 ? 'empty' : ''}"><i style="transform:scaleX(${canteenFill(s).toFixed(3)})"></i></span>`);
      b.addEventListener('click', () => select(null, g));
      gearGrid.append(b);
    }
    gear.append(gearGrid);
    const skills = el('div', 'inv-section');
    skills.innerHTML = `<h3>Skills</h3><div class="skills">${SKILL_IDS.map((id) => {
      const xp = s.skills[id];
      const level = skillLevel(xp);
      const pct = Math.round(skillProgress(xp) * 100);
      return `<div class="skill" title="${escapeHtml(SKILL_INFO[id].how)}"><div class="skill-head"><b>${SKILL_INFO[id].name}</b><span>Lv ${level}${level >= MAX_SKILL_LEVEL ? ' · max' : ''}</span></div><div class="skill-track"><i style="transform:scaleX(${pct / 100})"></i></div><div class="skill-effect">${escapeHtml(skillEffect(id, xp))}</div></div>`;
    }).join('')}</div>`;
    left.append(belt, gear, skills);

    let right: HTMLElement;
    const slot = this.selectedSlot >= 0 ? s.inventory.slots[this.selectedSlot] : null;
    if (this.selectedTool) {
      right = this.toolDetail(this.selectedTool);
    } else if (this.selectedGear === 'canteen' && s.gear.includes('canteen')) {
      right = this.canteenDetail();
    } else if (this.selectedGear) {
      right = this.recipeDetail(recipeFor.gear(this.selectedGear)!);
    } else if (slot) {
      right = el('div');
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
      right = el('div');
      right.innerHTML = `<div class="detail-empty"><p>Select an item, a tool or a piece of gear to inspect it.</p><p class="muted">Right-click or double-click food to eat it. <b>F</b> eats whatever you need most. Click a tool on your belt to see its upgrades.</p></div>`;
    }
    right.classList.add('inv-detail');
    body.append(left, right);
    return body;
  }

  /** The canteen's info panel: how full it is, what the next drink is, and a Drink button. */
  private canteenDetail(): HTMLElement {
    const sim = this.host.sim();
    const s = sim.state;
    const cap = BALANCE.carry.canteenCapacity;
    const n = canteenServings(s);
    const next = nextServing(s);
    const d = el('div', 'canteen-detail');
    const kinds = CANTEEN_ITEMS.filter((i) => s.canteen[i] > 0).map((i) => `${s.canteen[i]} ${itemName(i, s.canteen[i]).toLowerCase()}`);
    const source = sim.biome === 'desert' ? 'a spring or a rock pool' : 'the lake';
    d.innerHTML = `<div class="detail-icon big">${gearIcon('canteen')}</div><h3>${escapeHtml(GEAR.canteen.name)}</h3><p>${escapeHtml(GEAR.canteen.description)}</p>`
      + `<div class="fuel-meter canteen-meter"><span>Water</span><div class="fuel-track"><div class="fuel-fill water" style="transform:scaleX(${canteenFill(s).toFixed(3)})"></div></div><b>${n} / ${cap}</b></div>`
      + `<div class="effects">${n ? escapeHtml(`Holds ${kinds.join(' and ')}.`) : 'Empty.'}</div>`
      + (next ? `<div class="effects muted">${escapeHtml(`Next sip: ${ITEMS[next].name} · ${effectSummary(next)}`)}</div>` : `<div class="effects muted">${escapeHtml(`Click ${source} to fill it, or boil water at a campfire.`)}</div>`);
    const actions = el('div', 'detail-actions');
    const drink = button('Drink', `btn primary ${next ? '' : 'disabled'}`, () => {
      if (sim.drinkCanteen()) this.host.sfx('drink');
      else this.host.sfx('deny');
      this.render();
    });
    drink.disabled = !next;
    actions.append(drink);
    d.append(actions);
    d.append(el('div', 'effects muted', 'Water only travels in the canteen, one serving per sip. Raw water goes first; boiled water is saved for teas and stews.'));
    return d;
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

  // ------------------------------------------------------------------ tool upgrades (shared by Pack and Crafting)

  /** Every upgrade level of a tool with its materials, marked done, next or later. */
  private upgradeLadder(tool: UpgradableTool): HTMLElement {
    const s = this.host.sim().state;
    const lv = s.tools.includes(tool) ? toolLevel(s, tool) : 0;
    const box = el('div', 'upgrade-ladder');
    box.innerHTML = `<h4>All upgrades</h4>${TOOL_UPGRADES[tool].map((u, i) => {
      const n = i + 1;
      const state = n <= lv ? 'done' : n === lv + 1 ? 'next' : 'later';
      return `<div class="ladder-step ${state}"><b>${LEVEL_NUMERALS[n]} · ${escapeHtml(u.name)}</b><span>${escapeHtml(costText(u.inputs))}</span></div>`;
    }).join('')}`;
    return box;
  }

  private toolDetail(tool: ToolId): HTMLElement {
    const sim = this.host.sim();
    const s = sim.state;
    const owned = s.tools.includes(tool);
    const def = TOOLS[tool];
    const upgradable = isUpgradable(tool);
    if (!owned) {
      const r = recipeFor.tool(tool);
      const d = r ? this.recipeDetail(r) : el('div', 'tool-detail');
      if (upgradable) {
        d.append(el('div', 'effects muted', `Craft the ${escapeHtml(def.name)} first. It can then be upgraded three times:`));
        d.append(this.upgradeLadder(tool));
      }
      return d;
    }
    const d = el('div', 'tool-detail');
    const lv = toolLevel(s, tool);
    const lines = toolEffectLines(s, tool);
    const breakdown = upgradable ? toolBreakdown(s, tool) : '';
    const w = s.toolWear[tool];
    const wear = toolWears(tool) ? `<div class="effects muted">Condition ${w ? Math.max(1, Math.round(wearFraction(w) * 100)) : 100}% · upgrades stay with you when you make a new one</div>` : '';
    d.innerHTML = `<div class="detail-icon big">${toolIcon(tool, lv)}</div><h3>${escapeHtml(def.name)} ${upgradable ? levelPips(lv) : ''}</h3><p>${escapeHtml(def.description)}</p>${lines.length ? `<div class="effects">${lines.map(escapeHtml).join('<br>')}</div>` : ''}${breakdown ? `<div class="effects muted breakdown">${escapeHtml(breakdown)}</div>` : ''}${wear}`;
    if (!upgradable) {
      d.append(el('div', 'effects muted', 'Your bare hands. Nothing to upgrade here.'));
      return d;
    }
    const up = nextToolUpgrade(s, tool);
    if (!up) {
      d.append(el('div', 'upgrade-next maxed', `<h4>${MISC_ICONS.upgrade} Fully upgraded</h4><p class="muted">This is as good as a ${escapeHtml(def.name.toLowerCase())} gets.</p>`));
      d.append(this.upgradeLadder(tool));
      return d;
    }
    const check = sim.canUpgradeTool(tool);
    const nextLines = toolEffectLines(s, tool, lv + 1);
    const box = el('div', 'upgrade-next');
    box.innerHTML = `<h4>${MISC_ICONS.upgrade} Upgrade to level ${LEVEL_NUMERALS[lv + 1]}: ${escapeHtml(up.name)}</h4><div class="effects">${nextLines.map(escapeHtml).join('<br>')}</div>${ingredientsHtml(ingredients(sim, up.inputs))}`;
    const actions = el('div', 'detail-actions');
    const go = button('Upgrade', `btn primary ${check.ok ? '' : 'disabled'}`, () => {
      const res = sim.upgradeTool(tool);
      if (!res.ok) {
        this.host.sfx('deny');
        this.host.toast(UPGRADE_FAILURE_TEXT[res.reason!], 'warn');
      }
      this.render();
    });
    go.disabled = !check.ok;
    actions.append(go);
    box.append(actions);
    if (!check.ok && check.reason) box.append(el('div', 'craft-reason', escapeHtml(UPGRADE_FAILURE_TEXT[check.reason])));
    const room = packRoomNote(s, up.inputs);
    if (room) box.append(el('div', 'effects muted', escapeHtml(room)));
    d.append(box, this.upgradeLadder(tool));
    return d;
  }

  /** A shelter tier that is only built by upgrading the tier below it in place. */
  private shelterDetail(p: PrefabId): HTMLElement {
    const sim = this.host.sim();
    const inputs = SHELTER_UPGRADES[p] ?? [];
    const tier = shelterTier(p) + 1;
    const prev = PREFABS[SHELTER_TIERS[tier - 2]].name;
    const a = /^[AEIOU]/.test(prev) ? 'an' : 'a';
    const how = tier === 2
      ? `Only built by upgrading ${a} ${prev} in place: build one from the Build tab, click it and choose Upgrade.`
      : `Only built by upgrading ${a} ${prev} in place: click it and choose Upgrade.`;
    const d = el('div', 'shelter-detail');
    d.innerHTML = `<div class="detail-icon big">${prefabIcon(p)}</div><h3>${escapeHtml(PREFABS[p].name)}</h3><p>${escapeHtml(SHELTER_UPGRADE_TEXT[p] ?? '')}</p><div class="effects">${escapeHtml(`Shelter tier ${tier} of ${SHELTER_TIERS.length} · ${restText(p)}`)}</div><div class="how-to">${MISC_ICONS.upgrade}<span>${escapeHtml(how)}</span></div>${ingredientsHtml(ingredients(sim, inputs))}`;
    const room = packRoomNote(sim.state, inputs);
    if (room) d.append(el('div', 'effects muted', escapeHtml(room)));
    return d;
  }

  // ------------------------------------------------------------------ foraging guide

  private forageBody(pages: ForagePage[]): HTMLElement {
    const s = this.host.sim().state;
    const body = el('div', 'panel-body forage-body');
    const grid = el('div', 'tile-grid forage-grid');
    if (!this.selectedForage || !pages.some((p) => p.entry.id === this.selectedForage)) {
      this.selectedForage = pages.find((p) => p.unlocked)?.entry.id ?? pages[0]?.entry.id ?? null;
    }
    pages.forEach((p, i) => {
      const name = p.unlocked ? p.entry.name : 'Undiscovered plant';
      const card = button(
        `<span class="forage-no">${String(i + 1).padStart(2, '0')}</span><span class="tile-icon">${p.unlocked ? itemIcon(p.entry.item) : MISC_ICONS.lock}</span><span class="tile-label">${escapeHtml(name)}</span>`,
        `tile forage-card ${p.unlocked ? '' : 'locked'} ${p.entry.id === this.selectedForage ? 'selected' : ''}`,
        () => {
          this.selectedForage = p.entry.id;
          this.host.sfx('click');
          this.render();
        },
      );
      card.dataset.tip = name;
      card.setAttribute('aria-label', name);
      grid.append(card);
    });
    const detail = el('div', 'forage-detail');
    const page = pages.find((p) => p.entry.id === this.selectedForage);
    if (!page) {
      detail.innerHTML = '<div class="detail-empty"><p>Pick a plant.</p></div>';
    } else if (!page.unlocked) {
      detail.innerHTML = `<div class="detail-icon big locked">${MISC_ICONS.lock}</div><h3>???</h3><p class="muted">You haven't harvested this plant yet. Its page fills in the first time you do.</p><div class="forage-row"><b>Where to look</b><span>${escapeHtml(page.entry.habitat)}</span></div>`;
    } else {
      const e = page.entry;
      const item = ITEMS[e.item];
      const eats = page.effects.length ? `Eaten as is: ${page.effects.join(', ')}` : 'Not eaten as is';
      const recipes = page.recipes.length ? page.recipes.join(', ') : 'Not used in any recipe';
      const ups = page.upgrades ? `<div class="forage-row"><b>Upgrades</b><span>Used in ${page.upgrades} tool or shelter upgrade${page.upgrades === 1 ? '' : 's'}</span></div>` : '';
      const found = s.stats.gathered[e.item] ?? 0;
      detail.innerHTML = `<div class="detail-icon big">${itemIcon(e.item)}</div><h3>${escapeHtml(e.name)}</h3><div class="forage-latin">${escapeHtml(e.latin)}</div><p>${escapeHtml(e.use)}</p><div class="effects">${escapeHtml(eats)}</div><div class="forage-row"><b>Gives</b><span>${escapeHtml(item.name)}${found ? ` <span class="muted">· ${found} gathered so far</span>` : ''}</span></div><div class="forage-row"><b>Recipes</b><span>${escapeHtml(recipes)}</span></div>${ups}<div class="forage-row"><b>Habitat</b><span>${escapeHtml(e.habitat)}</span></div><div class="forage-row"><b>Regrows</b><span>About ${page.regrowHours} h after it is picked clean</span></div><div class="forage-notes">${escapeHtml(e.notes)}</div>`;
    }
    body.append(grid, detail);
    return body;
  }

  // ------------------------------------------------------------------ crafting

  private renderCrafting(): void {
    const sim = this.host.sim();
    const head = this.head('Crafting', this.tab === 'upgrades'
      ? 'Each tool and weapon has three upgrade levels, each much costlier than the last. Bigger shelters and storage come from upgrading the one you have.'
      : `Every recipe is here from the start. Greyed-out tiles need more materials; hover a tile for its name. Shift-click a recipe to pin its checklist to your screen (up to ${MAX_PINS}).`);

    const recipes = recipesFor(sim.biome);
    const shown = CRAFT_TABS.filter((t) => t.id === 'upgrades' || recipes.some((r) => r.category === t.id));
    if (!shown.some((t) => t.id === this.tab)) this.tab = shown[0].id;
    const tabs = el('div', 'craft-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const t of shown) {
      const ready = t.id === 'upgrades'
        ? UPGRADABLE_TOOLS.filter((tool) => sim.canUpgradeTool(tool).ok).length
        : recipes.filter((r) => r.category === t.id && sim.canCraft(r.id).ok).length;
      const active = this.tab === t.id;
      const b = button(`${iconImg(t.icon, CRAFT_TAB_ICON_DIR)}${ready ? `<span class="tab-badge">${ready}</span>` : ''}`, `craft-tab ${active ? 'active' : ''}`, () => {
        this.tab = t.id;
        this.selected = null;
        this.host.sfx('click');
        this.render();
      });
      b.dataset.tab = t.id;
      b.dataset.tip = t.name;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(active));
      b.setAttribute('aria-label', t.name);
      tabs.append(b);
    }

    const tiles = this.tab === 'upgrades' ? upgradeTiles(sim) : craftTiles(sim, this.tab);
    this.card.append(head, this.gridBody(tiles, tabs));
  }

  /** The campfire's own menu: fuel meter, adding fuel, sleeping beside it, and only the recipes cooked over a fire. */
  private renderCampfire(): void {
    const sim = this.host.sim();
    const fireId = this.targetId;
    const m = fireId !== null ? campfireMenu(sim, fireId) : null;
    const head = this.head(`${MISC_ICONS.fire} Campfire`, m ? m.status : 'This fire is gone.');
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
    const sleep = button(`${MISC_ICONS.moonBed} ${m.sleepLabel}`, 'btn sleep-btn', () => {
      if (sim.trySleep(fireId)) this.host.close();
      else this.render();
    });
    sleep.disabled = !m.canSleep;
    sleep.title = m.sleepNote;
    actions.append(sleep);
    fuelRow.append(actions);
    if (m.full) fuelRow.append(el('div', 'effects muted', 'The fire is roaring. Add more once it burns down a little.'));
    fuelRow.append(el('div', 'effects muted fire-sleep-note', escapeHtml(m.sleepNote + (sim.authority !== 'solo' ? ' The night passes once everyone is asleep.' : ''))));

    this.card.append(head, fuelRow, this.gridBody(campfireTiles(sim, m.recipes)));
  }

  // ------------------------------------------------------------------ structures

  /** A placed structure's own menu: a shelter's, a storage bin's or a workbench's. */
  private renderStructure(): void {
    const sim = this.host.sim();
    const st = this.targetId !== null ? sim.state.structures.find((x) => x.id === this.targetId) : undefined;
    const def = st ? PREFABS[st.prefab] : null;
    if (def?.workbench) return this.renderWorkbench();
    if (def?.storage) return this.renderStorage();
    this.renderShelter();
  }

  /** The tier ladder of an upgradable structure, with the current tier highlighted. */
  private tierLadder(line: PrefabId[], tier: number): HTMLElement {
    const ladder = el('div', 'tier-ladder');
    ladder.innerHTML = line.map((p, i) => `<div class="tier ${i + 1 < tier ? 'done' : i + 1 === tier ? 'current' : ''}">${prefabIcon(p)}<span>${escapeHtml(PREFABS[p].name)}</span></div>`).join('<i class="tier-arrow">›</i>');
    return ladder;
  }

  /** Upgrade-in-place box shared by shelters and storage. */
  private upgradeBox(id: number, n: ShelterMenu['next'], maxedText: string): HTMLElement {
    const sim = this.host.sim();
    const upg = el('div', 'structure-upgrade');
    if (!n) {
      upg.innerHTML = `<h3>${MISC_ICONS.upgrade} Fully upgraded</h3><p class="muted">${escapeHtml(maxedText)}</p>`;
      return upg;
    }
    upg.innerHTML = `<h3>${MISC_ICONS.upgrade} Upgrade to ${escapeHtml(n.name)}</h3><p>${escapeHtml(n.text)}</p>${n.rest ? `<div class="effects">${escapeHtml(n.rest)}</div>` : ''}${ingredientsHtml(n.inputs)}`;
    const ua = el('div', 'detail-actions');
    const go = button('Upgrade', `btn primary ${n.check.ok ? '' : 'disabled'}`, () => {
      const res = sim.upgradeStructure(id);
      if (!res.ok) {
        this.host.sfx('deny');
        this.host.toast(n.reason ?? UPGRADE_FAILURE_TEXT[res.reason!], 'warn');
      }
      this.render();
    });
    go.disabled = !n.check.ok;
    ua.append(go);
    upg.append(ua);
    if (n.reason) upg.append(el('div', 'craft-reason', escapeHtml(n.reason)));
    if (n.room) upg.append(el('div', 'effects muted', escapeHtml(n.room)));
    return upg;
  }

  /** A shelter's own menu: sleep in it, or upgrade it into the next tier in place. */
  private renderShelter(): void {
    const sim = this.host.sim();
    const id = this.targetId;
    const m = id !== null ? shelterMenu(sim, id) : null;
    if (!m || id === null) {
      this.card.append(this.head('Shelter', 'This shelter is gone.'));
      return;
    }
    const head = this.head(`${prefabIcon(m.prefab)} ${escapeHtml(m.name)}`, `Tier ${m.tier} of ${m.tiers}${m.condition !== null ? ` · condition ${m.condition}%` : ''}`);
    const ladder = this.tierLadder(SHELTER_TIERS, m.tier);

    const body = el('div', 'panel-body structure-body');
    const rest = el('div', 'structure-rest');
    rest.innerHTML = `<h3>${MISC_ICONS.moonBed} Rest</h3><p>Sleep here until dawn to fully restore your energy.</p><div class="effects">${escapeHtml(m.rest)}</div>`;
    const sleep = button(m.sleepLabel, `btn primary ${m.canSleep ? '' : 'disabled'}`, () => {
      if (sim.trySleep(id)) this.host.close();
      else this.render();
    });
    sleep.disabled = !m.canSleep;
    const ra = el('div', 'detail-actions');
    ra.append(sleep);
    rest.append(ra);
    if (sim.authority !== 'solo') rest.append(el('div', 'effects muted', 'The night passes once everyone is asleep.'));

    body.append(rest, this.upgradeBox(id, m.next, 'This is the finest shelter you can build in these woods.'));
    this.card.append(head, ladder, body);
  }

  /** A pack or storage slot: click moves the stack across, right-click moves one. */
  private slotCell(slot: Slot | null, move: (count: number) => void): HTMLButtonElement {
    const cell = el('button', `slot ${slot ? '' : 'empty'}`);
    cell.type = 'button';
    if (!slot) return cell;
    const def = ITEMS[slot.item];
    cell.innerHTML = `${itemIcon(slot.item)}<span class="count">${slot.count}</span>${def.meal ? '<span class="meal-dot"></span>' : ''}`;
    cell.dataset.tip = def.name;
    cell.dataset.item = slot.item;
    cell.setAttribute('aria-label', `${slot.count} ${itemName(slot.item, slot.count)}`);
    cell.addEventListener('click', () => move(Infinity));
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      move(1);
    });
    return cell;
  }

  /** A storage bin: its shared slots beside your pack, and the next, roomier tier. */
  private renderStorage(): void {
    const sim = this.host.sim();
    const id = this.targetId!;
    const m = storageMenu(sim, id);
    const st = sim.state.structures.find((x) => x.id === id);
    if (!m || !st) {
      this.card.append(this.head('Storage', 'This storage is gone.'));
      return;
    }
    const shared = sim.authority !== 'solo' ? ' · shared with everyone in camp' : '';
    const head = this.head(`${prefabIcon(m.prefab)} ${escapeHtml(m.name)}`, `Tier ${m.tier} of ${m.tiers} · ${m.used}/${m.slots} slots used${shared}`);
    const moved = (n: number) => {
      this.host.sfx(n > 0 ? 'click' : 'deny');
      this.render();
    };
    const body = el('div', 'panel-body storage-body');
    const binCol = el('div', 'storage-col store-col');
    binCol.innerHTML = `<h3>${prefabIcon(m.prefab)} In storage <span class="muted">${m.used}/${m.slots}</span></h3>`;
    const binGrid = el('div', 'inv-grid store-grid');
    (st.store ?? []).forEach((slot, i) => binGrid.append(this.slotCell(slot, (n) => moved(sim.takeItem(id, i, n)))));
    binCol.append(binGrid);
    const packCol = el('div', 'storage-col pack-col');
    const s = sim.state;
    packCol.innerHTML = `<h3>Your pack <span class="muted">${usedSlots(s.inventory)}/${s.inventory.slots.length}</span></h3>`;
    const packGrid = el('div', 'inv-grid pack-grid');
    s.inventory.slots.forEach((slot, i) => packGrid.append(this.slotCell(slot, (n) => moved(sim.storeItem(id, i, n)))));
    packCol.append(packGrid, el('div', 'effects muted storage-hint', 'Click a stack to move it across, right-click to move just one.'));
    body.append(binCol, packCol);
    const foot = el('div', 'storage-foot');
    foot.append(this.upgradeBox(id, m.next, 'This is the roomiest store you can build.'));
    this.card.append(head, this.tierLadder(m.line, m.tier), body, foot);
  }

  /** The workbench: every carried tool or weapon that wears, what mending it costs, and a Repair button. */
  private renderWorkbench(): void {
    const sim = this.host.sim();
    const id = this.targetId!;
    const m = workbenchMenu(sim, id);
    if (!m) {
      this.card.append(this.head('Repair Workbench', 'This workbench is gone.'));
      return;
    }
    const head = this.head(`${prefabIcon('workbench')} Repair Workbench`, 'Mend worn tools and weapons for a small share of what they cost to make. Greyed-out tools need more materials. Anyone in camp can use this bench.');
    if (!m.rows.length) {
      const empty = el('div', 'panel-body workbench-empty');
      empty.innerHTML = '<div class="detail-empty"><p>You aren\'t carrying anything that wears.</p><p class="muted">The axe, spear, bow, torch and fishing pole lose condition as you use them. Bring them here to mend them.</p></div>';
      this.card.append(head, empty);
      return;
    }
    if (!m.rows.some((r) => r.tool === this.selectedRepair)) this.selectedRepair = (m.rows.find((r) => r.check.ok) ?? m.rows.find((r) => r.condition < 100) ?? m.rows[0]).tool;
    const body = el('div', 'panel-body craft-body workbench-body');
    const grid = el('div', 'tile-grid');
    for (const r of m.rows) {
      const b = tileButton(repairTile(r), r.tool === this.selectedRepair);
      b.dataset.tool = r.tool;
      b.addEventListener('click', () => {
        this.selectedRepair = r.tool;
        this.host.sfx('click');
        this.render();
      });
      b.addEventListener('dblclick', () => {
        if (r.check.ok) this.repair(r.tool, id);
      });
      grid.append(b);
    }
    body.append(grid, this.repairDetail(m.rows.find((r) => r.tool === this.selectedRepair)!, id));
    this.card.append(head, body);
  }

  /** The selected tool at the workbench: its durability, the repair materials against the pack, the time and the Repair button. */
  private repairDetail(r: RepairRow, benchId: number): HTMLElement {
    const detail = el('div', 'recipe-detail repair-detail');
    detail.dataset.tool = r.tool;
    const uses = r.condition >= 100 ? 'In perfect condition' : r.uses ? `${r.uses.left} of ${r.uses.max} uses left` : '';
    const time = r.condition >= 100 ? 'Nothing to mend' : `${r.seconds} s at the bench, standing still`;
    detail.innerHTML = `<div class="detail-icon big">${toolIcon(r.tool, r.level)}</div><h3>${escapeHtml(r.name)}</h3>`
      + `<div class="repair-stat"><b>Durability</b><div class="repair-cond ${lowCondition(r.condition) ? 'low' : ''}"><div class="repair-track"><i style="transform:scaleX(${(r.condition / 100).toFixed(3)})"></i></div><span>${r.condition}%</span></div><div class="effects muted">${escapeHtml(uses)}</div></div>`
      + `<div class="repair-stat"><b>Repair materials</b>${ingredientsHtml(r.cost)}</div>`
      + `<div class="repair-stat repair-time"><b>Repair time</b><span>${escapeHtml(time)}</span></div>`;
    const actions = el('div', 'detail-actions');
    const go = button('Repair', `btn primary ${r.check.ok ? '' : 'disabled'}`, () => this.repair(r.tool, benchId));
    go.disabled = !r.check.ok;
    actions.append(go);
    detail.append(actions);
    if (r.reason) detail.append(el('div', 'craft-reason', escapeHtml(r.reason)));
    return detail;
  }

  private repair(tool: WearingTool, benchId: number): void {
    const res = this.host.sim().startRepair(tool, benchId);
    if (!res.ok) {
      this.host.sfx('deny');
      this.host.toast(REPAIR_FAILURE_TEXT[res.reason!], 'warn');
      this.render();
      return;
    }
    this.host.sfx('craft');
    this.host.close();
  }

  // ------------------------------------------------------------------ grids

  /** A grid of tiles with the selected tile's materials and action beside it; `tabs` go above the grid, in its column. */
  private gridBody(tiles: Tile[], tabs?: HTMLElement): HTMLElement {
    const body = el('div', `panel-body craft-body ${tabs ? 'craft-tabbed' : ''}`);
    const grid = el('div', 'tile-grid');
    if (!this.selected || !tiles.some((t) => t.key === this.selected)) this.selected = (tiles.find((t) => t.ready) ?? tiles[0])?.key ?? null;
    const s = this.host.sim().state;
    for (const t of tiles) {
      const b = tileButton(t, t.key === this.selected);
      b.addEventListener('click', (e) => {
        this.selected = t.key;
        if (e.shiftKey && t.kind === 'recipe') return this.togglePin(t.id);
        this.host.sfx('click');
        this.render();
      });
      if (t.kind === 'recipe') {
        b.addEventListener('dblclick', (e) => {
          if (!e.shiftKey) this.craft(t.id);
        });
        if (isPinned(s, t.id)) {
          b.classList.add('pinned');
          b.insertAdjacentHTML('beforeend', `<span class="tile-pin">${MISC_ICONS.pin}</span>`);
        }
      }
      grid.append(b);
    }
    const sel = tiles.find((t) => t.key === this.selected);
    const detail = !sel ? el('div', '', '<div class="detail-empty"><p>Pick a tile.</p></div>')
      : sel.kind === 'recipe' ? this.recipeDetail(RECIPE_BY_ID[sel.id])
        : sel.kind === 'tool' ? this.toolDetail(sel.id as ToolId)
          : this.shelterDetail(sel.id as PrefabId);
    detail.classList.add('recipe-detail');
    if (tabs) {
      const left = el('div', 'craft-left');
      left.append(tabs, grid);
      body.append(left, detail);
    } else {
      body.append(grid, detail);
    }
    return body;
  }

  private recipeDetail(r: Recipe): HTMLElement {
    const sim = this.host.sim();
    const s = sim.state;
    const detail = el('div', 'recipe-detail');
    const check = sim.canCraft(r.id);
    const inputs = ingredientsHtml(ingredients(sim, r.inputs));
    const out = r.output;
    const outText = out.kind === 'item' ? `Makes ${out.count} ${itemName(out.item, out.count)}${ITEMS[out.item].food ? ` · ${effectSummary(out.item)}` : ''}` : out.kind === 'tool' ? `Tool · slot ${TOOLS[out.tool].slot}${isUpgradable(out.tool) ? ' · upgradable to level III' : ''}` : out.kind === 'gear' ? `Gear · ${GEAR[out.gear].description}` : `Structure · ${PREFABS[out.prefab].name}`;
    const station = r.station === 'fire' ? `<div class="station ${sim.isNearLitFire() ? 'ok' : 'missing'}">${MISC_ICONS.fire} ${sim.isNearLitFire() ? 'Lit campfire nearby' : 'Needs a lit campfire nearby'}</div>` : '';
    const lasts = out.kind === 'tool' && toolWears(out.tool)
      ? `Durability ${newToolWear(out.tool, s.skills.crafting).max} uses (Crafting Lv ${skillLevel(s.skills.crafting)})`
      : out.kind === 'place' && prefabWears(out.prefab)
        ? `Condition ${newStructureWear(out.prefab, s.skills.crafting).max} (weathers over time; Crafting Lv ${skillLevel(s.skills.crafting)})`
        : '';
    const shelterNote = out.kind === 'place' && PREFABS[out.prefab].shelter ? '<div class="effects muted">Click it once built to sleep in it or upgrade it into a bigger shelter.</div>' : '';
    const note = lasts ? `<div class="effects muted">${escapeHtml(lasts)}</div>` : '';
    detail.innerHTML = `<div class="detail-icon big">${recipeIcon(r, s)}</div><h3>${escapeHtml(r.name)}</h3><p>${escapeHtml(r.description)}</p><div class="effects">${escapeHtml(outText)}</div>${note}${shelterNote}${station}${inputs}`;
    const label = out.kind === 'place' ? 'Place' : r.station === 'fire' ? 'Cook' : 'Craft';
    const maxN = out.kind === 'item' ? craftableCount(s, r) : 0;
    const actions = el('div', 'detail-actions');
    const go = button(label, `btn primary ${check.ok ? '' : 'disabled'}`, () => this.craft(r.id));
    go.disabled = !check.ok;
    actions.append(go);
    if (check.ok && maxN > 1) actions.append(button(`${label} ×${Math.min(maxN, 5)}`, 'btn', () => this.craft(r.id, Math.min(maxN, 5))));
    const pin = button(`${MISC_ICONS.pin} ${isPinned(s, r.id) ? 'Unpin' : 'Pin'}`, 'btn subtle pin-btn', () => this.togglePin(r.id));
    pin.title = `Shift-click a recipe to pin its ingredients to your screen (up to ${MAX_PINS})`;
    actions.append(pin);
    detail.append(actions);
    if (!check.ok && check.reason) detail.append(el('div', 'craft-reason', escapeHtml(CRAFT_FAILURE_TEXT[check.reason])));
    return detail;
  }

  private togglePin(id: string): void {
    const res = this.host.sim().togglePin(id);
    if (!res) return;
    const name = RECIPE_BY_ID[id].name;
    this.host.sfx('click');
    this.host.toast(res.pinned
      ? `Pinned ${name} to your checklist${res.dropped ? `, in place of ${RECIPE_BY_ID[res.dropped].name}` : ''}`
      : `Unpinned ${name}`);
    this.render();
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
