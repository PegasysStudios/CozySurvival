import { BALANCE } from '../data/balance';
import type { ForageId } from '../data/forage';
import { GEAR, ITEMS, TOOLS, TOOL_ORDER, itemName, type ToolId } from '../data/items';
import { PREFABS } from '../data/prefabs';
import { CATEGORY_LABELS, RECIPES, RECIPE_BY_ID, type Recipe, type RecipeCategory } from '../data/recipes';
import { isUpgradable, LEVEL_NUMERALS, MAX_TOOL_LEVEL, SHELTER_TIERS, UPGRADABLE_TOOLS } from '../data/upgrades';
import { CRAFT_FAILURE_TEXT, craftableCount } from '../sim/crafting';
import { newStructureWear, newToolWear, prefabWears, toolWears, wearFraction } from '../sim/durability';
import { usedSlots } from '../sim/inventory';
import { MAX_SKILL_LEVEL, SKILL_IDS, SKILL_INFO, skillEffect, skillLevel, skillProgress } from '../sim/skills';
import type { Simulation } from '../sim/simulation';
import { nextToolUpgrade, toolBreakdown, toolEffectLines, toolLevel, UPGRADE_FAILURE_TEXT } from '../sim/upgrades';
import { campfireMenu, isCampfireRecipe } from './campfire';
import { button, el, escapeHtml } from './dom';
import { forageGuide, type ForagePage } from './forage';
import { effectSummary } from './hud';
import { gearIcon, itemIcon, MISC_ICONS, toolIcon } from './icons';
import { ingredients, packRoomNote, shelterMenu, type Ingredient } from './structure';

export type PanelMode = 'none' | 'inventory' | 'crafting' | 'campfire' | 'structure';
export type CraftTab = 'all' | RecipeCategory | 'upgrades';
export type InventoryView = 'pack' | 'forage';

export interface PanelHost {
  sim(): Simulation;
  sfx(name: 'click' | 'craft' | 'deny' | 'eat' | 'drink' | 'fuel'): void;
  close(): void;
  toast(text: string, tone?: 'info' | 'good' | 'warn'): void;
}

const TABS: CraftTab[] = ['all', 'tools', 'gear', 'materials', 'cooking', 'structures', 'upgrades'];

function recipeIcon(r: Recipe): string {
  const o = r.output;
  if (o.kind === 'item') return itemIcon(o.item);
  if (o.kind === 'tool') return toolIcon(o.tool);
  if (o.kind === 'gear') return gearIcon(o.gear);
  return MISC_ICONS[o.prefab];
}

function ingredientsHtml(list: Ingredient[]): string {
  return `<div class="ingredients">${list.map((i) => `<div class="ingredient ${i.have >= i.need ? 'ok' : 'missing'}">${itemIcon(i.item)}<span>${escapeHtml(i.name)}</span><b>${Math.min(i.have, 99)}/${i.need}</b></div>`).join('')}</div>`;
}

function levelPips(level: number): string {
  return `<span class="level-pips" title="Upgrade level ${level} of ${MAX_TOOL_LEVEL}">${Array.from({ length: MAX_TOOL_LEVEL }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('')}</span>`;
}

export class Panels {
  readonly root = el('div', 'panel-overlay');
  mode: PanelMode = 'none';
  private readonly card = el('div', 'panel');
  private readonly host: PanelHost;
  private tab: CraftTab = 'all';
  private view: InventoryView = 'pack';
  private selectedRecipe: string | null = null;
  private selectedSlot = -1;
  private selectedTool: ToolId | null = null;
  private selectedForage: ForageId | null = null;
  /** The campfire or structure the panel belongs to. */
  private targetId: number | null = null;

  constructor(parent: HTMLElement, host: PanelHost) {
    this.host = host;
    this.root.append(this.card);
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
    if (mode === 'inventory') this.selectedTool = null;
    this.root.classList.add('show');
    this.render();
  }

  close(): void {
    this.mode = 'none';
    this.targetId = null;
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
        cell.title = `${slot.count} ${itemName(slot.item, slot.count)}`;
        cell.addEventListener('click', () => {
          this.selectedSlot = i;
          this.selectedTool = null;
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

    const belt = el('div', 'inv-section');
    belt.innerHTML = '<h3>Tool belt</h3>';
    const tools = el('div', 'inv-tools');
    for (const t of TOOL_ORDER) {
      const owned = s.tools.includes(t);
      const lv = toolLevel(s, t);
      const w = s.toolWear[t];
      const wearText = owned && toolWears(t) ? ` · ${w ? Math.max(1, Math.round(wearFraction(w) * 100)) : 100}%` : '';
      const name = owned ? `${TOOLS[t].name}${lv ? ' ' + LEVEL_NUMERALS[lv] : ''}${wearText}` : '???';
      const ready = owned && sim.canUpgradeTool(t).ok;
      const b = button(
        `${owned ? toolIcon(t) : MISC_ICONS.lock}<span>${TOOLS[t].slot} · ${escapeHtml(name)}</span>${ready ? `<em class="up-ready" title="Upgrade ready">${MISC_ICONS.upgrade}</em>` : ''}`,
        `inv-tool ${owned ? '' : 'locked'} ${this.selectedTool === t ? 'selected' : ''}`,
        () => {
          this.selectedTool = t;
          this.selectedSlot = -1;
          this.host.sfx('click');
          this.render();
        },
      );
      b.title = TOOLS[t].description;
      tools.append(b);
    }
    belt.append(tools);
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

    let right: HTMLElement;
    const slot = this.selectedSlot >= 0 ? s.inventory.slots[this.selectedSlot] : null;
    if (this.selectedTool) {
      right = this.toolDetail(this.selectedTool);
      right.classList.add('inv-detail');
    } else if (slot) {
      right = el('div', 'inv-detail');
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
      right = el('div', 'inv-detail');
      right.innerHTML = `<div class="detail-empty"><p>Select an item or a tool to inspect it.</p><p class="muted">Right-click or double-click food to eat it. <b>F</b> eats whatever you need most. Click a tool on your belt to see its upgrades.</p></div>`;
    }
    body.append(left, right);
    return body;
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

  private toolDetail(tool: ToolId): HTMLElement {
    const sim = this.host.sim();
    const s = sim.state;
    const d = el('div', 'tool-detail');
    const owned = s.tools.includes(tool);
    const def = TOOLS[tool];
    if (!owned) {
      d.innerHTML = `<div class="detail-icon big">${MISC_ICONS.lock}</div><h3>Undiscovered tool</h3><p class="muted">Keep gathering to learn how to make it. Once crafted, it can be upgraded three times.</p>`;
      return d;
    }
    const lv = toolLevel(s, tool);
    const upgradable = isUpgradable(tool);
    const lines = toolEffectLines(s, tool);
    const breakdown = upgradable ? toolBreakdown(s, tool) : '';
    const w = s.toolWear[tool];
    const wear = toolWears(tool) ? `<div class="effects muted">Condition ${w ? Math.max(1, Math.round(wearFraction(w) * 100)) : 100}% · upgrades stay with you when you make a new one</div>` : '';
    d.innerHTML = `<div class="detail-icon big">${toolIcon(tool)}</div><h3>${escapeHtml(def.name)} ${upgradable ? levelPips(lv) : ''}</h3><p>${escapeHtml(def.description)}</p>${lines.length ? `<div class="effects">${lines.map(escapeHtml).join('<br>')}</div>` : ''}${breakdown ? `<div class="effects muted breakdown">${escapeHtml(breakdown)}</div>` : ''}${wear}`;
    if (!upgradable) {
      d.append(el('div', 'effects muted', 'Your bare hands. Nothing to upgrade here.'));
      return d;
    }
    const up = nextToolUpgrade(s, tool);
    if (!up) {
      d.append(el('div', 'upgrade-next maxed', `<h4>${MISC_ICONS.upgrade} Fully upgraded</h4><p class="muted">This is as good as a ${escapeHtml(def.name.toLowerCase())} gets.</p>`));
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
    d.append(box);
    return d;
  }

  private upgradesBody(): HTMLElement {
    const sim = this.host.sim();
    const s = sim.state;
    const body = el('div', 'panel-body craft-body');
    const list = el('div', 'recipe-list');
    const owned = UPGRADABLE_TOOLS.filter((t) => s.tools.includes(t));
    if (!this.selectedTool || !isUpgradable(this.selectedTool) || !owned.includes(this.selectedTool)) {
      this.selectedTool = owned.find((t) => sim.canUpgradeTool(t).ok) ?? owned[0] ?? null;
    }
    for (const t of owned) {
      const lv = toolLevel(s, t);
      const check = sim.canUpgradeTool(t);
      const status = check.ok ? 'Ready' : check.reason === 'maxed' ? 'Max level' : 'Missing items';
      const row = el('button', `recipe ${check.ok ? 'ready' : ''} ${check.reason === 'maxed' ? 'owned' : ''} ${t === this.selectedTool ? 'selected' : ''}`);
      row.type = 'button';
      row.innerHTML = `<span class="recipe-icon">${toolIcon(t)}</span><span class="recipe-name">${escapeHtml(TOOLS[t].name)} ${levelPips(lv)}</span><span class="recipe-status">${status}</span>`;
      row.addEventListener('click', () => {
        this.selectedTool = t;
        this.host.sfx('click');
        this.render();
      });
      list.append(row);
    }
    const missing = UPGRADABLE_TOOLS.length - owned.length;
    if (!owned.length) list.append(el('div', 'recipe-empty', 'Craft a tool first. Every tool and weapon can then be upgraded three times.'));
    if (missing > 0) list.append(el('div', 'recipe-unknown', `${missing} more tool${missing === 1 ? '' : 's'} to craft`));
    const detail = this.selectedTool ? this.toolDetail(this.selectedTool) : el('div', '', '<div class="detail-empty"><p>No tools to upgrade yet.</p></div>');
    detail.classList.add('recipe-detail');
    body.append(list, detail);
    return body;
  }

  // ------------------------------------------------------------------ foraging guide

  private forageBody(pages: ForagePage[]): HTMLElement {
    const s = this.host.sim().state;
    const body = el('div', 'panel-body forage-body');
    const grid = el('div', 'forage-grid');
    if (!this.selectedForage || !pages.some((p) => p.entry.id === this.selectedForage)) {
      this.selectedForage = pages.find((p) => p.unlocked)?.entry.id ?? pages[0]?.entry.id ?? null;
    }
    pages.forEach((p, i) => {
      const card = button(
        `<span class="forage-no">No. ${String(i + 1).padStart(2, '0')}</span>${p.unlocked ? itemIcon(p.entry.item) : MISC_ICONS.lock}<span class="forage-name">${p.unlocked ? escapeHtml(p.entry.name) : '???'}</span>`,
        `forage-card ${p.unlocked ? '' : 'locked'} ${p.entry.id === this.selectedForage ? 'selected' : ''}`,
        () => {
          this.selectedForage = p.entry.id;
          this.host.sfx('click');
          this.render();
        },
      );
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
      const recipes = page.recipes.length ? page.recipes.join(', ') : 'No known recipes yet';
      const more = page.undiscovered ? ` <span class="muted">(${page.undiscovered} more to discover)</span>` : '';
      const ups = page.upgrades ? `<div class="forage-row"><b>Upgrades</b><span>Used in ${page.upgrades} tool or shelter upgrade${page.upgrades === 1 ? '' : 's'}</span></div>` : '';
      const found = s.stats.gathered[e.item] ?? 0;
      detail.innerHTML = `<div class="detail-icon big">${itemIcon(e.item)}</div><h3>${escapeHtml(e.name)}</h3><div class="forage-latin">${escapeHtml(e.latin)}</div><p>${escapeHtml(e.use)}</p><div class="effects">${escapeHtml(eats)}</div><div class="forage-row"><b>Gives</b><span>${escapeHtml(item.name)}${found ? ` <span class="muted">· ${found} gathered so far</span>` : ''}</span></div><div class="forage-row"><b>Recipes</b><span>${escapeHtml(recipes)}${more}</span></div>${ups}<div class="forage-row"><b>Habitat</b><span>${escapeHtml(e.habitat)}</span></div><div class="forage-row"><b>Regrows</b><span>About ${page.regrowHours} h after it is picked clean</span></div><div class="forage-notes">${escapeHtml(e.notes)}</div>`;
    }
    body.append(grid, detail);
    return body;
  }

  // ------------------------------------------------------------------ crafting

  private renderCrafting(): void {
    const sim = this.host.sim();
    const s = sim.state;
    const head = this.head('Crafting', this.tab === 'upgrades' ? 'Each tool and weapon has three upgrade levels, each much costlier than the last.' : 'You learn new recipes by gathering, hunting and exploring.');

    const tabs = el('div', 'tabs');
    for (const t of TABS) {
      const ready = t === 'upgrades'
        ? UPGRADABLE_TOOLS.filter((tool) => sim.canUpgradeTool(tool).ok).length
        : RECIPES.filter((r) => s.known.includes(r.id) && (t === 'all' || r.category === t) && sim.canCraft(r.id).ok).length;
      const label = t === 'all' ? 'All' : t === 'upgrades' ? `${MISC_ICONS.upgrade} Upgrades` : CATEGORY_LABELS[t];
      tabs.append(button(`${label}${ready ? ` <span class="tab-badge">${ready}</span>` : ''}`, `tab ${t === 'upgrades' ? 'tab-upgrades' : ''} ${this.tab === t ? 'active' : ''}`, () => {
        this.tab = t;
        this.selectedRecipe = null;
        this.host.sfx('click');
        this.render();
      }));
    }

    if (this.tab === 'upgrades') {
      this.card.append(head, tabs, this.upgradesBody());
      return;
    }
    const inTab = (r: Recipe) => this.tab === 'all' || r.category === this.tab;
    const empty = this.tab === 'cooking' ? 'Gather ingredients like chanterelles, onions and berries to learn meals.' : 'Nothing here yet. Keep gathering.';
    this.card.append(head, tabs, this.recipeBody(inTab, empty));
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

    this.card.append(head, fuelRow, this.recipeBody(isCampfireRecipe, 'Gather ingredients like chanterelles, onions and berries, or fill a canteen at the lake, to learn campfire recipes.'));
  }

  // ------------------------------------------------------------------ structures

  /** A shelter's own menu: sleep in it, or upgrade it into the next tier in place. */
  private renderStructure(): void {
    const sim = this.host.sim();
    const id = this.targetId;
    const m = id !== null ? shelterMenu(sim, id) : null;
    if (!m || id === null) {
      this.card.append(this.head('Shelter', 'This shelter is gone.'));
      return;
    }
    const head = this.head(`${MISC_ICONS[m.prefab]} ${escapeHtml(m.name)}`, `Tier ${m.tier} of ${m.tiers}${m.condition !== null ? ` · condition ${m.condition}%` : ''}`);
    const ladder = el('div', 'tier-ladder');
    ladder.innerHTML = SHELTER_TIERS.map((p, i) => `<div class="tier ${i + 1 < m.tier ? 'done' : i + 1 === m.tier ? 'current' : ''}">${MISC_ICONS[p]}<span>${escapeHtml(PREFABS[p].name)}</span></div>`).join('<i class="tier-arrow">›</i>');

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

    const upg = el('div', 'structure-upgrade');
    const n = m.next;
    if (!n) {
      upg.innerHTML = `<h3>${MISC_ICONS.upgrade} Fully upgraded</h3><p class="muted">This is the finest shelter you can build in these woods.</p>`;
    } else {
      upg.innerHTML = `<h3>${MISC_ICONS.upgrade} Upgrade to ${escapeHtml(n.name)}</h3><p>${escapeHtml(n.text)}</p><div class="effects">${escapeHtml(n.rest)}</div>${ingredientsHtml(n.inputs)}`;
      const ua = el('div', 'detail-actions');
      const go = button('Upgrade', `btn primary ${n.check.ok ? '' : 'disabled'}`, () => {
        const res = sim.upgradeShelter(id);
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
    }
    body.append(rest, upg);
    this.card.append(head, ladder, body);
  }

  // ------------------------------------------------------------------ recipes

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
      detail.innerHTML = `<div class="detail-icon big">${recipeIcon(r)}</div><h3>${escapeHtml(r.name)}</h3><p>${escapeHtml(r.description)}</p><div class="effects">${escapeHtml(outText)}</div>${note}${shelterNote}${station}${inputs}`;
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
