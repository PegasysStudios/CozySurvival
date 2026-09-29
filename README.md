# CozySurvival

A first-person, low-poly cozy survival game for the browser, set in a Pacific Northwest / Canadian forest. You wake up stranded by a lake with nothing but your hands. Gather, craft, cook, hunt, build a camp and see how many days you can last. One in-game day is one real hour.

Built with Vite, TypeScript and Three.js. Everything (models, terrain, sky, sound) is generated procedurally, so there are no external asset downloads.

## Run it locally

Requires Node 20+ (developed on Node 22).

```bash
npm install
npm run dev          # http://localhost:5287
```

Click **Start surviving**, then click into the game to capture the mouse. Press **Esc** to release it and pause.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload on port **5287** (dev tools enabled) |
| `npm run build` | Typecheck (`tsc`) and production build to `dist/` |
| `npm run preview` | Serve the production build on port **5288** |
| `npm test` | Vitest suite for the simulation (no browser or WebGL needed) |
| `npm run typecheck` | TypeScript only |
| `npm run smoke` | Build, boot the game in headless Chrome, start a run, walk, craft, and fail on any console error |

`npm run smoke` needs a local Chrome or Chromium. It checks the usual install paths; set `CHROME_PATH` to point at another one.

## Controls

| Action | Input |
| --- | --- |
| Move | W A S D |
| Run | Shift (drains energy faster) |
| Jump | Space |
| Look | Mouse |
| Gather, use tool, interact (fires, benches, shelters, carcasses) | Left-click (hold to repeat) |
| Draw and release the bow | Hold and release left-click |
| Select tool | 1–5 or mouse wheel |
| Crafting | C |
| Pack (inventory) | Tab |
| Quick eat or drink whatever you need most | F |
| Rotate placement ghost | R (Shift+R the other way) or mouse wheel |
| Cancel placement | Right-click or Q |
| Mute | M |
| Pause, settings | Esc |

## What's in the demo

- **Day cycle.** A 60-minute day with sunrise, golden hour, dusk and a moonlit night: sky dome, stars, drifting clouds, fog and light colour all follow the clock. Sleeping in a shelter after 19:00 skips to dawn and fully restores energy.
- **Needs.** Health, hunger, thirst, warmth and energy. Empty hunger, thirst or warmth wears health down, and health at zero ends the run. Energy is generous: walking barely touches it, running drains it, standing still or sitting on a bench restores it, food and drink speed up recovery, and sleep refills it.
- **Gradual progression.** Day 1 starts with bare hands and a 6-slot pack. Recipes are learned by doing (for example, gathering sticks and stones teaches the Stone Axe), and a 12-step guided objective track leads through the basics:
  - tools: axe, spear, bow and arrows, torch
  - campfire and fuel
  - water: drink by hand, fill a canteen, boil it at a fire
  - multi-ingredient meals: Forest Stew, Mushroom Skewer, Salmonberry Tea, Bark-Baked Trout
  - hunting, chopping trees, and shelters (lean-to, hide tent)
  - carry upgrades: Grass Basket, Hide Backpack
- **Wildlife.**
  - Rabbits, deer and fish each have their own fear radius and flee behaviour. Deer spook from far away, so a bow helps.
  - Predators are rare early. Day 1 has a single distant grey wolf, black bears appear from day 2, and numbers grow slowly after that. Wolves spot you from farther away at night.
  - Predators stalk and attack, but keep away from lit fires, and a raised torch holds them off.
- **Trees.** Chop them with the axe. They topple with a thud, drop logs and leave a stump.
- **Placement.** Structures from the crafting menu go down as a green or red ghost with rotation. Placement is blocked when the spot:
  - overlaps trees, stumps, boulders, fallen logs, plants, other structures, water, or the player
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
  - Gentle HUD toasts, banners and tooltips.

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
- **T** cycles the time scale through 1×, 10×, 60× and 240×. At 60× a full day takes one minute. A `DEV ×N` badge on the clock shows when time is sped up.

## How the code is organised

```
src/
  core/    math, seeded RNG, noise, 2D geometry, spatial grid
  data/    tuning (balance.ts), items, recipes, prefabs, species, resources, objectives
  sim/     WebGL-free game simulation: terrain, world gen, movement physics, needs,
           inventory, crafting, placement, animals, day cycle, saves, run manager
  render/  Three.js views: terrain, water, sky, instanced nature, creatures,
           structures, placement ghost, particles, first-person view model
  audio/   procedural Web Audio ambience and sound effects
  ui/      HTML/CSS HUD, crafting and pack panels, title/pause/death screens, dev panel
  game/    input and the Game class that wires sim, view, audio, UI and saves together
tests/     Vitest suite for sim/ and core/
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

`npm test` runs 167 tests covering:

- inventory stacking and carry limits
- crafting, recipe unlocks, and ingredients consumed only on success
- placement validity against trees, rocks, structures, water, slope and reach, plus rotation
- needs, energy drain, regen and sleep restore
- day-cycle timing at 1× and scaled time
- death and all three restart options, including the retry-day snapshot
- save and load round-trips and corrupted saves
- animal fear, flee and predator state machines
- movement and collision physics

`npm run smoke` boots the real build in headless Chrome as an end-to-end check.

## Known gaps

- Desktop only: it needs a mouse and keyboard with pointer lock. The layout adapts to small screens, but there are no touch controls yet.
- Visual and feel tuning (movement, lighting, animal behaviour) has only been checked through automated tests and a headless boot, not a hands-on playtest.
- There is one world size (320 m square, with a lake and a pond), and no weather yet.
