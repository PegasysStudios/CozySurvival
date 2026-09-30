// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { recipesFor } from '../src/data/recipes';
import { SHELTER_UPGRADES, UPGRADABLE_TOOLS } from '../src/data/upgrades';
import { hasAll } from '../src/sim/inventory';
import type { Simulation } from '../src/sim/simulation';
import { campfireTiles, craftTiles, UPGRADE_ONLY_SHELTERS, upgradeTiles } from '../src/ui/catalog';
import { attachTooltip, el } from '../src/ui/dom';
import { Panels } from '../src/ui/panels';
import { buildFresh, give, quietSim } from './helpers';

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

  it('shows every tool upgrade and shelter tier from the start, with how each is reached', () => {
    const sim = quietSim();
    const ups = upgradeTiles(sim);
    expect(ups.map((t) => t.id)).toEqual([...UPGRADABLE_TOOLS, ...UPGRADE_ONLY_SHELTERS]);
    expect(ups.every((t) => t.greyed)).toBe(true);
    const { panels, root } = openPanels(sim);
    panels.open('crafting', { tab: 'upgrades' });
    expect(tiles(root).length).toBe(ups.length);
    tiles(root).find((t) => t.dataset.key === 't:rod')!.click();
    const rod = root.querySelector('.recipe-detail')!.textContent!;
    expect(rod).toContain('Craft the Fishing Pole first');
    for (const u of ['Bark Float', 'Weighted Line', "Angler's Pole"]) expect(rod).toContain(u);
    tiles(root).find((t) => t.dataset.key === 's:barkHut')!.click();
    const hut = root.querySelector('.recipe-detail')!;
    expect(hut.textContent).toContain('Only built by upgrading an A-Frame Shelter in place');
    expect(hut.querySelectorAll('.ingredient').length).toBe(SHELTER_UPGRADES.barkHut!.length);
  });

  it('the crafting grid renders one greyed tile per recipe and the selected tile shows materials and Craft', () => {
    const sim = quietSim();
    give(sim, { stick: 6, stone: 6, fiber: 6 });
    const { panels, root } = openPanels(sim);
    panels.open('crafting', { tab: 'all' });
    const recipeTiles = tiles(root, '.tile.recipe');
    expect(recipeTiles.length).toBe(RECIPES.length);
    const expectedGreyed = craftTiles(sim, 'all').filter((t) => t.kind === 'recipe' && t.greyed).length;
    expect(tiles(root, '.tile.recipe.greyed').length).toBe(expectedGreyed);
    expect(root.querySelector('.panel .recipe-list')).toBeNull();
    // the first ready tile starts selected
    expect(root.querySelector('.tile.selected')!.getAttribute('data-key')).toBe('r:cordage');
    tiles(root, '.tile.recipe').find((t) => t.dataset.key === 'r:axe')!.click();
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
      ['Hands', false], ['Stone Axe II', false], ['Spear', true], ['Bow', true], ['Torch', true], ['Fishing Pole', true],
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
