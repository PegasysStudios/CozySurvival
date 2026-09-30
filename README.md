# CozySurvival

A first-person, low-poly cozy survival game for the browser, set in a Pacific Northwest / Canadian forest. You wake up stranded by a lake with nothing but your hands. Gather, craft, cook, hunt, build a camp and see how many days you can last. One in-game day lasts 24 real minutes.

Built with Vite, TypeScript and Three.js. Models, terrain, sky and sound effects are generated procedurally. The only bundled asset is the background music track (`public/audio/forest-ambience.mp3`).

## Run it locally

Requires Node 20+ (developed on Node 22).

```bash
npm install
npm run dev          # http://localhost:5287
```

Click **Start surviving**, then click into the game to capture the mouse. **Esc** closes whatever menu is open; with no menu open, it releases the mouse and pauses.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload on port **5287** (dev tools enabled) |
| `npm run build` | Typecheck (`tsc`) and production build to `dist/` |
| `npm run preview` | Serve the production build on port **5288** |
| `npm test` | Vitest suite for the simulation (no browser or WebGL needed) |
| `npm run typecheck` | TypeScript only |
| `npm run smoke` | Build, boot the game in headless Chrome, then play through it with real input: walk, craft, place a campfire (red/green ghost, rotate, click), open its campfire menu and close it with Esc, reload and Continue, and use all three death-screen options. Then play a two-tab multiplayer session over `?net=local`. Fails on any console error |

`npm run smoke` needs a local Chrome or Chromium. It checks the usual install paths; set `CHROME_PATH` to point at another one.

## Controls

| Action | Input |
| --- | --- |
| Move | W A S D |
| Run | Shift (drains energy faster) |
| Jump | Space (also climbs onto boulders and fallen trunks) |
| Swim | W A S D in deep water (no running or jumping while swimming) |
| Look | Mouse |
| Gather, use tool, interact (fires, benches, shelters, carcasses) | Left-click (hold to repeat) |
| Campfire menu (fuel meter, add a stick or log, cook) | Left-click a lit campfire (an unlit one takes fuel straight away) |
| Draw and release the bow | Hold and release left-click |
| Fish (fishing pole) | Hold left-click to wind up, release to cast, click when the float dips |
| Select tool | 1–6 or mouse wheel |
| Crafting | C |
| Pack (inventory) | Tab |
| Quick eat or drink whatever you need most | F |
| Rotate placement ghost | R (Shift+R the other way) or mouse wheel |
| Cancel placement | Right-click or Q |
| Mute / unmute all sound (your volume settings are kept) | M |
| Close the open menu (pack, crafting, campfire, dev panel) | Esc |
| Pause when no menu is open, settings (master, music and effects volume, mouse sensitivity, invert Y) | Esc |

## What's in the demo

- **Day cycle.** A 24-minute day (one real minute per game hour) with sunrise, golden hour, dusk and a moonlit night: sky dome, stars, drifting clouds, fog and light colour all follow the clock. Sleeping in a shelter or beside a campfire after 19:00 skips to dawn and fully restores energy.
- **Needs.** Health, hunger, thirst, warmth and energy. Empty hunger, thirst or warmth wears health down, and health at zero ends the run.
- **Cold.** Night pulls warmth toward zero; fires, shelters and a torch hold it up.
  - Cold can't kill you during the first two nights: freezing still hurts, but stops at 1 health. From night 3 on it can be lethal. Hunger and thirst can still kill at any time.
  - Within range of a burning campfire (5.5 m) the cold never lowers your warmth, even at the edge of the firelight or while wading.
  - Sleeping through the night with no burning campfire in range costs 30 of your 100 warmth (`sleep.coldWarmthCost` in `balance.ts`). Beside a burning fire you wake at least as warm as you lay down, and a shelter can still warm you up. Energy is a real resource: walking drains a little (0.1/s), running drains 0.8/s (about two minutes from full), and every task and tool action costs energy: swinging an axe, spear or torch or loosing an arrow 1, gathering 0.5, casting a line 1.2, striking a fish 0.4, crafting 3, building 6, swimming 0.2/s. Standing still or sitting on a bench restores it, food and drink speed up recovery, and sleep refills it.
- **Skills.** Gathering, hunting, cooking, crafting and fishing each rise from level 1 to 10 as you do them. You can see levels, progress and current effects in the Pack panel (Tab). The effects are gentle:
  - gathering: a growing chance of a bonus find (up to 40%), and up to +0.5 chop power with the axe
  - hunting: up to 40% more damage to animals and a chance of extra meat when you butcher
  - cooking: a novice sometimes chars a meal (20% at level 1, never at level 10). The first time you cook a dish it always comes out right, drinks never burn, and a Charred Meal is still edible.
  - crafting: tools and shelters you make last longer (up to 4×)
  - fishing: the chance to land a hooked fish, from 35% at level 1 (a few tries per fish) to 70% at level 10 (90% with a fully upgraded pole)
  - Tool skills and tool upgrades add their bonuses on the same base, so neither alone reaches the top: see **Tool and weapon upgrades** below.
- **Durability.** Crafted tools, shelters and benches wear out.
  - Tools lose a point per use and a little over time, and a lit torch burns down while you hold it. The HUD shows a bar under each tool, and the bow's slot shows how many arrows you carry (red at zero).
  - Shelters weather slowly and wear a little each night you sleep in them. Benches wear a little each time you sit.
  - You get a warning at 25%. At zero the item breaks: a tool is gone, a structure falls apart. Craft or build a new one.
  - Campfires, gear (basket, backpack, canteen) and bare hands don't wear.
- **Gradual progression.** Day 1 starts with bare hands and a 6-slot pack, a short walk from a lake (new worlds put you within about 14 m of the shore, facing it). Every recipe and upgrade is visible from the start, greyed out until your pack holds the materials. A 9-step onboarding track leads through the basics, and the tracker lists each step's ingredients and goals in a column with have/need counts:
  1. Drink from the lake.
  2. Build a campfire.
  3. Forage food (3 berries, onions or chanterelles).
  4. Cook a skewer: the Forager's Skewer (2 salmonberries, a wild onion and a stick) or the Mushroom Skewer.
  5. Add firewood to the fire (twice).
  6. Craft a Stone Axe and chop a tree for a log.
  7. Craft a Fishing Pole, catch a trout and cook it.
  8. Craft a spear and hunt a hare with it. The task warns that spear hunting is hard.
  9. Craft a bow and arrows and make a kill with the bow. That completes onboarding; the goal becomes surviving and upgrading.

  Beyond the track:
  - tools: axe, spear, bow and arrows, torch, fishing pole
  - water: drink by hand, fill a canteen, boil it at a fire
  - multi-ingredient meals: Forager's Skewer, Forest Stew, Mushroom Skewer, Salmonberry Tea, Bark-Baked Trout, Trout Chowder, Trout & Berry Skewer, Smoked Trout
  - gear, tools, structures and cordage cost about 5× what they did in round 3 (a workbench is 10 logs). Arrows, fuel and food recipes are unchanged. The comment above `RECIPES` in `src/data/recipes.ts` lists the few recipes kept below 5× and why.
  - carry upgrades: Grass Basket, Hide Backpack
- **Forage is sparse, so the track spans several days.**
  - Fallen branches and loose stones give one stick or stone per harvest (three per pile), down from two.
  - The starter patch around the spawn has 2 stick piles, 2 stone piles, 2 ferns, 2 berry bushes, 1 chanterelle patch and 1 onion: enough for the first steps (gathering, fiber, the Stone Axe) and most of a campfire.
  - Across the map, 40% of the spots that used to grow sticks, stones or ferns still do, and 50% of the berry, mushroom and onion spots. That's about 260 forage spots per world instead of about 560. Trees, boulders and fallen logs are unchanged.
  - Near the spawn this leaves about a fifth of the old sticks and stones. Averaged over 8 worlds, a 25 m radius holds about 11 sticks, 9 stones and 13 fiber, down from 49, 44 and 28. The whole track needs about 14 sticks, 8 stones and 16 fiber, plus firewood. So after day 1 you range further out and wait on regrowth (sticks 12 h, ferns 16 h, stones 30 h).
- **Campfire menu.** Clicking a lit campfire opens its own menu instead of the full crafting menu. It has a fuel meter (hours left out of 16), separate buttons to add a stick (+1.5 h) or a log (+4 h), **Sleep by the fire** (from 7 PM), and only the recipes you cook over a fire. **C** still opens the full crafting menu. Sleeping by the fire uses the normal sleep cycle and cold rules: a burning fire keeps your warmth, an out fire means a cold night, and there's no shelter bonus.
- **Shelters and their menu.** Clicking a shelter opens its own menu with **Sleep** and **Upgrade**. The lean-to is the only shelter you build from the crafting menu; each later tier is built only by upgrading the one before, in place, with all its materials in your pack at once:

  | Tier | Built by | Materials | Warmth / healing |
  |---|---|---|---|
  | 1. Lean-to | crafting menu | 12 logs, 12 sticks, 16 fiber, 5 cordage | +35 / +0 |
  | 2. A-Frame Shelter | upgrading a lean-to | 16 logs, 24 sticks, 12 cordage, 10 birch bark (9 slots: needs a basket) | +40 / +4 |
  | 3. Bark Hut | upgrading an A-frame | 24 logs, 40 birch bark, 20 cordage, 20 stones (14 slots: needs a backpack) | +45 / +7 |
  | 4. Hide Tent | upgrading a bark hut | 18 hides, 24 logs, 30 cordage, 20 birch bark (14 slots: needs a backpack) | +50 / +10 |

  An upgrade gives the shelter fresh condition. A bigger tier needs room, so step out of its footprint and clear anything in the way; the menu says what's blocking it and whether your pack can carry the materials.
- **Tool and weapon upgrades.** Every tool and weapon (axe, spear, bow, torch, fishing pole) has three upgrade levels, each much costlier than the last, and level III always needs hides. Click a tool on the tool belt in the Pack (Tab), or open the **Upgrades** tab in Crafting (C), to see its current stats, what the next level does and its materials. Upgrades are kept when a worn-out tool is re-crafted. Bonuses add to the matching skill's bonus on the same base:
  - axe: chop power per swing = 1 + Gathering (up to +0.5) + axe (+0.2 / +0.4 / +0.6). A 6-hit fir takes 6 swings at the start, 4 at Gathering level 5 with a level II axe, and 3 with both maxed.
  - spear and bow: damage × (1 + Hunting (up to +0.4) + weapon (+0.15 / +0.3 / +0.45)), so up to ×1.85. Bow upgrades also shoot faster, flatter arrows (up to +25% speed), which is how they improve accuracy.
  - fishing pole: landing chance = 35% + Fishing (up to +35%) + pole (+7 / +14 / +20%), capped at 95%.
  - torch: no skill. Upgrades cut its burn rate (by 20 / 40 / 60%) and add warmth while held (+3 / +6 / +9).
- **Foraging guide.** The Pack (Tab) has a **Foraging** tab: a numbered guide of every harvestable plant (salmonberry, sword fern, chanterelle, nodding onion, paper birch). Each page unlocks the first time you harvest that plant and shows its effects and hunger when eaten, the recipes that use it, where it grows, how fast it regrows, and field notes. Locked pages hint at where to look. Unlocks are saved with your run.
- **Wildlife.**
  - Rabbits, deer and fish each have their own fear radius and flee behaviour. Deer spook from far away, so a bow helps.
  - Predators are rare early. Day 1 has a single distant grey wolf, black bears appear from day 2, and numbers grow slowly after that. Wolves spot you from farther away at night.
  - Predators stalk and attack, but keep away from lit fires, and a raised torch holds them off.
- **Fishing.** Craft a Fishing Pole (10 sticks, 5 stones, 5 cordage) once you have made cordage and found the water. Stand at a lake or pond, hold left-click to wind up (longer throws further, 3 to 14 m), release to cast, and wait for a bite (2.5 to 7 s). Click within 0.9 s of the float dipping to strike; your fishing skill decides whether the trout is landed or slips the hook. Clicking early reels in, and switching tools, swimming or walking off reels the line in too.
- **Stripped birches.** Peeling all the bark off a paper birch leaves the lower half of its trunk bare wood until the bark grows back a day later. The look follows the saved bark state, so it survives reloads and syncs in multiplayer.
- **Trees.** Felling a tree takes two steps.
  - Chop it down with the axe. It topples with a thud and the whole trunk lies on the ground, leaving a stump.
  - Keep chopping the fallen trunk to cut it into logs, two hits per log, working in from the stump end. The last log also gives the branches as sticks.
  - A fallen trunk is solid: you can hop onto it, and it blocks building until you've cut it up.
- **Boulders.** Rocks have proper collision. Low ones can be jumped onto and stood on, and you walk off the other side. Rocks taller than a jump stay walls, and you slide off their steep sides.
- **Swimming.** Wade through the shallows, then swim once the water is deep: you float with your head above the surface, move at a gentle pace, and walk out when your feet touch the bottom. There's a splash when you jump in. Swimming drains a little energy but there is no drowning. Deep water counts as wading for warmth, exactly as before.
- **Placement.** Structures from the crafting menu go down as a green or red ghost with rotation. Placement is blocked when the spot:
  - overlaps trees, stumps, felled trunks, boulders, fallen logs, plants, other structures, water, or the player
  - is too steep, or is out of reach

  Ingredients are only spent when placement succeeds.
- **Death and records.** The death screen shows the cause, time survived, day reached and best record, and offers three options:
  - **Retry the day:** reload the dawn snapshot.
  - **Restart from day 1:** same world, best record kept.
  - **Start from scratch:** new world, all saves and records wiped.
- **Saves.** Autosave to `localStorage` every 30 s and on key events (crafting, building, sleeping, dawn). **Continue** on the title screen resumes the run.
- **Cozy polish.**
  - Flat-shaded models with wind sway, soft shadows, and a lake with shoreline foam.
  - Particles: wood chips, leaves, dust, splashes, embers and fireflies.
  - First-person hands and tools with swing, chop, draw and bob animation.
  - Ambience: Jon's recorded lake loop (`public/audio/lake-water-moving.mp3`) near lakes and ponds, quiet even at the water's edge and fading out 36 m from the shore, plus procedural wind, fire crackle, birds by day, and crickets and owls at night. Sound effects for every action.
  - Background music: a looping forest-ambience track that fades in gently after your first click (browsers block audio before that).
  - Gentle HUD toasts, banners and tooltips.
- **Volume.** The pause menu (Esc) has three sliders, saved in `localStorage` with your other settings:
  - **Master** (default 50%) scales every sound, music included.
  - **Music** (default 10%) is the background track only. At 100% it plays at its original mix level.
  - **Effects** (default 100%) covers every other sound: effects and ambience, including the lake loop.

  **M** mutes and unmutes everything without changing the sliders.

## Multiplayer

Up to 4 players share one world over Supabase Realtime. The host's browser runs the world, including the clock, the animals and the sleep vote, so there's no game server to deploy.

- **Set up.** Copy `.env.example` to `.env.local`, fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, and restart `npm run dev`. [docs/multiplayer-setup.md](docs/multiplayer-setup.md) walks through the free Supabase project and its one SQL snippet. Without these variables the game is single-player only: the Multiplayer block on the title screen is greyed out with a "not set up" note, and the Supabase library is never downloaded.
- **Try it without Supabase.** Open `http://localhost:5287/?net=local` in two tabs of the same browser. The tabs talk over a BroadcastChannel ("Local test mode").
- **Play.**
  - **Create multiplayer server** starts a brand-new world. Other players see it in the server list and click **Join**. Everyone picks a name and a male or female character.
  - Your pack, needs and skills are your own. Trees, forage, structures, fires, dropped items and animals are shared.
  - **Enter** opens chat, and messages show as bubbles over heads. **G** waves. **Esc** only opens settings, because the world keeps running.
  - The host's clock sets the time of day. Sleeping in a shelter or beside a campfire lies you down until everyone is in bed, then the night skips. **Space** gets you up.
  - Shelter upgrades are shared: anyone can upgrade any shelter and everyone sees the new tier. Tool upgrades and the Foraging guide are your own.
  - Dying drops your whole pack as a pile anyone can loot, you included. You respawn with an empty pack and fresh needs, skills, tool upgrades and Foraging guide.
  - Multiplayer worlds aren't saved. When the host leaves, the server closes for everyone. Your single-player run is kept as it was.

## Dev tools

Available on the dev server, or on any build with `?dev=1` in the URL.

- **`` ` `` (backquote)** opens the dev panel. From it you can:
  - set the time scale
  - jump to a time of day
  - give item kits
  - unlock all tools and gear
  - spawn a wolf, bear, deer or rabbit nearby
  - refill needs, take damage, or die
  - show an FPS counter
- **T** cycles the time scale through 1×, 10×, 60× and 240×. At 60× a full day takes 24 seconds. A `DEV ×N` badge on the clock shows when time is sped up.

## How the code is organised

```
src/
  core/    math, seeded RNG, noise, 2D geometry, spatial grid
  data/    tuning (balance.ts), items, recipes, prefabs, species, resources, objectives
  sim/     WebGL-free game simulation: terrain, world gen, movement physics, needs,
           inventory, crafting, placement, animals, day cycle, saves, run manager
  render/  Three.js views: terrain, water, sky, instanced nature, creatures,
           structures, placement ghost, particles, first-person view model
  audio/   procedural Web Audio ambience and sound effects, music, volume mixing
  net/     multiplayer: transport interface (Supabase Realtime, in-memory, BroadcastChannel),
           lobby, wire protocol, world sync, host and guest sessions
  ui/      HTML/CSS HUD, crafting, campfire and pack panels, title/pause/death screens,
           multiplayer menu and chat, dev panel
  game/    input, Esc/menu routing, and the Game class that wires sim, view, audio, UI and saves together
tests/     Vitest suite for sim/, core/ and the DOM-free parts of ui/, game/ and audio/
scripts/   headless smoke check
```

The simulation (`src/sim`) never touches the DOM or WebGL:

- It advances with `sim.step(dt, input)`.
- Rendering, audio and UI read its state and consume the events it emits (`gathered`, `chop`, `placed`, `hurt`, `slept`, …).
- The same code runs in Node for the tests.

Tuning lives in `src/data/balance.ts`.

Rendering is built for 60 fps:

- Instanced, chunked geometry with per-chunk frustum and distance culling.
- Low-detail tree models far away.
- Fog-limited draw distance.
- A player-following shadow map.
- Pooled lights and particles, with no per-frame allocations in the hot paths.

## Testing

`npm test` runs 380 tests covering:

- inventory stacking and carry limits
- crafting, every recipe available from the start, and ingredients consumed only on success
- round 6 menus: every recipe and upgrade shown with the right greyed state, the tile tooltip, the icon mapping and fallback, the tracker rows for each onboarding step, and the fern share
- round 4 costs: the 5× rule against the round 3 table, the listed exceptions, unchanged arrows, fuel and food, and every recipe fitting a 6-slot pack
- round 5 shelters: the tier order, upgrading in place with every material, refusals for missing materials, a blocked spot or the top tier, collider swaps, better sleep per tier, and old saves keeping their shelters
- round 5 tool upgrades: owning the tool, materials and the level cap, steep costs, persistence, and skill and upgrade bonuses adding up (chop swings, spear damage, landing chance, torch burn and warmth)
- campfire sleep: the menu option, the normal sleep cycle, warmth by a burning or dead fire, and the usual refusals
- the 9-step onboarding track walked with real actions, out-of-order progress, spear-only hare kills, old-save migration, and the lake-near spawn across 10 worlds
- the Foraging guide: first-harvest unlocks, page contents, save/load and old-save unlocks
- fishing: the pole recipe, wind-up and cast distance, dry-ground and swimming refusals, bites, the strike window, reeling in, catch rates by skill, and the fish meals
- placement validity against trees, rocks, felled trunks, structures, water, slope and reach, plus rotation
- needs, energy drain for movement, swimming, tasks and every tool action, regen and sleep restore
- stripped birches: the bare-trunk state, its survival through save and load, and regrowth
- day-cycle timing (24-minute days) at 1× and scaled time
- skills: levels, XP from each activity, gathering bonuses, hunting damage and extra meat, burn chance, beginner's luck
- durability: skill-scaled tools and structures, wear per use and over time, torch burn, low warnings, breaking and re-crafting
- two-step trees: trunk collider and targeting, logs cut from the stump end, full-pack drops, save/load mid-trunk
- boulders and trunks you can stand on, rocks too tall to climb, swimming in and out of deep water, splashes
- master volume, mute and music fade-in math, plus settings persistence and migration
- the lake loop's proximity volume, its Effects-bus routing and the shipped track
- separate music and effects volume, the 10% music default, and migration of older audio settings
- Esc priority: an open menu closes without pausing, and Esc pauses only with no menu open
- the bow's arrow count in the hotbar
- the campfire menu: fuel meter, adding a stick or log, campfire-only recipes, cooking
- sparser forage and one stick/stone per harvest, with trees, rocks and logs unchanged and older saves still loading
- the cold rules: no cold deaths on nights 1–2, no warmth loss by a burning fire, and the warmth cost of sleeping without one
- death and all three restart options, including the retry-day snapshot
- save and load round-trips, migration of version-1 saves, and corrupted saves
- animal fear, flee and predator state machines
- movement and collision physics
- multiplayer, with 2–5 simulated players on an in-memory transport:
  - the server list, joining, and the 4-player cap
  - the late-join world snapshot
  - shared gathering, chopping and building, co-op chopping, and hunting with kill credit
  - chat, its rate limit and history
  - the sleep vote, including sleeping beside a campfire
  - death loot and respawn
  - shelter upgrades syncing guest to host to guests and host to guests, and simultaneous upgrades settling on one tier
  - tool upgrades and the Foraging guide staying personal, and guest spear kills counting for onboarding
  - a guest leaving, and the host closing the server

`npm run smoke` boots the real build in headless Chrome as an end-to-end check of placement, the campfire menu and Esc, save/reload, and the death screen. It also checks that multiplayer shows as "not set up" without env vars. Then two tabs on `?net=local` play together: the host creates a server through the menu, and the guest joins from the list. They see each other, chat, and a guest's gathering reaches the host. Finally the host closes the server.

## Menus and icons (round 6)

- **Grid menus.** Crafting, the campfire, Upgrades and the Pack (tool belt, gear, Foraging guide) are square icon tiles like the pack slots. Hovering a tile fades in its name; selecting one shows its materials and the Craft, Cook or Upgrade button. Greyed tiles need more materials.
- **Upgrade-only tiers.** The A-frame, bark hut and hide tent appear in the Build and Upgrades tabs with how to reach them (upgrade the tier below in place). Every tool's three upgrade levels are listed with their costs, even before the tool is made.
- **Jon's icons.** Hand-made 64×64 PNGs live in `public/icons/jon/`. `src/data/icons.ts` holds the only mapping from item id and tier to file (tool tier = upgrade level + 1); anything unmapped keeps its built-in SVG. The first upload lost its filenames, so the mapping is a best guess until named files arrive.
- **Ferns.** Sword ferns grow on 48% of their map-wide spots (was 40%), so fiber is a little easier to find.

## Known gaps

- Desktop only: it needs a mouse and keyboard with pointer lock. The layout adapts to small screens, but there are no touch controls yet.
- Visual and feel tuning (movement, lighting, animal behaviour) has only been checked through automated tests and a headless boot, not a hands-on playtest.
- There is one world size (320 m square, with a lake and a pond), and no weather yet.
- Hunger, thirst, fire fuel and resource regrowth are still tuned per game hour, so with 24-minute days they tick 2.5× faster in real time than before. Cold and warmth are unchanged per game hour.
- Trunk and boulder surfaces approximate the rendered meshes (a flat-topped slab and a half-ellipsoid dome).
- Predators don't follow you into the water.
- Saves from before this update carry over. Skills start at level 1, tools get fresh durability on first use, and existing shelters and benches start at full condition. A tree felled in an old save leaves just a stump, because its logs were already collected. The old volume setting resets to the new 50% default.
- Saves from before the forage change load into the sparser world. Forage now grows on a subset of the old spots, so nothing appears under structures you've built, and plants that no longer grow are simply gone.
- Audio settings saved before the Music slider existed keep their master volume, and pick up music at 10% and effects at 100%.
- Multi-day pacing is an estimate from forage supply against the goal track's needs, not a playtest. A player who knows where to look can still move faster. To slow it further, lower the `scatter` shares in `src/data/resources.ts`.
- Headless Chrome fakes pointer lock, so the smoke check can't reproduce the browser's own Esc lock release. That case is covered by unit tests only.
- With the pointer captured, the browser usually handles the Esc press itself, so pausing comes from the lock release. If the browser refuses to re-capture the pointer after a menu closes, the click-to-continue overlay appears instead.
- While muted, the music keeps playing silently, so unmuting picks it back up mid-track.
- Multiplayer has only run over the in-memory and BroadcastChannel transports here. The Supabase transport is written against the setup guide but hasn't been played live.
- Multiplayer trusts every client: the host doesn't check a guest's reach or placement. If two players take the last item at the same moment, both may get it, though the world's count stays right.
- Round 4 pacing (5× costs against sparse forage, faster energy drain) and the fishing timings are tuned from the numbers only, not a playtest.
- Round 5 upgrade costs and day estimates are from the numbers only. The campfire (25 stones, 20 sticks, 5 fiber) is now the second onboarding step and is likely the slowest part of day 1.
- Upgrades must be carried in one go: there's no way to deliver materials to a shelter in batches, so the bark hut and hide tent need a Hide Backpack's room.
- The bench still sits you down on click; only shelters have a structure menu.
- If two players upgrade the same shelter at the same moment, both spend their materials and it only goes up one tier.
- Bow upgrades improve accuracy through faster, flatter arrows; there's no aim spread to tighten.
- Saves from before round 5 load with every tool at level 0, lean-tos and hide tents as the first and last tiers, the Foraging guide unlocked for every plant already harvested, and onboarding replayed against the new track (a finished old track stays finished).
- Saves from before round 6 load as before; the list of learned recipes they carry is simply dropped, since every recipe is available now.
- A birch only shows bare wood once all its bark is peeled; with one of its two strips left it still looks whole.
- Other players see your fishing pole but not your line or float, and fishing makes no sound for them.
- The lake loop measures distance to each lake's round outline (centre and radius), so on irregular shores it can be a few metres off. It keeps streaming silently when you are far from water.
- Other players' actions make no sound yet. The host's tab keeps the world running when it's in the background, but a browser may slow its timers there, and guests then see a "Host is away" note.
