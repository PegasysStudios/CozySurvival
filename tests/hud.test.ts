import { describe, expect, it } from 'vitest';
import { toolAmmo, toolBeltHtml } from '../src/ui/hud';
import { give, quietSim } from './helpers';

function bowSlot(html: string): string {
  const slots = html.split('<div class="tool ');
  return slots.find((s) => s.includes('<span class="key">4</span>'))!;
}

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
