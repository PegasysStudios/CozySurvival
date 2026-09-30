import { beforeEach } from 'vitest';
import { BALANCE } from '../src/data/balance';

/**
 * Most tests craft freely on day 1, as they did before the round 10 day-1 limit; the tests for that limit switch it
 * back on with `dayOneLimit(true)`.
 */
export function dayOneLimit(on: boolean): void {
  (BALANCE.onboarding as { dayOneLimit: boolean }).dayOneLimit = on;
}

beforeEach(() => dayOneLimit(false));
