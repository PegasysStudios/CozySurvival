import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { SPECIES, predatorTargets, type SpeciesId } from '../src/data/species';
import { FIRE_AVOID_RADIUS, createAnimal, damageAnimal, findSpawnPoint, preyRadii, updateAnimal, type AnimalEnv } from '../src/sim/animals';
import { createNewState } from '../src/sim/simulation';
import type { AnimalMode, AnimalState } from '../src/sim/state';
import { animalEnv, fakeTerrain, quietSim, run } from './helpers';

/** Flat meadow at h=2 with a deep lake for x > 50. */
const land = fakeTerrain((x) => (x > 50 ? -3 : 2));

function animal(species: SpeciesId, x: number, z: number, temperament = 1): AnimalState {
  const a = createAnimal(1, species, x, z, new Rng(3), land);
  a.temperament = temperament;
  a.heading = 0;
  a.timer = 1e9; // stay put while idle unless something happens
  return a;
}

function tick(a: AnimalState, env: AnimalEnv, seconds: number, dt = 1 / 30, each?: () => void): AnimalMode[] {
  const modes: AnimalMode[] = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    each?.();
    updateAnimal(a, env, dt);
    if (modes[modes.length - 1] !== a.mode) modes.push(a.mode);
  }
  return modes;
}

/** Walk the player straight at the animal and report how far away it was when it bolted. */
function boltDistance(species: SpeciesId, temperament: number, noise = 1): number {
  const a = animal(species, 0, 0, temperament);
  const env = animalEnv(land, { playerX: -60, playerZ: 0, playerNoise: noise });
  for (let i = 0; i < 2000; i++) {
    env.playerX += 0.05;
    updateAnimal(a, env, 1 / 30);
    if (a.mode === 'flee') return Math.hypot(env.playerX - a.x, env.playerZ - a.z);
  }
  return 0;
}

describe('prey fear levels', () => {
  it('deer bolt on sight from far away while hares let you get much closer', () => {
    const deer = boltDistance('deer', 1);
    const hare = boltDistance('rabbit', 1);
    expect(deer).toBeGreaterThan(18);
    expect(hare).toBeLessThan(12);
    expect(hare).toBeGreaterThan(3);
    expect(deer).toBeGreaterThan(hare * 2);
  });

  it('each animal has its own temperament: skittish individuals flee sooner than bold ones', () => {
    const bold = boltDistance('rabbit', 0.8);
    const skittish = boltDistance('rabbit', 1.25);
    expect(skittish).toBeGreaterThan(bold + 1.5);
  });

  it('sprinting spooks animals from further away than walking; standing still lets you get close', () => {
    const a = animal('rabbit', 0, 0);
    expect(preyRadii(a, { playerNoise: 1.6, night: false }).fear).toBeGreaterThan(preyRadii(a, { playerNoise: 1, night: false }).fear);
    const still = animal('rabbit', 0, 0);
    const env = animalEnv(land, { playerX: -4, playerZ: 0, playerNoise: 0.5 });
    tick(still, env, 3);
    expect(still.mode).not.toBe('flee');
  });

  it('an alerted animal watches a still player but bolts if you keep creeping closer', () => {
    const a = animal('rabbit', 0, 0);
    const env = animalEnv(land, { playerX: -9, playerZ: 0 });
    const modes = tick(a, env, 6);
    expect(modes).toContain('alert');
    expect(a.mode).toBe('alert');
    // creep closer slowly: flees before reaching the fear radius
    const creep = tick(a, env, 4, 1 / 30, () => (env.playerX += 0.5 / 30));
    expect(creep).toContain('flee');
    expect(-env.playerX).toBeGreaterThan(SPECIES.rabbit.kind === 'prey' ? SPECIES.rabbit.fearRadius : 0);
  });

  it('fleeing puts distance between you and the animal, then it calms down', () => {
    const a = animal('rabbit', 0, 0);
    const env = animalEnv(land, { playerX: -4, playerZ: 0 });
    const modes = tick(a, env, 8);
    expect(modes[0]).toBe('flee');
    expect(['idle', 'wander']).toContain(a.mode);
    expect(Math.hypot(a.x - env.playerX, a.z - env.playerZ)).toBeGreaterThan(16);
    expect(env.events.some((e) => e.type === 'animalFlee')).toBe(true);
  });

  it('fleeing land animals avoid the lake', () => {
    const a = animal('deer', 45, 0);
    const env = animalEnv(land, { playerX: 30, playerZ: 0 });
    const modes = tick(a, env, 10, 1 / 30, () => expect(land.heightAt(a.x, a.z)).toBeGreaterThan(0));
    expect(modes).toContain('flee');
    expect(Math.hypot(a.x - env.playerX, a.z - env.playerZ)).toBeGreaterThan(30);
  });

  it('fish flee from the shore but never leave the water', () => {
    const a = animal('fish', 53, 0);
    const env = animalEnv(land, { playerX: 50.5, playerZ: 0 });
    const modes = tick(a, env, 5);
    expect(modes).toContain('flee');
    expect(land.waterDepth(a.x, a.z)).toBeGreaterThan(0.6);
    expect(a.x).toBeGreaterThan(55);
  });

  it('being hit makes prey flee', () => {
    const a = animal('deer', 0, 0);
    const env = animalEnv(land, { playerX: -100 });
    expect(damageAnimal(a, 1, env)).toBe(false);
    expect(a.mode).toBe('flee');
    expect(damageAnimal(a, 5, env)).toBe(true);
  });
});

describe('wolves', () => {
  it('stalk, charge, bite on a cooldown, and back off between bites', () => {
    const w = animal('wolf', 18, 0);
    const env = animalEnv(land, { playerX: 0, playerZ: 0 });
    const modes = tick(w, env, 20);
    expect(modes.slice(0, 4)).toEqual(['stalk', 'chase', 'attack', 'reposition']);
    expect(env.hurts.length).toBeGreaterThanOrEqual(3);
    expect(env.hurts.length).toBeLessThanOrEqual(Math.ceil(20 / (SPECIES.wolf.kind === 'predator' ? SPECIES.wolf.attackCooldown : 1)));
    expect(env.hurts[0].source).toBe('wolf');
    expect(env.events.some((e) => e.type === 'predatorAlert')).toBe(true);
  });

  it('ignore you when far away and rarely notice you in daylight beyond detection range', () => {
    const w = animal('wolf', 40, 0);
    const env = animalEnv(land, { playerX: 0, playerZ: 0 });
    w.timer = 1e9;
    tick(w, env, 3);
    expect(w.mode).toBe('idle');
  });

  it('notice you from further away at night', () => {
    const w = animal('wolf', 26, 0);
    const env = animalEnv(land, { playerX: 0, playerZ: 0, night: true });
    tick(w, env, 0.2);
    expect(w.mode).toBe('stalk');
  });

  it('a torch keeps them circling at a distance until they give up', () => {
    const w = animal('wolf', 15, 0);
    const env = animalEnv(land, { playerX: 0, playerZ: 0, playerDeterrent: true });
    let minD = Infinity;
    const modes = tick(w, env, 16, 1 / 30, () => (minD = Math.min(minD, Math.hypot(w.x, w.z))));
    expect(modes).toContain('stalk');
    expect(modes).not.toContain('attack');
    expect(modes).toContain('retreat');
    expect(env.hurts).toHaveLength(0);
    expect(minD).toBeGreaterThan(5);
  });

  it('never walk into a campfire\'s light', () => {
    const w = animal('wolf', 20, 0);
    const fire = { x: 0, z: 0 };
    const env = animalEnv(land, { playerX: 1, playerZ: 0, litFires: [fire] });
    tick(w, env, 20, 1 / 30, () => {
      expect(Math.hypot(w.x - fire.x, w.z - fire.z)).toBeGreaterThan(FIRE_AVOID_RADIUS - 0.5);
    });
    expect(env.hurts).toHaveLength(0);
  });

  it('retreat when badly hurt, fight back when lightly hurt', () => {
    const env = animalEnv(land, { playerX: 5 });
    const a = animal('wolf', 0, 0);
    damageAnimal(a, 1, env);
    expect(a.mode).toBe('chase');
    damageAnimal(a, 2, env);
    expect(a.mode).toBe('retreat');
  });

  it('lose interest once the player is dead', () => {
    const w = animal('wolf', 5, 0);
    const env = animalEnv(land, { playerX: 0, playerDead: true });
    tick(w, env, 3);
    expect(env.hurts).toHaveLength(0);
    expect(['idle', 'wander']).toContain(w.mode);
  });
});

describe('bears', () => {
  it('warn before charging', () => {
    const b = animal('bear', 14, 0);
    const env = animalEnv(land, { playerX: 0, playerZ: 0 });
    tick(b, env, 0.1);
    expect(b.mode).toBe('warn');
    tick(b, env, 1);
    expect(b.mode).toBe('warn');
    const later = tick(b, env, 4);
    expect(later).toContain('chase');
  });

  it('back off if you retreat during the warning', () => {
    const b = animal('bear', 14, 0);
    const env = animalEnv(land, { playerX: 0, playerZ: 0 });
    tick(b, env, 0.5);
    env.playerX = -12;
    tick(b, env, 0.5);
    expect(b.mode).toBe('wander');
    expect(env.hurts).toHaveLength(0);
  });

  it('stay within their territory leash and return home', () => {
    const b = animal('bear', 5, 0);
    b.homeX = 5;
    b.homeZ = 0;
    const env = animalEnv(land, { playerX: 0, playerZ: 0 });
    b.mode = 'chase';
    let maxHome = 0;
    const modes = tick(b, env, 30, 1 / 30, () => {
      env.playerX -= 8 / 30; // player runs away faster than the bear
      maxHome = Math.max(maxHome, Math.hypot(b.x - b.homeX, b.z - b.homeZ));
    });
    expect(modes).toContain('retreat');
    const leash = SPECIES.bear.kind === 'predator' ? SPECIES.bear.leash : 0;
    expect(maxHome).toBeLessThan(leash + 4);
  });

  it('hit hard', () => {
    expect(SPECIES.bear.kind === 'predator' && SPECIES.wolf.kind === 'predator' && SPECIES.bear.attackDamage > SPECIES.wolf.attackDamage).toBe(true);
  });
});

describe('spawning and rarity', () => {
  it('predators are rare early and ramp up slowly', () => {
    expect(predatorTargets(1)).toEqual({ wolf: 1, bear: 0 });
    expect(predatorTargets(2)).toEqual({ wolf: 1, bear: 1 });
    expect(predatorTargets(3)).toEqual({ wolf: 2, bear: 1 });
    expect(predatorTargets(5)).toEqual({ wolf: 3, bear: 2 });
    expect(predatorTargets(99)).toEqual({ wolf: 4, bear: 2 });
  });

  it('day 1 has one distant wolf, no bears, and a healthy prey population', () => {
    for (const seed of [1, 42, 777]) {
      const s = createNewState(seed);
      const count = (sp: SpeciesId) => s.animals.filter((a) => a.species === sp).length;
      expect(count('wolf')).toBe(1);
      expect(count('bear')).toBe(0);
      expect(count('rabbit')).toBeGreaterThan(10);
      expect(count('deer')).toBeGreaterThan(4);
      expect(count('fish')).toBeGreaterThan(8);
      const wolf = s.animals.find((a) => a.species === 'wolf')!;
      expect(Math.hypot(wolf.x - s.player.x, wolf.z - s.player.z)).toBeGreaterThanOrEqual(100);
    }
  });

  it('spawn points respect avoid distances and habitat', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 30; i++) {
      const p = findSpawnPoint(land, rng, 'wolf', [{ x: 0, z: 0, minDist: 75 }]);
      expect(p).not.toBeNull();
      expect(Math.hypot(p!.x, p!.z)).toBeGreaterThanOrEqual(75);
      expect(land.heightAt(p!.x, p!.z)).toBeGreaterThan(0);
      const f = findSpawnPoint(land, rng, 'fish', []);
      expect(land.waterDepth(f!.x, f!.z)).toBeGreaterThan(0.6);
    }
  });

  it('population upkeep adds a bear on day 2, far from the player and camp', () => {
    const sim = quietSim();
    sim.state.totalHours = 24.5;
    sim.maintainPopulation();
    const p = sim.state.player;
    const bears = sim.state.animals.filter((a) => a.species === 'bear');
    expect(bears).toHaveLength(1);
    expect(Math.hypot(bears[0].x - p.x, bears[0].z - p.z)).toBeGreaterThanOrEqual(75);
  });
});

describe('wildlife in the running simulation', () => {
  it('walking up on a deer spooks it', () => {
    const sim = quietSim();
    const p = sim.state.player;
    let ang = 0;
    while (sim.terrain.heightAt(p.x + Math.cos(ang) * 8, p.z + Math.sin(ang) * 8) < 0.5) ang += 0.3;
    const deer = createAnimal(999, 'deer', p.x + Math.cos(ang) * 8, p.z + Math.sin(ang) * 8, new Rng(1), sim.terrain);
    deer.temperament = 1;
    sim.state.animals.push(deer);
    run(sim, 1);
    expect(sim.state.stats.events.deerSpooked).toBeGreaterThanOrEqual(1);
  });

  it('a wolf attack can end the run', () => {
    const sim = quietSim();
    Object.assign(sim.state.needs, { hunger: 100, thirst: 100 });
    const wolf = sim.devSpawn('wolf', 8)!;
    expect(wolf).not.toBeNull();
    const events = run(sim, 60);
    expect(events.some((e) => e.type === 'hurt' && e.source === 'wolf')).toBe(true);
    expect(sim.state.dead).toBe(true);
    expect(sim.state.deathCause).toBe('wolf');
  });
});
