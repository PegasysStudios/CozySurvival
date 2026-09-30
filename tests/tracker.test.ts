import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ItemId } from '../src/data/items';
import { killKey, OBJECTIVES } from '../src/data/objectives';
import { addItem } from '../src/sim/inventory';
import { createNewState } from '../src/sim/simulation';
import type { GameState } from '../src/sim/state';
import { objectiveNeedsHtml } from '../src/ui/hud';
import { quietSim } from './helpers';

function state(pack: Partial<Record<ItemId, number>> = {}): GameState {
  const s = createNewState(42);
  s.gear.push('basket', 'backpack');
  s.inventory.slots.push(...Array(10).fill(null));
  for (const [item, n] of Object.entries(pack)) addItem(s.inventory, item as ItemId, n!);
  return s;
}

const rows = (id: string, s: GameState) => OBJECTIVES.find((o) => o.id === id)!.needs(s).map((n) => `${n.label} ${n.have}/${n.need}`);

describe('quest tracker rows for each onboarding step (round 6)', () => {
  it('lists the eleven steps in order', () => {
    expect(OBJECTIVES.map((o) => o.id)).toEqual(['drink', 'camp', 'forage', 'skewer', 'firewood', 'axe', 'night', 'fish', 'spear', 'bow', 'knife']);
  });

  it('1. drink from the lake', () => {
    const s = state();
    expect(rows('drink', s)).toEqual(['Drink from the lake 0/1']);
    s.stats.events.drankByHand = 3;
    expect(rows('drink', s)).toEqual(['Drink from the lake 1/1']);
  });

  it('2. campfire: every ingredient against the pack, then the build itself', () => {
    const s = state({ stone: 9, stick: 30 });
    expect(rows('camp', s)).toEqual(['Stones 9/25', 'Sticks 20/20', 'Plant Fiber 0/5', 'Campfire built 0/1']);
    s.stats.crafted.campfire = 1;
    expect(rows('camp', s)).toEqual(['Campfire built 1/1']);
  });

  it('3. forage three wild foods', () => {
    const s = state();
    s.stats.gathered.berries = 1;
    s.stats.gathered.onion = 1;
    expect(rows('forage', s)).toEqual(['Berries, onions or chanterelles 2/3']);
  });

  it("4. cook a skewer: the Forager's Skewer ingredients, then the cooking", () => {
    const s = state({ berries: 1, onion: 1 });
    expect(rows('skewer', s)).toEqual(['Salmonberries 1/2', 'Wild Onion 1/1', 'Stick 0/1', 'Skewer cooked 0/1']);
    s.stats.crafted.skewer = 1;
    expect(rows('skewer', s)).toEqual(['Salmonberries 1/2', 'Wild Onion 1/1', 'Stick 0/1', 'Skewer cooked 1/1']);
    s.stats.crafted.forageSkewer = 1;
    expect(rows('skewer', s)).toEqual(['Skewer cooked 1/1']);
  });

  it('5. keep the fire going: firewood in the pack for what is left, and fuel added', () => {
    const s = state({ stick: 1 });
    expect(rows('firewood', s)).toEqual(['Sticks or logs in your pack 1/2', 'Added to the fire 0/2']);
    s.stats.events.fuelAdded = 1;
    expect(rows('firewood', s)).toEqual(['Sticks or logs in your pack 1/1', 'Added to the fire 1/2']);
  });

  it('6. stone axe ingredients, the axe, then a log', () => {
    const s = state({ stick: 6, stone: 2 });
    expect(rows('axe', s)).toEqual(['Sticks 6/6', 'Stones 2/6', 'Plant Fiber 0/6', 'Stone Axe crafted 0/1', 'Log chopped 0/1']);
    s.stats.crafted.axe = 1;
    s.stats.gathered.log = 2;
    expect(rows('axe', s)).toEqual(['Stone Axe crafted 1/1', 'Log chopped 1/1']);
  });

  it('7. survive the night: one row for the next morning, ticked once it comes', () => {
    const s = state();
    s.stats.events.nightFrom = 1;
    expect(rows('night', s)).toEqual(['See the morning of day 2 0/1']);
    s.totalHours = 24.5;
    expect(rows('night', s)).toEqual(['See the morning of day 2 1/1']);
  });

  it('8. fishing pole ingredients, the pole, a trout and a cooked trout', () => {
    const s = state({ stick: 12, cordage: 2 });
    expect(rows('fish', s)).toEqual(['Sticks 10/10', 'Stones 0/5', 'Cordage 2/5', 'Fishing Pole crafted 0/1', 'Trout caught 0/1', 'Trout cooked 0/1']);
    s.stats.crafted.rod = 1;
    s.stats.gathered.rawFish = 1;
    s.stats.crafted.smokedTrout = 1;
    expect(rows('fish', s)).toEqual(['Fishing Pole crafted 1/1', 'Trout caught 1/1', 'Trout cooked 1/1']);
  });

  it('9. spear ingredients, the spear, then a hare killed with it', () => {
    const s = state({ stone: 5 });
    expect(rows('spear', s)).toEqual(['Sticks 0/15', 'Stones 5/5', 'Cordage 0/5', 'Spear crafted 0/1', 'Hare hunted with the spear 0/1']);
    s.stats.crafted.spear = 1;
    s.stats.events[killKey('spear', 'deer')] = 1;
    expect(rows('spear', s)).toEqual(['Spear crafted 1/1', 'Hare hunted with the spear 0/1']);
    s.stats.events[killKey('spear', 'rabbit')] = 1;
    expect(rows('spear', s)).toEqual(['Spear crafted 1/1', 'Hare hunted with the spear 1/1']);
  });

  it('10. bow and arrow ingredients summed, then only what is still to make', () => {
    const s = state({ stick: 16, cordage: 10 });
    expect(rows('bow', s)).toEqual(['Sticks 16/17', 'Cordage 10/10', 'Stone 0/1', 'Plant Fiber 0/1', 'Bow crafted 0/1', 'Arrows made 0/1', 'Kill with the bow 0/1']);
    s.stats.crafted.bow = 1;
    expect(rows('bow', s)).toEqual(['Sticks 2/2', 'Stone 0/1', 'Plant Fiber 0/1', 'Bow crafted 1/1', 'Arrows made 0/1', 'Kill with the bow 0/1']);
    s.stats.crafted.arrows = 1;
    s.stats.events[killKey('bow')] = 1;
    expect(rows('bow', s)).toEqual(['Bow crafted 1/1', 'Arrows made 1/1', 'Kill with the bow 1/1']);
  });

  it('11. knife ingredients, the knife, then a kill skinned and butchered', () => {
    const s = state({ stone: 4, cordage: 3 });
    expect(rows('knife', s)).toEqual(['Stones 4/10', 'Sticks 0/5', 'Cordage 3/3', 'Stone Knife crafted 0/1', 'Kill skinned 0/1', 'Kill butchered 0/1']);
    s.stats.crafted.knife = 1;
    s.stats.events.skinned = 1;
    expect(rows('knife', s)).toEqual(['Stone Knife crafted 1/1', 'Kill skinned 1/1', 'Kill butchered 0/1']);
    s.stats.events.butchered = 2;
    expect(rows('knife', s)).toEqual(['Stone Knife crafted 1/1', 'Kill skinned 1/1', 'Kill butchered 1/1']);
  });

  it('never shows more than a row needs, and the tracker follows the current step', () => {
    const s = state({ stone: 40, stick: 40, fiber: 40 });
    for (const o of OBJECTIVES) for (const n of o.needs(s)) expect(n.have, `${o.id} ${n.label}`).toBeLessThanOrEqual(n.need);
    const sim = quietSim();
    expect(sim.currentObjective()!.needs.map((n) => n.label)).toEqual(['Drink from the lake']);
    sim.state.stats.events.drankByHand = 1;
    sim.state.objective = 1;
    expect(sim.currentObjective()!.needs.map((n) => n.label)).toEqual(['Stones', 'Sticks', 'Plant Fiber', 'Campfire built']);
  });

  it('renders one row per need, stacked in a column, marking the finished ones', () => {
    const s = state({ stone: 9, stick: 30 });
    const html = objectiveNeedsHtml(OBJECTIVES[1].needs(s));
    expect(html.match(/class="obj-need /g)).toHaveLength(4);
    expect(html.match(/class="obj-need done"/g)).toHaveLength(1);
    expect(html).toContain('<b class="obj-need-count">9/25</b>');
    const css = readFileSync('src/styles.css', 'utf8');
    expect(/\.obj-needs \{[^}]*flex-direction: column;/.test(css)).toBe(true);
  });
});
