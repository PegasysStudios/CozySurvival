// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '../src/net/config';
import type { ServerInfo } from '../src/net/lobby';
import { MpMenu } from '../src/ui/multiplayer';

const server: ServerInfo = { sid: 'camp-1', name: 'Lakeside camp', host: 'Riley', n: 1, max: 4, day: 3, v: PROTOCOL_VERSION, map: 'pnw' };

function mount() {
  const root = document.createElement('div');
  const launch = document.createElement('button');
  launch.textContent = 'Multiplayer';
  root.append(launch);
  document.body.append(root);
  const host = { onCreate: vi.fn(), onJoin: vi.fn(), onCancel: vi.fn(), onRetry: vi.fn(), onStatus: vi.fn(), portrait: () => '/portrait.png', sfx: vi.fn() };
  const menu = new MpMenu(root, host);
  host.onCancel.mockImplementation(() => menu.closeOverlay());
  launch.addEventListener('click', () => { launch.focus(); menu.openLobby(); });
  const click = (selector: string) => menu.overlay.querySelector<HTMLButtonElement>(selector)!.click();
  const submit = () => menu.overlay.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return { root, launch, host, menu, click, submit };
}

afterEach(() => { document.body.replaceChildren(); window.localStorage.clear(); });

describe('multiplayer pop-up', () => {
  it('shows the live server browser and create option in a framed modal', () => {
    const { menu, launch, click, host } = mount();
    expect(menu.overlayOpen).toBe(false);
    menu.setStatus({ kind: 'online', local: false });
    menu.setServers([server]);
    launch.click();
    expect(menu.overlayOpen).toBe(true);
    expect(menu.overlay.getAttribute('role')).toBe('dialog');
    expect(menu.overlay.querySelector('.mp-lobby.menu-popup-card')).not.toBeNull();
    expect(menu.overlay.textContent).toContain('Lakeside camp');
    expect(menu.overlay.textContent).toContain('Day 3 · 1/4 players');
    expect(menu.overlay.querySelector<HTMLButtonElement>('.mp-create')!.disabled).toBe(false);
    expect(host.onCreate).not.toHaveBeenCalled();
    click('[aria-label="Close multiplayer"]');
    expect(menu.overlayOpen).toBe(false);
    expect(document.activeElement).toBe(launch);
    expect(launch.inert).toBe(false);
  });

  it('handles unavailable, loading, empty and offline states without starting a session', () => {
    const { menu, launch, click, host } = mount();
    launch.click();
    expect(menu.overlay.textContent).toContain('Multiplayer is unavailable in this build');
    expect(menu.overlay.querySelector<HTMLButtonElement>('.mp-create')!.disabled).toBe(true);
    menu.setStatus({ kind: 'checking' });
    expect(menu.overlay.textContent).toContain('Looking for the multiplayer service');
    menu.setStatus({ kind: 'online', local: false });
    expect(menu.overlay.textContent).toContain('Finding servers');
    menu.setServers([]);
    expect(menu.overlay.textContent).toContain('No servers are open');
    menu.setStatus({ kind: 'offline', message: 'Connection unavailable.' });
    expect(menu.overlay.textContent).toContain('Connection unavailable.');
    click('.mp-retry');
    expect(host.onRetry).toHaveBeenCalledOnce();
    expect(host.onCreate).not.toHaveBeenCalled();
    expect(host.onStatus).toHaveBeenLastCalledWith({ kind: 'offline', message: 'Connection unavailable.' });
  });

  it('opens character creation before creating a server, validates names, and submits the existing flow', () => {
    const { menu, host, launch, click, submit } = mount();
    menu.setStatus({ kind: 'online', local: false });
    menu.setServers([]);
    launch.click();
    click('.mp-create');
    expect(menu.overlay.querySelector('form.menu-popup-card')).not.toBeNull();
    submit();
    expect(host.onCreate).not.toHaveBeenCalled();
    expect(menu.overlay.querySelector('.mp-error')!.textContent).toContain('Pick a name');
    menu.overlay.querySelector<HTMLInputElement>('input[name="name"]')!.value = 'Alex';
    menu.overlay.querySelector<HTMLInputElement>('input[name="server"]')!.value = 'Cozy camp';
    click('[aria-label="Female character"]');
    submit();
    expect(host.onCreate).toHaveBeenCalledWith({ name: 'Alex', avatar: 'f' }, 'Cozy camp');
  });

  it('joins the selected server after character selection and disables full or incompatible servers', () => {
    const { menu, host, launch, click, submit } = mount();
    menu.setStatus({ kind: 'online', local: false });
    menu.setServers([server, { ...server, sid: 'full', name: 'Full camp', n: 4 }, { ...server, sid: 'old', name: 'Old camp', v: PROTOCOL_VERSION - 1 }]);
    launch.click();
    expect([...menu.overlay.querySelectorAll<HTMLButtonElement>('.mp-join')].map(b => b.disabled)).toEqual([false, true, true]);
    click('[data-server="camp-1"]');
    expect(menu.overlay.querySelector('input[name="server"]')).toBeNull();
    menu.overlay.querySelector<HTMLInputElement>('input[name="name"]')!.value = 'Sam';
    submit();
    expect(host.onJoin).toHaveBeenCalledWith({ name: 'Sam', avatar: 'm' }, server);
    expect(host.onCreate).not.toHaveBeenCalled();
  });

  it('updates servers without losing lobby focus or overwriting a character form', () => {
    const { menu, launch, click } = mount();
    menu.setStatus({ kind: 'online', local: false });
    menu.setServers([server]);
    launch.click();
    menu.overlay.querySelector<HTMLButtonElement>('.mp-join')!.focus();
    menu.setServers([{ ...server, day: 4 }]);
    expect(document.activeElement!.getAttribute('data-server')).toBe('camp-1');
    expect(menu.overlay.textContent).toContain('Day 4');
    click('.mp-create');
    const name = menu.overlay.querySelector<HTMLInputElement>('input[name="name"]')!;
    name.value = 'In progress';
    menu.setServers([{ ...server, name: 'Updated camp' }]);
    expect(menu.overlay.querySelector('input[name="name"]')).toBe(name);
    expect(name.value).toBe('In progress');
    expect(document.activeElement).toBe(name);
    click('.mp-actions .btn.subtle');
    expect(menu.overlay.textContent).toContain('Updated camp');
    expect(menu.overlay.querySelector('form')).toBeNull();
  });

  it('uses Escape to return from a form, then close the server browser', () => {
    const { menu, launch, click } = mount();
    menu.setStatus({ kind: 'online', local: false });
    launch.click();
    click('.mp-create');
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.overlay.querySelector('.mp-lobby')).not.toBeNull();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.overlayOpen).toBe(false);
    expect(document.activeElement).toBe(launch);
  });

  it('cancels an in-progress connection and returns errors to the server browser', () => {
    const { menu, host, launch, click } = mount();
    launch.click();
    menu.showBusy('Opening your server…');
    expect(menu.overlay.querySelector('.mp-busy.menu-popup-card')).not.toBeNull();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.onCancel).toHaveBeenCalledOnce();
    expect(menu.overlayOpen).toBe(false);
    menu.showError('The server closed.');
    expect(menu.overlay.textContent).toContain('The server closed.');
    click('.btn.primary');
    expect(menu.overlay.querySelector('.mp-lobby')).not.toBeNull();
  });
});
