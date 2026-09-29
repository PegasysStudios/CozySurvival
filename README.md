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
| `npm run smoke` | Build, boot the game in headless Chrome, then play through it with real input: walk, craft, place a campfire (red/green ghost, rotate, click), open its campfire menu and close it with Esc, reload and Continue, and use all three death-screen options. Fails on any console error |

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
| Select tool | 1–5 or mouse wheel |
| Crafting | C |
| Pack (inventory) | Tab |
| Quick eat or drink whatever you need most | F |
| Rotate placement ghost | R (Shift+R the other way) or mouse wheel |
| Cancel placement | Right-click or Q |
| Mute / unmute all sound (your volume settings are kept) | M |
| Close the open menu (pack, crafting, campfire, dev panel) | Esc |
| Pause when no menu is open, settings (master, music and effects volume, mouse sensitivity, invert Y) | Esc |

## What's in the demo

- **Day cycle.** A 24-minute day (one real minute per game hour) with sunrise, golden hour, dusk and a moonlit night: sky dome, stars, drifting clouds, fog and light colour all follow the clock. Sleeping in a shelter after 19:00 skips to dawn and fully restores energy.
- **Needs.** Health, hunger, thirst, warmth and energy. Empty hunger, thirst or warmth wears health down, and health at zero ends the run.
- **Cold.** Night pulls warmth toward zero; fires, shelters and a torch hold it up.
  - Cold can't kill you during the first two nights: freezing still hurts, but stops at 1 health. From night 3 on it can be lethal. Hunger and thirst can still kill at any time.
  - Within range of a burning campfire (5.5 m) the cold never lowers your warmth, even at the edge of the firelight or while wading.
  - Sleeping through the night with no burning campfire in range costs 30 of your 100 warmth (`sleep.coldWarmthCost` in `balance.ts`). Beside a burning fire you wake at least as warm as you lay down, and a shelter can still warm you up. Energy is generous: walking barely touches it, running drains it, standing still or sitting on a bench restores it, food and drink speed up recovery, and sleep refills it. Tasks cost a little energy each: chopping and swinging, gathering, crafting, building, and swimming.
- **Skills.** Gathering, hunting, cooking and crafting each rise from level 1 to 10 as you do them. You can see levels, progress and current effects in the Pack panel (Tab). The effects are gentle:
  - gathering: a growing chance of a bonus find (up to 40%)
  - hunting: up to 25% more damage to animals and a chance of extra meat when you butcher
  - cooking: a novice sometimes chars a meal (20% at level 1, never at level 10). The first time you cook a dish it always comes out right, drinks never burn, and a Charred Meal is still edible.
  - crafting: tools and shelters you make last longer (up to 4×)
- **Durability.** Crafted tools, shelters and benches wear out.
  - Tools lose a point per use and a little over time, and a lit torch burns down while you hold it. The HUD shows a bar under each tool, and the bow's slot shows how many arrows you carry (red at zero).
  - Shelters weather slowly and wear a little each night you sleep in them. Benches wear a little each time you sit.
  - You get a warning at 25%. At zero the item breaks: a tool is gone, a structure falls apart. Craft or build a new one; your recipes stay known.
  - Campfires, gear (basket, backpack, canteen) and bare hands don't wear.
- **Gradual progression.** Day 1 starts with bare hands and a 6-slot pack. Recipes are learned by doing (for example, gathering sticks and stones teaches the Stone Axe), and a 12-step guided objective track leads through the basics:
  - tools: axe, spear, bow and arrows, torch
  - campfire and fuel
  - water: drink by hand, fill a canteen, boil it at a fire
  - multi-ingredient meals: Forest Stew, Mushroom Skewer, Salmonberry Tea, Bark-Baked Trout
  - hunting, chopping trees, and shelters (lean-to, hide tent)
  - carry upgrades: Grass Basket, Hide Backpack
- **Forage is sparse, so the track spans several days.**
  - Fallen branches and loose stones give one stick or stone per harvest (three per pile), down from two.
  - The starter patch around the spawn has 2 stick piles, 2 stone piles, 2 ferns, 2 berry bushes, 1 chanterelle patch and 1 onion: enough for the first steps (gathering, fiber, the Stone Axe) and most of a campfire.
  - Across the map, 40% of the spots that used to grow sticks, stones or ferns still do, and 50% of the berry, mushroom and onion spots. That's about 260 forage spots per world instead of about 560. Trees, boulders and fallen logs are unchanged.
  - Near the spawn this leaves roughly a quarter of the old sticks and stones. Averaged over 8 worlds, a 25 m radius holds about 11 sticks, 9 stones and 13 fiber, down from 49, 44 and 28. The whole track needs about 14 sticks, 8 stones and 16 fiber, plus firewood. So after day 1 you range further out and wait on regrowth (sticks 12 h, ferns 16 h, stones 30 h).
- **Campfire menu.** Clicking a lit campfire opens its own menu instead of the full crafting menu. It has a fuel meter (hours left out of 16), separate buttons to add a stick (+1.5 h) or a log (+4 h), and only the recipes you cook over a fire. **C** still opens the full crafting menu.
- **Wildlife.**
  - Rabbits, deer and fish each have their own fear radius and flee behaviour. Deer spook from far away, so a bow helps.
  - Predators are rare early. Day 1 has a single distant grey wolf, black bears appear from day 2, and numbers grow slowly after that. Wolves spot you from farther away at night.
  - Predators stalk and attack, but keep away from lit fires, and a raised torch holds them off.
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
  - Procedural ambience (wind, water, fire crackle, birds by day, crickets and owls at night) and sound effects for every action.
  - Background music: a looping forest-ambience track that fades in gently after your first click (browsers block audio before that).
  - Gentle HUD toasts, banners and tooltips.
- **Volume.** The pause menu (Esc) has three sliders, saved in `localStorage` with your other settings:
  - **Master** (default 50%) scales every sound, music included.
  - **Music** (default 10%) is the background track only. At 100% it plays at its original mix level.
  - **Effects** (default 100%) covers every other sound: effects and ambience. At 100% they sound exactly as loud as before.

  **M** mutes and unmutes everything without changing the sliders.

## Dev tools

Available on the dev server, or on any build with `?dev=1` in the URL.

- **`` ` `` (backquote)** opens the dev panel. From it you can:
  - set the time scale
  - jump to a time of day
  - give item kits
  - unlock all recipes, tools and gear
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
  ui/      HTML/CSS HUD, crafting, campfire and pack panels, title/pause/death screens, dev panel
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

`npm test` runs 296 tests covering:

- inventory stacking and carry limits
- crafting, recipe unlocks, and ingredients consumed only on success
- placement validity against trees, rocks, felled trunks, structures, water, slope and reach, plus rotation
- needs, energy drain for movement, swimming and tasks, regen and sleep restore
- day-cycle timing (24-minute days) at 1× and scaled time
- skills: levels, XP from each activity, gathering bonuses, hunting damage and extra meat, burn chance, beginner's luck
- durability: skill-scaled tools and structures, wear per use and over time, torch burn, low warnings, breaking and re-crafting
- two-step trees: trunk collider and targeting, logs cut from the stump end, full-pack drops, save/load mid-trunk
- boulders and trunks you can stand on, rocks too tall to climb, swimming in and out of deep water, splashes
- master volume, mute and music fade-in math, plus settings persistence and migration
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

`npm run smoke` boots the real build in headless Chrome as an end-to-end check of placement, the campfire menu and Esc, save/reload, and the death screen.

## Known gaps

- Desktop only: it needs a mouse and keyboard with pointer lock. The layout adapts to small screens, but there are no touch controls yet.
- Visual and feel tuning (movement, lighting, animal behaviour) has only been checked through automated tests and a headless boot, not a hands-on playtest.
- There is one world size (320 m square, with a lake and a pond), and no weather yet.
- Hunger, thirst, fire fuel and resource regrowth are still tuned per game hour, so with 24-minute days they tick 2.5× faster in real time than before. Cold and warmth are unchanged per game hour.
- Trunk and boulder surfaces approximate the rendered meshes (a flat-topped slab and a half-ellipsoid dome).
- Predators don't follow you into the water.
- Saves from before this update carry over. Skills start at level 1, tools get fresh durability on first use, and existing shelters and benches start at full condition. A tree felled in an old save leaves just a stump, because its logs were already collected. The old volume setting resets to the new 50% default.
- Saves from before the forage change load into the sparser world. Forage now grows on a subset of the old spots, so nothing appears under structures you've built. Plants that no longer grow are simply gone, and a saved master volume keeps its level, with music at 10% and effects at 100%.
- Multi-day pacing is an estimate from forage supply against the goal track's needs, not a playtest. A player who knows where to look can still move faster. To slow it further, lower the `scatter` shares in `src/data/resources.ts`.
- Headless Chrome fakes pointer lock, so the smoke check can't reproduce the browser's own Esc lock release. That case is covered by unit tests only.
- With the pointer captured, Chrome eats the Esc key press itself, so pausing comes from the lock release. If the browser refuses to re-capture the pointer after a menu closes, the click-to-continue overlay appears instead.
- While muted, the music keeps playing silently, so unmuting picks it back up mid-track.
