# PNW expansion

The expansion applies to newly created PNW worlds. The agreed area measure includes water inside the movement bounds. Old runs keep their original generation through Continue, Retry the day, and Restart from day 1.

## Architecture reviewed

`game/Game` connects input, the DOM UI, procedural audio, `Simulation`, `GameView`, and `RunManager`. The simulation is independent of the DOM and WebGL. Core RNG/noise/geometry and data tables feed terrain, scenery, collision, resources, wildlife, crafting, survival needs, seasons, weather, and placement. Rendering reads the simulation and consumes its events; persistence stores the player and sparse changes to indexed scenery. Host/guest sessions share those indices and rebuild terrain and scenery from the host's seed.

The existing Island expansion provides the relevant precedent: `ISLAND_WORLD_SIZE = 960`, a seed-specific `IslandLayout`, terrain-instance dimensions, regional planting rules, chunked terrain, fog/distance culling, and instanced vegetation. Its roughly fourfold land footprint sits inside a larger terrain square containing the ocean. PNW similarly separates movement area from the terrain margin, and reuses the established heightfield interpolation and instancing rather than scaling models or changing movement units.

## Layout decisions

- The original movement square is 296 m across. Doubling it gives 592 m and **350,464 m²**, exactly four times the original **87,616 m²**. The enclosing heightfield is 616 m across; retaining the 12 m margin is why its side is not simply 640 m.
- `PnwLayout` places the major landmarks first, using an independent seeded RNG. Lake shoreline harmonics and noise give the outline bays and promontories. Integrating the squared radial outline over 512 bearings normalizes its area to a 19% target, about **66,588 m²**. Terrain-grid sampling verifies the resulting water area, rather than trusting a nominal radius.
- One or two smaller ponds provide destinations elsewhere in the forest. A continuous stream joins the main lake to the first pond; a shallow ford keeps both banks connected by a wading route. All water remains at the existing level of zero, matching the Island's carved streams and the game's water/ice physics.
- Low, gently sloping banks let the player reach water. Lake shelving uses metre-based distances so a larger radius does not push fishing depth beyond a normal cast. The starter clearing and guaranteed supplies follow the spawn to the lake shore.
- A seeded elliptical meadow has a feathered, irregular edge. Terrain, forest density, ground colour, grass and wildflowers use the same region field. Its interior excludes trees and boulders. Existing seasonal rules give spring/summer blooms, fewer fall flowers and no winter flowers.
- Tree and resource spacing stays in metres. Generation loops use the terrain's expanded bounds; log budgets and decorative grass/flower attempts scale with area. Winter snow also uses those bounds. Scenery footprints keep rocks and logs out of water.
- Terrain uses 96 m chunks culled against the fog, following the Island's approach. Each chunk retains the exact 2 m heightfield triangles used by physics. A shared water sheet covers both basins and the stream; its depth texture, grid dimensions and origin follow the terrain instance. The renderer includes generation in its reuse decision so changing generations on the same seed rebuilds the correct terrain.

These are applications of two AAA design approaches, adapted to this small survival game: [Ubisoft's Far Cry 5 discussion](https://news.ubisoft.com/en-us/article/16TjVZmAtD85EWcvHtxHXL/far-cry-5-creating-curiosity-in-a-familiar-world) describes using clearings, valleys and rivers to encourage natural exploration while maintaining navigable routes; [Guerrilla's Horizon Zero Dawn presentation](https://www.guerrilla-games.com/read/gpu-based-procedural-placement-in-horizon-zero-dawn) describes defining procedural placement rules to assemble coherent environments around the player. This implementation uses landmarks and region rules; it does not introduce a new runtime procedural-placement engine.

## Save and network compatibility

`pnwGen` is a generation selector, separate from the existing Island `worldRev` migration. Missing PNW markers mean generation 1; new forests store generation 2. Both generators remain available and have separate cache keys. Every save-dependent world lookup explicitly uses the run's marker, preserving terrain, harvested resource spots, felled trees, camps, drops, inventory and wildlife positions. Existing save formats and storage keys remain in place.

Continue and day snapshots use the stored generation. Restart from day 1 creates fresh character/world state with that same generation. Explicit New Run and Start from scratch choose generation 2. Multiplayer snapshots carry the selector, and guests regenerate the same indexed world. Protocol 11 prevents old clients from applying indices to the wrong layout.

## Validation

Run `npm test`, `npm run build`, and then `npm run smoke:pnw`.

The automated suite includes 24 layout seeds, including zero, large unsigned values and unrelated hashed seeds. It samples actual lake coverage, floods walkable terrain to check connected land/meadow/ford access, walks from the starter area into the lake using real movement/colliders, and checks resources and snow across the outer bounds. It also checks seasonal flower instance positions, deterministic regeneration, save and multiplayer round-trips, chunk triangles against collision heights, and the water depth grid. The original PNW and Desert golden fingerprints remain unchanged.

The dedicated browser smoke script runs the production build in headless Chrome, switches between old and expanded PNW generation on the same seed, exercises all seasons and movement in the meadow, checks save/load, boots Desert and Island, and fails on browser/WebGL/shader errors. It takes no screenshots and performs no pixel or visual checks. Headless runtime validation does not establish a hardware FPS target.
