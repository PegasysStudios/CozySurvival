// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { Panels } from '../src/ui/panels';
import { Hud } from '../src/ui/hud';
import { give } from './helpers';

function scene() {
  const sim = Simulation.newGame(42), parent = document.createElement('div');
  document.body.append(parent);
  const panels = new Panels(parent, { sim: () => sim, sfx: () => {}, close: () => panels.close(), toast: () => {} });
  const npc = sim.state.settlements![0].members[0];
  Object.assign(sim.state.player, { x: npc.x, z: npc.z + 2, y: npc.y });
  sim.talkTo('oruun', 'aven');
  panels.openDialog('oruun', 'aven');
  return { sim, panels, parent };
}

describe('Oruun conversations and quest presentation', () => {
  it('greets, offers Yes/No, preserves a declined offer and provides free knowledge', () => {
    const { sim, panels, parent } = scene();
    expect(parent.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toContain('Aven');
    expect(parent.querySelector('.dialog-speech')!.textContent).toContain('twelve sticks');
    const buttons = [...parent.querySelectorAll<HTMLButtonElement>('.dialog-actions button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Yes', 'No']);
    expect(parent.querySelectorAll('.dialog-advice')).toHaveLength(2);
    buttons[1].click();
    expect(panels.mode).toBe('none');
    expect(sim.state.questLog!.active).toBeUndefined();
    panels.openDialog('oruun', 'aven');
    expect(parent.querySelector('[data-quest-action="accept"]')).not.toBeNull();
  });

  it('accepts one quest, disables incomplete delivery, shows thanks and the next giver', () => {
    const { sim, panels, parent } = scene();
    parent.querySelector<HTMLButtonElement>('[data-quest-action="accept"]')!.click();
    expect(sim.state.questLog!.active!.id).toBe('oruun-firewood');
    expect(parent.querySelector('.dialog-speech')!.textContent).toContain('Thank you');
    panels.openDialog('oruun', 'aven');
    expect(parent.querySelector<HTMLButtonElement>('[data-quest-action="deliver"]')!.disabled).toBe(true);
    give(sim, { stick: 12 }); panels.refresh();
    parent.querySelector<HTMLButtonElement>('[data-quest-action="deliver"]')!.click();
    expect(sim.state.questLog!.tribes.oruun.reputation).toBe(3);
    expect(parent.querySelector('.dialog-speech')!.textContent).toContain('kept your word');
    panels.openDialog('oruun', 'aven');
    expect(parent.querySelector('[data-quest-action="accept"]')).toBeNull();
    expect(parent.querySelector('.dialog-speech')!.textContent).toContain('Sela');
  });

  it('shows reputation and quest needs in Skills and the HUD, with modal attributes limited to conversations', () => {
    const { sim, panels, parent } = scene();
    sim.acceptQuest('oruun', 'aven');
    panels.open('crafting', { section: 'skills' });
    expect(parent.querySelector('.panel')!.hasAttribute('aria-modal')).toBe(false);
    expect(parent.querySelector('[data-reputation="oruun"]')!.textContent).toContain('An ember of trust');
    const hud = new Hud(parent);
    hud.update(sim, 1, 1);
    expect(parent.querySelector('.hud-quest')!.textContent).toContain('An ember of trust');
    expect(parent.querySelector('.hud-quest')!.textContent).toContain('Aven');
    hud.setGoalsVisible(false);
    expect(parent.querySelector<HTMLElement>('.hud-quest')!.hidden).toBe(true);
  });

  for (const biome of ['desert', 'island'] as const) it(`${biome} has no Oruun reputation entry`, () => {
    const sim = Simulation.newGame(42, biome), parent = document.createElement('div');
    const panels = new Panels(parent, { sim: () => sim, sfx: () => {}, close: () => panels.close(), toast: () => {} });
    panels.open('crafting', { section: 'skills' });
    expect(parent.querySelector('[data-reputation]')).toBeNull();
  });
});
