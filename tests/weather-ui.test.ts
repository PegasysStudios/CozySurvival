// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { DevPanel } from '../src/ui/dev';
import { Hud } from '../src/ui/hud';
import { MISC_ICONS, WEATHER_ICONS } from '../src/ui/icons';
import { WEATHER_NAMES, type Weather } from '../src/sim/weather';

describe('PNW weather controls', () => {
  it('switches instantly, replaces rain with winter snow, restores the daily choice and denies guests', () => {
    let sim = Simulation.newGame(42);
    const panel = new DevPanel(document.createElement('div'), { sim: () => sim, setTimeScale: () => {}, timeScale: () => 1, toggleFps: () => {}, toast: () => {} });
    const find = (text: string) => [...panel.root.querySelectorAll('button')].find((b) => b.textContent === text);
    panel.toggle();
    const hours = sim.state.totalHours;
    find('Rainy')!.click();
    expect(sim.weather).toBe('rainy');
    expect(sim.state.totalHours).toBe(hours);
    expect(find('Rainy')!.getAttribute('aria-pressed')).toBe('true');
    find('Winter')!.click();
    expect(find('Rainy')).toBeUndefined();
    find('Snowy')!.click();
    expect(sim.weather).toBe('snowy');
    find('Sunny')!.click();
    expect(sim.weather).toBe('sunny');
    find("Use today's weather")!.click();
    expect(sim.weather).toBe(sim.state.weather!.pattern[0]);
    sim.authority = 'guest';
    panel.toggle(); panel.toggle();
    expect(find('Foggy')!.disabled).toBe(true);
    expect(find("Use today's weather")!.disabled).toBe(true);
    for (const biome of ['desert', 'island'] as const) {
      sim = Simulation.newGame(42, biome);
      panel.toggle(); panel.toggle();
      expect(find('Rainy')!.closest<HTMLElement>('.dev-section')!.hidden).toBe(true);
    }
  });

  it('shows weather icons in the compact day card with no bottom text rows', () => {
    const sim = Simulation.newGame(42);
    const ui = new Hud(document.createElement('div'));
    sim.devSetHour(12);
    const icon = ui.root.querySelector<HTMLElement>('.clock-icon')!;
    const card = ui.root.querySelector('.hud-clock')!;
    const normalized = (html: string) => { const div = document.createElement('div'); div.innerHTML = html; return div.innerHTML; };
    for (const id of ['sunny', 'cloudy', 'rainy', 'foggy'] as Weather[]) {
      sim.devSetWeather(id);
      ui.update(sim, 0.1, 1);
      expect(icon.innerHTML).toBe(normalized(WEATHER_ICONS[id]));
      expect(icon.getAttribute('aria-label')).toBe(`${WEATHER_NAMES[id]} weather`);
      expect(card.querySelector('.season-detail, .season-weather')).toBeNull();
      expect(card.textContent).not.toContain('of 25');
      expect(card.querySelector('[role="progressbar"]')).not.toBeNull();
    }
    sim.devSetSeason('winter');
    sim.devSetWeather('rainy');
    ui.update(sim, 0.1, 1);
    expect(icon.innerHTML).toBe(normalized(WEATHER_ICONS.snowy));
    expect(icon.querySelectorAll('g[transform]')).toHaveLength(3);
    sim.devSetHour(23);
    ui.update(sim, 0.1, 1);
    expect(icon.getAttribute('aria-label')).toBe('Snowy weather');
    sim.devSetWeather('sunny');
    ui.update(sim, 0.1, 1);
    expect(icon.innerHTML).toBe(normalized(MISC_ICONS.moon));
    expect(icon.getAttribute('aria-label')).toBe('Clear night');
    for (const biome of ['desert', 'island'] as const) {
      const other = Simulation.newGame(42, biome);
      other.devSetHour(12);
      ui.update(other, 0.1, 1);
      expect(icon.innerHTML).toBe(normalized(MISC_ICONS.sun));
      expect(icon.getAttribute('aria-label')).toBe('Daylight');
      expect(card.querySelector<HTMLElement>('.hud-season')!.hidden).toBe(true);
    }
  });
});
