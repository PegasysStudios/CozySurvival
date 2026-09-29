import { LOBBY_CHANNEL, PROTOCOL_VERSION, randomId, type SupabaseConfig } from './config';
import type { NetChannel, Transport } from './transport';

/** One live server as advertised in the lobby's presence list. */
export interface ServerInfo {
  sid: string;
  name: string;
  host: string;
  n: number;
  max: number;
  day: number;
  v: number;
}

export type BackendStatus =
  | { state: 'online'; message: string }
  | { state: 'outdated'; message: string }
  | { state: 'offline'; message: string };

/**
 * Reads the one-row `app_status` table (docs/multiplayer-setup.md, step 4). It proves the backend is reachable,
 * and the read counts as database activity so the free project isn't paused.
 */
export async function checkBackend(cfg: SupabaseConfig, fetchFn: typeof fetch = fetch): Promise<BackendStatus> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetchFn(`${cfg.url}/rest/v1/app_status?select=min_client_version,message&id=eq.1`, {
      headers: { apikey: cfg.key },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { state: 'offline', message: res.status === 401 ? 'The Supabase key was rejected.' : `The backend answered ${res.status}.` };
    const rows = (await res.json()) as { min_client_version?: number; message?: string }[];
    const row = rows[0];
    if (!row) return { state: 'offline', message: 'The app_status table is empty or unreadable.' };
    const message = String(row.message ?? '');
    if (Number(row.min_client_version ?? 1) > PROTOCOL_VERSION) return { state: 'outdated', message: message || 'This version of the game is too old for the server. Pull the latest code.' };
    return { state: 'online', message };
  } catch {
    return { state: 'offline', message: 'Could not reach the multiplayer backend.' };
  }
}

function toServer(meta: Record<string, unknown>): ServerInfo | null {
  const sid = meta.sid;
  if (typeof sid !== 'string' || !sid) return null;
  return {
    sid,
    name: String(meta.name ?? 'Camp').slice(0, 32),
    host: String(meta.host ?? '?').slice(0, 16),
    n: Number(meta.n) || 1,
    max: Number(meta.max) || 1,
    day: Number(meta.day) || 1,
    v: Number(meta.v) || 0,
  };
}

/** Watches the lobby for live servers (the menu's server list). */
export class LobbyWatcher {
  private readonly ch: NetChannel;

  constructor(transport: Transport, onList: (servers: ServerInfo[]) => void) {
    this.ch = transport.channel(LOBBY_CHANNEL, `watch-${randomId(8)}`);
    this.ch.onPresence((entries) => {
      const list = entries.map((e) => toServer(e.meta)).filter((s): s is ServerInfo => !!s);
      list.sort((a, b) => a.name.localeCompare(b.name));
      onList(list);
    });
  }

  start(): Promise<void> {
    return this.ch.subscribe();
  }

  close(): void {
    this.ch.close();
  }
}

/** A host's entry in the lobby. Updates are throttled to stay under Presence rate limits. */
export class LobbyAdvert {
  private readonly ch: NetChannel;
  private info: ServerInfo;
  private lastSent = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  static readonly MIN_INTERVAL_MS = 10_000;

  constructor(transport: Transport, info: ServerInfo) {
    this.info = info;
    this.ch = transport.channel(LOBBY_CHANNEL, info.sid);
  }

  async start(): Promise<void> {
    await this.ch.subscribe();
    await this.push();
  }

  update(patch: Partial<Pick<ServerInfo, 'n' | 'day'>>): void {
    const next = { ...this.info, ...patch };
    if (next.n === this.info.n && next.day === this.info.day) return;
    this.info = next;
    if (this.timer || this.closed) return;
    const wait = Math.max(0, this.lastSent + LobbyAdvert.MIN_INTERVAL_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.push();
    }, wait);
  }

  private async push(): Promise<void> {
    if (this.closed) return;
    this.lastSent = Date.now();
    await this.ch.track({ ...this.info });
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ch.close();
  }
}
