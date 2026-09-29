# Multiplayer backend setup (Supabase, free)

CozySurvival multiplayer uses **Supabase Realtime** for three things:

- **The server list.** A host announces their server, and it disappears on its own when they leave.
- **Player movement and the shared world.** Every player's movements and actions (gathering, chopping, crafting, building) go to the host, and the host sends the world state back out to everyone.
- **Text chat.**

The host's browser runs the shared world, including the clock, the animals, and the sleep vote. So there is no game server for you to deploy or pay for. On the Supabase side you only need a free project, one small SQL snippet, and two values in a `.env.local` file.

Steps 1–6 set up the backend; step 7 checks it end to end in the game.

---

## 1. Create a Supabase account

1. Go to [supabase.com](https://supabase.com) and click **Start your project**.
2. Sign in with GitHub (easiest) or email. No credit card is needed for the Free plan.

## 2. Create the project

1. On the dashboard, click **New project**. If it asks for an organization, create one on the **Free** plan.
2. Fill in:
   - **Name:** `cozysurvival`
   - **Database password:** click **Generate**, then save it in your password manager. The game never uses it, but you'll need it if you ever connect to the database directly.
   - **Region:** the one closest to you and your players (for example *Canada (Central)* or *West US*). Lower latency means smoother movement.
3. Click **Create new project** and wait about a minute for it to finish setting up.

## 3. Check the Realtime settings

1. In the left sidebar, open **Realtime**, then **Settings**.
2. Make sure both of these are **on**. They are on by default.
   - **Enable Realtime service**
   - **Allow public access to channels**
3. Leave everything else at its default. Saving changes on this screen disconnects everyone who is connected, which is fine during setup.

## 4. Paste the SQL

Multiplayer itself needs **no tables**: the server list, movement, and chat all run over Realtime. This one tiny read-only table lets the game check that the backend is reachable. It also keeps the free project from being paused while people are playing (see "Free-tier limits").

1. In the left sidebar, open **SQL Editor**, then click **New query**.
2. Paste this and click **Run**:

```sql
-- One-row status table the game reads when the main menu opens.
create table if not exists public.app_status (
  id int primary key default 1 check (id = 1),
  min_client_version int not null default 1,
  message text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.app_status (id) values (1) on conflict (id) do nothing;

alter table public.app_status enable row level security;

drop policy if exists "Anyone can read app status" on public.app_status;
create policy "Anyone can read app status"
  on public.app_status for select
  to anon, authenticated
  using (true);

grant select on public.app_status to anon, authenticated;
```

3. You should see **Success. No rows returned**. Then open **Table Editor**: `app_status` should be there with one row, `id = 1`.

Players can only *read* this table. Nobody can change it from the game. You can edit `message` in the Table Editor later, for example to announce a new version.

## 5. Copy your keys

You need exactly two values.

1. Click **Connect** at the top of the project page, or open **Settings**, then **API Keys**.
2. Copy:
   - **Project URL**, which looks like `https://abcdefghijkl.supabase.co`
   - **Publishable key**, which starts with `sb_publishable_`

   If you only see a long key starting with `eyJ` (the legacy "anon" key), create a publishable key under **Settings → API Keys**. Supabase is retiring the legacy keys by the end of 2026.
3. **Never** copy the **secret** key (`sb_secret_…`) or the `service_role` key into the game. Those bypass all security. The game never needs them.

**About the publishable key being "public":** it ends up inside the game's JavaScript, where anyone can read it. That is by design. It only grants what your security rules allow: reading `app_status` and joining game channels. The worst someone could do with it is join a game or send chat messages. See "Later: lock it down" at the end.

## 6. Put the keys in `.env.local`

1. In the CozySurvival repo folder (next to `package.json`), create a file named `.env.local`:

```bash
VITE_SUPABASE_URL=https://abcdefghijkl.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxx
```

2. Save it, then **restart** the dev server (`Ctrl+C`, then `npm run dev`). Vite only reads env files at startup.
3. `.env.local` is already gitignored (the `*.local` rule in `.gitignore`), so it won't be committed.
4. If you host the game somewhere (Netlify, Vercel, GitHub Pages, and so on), add the same two variables in that host's **build** environment settings. Vite bakes them in at build time.

If these variables are missing, the game still runs. Multiplayer is just greyed out on the main menu with a "not set up" note.

## 7. Check that it works

**Right now, from a terminal.** Replace the two values with yours:

```bash
curl "https://abcdefghijkl.supabase.co/rest/v1/app_status?select=*" \
  -H "apikey: sb_publishable_xxxxxxxxxxxxxxxxxxxx"
```

You should get back something like `[{"id":1,"min_client_version":1,"message":"",...}]`.

- `[]` (an empty list) means the policy didn't apply. Re-run step 4.
- A `401` error means the key is wrong. Re-copy it from step 5.

**In the game:**

1. Run `npm run dev` and open the game. On the main menu, the Multiplayer section should say **Online**.
2. Open a second window in private or incognito mode (so it counts as a different player) at the same address.
3. In window A, click **Create multiplayer server**, then pick a name and avatar. Within a few seconds the server should appear in window B's server list.
4. In window B, click **Join**, then pick a name and avatar. Each player should see the other move, and chat (press **Enter**) should show up on both sides.
5. Test the shared world. Pick berries or chop a tree in window A: it should disappear or fall in window B too. Then close window B, change something in A, and rejoin from B. B should arrive to the world as it is now.
6. Optional: in the Supabase dashboard, **Realtime → Inspector** shows the live channels and messages.
7. Optional: **Organization → Usage → Realtime Messages** shows how much of the monthly message allowance you've used.

## Free-tier limits that matter

| Limit (Free plan) | Value | What it means for CozySurvival |
|---|---|---|
| Realtime messages per month | **2 million** | This is the main budget. A message counts once when sent and once more for each player who receives it. See the playtime estimate below. |
| Realtime messages per second | **100** (whole project, averaged over one minute) | Enough for about two full 4-player servers at once. Servers are capped at 4 players. Going over briefly kicks channels, and the game reconnects automatically. |
| Egress (data sent out) | **5 GB** per month | Realtime traffic counts toward this. It's about 50 MB per hour with 4 players, so the message allowance runs out first. |
| Concurrent connections | **200** | Each open game tab is one connection. Not a concern. |
| Presence (online-list) updates | 20/sec per project, 5 per player per 30 sec | The game updates the server list slowly (player counts every ~10 s) to stay under this. |
| Broadcast message size | 256 KB | A player joining mid-game gets the current world in one message. That's 3–80 KB depending on how much has changed, so this is fine. |
| Public Realtime connection length | 24 hours max | The game reconnects automatically. |
| Active free projects | 2 per account | Use one for CozySurvival. |
| **Inactivity pause** | After **7 days** without database activity | See below. |

**Playtime estimate on 2 million messages a month.** Each player sends their movement to the host 4 times a second while moving. The host sends one combined update to everyone 4 times a second, covering players, animals, the clock, and world changes. Gathering, chopping, and building add only about 10%. These are worst-case numbers with everyone moving the whole time. Real play usually does better, because standing still, crafting, and menus send little.

| Players on a server | Worst-case messages/hour | ≈ Hours of play per month |
|---|---|---|
| 2 | ~63,000 | ~32 |
| 4 | ~158,000 | ~13 |
| 6 | ~253,000 | ~8 |
| 8 (max) | ~348,000 | ~6 |

If you go over on the Free plan, Supabase emails you and gives a grace period under its Fair Use Policy. The Free plan never charges you. If multiplayer becomes popular, Pro ($25/month) raises the allowance to 5 million messages and 500 per second.

**Project pausing.** Supabase pauses free projects that get too few *database* queries over 7 days. Realtime traffic alone may not count. That is why the game reads `app_status` each time the main menu opens: normal play keeps the project awake. If nobody plays for a week:

- Supabase emails you a warning about a week before pausing. Opening the project dashboard also counts as activity.
- If it does pause, the game's menu will say multiplayer is **offline**. In the dashboard, open the project and click **Resume project**. Nothing is lost, because this setup stores no game data, and you have up to a year to resume.
- Optional keep-alive: add a free daily GitHub Actions job to the repo that runs the `curl` command from step 7. One request a day is enough.

## Troubleshooting

- **Multiplayer greyed out ("not set up").** `.env.local` is missing, misnamed, or the dev server wasn't restarted. Variable names must start with `VITE_`.
- **"Offline" on the menu.** The project is paused (resume it), the URL has a typo, or the network blocks WebSockets.
- **The server list is empty in window B.** Both windows must use the same `.env.local`, meaning the same project. Check that **Allow public access to channels** is on (step 3).
- **Players move jerkily.** Pick a project region closer to the players. A little smoothing delay is normal.
- **The world freezes or shows "Host is away".** The host's tab is minimized, their laptop went to sleep, or they closed the game. The world lives in the host's browser, so the host should keep the game open.
- **Everyone got disconnected at once.** You probably hit the 100 messages/second cap, for example two full servers at the same time. The game rejoins by itself.

## Later: lock it down (not needed for the demo)

Right now anyone who has the game's URL and key can join channels. That's fine for a demo with friends. Before a public release, switch on Supabase **Anonymous Sign-ins** and **Realtime Authorization** (private channels with policies on `realtime.messages`), then turn off **Allow public access to channels**. That will come with a code change, so don't flip that setting on its own. If you do, multiplayer stops working.
