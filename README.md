# CozySurvival

A first-person, low-poly cozy survival game for the browser with two maps: a Pacific Northwest / Canadian forest and the Arizona high desert. You wake up stranded with nothing but your hands. Gather, craft, cook, hunt, build a camp and see how many days you can last. One in-game day lasts 24 real minutes.

Pick the map with the arrows beside the title (or ← / → on the title screen). Each map keeps its own save and records. Everything below the **Maps** section describes the Pacific Northwest map, which plays exactly as it did before the desert was added.

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
| `npm run smoke` | Build, boot the game in headless Chrome, then play through it with real input: walk, craft, place a campfire (red/green ghost, rotate, click), open its campfire menu and close it with Esc, reload and Continue, and use all three death-screen options. Then switch to the desert with the title arrow, start a desert run, check that each map continues its own run, and play a two-tab multiplayer session on a desert server over `?net=local`. Saves title and first-person screenshots of both maps. Fails on any console error |

`npm run smoke` needs a local Chrome or Chromium. It checks the usual install paths; set `CHROME_PATH` to point at another one. Screenshots go to `smoke-shots/` (git-ignored); set `SMOKE_SHOTS` to save them elsewhere.

## Controls

| Action | Input |
| --- | --- |
| Move | W A S D |
| Run | Shift (drains energy faster) |
| Jump | Space (also climbs onto boulders and fallen trunks) |
| Swim | W A S D in deep water (no running or jumping while swimming) |
| Look | Mouse |
| Gather, use tool, interact (fires, benches, shelters, workbenches, storage, carcasses) | Left-click (hold to repeat) |
| Sit on a bench / stand up | Left-click the bench / click it again or press a move key |
| Drink from the canteen | Tab, click the canteen, then **Drink** (or F) |
| Campfire menu (fuel meter, add a stick or log, cook) | Left-click a lit campfire (an unlit one takes fuel straight away) |
| Draw and release the bow | Hold and release left-click |
| Fish (fishing pole) | Hold left-click to wind up, release to cast, click when the float dips |
| Select tool | 1–6 or mouse wheel |
| Crafting (icon tabs along the top) | C |
| Pack (inventory) | Tab |
| Quick eat or drink whatever you need most | F |
| Rotate placement ghost | R (Shift+R the other way) or mouse wheel |
| Cancel placement | Right-click or Q |
| Mute / unmute all sound (your volume settings are kept) | M |
| Close the open menu (pack, crafting, campfire, workbench, storage, dev panel) | Esc |
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
  - water: drink by hand, or carry up to 4 servings in the canteen (never in pack slots), boiling them at a fire
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

## Maps

| Map | Setting |
| --- | --- |
| Pacific Northwest | Fir, cedar, birch and maple forest around a lake and a pond. The original map, unchanged. |
| Arizona Desert | Red-rock buttes and mesas, creosote flats and grass plains, a volcanic spire, and juniper, pinyon and ponderosa high country to the north. |

Every difference lives in one biome config (`src/data/biomes.ts`) plus biome branches in world gen, forage, recipes and rendering. The Pacific Northwest path is pinned by a golden-fingerprint test (`tests/pnw-unchanged.test.ts`).

### Arizona Desert

- **Water is scarce.** Each world has three small pools and no lake:
  - **Spring:** always drinkable. Radius 6.2–7.2 m, about 2.6 m deep, stocked with Gila trout. It sits about 26 m from the spawn on average, and you start facing it.
  - **Tinaja:** a slickrock rain pool in the rock country. Radius 3.3–4 m, drinkable.
  - **Alkali pool:** radius 5–6.4 m and shallow, with a pale crust and milky water. It shows as "Milky Pool" until you taste it, then "Alkali Pool". The first sip costs 4 thirst and teaches you; after that you refuse to drink it and a canteen won't fill there.

  Across 40 seeds the desert averages 285 m² of open water against 3,357 m² on the Pacific Northwest map (8.5%), and its largest pool is 7.2 m across the radius against a 31 m lake.
- **Hot days, cold nights.** The day holds warmth at 95 (Pacific Northwest: 80). From 16:00 to 19:30 it falls at 36 an hour (Pacific Northwest: 22 an hour from 17:00 to 21:30), and it climbs back from 5:30 to 9:00. Starting at 90 warmth at 16:00 with no fire:

  | Hour | Pacific Northwest | Desert |
  | --- | --- | --- |
  | 17:00 | 80 | 76 |
  | 18:00 | 70 | 40 |
  | 19:00 | 48 | 5 |
  | 20:00 | 26 | 0 |

  A burning campfire, shelter or raised torch protects you exactly as on the Pacific Northwest map, and the first two nights still can't kill you.
- **Trees give less wood.** About 244 trees per world against 1,119. The lowland is sparse (about 11 trees per hectare) and the northern high country is a juniper, pinyon and ponderosa woodland (about 75 per hectare). Saguaros are scenery and can't be chopped.

  | Tree | Where | Logs |
  | --- | --- | --- |
  | Joshua tree | lowland flats | 1 |
  | Mesquite | washes and flats (drops mesquite pods) | 1 |
  | Fremont cottonwood | by the spring | 2 |
  | Utah juniper | high country | 2 |
  | Pinyon pine | high country (drops piñon nuts) | 2 |
  | Ponderosa pine | high country | 3 |

  For comparison, fir and cedar give 3 logs and birch and maple give 2.
- **Plants.** Creosote fills the low flats at about 300 bushes per hectare, with sagebrush, bunchgrass and rocks around them (46 boulders per world against 116). Harvestable plants: prickly pear, banana yucca (fiber), cholla, agave, desert chia and wolfberry, plus mesquite and pinyon trees. Each has a Foraging guide page.
- **Edibles.**

  | Food | Source | Raw effect |
  | --- | --- | --- |
  | Prickly Pear Fruit | prickly pear, 2 per pick | +5 hunger, +4 thirst, +2 energy |
  | Cholla Buds | cholla | +3 hunger, −2 health (spines) |
  | Agave Heart | agave, once every 3 days | +4 hunger, −3 health (roast it) |
  | Chia Seeds | desert chia | +3 hunger, +4 energy |
  | Wolfberries | wolfberry, 2 per pick | +4 hunger, +2 thirst, +2 energy |
  | Mesquite Pods | mesquite trees | +4 hunger, +3 energy |
  | Piñon Nuts | pinyon trees | +5 hunger, +3 energy |

  Desert recipes replace the forest meals (the fish, meat and water recipes that don't need forest plants stay):

  | Recipe | Ingredients | Effect |
  | --- | --- | --- |
  | Desert Skewer | 2 prickly pear, 1 cholla buds, 1 stick | +16 hunger |
  | Roast Agave | 1 agave heart, 2 sticks | +30 hunger |
  | Mesquite Cakes (×2) | 3 mesquite pods, 1 boiled water | +14 hunger each |
  | Chia Fresca | boiled water, chia seeds, prickly pear | +34 thirst |
  | Wolfberry Tea | boiled water, 2 wolfberries | +30 thirst, +16 warmth |
  | Roasted Piñon Nuts | 3 piñon nuts | +16 hunger |
  | Desert Stew | boiled water, raw meat, cholla buds, mesquite pods | +42 hunger, +20 warmth, +12 health |
  | Piñon-Crusted Trout | raw fish, 2 piñon nuts | +34 hunger |
  | Trout & Prickly Pear Skewer | raw fish, 2 prickly pear, 1 stick | +24 hunger |

  On the desert, plant fiber is Yucca Fiber, birch bark is Shredded Bark (peeled from juniper and cottonwood), lake water is Spring Water and trout are Gila Trout.
- **Wildlife.** Eight huntable species. On day 1 a world holds about 14 jackrabbits, 12 Gambel's quail, 10 lizards, 7 javelina, 6 roadrunners, 5 rattlesnakes and 5 Gila trout, plus one mountain lion.
  - **Mountain lion:** stalks from cover like the wolf and warns you with a growl. One on day 1, two from day 4. Fire and a raised torch keep it off.
  - **Black bear:** one from day 3, and only in the juniper and pine high country.
  - **Rattlesnake:** doesn't flee. It rattles when you come close and strikes within 1.8 m for 9 damage (every 2.2 s).
  - **Javelina:** poor eyesight, so they notice you late, then scatter. Each gives 3 meat and 2 hides.
  - Jackrabbits stand in for hares on the onboarding track.

  On the Pacific Northwest map wolves go up to four (one more every two days) and bears appear from day 2, two from day 5.
- **Onboarding** is the same 9 steps, reworded for the spring, desert forage, the Desert Skewer and jackrabbits.

### Map select and saves

- The title screen has ◀ and ▶ arrows either side of the title. They (or ← / →) cycle the maps; the name, tagline, record and **Continue** button update, and the background cross-fades to that map.
- Each map has its own save and dawn snapshot. The Pacific Northwest map keeps the original storage keys (`cozysurvival.v1.save` and `cozysurvival.v1.daySnapshot`), so every existing save loads unchanged as a Pacific Northwest run. The desert uses the same keys with a `.desert` suffix.
- Best days and deaths are kept per map. **Start from scratch** on one map wipes only that map's save and record.
- The last map you picked is remembered.

## Multiplayer

Up to 4 players share one world over Supabase Realtime. The host's browser runs the world, including the clock, the animals and the sleep vote, so there's no game server to deploy.

- **Set up.** Copy `.env.example` to `.env.local`, fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, and restart `npm run dev`. [docs/multiplayer-setup.md](docs/multiplayer-setup.md) walks through the free Supabase project and its one SQL snippet. Without these variables the game is single-player only: the Multiplayer block on the title screen is greyed out with a "not set up" note, and the Supabase library is never downloaded.
- **Try it without Supabase.** Open `http://localhost:5287/?net=local` in two tabs of the same browser. The tabs talk over a BroadcastChannel ("Local test mode").
- **Play.**
  - **Create multiplayer server** starts a brand-new world on the map picked on the title screen. Other players see it in the server list, with its map, and click **Join**; guests get the host's map whatever their own title screen shows. Everyone picks a name and a male or female character.
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
  - spawn an animal nearby: a wolf, bear, deer or rabbit on the Pacific Northwest map, or any desert predator or prey on the desert
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

`npm test` runs 486 tests covering:

- the Arizona Desert (`tests/desert.test.ts`): the biome config, water across 40 seeds (always a drinkable spring near the spawn, no big lakes, far less water than the Pacific Northwest map), the alkali pool (first taste, refusal, no canteen fill), evening and night warmth against the Pacific Northwest map, a fire holding warmth, small-tree against big-tree wood, big trees only in the high country, scrub and cactus instead of forest plants, day-1 spawns, the cougar and upland-only bear schedule, the cougar's stalk and the torch, the rattlesnake strike, and the small prey bolting
- per-map saves (`tests/maps.test.ts`): an old save loading unchanged as a Pacific Northwest run, a desert run leaving the Pacific Northwest save untouched, **Continue** on both maps, per-map records, Start from scratch and Retry the day on the desert, and a desert multiplayer server carrying its map through the lobby to a joining guest
- the title map picker (`tests/title.test.ts`): arrow order and clicks, the map copy and the dots
- round 8: the canteen (`tests/canteen.test.ts`: filling, the fill bar, each Drink taking one serving until empty, boiling inside it, F, pack water migrating on both maps, save round-trip), benches (`tests/bench.test.ts`: seat position and facing from either side, clamping to the ends, standing up, the seated pose for other players, saves), repairs (`tests/repair.test.ts`: cost as a share of the crafting cost that rises with level and never reaches it, time rising with level, walking locked but looking free, full condition when done, refunds on hurt or a removed bench, saves), the storage bin (`tests/storage.test.ts`: 10/15/20 slots, moving stacks and single items in and out, full bin or pack, saves), the axe's blade direction (`tests/axe.test.ts`) and the tabbed menu (`tests/menus.test.ts`: tab order, icons, tooltips, the active tab, badges, the shared column and the CSS that keeps icons full size)
- the Pacific Northwest map unchanged (`tests/pnw-unchanged.test.ts`): a golden fingerprint of the terrain, world gen, starting state and early play on several seeds

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
  - round 8: storing and taking from a shared bin across three players, simultaneous deposits, a guest's bin upgrade, and a guest repairing at the host's workbench (others see the working pose, and the mended tool survives a resync)

`npm run smoke` boots the real build in headless Chrome as an end-to-end check of the crafting tabs (every recipe across them, tab icons loading, the tab row staying clear of the detail panel at 1280 and 800 px wide, the hover name), placement, the campfire menu and Esc, the canteen's Drink button, a workbench repair (the ring, locked walking, full condition after), a storage bin (moving a stack in, upgrading to 15 slots), save/reload, and the death screen. It also checks that multiplayer shows as "not set up" without env vars. Then two tabs on `?net=local` play together: the host creates a server through the menu, and the guest joins from the list. They see each other, chat, and a guest's gathering reaches the host. Finally the host closes the server.

It also switches the title to the desert with the arrow (checking the cross-fade), starts a desert run with its own save, checks the spring, the alkali pool and the desert crafting menu, then goes back to the Pacific Northwest map with ← and forward again with →, each showing **Continue** for its own run. The multiplayer part runs on a desert server, and the guest's server list shows "Arizona Desert". Along the way it saves four screenshots: each map's title screen and each map in first person.

## Menus and icons (round 6)

- **Grid menus.** Crafting, the campfire, Upgrades and the Pack (tool belt, gear, Foraging guide) are square icon tiles like the pack slots. Hovering a tile fades in its name; selecting one shows its materials and the Craft, Cook or Upgrade button. Greyed tiles need more materials.
- **Upgrade-only tiers.** The A-frame, bark hut and hide tent appear in the Build and Upgrades tabs with how to reach them (upgrade the tier below in place). Every tool's three upgrade levels are listed with their costs, even before the tool is made.
- **Jon's icons.** Hand-made 64×64 PNGs live in `public/icons/jon/`. `src/data/icons.ts` holds the only mapping from item id and tier to file (tool tier = upgrade level + 1); anything unmapped keeps its built-in SVG. The first upload lost its filenames, so the mapping is a best guess until named files arrive.
- **Ferns.** Sword ferns grow on 48% of their map-wide spots (was 40%), so fiber is a little easier to find.
- **Fiber stacks.** Plant fiber stacks to 30 per pack slot (was 16). Every other item keeps its stack size.

## Round 8

- **Canteen water.** Water only travels in the Bark Canteen, never in pack slots. It holds 4 servings, filled at the lake or by boiling at a fire. Its tile in the Pack shows a blue fill bar, like a tool's durability bar. Clicking it opens an info panel with a **Drink** button: each click takes one serving (raw water first, then boiled) until the canteen is empty. A lake water serving gives +18 thirst; boiled water gives +28 and a little warmth and energy. Teas are still meals carried in the pack. Old saves pour any pack water into the canteen, and anything past its capacity (or all of it, with no canteen) is poured out.
- **Benches.** Clicking a bench seats you on it, on the side you approached from and facing out that way; your eye height drops to 1.38 m. Other players see you seated with your body facing out. Click the bench again, press a move key or jump to stand up in front of it. Getting hurt, sleeping or the bench going away also stands you up.
- **Repair workbench** (8 logs, 12 sticks, 10 stones, 4 cordage; in the Build tab). Clicking it lists every carried tool or weapon that wears, with its condition, what mending it costs and how long it takes. **Repair** pays up front and starts a timed repair with a circular progress ring: you can look around but can't walk, jump or use tools until it's done, and the tool comes back to full condition. Getting hurt, dying, or losing the workbench or the tool drops the work and hands the materials back. Anyone in multiplayer can use any workbench, and other players see you working at it. The cost is 15 / 20 / 25 / 30% of the tool's crafting cost at upgrade levels 0 / I / II / III, rounded up, always at least one short of the full cost:

  | Tool | Crafting cost | Level 0 | Level I | Level II | Level III |
  |---|---|---|---|---|---|
  | Stone Axe | 6 stick, 6 stone, 6 fiber (18) | 3 (1, 1, 1) | 4 (2, 1, 1) | 5 (2, 2, 1) | 6 (2, 2, 2) |
  | Spear | 15 stick, 5 stone, 5 cordage (25) | 4 (2, 1, 1) | 5 (3, 1, 1) | 7 (4, 2, 1) | 8 (5, 2, 1) |
  | Bow | 15 stick, 10 cordage (25) | 4 (2, 2) | 5 (3, 2) | 7 (4, 3) | 8 (5, 3) |
  | Torch | 5 stick, 10 fiber, 5 bark (20) | 3 (1, 1, 1) | 4 (1, 2, 1) | 5 (1, 3, 1) | 6 (2, 3, 1) |
  | Fishing Pole | 10 stick, 5 stone, 5 cordage (20) | 3 (1, 1, 1) | 4 (2, 1, 1) | 5 (3, 1, 1) | 6 (3, 2, 1) |

  Repairs take 4 / 5.5 / 7 / 8.5 s at levels 0 / I / II / III. The numbers live in `BALANCE.repair`.
- **Storage bin** (24 sticks, 20 fiber, 3 cordage; in the Build tab). Clicking it opens its slots beside your pack: click a stack to move all of it across, right-click to move one. Any pack item fits (water stays in the canteen). It upgrades in place from its own menu, keeping what's inside:

  | Tier | Slots | Materials |
  |---|---|---|
  | 1. Storage Bin | 10 | crafting menu |
  | 2. Storage Crate | 15 | 8 logs, 16 sticks, 6 cordage |
  | 3. Storage Chest | 20 | 12 logs, 8 cordage, 6 hides, 10 birch bark |

  In multiplayer anyone can open any bin, and its contents sync to everyone. Deposits made at the same moment by two players are both kept.
- **Axe.** The held axe's blade points forward in first person (it pointed right), and other players see the axe gripped square to the fist with the blade leading the chop. Upgrade levels share the same model.
- **Tabbed crafting menu.** Six icon tabs run along the top of the grid: Tools, Build, Cooking, Upgrades, Gear and Materials (Jon's PNGs in `public/icons/crafting-tabs/`; there's no foraging-supplies category, so that icon isn't used, and the old All tab is gone). Hovering a tab names it, the active tab is highlighted, and a badge counts what you can make there now. The tabs and the grid share the left column, which never gets narrower than the tab row; when space is tight the detail panel on the right narrows instead. Everything from round 6 stays: square tiles, greyed tiles, hover names and the ingredient tracker.
- **Saves.** Round 8 saves are version 4. Older saves on both maps still load, with pack water moved into the canteen and a pre-round-8 "sitting" player standing up.

## Known gaps

- Desktop only: it needs a mouse and keyboard with pointer lock. The layout adapts to small screens, but there are no touch controls yet.
- Visual and feel tuning (movement, lighting, animal behaviour) has only been checked through automated tests and a headless boot, not a hands-on playtest.
- There is one world size (320 m square), and no weather yet.
- The desert is tuned from real-world densities and the numbers only, not a playtest. Its animal models, plants and terrain colours haven't had a visual review.
- The desert has three pools against the Pacific Northwest map's two bodies of water (a lake and a pond), so it has less water rather than fewer bodies: 8.5% of the area, none bigger than a 7.2 m radius. The spring and the alkali pool are needed for the drinkable/undrinkable rule; the tinaja is the third.
- The desert has no insects, neither huntable nor ambient.
- Desert ambience reuses the lake loop and forest birds; there are no cicadas, canyon wrens or coyotes yet.
- Creosote grows at about 300 bushes per hectare, a little under measured Sonoran stands (about 440 per hectare), to keep the flats walkable.
- One or two mountain lions and a bear on a 9-hectare map is far above real territory density. That's a deliberate game choice, as it is for the wolves.
- Saguaros are scenery and can't be chopped or harvested.
- The title cross-fade fades out a snapshot of the old map's canvas, so the menu itself doesn't fade.
- Multiplayer protocol version 5 (round 8: storage contents and the working pose), so older clients can't join newer servers (and the other way round).
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
- Two players can sit on the same spot of a bench.
- The seated pose has no knee bend: the legs swing forward straight.
- If two players take the same stack from a bin at the same moment, both may get it (deposits never collide).
- Teas and other drinks still ride in the pack; only plain and boiled water go in the canteen.
- Workbenches and storage don't wear out. Repairs don't need you to stay near the bench once started, since you can't walk away anyway.
- Round 8 has had no visual review: the workbench and storage models, the seated pose, the axe angle and the tab layout are checked by tests and the headless smoke run only.
- If two players upgrade the same shelter at the same moment, both spend their materials and it only goes up one tier.
- Bow upgrades improve accuracy through faster, flatter arrows; there's no aim spread to tighten.
- Saves from before round 5 load with every tool at level 0, lean-tos and hide tents as the first and last tiers, the Foraging guide unlocked for every plant already harvested, and onboarding replayed against the new track (a finished old track stays finished).
- Saves from before round 6 load as before; the list of learned recipes they carry is simply dropped, since every recipe is available now.
- A birch only shows bare wood once all its bark is peeled; with one of its two strips left it still looks whole.
- Other players see your fishing pole but not your line or float, and fishing makes no sound for them.
- The lake loop measures distance to each lake's round outline (centre and radius), so on irregular shores it can be a few metres off. It keeps streaming silently when you are far from water.
- Other players' actions make no sound yet. The host's tab keeps the world running when it's in the background, but a browser may slow its timers there, and guests then see a "Host is away" note.
