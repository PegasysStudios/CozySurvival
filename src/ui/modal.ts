import { el } from './dom';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]';

/** A menu overlay that keeps keyboard focus inside it and restores the previous menu on close. */
export class MenuModal {
  readonly root: HTMLElement;
  private returnFocus: HTMLElement | null = null;
  private readonly backgrounds = new Map<HTMLElement, boolean>();

  constructor(parent: HTMLElement, cls: string, onDismiss: () => void) {
    this.root = el('div', `screen menu-popup ${cls}`);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.tabIndex = -1;
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) onDismiss();
    });
    this.root.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onDismiss();
      } else if (ev.key === 'Tab') {
        const targets = [...this.root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => !e.closest('[hidden]'));
        const first = targets[0];
        const last = targets.at(-1);
        if (!first) {
          ev.preventDefault();
          this.root.focus();
        } else if (ev.shiftKey && (document.activeElement === first || document.activeElement === this.root)) {
          ev.preventDefault();
          last!.focus();
        } else if (!ev.shiftKey && (document.activeElement === last || document.activeElement === this.root)) {
          ev.preventDefault();
          first.focus();
        }
      }
    });
    parent.append(this.root);
  }

  get open(): boolean {
    return this.root.classList.contains('show');
  }

  show(focus?: HTMLElement): void {
    if (!this.open) {
      this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      for (const sibling of this.root.parentElement!.children) {
        if (sibling instanceof HTMLElement && sibling !== this.root) {
          this.backgrounds.set(sibling, sibling.inert);
          sibling.inert = true;
        }
      }
    }
    this.root.classList.add('show');
    this.root.setAttribute('aria-hidden', 'false');
    (focus ?? this.root.querySelector<HTMLElement>(FOCUSABLE) ?? this.root).focus();
  }

  close(): void {
    this.root.classList.remove('show');
    this.root.setAttribute('aria-hidden', 'true');
    for (const [element, inert] of this.backgrounds) element.inert = inert;
    this.backgrounds.clear();
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.root.contains(active)) active.blur();
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
    this.returnFocus = null;
  }
}
