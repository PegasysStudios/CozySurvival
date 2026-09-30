import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { RESOURCES, type ResourceKind } from '../src/data/resources';
import type { SimEvent } from '../src/sim/events';
import { Simulation } from '../src/sim/simulation';
import { getWorldGen } from '../src/sim/worldgen';
import { aimAt, drain, run, teleport } from './helpers';

const SPINY: ResourceKind[] = ['pricklyPear', 'cholla', 'yucca'];
const P = BALANCE.player;

function quietDesert(): Simulation {
  const sim = Simulation.newGame(42, 'desert');
  sim.state.animals.length = 0;
  sim.state.spawnCheckAt = Infinity;
  return sim;
}

/** A plant of `kind` with open ground around it (no other spiny plant within 4 m), so only it can prick. */
function lonePlant(sim: Simulation, kind: ResourceKind): number {
  const g = sim.gen;
  return g.resources.findIndex((r, i) => {
    if (r.kind !== kind) return false;
    const crowded = g.resources.some((o, j) => j !== i && RESOURCES[o.kind].spines && Math.hypot(o.x - r.x, o.z - r.z) < 4);
    return !crowded && !g.cacti.some((c) => Math.hypot(c.x - r.x, c.z - r.z) < 4) && sim.terrain.slopeAt(r.x, r.z) < 0.3;
  });
}

/** Stand `dist` metres from (x, z) on the side toward `angle`, facing it. */
function standBy(sim: Simulation, x: number, z: number, dist: number, angle = 0): void {
  teleport(sim, x + Math.cos(angle) * dist, z + Math.sin(angle) * dist);
  aimAt(sim, x, sim.terrain.heightAt(x, z) + 0.4, z);
}

const pricks = (events: SimEvent[]) => events.filter((e) => e.type === 'hurt' && e.source === 'spines');

describe('cactus and yucca spines (round 9)', () => {
  for (const kind of SPINY) {
    it(`walking into a ${RESOURCES[kind].name} pricks you, with a warning the first time`, () => {
      const sim = quietDesert();
      const i = lonePlant(sim, kind);
      expect(i).toBeGreaterThanOrEqual(0);
      const r = sim.gen.resources[i];
      standBy(sim, r.x, r.z, 2.5);
      const events = run(sim, 1.5, { moveZ: 1 });
      expect(pricks(events).length).toBeGreaterThanOrEqual(1);
      expect(pricks(events)[0]).toMatchObject({ amount: RESOURCES[kind].spines!.damage, fromX: r.x, fromZ: r.z });
      expect(sim.state.needs.health).toBeLessThan(100);
      expect(sim.state.lastDamage).toBe('spines');
      expect(events.filter((e) => e.type === 'message' && /spines/.test(e.text))).toHaveLength(1);
      const again = run(sim, 3, { moveZ: 1 });
      expect(again.some((e) => e.type === 'message' && /spines/.test(e.text))).toBe(false);
    });

    it(`the ${RESOURCES[kind].name} hitbox is tight: you pick every charge from where you stand, unhurt`, () => {
      const sim = quietDesert();
      const i = lonePlant(sim, kind);
      const r = sim.gen.resources[i];
      const reach = RESOURCES[kind].spines!.radius * r.scale + P.radius * BALANCE.spines.touch;
      expect(reach).toBeLessThan(0.8);
      standBy(sim, r.x, r.z, reach + 0.35, 1.2);
      const events: SimEvent[] = [];
      for (let k = 0; k < RESOURCES[kind].charges; k++) {
        events.push(...run(sim, 0.5));
        expect(sim.target, `charge ${k}`).toMatchObject({ kind: 'resource', index: i });
        sim.perform(sim.target!);
        events.push(...drain(sim));
      }
      expect(sim.state.resources[i].charges).toBe(0);
      expect(pricks(events)).toHaveLength(0);
      expect(sim.state.needs.health).toBe(100);
    });
  }

  it('brushing past a prickly pear a body-width away does not hurt', () => {
    const sim = quietDesert();
    const r = sim.gen.resources[lonePlant(sim, 'pricklyPear')];
    const side = RESOURCES.pricklyPear.spines!.radius * r.scale + P.radius + 0.1;
    teleport(sim, r.x - 4, r.z + side);
    sim.state.player.yaw = -Math.PI / 2;
    const events = run(sim, 2, { moveZ: 1 });
    expect(sim.state.player.x).toBeGreaterThan(r.x + 2);
    expect(pricks(events)).toHaveLength(0);
  });

  it('a saguaro pricks you only when you press right up against it', () => {
    const sim = quietDesert();
    const c = sim.gen.cacti[0];
    standBy(sim, c.x, c.z, c.r + P.radius + 0.4);
    expect(pricks(run(sim, 0.5))).toHaveLength(0);
    const events = run(sim, 1, { moveZ: 1 });
    expect(pricks(events)[0]).toMatchObject({ amount: BALANCE.spines.saguaro, fromX: c.x, fromZ: c.z });
  });

  it('walking straight through a cholla pricks once; standing in one pricks at most once per cooldown and pushes you out', () => {
    const sim = quietDesert();
    const r = sim.gen.resources[lonePlant(sim, 'cholla')];
    standBy(sim, r.x, r.z, 2.5);
    expect(pricks(run(sim, 1.5, { moveZ: 1 }))).toHaveLength(1);

    const still = quietDesert();
    teleport(still, r.x + 0.15, r.z);
    const events = run(still, 4);
    const n = pricks(events).length;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(Math.ceil(4 / BALANCE.spines.cooldown));
    expect(still.state.needs.health).toBeCloseTo(100 - n * RESOURCES.cholla.spines!.damage, 0);
    expect(Math.hypot(still.state.player.x - r.x, still.state.player.z - r.z)).toBeGreaterThan(0.15);
    expect(still.spinyPlantTouching()).toBeNull();
  });

  it('a picked yucca is a stub: only stepping right on it pricks', () => {
    const sim = quietDesert();
    const i = lonePlant(sim, 'yucca');
    const r = sim.gen.resources[i];
    sim.state.resources[i].charges = 0;
    const full = RESOURCES.yucca.spines!.radius * r.scale + P.radius * BALANCE.spines.touch;
    teleport(sim, r.x + full - 0.05, r.z);
    expect(sim.spinyPlantTouching()).toBeNull();
    teleport(sim, r.x + 0.1, r.z);
    expect(sim.spinyPlantTouching()?.name).toBe(RESOURCES.yucca.name);
  });

  it('spines can kill, and the death screen says so', () => {
    const sim = quietDesert();
    const r = sim.gen.resources[lonePlant(sim, 'cholla')];
    sim.state.needs.health = 3;
    standBy(sim, r.x, r.z, 2);
    const events = run(sim, 1.5, { moveZ: 1 });
    expect(events.some((e) => e.type === 'death' && e.cause === 'spines')).toBe(true);
  });

  it('agave, stones and the Pacific Northwest plants have no spines', () => {
    for (const kind of Object.keys(RESOURCES) as ResourceKind[]) expect(!!RESOURCES[kind].spines, kind).toBe(SPINY.includes(kind));
    expect(getWorldGen(42, 'pnw').resources.some((r) => RESOURCES[r.kind].spines)).toBe(false);
  });
});
