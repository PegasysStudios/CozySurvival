import { FISHING_CATCHES } from '../data/fishing';
import { PREFABS } from '../data/prefabs';
import { ANIMAL_LEVELS, FISH_LEVELS, RESOURCE_LEVELS, STRUCTURE_LEVELS, TREE_LEVELS } from '../data/progression';
import { recipesFor } from '../data/recipes';
import { RESOURCES, TREES } from '../data/resources';
import { hasHide } from '../data/species';
import { speciesName } from '../data/biomes';
import { TOOL_UPGRADES } from '../data/upgrades';
import { recipeSkill } from './crafting';
import { MAX_SKILL_LEVEL, skillLevel, xpForLevel } from './skills';
import type { Simulation } from './simulation';
import type { SkillId } from './state';

/** Upcoming map-specific unlocks use the same data as the action checks. */
export function nextSkillUnlock(sim: Simulation, skill: SkillId): string {
  const milestones: { level: number; name: string }[] = [];
  const add = (level: number, name: string) => milestones.push({ level, name });
  for (const r of recipesFor(sim.biome)) if (recipeSkill(r) === skill) add(r.requiredLevel, r.name);
  if (skill === 'crafting') {
    for (const upgrades of Object.values(TOOL_UPGRADES)) for (const up of upgrades) add(up.requiredLevel, up.name);
    for (const p of ['aFrame', 'barkHut', 'hideTent', 'storageCrate', 'storageChest'] as const) add(STRUCTURE_LEVELS[p], PREFABS[p].name);
  } else if (skill === 'gathering') {
    for (const kind of new Set(sim.gen.resources.map((r) => r.kind))) add(RESOURCE_LEVELS[kind], RESOURCES[kind].name);
    for (const species of new Set(sim.gen.trees.map((t) => t.species))) {
      const def = TREES[species], levels = TREE_LEVELS[species];
      add(levels.fell, `Fell ${def.name}`);
      if (def.bark) add(levels.harvest, def.peelVerb ?? `${def.name} bark`);
    }
  } else if (skill === 'hunting' || skill === 'skinning') {
    for (const species of new Set([...sim.biomeDef.prey, ...sim.biomeDef.predators].map((p) => p.species))) {
      if (skill === 'skinning' && !hasHide(species)) continue;
      add(ANIMAL_LEVELS[species][skill === 'hunting' ? 'hunt' : 'skin'], speciesName(species, sim.biome));
    }
  } else if (skill === 'fishing') {
    for (const fish of sim.biome === 'pnw' ? ['trout', 'bass', 'salmon'] as const : sim.biome === 'island' ? ['goby', 'parrotfish'] as const : ['trout'] as const) {
      add(FISH_LEVELS[fish], FISHING_CATCHES[fish].word);
    }
  }
  const level = skillLevel(sim.state.skills[skill]);
  const future = milestones.filter((m) => m.level > level).sort((a, b) => a.level - b.level);
  if (!future.length) return level >= MAX_SKILL_LEVEL ? 'All activities on this map mastered.' : `All activities on this map unlocked. Keep practicing toward level ${MAX_SKILL_LEVEL}.`;
  const next = future[0].level;
  return `Next at Lv ${next}: ${[...new Set(future.filter((m) => m.level === next).map((m) => m.name))].join(', ')}`;
}

export function skillXpText(xp: number): string {
  const level = skillLevel(xp);
  if (level >= MAX_SKILL_LEVEL) return `Mastered · level ${MAX_SKILL_LEVEL}`;
  return `${(xp - xpForLevel(level)).toFixed(1)} / ${xpForLevel(level + 1) - xpForLevel(level)} XP to Lv ${level + 1}`;
}
