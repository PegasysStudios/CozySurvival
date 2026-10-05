// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/game/game';
import type { UiMode } from '../src/game/escape';
import { Input } from '../src/game/input';
import { DEFAULT_SETTINGS, MemoryStorage, normalizeSettings, RunManager, type Settings } from '../src/sim/run';
import { Hud } from '../src/ui/hud';
import { Screens, type ScreenHost } from '../src/ui/screens';
import { quietSim } from './helpers';

/** Exercise the real settings/shortcut methods without starting WebGL or an animation loop. */
function mount() {
  const storage = new MemoryStorage();
  const run = new RunManager(storage, () => 42);
  const root = document.createElement('div');
  document.body.append(root);
  const hud = new Hud(root);
  const sim = quietSim();
  const game = Object.assign(Object.create(Game.prototype), {
    mode: 'playing', run, hud, sim, settings: { ...DEFAULT_SETTINGS },
    mp: null, dev: null, mpHud: { chatting: false }, audio: { setVolume: vi.fn() },
  }) as {
    mode: UiMode;
    settings: Settings;
    mpHud: { chatting: boolean };
    screens: Screens;
    onKey(code: string, ev: KeyboardEvent): void;
    applySettings(s: Settings): void;
  };
  const noop = () => {};
  const host: ScreenHost = {
    onContinue: noop, onNewRun: noop, onNewWorld: noop, onMultiplayer: noop, onResume: noop,
    onQuitToTitle: noop, onRetryDay: noop, onRestartDay1: noop, onStartFromScratch: noop,
    onSelectMap: noop, onSettings: (s) => game.applySettings(s), onLeaveServer: noop, onRespawn: noop, sfx: noop,
  };
  const screens = new Screens(root, host, game.settings);
  game.screens = screens;
  hud.update(sim, 0.1, 1);
  const goals = root.querySelector<HTMLElement>('.hud-objective')!;
  const checkbox = () => screens.pause.querySelector<HTMLInputElement>('[data-k="showGoals"]')!;
  return { storage, run, root, hud, sim, game, screens, goals, checkbox };
}

afterEach(() => document.body.replaceChildren());

describe('Goals visibility preference', () => {
  it('defaults existing saves to showing goals and preserves a saved hidden preference', () => {
    expect(normalizeSettings({}).showGoals).toBe(true);
    expect(normalizeSettings({ showGoals: 'false' }).showGoals).toBe(true);
    expect(normalizeSettings({ showGoals: false }).showGoals).toBe(false);
    const { storage, game } = mount();
    game.applySettings({ ...game.settings, showGoals: false });
    expect(new RunManager(storage).meta.settings.showGoals).toBe(false);
  });

  it('shares the pause-menu checkbox and K setting without changing goal progress or the day card', () => {
    const { game, screens, hud, sim, goals, checkbox, root } = mount();
    screens.showPause();
    expect(checkbox().checked).toBe(true);
    const before = JSON.stringify(sim.state);
    checkbox().click();
    expect(goals.hidden).toBe(true);
    expect(game.settings.showGoals).toBe(false);
    expect(JSON.stringify(sim.state)).toBe(before);
    expect(root.querySelector<HTMLElement>('.hud-clock')!.hidden).toBe(false);
    sim.state.objective = 1;
    hud.update(sim, 0.1, 1);
    expect(goals.hidden).toBe(true);
    game.mode = 'paused';
    game.onKey('KeyK', new KeyboardEvent('keydown', { code: 'KeyK' }));
    expect(goals.hidden).toBe(false);
    expect(checkbox().checked).toBe(true);
    expect(goals.querySelector('.obj-title')!.textContent).toBe(sim.currentObjective()!.title);
    screens.showPause({ host: false, players: 2 });
    expect(checkbox().checked).toBe(true);
    checkbox().click();
    expect(goals.hidden).toBe(true);
  });

  it('responds once per K press while ignoring typing, chat and modified browser shortcuts', () => {
    const { game, goals } = mount();
    const input = new Input(document.createElement('canvas'));
    input.onKey = (code, ev) => game.onKey(code, ev);
    const key = (extra: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { code: 'KeyK', bubbles: true, ...extra });
    window.dispatchEvent(key());
    expect(goals.hidden).toBe(true);
    window.dispatchEvent(key({ repeat: true }));
    expect(goals.hidden).toBe(true);
    const text = document.createElement('textarea');
    document.body.append(text);
    text.dispatchEvent(key());
    expect(goals.hidden).toBe(true);
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) window.dispatchEvent(key(extra));
    expect(goals.hidden).toBe(true);
    game.mpHud.chatting = true;
    window.dispatchEvent(key());
    expect(goals.hidden).toBe(true);
    game.mpHud.chatting = false;
    window.dispatchEvent(key());
    expect(goals.hidden).toBe(false);
    for (const mode of ['title', 'dead', 'sleeping'] as const) {
      game.mode = mode;
      window.dispatchEvent(key());
      expect(goals.hidden).toBe(false);
    }
  });
});
