import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BALANCE } from '../src/data/balance';
import { SPECIES, type PreySpecies, type SpeciesId } from '../src/data/species';
import { createAnimal, damageAnimal, hostile, updateAnimal } from '../src/sim/animals';
import { Simulation } from '../src/sim/simulation';
import type { AnimalMode, AnimalState } from '../src/sim/state';
import { aimAt, animalEnv, drain, fakeTerrain, keepAlive, placeShelter, run } from './helpers';

const DEF = SPECIES.javelina as PreySpecies;
const T = DEF.territory!;
const SPRINT = BALANCE.player.sprintSpeed;
const WALK = BALANCE.player.walkSpeed;
const DT = 1 / 30;
const flat = fakeTerrain(() => 2);

function beast(species: SpeciesId, x: number, z = 0, id = 1): AnimalState {
  const a = createAnimal(id, species, x, z, new Rng(id), flat);
  a.temperament = 1;
  a.heading = 0;
  a.timer = 1e9;
  return a;
}

/** Steps every animal in the env for `seconds`, calling `each` first on every frame; returns `a`'s mode changes. */
function tick(env: ReturnType<typeof animalEnv>, a: AnimalState, seconds: number, each?: () => void): AnimalMode[] {
  const modes: AnimalMode[] = [a.mode];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    each?.();
    for (const o of env.animals) updateAnimal(o, env, DT);
    if (modes[modes.length - 1] !== a.mode) modes.push(a.mode);
  }
  return modes;
}

function world(...animals: AnimalState[]) {
  return animalEnv(flat, { playerX: 200, playerZ: 200, animals });
}

describe('territorial javelinas (round 9)', () => {
  it('can never outrun a sprinting player, not even fleeing hurt', () => {
    const top = Math.max(T.chargeSpeed, DEF.runSpeed * 1.1, DEF.walkSpeed * 2.5);
    expect(top).toBeLessThan(SPRINT);
    expect(T.chargeSpeed).toBeGreaterThan(WALK);
  });

  it('clacks, then charges a player who walks into its territory, and butts them', () => {
    const a = beast('javelina', 0);
    const env = world(a);
    env.playerX = 0;
    env.playerZ = 9;
    const modes = tick(env, a, 4);
    expect(modes.slice(0, 3)).toEqual(['idle', 'warn', 'chase']);
    expect(env.events.some((e) => e.type === 'predatorAlert' && e.species === 'javelina')).toBe(true);
    expect(env.hurts.length).toBeGreaterThanOrEqual(1);
    expect(env.hurts[0]).toEqual({ amount: T.damage, source: 'javelina' });
    expect(hostile(a)).toBe(true);
  });

  it('a sprinting player gets away every time: the gap only grows, and it gives up and goes home', () => {
    for (const start of [2, 4, 8]) {
      const a = beast('javelina', 0);
      const env = world(a);
      env.playerX = 0;
      env.playerZ = start;
      tick(env, a, T.warnTime + 0.05);
      expect(a.mode).toBe('chase');
      let gap = Math.hypot(env.playerX - a.x, env.playerZ - a.z);
      let arrived = Infinity;
      const modes = tick(env, a, 16, () => {
        env.playerZ += SPRINT * DT;
        const d = Math.hypot(env.playerX - a.x, env.playerZ - a.z);
        expect(d).toBeGreaterThanOrEqual(gap - 1e-6);
        expect(a.speed).toBeLessThan(SPRINT);
        gap = d;
        if (a.mode === 'retreat') arrived = Math.hypot(a.x - a.homeX, a.z - a.homeZ);
      });
      expect(env.hurts, `from ${start} m`).toHaveLength(0);
      expect(modes.slice(0, 3)).toEqual(['chase', 'retreat', 'idle']);
      expect(arrived).toBeLessThan(3.5);
    }
  });

  it('walking away gets you butted, but it stops at the edge of its ground', () => {
    const a = beast('javelina', 0);
    const env = world(a);
    env.playerX = 0;
    env.playerZ = 6;
    tick(env, a, T.warnTime);
    const modes = tick(env, a, 12, () => (env.playerZ += WALK * DT));
    expect(env.hurts.length).toBeGreaterThanOrEqual(1);
    expect(env.hurts.length).toBeLessThanOrEqual(4);
    expect(modes).toContain('retreat');
    expect(env.playerZ).toBeGreaterThan(T.radius * T.leash);
  });

  it('only watches a player outside its territory', () => {
    const a = beast('javelina', 0);
    const env = world(a);
    env.playerX = T.radius + 2;
    env.playerZ = 0;
    const modes = tick(env, a, 10);
    expect(modes).toContain('alert');
    expect(modes).not.toContain('warn');
    expect(modes).not.toContain('flee');
    expect(env.hurts).toHaveLength(0);
  });

  it('fights back when hit, and bolts (still slower than a sprint) once badly hurt', () => {
    const a = beast('javelina', 0);
    const env = world(a);
    env.playerX = 0;
    env.playerZ = 2;
    expect(damageAnimal(a, BALANCE.combat.axe.damage, env)).toBe(false);
    expect(a.mode).toBe('chase');
    expect(damageAnimal(a, BALANCE.combat.hand.damage, env)).toBe(false);
    expect(a.mode).toBe('flee');
    let top = 0;
    tick(env, a, 4, () => {
      a.hurt = 0.3;
      top = Math.max(top, a.speed);
    });
    expect(top).toBeGreaterThan(DEF.runSpeed);
    expect(top).toBeLessThan(SPRINT);
    expect(damageAnimal(a, BALANCE.combat.spear.damage, env)).toBe(true);
  });

  it('a spear hit sends it running, and one shot from far outside its ground does too', () => {
    const a = beast('javelina', 0);
    const env = world(a);
    env.playerX = 0;
    env.playerZ = 3;
    damageAnimal(a, BALANCE.combat.spear.damage, env);
    expect(a.mode).toBe('flee');
    const b = beast('javelina', 0, 0, 2);
    env.playerZ = T.radius * T.leash + 5;
    damageAnimal(b, BALANCE.combat.bow.minDamage, env);
    expect(b.mode).toBe('flee');
  });

  it('charges other animals that wander in: a jackrabbit bolts away from it', () => {
    const a = beast('javelina', 0);
    const r = beast('jackrabbit', 0, 6, 2);
    const env = world(a, r);
    let fled = false;
    const modes = tick(env, a, 5, () => {
      if (r.mode === 'flee' && r.foe === a.id) fled = true;
    });
    expect(fled).toBe(true);
    expect(modes.slice(0, 4)).toEqual(['idle', 'warn', 'chase', 'retreat']);
    expect(Math.hypot(r.x, r.z)).toBeGreaterThan(T.radius * T.leash);
    expect(Math.hypot(a.x, a.z)).toBeLessThan(4);
    expect(env.hurts).toHaveLength(0);
    expect(hostile(a)).toBe(false);
  });

  it('butts a mountain lion that walks through until it slinks off home', () => {
    const a = beast('javelina', 0);
    const c = beast('cougar', 3, 5, 2);
    c.homeX = 60;
    c.homeZ = 0;
    const env = world(a, c);
    const modes = tick(env, a, 6);
    expect(modes).toContain('chase');
    expect(c.mode).toBe('retreat');
    tick(env, a, 15);
    expect(Math.hypot(c.x, c.z)).toBeGreaterThan(T.radius);
    expect(env.hurts).toHaveLength(0);
  });

  it('herd-mates close by join a charge at a player', () => {
    const a = beast('javelina', 0);
    const b = beast('javelina', 8, 0, 2);
    b.homeX = 30;
    const far = beast('javelina', 60, 0, 3);
    const env = world(a, b, far);
    env.playerX = 0;
    env.playerZ = 8;
    tick(env, a, 0.2);
    expect(a.mode).toBe('warn');
    expect(b.mode).toBe('warn');
    expect(far.mode).not.toBe('warn');
  });

  it("doesn't charge scorpions or other javelinas", () => {
    const a = beast('javelina', 0);
    const env = world(a, beast('javelina', 3, 0, 2), beast('scorpion', 0, 3, 3));
    env.animals[2].mode = 'retreat';
    env.animals[2].timer = 1e9;
    expect(tick(env, a, 5)).not.toContain('warn');
  });
});

describe('javelinas in the game (round 9)', () => {
  function withJavelina(): { sim: Simulation; a: AnimalState } {
    const sim = Simulation.newGame(42, 'desert');
    sim.state.animals.length = 0;
    sim.state.spawnCheckAt = Infinity;
    const p = sim.state.player;
    const a = createAnimal(sim.state.nextId++, 'javelina', p.x + 7, p.z, new Rng(5), sim.terrain);
    a.heading = -Math.PI / 2;
    sim.state.animals.push(a);
    return { sim, a };
  }

  it('charges you when you stand in its ground, and you can sprint clear', () => {
    const { sim, a } = withJavelina();
    const p = sim.state.player;
    keepAlive(sim);
    const hit = run(sim, 3).filter((e) => e.type === 'hurt' && e.source === 'javelina');
    expect(hit.length).toBeGreaterThanOrEqual(1);
    expect(sim.state.lastDamage).toBe('javelina');
    aimAt(sim, 2 * p.x - a.x, p.y + BALANCE.player.eyeHeight, 2 * p.z - a.z);
    const later: number[] = [];
    for (let s = 0; s < 8; s += 0.5) {
      keepAlive(sim);
      const ev = run(sim, 0.5, { moveZ: 1, sprint: true });
      if (ev.some((e) => e.type === 'hurt' && e.source === 'javelina')) later.push(s);
    }
    expect(later.every((s) => s < 1)).toBe(true);
    expect(a.mode === 'retreat' || a.mode === 'idle' || a.mode === 'wander').toBe(true);
  });

  it('blocks sleep while it is after you', () => {
    const { sim, a } = withJavelina();
    const shelter = placeShelter(sim, 'leanTo');
    const p = sim.state.player;
    a.x = p.x + 6;
    a.z = p.z;
    a.homeX = a.x;
    a.homeZ = a.z;
    sim.devSetHour(21);
    keepAlive(sim);
    run(sim, T.warnTime + 0.2);
    expect(hostile(a)).toBe(true);
    drain(sim);
    expect(sim.trySleep(shelter.id)).toBe(false);
    expect(drain(sim).some((e) => e.type === 'sleepDenied' && /javelina after you/.test(e.reason))).toBe(true);
  });
});
