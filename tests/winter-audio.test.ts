// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { AudioSystem, type AmbienceInput } from '../src/audio/audio';
import { lakeAmbienceLevel } from '../src/audio/mix';
import { Game } from '../src/game/game';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';

/** Read the real game-to-audio input without creating WebGL, playing sound, or starting a frame loop. */
function gameAudio(sim: Simulation) {
  const update = vi.fn<(dt: number, input: AmbienceInput) => void>();
  const game = Object.assign(Object.create(Game.prototype), {
    sim, mode: 'playing', audio: { started: true, update },
    view: { entities: { fires: [] }, dayNight: { night: 0 } },
    waterProbeT: 0, waterProbe: 99,
  }) as { updateAudio(dt: number): void };
  const lake = sim.terrain.lakes[0];
  Object.assign(sim.state.player, { x: lake.x, z: lake.z });
  return { game, update };
}

describe('frozen lake ambience', () => {
  it('follows winter, thaw and saved winter runs at the game audio boundary', () => {
    const sim = Simulation.newGame(42);
    const { game, update } = gameAudio(sim);
    for (const season of ['spring', 'winter', 'spring'] as const) {
      sim.devSetSeason(season);
      game.updateAudio(1 / 60);
      expect(update.mock.lastCall![1]).toMatchObject({ waterDist: 0, frozen: season === 'winter' });
    }
    sim.devSetSeason('winter');
    const saved = gameAudio(new Simulation(deserializeState(serializeState(sim.state))!));
    saved.game.updateAudio(1 / 60);
    expect(saved.update.mock.lastCall![1]).toMatchObject({ waterDist: 0, frozen: true });
  });

  it.each(['desert', 'island'] as const)('keeps %s water ambience unfrozen', (biome) => {
    const { game, update } = gameAudio(Simulation.newGame(42, biome));
    game.updateAudio(1 / 60);
    expect(update.mock.lastCall![1]).toMatchObject({ waterDist: 0, frozen: false });
  });

  it('silences an already audible lake loop on freeze, including while paused, and restores it on thaw', () => {
    const param = () => ({ setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn() });
    const lakeGain = param();
    const windGain = param();
    const fireGain = param();
    const audio = new AudioSystem();
    Object.assign(audio, {
      ctx: { currentTime: 12 }, lake: {}, lakeGain: { gain: lakeGain },
      windGain: { gain: windGain }, windFilter: { frequency: param() }, fireGain: { gain: fireGain },
    });
    const ambience = { hour: 12, night: 0, fireDist: 99, waterDist: 0, indoors: false, paused: true, frozen: false };
    audio.update(1 / 60, ambience);
    expect(lakeGain.setTargetAtTime).toHaveBeenLastCalledWith(lakeAmbienceLevel(0) * 0.35, 12, 0.6);
    audio.update(1 / 60, { ...ambience, frozen: true });
    expect(lakeGain.cancelScheduledValues).toHaveBeenLastCalledWith(12);
    expect(lakeGain.setValueAtTime).toHaveBeenLastCalledWith(0, 12);
    audio.update(1 / 60, { ...ambience, frozen: false, paused: false });
    expect(lakeGain.setTargetAtTime).toHaveBeenLastCalledWith(lakeAmbienceLevel(0), 12, 0.6);
    expect(windGain.setTargetAtTime).toHaveBeenCalledTimes(3);
    expect(fireGain.setTargetAtTime).toHaveBeenCalledTimes(3);
  });
});
