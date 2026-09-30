/** Central tuning knobs. Rates marked "per game hour" scale with the dev time-scale. */
export const BALANCE = {
  time: {
    /** One in-game day lasts 24 real minutes (one real minute per game hour). */
    realSecondsPerDay: 1440,
    /** Game day boundary: a new day starts at dawn. */
    dayStartHour: 6,
    /** Run starts on day 1 at this hour. */
    startHour: 7,
    sleepFromHour: 19,
    sleepUntilHour: 5.5,
    nightStartHour: 20.5,
    nightEndHour: 5.5,
  },
  needs: {
    start: { health: 100, hunger: 85, thirst: 80, warmth: 75, energy: 100 },
    hungerPerHour: 5.5,
    thirstPerHour: 8,
    starvingDamagePerHour: 15,
    dehydrationDamagePerHour: 22,
    freezingDamagePerHour: 18,
    /** Cold can wear health down but can't kill during the first this-many nights (days 1..N); from the next night on it can. */
    coldGraceNights: 2,
    healthRegenPerHour: 5,
    regenMinHunger: 35,
    regenMinThirst: 35,
    regenMinWarmth: 25,
    warmthRatePerHour: 22,
    warmthFireRatePerHour: 80,
    warmth: { day: 80, night: 0, fire: 100, shelterBonus: 35, torchBonus: 14, wadingPenalty: 25 },
    fireWarmRadius: 5.5,
    shelterWarmRadius: 3.2,
    /**
     * Energy is driven by real-time activity (seconds), not game hours. `swingCost` is every tool action (axe,
     * spear and torch swings, punches, bow shots); `castCost` is each fishing cast and `hookCost` each strike.
     */
    energy: {
      walkDrainPerSec: 0.1,
      sprintDrainPerSec: 0.8,
      idleRegenPerSec: 0.55,
      boostMultiplier: 2.5,
      boostSeconds: 120,
      jumpCost: 1.2,
      swingCost: 1,
      gatherCost: 0.5,
      castCost: 1.2,
      hookCost: 0.4,
      craftCost: 3,
      buildCost: 6,
      swimDrainPerSec: 0.2,
      exhaustedRecoverAt: 20,
      exhaustedSpeedMul: 0.8,
      sittingMultiplier: 1.8,
    },
    /**
     * `coldWarmthCost`: warmth points (of 100) lost sleeping through the night with no burning campfire in range.
     * `emptyDrainShare`: asleep (or waiting in bed in multiplayer), an empty hunger, thirst or warmth meter drains
     * health at this share of the awake rates above, and the drains add up.
     */
    sleep: { hungerCost: 18, thirstCost: 22, floor: 8, healthGain: 12, coldWarmthCost: 30, emptyDrainShare: 0.25 },
    handDrink: { thirst: 9, warmth: -1, cooldown: 0.8 },
  },
  player: {
    radius: 0.35,
    eyeHeight: 1.62,
    /** Eye height sitting on a bench: hips on its rounded top, 0.7 m up. */
    seatedEyeHeight: 1.38,
    walkSpeed: 4.3,
    sprintSpeed: 6.8,
    wadeSpeedMul: 0.55,
    groundAccel: 14,
    groundDecel: 18,
    airAccel: 2.5,
    gravity: 26,
    jumpHeight: 1.15,
    coyoteTime: 0.1,
    jumpBuffer: 0.12,
    stepDown: 0.45,
    maxSlope: 0.95,
    wadeDepth: 0.3,
    /** Water deeper than this lifts you off the bottom: you float with your feet this far below the surface. */
    swimDepth: 1.25,
    swimSpeed: 2.6,
    swimAccel: 6,
    maxSubstep: 1 / 120,
    reach: 3.1,
  },
  trees: {
    /** Axe hits needed to cut each log from a fallen trunk. */
    cutsPerLog: 2,
    /** Gap between the stump's edge and the base of the fallen trunk. */
    trunkOffset: 0.4,
  },
  skills: {
    /** Total XP needed to reach level 2, 3, ... 10. */
    thresholds: [10, 25, 45, 70, 100, 140, 190, 250, 320],
    xp: { gather: 1, fell: 2, log: 1, hit: 2, kill: 5, butcher: 1, cook: 3, craft: 3, build: 5, catch: 4, slip: 1, skin: 5, skinFail: 2 },
    /**
     * Values at level 1 -> level 10 (linear in between). Tool bonuses (`chopPowerBonus`, `huntDamageBonus`,
     * `catchBonus`) add to the matching tool upgrade's bonus on the same base, so a maxed skill and a fully upgraded
     * tool each carry about half of the combined effect (see `upgrades` below).
     */
    gatherBonusChance: [0, 0.4],
    /** Extra chop power (tree hits and trunk cuts per axe swing), from Gathering. */
    chopPowerBonus: [0, 0.5],
    huntDamageBonus: [0, 0.4],
    butcherBonusChance: [0, 0.5],
    burnChance: [0.2, 0],
    durabilityMultiplier: [1, 4],
    /** Chance that a hooked fish is landed rather than slipping off: `baseCatchChance` plus the skill and rod bonuses. */
    baseCatchChance: 0.35,
    catchBonus: [0, 0.35],
    maxCatchChance: 0.95,
    /** Chance a skinning cut takes the hide whole: the same start and climb as landing a fish, plus the knife's upgrades. */
    baseSkinChance: 0.35,
    skinBonus: [0, 0.35],
    maxSkinChance: 0.95,
  },
  /** Bonus per tool upgrade level I, II, III (index 0..2). */
  upgrades: {
    axe: { chopPower: [0.2, 0.4, 0.6] },
    spear: { damage: [0.15, 0.3, 0.45] },
    bow: { damage: [0.15, 0.3, 0.45], arrowSpeed: [0.08, 0.16, 0.25] },
    rod: { catch: [0.07, 0.14, 0.2] },
    knife: { skin: [0.07, 0.14, 0.2], damage: [0.15, 0.3, 0.45] },
    /** `burnCut`: share of the torch's burn-down rate saved; `warmth`: extra warmth target while held. */
    torch: { burnCut: [0.2, 0.4, 0.6], warmth: [3, 6, 9] },
  },
  fishing: {
    /** Seconds of holding left-click for a full-strength cast; shorter taps than `minCharge` don't cast. */
    fullCharge: 1.1,
    minCharge: 0.15,
    minCast: 3,
    maxCast: 14,
    flightSeconds: 0.55,
    /** Seconds between the lure settling and a bite. */
    biteWait: [2.5, 7],
    /** Seconds to click once a fish bites. */
    biteWindow: 0.9,
    /** Water at least this deep under the lure (below the surface) holds fish. */
    minDepth: 0.35,
    /** Walking this far past the longest cast reels the line in. */
    leashSlack: 6,
  },
  durability: {
    /** Durability at crafting level 1 (scaled by the crafting skill). Tools lose 1 per use plus `perHour` of slow decay. */
    tools: {
      axe: { uses: 40, perHour: 0.1 },
      spear: { uses: 25, perHour: 0.05 },
      bow: { uses: 30, perHour: 0.05 },
      torch: { uses: 60, perHour: 0.05, burnPerHour: 6 },
      rod: { uses: 30, perHour: 0.05 },
      knife: { uses: 30, perHour: 0.05 },
    },
    /** Shelters and benches weather `perHour` and wear `useCost` per sleep/sit. */
    structures: {
      leanTo: { max: 96, perHour: 0.5, useCost: 8 },
      aFrame: { max: 112, perHour: 0.5, useCost: 8 },
      barkHut: { max: 128, perHour: 0.5, useCost: 8 },
      hideTent: { max: 144, perHour: 0.5, useCost: 8 },
      bench: { max: 120, perHour: 0.5, useCost: 1 },
    },
    lowFraction: 0.25,
  },
  /** Mending a worn tool at the Repair Workbench, by the tool's upgrade level 0..III. */
  repair: {
    /** Share of the tool's crafting cost it takes, rounded up: always a small part, never the full cost. */
    costFraction: [0.15, 0.2, 0.25, 0.3],
    /** Seconds at the bench, standing still. */
    seconds: [4, 5.5, 7, 8.5],
  },
  carry: { baseSlots: 6, basketSlots: 4, backpackSlots: 6, canteenCapacity: 4 },
  fire: { initialFuelHours: 8, maxFuelHours: 16, stickFuelHours: 1.5, logFuelHours: 4, predatorSafeRadius: 9 },
  combat: {
    hand: { damage: 0.5, reach: 2.2, cooldown: 0.45 },
    axe: { damage: 1.5, reach: 2.6, cooldown: 0.55 },
    spear: { damage: 2.5, reach: 3.3, cooldown: 0.65 },
    torch: { damage: 0.6, reach: 2.4, cooldown: 0.55 },
    knife: { damage: 0.8, reach: 2.2, cooldown: 0.4 },
    bow: { minDraw: 0.18, fullDraw: 0.85, minSpeed: 16, maxSpeed: 42, minDamage: 0.6, maxDamage: 1.6, cooldown: 0.35 },
    arrowRecoverChance: 0.6,
    playerHurtInvuln: 0.4,
  },
  gather: { cooldown: 0.4 },
  /**
   * Cactus, yucca and agave spines. You are pricked when your body presses into a spiny plant's core: half your width
   * into a prickly pear, cholla, agave or a yucca that's ready to harvest (see `ResourceDef.spines`), or right up
   * against a saguaro, at most once per `cooldown` seconds.
   */
  spines: { cooldown: 1.1, touch: 0.5, saguaro: 4, saguaroGap: 0.06 },
  /**
   * Each gather from a desert stone pile has `chance` to turn up a scorpion (see `SPECIES.scorpion`), with at most
   * `max` out in the world at once. A pile only ever hides one: once it has turned one up, it never does again.
   */
  scorpion: { chance: 0.09, max: 4 },
  /**
   * On day 1 only the recipes the onboarding steps have reached can be crafted (see `lockedToday`); the rest unlock
   * tomorrow. False turns the limit off.
   */
  onboarding: { dayOneLimit: true as boolean },
  /** Thirst lost the one time you taste alkali water before you learn to recognise it. */
  water: { alkaliTasteThirst: 4 },
} as const;

export const GAME_HOURS_PER_REAL_SECOND = 24 / BALANCE.time.realSecondsPerDay;
