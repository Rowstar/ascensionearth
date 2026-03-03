export type CardColor = "Grey" | "Blue" | "Gold";
export type CardTag = "Plant" | "Animal" | "Human" | "Cosmic";
export type CardCategory = "game" | "cosmic";

export interface GameCardData {
  id: string;
  name: string;
  category: CardCategory;
  basePower: number;
  teachingPower?: number;
  color: CardColor;
  tags: CardTag[];
  count: number;
}

export interface ArtifactData {
  id: string;
  name: string;
  value: number;
  effect: ArtifactEffect;
  description: string;
  rulesText?: string;
  triggers?: EffectTrigger[];
  count?: number;
}

export interface SpellData {
  id: string;
  name: string;
  value: number;
  effect: SpellEffect;
  description: string;
  rulesText?: string;
  onCast?: string;
  count?: number;
}

export type TeachingTier = "basic" | "rare" | "mythic";

export interface TeachingData {
  id: string;
  name: string;
  tier: TeachingTier;
  effect: TeachingEffect;
  value: number;
  permanentBonus?: number;
  preparationBonus?: number;
  sellValue?: number;
  unique?: boolean;
  description: string;
  rulesText?: string;
  onPlay?: string;
  triggers?: EffectTrigger[];
  count?: number;
}

export type EarthCardRarity = "common" | "uncommon" | "rare" | "cosmic";

export interface EarthAdvancementRequirements {
  crystals: number;
  artifacts?: number;
  spells?: number;
  invocations?: number;
  cardsAny?: number;
  cardsByRarity?: Partial<Record<EarthCardRarity, number>>;
}

export interface EarthAdvancementData {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  requirements: EarthAdvancementRequirements;
  apReward: number;
  passiveBuff?: TrophyPassiveBuff;
}

export type TrophyPassiveBuffKind =
  | "BASELINE_FORGIVENESS"
  | "REVIEW_AP_BONUS"
  | "CRYSTAL_DRIP";

export interface TrophyPassiveBuff {
  kind: TrophyPassiveBuffKind;
  amount: number;
  everyRounds?: number;
  description: string;
}

export interface TrophyChoice {
  id: string;
  name: string;
  shortDescription: string;
  rewardAp: number;
  passiveBuff?: TrophyPassiveBuff;
  currentLeaderPlayerId?: string;
  winnerExplanation?: string;
}

export interface ProgressReviewBaseline {
  minCrystals: number;
  minTeachings: number;
}

export interface ProgressReviewState {
  reviewRound: number;
  categoryId: string;
  categoryName: string;
  baseline: ProgressReviewBaseline;
  baselinePasserIds: string[];
  winnerPlayerId?: string;
  winnerExplanation: string;
  trophyOptions: TrophyChoice[];
  selectedTrophyId?: string;
  selectedByPlayerId?: string;
  selectedRewardAp?: number;
  selectedPassiveBuffText?: string;
  resolved: boolean;
}

export interface EvaluationCategoryResult {
  id: "WISDOM" | "BALANCE" | "DISCIPLINE";
  title: string;
  metricLabel: string;
  winnerPlayerId?: string;
  winnerExplanation: string;
  rewardAp: number;
  passiveBuffText?: string;
}

export interface EndgameEvaluationState {
  round: number;
  categories: EvaluationCategoryResult[];
  totalApGranted: number;
}

export type ArtifactEffect =
  | "mystic_orb"
  | "spell_staff"
  | "giant_crystal"
  | "lucky_beads"
  | "stone_of_balance"
  | "reincarnation_crystal"
  | "sacred_plant_seed"
  | "magnetic_crystal"
  | "spirit_totem"
  | "extra_terrestrial_artifact"
  | "crystal_seeker_goggles"
  | "mysterious_totem"
  | "cosmic_robes"
  | "verdant_seed_pod"
  | "celestial_compass"
  | "ancestors_drum"
  | "crown_of_stars"
  | "mentors_medallion"
  | "tome_of_enlightenment"
  | "scroll_of_wisdom"
  | "elders_signet";

export type SpellEffect =
  | "empower_the_meek"
  | "channel_group_energy"
  | "tribal_spirits"
  | "third_eye_awakening"
  | "resonant_amplifier"
  | "confluence_of_voices"
  | "wisdoms_harvest"
  | "inner_reflection"
  | "scholars_focus"
  | "threshold_surge";

export type TeachingEffect =
  | "basic_teaching_boost"
  | "centered_resolve"
  | "affinity_bonus"
  | "earned_acknowledgement"
  | "favourable_exchange"
  | "pilgrims_insight"
  | "triune_expression"
  | "emergent_convergence"
  | "total_commitment"
  | "worldseed_awakening"
  | "veil_of_uncertainty"
  | "false_signal"
  | "ledger_of_the_unseen"
  | "ritual_continuance"
  | "transmutation_of_focus"
  | "doctrine_of_abundance"
  | "lantern_of_the_unseen"
  | "echoes_in_the_stone"
  | "breath_of_the_summit"
  | "crown_of_endurance"
  | "cosmic_affinity"
  | "rooted_patience"
  | "symbiotic_harmony"
  | "convergence_of_paths"
  | "awakened_instinct"
  | "human_affinity"
  | "plant_affinity"
  | "animal_affinity"
  | "wisdom_of_low_cards"
  | "teachers_insight"
  | "path_of_knowledge"
  | "threshold_mastery";

export type EffectEvent =
  | "spell_cast"
  | "teaching_played"
  | "teaching_gained"
  | "challenge_setup"
  | "challenge_after_commit"
  | "challenge_totals"
  | "challenge_resolve"
  | "reward_pool_applied"
  | "meditate"
  | "gain_teaching"
  | "dice_bonus"
  | "sell_item"
  | "earth_advancement_purchase"
  | "card_committed";

export type EffectTrigger = {
  event: EffectEvent;
  handler: string;
  oncePerTurn?: boolean;
  oncePerChallenge?: boolean;
};

export type RewardKind = "crystal" | "gameCard" | "artifact" | "spell";

export type TPThresholdTier = "basic" | "rare" | "mythic";

export interface RewardItem {
  id?: string;
  kind: RewardKind;
  count?: number;
  cardId?: string;
  baseCostPerParticipant?: number;
  finalCost?: number;
  isUnlocked?: boolean;
  isClaimed?: boolean;
  claimedByPlayerId?: string;
}

export interface RewardPool {
  id: "MOUNTAIN" | "CAVE";
  dice: number[];
  rewards: RewardItem[];
}

export type ActionChoice = "MEDITATE" | "MOUNTAIN" | "CAVE" | "EARTH";

export type GameSpeedMode = "NORMAL" | "FAST" | "INSTANT";

export type ParticleQuality = "low" | "med" | "high";

export type GameSettings = {
  gameSpeedMode: GameSpeedMode;
};

export type Phase =
  | "ROLL_POOLS"
  | "ACTION_SELECT"
  | "ACTION_REVEAL"
  | "CHALLENGE"
  | "EVALUATION"
  | "TURN_END"
  | "GAME_OVER";

export type UiFocusMode = "ACTION_SELECT" | "CHALLENGE" | "RESULTS" | "EARTH_CHAMBER";

export type FocusDrawerTab = "INVENTORY" | "TEACHINGS" | "ARTIFACTS" | "LOG";

export type ChallengePhase =
  | "SETUP"
  | "ROLL_ORDER"
  | "COMMIT_TURNS"
  | "REVEAL"
  | "RESOLVE"
  | "REWARDS"
  | "DRAFT";

export type AiActionScope = "BOARD" | "SHOP" | "CHALLENGE";

export type AiActionKind =
  | "AI_SHOP_BUY_CARD"
  | "AI_SHOP_BUY_SPELL"
  | "AI_SELECT_ACTION"
  | "AI_COMMIT_CHALLENGE";

export type AiQueuedAction = {
  playerId: string;
  label: string;
  scope: AiActionScope;
  kind: AiActionKind;
  payload?: Record<string, unknown>;
  remainingMs: number;
};

export interface PlayerState {
  id: string;
  name: string;
  avatar: string;
  isAI: boolean;
  hand: string[];
  spells: string[];
  artifacts: string[];
  teachings: string[];
  passiveTeachings: string[];
  crystals: number;
  bonusAp?: number;
  earthAdvancementsT1: string[];
  earthAdvancementsT2: string[];
  earthAdvancementsT3: string[];
  action?: ActionChoice;
  earthTierChoice?: 1 | 2 | 3;
  locked?: boolean;
  tempDiceBonus?: number;
  pendingChallengeDiceBonus?: number;
  activeChallengeDiceBonus?: number;
  activeChallengeKey?: string;
  /** Last turn this player took the MEDITATE action. */
  lastMeditateTurn?: number;
  /** Basic teachings that have been consumed (for permanent meditation bonuses). */
  consumedBasicTeachings?: string[];
  /** Basic teachings whose one-time meditation bonus has been consumed. */
  usedTeachingOneTimeBonus?: string[];
  lastJourneyId?: "MOUNTAIN" | "CAVE";
  lastJourneyTurn?: number;
  worldseedStatus?: "dormant" | "pending" | "active";
  worldseedActivationTurn?: number;
  worldseedMeditationTurn?: number;
  /** Shop purchases made this turn (limit enforced in shop). */
  purchasesThisTurn?: number;
  purchasesCardThisTurn?: number;
  purchasesSpellThisTurn?: number;
  doctrineHalfPriceAvailable?: boolean;
  transmutationFocusSalesThisTurn?: number;
  transmutationFocusUsedTurn?: number;
  generatedInvocations?: string[];
  /** Total spells cast in the whole game (for achievements). */
  spellsCast?: number;
  /** AI memory: outcome of last challenge ('won' | 'lost' | 'withdrew'). */
  lastChallengeOutcome?: "won" | "lost" | "withdrew";
  /** Rooted Patience teaching: once-per-game flag. */
  rootedPatienceUsed?: boolean;
  /** Effect trigger flags to prevent duplicate firing. */
  effectFlags?: Record<string, { turn?: number; challengeKey?: string }>;
  /** Progress Review passive: reduce baseline thresholds by this amount. */
  reviewBaselineForgiveness?: number;
  /** Progress Review passive: bonus AP whenever this player gains trophy AP. */
  reviewApBonus?: number;
  /** Progress Review passive: gain +1 Crystal every N rounds (tiny drip). */
  bonusCrystalEveryRounds?: number;
  /** Run metric: number of challenges entered this game. */
  runChallengesEntered?: number;
  /** Run metric: number of challenge wins this game. */
  runChallengesWon?: number;
  /** Run metric: crystals spent this game. */
  runCrystalsSpent?: number;
  /** Run metric: trophies won this game. */
  runTrophiesWon?: number;
}

export interface DeckState {
  game: string[];
  spells: string[];
  artifacts: string[];
  teachingsBasic: string[];
  teachingsRare: string[];
  teachingsMythic: string[];
  earthAdvancementsT1: string[];
  earthAdvancementsT2: string[];
  earthAdvancementsT3: string[];
  discardGame: string[];
  discardSpells: string[];
  discardTeachingsBasic: string[];
}

export type GuardianKeystoneTrack = {
  progress: number;
  rareUnlocked: boolean;
  mythicUnlocked: boolean;
  crystalTier1Claimed: boolean;
  crystalTier2Claimed: boolean;
};

export type GuardianKeystones = {
  cave: GuardianKeystoneTrack;
  mountain: GuardianKeystoneTrack;
};

export interface PlayedCards {
  selected: string[];
  faceDownId?: string;
  spellsPlayed: string[];
  committedItems?: Array<{ kind: "card" | "spell"; id: string }>;
  // Meditation stacks banked into this Journey (consumed when the challenge is created).
  teachingMeditationStacks?: number;
  beat1Cards: string[];
  beat2Cards: string[];
  beat1InvocationId?: string | null;
  beat2InvocationId?: string | null;
  beat1Spells: string[];
  beat2Spells: string[];
  teachingsPlayed: string[];
  extraCards: string[];
  /** Provenance for each extra card (e.g. "Invocation: Tribal Spirits"). */
  extraCardSources?: Record<string, string>;
  /** Artifact effects that successfully triggered during this challenge. */
  artifactEffects?: string[];
  powerBonus: number;
  powerBonusBreakdown?: Array<{ label: string; amount: number; source: "invocation" | "teaching" | "artifact" }>;
  empowerMeek: boolean;
  empowerMeekMultiplier?: number;
  channelGroupEnergy: boolean;
  channelGroupEnergyMultiplier?: number;
  thirdEye: boolean;
  resonantAmplifierActive?: boolean;
  confluenceVoices?: boolean;
  confluenceVoicesMultiplier?: number;
  ritualContinuanceUsed?: boolean;
  invocationsCastCount?: number;
  invocationsCastQualifyingCount?: number;
  echoesInStoneUsed?: boolean;
  echoesInStoneSecondUsed?: boolean;
  firstCommittedCardId?: string;
  rewardThresholdsReached?: number;
  grounding: boolean;
  groundingValue: number;
  revealAllFaceDown: boolean;
  hiddenCardIds?: string[];
  revealedHiddenCardIds?: string[];
  reduceAllOpponents: number;
  emergentConvergenceUsed?: boolean;
  totalCommitmentGranted?: boolean;
  worldseedRitualTriggered?: boolean;
  removedFromGameCards?: string[];
  finalCardPowers?: Array<{ cardId: string; power: number }>;
}

export interface ChallengeState {
  id: "MOUNTAIN" | "CAVE";
  journeyType: "cave" | "mountain" | null;
  phase: ChallengePhase;
  participants: string[];
  rolls: Record<string, number | null>;
  turnOrder: string[];
  activeTurnIndex: number;
  logEntries: string[];
  contestants: string[];
  order: string[];
  folded: string[];
  played: Record<string, PlayedCards>;
  rewardPool?: RewardPool;
  revealedEarly: Array<{ playerId: string; cardId: string }>;
  rollQueue?: string[];
  revealIndex?: number;
  resolveIndex?: number;
  phaseTimerMs?: number;
  totals?: Record<string, number>;
  resolvedTotals?: Record<string, number>;
  aiPending?: boolean;
  /** True while waiting for the human player to close the initiative popup and start commit turns. */
  initiativePaused?: boolean;
  /** Sequential beat counter for the new one-card-per-turn flow. */
  beatCount?: number;
  /** Number of consecutive PASS actions in commit phase. When >= contestants, commit ends. */
  passesInRow?: number;
  apContributionByPlayer?: Record<string, number>;
  totalGroupAp?: number;
  /** Per-player TP accumulated within this challenge (resets each challenge). */
  challengeTPByPlayer?: Record<string, number>;
  /** Per-player record of which TP thresholds have been awarded. */
  challengeTPThresholdsAwarded?: Record<string, { basic: boolean; rare: boolean; mythic: boolean }>;
  draft?: {
    isDraftPhase: boolean;
    pickOrderPlayerIds: string[];
    currentPickIndex: number;
  };
  metrics?: {
    apEarnedSoFar: number;
    teachingPowerPlayedSoFar: number;
  };
}

export interface PendingChallenge {
  id: "MOUNTAIN" | "CAVE";
  contestants: string[];
  rewardPool?: RewardPool;
}

export interface UiState {
  screen: "MENU" | "MATCH";
  seedInput: string;
  seedEditing: boolean;
  selectedAction?: ActionChoice;
  selectedCards: number[];
  selectedFaceDown?: number;
  pendingSpellId?: string;
  pendingEscalationCardIndex?: number;
  showRules: boolean;
  menuOpen?: boolean;
  logOpen?: boolean;
  logScroll?: number;
  handScroll?: number;
  handTab?: "ALL" | "CARDS" | "INVOCATIONS" | "SPELLS";
  challengeResult?: ChallengeResult;
  challengeResultMode?: "verdict" | "details";
  challengeResultTab?: "POWER" | "PLAYED" | "REWARDS";
  challengeResultPlayerId?: string;
  progressReview?: ProgressReviewState;
  endgameEvaluation?: EndgameEvaluationState;
  pendingThirdEyeSelection?: {
    casterId: string;
    targets: Array<{ playerId: string; cardId: string }>;
  };
  tooltip?: string;
  lastHoverId?: string;
  pendingSell?: {
    kind: "HAND_CARD" | "SPELL" | "ARTIFACT" | "TEACHING";
    index: number;
    label: string;
    crystals: number;
  };
  selectedEarthTier?: 1 | 2 | 3;
  shopOpen?: boolean;
  earthShopOpen?: boolean;
  shopTab?: "CARDS" | "SPELLS";
  debugEnabled?: boolean;
  soundEnabled?: boolean;
  musicEnabled?: boolean;
  musicVolume?: number;
  motionEnabled?: boolean;
  particleQuality?: ParticleQuality;
  menuMouseParallaxEnabled?: boolean;
  focusDrawerOpen?: boolean;
  focusDrawerTab?: FocusDrawerTab;
  focusModeOverride?: UiFocusMode;
  devPanelTab?: "TEACHINGS" | "ARTIFACTS";
  devPanelScroll?: number;
  artifactScroll?: number;
  earthScroll?: number;
  challengeLogScroll?: number;
  challengeFlashText?: string;
  challengeFlashTimerMs?: number;
  turnToast?: { title: string; lines: string[]; expiresAt: number } | null;
  gameOverTab?: "SUMMARY" | "ACHIEVEMENTS";
  challengeAutoPlay?: boolean;
  confirmWithdraw?: boolean;
  aiStatus?: {
    playerId: string;
    message: string;
    isThinking: boolean;
    startedAt: number;
  } | null;
  activeHighlightPlayerId?: string | null;
  activeHighlightScope?: AiActionScope | null;
  spellScroll?: number;
  teachingScroll?: number;
  challengeLogExpanded?: boolean;
  saveWarning?: string;
}

export type ChallengeRewardDelta = {
  crystals?: number;
  ap?: number;
  teachings?: string[];
  spells?: string[];
  artifacts?: string[];
  cards?: string[];
};



export type TurnRewardInfo = {
  crystals?: number;
  cards?: string[];
  spells?: string[];
  artifacts?: string[];
  teachings?: string[];
};

export type ChallengeParticipantResult = {
  playerId: string;
  playerName: string;
  playerAvatar: string;
  outcome: "DRAW";
  withdrew?: boolean;
  totalPower: number;
  challengeTP?: number;
  tpTeachingsGained?: string[];
  cardsPlayed: string[];
  artifactEffects?: string[];
  delta: ChallengeRewardDelta;

  // Locked: Results screen must clearly show how totals were formed.
  // - powerBreakdown: itemized challenge power contributions (cards + bonuses; spells listed as modifiers)
  // - apBreakdown: itemized Ascension Power (score) changes for this result
  // - rewardBreakdown: rewards with provenance labels (challenge reward, draft pick, etc.)
  powerBreakdown?: string[];
  apBreakdown?: string[];
  rewardBreakdown?: string[];
};

export type ChallengeResult = {
  id: string;
  turn: number;
  challengeName: string;
  journeyType: "cave" | "mountain" | null;
  participants: ChallengeParticipantResult[];
  keystoneProgress?: { type: "cave" | "mountain"; gained: number; totalBefore: number; totalAfter: number };
};

export interface GameState {
  seed: string;
  rngState?: number;
  turn: number;
  maxTurns: number;
  earthAscensionPower: number;
  earthAscensionTarget: number;
  ascensionCapReachedAnnounced?: boolean;
  guardianKeystones: GuardianKeystones;
  settings: GameSettings;
  phase: Phase;
  players: PlayerState[];
  rewardPools: {
    mountain?: RewardPool;
    cave?: RewardPool;
  };
  decks: DeckState;
  log: string[];
  lastTurnStartGains: Record<string, string[]>;
  /** Rewards gained from previous turn's meditation/journey/challenge (shown in turn start popup) */
  previousTurnRewards: Record<string, {
    meditation?: { teachings: number; invocations: number; cards: number };
    keystone?: { type: "cave" | "mountain"; reward: string };
    journey?: { cards: number; invocations: number; artifacts: number; crystals: number; teachings: number };
    challengeTeachings?: { basic: number; rare: number; mythic: number };
  }>;
  pendingChallenges: PendingChallenge[];
  challenge?: ChallengeState;
  hotseatReveal: boolean;
  ui: UiState;
  shopOfferings: { cards: string[]; invocations: string[] };
  aiQueue: AiQueuedAction[];
  aiActive?: AiQueuedAction;
  aiPendingReveal?: boolean;
  reviewHistory: ProgressReviewState[];
  trophyCooldowns: Record<string, number>;
}

export type GameAction =
  | { type: "SET_SEED"; seed: string }
  | { type: "SET_SEED_EDITING"; editing: boolean }
  | { type: "START_GAME" }
  | { type: "GO_MENU" }
  | { type: "TOGGLE_RULES" }
  | { type: "TOGGLE_HOTSEAT" }
  | { type: "TOGGLE_MENU" }
  | { type: "TOGGLE_LOG" }
  | { type: "TOGGLE_DEBUG" }
  | { type: "TOGGLE_SOUND" }
  | { type: "TOGGLE_MUSIC" }
  | { type: "SET_MUSIC_VOLUME"; value: number }
  | { type: "TOGGLE_MOTION" }
  | { type: "CYCLE_PARTICLE_QUALITY" }
  | { type: "TOGGLE_MENU_MOUSE_PARALLAX" }
  | { type: "UI_TOGGLE_FOCUS_DRAWER" }
  | { type: "UI_SET_FOCUS_DRAWER_OPEN"; value: boolean }
  | { type: "UI_SET_FOCUS_DRAWER_TAB"; tab: FocusDrawerTab }
  | { type: "UI_SET_FOCUS_MODE_OVERRIDE"; mode?: UiFocusMode }
  | { type: "UI_CYCLE_FOCUS_MODE_OVERRIDE" }
  | { type: "SET_GAME_SPEED"; mode: GameSpeedMode }
  | { type: "CYCLE_GAME_SPEED" }
  | {
      type: "APPLY_PREFERENCES";
      prefs: {
        soundEnabled?: boolean;
        musicEnabled?: boolean;
        musicVolume?: number;
        gameSpeedMode?: GameSpeedMode;
        motionEnabled?: boolean;
        particleQuality?: ParticleQuality;
        menuMouseParallaxEnabled?: boolean;
      };
    }
  | { type: "AI_TICK"; dt: number }
  | { type: "UI_SET_AI_STATUS"; payload: { playerId: string; message: string; isThinking: boolean; startedAt: number } }
  | { type: "UI_CLEAR_AI_STATUS" }
  | { type: "UI_SET_ACTIVE_HIGHLIGHT"; payload: { playerId: string; scope: AiActionScope } }
  | { type: "UI_CLEAR_ACTIVE_HIGHLIGHT" }
  | { type: "ADD_LOG"; text: string }
  | { type: "SET_LOG_SCROLL"; value: number }
  | { type: "SET_SPELL_SCROLL"; value: number }
  | { type: "SET_TEACHING_SCROLL"; value: number }
  | { type: "SET_CHALLENGE_LOG_SCROLL"; value: number }
  | { type: "SET_ARTIFACT_SCROLL"; value: number }
  | { type: "SET_EARTH_SCROLL"; value: number }
  | { type: "SET_HAND_SCROLL"; value: number }
  | { type: "SET_HAND_TAB"; tab: "ALL" | "CARDS" | "INVOCATIONS" | "SPELLS" }
  | { type: "SET_DEV_TAB"; tab: "TEACHINGS" | "ARTIFACTS" }
  | { type: "SET_DEV_SCROLL"; value: number }
  | { type: "DEV_GRANT_TEACHING"; id: string }
  | { type: "DEV_GRANT_ARTIFACT"; id: string }
  | { type: "CHALLENGE_TICK"; dt: number }
  | { type: "FAST_FORWARD_CHALLENGE" }
  | { type: "CHALLENGE_AUTO_PLAY" }
  | { type: "CHALLENGE_RESUME_INITIATIVE" }
  | { type: "TOGGLE_CHALLENGE_LOG" }
  | { type: "UI_SET_CHALLENGE_RESULT"; result: ChallengeResult }
  | { type: "UI_CLEAR_CHALLENGE_RESULT" }
  | { type: "UI_SET_CHALLENGE_RESULT_MODE"; mode: "verdict" | "details" }
  | { type: "UI_SET_CHALLENGE_RESULT_TAB"; tab: "POWER" | "PLAYED" | "REWARDS" }
  | { type: "UI_SET_CHALLENGE_RESULT_PLAYER"; playerId: string }
  | { type: "UI_SET_GAME_OVER_TAB"; tab: "SUMMARY" | "ACHIEVEMENTS" }
  | { type: "UI_CLOSE_EVALUATION" }
  | { type: "UI_SELECT_TROPHY"; trophyId: string }
  | { type: "UI_CLOSE_PROGRESS_REVIEW" }
  | { type: "UI_RESOLVE_THIRD_EYE_TARGET"; targetPlayerId: string; targetCardId: string }
  | { type: "UI_REQUEST_SELL"; kind: "HAND_CARD" | "SPELL" | "ARTIFACT" | "TEACHING"; index: number }
  | { type: "UI_CANCEL_SELL" }
  | { type: "UI_CONFIRM_SELL" }
  | { type: "UI_SET_WITHDRAW_CONFIRM"; value: boolean }
  | { type: "UI_CLEAR_TURN_TOAST" }
  | { type: "ROLL_POOLS" }
  | { type: "SELECT_ACTION"; action: ActionChoice }
  | { type: "CLEAR_SELECTED_ACTION" }
  | { type: "CONFIRM_ACTION" }
  | { type: "LOCK_ACTIONS" }
  | { type: "SELECT_CARD"; cardIndex: number }
  | { type: "SET_FACE_DOWN"; cardIndex?: number }
  | { type: "SET_PENDING_SPELL"; spellId?: string }
  | { type: "SET_PENDING_ESCALATION_CARD"; cardIndex?: number }
  | { type: "LOCK_CARDS" }
  | { type: "ADD_ESCALATION_CARD"; cardIndex: number }
  | { type: "FOLD_CHALLENGE" }
  | { type: "PLAY_SPELL"; spellId: string }
  | { type: "PLAY_TEACHING"; teachingId: string }
  | { type: "PASS_SPELL" }
  | { type: "SET_EARTH_TIER"; tier: 1 | 2 | 3 }
  | { type: "END_TURN" }
  | { type: "NEXT_CHALLENGE" }
  | { type: "CHALLENGE_DRAFT_PICK"; rewardId: string }
  | { type: "LOAD_GAME"; state: GameState }
  | { type: "TOGGLE_SHOP" }
  | { type: "TOGGLE_EARTH_SHOP" }
  | { type: "SET_SHOP_TAB"; tab: "CARDS" | "SPELLS" }
  | { type: "BUY_SHOP_CARD"; cardId: string }
  | { type: "BUY_SHOP_SPELL"; spellId: string };


export type TeachingRollSource = {
  sourceType: 'gameCard' | 'invocation';
  sourceId: string;
  ap: number;
};
