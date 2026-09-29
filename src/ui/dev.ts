import { BALANCE } from '../data/balance';
import type { GearId, ItemId, ToolId } from '../data/items';
import { RECIPES } from '../data/recipes';
import type { SpeciesId } from '../data/species';
import { setCapacity } from '../sim/inventory';
import { slotsFor } from '../sim/crafting';
import type { Simulation } from '../sim/simulation';
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
      ...[6, 9, 12, 17, 18.5, 20, 23].map((h) => button(`${Math.floor(h)}:${h % 1 ? '30' : '00'}`, 'dev-btn', () => host.sim().devSetHour(h))));
    section('Give',
      button('Basics', 'dev-btn', give({ stick: 10, stone: 8, fiber: 10 }, 'basics')),
      button('Cooking', 'dev-btn', give({ mushroom: 4, onion: 3, berries: 6, rawMeat: 2, rawFish: 2 }, 'cooking ingredients')),
      button('Builder', 'dev-btn', give({ log: 6, cordage: 3, hide: 3, stick: 6, fiber: 6 }, 'building materials')),
      button('Arrows', 'dev-btn', give({ arrow: 12 }, 'arrows')),
    );
    section('Unlock',
      button('All recipes', 'dev-btn', () => {
        const st = host.sim().state;
        for (const r of RECIPES) if (!st.known.includes(r.id)) st.known.push(r.id);
        host.toast('Dev: all recipes known');
      }),
      button('All tools', 'dev-btn', () => {
        const st = host.sim().state;
        for (const t of ['axe', 'spear', 'bow', 'torch'] as ToolId[]) if (!st.tools.includes(t)) st.tools.push(t);
      }),
      button('All gear', 'dev-btn', () => {
        const st = host.sim().state;
        for (const g of ['basket', 'backpack', 'canteen'] as GearId[]) if (!st.gear.includes(g)) st.gear.push(g);
        setCapacity(st.inventory, slotsFor(st));
      }),
    );
    section('Spawn nearby',
      ...(['wolf', 'bear', 'deer', 'rabbit'] as SpeciesId[]).map((sp) => button(sp, 'dev-btn', () => {
        const a = host.sim().devSpawn(sp, sp === 'bear' ? 20 : 24);
        host.toast(a ? `Dev: spawned a ${sp}` : 'Dev: no spot found');
      })),
    );
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
    return this.root.classList.contains('show');
  }

  get open(): boolean {
    return this.root.classList.contains('show');
  }
}
