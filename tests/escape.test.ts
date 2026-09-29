import { describe, expect, it } from 'vitest';
import { ESC_GRACE_MS, ESC_HOLD_MAX_MS, EscapeRouter } from '../src/game/escape';

describe('Esc: menus close first, pause only with no menu open', () => {
  it('closes any open menu instead of pausing, whether or not the pointer is captured', () => {
    expect(new EscapeRouter().down('panel', false, 0)).toBe('closeMenu');
    expect(new EscapeRouter().down('panel', true, 0)).toBe('closeMenu');
  });

  it('pauses when playing with no menu open, and resumes from pause', () => {
    const esc = new EscapeRouter();
    // pointer captured: the browser releases the lock on Esc, and that release pauses
    expect(esc.down('playing', true, 0)).toBe('none');
    expect(esc.pausesOnUnlock(1)).toBe(true);
    // pointer already free (e.g. the click-to-continue overlay): the key press itself pauses
    expect(esc.down('playing', false, 10)).toBe('pause');
    expect(esc.down('paused', false, 20)).toBe('resume');
  });

  it('does nothing on the title, death and sleep screens', () => {
    const esc = new EscapeRouter();
    for (const mode of ['title', 'dead', 'sleeping'] as const) expect(esc.down(mode, false, 0)).toBe('none');
  });

  it('the Esc that closed a menu never also opens pause', () => {
    const esc = new EscapeRouter();
    expect(esc.down('panel', false, 1000)).toBe('closeMenu');
    // browser drops pointer lock while the key is still down (or a moment after): not a pause
    expect(esc.pausesOnUnlock(1010)).toBe(false);
    // re-capture waits for key-up, then the grace window runs out
    expect(esc.up(1100)).toBe(true);
    expect(esc.pausesOnUnlock(1100 + ESC_GRACE_MS - 1)).toBe(false);
    expect(esc.pausesOnUnlock(1100 + ESC_GRACE_MS + 1)).toBe(true);
    // a second, separate Esc press now pauses as normal
    expect(esc.down('playing', false, 1100 + ESC_GRACE_MS + 50)).toBe('pause');
  });

  it('a quick double-tap closes the menu without bouncing into pause', () => {
    const esc = new EscapeRouter();
    esc.down('panel', false, 0);
    esc.up(80);
    expect(esc.down('playing', false, 200)).toBe('none');
  });

  it('only a menu-closing Esc asks to re-capture the pointer on key-up', () => {
    const esc = new EscapeRouter();
    expect(esc.up(0)).toBe(false);
    esc.down('playing', true, 10);
    expect(esc.up(20)).toBe(false);
    esc.down('panel', false, 30);
    expect(esc.up(40)).toBe(true);
    expect(esc.up(50)).toBe(false);
  });

  it('a missed key-up cannot block pausing forever', () => {
    const esc = new EscapeRouter();
    esc.down('panel', false, 0);
    expect(esc.pausesOnUnlock(ESC_HOLD_MAX_MS - 1)).toBe(false);
    expect(esc.pausesOnUnlock(ESC_HOLD_MAX_MS + 1)).toBe(true);
  });
});
