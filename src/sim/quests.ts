import { questlineFor, type QuestDefinition, type QuestMilestone } from '../data/quests';
import { tribeFor, type TribeMember } from '../data/tribes';
import { itemName } from '../data/items';
import type { ObjectiveNeed } from '../data/objectives';
import type { GameState, QuestLogState, StructureState } from './state';
import { countItem, removeAll } from './inventory';
import { skillRequirementText } from './skills';
import { dayOf } from './time';

const biomeOf = (s: Pick<GameState, 'biome'>) => s.biome ?? 'pnw';
export const MAX_REPUTATION_LEVEL = 10;
/** Same increasing curve as activity skills, scaled for quest rewards; future quests can fill levels 6–10. */
export const REPUTATION_THRESHOLDS = Array.from({ length: MAX_REPUTATION_LEVEL - 1 }, (_, i) => Math.round(10 * (i + 1) ** 1.6));
export const reputationLevel = (points: number): number => 1 + REPUTATION_THRESHOLDS.filter((n) => points >= n).length;
export const reputationXpForLevel = (level: number): number => level <= 1 ? 0 : REPUTATION_THRESHOLDS[Math.min(MAX_REPUTATION_LEVEL, Math.floor(level)) - 2];
export function reputationProgress(points: number): number {
  const level = reputationLevel(points);
  if (level === MAX_REPUTATION_LEVEL) return 1;
  const low = reputationXpForLevel(level), high = reputationXpForLevel(level + 1);
  return Math.max(0, Math.min(1, (points - low) / (high - low)));
}
export const reputationName = (points: number): string => points >= 100 ? 'Kin' : points >= 60 ? 'Friend' : points >= 30 ? 'Trusted' : points >= 10 ? 'Acquaintance' : 'Cautious';

export const tribeStationLevel = (s: GameState, st: StructureState): number | undefined => st.settlement
  ? tribeFor(st.settlement, biomeOf(s))?.stationReputation[st.prefab] : undefined;
export const privateTribeStructure = (s: GameState, st: StructureState): boolean => !!st.settlement && tribeStationLevel(s, st) === undefined;
export function canUseTribeStructure(s: GameState, st: StructureState): boolean {
  if (!st.settlement) return true;
  const level = tribeStationLevel(s, st);
  return level !== undefined && reputationLevel(s.questLog?.tribes[st.settlement]?.reputation ?? 0) >= level;
}
export function tribeStationRequirementText(s: GameState, st: StructureState): string {
  const tribe = tribeFor(st.settlement ?? '', biomeOf(s))?.name ?? 'Tribe', level = tribeStationLevel(s, st);
  return level === undefined ? `${tribe} camp property is private.` : `${tribe} Reputation Lv ${level} required`;
}

/** Quest days follow the existing 6 AM dawn, including sleep, reloads and the shared multiplayer clock. */
export function questPauseReason(s: GameState): 'firstDay' | 'completedToday' | undefined {
  const day = dayOf(s.totalHours);
  if (day <= 1) return 'firstDay';
  if ((s.questLog?.lastCompletedDay ?? 0) >= day) return 'completedToday';
  return undefined;
}

export function discoverTribe(s: GameState, tribe: string): boolean {
  if (!tribeFor(tribe, biomeOf(s)) || !s.settlements?.some((v) => v.tribe === tribe)) return false;
  const log = s.questLog ??= { tribes: {} };
  const entry = log.tribes[tribe] ??= { discovered: false, completed: 0, reputation: 0 };
  const first = !entry.discovered;
  entry.discovered = true;
  return first;
}

export function nextQuest(s: GameState, tribe: string): QuestDefinition | undefined {
  if (!s.questLog?.tribes[tribe]?.discovered || questPauseReason(s)) return undefined;
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
  if (!active || active.tribe !== tribe || !q || q.giver !== member || s.dead || questPauseReason(s) || !questReady(s, q)) return null;
  const line = questlineFor(tribe, biomeOf(s))!;
  const entry = s.questLog!.tribes[tribe];
  if (!entry || line.quests[entry.completed]?.id !== q.id || !removeAll(s.inventory, q.deliveries)) return null;
  entry.completed++;
  entry.reputation = Math.min(reputationXpForLevel(MAX_REPUTATION_LEVEL), entry.reputation + q.reputation);
  delete s.questLog!.active;
  s.questLog!.lastCompletedDay = dayOf(s.totalHours);
  return q;
}

/** Conversation variety never consumes survival or villager RNG. */
export function casualTribeStory(s: GameState, tribe: string, member: string, offset = 0): string {
  const person = tribeFor(tribe, biomeOf(s))?.members.find((m) => m.id === member);
  if (!person) return '';
  const index = dayOf(s.totalHours) + (s.questLog?.tribes[tribe]?.completed ?? 0) + offset;
  return person.stories[index % person.stories.length] ?? person.greeting;
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
  const pause = questPauseReason(s);
  if (pause) return { member: person, greeting, text: pause === 'firstDay' ? person.greeting : casualTribeStory(s, tribe, member), mode: 'chat', ready: false };
  const active = activeQuest(s);
  if (active && s.questLog.active?.tribe === tribe) {
    const giver = def!.members.find((m) => m.id === active.giver)!;
    if (member !== active.giver) return { member: person, greeting, text: `${giver.name} is waiting for your help with “${active.title}”. Find them here or on their daily rounds.`, mode: 'chat', ready: false };
    const ready = questReady(s, active);
    return { member: person, greeting, text: ready ? 'You have everything we asked for. Would you like to hand it over?' : `Take your time with “${active.title}”. Your journal in Skills lists what we need. Come back when you are ready.`, quest: active, mode: 'active', ready };
  }
  const q = nextQuest(s, tribe);
  if (!q) return { member: person, greeting, text: casualTribeStory(s, tribe, member), mode: 'chat', ready: false };
  if (s.questLog.active) return { member: person, greeting, text: 'Finish the task you have already promised before taking on another.', mode: 'chat', ready: false };
  if (q.giver !== member) {
    const giver = def!.members.find((m) => m.id === q.giver)!;
    return { member: person, greeting, text: `${giver.name}, our ${giver.title.toLowerCase()}, could use your help. Speak with them when you have a moment.`, mode: 'chat', ready: false };
  }
  return { member: person, greeting, text: q.offer, quest: q, mode: 'offer', ready: false };
}

export const questRequirementsText = (q: QuestDefinition) => (q.requirements ?? []).map((r) => skillRequirementText(r.skill, r.level)).join(' · ');

/** Optional save fields are normalized without touching inventory, earned skills or saved world indices. */
export function parseQuestLog(raw: unknown, s: Pick<GameState, 'biome' | 'totalHours'>): QuestLogState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Partial<QuestLogState>;
  const log: QuestLogState = { tribes: {} };
  for (const [id, value] of Object.entries(source.tribes ?? {})) {
    const line = questlineFor(id, biomeOf(s));
    if (!line || !value || typeof value !== 'object') continue;
    const completed = Number.isFinite(value.completed) ? Math.max(0, Math.min(line.quests.length, Math.floor(value.completed))) : 0;
    log.tribes[id] = { discovered: value.discovered === true, completed, reputation: Math.min(reputationXpForLevel(MAX_REPUTATION_LEVEL), line.quests.slice(0, completed).reduce((n, q) => n + q.reputation, 0)) };
  }
  if (typeof source.lastCompletedDay === 'number' && Number.isFinite(source.lastCompletedDay) && source.lastCompletedDay >= 1) {
    log.lastCompletedDay = Math.min(dayOf(s.totalHours), Math.floor(source.lastCompletedDay));
  }
  const active = source.active;
  const line = active && questlineFor(active.tribe, biomeOf(s));
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
