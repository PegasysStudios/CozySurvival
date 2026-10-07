import { QUESTLINES } from '../data/quests';
import { tribeFor } from '../data/tribes';
import type { GameState } from '../sim/state';
import { activeQuest, nextQuest, questNeeds, questRequirementsText, reputationName } from '../sim/quests';
import { escapeHtml } from './dom';
import { objectiveNeedsHtml } from './hud';

export function reputationHtml(s: GameState): string {
  return QUESTLINES.filter((line) => line.biome === (s.biome ?? 'pnw')).map((line) => {
    const entry = s.questLog?.tribes[line.tribe];
    const tribe = tribeFor(line.tribe, line.biome)!;
    const rep = entry?.reputation ?? 0;
    const active = s.questLog?.active?.tribe === line.tribe ? activeQuest(s) : undefined;
    const next = nextQuest(s, line.tribe);
    return `<div class="skill tribe-reputation" data-reputation="${line.tribe}"><div class="skill-head"><b>Reputation · ${escapeHtml(tribe.name)}</b><span>${rep} / 100</span></div><div class="skill-track" role="progressbar" aria-label="${escapeHtml(tribe.name)} reputation" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${rep}"><i style="transform:scaleX(${rep / 100})"></i></div><div class="skill-effect">${entry?.discovered ? escapeHtml(reputationName(rep)) : 'Undiscovered'}</div><div class="skill-how">${entry?.discovered ? 'Earn trust by completing their quests. Knowledge is shared freely; only one quest can be active at a time.' : 'Local people live deep in the forest. Explore beyond the lake and speak with them to learn how to survive.'}</div>${entry?.discovered ? `<div class="skill-how">${entry.completed} / ${line.quests.length} quests completed</div>` : ''}${active ? `<div class="quest-summary"><h3>Quest: ${escapeHtml(active.title)}</h3>${objectiveNeedsHtml(questNeeds(s, active))}<p>${escapeHtml(active.lesson)}</p><small>${escapeHtml(questRequirementsText(active))}</small><p>Return to ${escapeHtml(tribe.members.find((m) => m.id === active.giver)!.name)} with every requested supply in your pack.</p></div>` : next ? `<div class="skill-how">Next quest: ${escapeHtml(next.title)} · speak with ${escapeHtml(tribe.members.find((m) => m.id === next.giver)!.name)}.</div>` : entry?.discovered ? '<div class="skill-how">All quests complete. You are welcome at their fire.</div>' : ''}</div>`;
  }).join('');
}
