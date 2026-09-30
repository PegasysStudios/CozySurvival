// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { recipesFor } from '../src/data/recipes';
import { PREFABS } from '../src/data/prefabs';
import { BIN_UPGRADES, SHELTER_TIERS, SHELTER_UPGRADES, UPGRADABLE_TOOLS } from '../src/data/upgrades';
import { hasAll } from '../src/sim/inventory';
import type { Simulation } from '../src/sim/simulation';
import { campfireTiles, craftTiles, UPGRADE_ONLY_SHELTERS, upgradeTiles } from '../src/ui/catalog';
import { attachTooltip, el } from '../src/ui/dom';
import { CRAFT_TABS, Panels } from '../src/ui/panels';
import { BALANCE } from '../src/data/balance';
import { countItem } from '../src/sim/inventory';
import { repairCost } from '../src/sim/repair';
import { buildFresh, give, giveRecipe, placeShelter, placeStructure, quietSim, teleport } from './helpers';

const RECIPES = recipesFor('pnw');

function openPanels(sim: Simulation): { panels: Panels; root: HTMLElement } {
  const root = document.createElement('div');
  document.body.append(root);
  const panels = new Panels(root, { sim: () => sim, sfx: () => {}, close: () => panels.close(), toast: () => {} });
  return { panels, root };
}

const tiles = (root: HTMLElement, sel = '.tile') => [...root.querySelectorAll<HTMLElement>(`.panel ${sel}`)];
const hover = (t: HTMLElement) => t.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

describe('all recipes visible from the start (round 6)', () => {
  it('a new character sees every recipe plus the upgrade-only shelters, all greyed out', () => {
    const sim = quietSim();
    const all = craftTiles(sim, 'all');
    expect(all.filter((t) => t.kind === 'recipe').map((t) => t.id)).toEqual(RECIPES.map((r) => r.id));
    expect(all.filter((t) => t.kind === 'shelter').map((t) => t.id)).toEqual(UPGRADE_ONLY_SHELTERS);
    expect(all.every((t) => t.greyed && !t.ready)).toBe(true);
    expect(all.find((t) => t.id === 'rod')!.name).toBe('Fishing Pole');
  });

  it('greys a tile exactly when the pack lacks its materials', () => {
    const sim = quietSim();
    give(sim, { stick: 6, stone: 6, fiber: 6 });
    for (const t of craftTiles(sim, 'all').filter((x) => x.kind === 'recipe')) {
      const r = RECIPES.find((x) => x.id === t.id)!;
      expect(t.greyed, r.id).toBe(!hasAll(sim.state.inventory, r.inputs));
    }
    const axe = craftTiles(sim, 'tools').find((t) => t.id === 'axe')!;
    expect(axe).toMatchObject({ greyed: false, ready: true, badge: null });
    expect(sim.craft('axe').ok).toBe(true);
    expect(craftTiles(sim, 'tools').find((t) => t.id === 'axe')).toMatchObject({ greyed: true, ready: false, badge: 'owned' });
  });

  it('a cooking recipe with its ingredients but no fire is not greyed, just flagged as needing a fire', () => {
    const sim = quietSim();
    give(sim, { rawMeat: 1 });
    const meat = craftTiles(sim, 'cooking').find((t) => t.id === 'cookedMeat')!;
    expect(meat).toMatchObject({ greyed: false, ready: false, badge: 'fire' });
  });

  it('shows every tool upgrade and each upgrade line from the start, with how each is reached', () => {
    const sim = quietSim();
    const ups = upgradeTiles(sim);
    expect(ups.map((t) => t.key)).toEqual([...UPGRADABLE_TOOLS.map((t) => `t:${t}`), 'l:shelter', 'l:storage']);
    expect(ups.every((t) => t.greyed)).toBe(true);
    const { panels, root } = openPanels(sim);
    panels.open('crafting', { tab: 'upgrades' });
    expect(tiles(root).length).toBe(ups.length);
    tiles(root).find((t) => t.dataset.key === 't:rod')!.click();
    const rod = root.querySelector('.recipe-detail')!.textContent!;
    expect(rod).toContain('Craft the Fishing Pole first');
    for (const u of ['Bark Float', 'Weighted Line', "Angler's Pole"]) expect(rod).toContain(u);
    tiles(root).find((t) => t.dataset.key === 'l:shelter')!.click();
    const shelter = root.querySelector('.recipe-detail')!;
    expect(shelter.textContent).toContain('Build a Lean-to Shelter from the Build tab first. It can then be upgraded three times');
    expect([...shelter.querySelectorAll('.tier span')].map((s) => s.textContent)).toEqual(SHELTER_TIERS.map((p) => PREFABS[p].name));
  });

  it('the crafting grid renders one greyed tile per recipe and the selected tile shows materials and Craft', () => {
    const sim = quietSim();
    give(sim, { stick: 6, stone: 6, fiber: 6 });
    const { panels, root } = openPanels(sim);
    panels.open('crafting');
    let recipeCount = 0;
    let greyed = 0;
    for (const tab of CRAFT_TABS.filter((t) => t.id !== 'upgrades')) {
      root.querySelector<HTMLElement>(`.craft-tab[data-tab="${tab.id}"]`)!.click();
      recipeCount += tiles(root, '.tile.recipe').length;
      greyed += tiles(root, '.tile.recipe.greyed').length;
    }
    expect(recipeCount).toBe(RECIPES.length);
    expect(greyed).toBe(craftTiles(sim, 'all').filter((t) => t.kind === 'recipe' && t.greyed).length);
    expect(root.querySelector('.panel .recipe-list')).toBeNull();
    // the first ready tile starts selected
    root.querySelector<HTMLElement>('.craft-tab[data-tab="materials"]')!.click();
    expect(root.querySelector('.tile.selected')!.getAttribute('data-key')).toBe('r:cordage');
    root.querySelector<HTMLElement>('.craft-tab[data-tab="tools"]')!.click();
    const recipeTiles = tiles(root, '.tile.recipe');
    recipeTiles.find((t) => t.dataset.key === 'r:axe')!.click();
    const detail = root.querySelector('.recipe-detail')!;
    expect(detail.querySelector('h3')!.textContent).toBe('Stone Axe');
    expect(detail.querySelectorAll('.ingredient.ok').length).toBe(3);
    const craft = detail.querySelector<HTMLButtonElement>('.btn.primary')!;
    expect(craft.textContent).toBe('Craft');
    expect(craft.disabled).toBe(false);
    recipeTiles.find((t) => t.dataset.key === 'r:bow')!.click();
    const bow = root.querySelector('.recipe-detail')!;
    expect(bow.querySelector('h3')!.textContent).toBe('Bow');
    expect(bow.querySelector<HTMLButtonElement>('.btn.primary')!.disabled).toBe(true);
  });

  it('the campfire menu is a grid of every fire recipe with Cook as the action', () => {
    const sim = quietSim();
    const fire = buildFresh(sim, 'campfire');
    give(sim, { rawMeat: 1 });
    const { panels, root } = openPanels(sim);
    panels.open('campfire', { targetId: fire.id });
    const fireRecipes = RECIPES.filter((r) => r.station === 'fire');
    expect(tiles(root, '.tile.recipe').map((t) => t.dataset.key)).toEqual(fireRecipes.map((r) => `r:${r.id}`));
    expect(campfireTiles(sim, fireRecipes).find((t) => t.id === 'cookedMeat')!.ready).toBe(true);
    const detail = root.querySelector('.recipe-detail')!;
    expect(detail.querySelector('h3')!.textContent).toBe('Roast Meat');
    expect(detail.querySelector('.btn.primary')!.textContent).toBe('Cook');
  });

  it('the pack shows the tool belt and gear as tiles, unmade ones greyed but named', () => {
    const sim = quietSim();
    sim.state.tools.push('axe');
    sim.state.toolLevels.axe = 2;
    const { panels, root } = openPanels(sim);
    panels.open('inventory', { view: 'pack' });
    const names = tiles(root, '.inv-section .tile').map((t) => [t.dataset.tip, t.classList.contains('greyed')]);
    expect(names).toEqual([
      ['Hands', false], ['Stone Axe II', false], ['Spear', true], ['Bow', true], ['Torch', true], ['Fishing Pole', true], ['Stone Knife', true],
      ['Grass Basket', true], ['Hide Backpack', true], ['Bark Canteen', true],
    ]);
    expect(root.textContent).not.toContain('???');
  });
});

describe('tile tooltip (round 6)', () => {
  it("fades in the hovered tile's name and hides when the pointer leaves", () => {
    const sim = quietSim();
    const { panels, root } = openPanels(sim);
    panels.open('crafting', { tab: 'tools' });
    const tip = root.querySelector<HTMLElement>('.tile-tip')!;
    expect(tip.classList.contains('show')).toBe(false);
    const axe = tiles(root).find((t) => t.dataset.key === 'r:axe')!;
    expect(axe.getAttribute('title')).toBeNull();
    hover(axe);
    expect(tip.classList.contains('show')).toBe(true);
    expect(tip.textContent).toBe('Stone Axe');
    hover(tiles(root).find((t) => t.dataset.key === 'r:rod')!);
    expect(tip.textContent).toBe('Fishing Pole');
    root.querySelector('.panel .tile-grid')!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: root.querySelector('.panel-head') }));
    expect(tip.classList.contains('show')).toBe(false);
  });

  it('works on pack slots and ignores elements without a tip', () => {
    const root = el('div');
    const tip = el('div', 'tile-tip');
    root.innerHTML = '<button data-tip="Salmonberries"><span class="inner">x</span></button><p class="plain">no tip</p>';
    attachTooltip(root, tip);
    root.querySelector('.inner')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect([tip.textContent, tip.classList.contains('show')]).toEqual(['Salmonberries', true]);
    root.querySelector('.plain')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tip.classList.contains('show')).toBe(false);
  });

  it('the CSS fades it in quickly rather than popping', async () => {
    const css = (await import('node:fs')).readFileSync('src/styles.css', 'utf8');
    const rule = /\.tile-tip \{[^}]*\}/.exec(css)![0];
    expect(rule).toContain('opacity: 0');
    const ms = Number(/transition: opacity ([\d.]+)s/.exec(rule)![1]) * 1000;
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(200);
  });
});

describe('tabbed crafting menu (round 8)', () => {
  const tabs = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.panel .craft-tab')];

  it('opens on Tools with one icon tab per category, named on hover, the active one highlighted', () => {
    const sim = quietSim();
    const { panels, root } = openPanels(sim);
    panels.open('crafting');
    const row = tabs(root);
    expect(row.map((t) => t.dataset.tab)).toEqual(['tools', 'structures', 'cooking', 'upgrades', 'gear', 'materials']);
    expect(row.map((t) => t.dataset.tip)).toEqual(['Tools', 'Build', 'Cooking', 'Upgrades', 'Gear', 'Materials']);
    expect(row.map((t) => t.querySelector('img')!.getAttribute('src')!.split('/').slice(-2).join('/'))).toEqual(
      ['tools', 'building', 'cooking', 'upgrades', 'gear', 'materials'].map((f) => `crafting-tabs/${f}.png`),
    );
    expect(row.filter((t) => t.classList.contains('active')).map((t) => t.dataset.tab)).toEqual(['tools']);
    expect(row[0].getAttribute('aria-selected')).toBe('true');
    const tip = root.querySelector<HTMLElement>('.tile-tip')!;
    hover(row[2]);
    expect([tip.textContent, tip.classList.contains('show')]).toEqual(['Cooking', true]);

    row[1].click();
    expect(tabs(root).filter((t) => t.classList.contains('active')).map((t) => t.dataset.tab)).toEqual(['structures']);
    expect(tiles(root, '.tile.recipe').map((t) => t.dataset.key)).toEqual(RECIPES.filter((r) => r.category === 'structures').map((r) => `r:${r.id}`));
    expect(tiles(root).some((t) => t.dataset.key === 'r:workbench') && tiles(root).some((t) => t.dataset.key === 'r:storageBin')).toBe(true);
    tabs(root)[3].click();
    expect(tiles(root).length).toBe(upgradeTiles(sim).length);
  });

  it('keeps the tab row and the grid together in the left column, apart from the detail panel', () => {
    const sim = quietSim();
    const { panels, root } = openPanels(sim);
    panels.open('crafting', { tab: 'cooking' });
    const left = root.querySelector('.panel .craft-body > .craft-left')!;
    expect([...left.children].map((c) => c.className)).toEqual(['craft-tabs', 'tile-grid']);
    expect(root.querySelector('.panel .craft-body > .recipe-detail')).not.toBeNull();
    expect(root.querySelector('.recipe-detail .craft-tab')).toBeNull();
    expect(root.querySelector('.panel > .tabs')).toBeNull();
  });

  it('badges a tab with how many of its recipes you can make now', () => {
    const sim = quietSim();
    give(sim, { stick: 6, stone: 6, fiber: 6 });
    const { panels, root } = openPanels(sim);
    panels.open('crafting');
    const badge = (id: string) => root.querySelector(`.craft-tab[data-tab="${id}"] .tab-badge`)?.textContent ?? null;
    expect(badge('tools')).toBe(String(RECIPES.filter((r) => r.category === 'tools' && sim.canCraft(r.id).ok).length));
    expect(badge('gear')).toBeNull();
  });

  it('the CSS never shrinks the tab icons, and sizes the left column to fit the whole row', async () => {
    const css = (await import('node:fs')).readFileSync('src/styles.css', 'utf8');
    const rule = (sel: string) => new RegExp(`\\n${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`).exec(css)![1];
    const tab = rule('.craft-tab');
    expect(tab).toContain('flex: none');
    const w = Number(/width: (\d+)px/.exec(tab)![1]);
    const gap = Number(/gap: (\d+)px/.exec(rule('.craft-tabs'))![1]);
    const min = Number(/minmax\((\d+)px/.exec(rule('.craft-tabbed'))![1]);
    expect(min).toBeGreaterThanOrEqual(CRAFT_TABS.length * w + (CRAFT_TABS.length - 1) * gap);
    expect(rule('.craft-tab .icon-img')).toContain('flex: none');
  });
});

describe('the workbench menu as an icon grid (round 9)', () => {
  /** A workbench, a worn axe with its repair materials, a worn spear without them, and a torch in perfect condition. */
  function workbench() {
    const sim = quietSim();
    const bench = placeStructure(sim, 'workbench');
    for (const tool of ['axe', 'spear', 'torch'] as const) {
      giveRecipe(sim, tool);
      expect(sim.craft(tool).ok).toBe(true);
    }
    const s = sim.state;
    s.toolWear.axe!.dur = s.toolWear.axe!.max / 4;
    s.toolWear.spear!.dur = 1;
    s.inventory.slots.fill(null);
    give(sim, Object.fromEntries(repairCost('axe', 0).map((c) => [c.item, c.count])));
    const { panels, root } = openPanels(sim);
    panels.open('structure', { targetId: bench.id });
    const tile = (tool: string) => root.querySelector<HTMLElement>(`.panel .tile-grid .tile[data-key="w:${tool}"]`)!;
    const detail = () => root.querySelector<HTMLElement>('.panel .repair-detail')!;
    return { sim, bench, panels, root, tile, detail };
  }

  it('has one crafting-style tile per carried tool that wears, greyed exactly when the repair materials are missing', () => {
    const { sim, root, tile } = workbench();
    expect(tiles(root, '.tile-grid .tile').map((t) => t.dataset.key)).toEqual(['w:axe', 'w:spear', 'w:torch']);
    for (const tool of ['axe', 'spear', 'torch'] as const) {
      const missing = repairCost(tool, 0).some((c) => countItem(sim.state.inventory, c.item) < c.count);
      expect(tile(tool).classList.contains('greyed'), tool).toBe(missing);
    }
    expect(tile('axe').classList.contains('greyed')).toBe(false);
    expect(tile('axe').classList.contains('ready')).toBe(true);
    expect(tile('spear').classList.contains('greyed')).toBe(true);
    expect(tile('torch').querySelector('.tile-badge.owned')).not.toBeNull();
    expect(tile('axe').querySelector<HTMLElement>('.dur i')!.style.transform).toBe('scaleX(0.250)');
    expect(tile('spear').querySelector('.dur.low')).not.toBeNull();
    expect(tile('axe').dataset.tip).toBe('Stone Axe · 25%');
  });

  it('drops the "how repairs work" section', () => {
    const { root } = workbench();
    expect(root.querySelector('.workbench-info, .repair-table, .repair-list, .repair-row')).toBeNull();
    expect(root.textContent).not.toContain('How repairs work');
  });

  it("clicking a tile shows that tool's durability, materials as have/need, repair time and the Repair button", () => {
    const { root, tile, detail } = workbench();
    expect(tile('axe').classList.contains('selected')).toBe(true);
    expect(detail().dataset.tool).toBe('axe');
    expect(detail().querySelector('.repair-cond span')!.textContent).toBe('25%');
    expect(detail().textContent).toContain('uses left');
    expect([...detail().querySelectorAll('.ingredient')].map((i) => i.querySelector('b')!.textContent)).toEqual(['1/1', '1/1', '1/1']);
    expect(detail().querySelector('.repair-time')!.textContent).toContain(`${BALANCE.repair.seconds[0]} s`);
    expect(detail().querySelector<HTMLButtonElement>('.btn.primary')!.disabled).toBe(false);

    tile('spear').click();
    expect(tile('spear').classList.contains('selected')).toBe(true);
    expect(detail().dataset.tool).toBe('spear');
    expect(detail().querySelectorAll('.ingredient.missing').length).toBeGreaterThan(0);
    expect(detail().querySelector<HTMLButtonElement>('.btn.primary')!.disabled).toBe(true);
    expect(detail().querySelector('.craft-reason')!.textContent).toBe('Missing materials.');

    tile('torch').click();
    expect(detail().textContent).toContain('In perfect condition');
    expect(detail().querySelector<HTMLButtonElement>('.btn.primary')!.disabled).toBe(true);
    expect(root.querySelectorAll('.panel .repair-detail')).toHaveLength(1);
  });

  it('Repair starts mending the selected tool and closes the menu', () => {
    const { sim, panels, detail } = workbench();
    detail().querySelector<HTMLButtonElement>('.btn.primary')!.click();
    expect(sim.state.repair?.tool).toBe('axe');
    expect(panels.mode).toBe('none');
  });

  it('explains what to bring when nothing carried wears', () => {
    const sim = quietSim();
    const bench = placeStructure(sim, 'workbench');
    const { panels, root } = openPanels(sim);
    panels.open('structure', { targetId: bench.id });
    expect(root.querySelector('.panel .tile-grid')).toBeNull();
    expect(root.querySelector('.panel .detail-empty')!.textContent).toContain("You aren't carrying anything that wears.");
  });
});

describe('the storage bin menu layout (round 9)', () => {
  it('stacks In storage over Your pack in the left column, with the upgrade panel on the right', () => {
    const sim = quietSim();
    const bin = placeStructure(sim, 'storageBin');
    const { panels, root } = openPanels(sim);
    panels.open('structure', { targetId: bin.id });
    const body = root.querySelector<HTMLElement>('.panel .storage-body')!;
    expect([...body.children].map((c) => c.className)).toEqual(['storage-left', 'structure-upgrade']);
    const left = body.querySelector('.storage-left')!;
    expect([...left.children].map((c) => c.querySelector('h3')!.textContent!.replace(/\d+\/\d+/, '').trim())).toEqual(['In storage', 'Your pack']);
    expect(left.querySelectorAll('.store-grid .slot')).toHaveLength(10);
    const upgrade = body.querySelector('.structure-upgrade')!;
    expect(upgrade.querySelector('h3')!.textContent).toMatch(/^.*Upgrade to /);
    expect(upgrade.querySelectorAll('.ingredient').length).toBeGreaterThan(0);
    expect(upgrade.querySelector('.btn.primary')!.textContent).toBe('Upgrade');
    expect(root.querySelector('.storage-foot')).toBeNull();
  });

  it('keeps slots at full size: the left column never narrows below five 64px slots, so the upgrade panel gives way first', async () => {
    const css = (await import('node:fs')).readFileSync('src/styles.css', 'utf8');
    const rule = (sel: string) => new RegExp(`\\n${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`).exec(css)![1];
    const cols = /grid-template-columns: minmax\((\d+)px, [\d.]+fr\) minmax\(0, 1fr\);/.exec(rule('.storage-body'));
    expect(cols).not.toBeNull();
    expect(Number(cols![1])).toBeGreaterThanOrEqual(5 * 64 + 4 * 8 + 2 * 16 + 2);
    expect(rule('.store-grid,\n.pack-grid')).toContain('minmax(64px, 1fr)');
  });
});

describe('Upgrades tab polish (round 9)', () => {
  function upgradesTab(sim: Simulation) {
    const { panels, root } = openPanels(sim);
    panels.open('crafting', { tab: 'upgrades' });
    const tile = (key: string) => root.querySelector<HTMLElement>(`.panel .tile-grid .tile[data-key="${key}"]`)!;
    const lit = (key: string) => tile(key).querySelectorAll('.level-pips i.on').length;
    const detail = () => root.querySelector<HTMLElement>('.panel .recipe-detail')!;
    return { panels, root, tile, lit, detail };
  }

  /** Room for the bigger tiers' materials all at once. */
  function roomy(sim: Simulation): void {
    sim.state.gear.push('basket', 'backpack');
    sim.state.inventory.slots.push(...Array(20).fill(null));
  }

  it('centres the three tier diamonds on tool tiles and pins them to the bottom', async () => {
    const css = (await import('node:fs')).readFileSync('src/styles.css', 'utf8');
    const rule = /\n\.tile \.level-pips \{([^}]*)\}/.exec(css)![1];
    for (const decl of ['position: absolute;', 'left: 0;', 'right: 0;', 'margin: 0;', 'justify-content: center;']) expect(rule).toContain(decl);
    expect(rule).toMatch(/bottom: \d+px;/);
    expect(rule).not.toContain('translateX');
    const { tile } = upgradesTab(quietSim());
    for (const t of UPGRADABLE_TOOLS) expect(tile(`t:${t}`).querySelectorAll('.level-pips i')).toHaveLength(3);
  });

  it('collapses the shelter tiers into one Shelter tile whose diamonds show the current tier', () => {
    const sim = quietSim();
    let ui = upgradesTab(sim);
    expect(ui.root.querySelector('.panel .tile[data-key^="s:"]')).toBeNull();
    expect(ui.tile('l:shelter').classList.contains('greyed')).toBe(true);
    expect(ui.tile('l:shelter').querySelectorAll('.level-pips i')).toHaveLength(3);
    expect(ui.lit('l:shelter')).toBe(0);
    placeShelter(sim, 'barkHut');
    ui = upgradesTab(sim);
    expect(ui.lit('l:shelter')).toBe(2);
    expect(ui.tile('l:shelter').dataset.tip).toBe('Shelter · Bark Hut');
  });

  it("selecting the Shelter tile shows the next tier's cost, what improves and an Upgrade button that rebuilds it in place", () => {
    const sim = quietSim();
    roomy(sim);
    const lean = placeShelter(sim, 'leanTo');
    const ui = upgradesTab(sim);
    ui.tile('l:shelter').click();
    const d = ui.detail();
    expect(d.dataset.line).toBe('shelter');
    expect(d.querySelector('h4')!.textContent).toContain('Upgrade to A-Frame Shelter');
    expect(d.textContent).toContain('Now: +');
    expect(d.textContent).toContain('After: +');
    expect(d.querySelectorAll('.ingredient')).toHaveLength(SHELTER_UPGRADES.aFrame!.length);
    expect(d.querySelector<HTMLButtonElement>('.btn.primary')!.disabled).toBe(true);
    expect(d.querySelector('.craft-reason')).not.toBeNull();

    give(sim, Object.fromEntries(SHELTER_UPGRADES.aFrame!.map((c) => [c.item, c.count])));
    ui.tile('l:shelter').click();
    expect(ui.tile('l:shelter').classList.contains('ready')).toBe(true);
    ui.detail().querySelector<HTMLButtonElement>('.btn.primary')!.click();
    const st = sim.state.structures.find((x) => x.id === lean.id)!;
    expect(st.prefab).toBe('aFrame');
    expect({ x: st.x, z: st.z }).toEqual({ x: lean.x, z: lean.z });
    expect(ui.lit('l:shelter')).toBe(1);
    expect(ui.detail().querySelector('h4')!.textContent).toContain('Upgrade to Bark Hut');
  });

  it('at the top tier the tile is marked MAX and the details say it is fully upgraded', () => {
    const sim = quietSim();
    placeShelter(sim, 'hideTent');
    const ui = upgradesTab(sim);
    expect(ui.lit('l:shelter')).toBe(3);
    expect(ui.tile('l:shelter').querySelector('.tile-badge.max')).not.toBeNull();
    ui.tile('l:shelter').click();
    expect(ui.detail().textContent).toContain('Fully upgraded');
    expect(ui.detail().querySelector('.btn.primary')).toBeNull();
  });

  it('works on the nearest shelter when there are several', () => {
    const sim = quietSim();
    const lean = placeShelter(sim, 'leanTo');
    teleport(sim, lean.x + 40, lean.z);
    const hut = placeShelter(sim, 'barkHut');
    expect(Math.hypot(hut.x - lean.x, hut.z - lean.z)).toBeGreaterThan(20);
    expect(upgradesTab(sim).lit('l:shelter')).toBe(2);
    teleport(sim, lean.x + 1, lean.z + 1);
    expect(upgradesTab(sim).lit('l:shelter')).toBe(0);
  });

  it('storage bins, crates and chests use the same single-tile pattern, with two diamonds', () => {
    const sim = quietSim();
    roomy(sim);
    const bin = placeStructure(sim, 'storageBin');
    const ui = upgradesTab(sim);
    expect(ui.tile('l:storage').querySelectorAll('.level-pips i')).toHaveLength(2);
    expect(ui.lit('l:storage')).toBe(0);
    give(sim, Object.fromEntries(BIN_UPGRADES.storageCrate!.map((c) => [c.item, c.count])));
    ui.tile('l:storage').click();
    expect(ui.detail().textContent).toContain('After: 15 slots');
    ui.detail().querySelector<HTMLButtonElement>('.btn.primary')!.click();
    const st = sim.state.structures.find((x) => x.id === bin.id)!;
    expect(st.prefab).toBe('storageCrate');
    expect(st.store).toHaveLength(15);
    expect(ui.lit('l:storage')).toBe(1);
  });
});
