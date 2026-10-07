// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { Panels } from '../src/ui/panels';
import { Hud } from '../src/ui/hud';
import { ORUUN } from '../src/data/tribes';
import { give } from './helpers';

function scene(day = 2) {
  const sim = Simulation.newGame(42), parent = document.createElement('div');
  sim.state.totalHours = (day - 1) * 24 + 1;
  document.body.append(parent);
  const panels = new Panels(parent, { sim: () => sim, sfx: () => {}, close: () => panels.close(), toast: () => {} });
  const npc = sim.state.settlements![0].members[0];
  Object.assign(sim.state.player, { x: npc.x, z: npc.z + 2, y: npc.y });
  sim.talkTo('oruun', 'aven');
  panels.openDialog('oruun', 'aven');
  return { sim, panels, parent };
}

describe('Oruun conversations and quest presentation', () => {
  it('offers simple Yes/No choices and preserves a declined offer', () => {
    const { sim, panels, parent } = scene();
    expect(parent.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toContain('Aven');
    expect(parent.querySelector('.dialog-speech')!.textContent).toContain('twelve sticks');
    const buttons = [...parent.querySelectorAll<HTMLButtonElement>('.dialog-actions button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Yes', 'No']);
    expect(document.activeElement).toBe(buttons[0]);
    expect(parent.querySelector('.panel-overlay')!.classList.contains('conversation')).toBe(true);
    expect(parent.querySelectorAll('.dialog-body p')).toHaveLength(1);
    expect(parent.querySelector('.dialog-advice, .obj-needs, .dialog-reward')).toBeNull();
    buttons[1].click();
    expect(panels.mode).toBe('none');
    expect(sim.state.questLog!.active).toBeUndefined();
    panels.openDialog('oruun', 'aven');
    expect(parent.querySelector('[data-quest-action="accept"]')).not.toBeNull();
  });

  it('introduces the people on day one and lets the player hear their stories', () => {
    const { sim, panels, parent } = scene(1);
    expect(parent.querySelector('.dialog-speech')!.textContent).toBe(ORUUN.members[0].greeting);
    expect(parent.querySelector('[data-quest-action]')).toBeNull();
    parent.querySelector<HTMLButtonElement>('.dialog-more')!.click();
    expect(ORUUN.members[0].stories).toContain(parent.querySelector('.dialog-speech')!.textContent);
    expect(sim.state.questLog!.active).toBeUndefined();
    expect(sim.state.questLog!.tribes.oruun.reputation).toBe(0);
    parent.querySelector<HTMLButtonElement>('.dialog-close')!.click();
    expect(panels.mode).toBe('none');
    // Keep the outgoing frame at the bottom while its opacity fades.
    expect(parent.querySelector('.panel-overlay')!.classList.contains('conversation')).toBe(true);
    expect(parent.querySelector<HTMLElement>('.panel-overlay')!.inert).toBe(true);
    panels.openDialog('oruun', 'aven');
    expect(parent.querySelector<HTMLElement>('.panel-overlay')!.inert).toBe(false);
    panels.close(); panels.open('inventory');
    expect(parent.querySelector('.panel-overlay')!.classList.contains('conversation')).toBe(false);
  });

  it('accepts one quest, disables incomplete delivery, and switches to stories after completion', () => {
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
    expect(parent.querySelector('[data-quest-action="deliver"]')).toBeNull();
    const firstStory = parent.querySelector('.dialog-speech')!.textContent;
    expect(ORUUN.members[0].stories).toContain(firstStory);
    parent.querySelector<HTMLButtonElement>('.dialog-more')!.click();
    expect(parent.querySelector('.dialog-speech')!.textContent).not.toBe(firstStory);
    sim.state.totalHours = 48;
    panels.openDialog('oruun', 'sela');
    expect(parent.querySelector('[data-quest-action="accept"]')).not.toBeNull();
  });

  it('shows reputation and quest needs in Skills and the HUD, with modal attributes limited to conversations', () => {
    const { sim, panels, parent } = scene();
    sim.acceptQuest('oruun', 'aven');
    panels.open('crafting', { section: 'skills' });
    expect(parent.querySelector('.panel')!.hasAttribute('aria-modal')).toBe(false);
    expect(parent.querySelector('.panel-overlay')!.classList.contains('conversation')).toBe(false);
    expect(parent.querySelector('[data-reputation="oruun"]')!.textContent).toContain('An ember of trust');
    expect(parent.querySelector('[data-reputation="oruun"] .skill-head')!.textContent).toContain('Lv 1 / 10');
    expect(parent.querySelector('[data-tribe-station="campfire"]')!.textContent).toContain('Requires Reputation Lv 2');
    expect(parent.querySelector('[data-tribe-station="workbench"]')!.textContent).toContain('Requires Reputation Lv 5');
    const hud = new Hud(parent);
    hud.update(sim, 1, 1);
    expect(parent.querySelector('.hud-quest')!.textContent).toContain('An ember of trust');
    expect(parent.querySelector('.hud-quest')!.textContent).toContain('Aven');
    hud.setGoalsVisible(false);
    expect(parent.querySelector<HTMLElement>('.hud-quest')!.hidden).toBe(true);
  });

  it('explains the introduction day and daily wait in Skills without claiming the questline is finished', () => {
    const { sim, panels, parent } = scene(1);
    panels.open('crafting', { section: 'skills' });
    expect(parent.querySelector('[data-reputation="oruun"]')!.textContent).toContain('Quests open on Day 2');
    expect(parent.querySelector('[data-reputation="oruun"]')!.textContent).not.toContain('All quests complete');
    sim.state.totalHours = 24;
    sim.acceptQuest('oruun', 'aven'); give(sim, { stick: 12 }); sim.turnInQuest('oruun', 'aven');
    panels.refresh();
    expect(parent.querySelector('[data-reputation="oruun"]')!.textContent).toContain('next dawn (6 AM)');
    expect(parent.querySelector('[data-reputation="oruun"]')!.textContent).not.toContain('All quests complete');
    sim.state.totalHours = 48;
    panels.refresh();
    expect(parent.querySelector('[data-reputation="oruun"]')!.textContent).toContain('speak with Sela');
  });

  it('keeps keyboard focus inside the conversation without opening the global inventory shortcut', () => {
    const { parent } = scene(1);
    const buttons = [...parent.querySelectorAll<HTMLButtonElement>('.dialog-actions button')];
    let globalTabs = 0;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Tab') globalTabs++; };
    window.addEventListener('keydown', onKey);
    try {
      buttons.at(-1)!.focus();
      buttons.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(buttons[0]);
      expect(globalTabs).toBe(0);
    } finally { window.removeEventListener('keydown', onKey); }
  });

  for (const biome of ['desert', 'island'] as const) it(`${biome} has no Oruun reputation entry`, () => {
    const sim = Simulation.newGame(42, biome), parent = document.createElement('div');
    const panels = new Panels(parent, { sim: () => sim, sfx: () => {}, close: () => panels.close(), toast: () => {} });
    panels.open('crafting', { section: 'skills' });
    expect(parent.querySelector('[data-reputation]')).toBeNull();
  });
});
