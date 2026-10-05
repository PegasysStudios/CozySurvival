import { describe, expect, it } from 'vitest';
import { box, circle } from '../src/core/geom2d';
import { rockGeometry } from '../src/render/models';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { getTerrain, WATER_LEVEL } from '../src/sim/terrain';
import { dryFootprint, getWorldGen } from '../src/sim/worldgen';

const SEEDS = [1, 42, 777, 20260929];

describe('objects around frozen PNW lakes', () => {
  it('rejects wet centres and footprints that cross the shore, including rotated objects', () => {
    const shore = { heightAt: (x: number) => x * 0.5 };
    expect(dryFootprint(shore, circle(-1, 0, 0.5))).toBe(false);
    expect(dryFootprint(shore, circle(0.5, 0, 1))).toBe(false);
    expect(dryFootprint(shore, circle(2, 0, 1))).toBe(true);
    expect(dryFootprint(shore, box(1, 0, 2, 0.2, Math.PI / 4))).toBe(false);
    expect(dryFootprint({ heightAt: () => WATER_LEVEL }, circle(0, 0, 1))).toBe(false);
  });

  it.each(SEEDS)('seed %i: boulder footprints stay clear of lake water and ice', (seed) => {
    const terrain = getTerrain(seed);
    const gen = getWorldGen(seed);
    expect(gen.rocks.length).toBeGreaterThan(80);
    for (const rock of gen.rocks) {
      let minHeight = terrain.heightAt(rock.x, rock.z);
      // Check the whole footprint, including overhangs, rather than just the rock's centre.
      for (const scale of [0.25, 0.5, 0.75, 1]) {
        for (let i = 0; i < 64; i++) {
          const a = i * Math.PI * 2 / 64;
          const r = rock.r * 1.6 * scale;
          minHeight = Math.min(minHeight, terrain.heightAt(rock.x + Math.cos(a) * r, rock.z + Math.sin(a) * r));
        }
      }
      expect(minHeight, `rock at ${rock.x}, ${rock.z}`).toBeGreaterThan(WATER_LEVEL);
    }
    // Dry shoreline scenery remains available.
    expect(gen.rocks.some((rock) => terrain.heightAt(rock.x, rock.z) < 1.6)).toBe(true);
  });

  it('keeps the complete rendered boulder geometry off lake water', () => {
    const terrain = getTerrain(42);
    const geos = [0, 1, 2].map((variant) => rockGeometry(variant));
    for (const geo of geos) {
      const position = geo.getAttribute('position');
      let radius = 0;
      for (let i = 0; i < position.count; i++) radius = Math.max(radius, Math.hypot(position.getX(i), position.getZ(i)));
      expect(radius).toBeLessThanOrEqual(1.6);
    }
    for (const rock of getWorldGen(42).rocks) {
      const position = geos[rock.variant].getAttribute('position');
      const c = Math.cos(rock.rot), s = Math.sin(rock.rot);
      let minHeight = Infinity;
      for (let i = 0; i < position.count; i++) {
        const lx = position.getX(i) * rock.r, lz = position.getZ(i) * rock.r;
        minHeight = Math.min(minHeight, terrain.heightAt(rock.x + lx * c + lz * s, rock.z - lx * s + lz * c));
      }
      expect(minHeight).toBeGreaterThan(WATER_LEVEL);
    }
    geos.forEach((g) => g.dispose());
  });

  it('uses the same safe spawns before freezing, in winter, after reload, and after thaw', () => {
    const sim = Simulation.newGame(42);
    const gen = sim.gen;
    const heights = Array.from(sim.terrain.heights);
    sim.state.trees[0].hp = 1;
    sim.state.resources[0].charges = 0;
    sim.devSetSeason('winter');
    expect(sim.frozen).toBe(true);
    expect(sim.gen).toBe(gen);
    const loaded = new Simulation(deserializeState(serializeState(sim.state))!);
    expect(loaded.frozen).toBe(true);
    expect(loaded.gen).toBe(gen);
    expect(loaded.state.trees[0].hp).toBe(1);
    expect(loaded.state.resources[0].charges).toBe(0);
    loaded.devSetSeason('spring');
    expect(loaded.gen).toBe(gen);
    expect(Array.from(loaded.terrain.heights)).toEqual(heights);
  });
});
