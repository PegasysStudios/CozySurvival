import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { desertFingerprint } from './desertFingerprint';

const FIXTURE = new URL('./fixtures/desert-golden.json', import.meta.url);
const SEEDS = [1, 42, 777, 20260929];

// Captured from the round 10 build, before the island; regenerate only for an intentional desert change (UPDATE_GOLDEN=1).
describe('the Arizona desert map is unchanged', () => {
  const current = Object.fromEntries(SEEDS.map((s) => [s, desertFingerprint(s)]));
  if (process.env.UPDATE_GOLDEN || !existsSync(FIXTURE)) writeFileSync(FIXTURE, JSON.stringify(current, null, 2) + '\n');
  const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as typeof current;

  for (const seed of SEEDS) {
    it(`seed ${seed}: terrain, worldgen, starting state and early play match`, () => {
      expect(current[seed]).toEqual(golden[seed]);
    });
  }
});
