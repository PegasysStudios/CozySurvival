import { trainSkill, drain, keepAlive, quietSim } from './helpers';
import { ANIMAL_LEVELS } from '../src/data/progression';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BALANCE } from '../src/data/balance';
import { hasHide, SPECIES, type SpeciesId } from '../src/data/species';
import { rigParts } from '../src/render/creatures';
import { createAnimal } from '../src/sim/animals';
import { carcassStep, normalizeCarcass } from '../src/sim/carcass';
import type { SimEvent } from '../src/sim/events';
import { countItem } from '../src/sim/inventory';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { catchChance, MAX_SKILL_LEVEL, SKILL_IDS, SKILL_INFO, skillEffect, skillLevel, skinChance } from '../src/sim/skills';
import type { CarcassState } from '../src/sim/state';
import { skinChance as knifeSkinChance } from '../src/sim/upgrades';

const K = BALANCE.skills;
const HIDE_SPECIES: SpeciesId[] = ['rabbit', 'squirrel', 'deer', 'jackrabbit', 'javelina', 'wolf', 'bear', 'cougar', 'boar', 'goat'];
const HIDELESS: SpeciesId[] = ['quail', 'roadrunner', 'lizard', 'snake', 'junglefowl', 'crab', 'viper'];
/** XP at the start of each level, 1..50. */
const LEVEL_XP = [0, ...K.thresholds];

/** A carcass of `species` right in front of the player, as a kill leaves it. */
function carcass(sim: Simulation, species: SpeciesId): CarcassState {
  trainSkill(sim, 'hunting', ANIMAL_LEVELS[species].hunt);
  trainSkill(sim, 'skinning', ANIMAL_LEVELS[species].skin);
  const s = sim.state;
  const p = s.player;
  const c: CarcassState = {
    id: s.nextId++, species, x: p.x + 1, y: p.y, z: p.z, rot: 0,
    remaining: SPECIES[species].drops.map((d) => ({ ...d })), expiresAt: s.totalHours + 24,
  };
  s.carcasses.push(c);
  return c;
}

function knifeSim(biome: 'pnw' | 'desert' = 'pnw'): Simulation {
  const sim = biome === 'pnw' ? quietSim() : Simulation.newGame(42, biome);
  sim.state.animals.length = 0;
  keepAlive(sim);
  sim.state.tools.push('knife');
  sim.selectTool('knife');
  drain(sim);
  return sim;
}

/** Makes the next skinning roll come out whole (or torn). */
function nextSkin(sim: Simulation, whole: boolean): void {
  const rng = (sim as unknown as { rng: Rng }).rng;
  const chance = rng.chance.bind(rng);
  rng.chance = () => {
    rng.chance = chance;
    return whole;
  };
}

const cut = (sim: Simulation, c: CarcassState): SimEvent[] => {
  sim.perform({ kind: 'carcass', id: c.id, dist: 1 });
  return drain(sim);
};
const messages = (ev: SimEvent[]) => ev.flatMap((e) => (e.type === 'message' ? [e.text] : []));

describe('no knife, no processing (round 10)', () => {
  it('you can still kill without a knife, but the carcass says "Needs a knife" and nothing comes off it', () => {
    const sim = quietSim();
    trainSkill(sim, 'hunting', 5);
    trainSkill(sim, 'skinning', 5);
    sim.state.tools.push('spear');
    sim.selectTool('spear');
    const p = sim.state.player;
    sim.state.animals.push(createAnimal(500, 'deer', p.x + 1.5, p.z, new Rng(1), sim.terrain));
    for (let i = 0; i < 3 && sim.state.animals.length; i++) sim.perform({ kind: 'animal', id: 500, dist: 2 });
    expect(sim.state.animals).toHaveLength(0);
    const c = sim.state.carcasses[0];
    const before = JSON.stringify(c);
    drain(sim);
    for (const tool of ['spear', 'hands'] as const) {
      sim.selectTool(tool);
      const ev = cut(sim, c);
      expect(ev.find((e) => e.type === 'needTool')).toMatchObject({ message: expect.stringContaining('Needs a knife') });
      expect(ev.some((e) => e.type === 'skinned' || e.type === 'butchered')).toBe(false);
    }
    expect(JSON.stringify(sim.state.carcasses[0])).toBe(before);
    expect(countItem(sim.state.inventory, 'hide') + countItem(sim.state.inventory, 'rawMeat')).toBe(0);
  });

  it('with a knife in the pack but not in hand, it says to equip it', () => {
    const sim = knifeSim();
    sim.selectTool('hands');
    const c = carcass(sim, 'deer');
    const ev = cut(sim, c);
    expect(ev.find((e) => e.type === 'needTool')).toMatchObject({ message: 'Equip your Stone Knife [7] to skin and butcher.' });
    expect(c.skinned).toBeUndefined();
  });
});

describe('skin, then butcher, then gone (round 10)', () => {
  it('first cut skins (hide into the pack), second butchers (meat into the pack), and the carcass disappears', () => {
    const sim = knifeSim();
    const c = carcass(sim, 'deer');
    expect(carcassStep(c)).toBe('skin');
    nextSkin(sim, true);
    const first = cut(sim, c);
    expect(first).toContainEqual({ type: 'skinned', id: c.id, species: 'deer', hides: 2, x: c.x, y: c.y, z: c.z });
    expect(messages(first)).toContain('You skinned the black-tailed deer. Cut again to butcher it.');
    expect(countItem(sim.state.inventory, 'hide')).toBe(2);
    expect(countItem(sim.state.inventory, 'rawMeat')).toBe(0);
    expect(sim.state.carcasses[0]).toMatchObject({ id: c.id, skinned: true });
    expect(carcassStep(c)).toBe('butcher');

    const second = cut(sim, c);
    expect(second).toContainEqual({ type: 'butchered', id: c.id, species: 'deer', x: c.x, y: c.y, z: c.z });
    expect(countItem(sim.state.inventory, 'rawMeat')).toBe(3);
    expect(countItem(sim.state.inventory, 'hide')).toBe(2);
    expect(sim.state.carcasses).toHaveLength(0);
    expect(sim.state.stats.events).toMatchObject({ skinned: 1, hidesWhole: 1, butchered: 1 });
  });

  it('a torn hide still leaves the skinned carcass (no hide), and it can then be butchered', () => {
    const sim = knifeSim();
    const c = carcass(sim, 'wolf');
    nextSkin(sim, false);
    const first = cut(sim, c);
    expect(first).toContainEqual(expect.objectContaining({ type: 'skinned', hides: 0 }));
    expect(messages(first)[0]).toMatch(/The hide tore\. The grey wolf is skinned, but there's no hide to keep/);
    expect(c.skinned).toBe(true);
    expect(c.remaining.find((r) => r.item === 'hide')!.count).toBe(0);
    expect(countItem(sim.state.inventory, 'hide')).toBe(0);
    expect(sim.state.stats.events.hidesWhole).toBeUndefined();

    cut(sim, c);
    expect(countItem(sim.state.inventory, 'rawMeat')).toBe(2);
    expect(countItem(sim.state.inventory, 'hide')).toBe(0);
    expect(sim.state.carcasses).toHaveLength(0);
  });

  it('a full pack sets the hide and then the meat down beside the carcass', () => {
    const sim = knifeSim();
    const c = carcass(sim, 'bear');
    sim.state.inventory.slots.fill({ item: 'stone', count: 99 });
    nextSkin(sim, true);
    expect(messages(cut(sim, c))).toContain('You skinned the black bear. No room in your pack, so the hide is on the ground.');
    expect(sim.state.drops.find((d) => d.item === 'hide')!.count).toBe(3);
    expect(messages(cut(sim, c))).toContain('Your pack is full, so the rest of the meat is on the ground.');
    expect(sim.state.drops.find((d) => d.item === 'rawMeat')!.count).toBe(4);
    expect(sim.state.carcasses).toHaveLength(0);
  });

  it('works on every animal with a hide, on both maps', () => {
    for (const species of HIDE_SPECIES) {
      const sim = knifeSim(species === 'jackrabbit' || species === 'javelina' || species === 'cougar' ? 'desert' : 'pnw');
      const c = carcass(sim, species);
      const ev = cut(sim, c);
      expect(ev.some((e) => e.type === 'skinned'), species).toBe(true);
      expect(sim.state.carcasses, species).toHaveLength(1);
      cut(sim, c);
      expect(sim.state.carcasses, species).toHaveLength(0);
    }
  });
});

describe('animals without a hide (round 10)', () => {
  it('only birds, lizards, snakes and crabs (with meat) have no hide', () => {
    // Fish and the other swimmers never leave a carcass: they go straight into the pack.
    const withMeat = (Object.keys(SPECIES) as SpeciesId[]).filter((s) => SPECIES[s].drops.length > 0 && SPECIES[s].habitat === 'land');
    expect(withMeat.filter((s) => !hasHide(s)).sort()).toEqual([...HIDELESS].sort());
    expect(withMeat.filter(hasHide).sort()).toEqual([...HIDE_SPECIES].sort());
  });

  it('go straight to butchering: one cut, no skinning, no Skinning XP, and the carcass is gone', () => {
    for (const species of HIDELESS) {
      const sim = knifeSim('desert');
      const c = carcass(sim, species);
      expect(carcassStep(c), species).toBe('butcher');
      const ev = cut(sim, c);
      expect(ev.some((e) => e.type === 'skinned'), species).toBe(false);
      expect(ev.some((e) => e.type === 'butchered' && e.species === species), species).toBe(true);
      expect(countItem(sim.state.inventory, 'rawMeat'), species).toBe(1);
      expect(sim.state.carcasses, species).toHaveLength(0);
      expect(sim.state.skills.skinning, species).toBe(0);
      expect(sim.state.stats.events.butchered, species).toBe(1);
    }
  });
});

describe('the Skinning skill (round 10)', () => {
  it('is listed with the other skills and starts at 0 in a new game', () => {
    expect(SKILL_IDS).toContain('skinning');
    expect(SKILL_INFO.skinning.name).toBe('Skinning');
    expect(quietSim().state.skills.skinning).toBe(0);
    expect(skillEffect('skinning', 0)).toBe('+0% skinning chance (35% with a plain knife)');
    expect(skillEffect('skinning', K.thresholds.at(-1)!)).toBe('+35% skinning chance (70% with a plain knife)');
  });

  it('success curve: 35% at level 1 (a new fisher\'s catch), up gradually to 70% at level 50', () => {
    const curve = LEVEL_XP.map((xp) => Math.round(skinChance(xp) * 100));
    expect(curve[0]).toBe(35);
    expect(curve.at(-1)).toBe(70);
    expect(curve.every((chance, i) => i === 0 || chance >= curve[i - 1])).toBe(true);
    expect(curve).toHaveLength(MAX_SKILL_LEVEL);
    for (const xp of LEVEL_XP) expect(skinChance(xp)).toBeCloseTo(catchChance(xp), 10);
  });

  it('knife upgrades add 7%, 14% and 20% on top, never past 95%', () => {
    const s = quietSim().state;
    const at = (xp: number) => {
      s.skills.skinning = xp;
      return [0, 1, 2, 3].map((lv) => knifeSkinChance(s, lv));
    };
    expect(at(0)).toEqual([0.35, 0.42, 0.49, 0.55]);
    expect(at(K.thresholds.at(-1)!)).toEqual([0.7, 0.77, 0.84, 0.9]);
    for (const xp of LEVEL_XP) expect(Math.max(...at(xp))).toBeLessThanOrEqual(K.maxSkinChance);
  });

  it('a novice takes the hide whole about a third of the time', () => {
    const sim = knifeSim();
    let whole = 0;
    const n = 1500;
    for (let i = 0; i < n; i++) {
      sim.state.skills.skinning = 0;
      const c = carcass(sim, 'rabbit');
      if ((cut(sim, c).find((e) => e.type === 'skinned') as { hides: number }).hides > 0) whole++;
      sim.state.carcasses.length = 0;
      sim.state.inventory.slots.fill(null);
      sim.state.toolWear.knife = { dur: 30, max: 30 };
    }
    expect(whole / n).toBeGreaterThan(0.31);
    expect(whole / n).toBeLessThan(0.39);
  });

  it('improves with every try, torn hides included, and announces each new level', () => {
    expect(K.xp.skin).toBe(5);
    expect(K.xp.skinFail).toBe(2);
    const sim = knifeSim();
    nextSkin(sim, true);
    cut(sim, carcass(sim, 'rabbit'));
    expect(sim.state.skills.skinning).toBe(5);
    nextSkin(sim, false);
    cut(sim, carcass(sim, 'rabbit'));
    expect(sim.state.skills.skinning).toBe(7);

    const ups: number[] = [];
    let wholes = 0;
    let tries = 0;
    let rateAtStart = 0;
    while (skillLevel(sim.state.skills.skinning) < 5 && tries < 500) {
      sim.state.carcasses.length = 0;
      sim.state.inventory.slots.fill(null);
      sim.state.toolWear.knife = { dur: 30, max: 30 };
      const ev = cut(sim, carcass(sim, 'rabbit'));
      tries++;
      if ((ev.find((e) => e.type === 'skinned') as { hides: number }).hides > 0) wholes++;
      if (tries === 1) rateAtStart = skinChance(sim.state.skills.skinning);
      for (const e of ev) if (e.type === 'skillUp' && e.skill === 'skinning') ups.push(e.level);
    }
    expect(skillLevel(sim.state.skills.skinning)).toBe(5);
    expect(ups).toEqual([2, 3, 4, 5].filter((l) => l > skillLevel(7)));
    expect(skinChance(sim.state.skills.skinning)).toBeGreaterThan(rateAtStart);
    expect(wholes).toBeGreaterThan(0);
    expect(sim.state.stats.events.skinned).toBe(tries + 2);
  });

  it('is saved, and a save from before round 10 starts it at 0', () => {
    const sim = quietSim();
    sim.state.skills.skinning = 42;
    expect(deserializeState(serializeState(sim.state))!.skills.skinning).toBe(42);
    const raw = JSON.parse(serializeState(sim.state));
    raw.version = 5;
    delete raw.skills.skinning;
    expect(deserializeState(JSON.stringify(raw))!.skills.skinning).toBe(0);
  });
});

describe('carcass models (round 10)', () => {
  const box = (g: THREE.BufferGeometry) => new THREE.Box3().setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute);

  it('a skinned carcass has its own model: the same animal, slimmer, all raw muscle and sinew', () => {
    for (const species of HIDE_SPECIES) {
      const fur = rigParts(species);
      const skinned = rigParts(species, 0, true);
      expect(skinned, species).not.toBe(fur);
      expect(rigParts(species, 0, true), species).toBe(skinned);
      expect(skinned.legs.length, species).toBe(fur.legs.length);
      const a = box(fur.body);
      const b = box(skinned.body);
      expect(b.max.x - b.min.x, species).toBeLessThan((a.max.x - a.min.x) * 0.85);
      expect(b.max.y - b.min.y, species).toBeLessThan((a.max.y - a.min.y) * 0.9);
      expect(b.max.z - b.min.z, species).toBeCloseTo(a.max.z - a.min.z, 5);
      for (const g of [skinned.body, skinned.head, ...skinned.legs.map((l) => l.geo)]) {
        const col = g.getAttribute('color') as THREE.BufferAttribute;
        let red = 0;
        for (let i = 0; i < col.count; i++) {
          const [r, gr, b] = [col.getX(i), col.getY(i), col.getZ(i)];
          const muscle = r > gr * 1.4 && r > b * 1.4;
          const sinew = Math.min(r, gr, b) > 0.45;
          expect(muscle || sinew, species).toBe(true);
          if (muscle) red++;
        }
        expect(red / col.count, species).toBeGreaterThan(0.6);
      }
    }
  });
});

describe('carcasses in saves (round 10)', () => {
  it('a skinned carcass stays skinned through a save and load', () => {
    const sim = knifeSim();
    const c = carcass(sim, 'deer');
    nextSkin(sim, false);
    cut(sim, c);
    const loaded = deserializeState(serializeState(sim.state))!;
    expect(loaded.carcasses[0]).toMatchObject({ id: c.id, skinned: true });
    const back = new Simulation(loaded);
    back.state.tools.push('knife');
    back.selectTool('knife');
    back.perform({ kind: 'carcass', id: c.id, dist: 1 });
    expect(drain(back).some((e) => e.type === 'butchered')).toBe(true);
    expect(back.state.carcasses).toHaveLength(0);
  });

  it('old carcasses load as they were left: a hide still on is unskinned, a hide already taken counts as skinned', () => {
    const base = { id: 1, x: 0, y: 0, z: 0, rot: 0, expiresAt: 30 };
    expect(normalizeCarcass({ ...base, species: 'deer', remaining: [{ item: 'rawMeat', count: 3 }, { item: 'hide', count: 2 }] }).skinned).toBeUndefined();
    expect(normalizeCarcass({ ...base, species: 'deer', remaining: [{ item: 'rawMeat', count: 3 }, { item: 'hide', count: 0 }] }).skinned).toBe(true);
    expect(normalizeCarcass({ ...base, species: 'deer', remaining: [{ item: 'rawMeat', count: 1 }] }).skinned).toBe(true);
    expect(normalizeCarcass({ ...base, species: 'quail', remaining: [{ item: 'rawMeat', count: 1 }], skinned: true }).skinned).toBeUndefined();

    const sim = quietSim();
    const c = carcass(sim, 'deer');
    const gone = carcass(sim, 'rabbit');
    gone.remaining = [{ item: 'rawMeat', count: 1 }];
    const raw = JSON.parse(serializeState(sim.state));
    raw.version = 5;
    const loaded = deserializeState(JSON.stringify(raw))!;
    expect(loaded.carcasses.find((x) => x.id === c.id)!.skinned).toBeUndefined();
    expect(loaded.carcasses.find((x) => x.id === gone.id)!.skinned).toBe(true);
  });
});
