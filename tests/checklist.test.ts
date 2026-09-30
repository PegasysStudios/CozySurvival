// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { checklistNeeds, checklistReady, MAX_PINS, parsePins } from '../src/sim/checklist';
import { deserializeState, serializeState } from '../src/sim/save';
import type { Simulation } from '../src/sim/simulation';
import { Hud } from '../src/ui/hud';
import { Panels } from '../src/ui/panels';
import { buildFresh, drain, give, giveRecipe, quietSim } from './helpers';

function roomySim(): Simulation {
  const sim = quietSim();
  sim.state.inventory.slots.fill(null);
  sim.state.inventory.slots.push(...Array(12).fill(null));
  return sim;
}

function openCrafting(sim: Simulation, tab: 'tools' | 'cooking' = 'tools') {
  const root = document.createElement('div');
  document.body.append(root);
  const toasts: string[] = [];
  const panels = new Panels(root, { sim: () => sim, sfx: () => {}, close: () => panels.close(), toast: (t) => toasts.push(t) });
  panels.open('crafting', { tab });
  const tile = (id: string) => root.querySelector<HTMLElement>(`.panel .tile[data-key="r:${id}"]`)!;
  const click = (id: string, shiftKey: boolean) => tile(id).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey }));
  return { root, toasts, tile, click };
}

const rows = (sim: Simulation, nearFire = false) => checklistNeeds(sim.state, nearFire).map((n) => `${n.label} ${n.have}/${n.need}`);

function hudFor(sim: Simulation) {
  const root = document.createElement('div');
  document.body.append(root);
  const hud = new Hud(root);
  const card = root.querySelector<HTMLElement>('.hud-checklist')!;
  return {
    card,
    update: () => hud.update(sim, 0.2, 1),
    counts: () => [...card.querySelectorAll('.obj-need')].map((r) => `${r.querySelector('.obj-need-label')!.textContent} ${r.querySelector('.obj-need-count')!.textContent}`),
  };
}

describe('pinning a crafting checklist (round 9)', () => {
  it('shift-clicking a recipe pins it, and shift-clicking it again unpins it', () => {
    const sim = roomySim();
    const ui = openCrafting(sim);
    ui.click('axe', false);
    expect(sim.state.pinned).toBeUndefined();
    ui.click('axe', true);
    expect(sim.state.pinned).toEqual(['axe']);
    expect(ui.tile('axe').classList.contains('pinned')).toBe(true);
    expect(ui.tile('axe').querySelector('.tile-pin')).not.toBeNull();
    expect(ui.toasts.at(-1)).toBe('Pinned Stone Axe to your checklist');
    ui.click('axe', true);
    expect(sim.state.pinned).toBeUndefined();
    expect(ui.tile('axe').classList.contains('pinned')).toBe(false);
    expect(ui.toasts.at(-1)).toBe('Unpinned Stone Axe');
  });

  it('the recipe details have a Pin / Unpin button that does the same, for screens without a shift key', () => {
    const sim = roomySim();
    const ui = openCrafting(sim);
    ui.click('spear', false);
    const pinButton = () => ui.root.querySelector<HTMLButtonElement>('.panel .pin-btn')!;
    expect(pinButton().textContent).toContain('Pin');
    pinButton().click();
    expect(sim.state.pinned).toEqual(['spear']);
    expect(pinButton().textContent).toContain('Unpin');
    pinButton().click();
    expect(sim.state.pinned).toBeUndefined();
  });

  it(`holds up to ${MAX_PINS} recipes; pinning another replaces the oldest`, () => {
    const sim = roomySim();
    for (const id of ['campfire', 'axe', 'spear']) expect(sim.togglePin(id)).toEqual({ pinned: true, dropped: null });
    expect(sim.togglePin('bow')).toEqual({ pinned: true, dropped: 'campfire' });
    expect(sim.state.pinned).toEqual(['axe', 'spear', 'bow']);
    const ui = openCrafting(sim);
    ui.click('rod', true);
    expect(sim.state.pinned).toEqual(['spear', 'bow', 'rod']);
    expect(ui.toasts.at(-1)).toBe('Pinned Fishing Pole to your checklist, in place of Stone Axe');
    expect(sim.togglePin('bow')).toEqual({ pinned: false, dropped: null });
    expect(sim.state.pinned).toEqual(['spear', 'rod']);
  });

  it('refuses recipes that are not on this map', () => {
    const sim = roomySim();
    expect(sim.togglePin('desertSkewer')).toBeNull();
    expect(sim.togglePin('nope')).toBeNull();
    expect(sim.state.pinned).toBeUndefined();
  });
});

describe('live have/need counts on the checklist (round 9)', () => {
  it('lists every ingredient as have/need and follows the pack as it fills', () => {
    const sim = roomySim();
    sim.togglePin('axe');
    expect(rows(sim)).toEqual(['Sticks 0/6', 'Stones 0/6', 'Plant Fiber 0/6']);
    give(sim, { stick: 4, stone: 9 });
    expect(rows(sim)).toEqual(['Sticks 4/6', 'Stones 6/6', 'Plant Fiber 0/6']);
    expect(checklistReady(checklistNeeds(sim.state, false))).toBe(false);
    give(sim, { stick: 2, fiber: 6 });
    expect(rows(sim)).toEqual(['Sticks 6/6', 'Stones 6/6', 'Plant Fiber 6/6']);
    expect(checklistReady(checklistNeeds(sim.state, false))).toBe(true);
  });

  it('sums shared materials across pinned recipes, so the same stones are not counted twice', () => {
    const sim = roomySim();
    sim.togglePin('campfire');
    sim.togglePin('spear');
    give(sim, { stone: 12, stick: 20 });
    expect(rows(sim)).toEqual(['Stones 12/30', 'Sticks 20/35', 'Plant Fiber 0/5', 'Cordage 0/5']);
  });

  it('counts canteen water, and a cooked recipe adds a lit campfire nearby row', () => {
    const sim = roomySim();
    sim.state.gear.push('canteen');
    sim.state.canteen.lakeWater = 2;
    sim.togglePin('boilWater');
    expect(rows(sim)).toEqual(['Lake Water 1/1', 'Lit campfire nearby 0/1']);
    expect(rows(sim, true)).toEqual(['Lake Water 1/1', 'Lit campfire nearby 1/1']);
    buildFresh(sim, 'campfire');
    expect(sim.isNearLitFire()).toBe(true);
    expect(checklistReady(checklistNeeds(sim.state, sim.isNearLitFire()))).toBe(true);
  });

  it('the HUD card sits under the goals panel in its style, updates live and says when it is ready', () => {
    const sim = roomySim();
    const hud = hudFor(sim);
    hud.update();
    expect(hud.card.classList.contains('show')).toBe(false);
    expect(hud.card.parentElement!.firstElementChild!.classList.contains('hud-objective')).toBe(true);
    sim.togglePin('axe');
    hud.update();
    expect(hud.card.classList.contains('show')).toBe(true);
    expect(hud.card.querySelector('.obj-title')!.textContent).toBe('Stone Axe');
    expect(hud.counts()).toEqual(['Sticks 0/6', 'Stones 0/6', 'Plant Fiber 0/6']);
    give(sim, { stick: 3 });
    hud.update();
    expect(hud.counts()).toEqual(['Sticks 3/6', 'Stones 0/6', 'Plant Fiber 0/6']);
    giveRecipe(sim, 'axe');
    hud.update();
    expect(hud.card.classList.contains('ready')).toBe(true);
    expect(hud.card.querySelector('.obj-step')!.textContent).toBe('Ready to craft');
    expect(hud.card.querySelectorAll('.obj-need.done')).toHaveLength(3);
    sim.togglePin('cordage');
    hud.update();
    expect(hud.card.querySelector('.obj-title')!.textContent).toBe('Stone Axe + Cordage');
    sim.togglePin('axe');
    sim.togglePin('cordage');
    hud.update();
    expect(hud.card.classList.contains('show')).toBe(false);
  });
});

describe('what happens to a pin when it is made (round 9)', () => {
  it('tools and buildings come off the checklist once made; items stay pinned for the next batch', () => {
    const sim = roomySim();
    sim.togglePin('axe');
    sim.togglePin('cordage');
    sim.togglePin('campfire');
    giveRecipe(sim, 'axe');
    drain(sim);
    expect(sim.craft('axe').ok).toBe(true);
    expect(drain(sim)).toContainEqual({ type: 'checklistDone', recipe: 'axe' });
    expect(sim.state.pinned).toEqual(['cordage', 'campfire']);
    giveRecipe(sim, 'cordage');
    expect(sim.craft('cordage').ok).toBe(true);
    expect(sim.state.pinned).toEqual(['cordage', 'campfire']);
    giveRecipe(sim, 'campfire');
    expect(sim.craft('campfire').ok).toBe(true);
    expect(sim.state.pinned).toEqual(['cordage', 'campfire']);
    sim.cancelPlacement();
    buildFresh(sim, 'campfire');
    expect(sim.state.pinned).toEqual(['cordage']);
  });

  it('pins survive a save and reload, and a save with junk in its pins still loads', () => {
    const sim = roomySim();
    sim.togglePin('spear');
    sim.togglePin('boilWater');
    expect(deserializeState(serializeState(sim.state))!.pinned).toEqual(['spear', 'boilWater']);
    const raw = JSON.parse(serializeState(sim.state));
    raw.pinned = ['axe', 'axe', 'desertSkewer', 7, 'nope', 'bow', 'rod', 'spear'];
    expect(deserializeState(JSON.stringify(raw))!.pinned).toEqual(['bow', 'rod', 'spear']);
    raw.pinned = 'axe';
    expect(deserializeState(JSON.stringify(raw))!.pinned).toBeUndefined();
    delete raw.pinned;
    expect(deserializeState(JSON.stringify(raw))!.pinned).toBeUndefined();
    expect(parsePins(['desertSkewer', 'axe'], 'desert')).toEqual(['desertSkewer', 'axe']);
  });
});
