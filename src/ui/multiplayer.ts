import { MAX_PLAYERS, PROTOCOL_VERSION } from '../net/config';
import type { ServerInfo } from '../net/lobby';
import { cleanName, cleanText, NAME_MAX, type Avatar, type Profile } from '../net/protocol';
import type { RosterEntry } from '../net/session';
import { button, el, escapeHtml, setText, toggle } from './dom';

const PROFILE_KEY = 'cozysurvival.v1.profile';
const SERVER_NAME_MAX = 24;

export function loadProfile(): Profile | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PROFILE_KEY) ?? 'null') as Partial<Profile> | null;
    const name = cleanName(raw?.name);
    if (!name) return null;
    return { name, avatar: raw?.avatar === 'f' ? 'f' : 'm' };
  } catch {
    return null;
  }
}

function saveProfile(p: Profile): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // Private mode or a full quota: the profile just isn't remembered.
  }
}

export type MpStatus =
  | { kind: 'unconfigured' }
  | { kind: 'checking' }
  | { kind: 'online'; local: boolean }
  | { kind: 'offline'; message: string }
  | { kind: 'outdated'; message: string };

export interface MpMenuHost {
  onCreate(profile: Profile, serverName: string): void;
  onJoin(profile: Profile, server: ServerInfo): void;
  onCancel(): void;
  onRetry(): void;
  portrait(kind: Avatar): string;
  sfx(): void;
}

const AVATARS: { kind: Avatar; label: string }[] = [
  { kind: 'm', label: 'Male' },
  { kind: 'f', label: 'Female' },
];

/** The title screen's multiplayer block plus the character / joining overlay. */
export class MpMenu {
  readonly section = el('section', 'mp-section');
  readonly overlay = el('div', 'screen mp-screen');
  private readonly host: MpMenuHost;
  private status: MpStatus = { kind: 'unconfigured' };
  private servers: ServerInfo[] | null = null;
  private notice: string | null = null;

  constructor(parent: HTMLElement, host: MpMenuHost) {
    this.host = host;
    parent.append(this.overlay);
    this.render();
  }

  get overlayOpen(): boolean {
    return this.overlay.classList.contains('show');
  }

  setStatus(s: MpStatus): void {
    this.status = s;
    if (s.kind !== 'online') this.servers = null;
    this.render();
  }

  /** `null` while the first lobby list is still on its way. */
  setServers(list: ServerInfo[] | null): void {
    this.servers = list;
    this.render();
  }

  /** A one-off note, e.g. why the last session ended. */
  setNotice(text: string | null): void {
    this.notice = text;
    this.render();
  }

  private render(): void {
    const s = this.status;
    const sec = this.section;
    sec.innerHTML = '';
    toggle(sec, 'off', s.kind === 'unconfigured');
    const head = el('div', 'mp-head');
    const pill = s.kind === 'unconfigured' ? ['idle', 'Not set up']
      : s.kind === 'checking' ? ['wait', 'Checking…']
      : s.kind === 'online' ? ['ok', s.local ? 'Local test mode' : 'Online']
      : s.kind === 'outdated' ? ['bad', 'Update needed']
      : ['bad', 'Offline'];
    head.innerHTML = `<h3>Multiplayer</h3><span class="mp-pill ${pill[0]}">${pill[1]}</span>`;
    sec.append(head);
    if (this.notice) sec.append(el('div', 'mp-notice', escapeHtml(this.notice)));

    const online = s.kind === 'online';
    const create = button('Create multiplayer server <span class="btn-sub">A brand-new world · up to 4 players</span>', 'btn big mp-create', () => {
      this.host.sfx();
      this.openForm(null);
    });
    create.disabled = !online;
    sec.append(create);

    if (s.kind === 'unconfigured') {
      sec.append(el('div', 'mp-note', 'Multiplayer is not set up for this build. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to <code>.env.local</code> (see <code>docs/multiplayer-setup.md</code>).'));
      return;
    }
    if (s.kind === 'checking') {
      sec.append(el('div', 'mp-note', 'Looking for the multiplayer service…'));
      return;
    }
    if (s.kind === 'offline' || s.kind === 'outdated') {
      sec.append(el('div', 'mp-note', escapeHtml(s.message)));
      sec.append(button('Try again', 'btn subtle mp-retry', () => {
        this.host.sfx();
        this.host.onRetry();
      }));
      return;
    }
    const list = el('div', 'mp-list');
    if (this.servers === null) {
      list.append(el('div', 'mp-empty', '<span class="mp-spin"></span> Finding servers…'));
    } else if (this.servers.length === 0) {
      list.append(el('div', 'mp-empty', 'No servers are open right now. Create one and invite a friend.'));
    } else {
      for (const sv of this.servers) list.append(this.serverRow(sv));
    }
    sec.append(list);
  }

  private serverRow(sv: ServerInfo): HTMLElement {
    const row = el('div', 'mp-server');
    const full = sv.n >= sv.max;
    const mismatch = sv.v !== PROTOCOL_VERSION;
    row.innerHTML = `<div class="mp-server-info"><b>${escapeHtml(sv.name)}</b><span>Host ${escapeHtml(sv.host)} · Day ${sv.day} · ${sv.n}/${sv.max} players${mismatch ? ' · different game version' : ''}</span></div>`;
    const join = button(full ? 'Full' : 'Join', 'btn primary mp-join', () => {
      this.host.sfx();
      this.openForm(sv);
    });
    join.disabled = full || mismatch;
    row.append(join);
    return row;
  }

  /** Character creation: `server` null creates a new server, otherwise joins it. */
  openForm(server: ServerInfo | null): void {
    const saved = loadProfile();
    let avatar: Avatar = saved?.avatar ?? 'm';
    const o = this.overlay;
    o.innerHTML = '';
    const card = el('form', 'mp-card');
    card.noValidate = true;
    card.innerHTML = `
      <div class="death-kicker">${server ? 'Join a server' : 'New multiplayer world'}</div>
      <h2>${server ? escapeHtml(server.name) : 'Create a server'}</h2>
      <label class="mp-field">Your name<input name="name" maxlength="${NAME_MAX}" autocomplete="nickname" spellcheck="false" placeholder="Up to ${NAME_MAX} characters" value="${escapeHtml(saved?.name ?? '')}"></label>
      ${server ? '' : `<label class="mp-field">Server name<input name="server" maxlength="${SERVER_NAME_MAX}" spellcheck="false" placeholder="${escapeHtml(saved ? `${saved.name}'s camp` : 'Lakeside camp')}"></label>`}
      <div class="mp-field-label">Your character</div>
      <div class="mp-avatars"></div>
      <div class="mp-error" role="alert"></div>`;
    const pick = card.querySelector<HTMLElement>('.mp-avatars')!;
    const cards = AVATARS.map(({ kind, label }) => {
      const b = button(`<img alt="" src="${this.host.portrait(kind)}"><span>${label}</span>`, 'mp-avatar', () => {
        this.host.sfx();
        avatar = kind;
        cards.forEach((c, i) => toggle(c, 'on', AVATARS[i].kind === kind));
      });
      b.setAttribute('aria-label', `${label} character`);
      toggle(b, 'on', kind === avatar);
      pick.append(b);
      return b;
    });
    const nameIn = card.querySelector<HTMLInputElement>('input[name="name"]')!;
    const serverIn = card.querySelector<HTMLInputElement>('input[name="server"]');
    const err = card.querySelector<HTMLElement>('.mp-error')!;
    nameIn.addEventListener('input', () => {
      if (serverIn) serverIn.placeholder = cleanName(nameIn.value) ? `${cleanName(nameIn.value)}'s camp` : 'Lakeside camp';
    });
    const actions = el('div', 'mp-actions');
    const submit = el('button', 'btn primary big', server ? 'Join server' : 'Create server');
    submit.type = 'submit';
    actions.append(button('Back', 'btn subtle', () => {
      this.host.sfx();
      this.closeOverlay();
    }), submit);
    card.append(actions);
    card.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = cleanName(nameIn.value);
      if (!name) {
        setText(err, 'Pick a name so the others know who you are.');
        nameIn.focus();
        return;
      }
      const profile: Profile = { name, avatar };
      saveProfile(profile);
      this.host.sfx();
      if (server) this.host.onJoin(profile, server);
      else this.host.onCreate(profile, cleanText(serverIn?.value, SERVER_NAME_MAX) || `${name}'s camp`);
    });
    o.append(card);
    o.classList.add('show');
    setTimeout(() => nameIn.focus(), 30);
  }

  showBusy(text: string): void {
    const o = this.overlay;
    o.innerHTML = '';
    const card = el('div', 'mp-card mp-busy');
    card.innerHTML = `<div class="mp-spin big"></div><h2>${escapeHtml(text)}</h2>`;
    card.append(button('Cancel', 'btn subtle', () => {
      this.host.sfx();
      this.host.onCancel();
    }));
    o.append(card);
    o.classList.add('show');
  }

  showError(text: string): void {
    const o = this.overlay;
    o.innerHTML = '';
    const card = el('div', 'mp-card mp-busy');
    card.innerHTML = `<div class="death-kicker">Couldn't connect</div><h2>${escapeHtml(text)}</h2>`;
    card.append(button('Back to the menu', 'btn primary', () => {
      this.host.sfx();
      this.closeOverlay();
    }));
    o.append(card);
    o.classList.add('show');
  }

  closeOverlay(): void {
    this.overlay.classList.remove('show');
  }
}

export interface MpHudHost {
  onSend(text: string): void;
  onCloseChat(): void;
  onGetUp(): void;
}

const LINE_FADE = 12;
const LOG_KEEP = 60;

/** In-game multiplayer overlay: chat, who's here, the sleep wait and connection warnings. */
export class MpHud {
  readonly root = el('div', 'mp-hud');
  readonly input: HTMLInputElement;
  private readonly log = el('div', 'mp-log');
  private readonly chat = el('div', 'mp-chat');
  private readonly roster = el('div', 'mp-roster');
  private readonly sleep = el('div', 'mp-sleep');
  private readonly sleepText = el('div', 'mp-sleep-text');
  private readonly away = el('div', 'mp-away', 'Lost touch with the host… reconnecting');
  private readonly lines: { e: HTMLElement; t: number }[] = [];
  private readonly host: MpHudHost;
  private rosterKey = '';
  private clock = 0;
  chatting = false;

  constructor(parent: HTMLElement, host: MpHudHost) {
    this.host = host;
    this.input = el('input', 'mp-input');
    this.input.maxLength = 200;
    this.input.placeholder = 'Say something… (Enter to send, Esc to cancel)';
    this.input.spellcheck = false;
    this.input.setAttribute('aria-label', 'Chat message');
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.input.value;
        this.input.value = '';
        if (text.trim()) this.host.onSend(text);
        this.host.onCloseChat();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.input.value = '';
        this.host.onCloseChat();
      }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.input.addEventListener('blur', () => {
      if (this.chatting) this.host.onCloseChat();
    });
    this.chat.append(this.log, this.input);
    const inner = el('div', 'mp-sleep-inner');
    inner.append(el('div', 'mp-sleep-title', 'Sleeping'), this.sleepText, button('Get up <span class="key">Space</span>', 'btn', () => this.host.onGetUp()));
    this.sleep.append(inner);
    this.root.append(this.roster, this.away, this.chat, this.sleep);
    parent.append(this.root);
  }

  setVisible(v: boolean): void {
    toggle(this.root, 'visible', v);
  }

  addChat(name: string, text: string, me: boolean): void {
    this.push(`<b class="${me ? 'me' : ''}">${escapeHtml(name)}</b> ${escapeHtml(text)}`, '');
  }

  addSystem(text: string): void {
    this.push(escapeHtml(text), 'sys');
  }

  private push(html: string, cls: string): void {
    const e = el('div', `mp-line ${cls}`, html);
    this.log.append(e);
    this.lines.push({ e, t: this.clock });
    while (this.lines.length > LOG_KEEP) this.lines.shift()!.e.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  openChat(): void {
    this.chatting = true;
    toggle(this.chat, 'open', true);
    this.input.focus();
    this.log.scrollTop = this.log.scrollHeight;
  }

  closeChat(): void {
    this.chatting = false;
    toggle(this.chat, 'open', false);
    this.input.blur();
  }

  setHostAway(v: boolean): void {
    toggle(this.away, 'show', v);
  }

  update(dt: number, roster: RosterEntry[], sleeping: boolean): void {
    this.clock += dt;
    for (const l of this.lines) toggle(l.e, 'faded', this.clock - l.t > LINE_FADE);
    const key = roster.map((r) => `${r.pid}:${r.name}:${r.host}:${r.asleep}:${r.dead}`).join('|');
    if (key !== this.rosterKey) {
      this.rosterKey = key;
      this.roster.innerHTML = `<span class="mp-count">${roster.length}/${MAX_PLAYERS}</span>` + roster.map((r) =>
        `<span class="mp-who ${r.me ? 'me' : ''} ${r.dead ? 'dead' : r.asleep ? 'asleep' : ''}">${escapeHtml(r.name)}${r.host ? ' <i>host</i>' : ''}${r.dead ? ' <i>down</i>' : r.asleep ? ' <i>zzz</i>' : ''}</span>`).join('');
    }
    toggle(this.sleep, 'show', sleeping);
    if (sleeping) {
      const waiting = roster.filter((r) => !r.me && !r.asleep && !r.dead).map((r) => r.name);
      setText(this.sleepText, waiting.length
        ? `Waiting for ${listNames(waiting)} to sleep. The night passes once everyone is in bed.`
        : 'Everyone is asleep. The night is passing…');
    }
  }

  reset(): void {
    this.closeChat();
    this.lines.length = 0;
    this.log.innerHTML = '';
    this.rosterKey = '';
    this.setHostAway(false);
    toggle(this.sleep, 'show', false);
    this.setVisible(false);
  }
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
