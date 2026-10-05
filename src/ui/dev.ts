import { BALANCE } from '../data/balance';
import { biomeDef, type BiomeId } from '../data/biomes';
import type { GearId, ItemId, ToolId } from '../data/items';
import type { SpeciesId } from '../data/species';
import { setCapacity } from '../sim/inventory';
import { slotsFor } from '../sim/crafting';
import type { Simulation } from '../sim/simulation';
import { SEASONS, SEASON_NAMES } from '../sim/seasons';
import { WEATHER_NAMES, type Weather } from '../sim/weather';
import { button, el } from './dom';

export const TIME_SCALES = [1, 10, 60, 240];

export interface DevHost {
  sim(): Simulation;
  setTimeScale(v: number): void;
  timeScale(): number;
  toggleFps(): void;
  toast(text: string): void;
}

/** Developer panel (backquote). Only mounted in dev builds or with ?dev=1. */
export class DevPanel {
  readonly root = el('div', 'dev-panel');
  private readonly host: DevHost;
  private readonly scaleRow = el('div', 'dev-row');
  private onOpen: () => void = () => {};

  constructor(parent: HTMLElement, host: DevHost) {
    this.host = host;
    this.root.innerHTML = '<div class="dev-title">Dev tools <span>` to close</span></div>';
    const section = (label: string, ...children: HTMLElement[]) => {
      const s = el('div', 'dev-section');
      s.append(el('div', 'dev-label', label));
      const row = el('div', 'dev-row');
      row.append(...children);
      s.append(row);
      this.root.append(s);
      return row;
    };
    const s = this.root.appendChild(el('div', 'dev-section'));
    s.append(el('div', 'dev-label', `Time scale (1 game day = ${BALANCE.time.realSecondsPerDay / 60} real minutes at 1×)`), this.scaleRow);
    this.renderScales();

    const give = (items: Partial<Record<ItemId, number>>, label: string) => () => {
      for (const [k, v] of Object.entries(items)) host.sim().devGive(k as ItemId, v!);
      host.toast(`Dev: gave ${label}`);
    };
    section('Set time',
      ...[6, 9, 12, 17, 18.5, 20, 23].map((h) => button(`${Math.floor(h)}:${h % 1 ? '30' : '00'}`, 'dev-btn', () => host.sim().devSetHour(h))),
      button('Next morning', 'dev-btn', () => host.sim().devNextMorning()));
    const seasonRow = section('PNW season · starts at day 1');
    const renderSeasons = () => {
      const sim = host.sim();
      seasonRow.parentElement!.hidden = sim.biome !== 'pnw';
      seasonRow.replaceChildren(...SEASONS.map((id) => {
        const b = button(SEASON_NAMES[id], `dev-btn ${sim.season === id ? 'active' : ''}`, () => {
          if (host.sim().devSetSeason(id)) host.toast(`Dev: ${SEASON_NAMES[id]}, day 1 of 25`);
          renderSeasons();
          renderWeather();
        });
        b.disabled = sim.authority === 'guest';
        b.title = sim.authority === 'guest' ? 'The host controls the shared season' : `Switch immediately to ${SEASON_NAMES[id]}`;
        return b;
      }));
    };
    const weatherRow = section('PNW weather · lasts until next dawn');
    const renderWeather = () => {
      const sim = host.sim();
      weatherRow.parentElement!.hidden = sim.biome !== 'pnw';
      const states: Weather[] = ['sunny', 'cloudy', 'foggy', sim.frozen ? 'snowy' : 'rainy'];
      weatherRow.replaceChildren(...states.map((id) => {
        const b = button(WEATHER_NAMES[id], `dev-btn ${sim.weather === id ? 'active' : ''}`, () => {
          if (host.sim().devSetWeather(id)) host.toast(`Dev: ${WEATHER_NAMES[id]} until next dawn`);
          renderWeather();
        });
        b.disabled = sim.authority === 'guest';
        b.setAttribute('aria-pressed', String(sim.weather === id));
        b.title = sim.authority === 'guest' ? 'The host controls the shared weather' : `Show ${WEATHER_NAMES[id].toLowerCase()} weather immediately`;
        return b;
      }));
      const reset = button("Use today's weather", 'dev-btn', () => {
        if (host.sim().devResetWeather()) host.toast("Dev: restored today's weather");
        renderWeather();
      });
      reset.disabled = sim.authority === 'guest';
      weatherRow.append(reset);
    };
    section('Give',
      button('Basics', 'dev-btn', give({ stick: 10, stone: 8, fiber: 10 }, 'basics')),
      button('Cooking', 'dev-btn', give({ mushroom: 4, onion: 3, berries: 6, rawMeat: 2, rawFish: 2 }, 'cooking ingredients')),
      button('Builder', 'dev-btn', give({ log: 6, cordage: 3, hide: 3, stick: 6, fiber: 6 }, 'building materials')),
      button('Arrows', 'dev-btn', give({ arrow: 12 }, 'arrows')),
    );
    section('Unlock',
      button('All tools', 'dev-btn', () => {
        const st = host.sim().state;
        for (const t of ['axe', 'spear', 'bow', 'torch', 'rod', 'knife'] as ToolId[]) if (!st.tools.includes(t)) st.tools.push(t);
      }),
      button('All gear', 'dev-btn', () => {
        const st = host.sim().state;
        for (const g of ['basket', 'backpack', 'canteen'] as GearId[]) if (!st.gear.includes(g)) st.gear.push(g);
        setCapacity(st.inventory, slotsFor(st));
      }),
    );
    const spawnRow = section('Spawn nearby');
    const spawnFor = (biome: BiomeId): SpeciesId[] => {
      if (biome === 'pnw') return ['wolf', 'bear', 'deer', 'rabbit'];
      const def = biomeDef(biome);
      return [...def.predators.map((p) => p.species), ...def.prey.map((p) => p.species).filter((sp) => sp !== 'fish'), 'scorpion'];
    };
    const renderSpawns = () => {
      const biome = host.sim().biome;
      if (spawnRow.dataset.biome === biome) return;
      spawnRow.dataset.biome = biome;
      spawnRow.replaceChildren(...spawnFor(biome).map((sp) => button(sp, 'dev-btn', () => {
        const a = host.sim().devSpawn(sp, sp === 'bear' ? 20 : sp === 'scorpion' ? 3 : 24);
        host.toast(a ? `Dev: spawned a ${sp}` : 'Dev: no spot found');
      })));
    };
    this.onOpen = () => { renderSpawns(); renderSeasons(); renderWeather(); };
    section('Player',
      button('Refill needs', 'dev-btn', () => {
        const n = host.sim().state.needs;
        n.health = n.hunger = n.thirst = n.warmth = n.energy = 100;
        n.exhausted = false;
      }),
      button('Damage 25', 'dev-btn', () => host.sim().devDamage(25)),
      button('Die', 'dev-btn', () => host.sim().devDamage(1000)),
      button('FPS', 'dev-btn', () => host.toggleFps()),
    );
    parent.append(this.root);
  }

  renderScales(): void {
    this.scaleRow.innerHTML = '';
    for (const v of TIME_SCALES) {
      this.scaleRow.append(button(`${v}×`, `dev-btn ${this.host.timeScale() === v ? 'active' : ''}`, () => {
        this.host.setTimeScale(v);
        this.renderScales();
      }));
    }
  }

  toggle(): boolean {
    this.root.classList.toggle('show');
    this.renderScales();
    this.onOpen();
    return this.root.classList.contains('show');
  }

  get open(): boolean {
    return this.root.classList.contains('show');
  }
}
