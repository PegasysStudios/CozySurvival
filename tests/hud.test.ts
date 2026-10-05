import { describe, expect, it } from 'vitest';
import { TOOLS, TOOL_ORDER } from '../src/data/items';
import { toolAmmo, toolBeltHtml } from '../src/ui/hud';
import { give, giveRecipe, quietSim } from './helpers';

function bowSlot(html: string): string {
  const slots = html.split('<div class="tool ');
  return slots.find((s) => s.includes('<span class="key">4</span>'))!;
}

function beltKeys(html: string): number[] {
  return [...html.matchAll(/<span class="key">(\d+)<\/span>/g)].map((match) => Number(match[1]));
}

describe('hotbar owned tools', () => {
  it('starts with only Hands and no locked placeholders', () => {
    const html = toolBeltHtml(quietSim().state);
    expect(beltKeys(html)).toEqual([1]);
    expect(html).toContain('<span class="tool-name">Hands</span>');
    expect(html).toContain('class="tool active"');
    expect(html).not.toContain('locked');
    expect(html).not.toContain('???');
  });

  it.each(TOOL_ORDER.filter((id) => id !== 'hands'))('adds %s only once it has been crafted', (id) => {
    const sim = quietSim();
    sim.state.totalHours += 24;
    giveRecipe(sim, id);
    expect(sim.canCraft(id).ok).toBe(true);
    expect(beltKeys(toolBeltHtml(sim.state))).toEqual([1]);

    expect(sim.craft(id).ok).toBe(true);
    const html = toolBeltHtml(sim.state);
    expect(beltKeys(html)).toEqual([1, TOOLS[id].slot]);
    expect(html).toContain(`<span class="tool-name">${TOOLS[id].name}</span>`);
    expect(html).not.toContain('locked');
  });

  it('keeps fixed shortcut keys and tool order with gaps between owned tools', () => {
    const sim = quietSim();
    sim.state.tools.push('knife', 'bow', 'axe');
    sim.state.toolLevels.axe = 2;
    sim.state.toolWear.axe = { dur: 25, max: 100 };
    sim.selectTool('bow');
    give(sim, { arrow: 2 });

    const html = toolBeltHtml(sim.state);
    expect(beltKeys(html)).toEqual([1, 2, 4, 7]);
    expect(html).toContain('Stone Axe II · 25% durability');
    expect(html).toContain('transform:scaleX(0.25)');
    expect(bowSlot(html)).toMatch(/^active"/);
    expect(bowSlot(html)).toContain('<span class="ammo ">2</span>');
  });

  it('removes a broken tool until it is crafted again, matching the pack', () => {
    const sim = quietSim();
    giveRecipe(sim, 'axe');
    expect(sim.craft('axe').ok).toBe(true);
    sim.state.toolLevels.axe = 2;
    expect(beltKeys(toolBeltHtml(sim.state))).toEqual([1, 2]);

    expect(sim.wearTool('axe', sim.state.toolWear.axe!.dur)).toBe('broken');
    expect(beltKeys(toolBeltHtml(sim.state))).toEqual([1]);

    giveRecipe(sim, 'axe');
    expect(sim.craft('axe').ok).toBe(true);
    expect(beltKeys(toolBeltHtml(sim.state))).toEqual([1, 2]);
    expect(toolBeltHtml(sim.state)).toContain('Stone Axe II');
  });
});

describe('hotbar arrow count', () => {
  it('shows how many arrows are in the pack on the bow slot', () => {
    const sim = quietSim();
    sim.state.tools.push('bow');
    give(sim, { arrow: 7 });
    expect(toolAmmo(sim.state, 'bow')).toBe(7);
    const slot = bowSlot(toolBeltHtml(sim.state));
    expect(slot).toContain('<span class="ammo ">7</span>');
    expect(slot).toContain('7 arrows');
  });

  it('counts arrows across stacks and updates as they are used or found', () => {
    const sim = quietSim();
    sim.state.tools.push('bow');
    sim.state.inventory.slots[0] = { item: 'arrow', count: 16 };
    sim.state.inventory.slots[1] = { item: 'arrow', count: 3 };
    expect(bowSlot(toolBeltHtml(sim.state))).toContain('>19</span>');
    sim.state.inventory.slots[0] = null;
    expect(bowSlot(toolBeltHtml(sim.state))).toContain('>3</span>');
  });

  it('flags an empty quiver instead of hiding the count', () => {
    const sim = quietSim();
    sim.state.tools.push('bow');
    expect(toolAmmo(sim.state, 'bow')).toBe(0);
    const slot = bowSlot(toolBeltHtml(sim.state));
    expect(slot).toContain('<span class="ammo empty">0</span>');
    expect(slot).toContain('0 arrows');
  });

  it('only the bow shows ammo, and only once it is made', () => {
    const sim = quietSim();
    give(sim, { arrow: 4 });
    expect(toolBeltHtml(sim.state)).not.toContain('class="ammo');
    for (const t of ['hands', 'axe', 'spear', 'torch'] as const) expect(toolAmmo(sim.state, t)).toBeNull();
    sim.state.tools.push('axe', 'spear', 'torch', 'bow');
    expect(toolBeltHtml(sim.state).match(/class="ammo/g)).toHaveLength(1);
  });
});
