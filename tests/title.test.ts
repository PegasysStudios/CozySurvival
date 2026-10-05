// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BIOME_IDS, BIOMES, type BiomeId } from '../src/data/biomes';
import { DEFAULT_SETTINGS, MemoryStorage, RunManager } from '../src/sim/run';
import { Screens, type ScreenHost, type TitleInfo } from '../src/ui/screens';

function titleInfo(id: BiomeId, continueLabel: string | null = null): TitleInfo {
  const b = BIOMES[id];
  return { continueLabel, best: null, deaths: 0, map: { id, name: b.name, tagline: b.tagline, place: b.place, index: BIOME_IDS.indexOf(id), count: BIOME_IDS.length } };
}

function mount(overrides: Partial<ScreenHost> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const host: ScreenHost = {
    onContinue: vi.fn(), onNewRun: vi.fn(), onNewWorld: vi.fn(), onMultiplayer: vi.fn(), onResume: vi.fn(),
    onQuitToTitle: vi.fn(), onRetryDay: vi.fn(), onRestartDay1: vi.fn(), onStartFromScratch: vi.fn(),
    onSelectMap: vi.fn(), onSettings: vi.fn(), onLeaveServer: vi.fn(), onRespawn: vi.fn(), sfx: vi.fn(), ...overrides,
  };
  const screens = new Screens(root, host, DEFAULT_SETTINGS);
  const click = (selector: string) => root.querySelector<HTMLButtonElement>(selector)!.click();
  return { root, host, screens, click, popup: () => root.querySelector<HTMLElement>('.title-popup')! };
}

afterEach(() => document.body.replaceChildren());

describe('simplified title menu', () => {
  it('shows the supplied logo above the title, three main actions, and Settings below', () => {
    const { root, screens } = mount();
    screens.showTitle(titleInfo('pnw', 'Day 2 · 9:00 AM'));
    const card = root.querySelector('.title-card')!;
    expect(card.querySelector('.title-emblem img')!.getAttribute('src')).toBe('/ui/cozy-survival-logo.png');
    expect(card.querySelector('.title-emblem')!.nextElementSibling!.textContent).toBe('CozySurvival');
    expect([...card.querySelectorAll<HTMLButtonElement>('.title-actions > button')].map(b => b.dataset.action)).toEqual(['continue', 'new-run', 'multiplayer']);
    expect(card.querySelector('.title-actions')!.nextElementSibling!.classList.contains('title-settings')).toBe(true);
    expect(card.querySelector('.map-arrow, .title-help, .title-meta, .mp-section')).toBeNull();
    expect(card.textContent).not.toContain('New world');
    expect(card.querySelector('.map-name')!.textContent).toBe('Pacific Northwest');
    expect(card.querySelector('.tagline')!.textContent).toBe(BIOMES.pnw.tagline);
  });

  it('continues an existing run and disables Continue when no save exists', () => {
    const { root, host, screens, click } = mount();
    screens.showTitle(titleInfo('pnw'));
    click('.title-continue');
    expect(host.onContinue).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLButtonElement>('.title-continue')!.disabled).toBe(true);
    screens.showTitle(titleInfo('pnw', 'Day 2 · 9:00 AM'));
    click('.title-continue');
    expect(host.onContinue).toHaveBeenCalledOnce();
    expect(host.onNewRun).not.toHaveBeenCalled();
    expect(root.querySelector('.title-continue .btn-sub')!.textContent).toBe('Day 2 · 9:00 AM');
  });

  it('does not replace the saved run until Yes is chosen', () => {
    const manager = new RunManager(new MemoryStorage(), () => 42);
    const run = manager.newRun();
    run.state.totalHours = 29;
    run.state.inventory.slots[0] = { item: 'stick', count: 3 };
    manager.save(run);
    const { screens, host, click, popup } = mount({
      onContinue: vi.fn(() => expect(manager.loadCurrent()!.state.runId).toBe(run.state.runId)),
      onNewRun: vi.fn(() => manager.restartFromDay1()),
    });
    screens.showTitle(titleInfo('pnw', 'Day 2 · 5:00 AM'));
    click('.title-new-run');
    expect(popup().textContent).toContain('Starting a new run will replace your current one. Are you sure?');
    expect(popup().getAttribute('role')).toBe('dialog');
    expect(popup().querySelector('.menu-popup-card')).not.toBeNull();
    expect(host.onNewRun).not.toHaveBeenCalled();
    click('[data-action="cancel-new-run"]');
    click('.title-continue');
    expect(manager.loadCurrent()!.state.inventory.slots[0]).toEqual({ item: 'stick', count: 3 });
    click('.title-new-run');
    click('[data-action="confirm-new-run"]');
    expect(host.onNewRun).toHaveBeenCalledOnce();
    expect(manager.loadCurrent()!.state.runId).not.toBe(run.state.runId);
    expect(screens.titlePopupOpen).toBe(false);
  });

  it.each(['No', 'Escape', 'backdrop'])('%s cancels a new run and restores the menu focus', (cancel) => {
    const { root, host, screens, click, popup } = mount();
    screens.showTitle(titleInfo('pnw', 'Day 1 · 3:04 PM'));
    const opener = root.querySelector('.title-new-run')!;
    click('.title-new-run');
    expect(screens.title.inert).toBe(true);
    if (cancel === 'No') click('[data-action="cancel-new-run"]');
    else if (cancel === 'Escape') document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else popup().click();
    expect(host.onNewRun).not.toHaveBeenCalled();
    expect(screens.titlePopupOpen).toBe(false);
    expect(screens.title.inert).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('keeps keyboard focus in the confirmation and stops shortcuts reaching the title screen', () => {
    const { screens, click, popup } = mount();
    screens.showTitle(titleInfo('pnw', 'Day 1 · 3:04 PM'));
    click('.title-new-run');
    const no = popup().querySelector('[data-action="cancel-new-run"]')!;
    const yes = popup().querySelector('[data-action="confirm-new-run"]')!;
    expect(document.activeElement).toBe(no);
    no.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(yes);
    yes.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(no);
    const backgroundKey = vi.fn();
    document.addEventListener('keydown', backgroundKey);
    no.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(backgroundKey).not.toHaveBeenCalled();
    document.removeEventListener('keydown', backgroundKey);
  });

  it('keeps map selection and controls in Settings while updating the selected map', () => {
    const { root, host, screens, click, popup } = mount();
    screens.showTitle(titleInfo('pnw'));
    click('.title-settings');
    expect(popup().querySelector('.title-help')).not.toBeNull();
    click('.title-popup .map-arrow.next');
    expect(host.onSelectMap).toHaveBeenCalledWith(1);
    screens.showTitle(titleInfo('desert', 'Day 2 · 9:00 AM'));
    expect(screens.titlePopupOpen).toBe(true);
    expect(popup().querySelector('.settings-map-name b')!.textContent).toBe('Arizona Desert');
    expect(root.querySelector('.title-card .map-name')!.textContent).toBe('Arizona Desert');
    expect(root.querySelector('.title-card .tagline')!.textContent).toBe(BIOMES.desert.tagline);
    expect(root.querySelector('.title-card')!.classList.contains('map-changed')).toBe(true);
    click('.title-popup .map-arrow.prev');
    expect(host.onSelectMap).toHaveBeenCalledWith(-1);
  });

  it('shares settings with the existing pause menu and persists the values through the host', () => {
    const { host, screens, click, popup } = mount();
    screens.showTitle(titleInfo('pnw'));
    click('.title-settings');
    const music = popup().querySelector<HTMLInputElement>('input[data-k="musicVolume"]')!;
    music.value = '0.35';
    music.dispatchEvent(new Event('input', { bubbles: true }));
    expect(host.onSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, musicVolume: 0.35 });
    screens.syncSettings({ ...DEFAULT_SETTINGS, musicVolume: 0.35, muted: true });
    expect(popup().querySelector('[data-pct="musicVolume"]')!.textContent).toBe('35%');
    expect(popup().querySelector<HTMLInputElement>('[data-k="muted"]')!.checked).toBe(true);
    screens.showPause();
    expect(screens.pause.querySelector<HTMLInputElement>('[data-k="musicVolume"]')!.value).toBe('0.35');
  });

  it('opens Multiplayer from its button and updates status without disturbing a pop-up', () => {
    const { host, screens, click, popup, root } = mount();
    screens.showTitle(titleInfo('pnw'));
    click('.title-multiplayer');
    expect(host.onMultiplayer).toHaveBeenCalledOnce();
    click('.title-new-run');
    const card = popup().firstElementChild;
    screens.setMultiplayerStatus({ kind: 'online', local: false });
    expect(root.querySelector('.title-multiplayer .mp-pill')!.textContent).toBe('Online');
    expect(popup().firstElementChild).toBe(card);
    expect(screens.titlePopupOpen).toBe(true);
    screens.hideTitle();
    expect(screens.titlePopupOpen).toBe(false);
    expect(screens.title.inert).toBe(false);
  });
});
