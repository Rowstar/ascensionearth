import cardsData from "../data/cards.json";
import artifactsData from "../data/artifacts.json";
import spellsData from "../data/spells.json";
import teachingsData from "../data/teachings.json";
import earthData from "../data/earth_advancements.json";
import { Rng } from "./rng";
import {
  DeckState,
  GameCardData,
  GameState,
  PlayerState,
  UiState,
  ArtifactData,
  SpellData,
  TeachingData,
  EarthAdvancementData,
  TeachingTier
} from "./types";

export interface DataStore {
  cards: GameCardData[];
  artifacts: ArtifactData[];
  spells: SpellData[];
  teachings: TeachingData[];
  teachingsByTier: Record<TeachingTier, TeachingData[]>;
  earthAdvancements: EarthAdvancementData[];
  cardsById: Record<string, GameCardData>;
  artifactsById: Record<string, ArtifactData>;
  spellsById: Record<string, SpellData>;
  teachingsById: Record<string, TeachingData>;
  earthAdvancementsById: Record<string, EarthAdvancementData>;
}

export const dataStore: DataStore = (() => {
  const cards = (cardsData as { cards: GameCardData[] }).cards;
  const artifacts = (artifactsData as { artifacts: ArtifactData[] }).artifacts;
  const spells = (spellsData as { spells: SpellData[] }).spells;
  const teachings = (teachingsData as { teachings: TeachingData[] }).teachings;
  const earthAdvancements = (earthData as { earthAdvancements: EarthAdvancementData[] }).earthAdvancements;
  const cardsById: Record<string, GameCardData> = {};
  const artifactsById: Record<string, ArtifactData> = {};
  const spellsById: Record<string, SpellData> = {};
  const teachingsById: Record<string, TeachingData> = {};
  const earthAdvancementsById: Record<string, EarthAdvancementData> = {};
  cards.forEach((card) => {
    cardsById[card.id] = card;
  });
  artifacts.forEach((artifact) => {
    artifactsById[artifact.id] = artifact;
  });
  spells.forEach((spell) => {
    spellsById[spell.id] = spell;
  });
  teachings.forEach((teaching) => {
    teachingsById[teaching.id] = teaching;
  });
  earthAdvancements.forEach((advancement) => {
    earthAdvancementsById[advancement.id] = advancement;
  });
  const teachingsByTier: Record<TeachingTier, TeachingData[]> = {
    basic: teachings.filter((teaching) => teaching.tier === "basic"),
    rare: teachings.filter((teaching) => teaching.tier === "rare"),
    mythic: teachings.filter((teaching) => teaching.tier === "mythic")
  };
  const store = {
    cards,
    artifacts,
    spells,
    teachings,
    teachingsByTier,
    earthAdvancements,
    cardsById,
    artifactsById,
    spellsById,
    teachingsById,
    earthAdvancementsById
  };
  const cosmicMismatch = store.cards.filter((card) =>
    card.category === "cosmic" && (card.teachingPower ?? card.basePower) !== card.basePower
  );
  if (cosmicMismatch.length > 0) {
    console.warn(
      "[Guardian Keystone] Cosmic cards should have teachingPower equal to basePower:",
      cosmicMismatch.map((card) => card.id)
    );
  }
  return store;
})();

function buildDecks(rng: Rng): DeckState {
  const game: string[] = [];

  // Locked: Reduce Cosmic card frequency to about half.
  // Implementation: include ONLY 3 Cosmic cards in the Game deck per game (random 3 of 5).
  const cosmicIds = dataStore.cards.filter((c) => c.category === "cosmic").map((c) => c.id);
  const selectedCosmics = new Set<string>(rng.shuffle([...cosmicIds]).slice(0, 3));
  dataStore.cards.forEach((card) => {
    if (card.category === "cosmic" && !selectedCosmics.has(card.id)) {
      return;
    }
    for (let i = 0; i < card.count; i += 1) {
      game.push(card.id);
    }
  });
  const spells: string[] = [];
  dataStore.spells.forEach((spell) => {
    const count = spell.count ?? 2;
    for (let i = 0; i < count; i += 1) {
      spells.push(spell.id);
    }
  });
  const artifacts: string[] = [];
  dataStore.artifacts.forEach((artifact) => {
    const count = artifact.count ?? 1;
    for (let i = 0; i < count; i += 1) {
      artifacts.push(artifact.id);
    }
  });
  const teachingsBasic: string[] = [];
  dataStore.teachingsByTier.basic.forEach((teaching) => {
    const count = teaching.count ?? 2;
    for (let i = 0; i < count; i += 1) {
      teachingsBasic.push(teaching.id);
    }
  });
  const teachingsRare: string[] = [];
  dataStore.teachingsByTier.rare.forEach((teaching) => {
    const count = teaching.count ?? 1;
    for (let i = 0; i < count; i += 1) {
      teachingsRare.push(teaching.id);
    }
  });
  const teachingsMythic: string[] = [];
  dataStore.teachingsByTier.mythic.forEach((teaching) => {
    const count = teaching.count ?? 1;
    for (let i = 0; i < count; i += 1) {
      teachingsMythic.push(teaching.id);
    }
  });
  const earthAdvancementsT1 = dataStore.earthAdvancements.filter((c) => c.tier === 1).map((c) => c.id);
  const earthAdvancementsT2 = dataStore.earthAdvancements.filter((c) => c.tier === 2).map((c) => c.id);
  const earthAdvancementsT3 = dataStore.earthAdvancements.filter((c) => c.tier === 3).map((c) => c.id);

  return {
    game: rng.shuffle(game),
    spells: rng.shuffle(spells),
    artifacts: rng.shuffle(artifacts),
    teachingsBasic: rng.shuffle(teachingsBasic),
    teachingsRare: rng.shuffle(teachingsRare),
    teachingsMythic: rng.shuffle(teachingsMythic),
    earthAdvancementsT1: rng.shuffle(earthAdvancementsT1),
      earthAdvancementsT2: rng.shuffle(earthAdvancementsT2),
      earthAdvancementsT3: rng.shuffle(earthAdvancementsT3),
    discardGame: [],
    discardSpells: [],
    discardTeachingsBasic: []
  };
}

function drawStarterGameCard(deck: string[]): string | undefined {
  const idx = deck.findIndex((id) => dataStore.cardsById[id]?.category !== "cosmic");
  if (idx < 0) {
    return undefined;
  }
  const [card] = deck.splice(idx, 1);
  return card;
}

export function createEmptyUiState(): UiState {
  return {
    screen: "MENU",
    seedInput: "",
    seedEditing: false,
    selectedAction: undefined,
    selectedCards: [],
    selectedFaceDown: undefined,
    pendingSpellId: undefined,
    pendingEscalationCardIndex: undefined,
    showRules: false,
    menuOpen: false,
    logOpen: true,
    logScroll: 0,
    handScroll: 0,
    handTab: "ALL",
    shopOpen: false,
    shopTab: "CARDS",
    challengeResult: undefined,
    challengeResultMode: "verdict",
    challengeResultTab: "POWER",
    challengeResultPlayerId: undefined,
    progressReview: undefined,
    endgameEvaluation: undefined,
    pendingThirdEyeSelection: undefined,
    tooltip: undefined,
    lastHoverId: undefined,
    pendingSell: undefined,
    selectedEarthTier: 1,
    debugEnabled: false,
    soundEnabled: true,
    musicEnabled: true,
    musicVolume: 45,
    motionEnabled: true,
    particleQuality: "med",
    menuMouseParallaxEnabled: true,
    artifactScroll: 0,
    earthScroll: 0,
    challengeLogScroll: 0,
    challengeFlashText: undefined,
    challengeFlashTimerMs: 0,
    turnToast: null,
    gameOverTab: "SUMMARY",
    aiStatus: null,
    activeHighlightPlayerId: null,
    activeHighlightScope: null,
    spellScroll: 0,
    teachingScroll: 0
  };
}

const AI_AVATARS = ["🌞", "🌙", "⭐", "🔥", "💧", "🌿", "🌀", "💎", "🦋", "🐉", "🦅", "🌊", "🌲", "⚡", "🌺", "🍃"];
const HUMAN_AVATARS = ["🧙", "🧝", "🧚", "🧛", "🧜", "🧞", "🧟", "👤", "🎭", "🗿"];

function getRandomAvatar(rng: Rng, isAI: boolean): string {
  const pool = isAI ? AI_AVATARS : HUMAN_AVATARS;
  return pool[Math.floor(rng.next() * pool.length)] ?? pool[0] ?? "👤";
}

export function createNewGame(seed: string): GameState {
  const rng = new Rng(seed || "ascension-earth");
  const decks = buildDecks(rng);
  const players: PlayerState[] = [
    {
      id: "p1",
      name: "You",
      avatar: getRandomAvatar(rng, false),
      isAI: false,
      hand: [],
      spells: [],
      artifacts: [],
      teachings: [],
      passiveTeachings: [],
      crystals: 0,
      bonusAp: 0,
      worldseedStatus: undefined,
      earthAdvancementsT1: [],
      earthAdvancementsT2: [],
      earthAdvancementsT3: [],
      tempDiceBonus: 0,
      pendingChallengeDiceBonus: 0,
      activeChallengeDiceBonus: 0,
      activeChallengeKey: undefined,
      lastJourneyId: undefined,
      lastJourneyTurn: undefined,
      worldseedActivationTurn: undefined,
      worldseedMeditationTurn: undefined,
      lastMeditateTurn: undefined,
      purchasesThisTurn: 0,
      purchasesCardThisTurn: 0,
      purchasesSpellThisTurn: 0,
      doctrineHalfPriceAvailable: false,
      transmutationFocusSalesThisTurn: 0,
      transmutationFocusUsedTurn: undefined,
      generatedInvocations: []
      ,
      reviewBaselineForgiveness: 0,
      reviewApBonus: 0,
      bonusCrystalEveryRounds: undefined,
      runChallengesEntered: 0,
      runChallengesWon: 0,
      runCrystalsSpent: 0,
      runTrophiesWon: 0
    },
    {
      id: "p2",
      name: "AI Sol",
      avatar: getRandomAvatar(rng, true),
      isAI: true,
      hand: [],
      spells: [],
      artifacts: [],
      teachings: [],
      passiveTeachings: [],
      crystals: 0,
      bonusAp: 0,
      worldseedStatus: undefined,
      earthAdvancementsT1: [],
      earthAdvancementsT2: [],
      earthAdvancementsT3: [],
      tempDiceBonus: 0,
      pendingChallengeDiceBonus: 0,
      activeChallengeDiceBonus: 0,
      activeChallengeKey: undefined,
      lastJourneyId: undefined,
      lastJourneyTurn: undefined,
      worldseedActivationTurn: undefined,
      worldseedMeditationTurn: undefined,
      lastMeditateTurn: undefined,
      purchasesThisTurn: 0,
      purchasesCardThisTurn: 0,
      purchasesSpellThisTurn: 0,
      doctrineHalfPriceAvailable: false,
      transmutationFocusSalesThisTurn: 0,
      transmutationFocusUsedTurn: undefined,
      generatedInvocations: []
      ,
      reviewBaselineForgiveness: 0,
      reviewApBonus: 0,
      bonusCrystalEveryRounds: undefined,
      runChallengesEntered: 0,
      runChallengesWon: 0,
      runCrystalsSpent: 0,
      runTrophiesWon: 0
    },
    {
      id: "p3",
      name: "AI Luna",
      avatar: getRandomAvatar(rng, true),
      isAI: true,
      hand: [],
      spells: [],
      artifacts: [],
      teachings: [],
      passiveTeachings: [],
      crystals: 0,
      bonusAp: 0,
      worldseedStatus: undefined,
      earthAdvancementsT1: [],
      earthAdvancementsT2: [],
      earthAdvancementsT3: [],
      tempDiceBonus: 0,
      pendingChallengeDiceBonus: 0,
      activeChallengeDiceBonus: 0,
      activeChallengeKey: undefined,
      lastJourneyId: undefined,
      lastJourneyTurn: undefined,
      worldseedActivationTurn: undefined,
      worldseedMeditationTurn: undefined,
      lastMeditateTurn: undefined,
      purchasesThisTurn: 0,
      purchasesCardThisTurn: 0,
      purchasesSpellThisTurn: 0,
      doctrineHalfPriceAvailable: false,
      transmutationFocusSalesThisTurn: 0,
      transmutationFocusUsedTurn: undefined,
      generatedInvocations: []
      ,
      reviewBaselineForgiveness: 0,
      reviewApBonus: 0,
      bonusCrystalEveryRounds: undefined,
      runChallengesEntered: 0,
      runChallengesWon: 0,
      runCrystalsSpent: 0,
      runTrophiesWon: 0
    }
  ];

  for (const player of players) {
    for (let i = 0; i < 3; i += 1) {
      const card = drawStarterGameCard(decks.game);
      if (card) {
        player.hand.push(card);
      }
    }
  }

  const state: GameState = {
    seed: seed || "ascension-earth",
    turn: 1,
    maxTurns: 10,
    earthAscensionPower: 0,
    earthAscensionTarget: 999,
    guardianKeystones: {
      cave: { progress: 0, rareUnlocked: false, mythicUnlocked: false, crystalTier1Claimed: false, crystalTier2Claimed: false },
      mountain: { progress: 0, rareUnlocked: false, mythicUnlocked: false, crystalTier1Claimed: false, crystalTier2Claimed: false }
    },
    settings: {
      gameSpeedMode: "NORMAL"
    },
    phase: "ROLL_POOLS",
    players,
    rewardPools: {},
    decks,
    log: ["New game begins."],
    lastTurnStartGains: {},
    previousTurnRewards: {},
    pendingChallenges: [],
    challenge: undefined,
    hotseatReveal: false,
    ui: {
      ...createEmptyUiState(),
      screen: "MATCH",
      seedInput: seed || "ascension-earth"
    },
    shopOfferings: { cards: [], invocations: [] },
    aiQueue: [],
    aiActive: undefined,
    aiPendingReveal: false,
    reviewHistory: [],
    trophyCooldowns: {}
  };

  return state;
}
