import { questlineFor, type QuestDefinition, type QuestMilestone } from '../data/quests';
import { tribeFor, type TribeMember } from '../data/tribes';
import { itemName } from '../data/items';
import type { ObjectiveNeed } from '../data/objectives';
import type { GameState, QuestLogState } from './state';
import { countItem, removeAll } from './inventory';
import { skillRequirementText } from './skills';

const biomeOf = (s: GameState) => s.biome ?? 'pnw';
export const reputationName = (n: number): string => n >= 100 ? 'Kin' : n >= 60 ? 'Friend' : n >= 30 ? 'Trusted' : n >= 10 ? 'Acquaintance' : 'Cautious';

export function discoverTribe(s: GameState, tribe: string): boolean {
  if (!tribeFor(tribe, biomeOf(s)) || !s.settlements?.some((v) => v.tribe === tribe)) return false;
  const log = s.questLog ??= { tribes: {} };
  const entry = log.tribes[tribe] ??= { discovered: false, completed: 0, reputation: 0 };
  const first = !entry.discovered;
  entry.discovered = true;
  return first;
}

export function nextQuest(s: GameState, tribe: string): QuestDefinition | undefined {
  if (!s.questLog?.tribes[tribe]?.discovered) return undefined;
  return questlineFor(tribe, biomeOf(s))?.quests[s.questLog.tribes[tribe].completed];
}

export function activeQuest(s: GameState): QuestDefinition | undefined {
  const active = s.questLog?.active;
  return active && questlineFor(active.tribe, biomeOf(s))?.quests.find((q) => q.id === active.id);
}

const milestoneValue = (s: GameState, m: QuestMilestone) => (m.kind === 'crafted' ? s.stats.crafted : s.stats.events)[m.key] ?? 0;
const baselineKey = (m: QuestMilestone) => `${m.kind}:${m.key}`;

export function acceptQuest(s: GameState, tribe: string, member: string): boolean {
  const q = nextQuest(s, tribe);
  if (!q || q.giver !== member || s.dead || s.questLog!.active) return false;
  const baseline: Record<string, number> = {};
  for (const m of q.milestones ?? []) if (m.sinceAccept) baseline[baselineKey(m)] = milestoneValue(s, m);
  s.questLog!.active = { tribe, id: q.id, baseline };
  return true;
}

/** Deliveries count actual pack contents; building practice counts only the player's recorded actions. */
export function questNeeds(s: GameState, q: QuestDefinition): ObjectiveNeed[] {
  return [
    ...q.deliveries.map((r) => ({ icon: r.item, label: itemName(r.item, r.count), have: Math.min(r.count, countItem(s.inventory, r.item)), need: r.count })),
    ...(q.milestones ?? []).map((m) => ({ icon: m.icon, label: m.label, have: Math.min(m.count, Math.max(0, milestoneValue(s, m) - (m.sinceAccept ? s.questLog?.active?.baseline[baselineKey(m)] ?? 0 : 0))), need: m.count })),
  ];
}

export const questReady = (s: GameState, q: QuestDefinition): boolean => questNeeds(s, q).every((r) => r.have >= r.need);

/** The entire delivery is paid once, only to its giver; rewards cannot be repeated or earned by declining. */
export function completeQuest(s: GameState, tribe: string, member: string): QuestDefinition | null {
  const active = s.questLog?.active;
  const q = activeQuest(s);
  if (!active || active.tribe !== tribe || !q || q.giver !== member || s.dead || !questReady(s, q)) return null;
  const line = questlineFor(tribe, biomeOf(s))!;
  const entry = s.questLog!.tribes[tribe];
  if (!entry || line.quests[entry.completed]?.id !== q.id || !removeAll(s.inventory, q.deliveries)) return null;
  entry.completed++;
  entry.reputation = Math.min(100, entry.reputation + q.reputation);
  delete s.questLog!.active;
  return q;
}

export interface TribeDialog {
  member: TribeMember;
  greeting: string;
  text: string;
  quest?: QuestDefinition;
  mode: 'offer' | 'active' | 'chat';
  ready: boolean;
}

export function tribeDialog(s: GameState, tribe: string, member: string): TribeDialog | null {
  const def = tribeFor(tribe, biomeOf(s));
  const person = def?.members.find((m) => m.id === member);
  if (!person || !s.questLog?.tribes[tribe]?.discovered) return null;
  const entry = s.questLog.tribes[tribe];
  const greeting = entry.reputation >= 60 ? 'Welcome back, friend. There is always a place for you by our fire.'
    : entry.reputation >= 30 ? 'Good to see you again. Your help has made a difference to our camp.'
      : person.greeting;
  const active = activeQuest(s);
  if (active && s.questLog.active?.tribe === tribe) {
    const giver = def!.members.find((m) => m.id === active.giver)!;
    if (member !== active.giver) return { member: person, greeting, text: `${giver.name} is waiting for your help with “${active.title}”. Find them here or on their daily rounds.`, mode: 'chat', ready: false };
    const ready = questReady(s, active);
    return { member: person, greeting, text: ready ? 'You have everything we asked for. Would you like to hand it over?' : 'Take your time. This is what we still need; bring the supplies back to me when you are ready.', quest: active, mode: 'active', ready };
  }
  const q = nextQuest(s, tribe);
  if (!q) return { member: person, greeting, text: 'You have helped us through every task. Our people remember your kindness. Stay awhile and share the fire.', mode: 'chat', ready: false };
  if (s.questLog.active) return { member: person, greeting, text: 'Finish the task you have already promised before taking on another.', mode: 'chat', ready: false };
  if (q.giver !== member) {
    const giver = def!.members.find((m) => m.id === q.giver)!;
    return { member: person, greeting, text: `${giver.name}, our ${giver.title.toLowerCase()}, could use your help. Speak with them when you have a moment.`, mode: 'chat', ready: false };
  }
  return { member: person, greeting, text: q.offer, quest: q, mode: 'offer', ready: false };
}

export const questRequirementsText = (q: QuestDefinition) => (q.requirements ?? []).map((r) => skillRequirementText(r.skill, r.level)).join(' · ');

/** Optional save fields are normalized without touching inventory, earned skills or saved world indices. */
export function parseQuestLog(raw: unknown, s: Pick<GameState, 'biome'>): QuestLogState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Partial<QuestLogState>;
  const log: QuestLogState = { tribes: {} };
  for (const [id, value] of Object.entries(source.tribes ?? {})) {
    const line = questlineFor(id, biomeOf(s as GameState));
    if (!line || !value || typeof value !== 'object') continue;
    const completed = Number.isFinite(value.completed) ? Math.max(0, Math.min(line.quests.length, Math.floor(value.completed))) : 0;
    log.tribes[id] = { discovered: value.discovered === true, completed, reputation: line.quests.slice(0, completed).reduce((n, q) => n + q.reputation, 0) };
  }
  const active = source.active;
  const line = active && questlineFor(active.tribe, biomeOf(s as GameState));
  const q = line?.quests[log.tribes[active?.tribe ?? '']?.completed ?? -1];
  if (active && q?.id === active.id && log.tribes[active.tribe]?.discovered) {
    const baseline: Record<string, number> = {};
    for (const m of q.milestones ?? []) if (m.sinceAccept) {
      const n = active.baseline?.[baselineKey(m)];
      baseline[baselineKey(m)] = Number.isFinite(n) && n >= 0 ? n : 0;
    }
    log.active = { tribe: active.tribe, id: active.id, baseline };
  }
  return Object.keys(log.tribes).length ? log : undefined;
}
