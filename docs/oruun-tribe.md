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

Their fire provides warmth and cooking; their bench supports the established tool-repair workflow. Family tents and storage open an informational panel. Camp property cannot be upgraded, removed, slept in or looted by the player.

## The ten quests

Only the next quest in this table is offered, and only by its giver. No advances require reputation or replace existing activity skill gates. Supplies must be in the player's pack and are paid together at handover. Building milestones accept existing player-built structures; the repair milestone requires a repair completed after accepting that quest.

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

The campaign totals 100 reputation: Cautious → Acquaintance (10) → Trusted (30) → Friend (60) → Kin (100). Greetings grow warmer as trust increases. Declining leaves the offer available. Returning to a different person directs the player to the correct giver. Handover cannot repeat a reward. Completing the sequence leaves advice and shared stations available.

## Implementation and extension

- `src/data/tribes.ts`: map-scoped definitions, roles, routines, greetings and teaching notes. Only Oruun / PNW is registered.
- `src/data/quests.ts`: map-scoped questlines, delivery requirements, player-action milestones, lessons and rewards.
- `src/sim/settlements.ts`: placement, shared camp structures and save validation. Other generators can call `generateSettlements` after their scenery is generated when their own tribe is registered.
- `src/sim/villagers.ts`: reusable bounded task scheduler and obstacle steering; `Simulation` supplies actual world actions.
- `src/sim/quests.ts`: one active quest, sequential acceptance, atomic completion, progress queries and personal save validation.
- `src/render/villagers.ts`: articulated procedural low-poly models using merged part geometry, joint animations and distance culling. Face paint, layered hide clothing, antlers, staff, bow/quiver, shield/spear and woven basket follow the reference roles.
- `src/ui/panels.ts`, `src/ui/tribe.ts`, `src/ui/hud.ts`: conversation, teaching notes, reputation and active quest presentation.

Camp state is separate from player structures so its tents never satisfy player build milestones or appear as personal upgrade targets. The combined `Simulation.structures` view supports shared collisions, warmth and station access. The optional save fields retain version-7 compatibility. Run activation adds missing villages to PNW saves; subsequent saves retain their locations, provisions and routines.

Multiplayer protocol 15 streams shared villages from the host while each character keeps their own quests and reputation. Guests do not simulate NPC work. Quest deliveries and fuel donations reach the host through requests; personal quest progress survives a snapshot resync.

## Checks

`npm run build` and `npm test` cover compilation, existing behavior, multi-seed camp placement, quest order and payments, lifetime building credit, actual repair practice, NPC routines, save/load, guest state, finite model geometry and dialog controls. `npm run smoke:oruun` exercises canvas clicks, Yes/No, delivery, reputation, persistence, camp stations and isolation from Desert/Island in Chrome. `npm run smoke:pnw` checks existing seasons, wildlife and fishing behavior. Neither browser command requires visual inspection; optional Oruun screenshots are enabled only by setting `SMOKE_SHOTS`.
