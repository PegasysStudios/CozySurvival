export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function button(label: string, cls: string, onClick: (ev: MouseEvent) => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onClick(ev);
  });
  return b;
}

/** Only touch the DOM when the value actually changed. */
export function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

export function setHtml(e: HTMLElement, html: string, key: { last?: string }): void {
  if (key.last === html) return;
  key.last = html;
  e.innerHTML = html;
}

export function toggle(e: HTMLElement, cls: string, on: boolean): void {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}

/**
 * One shared tooltip for every `[data-tip]` element inside `root`: it fades in (via the `show` class) over the
 * hovered element with that element's `data-tip` text, and hides when the pointer leaves it.
 */
export function attachTooltip(root: HTMLElement, tip: HTMLElement): void {
  const tipAt = (target: EventTarget | null): HTMLElement | null => {
    const t = target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null;
    return t && root.contains(t) ? t : null;
  };
  root.addEventListener('mouseover', (e) => {
    const t = tipAt(e.target);
    if (!t) {
      tip.classList.remove('show');
      return;
    }
    tip.textContent = t.dataset.tip ?? '';
    const r = t.getBoundingClientRect();
    const base = (tip.offsetParent ?? document.body).getBoundingClientRect();
    tip.style.left = `${Math.round(r.left + r.width / 2 - base.left)}px`;
    tip.style.top = `${Math.round(r.top - base.top)}px`;
    tip.classList.add('show');
  });
  root.addEventListener('mouseout', (e) => {
    if (!tipAt(e.relatedTarget)) tip.classList.remove('show');
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
