// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { SeasonDisplay } from '../src/ui/seasons';
import { DevPanel } from '../src/ui/dev';
import { Hud } from '../src/ui/hud';

describe('season UI', () => {
  it('keeps day, time, compass and season progress in one card as the season or map changes', () => {
    const sim = Simulation.newGame(42);
    const hud = new Hud(document.createElement('div'));
    hud.update(sim, 0.1, 1);
    const card = hud.root.querySelector('.hud-clock')!;
    expect(card.querySelector('.clock-day')!.textContent).toBe('Day 1');
    expect(card.querySelector('.clock-time')!.textContent).toBeTruthy();
    expect(card.querySelector('.clock-compass')).not.toBeNull();
    const season = card.querySelector<HTMLElement>('.hud-season')!;
    expect(season.hidden).toBe(false);
    expect(card.querySelector('[role="progressbar"]')!.getAttribute('aria-valuetext')).toBe('Spring, day 1 of 25');
    expect(hud.root.querySelector('.hud-left .hud-season')).toBeNull();
    expect(hud.root.querySelectorAll('.hud-clock')).toHaveLength(1);
    sim.state.totalHours = 24 * 3;
    sim.devSetSeason('fall');
    hud.update(sim, 0.1, 1);
    expect(card.querySelector('.clock-day')!.textContent).toBe('Day 4');
    expect(season.dataset.season).toBe('fall');
    expect(season.querySelector<HTMLElement>('.season-track')!.title).toContain('Winter next');
    expect(season.querySelector('.season-detail')).toBeNull();
    for (const biome of ['desert', 'island'] as const) {
      hud.update(Simulation.newGame(42, biome), 0.1, 1);
      expect(season.hidden).toBe(true);
      expect(card.querySelector('.clock-day')!.textContent).toBe('Day 1');
    }
  });

  it('shows the current and next seasons with an accessible day marker that reaches the end on day 25', () => {
    const sim = Simulation.newGame(42);
    const ui = new SeasonDisplay();
    ui.update(sim);
    expect(ui.root.hidden).toBe(false);
    expect(ui.root.textContent).toContain('Spring');
    expect(ui.root.querySelectorAll('svg')).toHaveLength(2);
    const progress = ui.root.querySelector('[role="progressbar"]')!;
    const marker = ui.root.querySelector<HTMLElement>('.season-day')!;
    expect(marker.textContent).toBe('1');
    expect(marker.style.left).toBe('0%');
    sim.state.totalHours = 24 * 3;
    ui.update(sim);
    expect(progress.getAttribute('aria-valuetext')).toBe('Spring, day 4 of 25');
    expect(marker.style.left).toBe('12.5%');
    sim.state.totalHours = 24 * 24;
    ui.update(sim);
    expect(marker.style.left).toBe('100%');
    sim.devSetSeason('winter');
    ui.update(sim);
    expect(ui.root.querySelector<HTMLElement>('.season-track')!.title).toContain('Spring next');
    expect(marker.textContent).toBe('1');
    ui.update(Simulation.newGame(42, 'desert'));
    expect(ui.root.hidden).toBe(true);
    ui.update(Simulation.newGame(42, 'island'));
    expect(ui.root.hidden).toBe(true);
  });

  it('switches PNW seasons immediately through the dev menu, disables guests, and hides on other maps', () => {
    let sim = Simulation.newGame(42);
    const dev = new DevPanel(document.createElement('div'), { sim: () => sim, setTimeScale: () => {}, timeScale: () => 1, toggleFps: () => {}, toast: () => {} });
    dev.toggle();
    const winter = () => [...dev.root.querySelectorAll('button')].find((b) => b.textContent === 'Winter')!;
    winter().click();
    expect(sim.season).toBe('winter');
    expect(winter().classList.contains('active')).toBe(true);
    sim.authority = 'guest';
    dev.toggle(); dev.toggle();
    expect(winter().disabled).toBe(true);
    sim = Simulation.newGame(42, 'island');
    dev.toggle(); dev.toggle();
    expect(winter().closest<HTMLElement>('.dev-section')!.hidden).toBe(true);
  });
});
