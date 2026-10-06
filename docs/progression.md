# Skill and gear progression

This balance applies to the Pacific Northwest (both saved world generations), Arizona Desert and Tropical Island. Players choose their activities, gradually become more reliable at them, and earn access to better equipment and harder harvests.

## Design basis

The code review covered the shared simulation, resource/species/recipe tables, world generators and starter supplies, onboarding, inventory and durability, crafting and upgrades, fishing and carcasses, UI, saves, run management and multiplayer synchronization. The simulation owns progression; the renderer and map generators consume its existing state. Requirements belong to shared data so maps, action prompts, menus and checklists agree.

Three design references informed the implementation:

- [Project Horseshoe: Coziness in Games (2017)](https://www.projecthorseshoe.com/reports/featured/Project_Horseshoe_2017_report_section_3.pdf) discusses safety, autonomy, competence and low pressure. Here, basic survival remains available without training, and failed attempts still teach something.
- [Josh Bycer: The Procession of Progression in Game Design](https://www.gamedeveloper.com/design/the-procession-of-progression-in-game-design) distinguishes player mastery from character progression and discusses interactions between systems. Here, aiming, timing and exploration still matter alongside skills, recipes and gear.
- [Daniel Cook: Anatomy of a Game Mechanic](https://www.gamedeveloper.com/design/anatomy-of-a-game-mechanic) examines learning through actions and feedback. Here, prompts show the required skill, menus expose future recipes, and the Skills section shows XP and the next map-specific unlock.

The numeric values below are tuning choices for Cozy Survival, rather than values prescribed by those sources. The scope is skill and gear progression; existing needs, damage, map layouts, weather and artwork keep their existing behavior.

## Level curve and practice

All six skills start at level 1 and cap at 50. The cumulative XP required for level `L` is `round(60 × (L − 1)^1.6)`. Each successive level costs more XP. The former curve required just 70 total XP for level 5; the new curve requires 551.

| Level | Total XP |
| --- | ---: |
| 1 | 0 |
| 2 | 60 |
| 3 | 182 |
| 5 | 551 |
| 10 | 2,018 |
| 20 | 6,670 |
| 30 | 13,122 |
| 50 | 30,371 |

| Activity | Base XP |
| --- | ---: |
| Successful gather / failed gather | 0.25 / 0.1 |
| Fell a tree / free a log | 0.6 / 0.25 |
| Hit / kill / butcher eligible wildlife | 0.5 / 5 / 1 |
| Cook a meal or drink / burn a meal | 4 / 1 |
| Craft materials / craft equipment | 3 / 8 |
| Build or upgrade a structure | 12 |
| Upgrade a tool | 8 |
| Land a fish / slip the hook / miss the bite window | 4 / 1 / 0.5 |
| Whole hide / torn hide | 5 / 2 |

Harder work multiplies its base XP by `1 + floor(requiredLevel / 5)`: level-5 work gives twice the base XP, level-10 work gives three times, and so on. Missed bite windows give their base XP. Locked actions, depleted resources, full-pack harvests and empty swings give no XP. XP is capped at the level-50 threshold.

Novice level-1 gathering averages 0.19 XP per attempt. Reaching level 2 takes roughly 316 attempts at that rate; reaching level 5 requires 2,204 successful basic gathers. Gathering retains its original 0.4-second interaction cadence and the existing motion. Progression comes from XP, skill requirements, yields and success chances. The internal pacing check also covers the fastest introductory timber cycle. Walking, eating, resting and regrowth make practical progression slower. Cooking, crafting, fishing and hunting award more XP per action because those actions need supplies, encounters or waiting.

Existing effect maxima remain: +50% chop power, +40% hunting damage, no burning at mastery, up to four times crafted durability, and improved fishing/skinning odds. Those benefits now develop over 50 levels. Gathering's bonus-item chance has a lower maximum of 10%.

## Crafting and gear milestones

Every recipe has an explicit required level. Cooking recipes require Cooking; materials, tools, gear and buildings require Crafting. All still require their existing materials and stations. The existing day-1 onboarding restriction also applies; reaching day 2 removes that restriction while skill requirements remain.

| Crafting level | Unlocks |
| --- | --- |
| 1 | Cordage, Stone Axe, Stone Knife, Torch, Campfire, Lean-to |
| 2 | Arrows, Fishing Pole, Log Bench |
| 3 | Spear, Grass Basket, Canteen |
| 4 | Woven Storage Bin |
| 5 | Bow |
| 6 | Repair Workbench, every tool's first upgrade |
| 8 | A-Frame shelter upgrade |
| 10 | Hide Backpack, Storage Crate upgrade |
| 15 | Every tool's second upgrade |
| 16 | Bark Hut upgrade |
| 20 | Storage Chest upgrade |
| 28 | Hide Tent upgrade |
| 30 | Every tool's third upgrade |

Structure upgrades retain their order: Lean-to → A-Frame → Bark Hut → Hide Tent, and Bin → Crate → Chest. A Bark Hut requires Crafting 16 plus its materials and an A-Frame to upgrade. Tool upgrade tiers require Crafting 6, 15 and 30 on every map.

Basic cooking at level 1 includes boiled water, roasted meat, grilled trout/island fish and each map's introductory skewer. Teas unlock at 2, richer skewers at 3, several prepared dishes at 4, salmon and other elaborate dishes at 6, stews at 8, chowder at 10 and smoked fish at 12. The authoritative per-recipe list is `src/data/recipes.ts`.

## Harvest milestones

| Map | Available at Gathering 1 | Later gathering |
| --- | --- | --- |
| All maps | Sticks and stones | Shared success and XP curve |
| Pacific Northwest | Berries, fern fiber, onions, birch bark/timber, snow | Mushrooms 3; maple felling 3; fir felling 5; cedar felling 8 |
| Arizona Desert | Yucca fiber, prickly pears, cholla buds, Joshua timber, basic bark | Wolfberries/mesquite pods 2; chia 3; juniper/pinyon felling 3; cottonwood felling 5; agave/pinyon nuts/ponderosa felling 8 |
| Tropical Island | Sea grapes, pandanus fiber, purslane, fallen coconuts, palm/hau/tree-fern timber | Taro/bananas 3; breadfruit felling 5; breadfruit picking 6; kukui felling 8 |

Peeling/picking and felling have separate requirements. Each patch charge is one attempt, consumed on success or failure; existing charge counts and regrowth intervals remain. A successful base harvest gives one item. Success starts at 60% and rises to 90% at level 50; a successful gather can also give one bonus item, with a chance rising from 0% to 10%. Agave retains its separate occasional fiber byproduct after a successful heart harvest. Hand peeling/picking uses the same success curve. Cutting timber and physically shooting coconuts down retain their action mechanics.

Small animals are available at Hunting/Skinning 1. Goats are the island's introductory hide source, so every map has a starting hide path. Deer and javelinas require 5 in their respective hunting/skinning activities; boars require 8, wolves 12, cougars 18 and bears 25. Roadrunners require Hunting 3. Dangerous snakes require Hunting 4/8 to harvest; sharks, which have no loot, require Hunting 30 for hunting XP. Wildlife without hides is butchered directly using its Hunting requirement. Every species is listed in `src/data/progression.ts`.

Players can always defend against dangerous wildlife. Below that animal's Hunting requirement, defensive hits/kills give no Hunting XP and its meat cannot be butchered; skinning independently requires the appropriate Skinning level.

Fishing starts with trout, stream gobies and parrotfish. Bass enter the PNW main lake's eligible catch pool at Fishing 5, salmon at 10. Habitat restrictions still apply. Desert trout and island freshwater/sea fishing remain usable at Fishing 1. Eligible catches in a mixed pool have equal species odds.

## Persistence and validation

Save version 7 maps old XP onto the new curve once, preserving earned level and fractional progress. An old level-10 skill stays level 10, with a new path to 50. Inventory, equipment, camp and map state carry over. Current saves preserve XP exactly. Multiplayer protocol 14 requires matching progression rules; each player's skills and equipment remain personal.

Validation uses TypeScript, the production build and internal Vitest tests. Progression coverage includes all recipe requirements on all three maps, novice survival resource paths, day-1 pacing, actual gather probabilities, failure XP, locked-action atomicity, tree requirements, fishing unlocks in both forest generations, equipment and structure gates, checklists/prompts, save migration and multiplayer guest restrictions. Existing landscape fingerprints normalize the save-version field so they continue to check map geometry and behavior independently of the progression format.

No browser, screenshot or visual tests were run for this update. The pacing figures are analytical starting points; playtime to each milestone depends on the activities the player chooses. Future tuning can change the curve in `src/data/balance.ts`, action requirements in `src/data/progression.ts`, recipes in `src/data/recipes.ts` and tool tiers in `src/data/upgrades.ts`.
