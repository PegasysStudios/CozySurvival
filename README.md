# CozySurvival

A low-poly cozy survival game for the browser with first-person and two third-person views, and three maps: a Pacific Northwest / Canadian forest, the Arizona high desert and a tropical island. You wake up stranded with nothing but your hands. Gather, craft, cook, hunt, build a camp and see how many days you can last. One in-game day lasts 24 real minutes.

Pick the map in the title menu’s Settings (or with ← / → on the title screen). Each map keeps its own save and records. The Pacific Northwest now has seasons; the desert and island keep their existing climates.

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
| `npm run smoke` | Build, boot the game in headless Chrome, then play through it with real input: walk, check the day-1 crafting lock, skip to the next morning, craft, place a campfire (red/green ghost, rotate, click), open its campfire menu and close it with Esc, reload and Continue, and use all three death-screen options. Then switch to the desert through Settings, start a desert run, check that each map continues its own run, and play a two-tab multiplayer session on a desert server over `?net=local`. Saves title and first-person screenshots of both maps. Fails on any console error |

`npm run smoke` needs a local Chrome or Chromium. It checks the usual install paths; set `CHROME_PATH` to point at another one. Screenshots go to `smoke-shots/` (git-ignored); set `SMOKE_SHOTS` to save them elsewhere.

## Pacific Northwest seasons

Spring → Summer → Fall → Winter → Spring, **25 game days per season**. New runs start in Spring; older saves start a fresh Spring on their current day without resetting the landscape, inventory or camp. The top-left season card shows the day and progress toward the next season.

The landscape changes while sleeping into the new season. Game days begin at 6 AM: on the final night, an awake player receives a warning at **1 AM** and passes out at **2 AM**, waking in the same place at dawn. Other nights still allow all-nighters. In multiplayer the host advances the shared season and everyone wakes together, including anyone who stayed awake.

- **Spring:** fresh greens, more purple/pink/white wildflowers and abundant forage; cool weather.
- **Summer:** the original green landscape and warmest daytime climate; fewer edible forage spots.
- **Fall:** orange, red and gold deciduous foliage among green evergreens, brown ground cover and abundant forage; cooler weather.
- **Winter:** snowy terrain and trees, no flowers, about 5% of edible forage spots, hibernating bears, white rabbits and very cold weather. Lakes become solid ice you can walk across; drinking, collecting lake water and fishing resume after thaw. Harvest snow clumps by hand on the ground, logs and some boulders. They hold three harvests and replenish after 24 game hours during winter. **Melt & Boil Snow** at a lit campfire turns one packed snow clump into one serving of boiled water in the canteen, usable for drinking, teas and stews.

Spring immediately removes the winter blanket and leaves roughly a quarter of the seeded snow clumps. These remain at their original locations and steadily shrink, with different patches melting between days 5 and 25. All remnants are gone by day 25. Spring clumps can still be gathered, but do not replenish; the next winter restores them. Collected snow stacks in the pack like other crafting ingredients. Melting follows the season clock through sleep, saves, reloads and multiplayer.

Seasons preserve harvested charges, felled trees, structures and map geometry. Their calendar is saved with the run and shared with multiplayer guests. In the developer menu (**~ / backquote**, dev builds or `?dev=1`), the PNW season buttons switch immediately to day 1 of the chosen season; only the host controls this in multiplayer.

### Pacific Northwest weather

Each day gets one weather state at **6 AM**, which stays through the day and following night: sunny, cloudy, rainy, foggy, or snowy in winter. Overcast days soften the light and fill out the clouds; fog adds gentle mist, rain falls in light streaks, and snow drifts slowly. Weather is atmospheric and adds no needs, damage, fire or harvest penalties. The day card's icon shows today's weather (a moon on clear nights); the season progress remains below it without extra text rows.

Weather uses a shuffled seasonal mix with exact totals and a maximum of two consecutive days of any state, including across season boundaries. Each world seed has its own order; the weather RNG never consumes gameplay randomness. Rain becomes snow in winter.

| Season (25 days) | Sunny | Cloudy | Rainy | Foggy | Snowy |
| --- | ---: | ---: | ---: | ---: | ---: |
| Spring | 8 | 7 | 7 | 3 | 0 |
| Summer | 13 | 6 | 4 | 2 | 0 |
| Fall | 6 | 8 | 7 | 4 | 0 |
| Winter | 6 | 8 | 0 | 4 | 7 |

Today's weather and its remaining seasonal schedule survive saving, reloading and retrying the day. The multiplayer host shares them with guests and late joiners. In the developer menu, **PNW weather** switches instantly until the next dawn; **Use today's weather** restores the scheduled choice. Choose Winter in the season controls to test Snowy. Guests cannot override the shared weather. Desert and island weather remain unchanged.

## Controls

| Action | Input |
| --- | --- |
| Move | W A S D |
| Run | Shift (drains energy faster) |
| Jump | Space (also climbs onto boulders and fallen trunks) |
| Swim | W A S D in deep water (no running or jumping while swimming) |
| Look | Mouse |
| Cycle camera: first person (default), close third person, far third person | V |
| Show / hide Goals (also available in the pause menu; remembered between sessions) | K |
| Gather, use tool, interact (fires, benches, shelters, workbenches, storage) | Left-click (hold to repeat) |
| Skin, then butcher a carcass | Equip the Stone Knife (7) and left-click it: the first cut skins, the second butchers |
| Sit on a bench / stand up | Left-click the bench / click it again or press a move key |
| Drink from the canteen | Tab, click the canteen, then **Drink** (or F) |
| Campfire menu (fuel meter, add a stick or log, cook) | Left-click a lit campfire (an unlit one takes fuel straight away) |
| Draw and release the bow | Hold and release left-click |
| Fish (fishing pole) | Hold left-click to wind up, release to cast, click when the float dips |
| Select tool (7 is the Stone Knife) | 1–7 or mouse wheel |
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
- **Needs.** Health, hunger, thirst, warmth and energy. An empty meter never kills you by itself: empty hunger, thirst or warmth wears health down slowly, and only health at zero ends the run.
  - Awake, an empty meter costs 15 health an hour (hunger), 22 (thirst) or 18 (warmth), and the drains add up: 55 an hour with all three empty. Health comes back at 5 an hour only while hunger and thirst are above 35 and warmth above 25.
  - Asleep (or lying in bed waiting for the others in multiplayer), each empty meter drains at a quarter of the awake rate (3.75, 5.5 and 4.5 an hour), for the hours it sits at zero, summed. Warmth only counts away from a burning fire, once the night's warmth cost has run it out. That night you don't heal, you wake to a warning such as "You slept hungry and cold and woke up weaker (-12 health)", and you can die in your sleep.
  - The rates live in `BALANCE.needs` (`starvingDamagePerHour`, `dehydrationDamagePerHour`, `freezingDamagePerHour`, `sleep.emptyDrainShare`).
- **Cold.** Night pulls warmth toward zero; fires, shelters and a torch hold it up.
  - Cold can't kill you during the first two nights, awake or asleep: freezing still hurts, but stops at 1 health. From night 3 on it can take health to zero. Empty hunger and thirst can wear health to zero at any time.
  - Within range of a burning campfire (5.5 m) the cold never lowers your warmth, even at the edge of the firelight or while wading.
  - Sleeping through the night with no burning campfire in range costs 30 of your 100 warmth (`sleep.coldWarmthCost` in `balance.ts`). Beside a burning fire you wake at least as warm as you lay down, and a shelter can still warm you up. Energy is a real resource: walking drains a little (0.1/s), running drains 0.8/s (about two minutes from full), and every task and tool action costs energy: swinging an axe, spear or torch or loosing an arrow 1, gathering 0.5, casting a line 1.2, striking a fish 0.4, crafting 3, building 6, swimming 0.2/s. Standing still or sitting on a bench restores it, food and drink speed up recovery, and sleep refills it.
- **Skills.** Gathering, hunting, cooking, crafting, fishing and skinning each rise from level 1 to 10 as you do them. You can see levels, progress and current effects in the Skills tab at the top of Crafting (C). The effects are gentle:
  - gathering: a growing chance of a bonus find (up to 40%), and up to +0.5 chop power with the axe
  - hunting: up to 40% more damage to animals and a chance of extra meat when you butcher
  - cooking: a novice sometimes chars a meal (20% at level 1, never at level 10). The first time you cook a dish it always comes out right, drinks never burn, and a Charred Meal is still edible.
  - crafting: tools and shelters you make last longer (up to 4×)
  - fishing: the chance to land a hooked fish, from 35% at level 1 (a few tries per fish) to 70% at level 10 (90% with a fully upgraded pole)
  - skinning: the chance a skinning cut takes the hide whole, on the same curve as fishing: 35% at level 1 to 70% at level 10 (90% with a fully upgraded knife). A whole hide gives 5 XP and a torn one 2.
  - Tool skills and tool upgrades add their bonuses on the same base, so neither alone reaches the top: see **Tool and weapon upgrades** below.
- **Durability.** Crafted tools, shelters and benches wear out.
  - Tools lose a point per use and a little over time, and a lit torch burns down while you hold it. The HUD shows a bar under each tool, and the bow's slot shows how many arrows you carry (red at zero).
  - Shelters weather slowly and wear a little each night you sleep in them. Benches wear a little each time you sit.
  - You get a warning at 25%. At zero the item breaks: a tool is gone, a structure falls apart. Craft or build a new one.
  - Campfires, gear (basket, backpack, canteen) and bare hands don't wear.
- **Gradual progression.** Day 1 starts with bare hands and a 6-slot pack, a short walk from a lake (new worlds put you within about 14 m of the shore, facing it). Every recipe and upgrade is visible from the start, greyed out until your pack holds the materials. An 11-step onboarding track leads through the basics, and the tracker lists each step's ingredients and goals in a column with have/need counts:
  1. Drink from the lake.
  2. Build a campfire.
  3. Forage food (3 berries, onions or chanterelles).
  4. Cook a skewer: the Forager's Skewer (2 salmonberries, a wild onion and a stick) or the Mushroom Skewer.
  5. Add firewood to the fire (twice).
  6. Craft a Stone Axe and chop a tree for a log.
  7. Survive the night: sleep in a lean-to, sleep by the fire or stay up. The step (and everything after it) holds until the morning of the next day.
  8. Craft a Fishing Pole, catch a trout and cook it.
  9. Craft a spear and hunt a hare with it. The task warns that spear hunting is hard.
  10. Craft a bow and arrows and make a kill with the bow.
  11. Craft a knife, then skin and butcher a kill. That completes onboarding; the goal becomes surviving and upgrading.

  **Day-1 crafting limit.** On day 1 you can only craft what the onboarding steps you've reached ask for (and what goes into it). Everything else stays visible, greyed with a lock and "Unlocks tomorrow", and the Crafting tab says so. From the morning of day 2 every recipe opens. In multiplayer it follows the host's day. What each step opens:

  | Step | Opens on day 1 |
  |---|---|
  | Build a campfire | Campfire |
  | Cook a skewer | Forager's Skewer, Mushroom Skewer (desert: Desert Skewer) |
  | Craft a Stone Axe | Stone Axe |
  | Survive the night | Cordage, Lean-to, Torch |

  The later steps (fishing, spear, bow, knife) name their recipes too, but they only start after the night, so on day 2 or later. Saves from before round 10 that are already past day 1 are never locked or held by the night step. `BALANCE.onboarding.dayOneLimit = false` turns the limit off.

  Beyond the track:
  - tools: axe, spear, bow and arrows, torch, fishing pole, Stone Knife
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
- **Tool and weapon upgrades.** Every tool and weapon (axe, spear, bow, torch, fishing pole, Stone Knife) has three upgrade levels, each much costlier than the last, and level III always needs hides. Click a tool on the tool belt in the Pack (Tab), or open the **Upgrades** tab in Crafting (C), to see its current stats, what the next level does and its materials. Upgrades are kept when a worn-out tool is re-crafted. Bonuses add to the matching skill's bonus on the same base:
  - axe: chop power per swing = 1 + Gathering (up to +0.5) + axe (+0.2 / +0.4 / +0.6). A 6-hit fir takes 6 swings at the start, 4 at Gathering level 5 with a level II axe, and 3 with both maxed.
  - spear and bow: damage × (1 + Hunting (up to +0.4) + weapon (+0.15 / +0.3 / +0.45)), so up to ×1.85. Bow upgrades also shoot faster, flatter arrows (up to +25% speed), which is how they improve accuracy.
  - fishing pole: landing chance = 35% + Fishing (up to +35%) + pole (+7 / +14 / +20%), capped at 95%.
  - torch: no skill. Upgrades cut its burn rate (by 20 / 40 / 60%) and add warmth while held (+3 / +6 / +9).
  - Stone Knife: skinning chance = 35% + Skinning (up to +35%) + knife (+7 / +14 / +20%), capped at 95%, and slash damage × (1 + Hunting + knife (+0.15 / +0.3 / +0.45)).
- **Foraging guide.** Crafting (C) has a **Foraging** tab at the top: a numbered guide of every harvestable plant (salmonberry, sword fern, chanterelle, nodding onion, paper birch). Each page unlocks the first time you harvest that plant and shows its effects and hunger when eaten, the recipes that use it, where it grows, how fast it regrows, and field notes. Locked pages hint at where to look. Unlocks are saved with your run.
- **Wildlife.**
  - Rabbits, deer and fish each have their own fear radius and flee behaviour. Deer spook from far away, so a bow helps.
  - Predators are rare early. Day 1 has a single distant grey wolf, black bears appear from day 2, and numbers grow slowly after that. Wolves spot you from farther away at night.
  - Predators stalk and attack, but keep away from lit fires, and a raised torch holds them off.
  - A kill leaves a carcass that needs a Stone Knife: without one you can still kill, but clicking the carcass only says "Needs a knife". See **Knife, skinning and butchering** under [Round 10](#round-10).
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
| Tropical Island | A volcanic island four times the size, ringed by a reef: palm beaches, a rocky cove, windward jungle, leeward grassland, a waterfall, streams, pools and caves. |

Every difference lives in one biome config (`src/data/biomes.ts`) plus biome branches in world gen, forage, recipes and rendering. The island's layout is in `src/sim/island.ts` and `src/sim/islandgen.ts`. The Pacific Northwest and desert are pinned by golden-fingerprint tests (`tests/pnw-unchanged.test.ts`, and `tests/desert-unchanged.test.ts` captured from the round 10 build), and the island didn't change either.

### Arizona Desert

- **Water is scarce.** Each world has three small pools and no lake:
  - **Spring:** always drinkable. Radius 6.2–7.2 m, about 1.8 m deep in the middle, stocked with Gila trout. It sits about 26 m from the spawn on average, and you start facing it.
  - **Tinaja:** a slickrock rain pool in the rock country. Radius 3.3–4 m, about 1.2 m deep, drinkable.
  - **Alkali pool:** radius 5–6.4 m and about 0.6 m deep, with a pale crust and milky water. It shows as "Milky Pool" until you taste it, then "Alkali Pool". The first sip costs 4 thirst and teaches you; after that you refuse to drink it and a canteen won't fill there.

  All three sit in shallow basins like the Pacific Northwest lakes: the bank rises gently from the waterline (about 1 m higher 3 m out, against 1.1 m at the big forest lake), and you can walk in and out anywhere. Pools never sit in the high country.

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
- **Plants.** Creosote fills the low flats at about 300 bushes per hectare, with sagebrush, bunchgrass and boulders around them (about 32 boulders of 1 m or more per world against 116). Harvestable plants: prickly pear, banana yucca (fiber), cholla, agave, desert chia and wolfberry, plus mesquite and pinyon trees. Each has a Foraging guide page.
- **Stones.** About 1,500 gatherable stone piles per world, thickest on slickrock, in washes and on talus, thinner by the water and in the high country. There are no purely decorative small stones.
- **Spines.** Walking into a prickly pear (3 damage), cholla (5), agave (3) or the core of a yucca that's ready to harvest (2), or pressing right up against a saguaro (4), pricks you, at most once every 1.1 s, with a small knockback and a one-time warning per plant. A picked or regrowing yucca is harmless, even stood on. The agave uses the cactus hitbox (0.4 m, like the cholla) and pricks while it has a heart to cut. The hitbox sits well inside picking reach, so gathering never hurts.
- **Fiber.** A yucca gives a sure 2 fiber per harvest (two harvests before it regrows). Cutting an agave heart also has a 30% chance of 1 fiber, so about 0.3 fiber per heart against the yucca's 2.
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
  - **Javelina:** territorial. Each holds about 14 m around its home. Come within 12 m of one inside that ground and it clacks its teeth, then charges at 6 m/s (faster than your 4.3 m/s walk, slower than your 6.8 m/s sprint) and butts for 8 damage every 1.5 s. Herd-mates within 16 m join in. It gives up once you are about 22 m from its home and walks back. Hit it and it charges you; badly hurt (a spear hit, or an axe hit and a punch) it bolts instead, at up to 6.4 m/s. It also charges other animals that wander in: prey bolts, and a mountain lion or bear slinks off home. Outside its ground it only watches you. Each gives 3 meat and 2 hides.
  - **Scorpion:** hides under stones. Each stone you gather has a 9% chance to turn one up, and each stone pile hides at most one, ever (the pile remembers it in saves and multiplayer). It rears up for 0.8 s, then scuttles after you at 3.4 m/s and stings for 6 every 1.6 s. One axe, spear or arrow hit kills it (bare hands take two), and it leaves nothing to butcher. Walk away and it loses interest once you are 7 m clear for 3 s, then burrows and is gone. At most 4 are out at once, and sleeping clears them.
  - Jackrabbits stand in for hares on the onboarding track.

  On the Pacific Northwest map wolves go up to four (one more every two days) and bears appear from day 2, two from day 5.
- **Onboarding** is the same 11 steps, reworded for the spring, desert forage, the Desert Skewer, the cold desert night and jackrabbits. Quail, roadrunners, lizards and snakes have no hide, so the knife step counts their butchering.

### Tropical Island

Round 11. The numbers below are averages over the eight seeds in `tests/island.test.ts`.

- **Four times the area.** The island sits in a 960 m world square (the other maps are 320 m). Its land averages about 336,000 m²: 3.97× the forest's dry land and 3.85× the desert's, or 3.8× their 296 m play square. With the lagoon you can swim in (about 94,000 m²) it is about 5×.
- **An irregular coast.** Four or five rocky headlands, three or four bays, one or two sand spits, a palm islet 18–24 m out in the lagoon, and a cove. A fringing reef runs about 35–50 m offshore all the way round, with surf breaking on its crest; past it the bottom drops to 24 m.
- **Regions, placed by seed:**
  - beaches: about 45,000 m² of bare pale sand with driftwood, loose stones, fallen coconuts and land crabs, and nothing growing on it. Coconut palms, sea grape, pandanus, purslane, naupaka and sedge line the grassy strip at the top of the beach
  - the cove: turquoise water behind a mouth 12–15 m wide, walled by grey limestone 6–9 m high, with a beach at its head and two sea stacks at the mouth
  - windward jungle: about 141,000 m² at about 220 trees per hectare (kukui, breadfruit, tree ferns and beach hibiscus), with ferns, ti plants and elephant ears underneath
  - leeward grassland and the grassy upper slopes of a 56–68 m volcanic peak with a small summit crater: about 121,000 m² at about 13 trees per hectare
  - a waterfall that drops 16 m on average (never less than 12) from a mossy cliff amphitheatre into its plunge pool
  - two streams (about 360 m of stream per island) and three freshwater pools: the plunge pool, one partway down the main stream, and the spring that feeds the second
  - three small caves: one in the waterfall's cliff and one in the side of each of two rock knolls
- **Salt water.** The lagoon, the cove and the open ocean are salt: you can't drink them or fill a canteen from them ("Seawater is far too salty to drink…"). Fresh water is only in the streams, the pools and the plunge pool. You start on a beach about 13 m from where a stream meets the sea, facing it.
- **The reef current.** Swimming anywhere inside the reef is free. From 2 m past the crest a current pushes you back toward the island, reaching 3.2 m/s (faster than you swim) by 14 m out, so nobody gets much more than 11–12 m past the reef. The first time, a message warns you about the deep water and the sharks.
- **Climate.** Warm nights: the air holds 88 warmth by day and never drops below 58 at night (the forest: 80 and 0), and a night asleep away from a fire costs 8 warmth instead of 30. Thirst drains 1.45× as fast (11.6 an hour instead of 8), and a night's sleep costs 32 thirst instead of 22. There is no rain or storm yet (Jon moved weather to a later round), so fires only burn down with their fuel.
- **Coconuts.** Every coconut palm carries three coconuts in its crown, too high to reach. Shoot one with the bow and it thumps down beside the trunk; the arrow usually drops with it (75%). A palm picked clean ripens three more after 30 hours. About one palm in eight has a fallen coconut lying underneath (about 50 per island), which comes back 36 hours after you pick it up. A coconut gives +18 thirst, +9 hunger and +4 energy.
- **Trees.**

  | Tree | Where | Logs | By hand |
  | --- | --- | --- | --- |
  | Coconut palm | the top of the beaches (about 390 per island) and the islet | 2 | coconuts, with a bow |
  | Breadfruit | jungle | 3 | 2 breadfruit, 36 h to ripen more |
  | Kukui (candlenut) | jungle, a few on the grassland | 3 | |
  | Hau (beach hibiscus) | behind the beach, by the streams | 2 | 2 strips of bark |
  | Tree fern | jungle understory, by the water | 1 | |

- **Edibles.**

  | Food | Source | Raw effect |
  | --- | --- | --- |
  | Coconut | palm crowns (bow), fallen under palms | +18 thirst, +9 hunger, +4 energy |
  | Sea Grapes | sea grape shrubs behind the beach, 2 per pick | +4 hunger, +3 thirst, +2 energy |
  | Wild Banana | banana plants in the jungle, 2 per bunch, 36 h to regrow | +6 hunger, +1 thirst, +5 energy |
  | Breadfruit | breadfruit trees | +4 hunger, −1 health (roast it) |
  | Taro Root | wet ground by streams and pools | +3 hunger, −5 health (cook it) |
  | Purslane | low mats with red stems and yellow flowers on the grassy strip behind the beach and across the grassland, with the grass kept back from them (about 390 per island, three by the spawn) | +2 hunger, +3 thirst |

  Pandanus is the fiber plant (Pandanus Fiber). Island recipes replace the forest meals (the fish, meat and water recipes stay, as Grilled Fish and Smoked Fish):

  | Recipe | Ingredients | Effect |
  | --- | --- | --- |
  | Beach Skewer | 2 sea grapes, 1 purslane, 1 stick | +16 hunger, +6 thirst |
  | Roast Breadfruit | 1 breadfruit, 2 sticks | +30 hunger |
  | Poi | 2 taro, 1 boiled water | +26 hunger, +10 thirst |
  | Coconut Fish | 1 raw fish, 1 coconut | +36 hunger, +10 thirst, +8 health |
  | Fish Laulau | 1 raw fish, 1 taro | +34 hunger, +8 health |
  | Island Stew | boiled water, raw meat, taro, breadfruit | +44 hunger, +16 thirst, +12 health |
  | Coconut Bananas | 2 bananas, 1 coconut | +22 hunger, +8 thirst, +14 energy |
  | Sea Grape Tea | boiled water, 2 sea grapes | +32 thirst |
  | Fish & Sea Grape Skewer | 1 raw fish, 2 sea grapes, 1 stick | +24 hunger |

  On the island, plant fiber is Pandanus Fiber, birch bark is Hau Bark, lake water is Stream Water and trout are Raw Fish.
- **Wildlife.** Fish are the main meat. On day 1 a world holds 30 parrotfish in the lagoon and cove, 12 stream gobies in the fresh water, 12 land crabs on the beaches, 10 red junglefowl, 7 feral goats on the grassland, 6 wild boar and 5 fer-de-lance in the jungle, 12 box jellyfish in the shallows and 2 tiger sharks past the reef (3 from day 3). There are no big land predators, as on real oceanic islands.
  - **Wild boar:** territorial like a javelina, but bolder. It holds 18 m around its home, notices you at 15 m, charges at 6.3 m/s (slower than your 6.8 m/s sprint) and butts for 12 every 1.4 s. It flees once badly hurt, and gives 3 meat and 2 hides.
  - **Fer-de-lance:** coils in the jungle leaf litter and doesn't rattle, so you notice it late (5 m). Its bite does 6 and its venom 0.6 a second for 20 s more; another bite adds to the time, up to 45 s. Venom can kill.
  - **Box jellyfish:** drift in the sunny shallows (under 2.4 m deep, well inside the reef, near the beaches) and sting for 7 every 1.8 s, but only when you're wading or swimming. One hit kills one; there's nothing to butcher.
  - **Tiger shark:** only in the deep water past the reef. It hears a swimmer out there from 220 m, circles in, rushes at 5.4 m/s (you swim 2.6) and bites for 24, then peels away and comes round again. It can't cross the reef, so the lagoon is safe.
  - Feral goats spook from far off like deer (2 meat, 1 hide). Junglefowl are the spear-hunt target. Land crabs are slow and easy.
  - Fruit bats roost in every cave and stream out at dusk, or whenever you walk in. They are scenery.
- **Caves.** Each has a flat floor under a 5 m rock shell, a mouth onto open ground (the waterfall cave's opens onto the ledge beside the pool), and five loose stone piles inside. You can build a campfire in one.
- **Knife and carcasses.** Boar and goat carcasses are skinned, then butchered. Junglefowl, crabs and vipers have no hide and go straight to butchering. Fish go straight into your pack.
- **Onboarding** is the same 11 steps with the day-1 crafting limit, reworded for the island: drink from a stream, pandanus fiber for the campfire, sea grapes, purslane or coconuts, the Beach Skewer, fishing in the lagoon, cove or a stream, spearing a junglefowl, the bow (for goats and coconuts), and the knife.
- **Rendering four times the area.** The island's ground is 120 m chunks culled to the fog (deep ocean isn't built at all; a flat seabed sits under it), one ocean sheet covers the lagoon, the sea and every stream and pool, trees and forage are instanced in chunks with low-detail far models (island trees switch to them from 58 m, against 90 m elsewhere), ground cover stops within 70–85 m, and the jungle's trees stop just inside the fog. In the headless smoke run the island draws about as many triangles and draw calls per frame as the forest (see [Testing](#testing)).

### Map select and saves

- The title screen shows **Continue**, **New Run**, **Multiplayer**, and **Settings**. Continue resumes the saved run; New Run requires Yes/No confirmation before replacing it. Settings contains map selection and controls. Its ◀ / ▶ arrows (or ← / → on the title screen) cycle maps; the name, tagline and Continue button update, and the background cross-fades to that map.
- Each map has its own save and dawn snapshot. The Pacific Northwest map keeps the original storage keys (`cozysurvival.v1.save` and `cozysurvival.v1.daySnapshot`), so every existing save loads unchanged as a Pacific Northwest run. The desert uses the same keys with a `.desert` suffix, and the island with `.island`.
- Best days and deaths are kept per map. **Start from scratch** on one map wipes only that map's save and record.
- The last map you picked is remembered.

## Multiplayer

Up to 4 players share one world over Supabase Realtime. The host's browser runs the world, including the clock, the animals and the sleep vote, so there's no game server to deploy.

- **Set up.** Copy `.env.example` to `.env.local`, fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, and restart `npm run dev`. [docs/multiplayer-setup.md](docs/multiplayer-setup.md) walks through the free Supabase project and its one SQL snippet. Without these variables the game is single-player only: the Multiplayer pop-up explains that multiplayer is unavailable and disables server creation, and the Supabase library is never downloaded.
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
  - jump to a time of day, or to the next morning (which lifts the day-1 crafting limit)
  - give item kits
  - unlock all tools (the Stone Knife included) and gear
  - spawn an animal nearby: a wolf, bear, deer or rabbit on the Pacific Northwest map, any desert predator or prey (or a scorpion) on the desert, or any island animal on the island (swimmers go in the nearest water they live in)
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

`npm test` runs 723 tests covering:

- the island follow-ups (`tests/island-followups.test.ts`, eight seeds): 300+ purslane per island with three near the spawn, all on dry ground off the sand and out of the deep jungle and caves, spread round the whole island, with no ground cover within 1.4 m and a model a metre wide with red stems and yellow flowers; wide strands of bare sand with no trees, no plant forage and no ground cover on them, while driftwood, stones and coconuts still lie there and palms still line the top of the beach; the water opacity setting existing only for the island, driving the island water shader and leaving the forest and desert lake shader untouched; and island saves from before the follow-ups loading with fresh trees and plants and a reseated camp, current island saves keeping felled trees and picked plants, forest and desert saves unchanged, and protocol 9
- the HUD compass (`tests/compass.test.ts`): all eight headings as the player turns, each matching its world direction and the camera's look direction, the switch halfway between points and wrapping past full turns, the sun rising in the east and setting in the west on every map, and the same reading on all three maps
- round 11, the island (`tests/island.test.ts`, eight seeds): about four times the area; an irregular coast (headlands, shoreline length, spits, a separate islet) with deep ocean all round; beaches, the cove with its walls and narrow mouth, grassland with few trees, dense jungle, a 12 m+ waterfall into a fresh plunge pool, two or more streams, three or more pools and two or more caves with flat floors, open mouths and stones; salt water you can't drink or bottle and fresh streams and pools you can; a walkable way from the spawn beach to fresh water; 1.45× thirst awake and asleep, warm nights, and no weather; coconuts shot down one at a time, out of reach by hand, fallen under palms, and their food; the reef current; boar charges, fer-de-lance venom, jellyfish that only sting in the water, sharks that stay past the reef and never reach the lagoon; fish outnumbering land game; the knife on island carcasses; the day-1 limit and the onboarding wording; island saves; and an island multiplayer server with coconuts in sync. Also the desert golden fingerprint (`tests/desert-unchanged.test.ts`) and upgrades restoring durability (`tests/upgrades.test.ts`)

- round 10: the knife (`tests/knife.test.ts`: recipe, key 7 and icon, the three tiers and their bonuses, repair costs and a workbench repair, the weak two-slash weapon, a use per cut until it breaks), carcasses (`tests/carcass.test.ts`: "Needs a knife" without one, skin then butcher then gone, a torn hide still skinned and butcherable, full-pack drops, hideless birds, lizards and snakes butchered in one cut, the Skinning curve and its progression, the slimmer raw-muscle model, skinned carcasses in saves and old carcasses loading), the day-1 limit (`tests/dayOne.test.ts`: step-by-step unlocks on both maps, no crafting or placing a locked recipe, everything open on day 2 or past the night step, the off switch, old saves past day 1 never locked or held, old track positions moved onto the new track, the locked tiles and header, the dev Next morning), health and needs (`tests/health.test.ts`: each drain rate awake and asleep, drains adding up, death only at health 0 with the worst cause named, no regen while a meter is empty, the cold grace awake and asleep, dying in your sleep, both maps), the 11-step onboarding and the survive-the-night hold (`tests/onboarding.test.ts`), 9% scorpions and one per pile (`tests/scorpions.test.ts`), yucca and agave spines and the agave fiber rate (`tests/spines.test.ts`), and in multiplayer: skin and butcher sync (late joiners too), a hideless quail, a waiting sleeper's drain and death, the night skip's drain, the day-1 limit following the host's day, and a spent stone pile

- the Arizona Desert (`tests/desert.test.ts`): the biome config, water across 40 seeds (always a drinkable spring near the spawn, no big lakes, far less water than the Pacific Northwest map), the alkali pool (first taste, refusal, no canteen fill), evening and night warmth against the Pacific Northwest map, a fire holding warmth, small-tree against big-tree wood, big trees only in the high country, scrub and cactus instead of forest plants, day-1 spawns, the cougar and upland-only bear schedule, the cougar's stalk and the torch, the rattlesnake strike, and the small prey bolting
- per-map saves (`tests/maps.test.ts`): an old save loading unchanged as a Pacific Northwest run, a desert run leaving the Pacific Northwest save untouched, **Continue** on both maps, per-map records, Start from scratch and Retry the day on the desert, and a desert multiplayer server carrying its map through the lobby to a joining guest
- the title menu (`tests/title.test.ts`): Continue, confirmation and cancellation before replacing a save, Settings and map selection; multiplayer pop-ups (`tests/multiplayer-menu.test.ts`): live server lists, create/join forms, disabled servers and cancellation
- round 8: the canteen (`tests/canteen.test.ts`: filling, the fill bar, each Drink taking one serving until empty, boiling inside it, F, pack water migrating on both maps, save round-trip), benches (`tests/bench.test.ts`: seat position and facing from either side, clamping to the ends, standing up, the seated pose for other players, saves), repairs (`tests/repair.test.ts`: cost as a share of the crafting cost that rises with level and never reaches it, time rising with level, walking locked but looking free, full condition when done, refunds on hurt or a removed bench, saves), the storage bin (`tests/storage.test.ts`: 10/15/20 slots, moving stacks and single items in and out, full bin or pack, saves), the axe's blade direction (`tests/axe.test.ts`) and the tabbed menu (`tests/menus.test.ts`: tab order, icons, tooltips, the active tab, badges, the shared column and the CSS that keeps icons full size)
- round 9: shallow pools (`tests/pools.test.ts`: basin shape across 40 seeds, no step too steep to walk out, banks no higher than the Pacific Northwest lake's, walking in and out, water area, and version-4 desert saves loading with trees, plants, structures, drops and carcasses reseated while Pacific Northwest saves load untouched), stones (`tests/stones.test.ts`: no bursage or small rocks, 1,300–1,900 gatherable piles on open dry ground, and seeded shape, size, rotation and colour variety on both maps), spines (`tests/spines.test.ts`: each spiny plant pricks with one warning, picking every charge unhurt, brushing past, the saguaro, the cooldown, death by spines, none on the Pacific Northwest map), scorpions (`tests/scorpions.test.ts`: the reveal rate (9% since round 10), the reveal, chase and sting, one weapon hit or two punches to kill, walking away until it burrows, the chase time limit, the cap, blocked sleep, saves, never on the Pacific Northwest map, the model), javelinas (`tests/javelinas.test.ts`: never faster than a sprint, the warn-charge-butt cycle, sprinting clear from 2, 4 and 8 m, walking away, watching from outside its ground, fighting back and bolting, charging a jackrabbit and a mountain lion, herd-mates joining, blocked sleep, sprinting clear in a real desert world) and the crafting checklist (`tests/checklist.test.ts`: pinning and unpinning, live have/need counts, the three-pin limit, auto-unpin, saves)
- the Pacific Northwest map unchanged (`tests/pnw-unchanged.test.ts`): a golden fingerprint of the terrain, world gen, starting state and early play on several seeds

- inventory stacking and carry limits
- crafting, every recipe available from the start, and ingredients consumed only on success
- round 6 menus: every recipe and upgrade shown with the right greyed state, the tile tooltip, the icon mapping and fallback, the tracker rows for each onboarding step, and the fern share
- round 4 costs: the 5× rule against the round 3 table, the listed exceptions, unchanged arrows, fuel and food, and every recipe fitting a 6-slot pack
- round 5 shelters: the tier order, upgrading in place with every material, refusals for missing materials, a blocked spot or the top tier, collider swaps, better sleep per tier, and old saves keeping their shelters
- round 5 tool upgrades: owning the tool, materials and the level cap, steep costs, persistence, and skill and upgrade bonuses adding up (chop swings, spear damage, landing chance, torch burn and warmth)
- campfire sleep: the menu option, the normal sleep cycle, warmth by a burning or dead fire, and the usual refusals
- the 11-step onboarding track walked with real actions (with the day-1 limit on), out-of-order progress, spear-only hare kills, old-save migration, and the lake-near spawn across 10 worlds
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
  - round 9: a guest's checklist staying their own through a resync, spines pricking a guest in their own world, a guest's stone turning up a scorpion the host spawns (every player sees it, it stings the guest, and the guest's spear kills it), and a javelina charging a guest and turning on them when hit

`npm run smoke` boots the real build in headless Chrome as an end-to-end check of the day-1 crafting lock (every Tools tile locked at the first step, with the Day 1 header), then skips to the next morning with the dev hook and checks the crafting tabs (every recipe across them, tab icons loading, the tab row staying clear of the detail panel at 1280 and 800 px wide, the hover name), placement, the campfire menu and Esc, the canteen's Drink button, a workbench repair from its icon grid (greyed tiles, the ring, locked walking, full condition after), a storage bin (the stacked layout with its upgrade panel on the right, moving a stack in, upgrading to 15 slots), save/reload, and the death screen. It also checks that multiplayer shows as "not set up" without env vars. Then two tabs on `?net=local` play together: the host creates a server through the menu, and the guest joins from the list. They see each other, chat, and a guest's gathering reaches the host. Finally the host closes the server.

It also switches the title to the desert through Settings (checking the cross-fade), starts a desert run with its own save, checks the spring, the alkali pool and the desert crafting menu, then goes back to the Pacific Northwest map with ← and forward again with →, each showing **Continue** for its own run. Then it moves on to the island, the third map: the cross-fade and Settings map selection, a new island run with its own save (the forest and desert saves untouched), the fresh-water first step, salt water refused, the island crafting menu, and **Continue** on both the desert and the island. The multiplayer part runs on an island server, and the guest's server list shows "Tropical Island". On every map it turns the player and reads the Day card's compass back (all eight headings on the forest map, two each on the desert and island). On the island it also checks, in the browser, the less see-through water setting, 300+ purslane, and no trees or plants on the sand. Along the way it saves seven screenshots (each map's title screen, each map in first person, and the island's jungle facing the waterfall) and measures each map's frame time, draw calls, triangles and heap into `perf.json` next to them. The island has to stay within twice the forest's frame time and draw calls, and its heaviest view (the jungle facing the waterfall) within twice the forest's frame time.

## Menus and icons (round 6)

- **Grid menus.** Crafting, the campfire, Upgrades and the Pack (owned tools and gear) are square icon tiles like the pack slots. Foraging and Skills have their own tabs at the top of Crafting. Hovering a tile fades in its name; selecting one shows its materials and the Craft, Cook or Upgrade button. Greyed tiles need more materials.
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

## Round 9

- **Shallow desert pools.** The spring, alkali pool and tinaja sit in gentle basins with the bank just above the water, like the Pacific Northwest lakes, instead of crater pits. See the pool list under [Arizona Desert](#arizona-desert).
- **Stones.** The grey bursage mounds that looked like stones are gone, and desert rocks under 1 m became gatherable stone piles: about 1,500 per world (was about 37). Boulders stay. Stone piles on both maps come in three low-poly shapes with seeded size (0.8–1.2×), rotation and colour shifts (greys in the forest; sandstone, tan and basalt in the desert). The Pacific Northwest layout is unchanged; only the look of its stones varies.
- **Spines, scorpions and javelinas.** Cactus and yucca spines hurt, gathering a desert stone can turn up a scorpion, and javelinas defend their ground. See [Arizona Desert](#arizona-desert) for the numbers. All three work in multiplayer: each player is pricked in their own world, a guest's scorpion is spawned by the host and stings whoever it chases, and javelinas run on the host and charge guests too. New death texts cover each one.
- **Crafting checklist.** Shift-click a recipe (or use its **Pin** button) to pin a checklist under the goals panel, in the same style. Each ingredient shows have/need and updates live as your pack changes; canteen water counts, and cooked recipes add a "lit campfire nearby" row. Up to three recipes can be pinned, and their shared materials are summed (pinning a fourth replaces the oldest). Shift-click again to unpin. Tools, gear and buildings come off the list once made; items stay pinned for the next batch. Pins are saved, and a guest keeps theirs through a resync.
- **Workbench grid.** The workbench menu is a crafting-style icon grid, one tile per carried tool that wears, with a durability bar, greyed when you lack the repair materials. The selected tool's condition, have/need materials, repair time and **Repair** button sit on the right.
- **Storage bin layout.** In storage sits over Your pack in the left column, with the tier's upgrade panel on the right. Slots stay 64 px; the upgrade panel narrows first.
- **Upgrades tab.** Tier diamonds are centred along the bottom of each tile. There is one Shelter tile and one Storage tile, for the nearest built one, showing its tier as diamonds and the next tier's cost, gains and **Upgrade** button.
- **Saves.** Round 9 saves are version 5. Desert saves from before round 9 load with fresh trees and plants (the reshaped pools and new stones renumber the world), and structures, drops and carcasses are set back on the new ground. Pacific Northwest saves load unchanged.

## Round 10

- **Fewer scorpions.** 9% per desert stone gather (was 18%), and each stone pile hides at most one scorpion, ever. The pile remembers it in saves and multiplayer, and the host ignores a second request for a spent pile.
- **Harvested yuccas are safe.** Only a yucca that's ready to harvest pricks; picked or regrowing, it's harmless.
- **Agave.** Its spines prick like the cactus, with the same tight hitbox, and it's still gatherable. Cutting its heart has a 30% chance of 1 plant fiber:

  | Plant | Fiber per harvest | Chance | Average per harvest |
  |---|---|---|---|
  | Banana yucca | 2 | 100% | 2 |
  | Parry's agave | 1 | 30% | 0.3 |

- **Knife, skinning and butchering.** The Stone Knife (Crafting > Tools, key 7) wears out (30 uses, a little over time), repairs at the workbench and doubles as a weak melee weapon (0.8 damage, 2.2 m reach: two slashes for a hare). Without a knife you can still kill, but a carcass only says "Needs a knife".

  | Level | Name | Materials | Skinning | Slash damage |
  |---|---|---|---|---|
  | Craft | Stone Knife | 10 stone, 5 sticks, 3 cordage | +0% | 0.8 |
  | I | Knapped Edge | 8 stone, 6 sticks, 2 cordage | +7% | 0.92 (×1.15) |
  | II | Wrapped Grip | 16 stone, 8 sticks, 6 cordage, 6 bark | +14% | 1.04 (×1.3) |
  | III | Skinner's Blade | 24 stone, 12 cordage, 8 bark, 3 hides | +20% | 1.16 (×1.45) |

  Repairs cost 3 / 4 / 5 / 6 items at levels 0 / I / II / III (2 stone and 1 stick; then 2 stone, 1 stick, 1 cordage; 3, 1, 1; 3, 2, 1).

  The first cut on a carcass skins it. The new **Skinning** skill (in the Pack's skill list) decides whether the hide comes off whole: a torn hide still leaves the skinned carcass, just with no hide. The second cut butchers it for the meat and the carcass disappears. Quail, roadrunners, lizards and snakes have no hide and go straight to butchering. Skinning chance by level, with a plain knife and each upgrade:

  | Skinning level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
  |---|---|---|---|---|---|---|---|---|---|---|
  | XP needed | 0 | 10 | 25 | 45 | 70 | 100 | 140 | 190 | 250 | 320 |
  | Plain knife | 35% | 39% | 43% | 47% | 51% | 54% | 58% | 62% | 66% | 70% |
  | Level I | 42% | 46% | 50% | 54% | 58% | 61% | 65% | 69% | 73% | 77% |
  | Level II | 49% | 53% | 57% | 61% | 65% | 68% | 72% | 76% | 80% | 84% |
  | Level III | 55% | 59% | 63% | 67% | 71% | 74% | 78% | 82% | 86% | 90% |

  A whole hide gives 5 XP and a torn one 2, so a novice reaches level 2 in three or four tries and level 10 after about ninety.
- **Carcass models.** A dead animal lies as before. Skinned, it swaps to its own model where it lies: no fur, raw muscle with pale sinew streaks, and slimmer (body 20% narrower and 14% shallower, thinner legs, head and tail). Butchered, it's gone. Both states sync in multiplayer and saves.
- **Onboarding pacing.** "Survive the night" after the fire, meal and wood steps, holding the next steps until the morning, and a knife step after the bow. Day 1 only allows what the onboarding has reached. See **Gradual progression** above.
- **Health and needs audit.** Checked every path that can hurt the player on both maps, awake and asleep:
  - awake, the rules already held: each empty meter drains health (15 / 22 / 18 an hour), the drains add up, there's no regen while a meter is empty, and death only comes when health reaches 0, for every cause (needs, animals, spines, scorpions, javelinas). Food that costs health (cholla buds, raw agave) never takes you below 1.
  - fixed: sleeping ignored empty meters (you even healed), in single player and on a multiplayer night skip. Now they drain at a quarter of the awake rate while asleep, with no healing that night and a wake-up warning. You can die in your sleep; Retry the day then goes back to the dawn of the day you lay down.
  - fixed: in multiplayer, players lying in bed waiting for the others had frozen needs. They now drain at the same asleep share, and dying gets you out of bed and out of the vote.
  - kept: the round 3 cold grace holds asleep too, so cold alone stops at 1 health during the first two nights.
- **Saves and multiplayer.** Round 10 saves are version 6 and the multiplayer protocol is version 7. Older saves load on both maps: carcasses whose hide is already gone count as skinned, skills start Skinning at 0, the onboarding position moves onto the new track (steps from the fishing step on shift one later, and a finished old track picks up the knife step), and a save already past day 1 is never locked or held by the night step. The Pacific Northwest layout is unchanged.

## Round 11

- **The Tropical Island**, a third map. See [Tropical Island](#tropical-island).
- **Upgrades restore durability.** Upgrading a tool, weapon or the knife rebuilds it at full condition: its durability resets to 100% of the new level's maximum, made at your current crafting skill (never below the maximum it had). This works on every map, and for each player in multiplayer, where tool upgrades are personal. Shelter and storage upgrades already came back at full condition.
- **Saves and multiplayer.** Saves stay at version 6; island saves go in their own slot. The multiplayer protocol went to version 8 for the island's animals and world (9 after the follow-ups below), so older clients can't join newer servers.

### After Jon's first island playtest

- **Purslane you can find.** It was there (about 210 per island) but tiny and hidden in the grass. Now there are about 390 per island (300–440 across the test seeds), three of them in the starter patch within 35 m of the spawn. Each plant is a mat about a metre across with red stems, bright fleshy leaves and yellow flowers, and grass, sedge, shrubs and ferns are kept 1.4 m back from it (and 0.8–0.9 m from fallen coconuts, sticks and stones).
- **Bare beaches.** Nothing grows on the beach sand: no palms, hau, sea grape, pandanus, purslane, naupaka, sedge or flowers. Driftwood, loose stones, fallen coconuts and crabs still lie on it. One rule (`IslandLayout.sandAt`) both paints the sand and keeps plants off it, so what looks like sand is sand. The palms and shrubs moved up to the grassy strip at the top of the beach, and the islet got a low grassy middle for its palms.
- **Less see-through island water.** The island's water is now 74% opaque at the shore (was 42%), 97% over water 4 m or deeper (was 93% at 6 m) and 90% in the streams and pools (was 72%). The setting is `BIOMES.island.waterOpacity`; the forest and desert lakes don't have one and look exactly as before.
- **HUD compass, on every map.** The Day card in the top left shows which way you face as N, NE, E, SE, S, SW, W or NW, with a small north-up dial whose needle turns as you do (hover it for the full name). North is −Z and east is +X, which is where the sun rises.
- **Saves and multiplayer.** Moving the palms and forage changed which tree and plant each saved index points at, so island saves now record a world revision (`worldRev: 2`, from `WORLD_REVISION` in `worldgen.ts`). An island save from before these changes still loads. Your pack, tools, skills, structures and progress carry over, but its trees and plants start fresh, and its structures, drops and carcasses are reseated on the ground. Forest and desert saves are written and read exactly as before. The multiplayer protocol is version 9, so players on the old island layout can't join new servers.

## Known gaps

- Desktop only: it needs a mouse and keyboard with pointer lock. The layout adapts to small screens, but there are no touch controls yet.
- Visual and feel tuning (movement, lighting, animal behaviour) has only been checked through automated tests and a headless boot, not a hands-on playtest.
- The island is 960 m square; the forest and desert stay 320 m until they grow in a later round. There is no weather yet: rain, storms and fires put out by storms wait for a weather system Jon will schedule.
- The island has had one playtest (Jon's), and the four follow-ups from it (purslane, bare beaches, the water and the compass) have had no visual review. They're checked only by tests and the headless smoke run.
- The beach-top palm belt thins where the leeward grassland meets the coast, so those beaches have fewer palms than the windward ones.
- Venom shows as a message and the health bar draining; there's no separate venom icon on the HUD.
- The island reuses the lake loop for all its water; there's no surf, waterfall roar or jungle ambience yet.
- Box jellyfish are always in the shallows. Real box jellyfish come inshore about 8–10 days after each full moon; the game has no moon cycle to tie them to.
- Tiger sharks can be hurt but leave nothing to butcher. Fruit bats are scenery and can't be hunted.
- The waterfall cave is reached along the pool's narrow, sometimes ankle-deep ledge, and the islet needs a short swim or wade.
- Building a new island takes about 0.25 s (world and terrain) in Node and about 0.4 s for its views in headless Chrome; switching the title to the island took about 3 s in the headless run, most of it the cross-fade and compiling shaders in software GL.
- The desert is tuned from real-world densities and the numbers only, not a playtest. Its animal models, plants and terrain colours haven't had a visual review.
- The desert has three pools against the Pacific Northwest map's two bodies of water (a lake and a pond), so it has less water rather than fewer bodies: 8.5% of the area, none bigger than a 7.2 m radius. The spring and the alkali pool are needed for the drinkable/undrinkable rule; the tinaja is the third.
- Apart from scorpions under stones, the desert has no bugs, huntable or ambient.
- Desert ambience reuses the lake loop and forest birds; there are no cicadas, canyon wrens or coyotes yet.
- Creosote grows at about 300 bushes per hectare, a little under measured Sonoran stands (about 440 per hectare), to keep the flats walkable.
- One or two mountain lions and a bear on a 9-hectare map is far above real territory density. That's a deliberate game choice, as it is for the wolves.
- Saguaros are scenery and can't be chopped or harvested.
- The title cross-fade fades out a snapshot of the old map's canvas, so the menu itself doesn't fade.
- Multiplayer protocol version 8 (round 11: the island's animals and world; round 10 was 7), so older clients can't join newer servers (and the other way round).
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
- Round 9 has had no visual review either: the pool banks, stone shapes and colours, the scorpion model and burrowing, the javelina charge and the new menu layouts are checked by tests and the headless smoke run only.
- Round 10 has had no visual review: the knife icon (painted to match Jon's set until he draws his own), the knife in hand, the skinned carcass model and the locked crafting tiles are checked by tests and the headless smoke run only.
- The day-1 limit covers recipes (crafting, cooking and building) but not tool, shelter or storage upgrades, which need materials that are hard to reach on day 1 anyway. The fishing, spear, bow and knife steps list what they open, but those steps only start after the night, when nothing is locked.
- The day-1 limit, the asleep drain share (a quarter) and the knife and skinning numbers are tuned from the numbers only; Jon will tune them in play.
- If two players skin the same carcass at the same moment, both may get the hide, like the older butchering race.
- A carcass from an older save with only its hide left (the pack was full when it was butchered) takes a skinning cut for the hide, then an empty butchering cut to clear it.
- Desert saves from before round 9 lose their felled trees and picked plants, which come back fresh. A structure built on an old pool bank may now stand in shallow water.
- With about 1,500 stone piles, a desert building spot is sometimes blocked by a pile until you pick it up.
- The tinaja was reshaped along with the spring and the alkali pool.
- Javelinas spawn singly, so a "herd" charge only happens where two live within 16 m of each other. Charging animals only drives them off; javelinas never kill other wildlife.
- A guest only gets the javelina tip once a charge lands, because the warning comes from the host's animals.
- The pinned checklist is hidden on windows 560 px tall or less.
- The Upgrades tab's Shelter and Storage tiles act on the nearest built one, however far away it is. The Build tab still lists the upgrade-only shelter tiers.
- If two players upgrade the same shelter at the same moment, both spend their materials and it only goes up one tier.
- Bow upgrades improve accuracy through faster, flatter arrows; there's no aim spread to tighten.
- Saves from before round 5 load with every tool at level 0, lean-tos and hide tents as the first and last tiers, the Foraging guide unlocked for every plant already harvested, and onboarding replayed against the new track (a finished old track stays finished).
- Saves from before round 6 load as before; the list of learned recipes they carry is simply dropped, since every recipe is available now.
- A birch only shows bare wood once all its bark is peeled; with one of its two strips left it still looks whole.
- Other players see your fishing pole but not your line or float, and fishing makes no sound for them.
- The lake loop measures distance to each lake's round outline (centre and radius), so on irregular shores it can be a few metres off. It keeps streaming silently when you are far from water.
- Other players' actions make no sound yet. The host's tab keeps the world running when it's in the background, but a browser may slow its timers there, and guests then see a "Host is away" note.
