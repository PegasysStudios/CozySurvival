import { serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { getTerrain } from '../src/sim/terrain';
import { getWorldGen } from '../src/sim/worldgen';
import { run } from './helpers';

/** FNV-1a over a string. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Rounds floats so the fingerprint ignores last-bit noise but catches any real change. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === 'number' && !Number.isInteger(x) ? Math.round(x * 1e4) / 1e4 : x));
}

/** Round 10 added the Skinning skill; a new skill's empty XP doesn't change the world or how it plays. */
function withoutSkinning<T extends { skinning?: number }>(skills: T): Omit<T, 'skinning'> {
  const { skinning: _, ...rest } = skills;
  return rest;
}

/**
 * A fingerprint of everything a PNW world is built from and how it plays for the first stretch: terrain, lakes,
 * worldgen, the starting state, and the state after a scripted walk with wildlife running through dusk.
 */
export function pnwFingerprint(seed: number): Record<string, string> {
  const t = getTerrain(seed);
  const g = getWorldGen(seed);
  const heights: number[] = [];
  for (let i = 0; i < t.heights.length; i += 7) heights.push(t.heights[i]);
  const sim = Simulation.newGame(seed);
  // Round 8 added the canteen and bumped the save version; neither changes the world or how it plays.
  const start: Omit<Partial<typeof sim.state>, 'skills'> & { skills: object } = { ...sim.state, version: 3, runId: '', skills: withoutSkinning(sim.state.skills) };
  delete start.canteen;
  run(sim, 20, { moveZ: -1 });
  run(sim, 20, { moveX: 1, sprint: true });
  sim.state.totalHours = Math.floor(sim.state.totalHours / 24) * 24 + 16.5;
  run(sim, 40);
  const after = JSON.parse(serializeState(sim.state)) as Record<string, unknown>;
  after.runId = '';
  after.version = 3;
  delete after.canteen;
  after.skills = withoutSkinning(after.skills as typeof sim.state.skills);
  return {
    heights: hash(stable(heights)),
    lakes: hash(stable(t.lakes)),
    trees: hash(stable(g.trees)),
    resources: hash(stable([g.resources, g.resourceSpots])),
    rocksLogs: hash(stable([g.rocks, g.logs])),
    start: hash(stable(start)),
    afterPlay: hash(stable(after)),
    counts: `${g.trees.length}/${g.resources.length}/${g.rocks.length}/${g.logs.length}/${start.animals!.length}`,
  };
}
