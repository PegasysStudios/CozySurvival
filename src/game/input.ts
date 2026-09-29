const NON_TEXT_INPUTS = ['range', 'checkbox', 'radio', 'button', 'submit'];

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
  return t instanceof HTMLInputElement && !NON_TEXT_INPUTS.includes(t.type);
}

/** Keyboard/mouse state with per-frame edge detection and pointer-lock management. */
export class Input {
  readonly held = new Set<string>();
  private readonly downEdges = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  primary = false;
  primaryPressed = false;
  primaryReleased = false;
  secondaryPressed = false;
  locked = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  onKey: ((code: string, ev: KeyboardEvent) => void) | null = null;
  onKeyUp: ((code: string) => void) | null = null;
  private readonly target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      if (e.code === 'Tab' || e.code === 'Space' || (e.code.startsWith('Arrow') && this.locked)) e.preventDefault();
      if (!e.repeat) {
        this.held.add(e.code);
        this.downEdges.add(e.code);
        this.onKey?.(e.code, e);
      }
    });
    window.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
      this.onKeyUp?.(e.code);
    });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    target.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.primary = true;
        this.primaryPressed = true;
      } else if (e.button === 2) {
        this.secondaryPressed = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.primary) {
        this.primary = false;
        this.primaryReleased = true;
      }
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      const now = document.pointerLockElement === this.target;
      if (now === this.locked) return;
      this.locked = now;
      if (!now) this.releaseAll();
      this.onLockChange?.(now);
    });
  }

  pressed(code: string): boolean {
    return this.downEdges.has(code);
  }

  axis(neg: string[], pos: string[]): number {
    let v = 0;
    for (const k of neg) if (this.held.has(k)) v -= 1;
    for (const k of pos) if (this.held.has(k)) v += 1;
    return Math.max(-1, Math.min(1, v));
  }

  requestLock(): void {
    if (this.locked) return;
    try {
      const r = this.target.requestPointerLock() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    } catch {
      // Pointer lock can be refused (iframes, rapid re-lock after Esc); the UI offers a click-to-continue.
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  releaseAll(): void {
    this.held.clear();
    if (this.primary) this.primaryReleased = true;
    this.primary = false;
  }

  /** Clear per-frame edges and deltas. */
  endFrame(): void {
    this.downEdges.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.primaryPressed = false;
    this.primaryReleased = false;
    this.secondaryPressed = false;
  }
}
