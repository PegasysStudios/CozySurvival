import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from './config';
import type { NetChannel, PresenceEntry, Transport } from './transport';

/** Supabase Realtime transport. supabase-js is loaded on demand so single-player never downloads it. */
export async function createSupabaseTransport(cfg: SupabaseConfig): Promise<Transport> {
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // The heartbeat runs in a worker so a background host tab isn't dropped by timer throttling.
    realtime: { worker: true, params: { eventsPerSecond: 40 } },
  });
  return new SupabaseTransport(client);
}

class SupabaseTransport implements Transport {
  readonly kind = 'supabase';
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  channel(name: string, presenceKey: string): NetChannel {
    return new SupabaseChannel(this.client, name, presenceKey);
  }

  close(): void {
    void this.client.removeAllChannels();
  }
}

class SupabaseChannel implements NetChannel {
  private readonly ch: RealtimeChannel;
  private readonly presenceCbs: ((e: PresenceEntry[]) => void)[] = [];
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient, name: string, key: string) {
    this.client = client;
    this.ch = client.channel(name, { config: { broadcast: { self: false, ack: false }, presence: { key } } });
    this.ch.on('presence', { event: 'sync' }, () => {
      const state = this.ch.presenceState() as Record<string, Record<string, unknown>[]>;
      const entries = Object.entries(state).map(([k, metas]) => ({ key: k, meta: metas[0] ?? {} }));
      for (const cb of this.presenceCbs) cb(entries);
    });
  }

  on(event: string, cb: (payload: unknown) => void): void {
    this.ch.on('broadcast', { event }, (msg: { payload?: unknown }) => cb(msg.payload));
  }

  onPresence(cb: (entries: PresenceEntry[]) => void): void {
    this.presenceCbs.push(cb);
  }

  subscribe(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.ch.subscribe((status, err) => {
        if (settled) return;
        if (status === 'SUBSCRIBED') {
          settled = true;
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          settled = true;
          reject(err ?? new Error(`Realtime channel ${status.toLowerCase()}`));
        }
      });
    });
  }

  send(event: string, payload: unknown): void {
    void this.ch.send({ type: 'broadcast', event, payload });
  }

  async track(meta: Record<string, unknown>): Promise<void> {
    await this.ch.track(meta);
  }

  close(): void {
    void this.client.removeChannel(this.ch);
  }
}
