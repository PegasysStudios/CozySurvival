// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { Hud } from '../src/ui/hud';
import { giveRecipe, quietSim } from './helpers';

describe('HUD pack icon', () => {
  it('uses the supplied icon separately from the tool bar and counts occupied slots', () => {
    const sim = quietSim();
    const hud = new Hud(document.createElement('div'));
    const pack = hud.root.querySelector<HTMLElement>('.pack-wrap')!;
    const count = pack.querySelector('.pack-count')!;
    hud.update(sim, 0.2, 1);
    expect(pack.parentElement).toBe(hud.root);
    expect(hud.root.querySelector('.hud-bottom .pack-wrap')).toBeNull();
    expect(pack.querySelector('img')!.getAttribute('src')).toBe('/ui/pack-icon.png');
    expect(count.textContent).toBe(`0/${BALANCE.carry.baseSlots}`);

    sim.state.inventory.slots[0] = { item: 'stick', count: 5 };
    sim.state.inventory.slots[1] = { item: 'stone', count: 2 };
    sim.state.inventory.slots[2] = { item: 'fiber', count: 1 };
    hud.update(sim, 0.2, 1);
    expect(count.textContent).toBe(`3/${BALANCE.carry.baseSlots}`);
    expect(pack.getAttribute('aria-label')).toBe(`Pack: 3 of ${BALANCE.carry.baseSlots} slots used. Press Tab to open.`);
    expect(pack.title).toBe(`Pack 3/${BALANCE.carry.baseSlots} · Tab`);
  });

  it('updates full status as items leave and the pack grows', () => {
    const sim = quietSim();
    const hud = new Hud(document.createElement('div'));
    const count = hud.root.querySelector('.pack-count')!;
    sim.state.inventory.slots.fill({ item: 'stone', count: 1 });
    hud.update(sim, 0.2, 1);
    expect(count.textContent).toBe(`${BALANCE.carry.baseSlots}/${BALANCE.carry.baseSlots}`);
    expect(count.classList.contains('full')).toBe(true);

    sim.state.inventory.slots[0] = null;
    hud.update(sim, 0.2, 1);
    expect(count.textContent).toBe(`${BALANCE.carry.baseSlots - 1}/${BALANCE.carry.baseSlots}`);
    expect(count.classList.contains('full')).toBe(false);

    sim.state.inventory.slots.fill(null);
    sim.state.totalHours += 24;
    giveRecipe(sim, 'basket');
    expect(sim.craft('basket').ok).toBe(true);
    hud.update(sim, 0.2, 1);
    expect(count.textContent).toBe(`0/${BALANCE.carry.baseSlots + BALANCE.carry.basketSlots}`);
    expect(count.classList.contains('full')).toBe(false);
  });
});
