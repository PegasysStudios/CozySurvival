export type UiMode = 'title' | 'playing' | 'paused' | 'panel' | 'dead' | 'sleeping';
export type EscapeAction = 'closeMenu' | 'resume' | 'pause' | 'none';

/** How long after an Esc that closed a menu a lost pointer lock is still blamed on that same key press. */
export const ESC_GRACE_MS = 500;
/** A missed key-up (e.g. the window lost focus) stops counting as "Esc held" after this long. */
export const ESC_HOLD_MAX_MS = 1500;

/**
 * Esc priority: an open menu always closes first; only with no menu open does Esc pause (or resume).
 *
 * Browsers also release pointer lock on Esc by themselves, which would otherwise read as "pause". So after
 * Esc closes a menu the game waits for the key to come back up before re-locking the pointer, and any lock
 * loss while Esc is held (or just after) is ignored rather than opening the pause menu.
 */
export class EscapeRouter {
  private heldSince = -Infinity;
  private held = false;
  private graceUntil = -Infinity;

  /** Esc went down. `locked` is whether the pointer is captured right now. */
  down(mode: UiMode, locked: boolean, now: number): EscapeAction {
    this.held = false;
    if (mode === 'panel') {
      this.held = true;
      this.heldSince = now;
      this.graceUntil = now + ESC_GRACE_MS;
      return 'closeMenu';
    }
    if (mode === 'paused') return 'resume';
    // With the pointer captured, the browser's own lock release (see `pausesOnUnlock`) does the pausing.
    if (mode === 'playing' && !locked && !this.inGrace(now)) return 'pause';
    return 'none';
  }

  /** Esc came back up. Returns true when the pointer should be re-captured now (a menu was just closed). */
  up(now: number): boolean {
    if (!this.held) return false;
    this.held = false;
    this.graceUntil = now + ESC_GRACE_MS;
    return true;
  }

  /** The pointer lock was lost while playing. False when that was just the Esc press that closed a menu. */
  pausesOnUnlock(now: number): boolean {
    return !this.inGrace(now);
  }

  private inGrace(now: number): boolean {
    return (this.held && now - this.heldSince < ESC_HOLD_MAX_MS) || now < this.graceUntil;
  }
}
