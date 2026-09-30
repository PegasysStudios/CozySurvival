// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { BIOME_IDS, BIOMES, type BiomeId } from '../src/data/biomes';
import { DEFAULT_SETTINGS } from '../src/sim/run';
import { Screens, type ScreenHost, type TitleInfo } from '../src/ui/screens';

function titleInfo(id: BiomeId, continueLabel: string | null = null): TitleInfo {
  const b = BIOMES[id];
  return { continueLabel, best: null, deaths: 0, map: { id, name: b.name, tagline: b.tagline, place: b.place, index: BIOME_IDS.indexOf(id), count: BIOME_IDS.length } };
}

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const steps: number[] = [];
  const noop = () => {};
  const host: ScreenHost = {
    onContinue: noop, onNewRun: noop, onNewWorld: noop, onResume: noop, onQuitToTitle: noop, onRetryDay: noop,
    onRestartDay1: noop, onStartFromScratch: noop, onSelectMap: (s) => steps.push(s), onSettings: noop,
    onLeaveServer: noop, onRespawn: noop, sfx: noop,
  };
  return { root, steps, screens: new Screens(root, host, DEFAULT_SETTINGS) };
}

describe('title map select', () => {
  it('arrows on both sides of the title card cycle the maps', () => {
    const { root, steps, screens } = mount();
    screens.showTitle(titleInfo('pnw'));
    const row = root.querySelector('.title-row')!;
    expect([...row.children].map((c) => c.className.split(' ')[0])).toEqual(['map-arrow', 'title-card', 'map-arrow']);
    root.querySelector<HTMLButtonElement>('.map-arrow.next')!.click();
    root.querySelector<HTMLButtonElement>('.map-arrow.prev')!.click();
    expect(steps).toEqual([1, -1]);
  });

  it('the map name, tagline and button copy follow the map, and switching marks the swap for the fade', () => {
    const { root, screens } = mount();
    screens.showTitle(titleInfo('pnw'));
    expect(root.querySelector('.map-name')!.textContent).toBe('Pacific Northwest');
    expect(root.querySelector('.tagline')!.textContent).toBe(BIOMES.pnw.tagline);
    expect(root.textContent).toContain('Day 1 in this same forest');
    expect(root.querySelector('.title-card')!.classList.contains('map-changed')).toBe(false);

    screens.showTitle(titleInfo('desert', 'Day 2 · 9:00 AM'));
    expect(root.querySelector('.map-name')!.textContent).toBe('Arizona Desert');
    expect(root.querySelector('.tagline')!.textContent).toMatch(/^Stranded in the Arizona desert/);
    expect(root.textContent).toContain('Day 1 in this same desert');
    expect(root.textContent).toContain('Day 2 · 9:00 AM');
    expect(root.querySelector('.title-card')!.classList.contains('map-changed')).toBe(true);
    expect(root.querySelectorAll('.map-dots i.on')).toHaveLength(1);
    expect([...root.querySelectorAll('.map-dots i')].indexOf(root.querySelector('.map-dots i.on')!)).toBe(1);
  });
});
