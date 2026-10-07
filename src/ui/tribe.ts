import { QUESTLINES } from '../data/quests';
import { tribeFor } from '../data/tribes';
import { PREFABS, type PrefabId } from '../data/prefabs';
import type { GameState } from '../sim/state';
import { activeQuest, MAX_REPUTATION_LEVEL, nextQuest, questNeeds, questPauseReason, questRequirementsText, reputationLevel, reputationName, reputationProgress, reputationXpForLevel } from '../sim/quests';
import { escapeHtml } from './dom';
import { objectiveNeedsHtml } from './hud';

export function reputationHtml(s: GameState): string {
  return QUESTLINES.filter((line) => line.biome === (s.biome ?? 'pnw')).map((line) => {
    const entry = s.questLog?.tribes[line.tribe];
    const tribe = tribeFor(line.tribe, line.biome)!;
    const rep = entry?.reputation ?? 0;
    const level = reputationLevel(rep), pct = Math.round(reputationProgress(rep) * 100);
    const progress = level === MAX_REPUTATION_LEVEL ? `${rep} reputation · Maximum level`
      : `${rep} reputation · ${reputationXpForLevel(level + 1) - rep} more to Lv ${level + 1}`;
    const stations = entry?.discovered ? Object.entries(tribe.stationReputation).map(([prefab, required]) =>
      `<div class="skill-how" data-tribe-station="${prefab}">${escapeHtml(PREFABS[prefab as PrefabId].name)} · ${level >= required ? 'Available' : 'Requires'} Reputation Lv ${required}</div>`).join('') : '';
    const active = s.questLog?.active?.tribe === line.tribe ? activeQuest(s) : undefined;
    const next = nextQuest(s, line.tribe);
    const pause = questPauseReason(s);
    const waiting = entry?.discovered && entry.completed < line.quests.length && pause
      ? `<div class="skill-how">${pause === 'firstDay' ? 'Get to know the Oruun today. Quests open on Day 2.' : 'You have helped the Oruun today. Another quest opens at the next dawn (6 AM).'}</div>` : '';
    return `<div class="skill tribe-reputation" data-reputation="${line.tribe}"><div class="skill-head"><b>Reputation · ${escapeHtml(tribe.name)}</b><span>Lv ${level} / ${MAX_REPUTATION_LEVEL}${level === MAX_REPUTATION_LEVEL ? ' · max' : ''}</span></div><div class="skill-track" role="progressbar" aria-label="${escapeHtml(tribe.name)} reputation level progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="transform:scaleX(${pct / 100})"></i></div><div class="skill-effect">${entry?.discovered ? escapeHtml(reputationName(rep)) : 'Undiscovered'}</div><div class="skill-how">${escapeHtml(progress)}</div><div class="skill-how">${entry?.discovered ? 'Earn trust by completing their quests. Knowledge is shared freely; quests begin on Day 2, with one active quest and one completion per day.' : 'Local people live deep in the forest. Explore beyond the lake and speak with them to learn how to survive.'}</div>${stations}${entry?.discovered ? `<div class="skill-how">${entry.completed} / ${line.quests.length} quests completed</div>` : ''}${waiting}${active ? `<div class="quest-summary"><h3>Quest: ${escapeHtml(active.title)}</h3>${objectiveNeedsHtml(questNeeds(s, active))}<p>${escapeHtml(active.lesson)}</p><small>${escapeHtml(questRequirementsText(active))}</small><p>Return to ${escapeHtml(tribe.members.find((m) => m.id === active.giver)!.name)} with every requested supply in your pack.</p></div>` : next ? `<div class="skill-how">Next quest: ${escapeHtml(next.title)} · speak with ${escapeHtml(tribe.members.find((m) => m.id === next.giver)!.name)}.</div>` : entry?.discovered && entry.completed >= line.quests.length ? '<div class="skill-how">All quests complete. You are welcome at their fire.</div>' : ''}</div>`;
  }).join('');
}
