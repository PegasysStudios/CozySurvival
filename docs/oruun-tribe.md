# Oruun: local survival mentors

The Oruun welcome a cautious visitor and share practical knowledge of their homeland. Advice is free. Helping with their camp builds trust, while building and cooking for oneself teaches the player to survive independently.

## Camp and people

The deterministic PNW generator searches dry, gentle ground in the opposite half of the map, at least 1.1 times the playable half-width from the original spawn (over 325 m in expanded forests). Its small camp contains the existing campfire, two Hide Tent models, Woven Storage Bin and Repair Workbench. It checks building footprints, trees, rocks, logs and paths. Older forests can use a less symmetric arrangement. Loading an existing run also avoids player-built structures, retaining saved scenery indices and gameplay RNG.

| Person | Role | Daily work |
| --- | --- | --- |
| Aven | Elder | Rest, nearby exploration, crafting |
| Neri | Hunter and scout | Hunt small wildlife, explore, gather |
| Tor | Guardian | Chop wood, explore, craft |
| Sela | Gatherer and crafter | Gather, weave, chop wood |
| Lio | Young villager | Nearby exploration, gather, learn to craft |

Everyone rests between tasks, returns at dusk, respects terrain and obstacles, and stops to acknowledge a nearby player. Tasks have time limits and use the camp's own RNG. Gathering depletes actual resource charges; chopping fells actual trees; hunting consumes nearby small wildlife; crafting cooks meat or weaves cordage into their provisions. The camp refuels its own fire from stored sticks and logs. None of these actions earn player activity XP or player building credit.

Their fire provides passive warmth. Interacting, adding fuel and cooking there require Oruun Reputation Level 2; their bench supports the established tool-repair workflow from Level 5. The gates also apply to cooking through the crafting menu and starting repairs directly. Family tents and storage have no interaction targets or menus. Camp property cannot be upgraded, removed, slept in or looted by the player. Player-built structures keep their existing rules.

## The ten quests

Day 1 is for introductions: every villager greets the player without offering or accepting quests. From Day 2, only the next quest in this table is offered, and only by its giver. One quest can be active at a time, and only one can be completed per game day. The limit starts on the handover day, survives saving and reloading, and resets at the game's 6 AM dawn. An active quest can span multiple days. After a completion, all villagers share brief personal stories instead of offering another task that day.

No advances require reputation or replace existing activity skill gates. Supplies must be in the player's pack and are paid together at handover. Building milestones accept existing player-built structures; the repair milestone requires a repair completed after accepting that quest.

| # | Quest / giver | Delivery | Practice | Reputation |
| --- | --- | --- | --- | --- |
| 1 | An ember of trust / Aven | 12 sticks | Gather fuel | +3 |
| 2 | A fire of your own / Sela | 5 logs | Build a campfire | +5 |
| 3 | Food from the forest / Lio | 6 berries, 3 onions, 2 Forager's Skewers | Forage and cook | +6 |
| 4 | Take only what we need / Neri | 4 raw meat, 1 hide | Hunt, skin and butcher | +8 |
| 5 | Gifts of the lake / Neri | 3 raw trout, 2 grilled trout | Fish and grill | +9 |
| 6 | A place for provisions / Sela | 16 fiber, 4 cordage | Build a storage bin (Crafting 4) | +10 |
| 7 | Mend before replacing / Tor | 10 stones, 6 bark | Build a workbench (Crafting 6), finish a new tool repair | +12 |
| 8 | A roof for rainy nights / Tor | 4 roast meat, 4 grilled trout | Upgrade to an A-Frame (Crafting 8) | +14 |
| 9 | Walls that remember / Sela | 8 cordage, 4 hides | Upgrade to a Bark Hut (Crafting 16) | +15 |
| 10 | A place among the Oruun / Aven | 4 Forest Stews, 4 Bark-Baked Trout, 6 roast meat | Upgrade to a Hide Tent (Crafting 28), prepare advanced meals (Cooking 8) | +18 |

Reputation starts at Level 1 and caps at Level 10. It uses the skills' increasing curve scaled for quest rewards: cumulative thresholds are 10, 30, 58, 92, 131, 176, 225, 279 and 336 points. Skills shows the current level, progress to the next level and camp station requirements. The current ten quests grant 100 points and reach Level 5, leaving levels 6–10 for future additions. Existing point totals remain valid; levels are derived rather than saved separately. The familiar trust titles remain: Cautious → Acquaintance (10) → Trusted (30) → Friend (60) → Kin (100).

Declining leaves the offer available. When quests are open, returning to a different person directs the player to the correct giver. Handover cannot repeat a reward. Completing the sequence leaves stories and earned station access available.

Conversations use the supplied `public/ui/oruun-dialogue-panel.png` artwork at the bottom of the screen, with white text, the speaker's name and simple choices. The compact frame fades in and out in place; it retains its bottom alignment throughout closing and disables input immediately. “Tell me more” cycles through each villager's stories without affecting survival randomness or progression. Detailed requirements and teaching notes remain in Skills; the journal explains when quests are waiting for Day 2 or the next dawn.

## Implementation and extension

- `src/data/tribes.ts`: map-scoped definitions, roles, routines, greetings, personal stories, teaching notes and station reputation requirements. Unlisted camp structures are private. Only Oruun / PNW is registered.
- `src/data/quests.ts`: map-scoped questlines, delivery requirements, player-action milestones, lessons and rewards.
- `src/sim/settlements.ts`: placement, shared camp structures and save validation. Other generators can call `generateSettlements` after their scenery is generated when their own tribe is registered.
- `src/sim/villagers.ts`: reusable bounded task scheduler and obstacle steering; `Simulation` supplies actual world actions.
- `src/sim/quests.ts`: reputation levels and station access, one active quest, sequential acceptance, introduction-day and daily-completion gates, atomic completion, progress queries and personal save validation.
- `src/render/villagers.ts`: articulated procedural low-poly models using merged part geometry, joint animations and distance culling. Face paint, layered hide clothing, antlers, staff, bow/quiver, shield/spear and woven basket follow the reference roles.
- `src/ui/panels.ts`, `src/ui/tribe.ts`, `src/ui/hud.ts`: conversation, teaching notes, reputation and active quest presentation.

Camp state is separate from player structures so its tents never satisfy player build milestones or appear as personal upgrade targets. The combined `Simulation.structures` view supports shared collisions, warmth and station access. The optional save fields retain version-7 compatibility. Run activation adds missing villages to PNW saves; subsequent saves retain their locations, provisions and routines.

Multiplayer protocol 15 streams shared villages from the host while each character keeps their own quests and reputation. Guests do not simulate NPC work. Quest deliveries and fuel donations reach the host through requests; personal quest progress survives a snapshot resync.

## Checks

`npm run build` and `npm test` cover compilation, existing behavior, multi-seed camp placement, quest order and payments, introduction-day and daily limits, dawn transitions, lifetime building credit, actual repair practice, NPC routines, save/load, guest state, finite model geometry and dialog controls. `npm run smoke:oruun` exercises canvas clicks, introductions, Yes/No, delivery, stories after completion, daily-limit persistence, reputation, camp stations and isolation from Desert/Island in Chrome. `npm run smoke:pnw` checks existing seasons, wildlife and fishing behavior. Neither browser command requires visual inspection; optional Oruun screenshots are enabled only by setting `SMOKE_SHOTS`.
