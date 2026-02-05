import { Rng } from "./rng";
import {
  ActionChoice,
  ChallengeResult,
  ChallengeRewardDelta,
  ChallengeState,
  EarthCardRarity,
  EarthAdvancementData,
  GameState,
  PendingChallenge,
  PlayerState,
  RewardKind,
  RewardItem,
  RewardPool
} from "./types";
import { dataStore } from "./state";
import { applyEffectHandler, triggerEffects } from "./effects";

const CRYSTAL_VALUE = 5;
export const SHOP_CARD_COST = 2; // tunable
export const SHOP_INVOCATION_COST = 3; // tunable
// Locked shop sell values (per design lock):
// - Game cards: 1 Crystal
// - Invocations: 1 Crystal
// - Artifacts: 2 Crystals
const TRADE_GAME_TO_CRYSTALS = 1;
const TRADE_INVOCATION_TO_CRYSTALS = 1;
const TRADE_ARTIFACT_TO_CRYSTALS = 2;
const TRADE_TEACHING_TO_CRYSTALS = 1;
const BASIC_TEACHING_SELL_FALLBACK = 1; // tunable
const INVOCATION_GENERATION_SLOT_MAX = 8; // tunable (generation guard only)
export const INVOCATION_SLOT_MAX = INVOCATION_GENERATION_SLOT_MAX;
export const CHALLENGE_SPELL_BASE_AP = 5;
export const CHALLENGE_COMMIT_MAX = 3;
// Guardian reward costs are tuned assuming players can commit at most CHALLENGE_COMMIT_MAX items.
// Lower multiplier keeps solo/small-group challenges rewarding even with the 3-commit cap.
const GUARDIAN_REWARD_COST_MULT = 1.25;
// Keystone thresholds - lowered for better player experience
export const CAVE_RARE_THRESHOLD = 100;
export const CAVE_MYTHIC_THRESHOLD = 300;
export const MOUNTAIN_RARE_THRESHOLD = 80;
export const MOUNTAIN_MYTHIC_THRESHOLD = 250;

// Intermediate crystal reward thresholds (approx 25% and 75%)
export const CAVE_CRYSTAL_TIER_1 = 50;
export const CAVE_CRYSTAL_TIER_2 = 200;
export const MOUNTAIN_CRYSTAL_TIER_1 = 40;
export const MOUNTAIN_CRYSTAL_TIER_2 = 160;
const MEDITATION_RARITY_WEIGHTS = { common: 1, uncommon: 1, rare: 0.5, cosmic: 0.25 };
const REWARD_POOL_RARITY_WEIGHTS = { common: 1, uncommon: 1, rare: 0.5, cosmic: 0.25 };
export const TP_GAIN_MULT = 2;
// TP threshold system: per-challenge TP milestones that grant teachings
// NOTE: thresholds are in "effective TP" (after TP_GAIN_MULT).
// With CHALLENGE_COMMIT_MAX = 3 and per-card TP in the 2-10 range, these must stay reachable.
export const TP_THRESHOLD_BASIC = 8;
export const TP_THRESHOLD_RARE = 16;
export const TP_THRESHOLD_MYTHIC = 24;

// TP calculation: inverse sliding scale to AP
// Low AP cards get high TP, high AP cards get low TP
// Cosmic cards maintain AP = TP
export function calculateTeachingPower(ap: number, isCosmic: boolean): number {
  if (isCosmic) return ap;

  // Base TP range: 3-12 with inverse relationship to AP
  // AP 3-5 (Common): TP 10-12
  // AP 6-8 (Uncommon): TP 6-9
  // AP 9-11 (Rare): TP 4-6
  // AP 12+ (Very Rare): TP 3-4
  if (ap <= 5) return Math.max(10, 15 - ap);
  if (ap <= 8) return Math.max(6, 14 - ap);
  if (ap <= 11) return Math.max(4, 13 - Math.floor(ap / 2));
  return 3;
}
const GUARDIAN_REWARD_BASE_COST: Record<RewardKind, number> = {
  crystal: 6,
  gameCard: 9,
  spell: 12,
  artifact: 18
};

function hasPassiveTeaching(player: PlayerState, id: string): boolean {
  return player.passiveTeachings.includes(id);
}

export function hasFreeInvocationSlot(player: PlayerState): boolean {
  return player.spells.length < INVOCATION_GENERATION_SLOT_MAX;
}

function consumeGeneratedInvocation(player: PlayerState, spellId: string): boolean {
  if (!player.generatedInvocations || player.generatedInvocations.length === 0) return false;
  const idx = player.generatedInvocations.indexOf(spellId);
  if (idx < 0) return false;
  player.generatedInvocations.splice(idx, 1);
  return true;
}

function markGeneratedInvocation(player: PlayerState, spellId: string): void {
  player.generatedInvocations = player.generatedInvocations ?? [];
  player.generatedInvocations.push(spellId);
}

export function grantInvocation(
  state: GameState,
  player: PlayerState,
  spellId: string,
  options?: { generated?: boolean }
): boolean {
  if (!hasFreeInvocationSlot(player)) {
    state.log.push("Invocation skipped: no free slot.");
    if (state.challenge) {
      state.challenge.logEntries.push("Invocation skipped: no free slot.");
    }
    return false;
  }
  player.spells.push(spellId);
  if (options?.generated) {
    markGeneratedInvocation(player, spellId);
  }
  return true;
}

export type TeachingRarityOdds = { basic: number; rare: number; mythic: number };

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function normalizeRarity(odds: TeachingRarityOdds): TeachingRarityOdds {
  let { basic, rare, mythic } = odds;
  if (basic < 0) {
    const total = rare + mythic;
    if (total <= 0) {
      return { basic: 1, rare: 0, mythic: 0 };
    }
    const scale = 1 / total;
    rare *= scale;
    mythic *= scale;
    basic = 0;
  }
  const sum = basic + rare + mythic;
  if (sum <= 0) {
    return { basic: 1, rare: 0, mythic: 0 };
  }
  if (Math.abs(sum - 1) > 0.0001) {
    basic /= sum;
    rare /= sum;
    mythic /= sum;
  }
  return { basic, rare, mythic };
}

type GameCardRarity = "common" | "uncommon" | "rare" | "cosmic";

function gameCardRarity(cardId: string): GameCardRarity {
  const card = dataStore.cardsById[cardId];
  if (!card) return "common";
  if (card.category === "cosmic" || card.tags.includes("Cosmic")) return "cosmic";
  if (card.color === "Gold") return "rare";
  if (card.color === "Blue") return "uncommon";
  return "common";
}

function drawGameCardByRarityWeights(
  state: GameState,
  rng: Rng,
  weights: Record<GameCardRarity, number>
): string | undefined {
  if (state.decks.game.length === 0 && state.decks.discardGame.length > 0) {
    const reshuffled = rng.shuffle(state.decks.discardGame);
    state.decks.game.push(...reshuffled);
    state.decks.discardGame.length = 0;
  }
  if (state.decks.game.length === 0) {
    return undefined;
  }
  let total = 0;
  const w: number[] = [];
  state.decks.game.forEach((id) => {
    const rarity = gameCardRarity(id);
    const weight = Math.max(0, weights[rarity] ?? 0);
    w.push(weight);
    total += weight;
  });
  if (total <= 0) {
    return state.decks.game.shift();
  }
  const roll = rng.next() * total;
  let acc = 0;
  let index = 0;
  for (let i = 0; i < w.length; i += 1) {
    acc += w[i];
    if (roll <= acc) {
      index = i;
      break;
    }
  }
  const [card] = state.decks.game.splice(index, 1);
  return card;
}

/** Add TP to the per-challenge tracker and check thresholds. */
export function addChallengeTP(
  state: GameState,
  challenge: ChallengeState,
  player: PlayerState,
  rng: Rng,
  rawAmount: number
): void {
  if (rawAmount <= 0) return;
  const effective = rawAmount * TP_GAIN_MULT;
  challenge.challengeTPByPlayer = challenge.challengeTPByPlayer ?? {};
  challenge.challengeTPThresholdsAwarded = challenge.challengeTPThresholdsAwarded ?? {};
  const prev = challenge.challengeTPByPlayer[player.id] ?? 0;
  const next = prev + effective;
  challenge.challengeTPByPlayer[player.id] = next;

  const thresholds = challenge.challengeTPThresholdsAwarded[player.id] ?? { basic: false, rare: false, mythic: false };
  challenge.challengeTPThresholdsAwarded[player.id] = thresholds;

  // Tome of Enlightenment: reduce TP thresholds by 3
  const thresholdReduction = player.artifacts.includes("tome_of_enlightenment") ? 3 : 0;

  const checks: Array<{ key: "basic" | "rare" | "mythic"; threshold: number; tier: "basic" | "rare" | "mythic" }> = [
    { key: "basic", threshold: TP_THRESHOLD_BASIC - thresholdReduction, tier: "basic" },
    { key: "rare", threshold: TP_THRESHOLD_RARE - thresholdReduction, tier: "rare" },
    { key: "mythic", threshold: TP_THRESHOLD_MYTHIC - thresholdReduction, tier: "mythic" }
  ];

  for (const check of checks) {
    if (!thresholds[check.key] && next >= check.threshold) {
      thresholds[check.key] = true;
      grantTeachingOfTier(state, player, rng, check.tier, "TP Threshold");
      state.log.push(`TP THRESHOLD: ${player.name} reaches ${Math.floor(next)} TP — gains a ${check.tier} Teaching!`);
      if (state.challenge?.logEntries) {
        state.challenge.logEntries.push(`${player.name} reaches ${Math.floor(next)} TP — ${check.tier} Teaching!`);
      }
      // Record for turn start toast display
      const prev = state.previousTurnRewards[player.id] ?? {};
      const ct = prev.challengeTeachings ?? { basic: 0, rare: 0, mythic: 0 };
      ct[check.tier] += 1;
      state.previousTurnRewards[player.id] = { ...prev, challengeTeachings: ct };

      // Crown of Stars artifact: +2 Crystals on TP threshold
      if (player.artifacts.includes("crown_of_stars")) {
        player.crystals += 2;
        state.log.push(`${player.name} gains +2 Crystals from Crown of Stars (TP threshold).`);
      }

      // Scroll of Accumulated Wisdom artifact: +1 Crystal per threshold
      if (player.artifacts.includes("scroll_of_wisdom")) {
        player.crystals += 1;
        state.log.push(`${player.name} gains +1 Crystal from Scroll of Accumulated Wisdom (TP threshold).`);
      }

      // Elder's Signet artifact: +5 AP per threshold
      if (player.artifacts.includes("elders_signet")) {
        player.bonusAp = (player.bonusAp ?? 0) + 5;
        state.log.push(`${player.name} gains +5 AP from Elder's Signet (TP threshold).`);
      }

      // Path of Knowledge teaching: +1 extra basic Teaching per threshold
      if (hasPassiveTeaching(player, "path_of_knowledge")) {
        grantTeachingOfTier(state, player, rng, "basic", "Path of Knowledge");
        state.log.push(`${player.name} gains an extra basic Teaching from Path of Knowledge.`);
      }

      // Threshold Mastery teaching: +8 AP and +1 Crystal per threshold
      if (hasPassiveTeaching(player, "threshold_mastery")) {
        player.bonusAp = (player.bonusAp ?? 0) + 8;
        player.crystals += 1;
        state.log.push(`${player.name} gains +8 AP and +1 Crystal from Threshold Mastery.`);
      }
    }
  }
}

export function teachingPotentialGainForCard(cardId: string): number {
  const card = dataStore.cardsById[cardId];
  if (!card) return 0;
  const ap = card.basePower;
  const isCosmic = card.category === "cosmic" || card.tags.includes("Cosmic");

  // Inverse-AP sliding scale for TP gain per card commit.
  // Low AP cards earn more TP, high AP cards earn less.
  // Values kept in 1-5 range so thresholds (see TP_THRESHOLD_*) require multiple commits.
  if (isCosmic) return Math.min(5, Math.max(1, Math.round(ap * 0.4)));
  if (ap <= 4) return 5;   // Weakest cards → highest TP
  if (ap <= 6) return 4;
  if (ap <= 8) return 3;
  if (ap <= 10) return 2;
  return 1;                 // Strongest cards → lowest TP
}

function guardianRewardBaseCost(reward: RewardItem): number {
  return GUARDIAN_REWARD_BASE_COST[reward.kind] ?? 10;
}

function initializeGuardianRewardPool(pool: RewardPool | undefined, participantCount: number): RewardPool | undefined {
  if (!pool) {
    return undefined;
  }
  const rewards = pool.rewards.map((reward, index) => {
    const baseCost = guardianRewardBaseCost(reward);
    const finalCost = Math.ceil(baseCost * participantCount * GUARDIAN_REWARD_COST_MULT);
    return {
      ...reward,
      id: reward.id ?? `${pool.id}-reward-${index + 1}`,
      baseCostPerParticipant: baseCost,
      finalCost,
      isUnlocked: reward.isUnlocked ?? false,
      isClaimed: reward.isClaimed ?? false,
      claimedByPlayerId: reward.claimedByPlayerId
    };
  });
  return { ...pool, rewards };
}

export function drawFromDeck(deck: string[], discard: string[], rng: Rng): string | undefined {
  if (deck.length === 0 && discard.length > 0) {
    const reshuffled = rng.shuffle(discard);
    deck.push(...reshuffled);
    discard.length = 0;
  }
  return deck.shift();
}

export function drawGameCard(state: GameState, rng: Rng): string | undefined {
  return drawFromDeck(state.decks.game, state.decks.discardGame, rng);
}

export function drawMeditationGameCard(state: GameState, rng: Rng): string | undefined {
  return drawGameCardByRarityWeights(state, rng, MEDITATION_RARITY_WEIGHTS);
}

export function drawRewardPoolGameCard(state: GameState, rng: Rng): string | undefined {
  return drawGameCardByRarityWeights(state, rng, REWARD_POOL_RARITY_WEIGHTS);
}

export function drawSpell(state: GameState, rng: Rng): string | undefined {
  const id = drawFromDeck(state.decks.spells, state.decks.discardSpells, rng);
  if (!id) state.log.push("No invocations remain in the realm.");
  return id;
}

const SHOP_CARD_SLOTS = 3;
const SHOP_INVOCATION_SLOTS = 3;

/** Draw fresh shop offerings from decks. Unsold offerings are returned to deck first. */
export function refreshShopOfferings(state: GameState, rng: Rng): void {
  // Return unsold cards back to their decks
  for (const cardId of state.shopOfferings.cards) {
    state.decks.game.push(cardId);
  }
  for (const spellId of state.shopOfferings.invocations) {
    state.decks.spells.push(spellId);
  }
  state.shopOfferings.cards = [];
  state.shopOfferings.invocations = [];

  // Shuffle decks after returning cards
  state.decks.game = rng.shuffle(state.decks.game);
  state.decks.spells = rng.shuffle(state.decks.spells);

  // Draw fresh offerings
  for (let i = 0; i < SHOP_CARD_SLOTS; i++) {
    const id = drawFromDeck(state.decks.game, state.decks.discardGame, rng);
    if (id) state.shopOfferings.cards.push(id);
  }
  for (let i = 0; i < SHOP_INVOCATION_SLOTS; i++) {
    const id = drawFromDeck(state.decks.spells, state.decks.discardSpells, rng);
    if (id) state.shopOfferings.invocations.push(id);
  }
}

export function drawArtifact(state: GameState, rng: Rng): string | undefined {
  const id = drawFromDeck(state.decks.artifacts, [], rng);
  if (!id) state.log.push("No artifacts remain to discover.");
  return id;
}

export function drawTeaching(state: GameState, rng: Rng, tier: "basic" | "rare" | "mythic"): string | undefined {
  if (tier === "basic") {
    return drawFromDeck(state.decks.teachingsBasic, state.decks.discardTeachingsBasic, rng);
  }
  if (tier === "rare") {
    const id = drawFromDeck(state.decks.teachingsRare, [], rng);
    if (!id) state.log.push("No rare teachings remain.");
    return id;
  }
  const id = drawFromDeck(state.decks.teachingsMythic, [], rng);
  if (!id) state.log.push("No mythic teachings remain.");
  return id;
}

export function rollRewardPool(state: GameState, rng: Rng, id: "MOUNTAIN" | "CAVE"): RewardPool {
  const dice = [rng.rollDie(6), rng.rollDie(6)];
  const rewards: RewardItem[] = [];

  dice.forEach((die) => {
    const reward = rewardForDie(state, rng, die);
    if (reward) {
      rewards.push(reward);
    }
  });

  return { id, dice, rewards };
}

export function rewardForDie(state: GameState, rng: Rng, die: number): RewardItem | undefined {
  switch (die) {
    case 1:
      return { kind: "crystal", count: 2 };
    case 2:
      return { kind: "crystal", count: 3 };
    case 3:
      return { kind: "crystal", count: 5 };
    case 4: {
      const card = drawRewardPoolGameCard(state, rng);
      return card ? { kind: "gameCard", cardId: card } : { kind: "crystal", count: 0 };
    }
    case 5: {
      const spell = drawSpell(state, rng);
      return spell ? { kind: "spell", cardId: spell } : { kind: "crystal", count: 0 };
    }
    case 6: {
      const roll = rng.nextInt(0, 99);
      if (roll < 20) {
        const artifact = drawArtifact(state, rng);
        return artifact ? { kind: "artifact", cardId: artifact } : { kind: "crystal", count: 0 };
      }
      if (roll < 70) {
        return { kind: "crystal", count: 1 };
      }
      const spell = drawSpell(state, rng);
      return spell ? { kind: "spell", cardId: spell } : { kind: "crystal", count: 0 };
    }
    default:
      return undefined;
  }
}

export function rerollRewardPoolDie(state: GameState, rng: Rng, pool: RewardPool, dieIndex: number): void {
  const previousReward = pool.rewards[dieIndex];
  if (previousReward?.cardId) {
    switch (previousReward.kind) {
      case "gameCard":
        state.decks.game.push(previousReward.cardId);
        break;
      case "artifact":
        state.decks.artifacts.push(previousReward.cardId);
        break;
      case "spell":
        state.decks.spells.push(previousReward.cardId);
        break;
      default:
        break;
    }
  }
  const newDie = rng.rollDie(6);
  pool.dice[dieIndex] = newDie;
  const nextReward = rewardForDie(state, rng, newDie);
  if (nextReward) {
    pool.rewards[dieIndex] = nextReward;
  }
}

export function rewardPoolValue(pool?: RewardPool): number {
  if (!pool) {
    return 0;
  }
  let value = 0;
  pool.rewards.forEach((reward) => {
    switch (reward.kind) {
      case "crystal":
        value += (reward.count ?? 0) * CRYSTAL_VALUE;
        break;
      case "gameCard":
        if (reward.cardId) {
          value += dataStore.cardsById[reward.cardId]?.basePower ?? 0;
        }
        break;
      case "artifact":
        if (reward.cardId) {
          value += dataStore.artifactsById[reward.cardId]?.value ?? 0;
        }
        break;
      case "spell":
        if (reward.cardId) {
          value += dataStore.spellsById[reward.cardId]?.value ?? 0;
        }
        break;
      default:
        break;
    }
  });
  return value;
}

export function applyRewardPool(state: GameState, player: PlayerState, pool: RewardPool, rng: Rng): void {
  pool.rewards.forEach((reward) => {
    switch (reward.kind) {
      case "crystal":
        player.crystals += reward.count ?? 0;
        break;
      case "gameCard":
        if (reward.cardId) {
          player.hand.push(reward.cardId);
        }
        break;
      case "artifact":
        if (reward.cardId) {
          player.artifacts.push(reward.cardId);
        }
        break;
      case "spell":
        if (reward.cardId) {
          grantInvocation(state, player, reward.cardId);
        }
        break;
      default:
        break;
    }
  });

  triggerEffects("reward_pool_applied", {
    state,
    player,
    rng,
    event: "reward_pool_applied",
    rewardPool: pool,
    gainTeaching: (count = 1) => gainTeaching(state, player, rng, count)
  });

  if (pool.id === "MOUNTAIN") {
    state.rewardPools.mountain = undefined;
  } else if (pool.id === "CAVE") {
    state.rewardPools.cave = undefined;
  }
}

export function meditate(state: GameState, player: PlayerState, rng: Rng): void {
  // Meditation: draw 2 game cards + base 30% invocation chance + teaching bonuses.
  const drawCount = 2;
  const modifiers: Record<string, number> = { extraCards: 0 };
  triggerEffects("meditate", {
    state,
    player,
    rng,
    event: "meditate",
    modifiers
  });
  const totalDraws = drawCount + (modifiers.extraCards ?? 0);
  const drawnCardIds: string[] = [];
  for (let i = 0; i < totalDraws; i += 1) {
    const cardId = drawMeditationGameCard(state, rng);
    if (cardId) {
      player.hand.push(cardId);
      drawnCardIds.push(cardId);
    }
  }

  // Verdant Seed Pod: +1 Crystal per Plant card drawn when active
  if (modifiers.verdantSeedPodActive && drawnCardIds.length > 0) {
    const plantCount = drawnCardIds.filter(id => {
      const cardData = dataStore.cardsById[id];
      return cardData?.tags?.includes("Plant");
    }).length;
    if (plantCount > 0) {
      player.crystals = (player.crystals ?? 0) + plantCount;
      state.log.push(`Verdant Seed Pod: +${plantCount} Crystal${plantCount > 1 ? "s" : ""} (Plant cards drawn).`);
    }
  }

  player.lastMeditateTurn = state.turn;

  // Late-game crystal scaling: meditation grants bonus crystals in later turns
  let bonusCrystals = 0;
  if (state.turn >= 10) {
    bonusCrystals = 2;
  } else if (state.turn >= 6) {
    bonusCrystals = 1;
  }
  if (bonusCrystals > 0) {
    player.crystals = (player.crystals ?? 0) + bonusCrystals;
    state.log.push(`Meditation: +${bonusCrystals} Crystal${bonusCrystals > 1 ? "s" : ""} (late-game bonus).`);
  }

  // --- Invocation chance ---
  // Base: 30% chance
  // Permanent bonuses from consumed basic teachings: +2% / +3% / +5%
  // One-time bonus from each teaching (first meditation after gaining): +30% / +60% / +100%
  const { totalChance, breakdown } = getMeditationInvocationChance(player);
  let invocationsGained = 0;

  state.log.push(`Meditation invocation chance: ${Math.round(Math.min(totalChance, 1) * 100)}% (${breakdown.join(", ")})`);

  if (totalChance > 0 && rng.next() < Math.min(totalChance, 1)) {
    const spellId = drawSpell(state, rng);
    if (spellId && grantInvocation(state, player, spellId)) {
      invocationsGained = 1;
      state.log.push("Meditation: Insight strikes — you gain an Invocation!");
    }
  }

  // Mark one-time bonuses as consumed
  player.usedTeachingOneTimeBonus = player.usedTeachingOneTimeBonus ?? [];
  for (const tid of BASIC_TEACHING_CONFIGS.map(c => c.id)) {
    if (playerHasBasicTeaching(player, tid) && !player.usedTeachingOneTimeBonus.includes(tid)) {
      player.usedTeachingOneTimeBonus.push(tid);
    }
  }

  state.log.push(`Meditation: +${drawnCardIds.length} Game Card${drawnCardIds.length !== 1 ? "s" : ""}.`);
  if (invocationsGained > 0) {
    state.log.push(`Meditation: +${invocationsGained} Invocation.`);
  }

  state.previousTurnRewards[player.id] = {
    ...state.previousTurnRewards[player.id],
    meditation: { teachings: 0, invocations: invocationsGained, cards: drawnCardIds.length }
  };
}

/** Basic teaching configuration: permanent bonus + one-time bonus */
const BASIC_TEACHING_CONFIGS = [
  { id: "open_attention", permanentBonus: 0.03, oneTimeBonus: 0.30 },
  { id: "prepared_mind", permanentBonus: 0.05, oneTimeBonus: 0.60 },
  { id: "heightened_curiosity", permanentBonus: 0.07, oneTimeBonus: 1.00 },
  { id: "quiet_knowing", permanentBonus: 0.03, oneTimeBonus: 0.45 },
  { id: "disciplined_study", permanentBonus: 0.02, oneTimeBonus: 0.35 },
];

/** Check if player has ever consumed a basic teaching (grants permanent meditation bonus). */
function playerHasBasicTeaching(player: PlayerState, teachingId: string): boolean {
  // Check consumedBasicTeachings (where used basics are tracked after consumption),
  // or teachings array (if they still have it unconsumed)
  return (player.consumedBasicTeachings ?? []).includes(teachingId) || player.teachings.includes(teachingId);
}

/** Calculate total meditation invocation chance with breakdown. */
export function getMeditationInvocationChance(player: PlayerState): { totalChance: number; breakdown: string[] } {
  let chance = 0.30; // Base 30%
  const breakdown: string[] = ["Base 30%"];
  const used = player.usedTeachingOneTimeBonus ?? [];

  for (const cfg of BASIC_TEACHING_CONFIGS) {
    if (playerHasBasicTeaching(player, cfg.id)) {
      // Permanent bonus (always active once teaching is owned)
      chance += cfg.permanentBonus;
      breakdown.push(`+${Math.round(cfg.permanentBonus * 100)}% ${dataStore.teachingsById[cfg.id]?.name ?? cfg.id}`);

      // One-time bonus (only on first meditation after gaining the teaching)
      if (!used.includes(cfg.id)) {
        chance += cfg.oneTimeBonus;
        breakdown.push(`+${Math.round(cfg.oneTimeBonus * 100)}% one-time ${dataStore.teachingsById[cfg.id]?.name ?? cfg.id}`);
      }
    }
  }

  return { totalChance: chance, breakdown };
}

function grantTeachingOfTier(
  state: GameState,
  player: PlayerState,
  rng: Rng,
  tier: "basic" | "rare" | "mythic",
  label?: string
): void {
  const teachingId = drawTeaching(state, rng, tier);
  if (!teachingId) {
    state.log.push(`${player.name} finds no ${tier} teachings to learn${label ? ` (${label})` : ""}.`);
    return;
  }
  const teaching = dataStore.teachingsById[teachingId];
  if (!teaching) {
    state.log.push(`${player.name} gains an unknown teaching.`);
    return;
  }

  if (teaching.unique && (player.passiveTeachings.includes(teachingId) || player.teachings.includes(teachingId))) {
    state.log.push(`${player.name} is already attuned to ${teaching.name}.`);
    return;
  }

  if (teaching.tier === "basic") {
    player.teachings.push(teachingId);
  } else {
    player.passiveTeachings.push(teachingId);
    applyEffectHandler(teaching.effect, {
      state,
      player,
      rng,
      event: "teaching_gained",
      source: { type: "teaching", id: teachingId }
    });
    if (teaching.id === "worldseed_awakening" && !player.worldseedStatus) {
      player.worldseedStatus = "dormant";
    }
  }

  const tierLabel = teaching.tier === "basic" ? "Basic" : teaching.tier === "rare" ? "Rare" : "Mythic";
  state.log.push(`${player.name} gains ${tierLabel} Teaching: ${teaching.name}${label ? ` (${label})` : ""}.`);
}

function grantSpecificTeaching(
  state: GameState,
  player: PlayerState,
  rng: Rng,
  teachingId: string,
  label?: string
): void {
  const teaching = dataStore.teachingsById[teachingId];
  if (!teaching) {
    state.log.push(`${player.name} gains an unknown teaching.`);
    return;
  }
  if (teaching.unique && (player.passiveTeachings.includes(teachingId) || player.teachings.includes(teachingId))) {
    state.log.push(`${player.name} is already attuned to ${teaching.name}.`);
    return;
  }
  if (teaching.tier === "basic") {
    player.teachings.push(teachingId);
  } else {
    player.passiveTeachings.push(teachingId);
    applyEffectHandler(teaching.effect, {
      state,
      player,
      rng,
      event: "teaching_gained",
      source: { type: "teaching", id: teachingId }
    });
    if (teaching.id === "worldseed_awakening" && !player.worldseedStatus) {
      player.worldseedStatus = "dormant";
    }
  }

  const tierLabel = teaching.tier === "basic" ? "Basic" : teaching.tier === "rare" ? "Rare" : "Mythic";
  state.log.push(`${player.name} gains ${tierLabel} Teaching: ${teaching.name}${label ? ` (${label})` : ""}.`);
}

export function gainTeaching(state: GameState, player: PlayerState, rng: Rng, count = 1): void {
  for (let i = 0; i < count; i += 1) {
    grantTeachingOfTier(state, player, rng, "basic");
  }
}

export function cardValue(cardId: string): number {
  return dataStore.cardsById[cardId]?.basePower ?? 0;
}

export function cardTeachingPower(cardId: string): number {
  const card = dataStore.cardsById[cardId];
  if (!card) return 0;
  return card.teachingPower ?? card.basePower ?? 0;
}

export function spellValue(spellId: string): number {
  return dataStore.spellsById[spellId]?.value ?? 0;
}

export function artifactValue(artifactId: string): number {
  return dataStore.artifactsById[artifactId]?.value ?? 0;
}

export function formatCrystals(value: number): string {
  return `${value}`;
}

export function totalCurrencyCrystals(player: PlayerState): number {
  return player.crystals;
}

export function earthAdvancementTierMultiplier(tier: 1 | 2 | 3): number {
  return tier === 1 ? 1 : tier === 2 ? 1 : 1;
}

export function earthAdvancementAp(card: EarthAdvancementData): number {
  return Math.max(0, Math.floor((card.apReward ?? 0) * earthAdvancementTierMultiplier(card.tier)));
}

function spendCrystals(player: PlayerState, crystalsToSpend: number): void {
  player.crystals = Math.max(0, player.crystals - crystalsToSpend);
  player.runCrystalsSpent = (player.runCrystalsSpent ?? 0) + Math.max(0, crystalsToSpend);
}

function earthCardRarity(cardId: string): EarthCardRarity {
  const card = dataStore.cardsById[cardId];
  if (!card) return "common";
  if (card.category === "cosmic" || card.tags.includes("Cosmic")) {
    return "cosmic";
  }
  if (card.basePower >= 12) return "rare";
  if (card.basePower >= 8) return "uncommon";
  return "common";
}

function effectiveEarthCrystalCost(card: EarthAdvancementData, player: PlayerState): number {
  const base = Math.max(0, card.requirements?.crystals ?? 0);
  if (hasPassiveTeaching(player, "convergence_of_paths")) {
    return Math.max(1, base - 2);
  }
  return base;
}

function requiredInvocations(card: EarthAdvancementData): number {
  const req = card.requirements ?? { crystals: 0 };
  return Math.max(0, req.spells ?? 0) + Math.max(0, req.invocations ?? 0);
}

function rarityRequirementTotal(card: EarthAdvancementData): number {
  const byRarity = card.requirements?.cardsByRarity;
  if (!byRarity) return 0;
  return Object.values(byRarity).reduce((sum, value) => sum + Math.max(0, value ?? 0), 0);
}

export function earthAdvancementRequirementLines(card: EarthAdvancementData): string[] {
  const req = card.requirements ?? { crystals: 0 };
  const lines: string[] = [`Spend ${formatCrystals(req.crystals ?? 0)} Crystals`];
  if ((req.artifacts ?? 0) > 0) {
    lines.push(`Consume ${req.artifacts} Artifact${req.artifacts === 1 ? "" : "s"}`);
  }
  if ((req.cardsAny ?? 0) > 0) {
    lines.push(`Consume ${req.cardsAny} Game Card${req.cardsAny === 1 ? "" : "s"}`);
  }
  if ((req.spells ?? 0) > 0) {
    lines.push(`Consume ${req.spells} Spell${req.spells === 1 ? "" : "s"}`);
  }
  if ((req.invocations ?? 0) > 0) {
    lines.push(`Consume ${req.invocations} Invocation${req.invocations === 1 ? "" : "s"}`);
  }
  const byRarity = req.cardsByRarity;
  if (byRarity) {
    const parts: string[] = [];
    (["common", "uncommon", "rare", "cosmic"] as EarthCardRarity[]).forEach((rarity) => {
      const count = byRarity[rarity] ?? 0;
      if (count > 0) {
        const label = rarity[0].toUpperCase() + rarity.slice(1);
        parts.push(`${count} ${label}`);
      }
    });
    if (parts.length > 0) {
      lines.push(`Consume ${parts.join(" + ")} Card${parts.length > 1 ? "s" : ""}`);
    }
  }
  return lines;
}

function missingEarthRequirements(card: EarthAdvancementData, player: PlayerState): string[] {
  const req = card.requirements ?? { crystals: 0 };
  const missing: string[] = [];
  const crystalCost = effectiveEarthCrystalCost(card, player);
  if (player.crystals < crystalCost) {
    missing.push(`Need ${formatCrystals(crystalCost)} Crystals`);
  }
  const artifactsNeed = Math.max(0, req.artifacts ?? 0);
  if (player.artifacts.length < artifactsNeed) {
    missing.push(`Need ${artifactsNeed} Artifact${artifactsNeed === 1 ? "" : "s"}`);
  }

  const invocationNeed = requiredInvocations(card);
  if (player.spells.length < invocationNeed) {
    missing.push(`Need ${invocationNeed} Invocation${invocationNeed === 1 ? "" : "s"}`);
  }

  const byRarity = req.cardsByRarity ?? {};
  const rarityCounts: Record<EarthCardRarity, number> = { common: 0, uncommon: 0, rare: 0, cosmic: 0 };
  player.hand.forEach((cardId) => {
    rarityCounts[earthCardRarity(cardId)] += 1;
  });
  (["common", "uncommon", "rare", "cosmic"] as EarthCardRarity[]).forEach((rarity) => {
    const need = Math.max(0, byRarity[rarity] ?? 0);
    if (need > 0 && rarityCounts[rarity] < need) {
      const label = rarity[0].toUpperCase() + rarity.slice(1);
      missing.push(`Need ${need} ${label} Card${need === 1 ? "" : "s"}`);
    }
  });

  const cardsAnyNeed = Math.max(0, req.cardsAny ?? 0);
  const reservedForRarity = rarityRequirementTotal(card);
  const availableForAny = Math.max(0, player.hand.length - reservedForRarity);
  if (availableForAny < cardsAnyNeed) {
    missing.push(`Need ${cardsAnyNeed} extra Game Card${cardsAnyNeed === 1 ? "" : "s"}`);
  }

  return missing;
}

export function earthAdvancementMissingRequirements(card: EarthAdvancementData, player: PlayerState): string[] {
  return missingEarthRequirements(card, player);
}

export function earthAdvancementCrystalCost(card: EarthAdvancementData, player: PlayerState): number {
  return effectiveEarthCrystalCost(card, player);
}

function removeByIndices<T>(list: T[], indices: number[]): T[] {
  const sorted = [...indices].sort((a, b) => b - a);
  const removed: T[] = [];
  sorted.forEach((index) => {
    if (index >= 0 && index < list.length) {
      const [item] = list.splice(index, 1);
      if (item !== undefined) removed.push(item);
    }
  });
  return removed;
}

function consumeArtifacts(player: PlayerState, count: number): string[] {
  const indexed = player.artifacts
    .map((id, index) => ({ id, index, value: artifactValue(id) }))
    .sort((a, b) => a.value - b.value || a.index - b.index)
    .slice(0, count);
  return removeByIndices(player.artifacts, indexed.map((entry) => entry.index));
}

function consumeInvocations(state: GameState, player: PlayerState, count: number): string[] {
  const indexed = player.spells
    .map((id, index) => ({ id, index, value: spellValue(id) }))
    .sort((a, b) => a.value - b.value || a.index - b.index)
    .slice(0, count);
  const removed = removeByIndices(player.spells, indexed.map((entry) => entry.index));
  removed.forEach((spellId) => state.decks.discardSpells.push(spellId));
  return removed;
}

function consumeCardsAny(state: GameState, player: PlayerState, count: number): string[] {
  const indexed = player.hand
    .map((id, index) => ({ id, index, value: cardValue(id) }))
    .sort((a, b) => a.value - b.value || a.index - b.index)
    .slice(0, count);
  const removed = removeByIndices(player.hand, indexed.map((entry) => entry.index));
  removed.forEach((cardId) => state.decks.discardGame.push(cardId));
  return removed;
}

function consumeCardsByRarity(
  state: GameState,
  player: PlayerState,
  cardNeeds: Partial<Record<EarthCardRarity, number>>
): string[] {
  const selections: number[] = [];
  (["common", "uncommon", "rare", "cosmic"] as EarthCardRarity[]).forEach((rarity) => {
    const need = Math.max(0, cardNeeds[rarity] ?? 0);
    if (need <= 0) return;
    const pool = player.hand
      .map((id, index) => ({ id, index, rarity: earthCardRarity(id), value: cardValue(id) }))
      .filter((entry) => entry.rarity === rarity && !selections.includes(entry.index))
      .sort((a, b) => a.value - b.value || a.index - b.index)
      .slice(0, need);
    selections.push(...pool.map((entry) => entry.index));
  });
  const removed = removeByIndices(player.hand, selections);
  removed.forEach((cardId) => state.decks.discardGame.push(cardId));
  return removed;
}

function applyEarthPassiveBuff(player: PlayerState, card: EarthAdvancementData): string | undefined {
  const buff = card.passiveBuff;
  if (!buff) return undefined;
  if (buff.kind === "BASELINE_FORGIVENESS") {
    player.reviewBaselineForgiveness = (player.reviewBaselineForgiveness ?? 0) + Math.max(0, buff.amount);
    return buff.description;
  }
  if (buff.kind === "REVIEW_AP_BONUS") {
    player.reviewApBonus = (player.reviewApBonus ?? 0) + Math.max(0, buff.amount);
    return buff.description;
  }
  if (buff.kind === "CRYSTAL_DRIP") {
    const current = player.bonusCrystalEveryRounds;
    const next = Math.max(2, buff.everyRounds ?? 3);
    player.bonusCrystalEveryRounds = current ? Math.min(current, next) : next;
    return buff.description;
  }
  return undefined;
}

export function sellHandCard(player: PlayerState, cardIndex: number, state: GameState): void {
  if (state.phase === "CHALLENGE") return;
  const cardId = player.hand[cardIndex];
  if (!cardId) return;
  player.hand.splice(cardIndex, 1);
  player.crystals += TRADE_GAME_TO_CRYSTALS;
  state.log.push(`${player.name} traded in a Game Card for ${formatCrystals(TRADE_GAME_TO_CRYSTALS)} Crystals.`);
  triggerEffects("sell_item", {
    state,
    player,
    rng: new Rng(state.seed),
    event: "sell_item"
  });

  if (hasPassiveTeaching(player, "transmutation_of_focus")) {
    if (player.transmutationFocusUsedTurn === state.turn) return;
    player.transmutationFocusSalesThisTurn = (player.transmutationFocusSalesThisTurn ?? 0) + 1;
    if ((player.transmutationFocusSalesThisTurn ?? 0) >= 2) {
      player.transmutationFocusSalesThisTurn = 0;
      player.transmutationFocusUsedTurn = state.turn;
      const generated = drawSpell(state, new Rng(state.seed));
      if (generated && grantInvocation(state, player, generated, { generated: true })) {
        state.log.push(`${player.name} gains a generated Invocation from Transmutation of Focus.`);
      }
    }
  }
}

export function sellSpell(player: PlayerState, spellIndex: number, state: GameState): void {
  const spellId = player.spells[spellIndex];
  if (!spellId) return;
  player.spells.splice(spellIndex, 1);
  player.crystals += TRADE_INVOCATION_TO_CRYSTALS;
  state.log.push(`${player.name} traded in an Invocation for ${formatCrystals(TRADE_INVOCATION_TO_CRYSTALS)} Crystals.`);
  triggerEffects("sell_item", {
    state,
    player,
    rng: new Rng(state.seed),
    event: "sell_item"
  });
}

export function sellArtifact(player: PlayerState, artifactIndex: number, state: GameState): void {
  const artifactId = player.artifacts[artifactIndex];
  if (!artifactId) return;
  player.artifacts.splice(artifactIndex, 1);
  player.crystals += TRADE_ARTIFACT_TO_CRYSTALS;
  state.log.push(`${player.name} traded in an Artifact for ${formatCrystals(TRADE_ARTIFACT_TO_CRYSTALS)} Crystals.`);
  triggerEffects("sell_item", {
    state,
    player,
    rng: new Rng(state.seed),
    event: "sell_item"
  });
}

export function sellTeaching(player: PlayerState, teachingIndex: number, state: GameState): void {
  const teachingId = player.teachings[teachingIndex];
  if (!teachingId) return;
  const teaching = dataStore.teachingsById[teachingId];
  // Locked: All teachings are sellable EXCEPT Basic (tier 1) teachings.
  if (!teaching || teaching.tier === "basic") return;
  player.teachings.splice(teachingIndex, 1);
  // Locked economy: non-basic teachings sell for a flat 1 Crystal.
  player.crystals += TRADE_TEACHING_TO_CRYSTALS;
  state.log.push(`${player.name} traded in ${teaching.name} for ${formatCrystals(TRADE_TEACHING_TO_CRYSTALS)} Crystals.`);
  triggerEffects("sell_item", {
    state,
    player,
    rng: new Rng(state.seed),
    event: "sell_item"
  });
}

function canBuyEarthFromTier(state: GameState, tier: 1 | 2 | 3): boolean {
  if (tier === 1) return state.decks.earthAdvancementsT1.length > 0;
  if (tier === 2) return state.decks.earthAdvancementsT2.length > 0;
  return state.decks.earthAdvancementsT3.length > 0;
}

function peekEarthCard(state: GameState, tier: 1 | 2 | 3): string | undefined {
  const deck = tier === 1 ? state.decks.earthAdvancementsT1 : tier === 2 ? state.decks.earthAdvancementsT2 : state.decks.earthAdvancementsT3;
  return deck[0];
}

function drawEarthCard(state: GameState, tier: 1 | 2 | 3): string | undefined {
  const deck = tier === 1 ? state.decks.earthAdvancementsT1 : tier === 2 ? state.decks.earthAdvancementsT2 : state.decks.earthAdvancementsT3;
  return deck.shift();
}

export function canBuyEarthAdvancement(state: GameState, player: PlayerState, tier: 1 | 2 | 3): boolean {
  if (!canBuyEarthFromTier(state, tier)) return false;
  const id = peekEarthCard(state, tier);
  const card = dataStore.earthAdvancements.find((c) => c.id === id);
  if (!card) return false;
  return missingEarthRequirements(card, player).length === 0;
}

export function buyEarthAdvancement(state: GameState, player: PlayerState, tier: 1 | 2 | 3, rng: Rng): boolean {
  const id = peekEarthCard(state, tier);
  if (!id) {
    state.log.push(`No Earth Advancements remain in Tier ${tier}.`);
    return false;
  }
  const card = dataStore.earthAdvancements.find((c) => c.id === id);
  if (!card) return false;
  const missing = missingEarthRequirements(card, player);
  if (missing.length > 0) {
    state.log.push(`${player.name} cannot complete ${card.name}: ${missing.join("; ")}.`);
    return false;
  }

  const req = card.requirements ?? { crystals: 0 };
  const crystalCost = effectiveEarthCrystalCost(card, player);
  const artifactCost = Math.max(0, req.artifacts ?? 0);
  const invocationCost = requiredInvocations(card);
  const rarityReq = req.cardsByRarity ?? {};
  const cardsAnyCost = Math.max(0, req.cardsAny ?? 0);

  spendCrystals(player, crystalCost);
  const consumedArtifacts = artifactCost > 0 ? consumeArtifacts(player, artifactCost) : [];
  const consumedInvocations = invocationCost > 0 ? consumeInvocations(state, player, invocationCost) : [];
  const consumedRarityCards = rarityRequirementTotal(card) > 0 ? consumeCardsByRarity(state, player, rarityReq) : [];
  const consumedAnyCards = cardsAnyCost > 0 ? consumeCardsAny(state, player, cardsAnyCost) : [];

  drawEarthCard(state, tier);
  if (card.tier === 1) {
    player.earthAdvancementsT1.push(card.id);
  } else if (card.tier === 2) {
    player.earthAdvancementsT2.push(card.id);
  } else {
    player.earthAdvancementsT3.push(card.id);
  }
  const passiveText = applyEarthPassiveBuff(player, card);

  triggerEffects("earth_advancement_purchase", {
    state,
    player,
    rng,
    event: "earth_advancement_purchase"
  });

  state.log.push(
    `${player.name} completed Earth Advancement: ${card.name} (Tier ${tier}, +${earthAdvancementAp(card)} AP, cost ${formatCrystals(crystalCost)} Crystals, consumed ${consumedArtifacts.length} Artifact${consumedArtifacts.length === 1 ? "" : "s"}, ${consumedInvocations.length} Invocation${consumedInvocations.length === 1 ? "" : "s"}, ${consumedRarityCards.length + consumedAnyCards.length} Card${consumedRarityCards.length + consumedAnyCards.length === 1 ? "" : "s"}).${passiveText ? ` Passive: ${passiveText}` : ""}`
  );

  return true;
}

export function finalScore(player: PlayerState): number {
  let total = 0;
  total += player.crystals * CRYSTAL_VALUE;
  total += player.bonusAp ?? 0;
  player.hand.forEach((cardId) => {
    total += cardValue(cardId);
  });
  player.spells.forEach((spellId) => {
    total += spellValue(spellId);
  });
  player.artifacts.forEach((artifactId) => {
    total += artifactValue(artifactId);
  });
  const adv = [...player.earthAdvancementsT1, ...player.earthAdvancementsT2, ...player.earthAdvancementsT3];
  adv.forEach((advancementId) => {
    const advancement = dataStore.earthAdvancements.find((card) => card.id === advancementId);
    if (advancement) {
      total += earthAdvancementAp(advancement);
    }
  });
  // Convergence of Paths: +3 AP per distinct Earth Advancement owned
  if (player.passiveTeachings.includes("convergence_of_paths")) {
    total += adv.length * 3;
  }
  return total;
}


export type AchievementBonus = { title: string; bonus: number };

export function computeAchievementBonuses(state: GameState): Record<string, AchievementBonus[]> {
  const bonuses: Record<string, AchievementBonus[]> = {};
  state.players.forEach((p) => (bonuses[p.id] = []));

  const totalCrystals = (p: PlayerState) => p.crystals;
  const earthCount = (p: PlayerState) =>
    p.earthAdvancementsT1.length + p.earthAdvancementsT2.length + p.earthAdvancementsT3.length;
  const earthTierScore = (p: PlayerState) =>
    p.earthAdvancementsT1.length * 1 + p.earthAdvancementsT2.length * 2 + p.earthAdvancementsT3.length * 3;
  const spellsTotal = (p: PlayerState) => (p.spellsCast ?? 0) + p.spells.length;
  const teachingsTotal = (p: PlayerState) => p.teachings.length + p.passiveTeachings.length;
  const artifactsTotal = (p: PlayerState) => p.artifacts.length;

  const award = (playerId: string, title: string, bonus: number) => {
    bonuses[playerId].push({ title, bonus });
  };

  const awardSingleWinner = (
    metric: (p: PlayerState) => number,
    tieBreaker: (p: PlayerState) => number,
    title: string,
    bonus: number
  ) => {
    let best: PlayerState | undefined;
    state.players.forEach((p) => {
      if (!best) {
        best = p;
        return;
      }
      const a = metric(p);
      const b = metric(best);
      if (a > b) {
        best = p;
      } else if (a === b) {
        if (tieBreaker(p) > tieBreaker(best)) {
          best = p;
        }
      }
    });
    if (best) {
      award(best.id, title, bonus);
    }
  };

  // Titles
  awardSingleWinner(
    totalCrystals,
    totalCrystals,
    "Crystal Steward",
    15
  );

  awardSingleWinner(
    earthCount,
    earthTierScore,
    "Earth Catalyst",
    15
  );

  awardSingleWinner(
    spellsTotal,
    (p) => p.spellsCast ?? 0,
    "Arcane Conductor",
    10
  );

  awardSingleWinner(
    teachingsTotal,
    teachingsTotal,
    "Mystic Scholar",
    10
  );

  awardSingleWinner(
    artifactsTotal,
    (p) => p.artifacts.reduce((sum, id) => sum + artifactValue(id), 0),
    "Relic Keeper",
    10
  );

  // Cap: keep top 2 bonuses per player (highest bonus first, then stable order).
  Object.keys(bonuses).forEach((pid) => {
    const list = bonuses[pid];
    list.sort((a, b) => b.bonus - a.bonus);
    bonuses[pid] = list.slice(0, 2);
  });

  return bonuses;
}

export function finalScoreWithAchievements(state: GameState, player: PlayerState): { total: number; base: number; bonuses: AchievementBonus[] } {
  const base = finalScore(player);
  const bonusMap = computeAchievementBonuses(state);
  const b = bonusMap[player.id] ?? [];
  const bonusTotal = b.reduce((sum, x) => sum + x.bonus, 0);
  return { total: base + bonusTotal, base, bonuses: b };
}


export function setupChallenge(state: GameState, rng: Rng, pending: PendingChallenge): ChallengeState {
  const rolls: Record<string, number | null> = {};
  pending.contestants.forEach((playerId) => {
    rolls[playerId] = null;
  });
  const order: string[] = [];
  const challengeName = pending.id === "MOUNTAIN" ? "Mountain" : "Cave";
  const guardianName = pending.id === "MOUNTAIN" ? "Guardian of the Mountain" : "Guardian of the Cave";

  const played: ChallengeState["played"] = {};
  pending.contestants.forEach((playerId) => {
    const player = state.players.find((p) => p.id === playerId);
    if (player) {
      player.runChallengesEntered = (player.runChallengesEntered ?? 0) + 1;
      // Challenge TP is initialized in challengeTPByPlayer above
    }

    played[playerId] = {
      selected: [],
      faceDownId: undefined,
      spellsPlayed: [],
      committedItems: [],
      teachingMeditationStacks: 0,
      beat1Cards: [],
      beat2Cards: [],
      beat1Spells: [],
      beat2Spells: [],
      beat1InvocationId: null,
      beat2InvocationId: null,
      teachingsPlayed: [],
      extraCards: [],
      extraCardSources: {},
      artifactEffects: [],
      powerBonus: 0,
      powerBonusBreakdown: [],
      empowerMeek: false,
      empowerMeekMultiplier: 1,
      channelGroupEnergy: false,
      channelGroupEnergyMultiplier: 1,
      thirdEye: false,
      resonantAmplifierActive: false,
      confluenceVoices: false,
      confluenceVoicesMultiplier: 1,
      ritualContinuanceUsed: false,
      invocationsCastCount: 0,
      invocationsCastQualifyingCount: 0,
      echoesInStoneUsed: false,
      firstCommittedCardId: undefined,
      rewardThresholdsReached: 0,
      grounding: false,
      groundingValue: 0,
      revealAllFaceDown: false,
      hiddenCardIds: [],
      revealedHiddenCardIds: [],
      reduceAllOpponents: 0,
      emergentConvergenceUsed: false,
      totalCommitmentGranted: false,
      worldseedRitualTriggered: false,
      removedFromGameCards: [],
      finalCardPowers: []
    };

  });

  const rewardPool = initializeGuardianRewardPool(pending.rewardPool, pending.contestants.length);
  const apContributionByPlayer = Object.fromEntries(
    pending.contestants.map((playerId) => [playerId, 0])
  ) as Record<string, number>;
  const challengeTPByPlayer = Object.fromEntries(
    pending.contestants.map((playerId) => [playerId, 0])
  ) as Record<string, number>;
  const challengeTPThresholdsAwarded = Object.fromEntries(
    pending.contestants.map((playerId) => [playerId, { basic: false, rare: false, mythic: false }])
  ) as Record<string, { basic: boolean; rare: boolean; mythic: boolean }>;
  const challenge: ChallengeState = {
    id: pending.id,
    journeyType: pending.id === "CAVE" ? "cave" : pending.id === "MOUNTAIN" ? "mountain" : null,
    phase: "ROLL_ORDER",
    participants: [...pending.contestants],
    rolls: { ...rolls },
    turnOrder: [],
    activeTurnIndex: 0,
    logEntries: [`Challenge begins: ${challengeName}.`, `${guardianName} presides over the rite.`],
    contestants: pending.contestants,
    order,
    folded: [],
    played,
    rewardPool,
    revealedEarly: [],
    rollQueue: [...pending.contestants],
    revealIndex: 0,
    resolveIndex: 0,
    phaseTimerMs: 0,
    totals: {},
    resolvedTotals: {},
    aiPending: false,
    initiativePaused: false,
    beatCount: 0,
    passesInRow: 0,
    apContributionByPlayer,
    totalGroupAp: 0,
    challengeTPByPlayer,
    challengeTPThresholdsAwarded,
    draft: undefined,
    metrics: {
      apEarnedSoFar: 0,
      teachingPowerPlayedSoFar: 0
    }
  };

  const participantNames = challenge.contestants
    .map((playerId) => state.players.find((p) => p.id === playerId)?.name ?? playerId)
    .join(", ");
  challenge.logEntries.push(`Participants: ${participantNames}.`);
  state.log.push(`Challenge: Participants - ${participantNames}.`);
  state.log.push(`Challenge: ${guardianName} presides over the rite.`);

  challenge.contestants.forEach((playerId) => {
    const player = state.players.find((p) => p.id === playerId);
    const playedState = challenge.played[playerId];
    if (!player || !playedState) return;
    if ((player.pendingChallengeDiceBonus ?? 0) > 0) {
      player.activeChallengeDiceBonus = player.pendingChallengeDiceBonus;
      player.activeChallengeKey = `${state.turn}-${challenge.id}`;
      player.pendingChallengeDiceBonus = 0;
    }
    triggerEffects("challenge_setup", {
      state,
      player,
      rng,
      event: "challenge_setup",
      challenge,
      played: playedState
    });
  });

  return challenge;
}

export function getDiceBonus(state: GameState, player: PlayerState, rng: Rng): number {
  const modifiers: Record<string, number> = { bonus: 0 };
  triggerEffects("dice_bonus", {
    state,
    player,
    rng,
    event: "dice_bonus",
    modifiers
  });
  const temp = player.tempDiceBonus ?? 0;
  const activeKey = state.challenge ? `${state.turn}-${state.challenge.id}` : undefined;
  const challengeBonus = activeKey && player.activeChallengeKey === activeKey ? player.activeChallengeDiceBonus ?? 0 : 0;
  return (modifiers.bonus ?? 0) + temp + challengeBonus;
}

export function resetTempDiceBonus(player: PlayerState): void {
  player.tempDiceBonus = 0;
}

export function applySpellEffect(
  state: GameState,
  challenge: ChallengeState,
  player: PlayerState,
  spellId: string,
  rng: Rng,
  fromArtifact = false
): boolean {
  const played = challenge.played[player.id];
  const spell = dataStore.spellsById[spellId];
  if (!spell || !played) {
    return false;
  }

  const wasGenerated = consumeGeneratedInvocation(player, spellId);

  if (hasPassiveTeaching(player, "echoes_in_the_stone")) {
    const castCount = played.invocationsCastCount ?? 0;
    if (!played.echoesInStoneUsed) {
      // First invocation: +3 AP + 1 TP
      played.echoesInStoneUsed = true;
      played.powerBonus += 3;
      played.powerBonusBreakdown = played.powerBonusBreakdown ?? [];
      played.powerBonusBreakdown.push({
        label: "Echoes in the Stone",
        amount: 3,
        source: "teaching"
      });
      if (state.challenge) {
        addChallengeTP(state, state.challenge, player, rng, 1);
      }
      state.log.push(`${player.name} gains +3 AP and +${Math.floor(1 * TP_GAIN_MULT)} Challenge TP from Echoes in the Stone.`);
    } else if (castCount === 1 && !played.echoesInStoneSecondUsed) {
      // Second invocation: +1 TP
      played.echoesInStoneSecondUsed = true;
      if (state.challenge) {
        addChallengeTP(state, state.challenge, player, rng, 1);
      }
      state.log.push(`${player.name} gains +${Math.floor(1 * TP_GAIN_MULT)} Challenge TP from Echoes in the Stone (second invocation).`);
    }
  }

  let spellPowerMultiplier = 1;
  const wasAmplified = played.resonantAmplifierActive && spellId !== "resonant_amplifier";
  if (wasAmplified) {
    spellPowerMultiplier = 2;
    played.resonantAmplifierActive = false;
  }

  const prePowerBonus = played.powerBonus;
  const applied = applyEffectHandler(spell.effect, {
    state,
    player,
    rng,
    event: "spell_cast",
    challenge,
    played,
    source: { type: "spell", id: spellId },
    spellPowerMultiplier,
    spellWasAmplified: wasAmplified,
    spellIsGenerated: wasGenerated
  });

  // Cap amplified bonus portion at +15 AP to prevent extreme combos
  if (wasAmplified && applied) {
    const bonusDelta = played.powerBonus - prePowerBonus;
    const baseDelta = bonusDelta / 2; // unamplified portion
    const amplifiedExtra = bonusDelta - baseDelta;
    if (amplifiedExtra > 15) {
      played.powerBonus = prePowerBonus + baseDelta + 15;
    }
  }

  if (applied) {
    played.invocationsCastCount = (played.invocationsCastCount ?? 0) + 1;
    if (!wasGenerated) {
      played.invocationsCastQualifyingCount = (played.invocationsCastQualifyingCount ?? 0) + 1;
    }
  }

  if (!fromArtifact) {
    const idx = player.spells.indexOf(spellId);
    if (idx >= 0) {
      player.spells.splice(idx, 1);
      state.decks.discardSpells.push(spellId);
    }
    played.spellsPlayed.push(spellId);
    player.spellsCast = (player.spellsCast ?? 0) + 1;
  }

  if (
    applied &&
    hasPassiveTeaching(player, "ritual_continuance") &&
    !played.ritualContinuanceUsed &&
    (played.invocationsCastQualifyingCount ?? 0) >= 2
  ) {
    const generated = drawSpell(state, rng);
    if (generated && grantInvocation(state, player, generated, { generated: true })) {
      played.ritualContinuanceUsed = true;
      state.log.push(`${player.name} gains a generated Invocation from Ritual Continuance.`);
    }
  }
  return applied;
}

export function applyTeachingEffect(
  state: GameState,
  challenge: ChallengeState | undefined,
  player: PlayerState,
  teachingId: string,
  rng: Rng
): void {
  const teaching = dataStore.teachingsById[teachingId];
  if (!teaching) {
    return;
  }
  if (teaching.tier !== "basic") {
    state.log.push(`${player.name} cannot consume ${teaching.name} right now.`);
    return;
  }
  const played = challenge ? challenge.played[player.id] : undefined;
  applyEffectHandler(teaching.effect, {
    state,
    player,
    rng,
    event: "teaching_played",
    challenge,
    played,
    source: { type: "teaching", id: teachingId },
    drawGameCard: () => drawGameCard(state, rng)
  });

  const idx = player.teachings.indexOf(teachingId);
  if (idx >= 0) {
    player.teachings.splice(idx, 1);
    state.decks.discardTeachingsBasic.push(teachingId);
  }

  // Track consumed basic teachings for permanent meditation bonuses
  player.consumedBasicTeachings = player.consumedBasicTeachings ?? [];
  if (!player.consumedBasicTeachings.includes(teachingId)) {
    player.consumedBasicTeachings.push(teachingId);
  }

  if (challenge) {
    challenge.played[player.id].teachingsPlayed.push(teachingId);
  }
}

export function ensureFaceDownSelection(played: ChallengeState["played"], playerId: string): void {
  const info = played[playerId];
  if (!info.faceDownId && info.selected.length > 0) {
    const highest = info.selected.reduce((best, cardId) =>
      cardValue(cardId) > cardValue(best) ? cardId : best
    );
    info.faceDownId = highest;
  }
}

export function calculateChallengeTotals(state: GameState, challenge: ChallengeState, rng: Rng): Record<string, number> {
  const totals: Record<string, number> = {};
  const allCardCount = challenge.contestants.reduce((sum, playerId) => {
    const played = challenge.played[playerId];
    return sum + played.selected.length + played.extraCards.length;
  }, 0);

  challenge.contestants.forEach((playerId) => {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) {
      return;
    }
    const played = challenge.played[playerId];
    const cards = [...played.selected, ...played.extraCards];

    const cardPowers = cards.map((cardId) => {
      return {
        id: cardId,
        base: cardValue(cardId),
        color: dataStore.cardsById[cardId]?.color,
        tags: dataStore.cardsById[cardId]?.tags ?? []
      };
    });

    const totalRef = { value: 0 };
    const baseCtx = {
      state,
      player,
      rng,
      event: "challenge_totals" as const,
      challenge,
      played,
      cardPowers,
      allCardCount,
      totalRef
    };

    const activeSpells = new Set<string>(played.spellsPlayed);
    if (played.empowerMeek) {
      activeSpells.add("empower_the_meek");
    }
    if (played.channelGroupEnergy) {
      activeSpells.add("channel_group_energy");
    }

    activeSpells.forEach((spellId) => {
      const spell = dataStore.spellsById[spellId];
      if (!spell) return;
      applyEffectHandler(spell.effect, {
        ...baseCtx,
        source: { type: "spell", id: spellId }
      });
    });

    triggerEffects("challenge_totals", baseCtx);

    played.finalCardPowers = cardPowers.map((card) => ({ cardId: card.id, power: card.base }));

    cardPowers.forEach((card) => {
      totalRef.value += card.base;
    });

    played.spellsPlayed.forEach((spellId) => {
      totalRef.value += CHALLENGE_SPELL_BASE_AP;
    });

    totalRef.value += played.powerBonus;

    totals[playerId] = totalRef.value;
  });

  // Apply reduce-all-opponents teachings
  challenge.contestants.forEach((playerId) => {
    const reduce = challenge.played[playerId].reduceAllOpponents;
    if (reduce > 0) {
      challenge.contestants.forEach((targetId) => {
        if (targetId !== playerId) {
          totals[targetId] = Math.max(0, (totals[targetId] ?? 0) - reduce);
        }
      });
    }
  });

  // Apply grounding to highest opponent
  challenge.contestants.forEach((playerId) => {
    const groundingValue = challenge.played[playerId].groundingValue;
    if (groundingValue > 0) {
      let targetId: string | undefined;
      let best = -Infinity;
      challenge.contestants.forEach((otherId) => {
        if (otherId === playerId) {
          return;
        }
        const value = totals[otherId] ?? 0;
        if (value > best) {
          best = value;
          targetId = otherId;
        }
      });
      if (targetId) {
        totals[targetId] = Math.max(0, (totals[targetId] ?? 0) - groundingValue);
      }
    }
  });

  return totals;
}

export function prepareGuardianDraft(
  state: GameState,
  challenge: ChallengeState
): { newlyUnlocked: RewardItem[]; pickOrderPlayerIds: string[]; totalGroupAp: number } {
  const totals = challenge.totals ?? {};
  const contributions = challenge.apContributionByPlayer ?? {};
  challenge.contestants.forEach((playerId) => {
    if (contributions[playerId] === undefined) {
      contributions[playerId] = totals[playerId] ?? 0;
    }
  });
  challenge.apContributionByPlayer = contributions;

  const eligible = challenge.contestants.filter((playerId) =>
    !challenge.folded.includes(playerId) && !challenge.played[playerId]?.worldseedRitualTriggered
  );
  const totalGroupAp = challenge.participants.reduce((sum, playerId) => sum + (contributions[playerId] ?? 0), 0);
  challenge.totalGroupAp = totalGroupAp;

  const newlyUnlocked: RewardItem[] = [];
  if (challenge.rewardPool) {
    const participantCount = challenge.participants.length || eligible.length || 1;
    challenge.rewardPool.rewards.forEach((reward) => {
      const finalCost = reward.finalCost ?? Math.ceil(guardianRewardBaseCost(reward) * participantCount * GUARDIAN_REWARD_COST_MULT);
      reward.finalCost = finalCost;
      const shouldUnlock = totalGroupAp >= finalCost;
      if (shouldUnlock && !reward.isUnlocked) {
        newlyUnlocked.push(reward);
      }
      reward.isUnlocked = shouldUnlock;
    });
  }

  const seatOrder = new Map<string, number>();
  state.players.forEach((player, index) => seatOrder.set(player.id, index));
  const pickOrderPlayerIds = eligible
    .map((playerId) => ({
      id: playerId,
      total: contributions[playerId] ?? totals[playerId] ?? 0,
      seat: seatOrder.get(playerId) ?? 999
    }))
    .sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      if (a.seat !== b.seat) {
        return a.seat - b.seat;
      }
      return a.id.localeCompare(b.id);
    })
    .map((entry) => entry.id);

  return { newlyUnlocked, pickOrderPlayerIds, totalGroupAp };
}

function logChallenge(state: GameState, challenge: ChallengeState, text: string): void {
  challenge.logEntries.push(text);
  state.log.push(`Challenge: ${text}`);
}

function rewardDisplayLabel(reward: RewardItem): string {
  if (reward.kind === "crystal") {
    return `${reward.count ?? 0} Crystals`;
  }
  if (reward.kind === "gameCard") {
    return dataStore.cardsById[reward.cardId ?? ""]?.name ?? "Game Card";
  }
  if (reward.kind === "spell") {
    return dataStore.spellsById[reward.cardId ?? ""]?.name ?? "Invocation";
  }
  if (reward.kind === "artifact") {
    return dataStore.artifactsById[reward.cardId ?? ""]?.name ?? "Artifact";
  }
  return "Reward";
}

export function recordChallengeApContribution(
  state: GameState,
  challenge: ChallengeState,
  playerId: string,
  delta: number,
  rng?: Rng
): RewardItem[] {
  if (delta <= 0) return [];
  challenge.apContributionByPlayer = challenge.apContributionByPlayer ?? {};
  const prevPlayer = challenge.apContributionByPlayer[playerId] ?? 0;
  const nextPlayer = prevPlayer + delta;
  challenge.apContributionByPlayer[playerId] = nextPlayer;
  const prevGroup = challenge.totalGroupAp ?? 0;
  const nextGroup = prevGroup + delta;
  challenge.totalGroupAp = nextGroup;
  const player = state.players.find((p) => p.id === playerId);
  if (player && !player.isAI && challenge.metrics) {
    challenge.metrics.apEarnedSoFar += delta;
  }

  const playerName = state.players.find((p) => p.id === playerId)?.name ?? playerId;
  logChallenge(state, challenge, `${playerName} +${delta} AP (personal ${nextPlayer}, group ${nextGroup}).`);

  const newlyUnlocked: RewardItem[] = [];
  if (challenge.rewardPool) {
    const participantCount = challenge.participants.length || 1;
    challenge.rewardPool.rewards.forEach((reward) => {
      const finalCost = reward.finalCost ?? Math.ceil(guardianRewardBaseCost(reward) * participantCount * GUARDIAN_REWARD_COST_MULT);
      reward.finalCost = finalCost;
      if (nextGroup >= finalCost && !reward.isUnlocked) {
        reward.isUnlocked = true;
        newlyUnlocked.push(reward);
      }
    });
  }

  if (newlyUnlocked.length > 0) {
    challenge.contestants.forEach((contestantId) => {
      const player = state.players.find((p) => p.id === contestantId);
      const played = challenge.played[contestantId];
      if (!player || !played) return;
      if (!hasPassiveTeaching(player, "breath_of_the_summit")) return;
      const before = played.rewardThresholdsReached ?? 0;
      const after = before + newlyUnlocked.length;
      played.rewardThresholdsReached = after;
      if (rng) addChallengeTP(state, challenge, player, rng, newlyUnlocked.length);
      state.log.push(`${player.name} gains +${Math.floor(newlyUnlocked.length * TP_GAIN_MULT)} Challenge TP from Breath of the Summit.`);
      if (before < 2 && after >= 2) {
        player.crystals += 1;
        state.log.push(`${player.name} gains 1 Crystal from Breath of the Summit.`);
      }
    });
  }

  newlyUnlocked.forEach((reward) => {
    logChallenge(state, challenge, "Guardian: A new offering awakens.");
    logChallenge(state, challenge, `Reward unlocked: ${rewardDisplayLabel(reward)}.`);
  });

  return newlyUnlocked;
}

function updateGuardianKeystones(
  state: GameState,
  challenge: ChallengeState,
  totals: Record<string, number>,
  rng: Rng
): void {
  const human = state.players.find((player) => !player.isAI);
  if (!human) return;
  const played = challenge.played[human.id];
  if (!played) return;
  if (!state.guardianKeystones) {
    state.guardianKeystones = {
      cave: { progress: 0, rareUnlocked: false, mythicUnlocked: false, crystalTier1Claimed: false, crystalTier2Claimed: false },
      mountain: { progress: 0, rareUnlocked: false, mythicUnlocked: false, crystalTier1Claimed: false, crystalTier2Claimed: false }
    };
  }
  const caveTrack = state.guardianKeystones.cave;
  const mountainTrack = state.guardianKeystones.mountain;
  const journeyType = challenge.journeyType ?? null;
  const apGain = totals[human.id] ?? 0;
  const teachingPower = [...played.selected, ...played.extraCards].reduce(
    (sum, cardId) => sum + cardTeachingPower(cardId),
    0
  );
  if (journeyType === "cave") {
    caveTrack.progress += apGain;
    state.log.push(`KeystoneProgress: cave += ${apGain} (challengeId=${challenge.id}, journeyType=cave)`);
  } else if (journeyType === "mountain") {
    mountainTrack.progress += teachingPower;
    state.log.push(`KeystoneProgress: mountain += ${teachingPower} (challengeId=${challenge.id}, journeyType=mountain)`);
  } else {
    return;
  }

  // Track keystone rewards for turn start popup
  let keystoneReward: { type: "cave" | "mountain"; reward: string } | undefined;

  // Cave Keystone rewards
  if (!caveTrack.crystalTier1Claimed && caveTrack.progress >= CAVE_CRYSTAL_TIER_1) {
    human.crystals += 3;
    caveTrack.crystalTier1Claimed = true;
    state.log.push(`Cave Keystone: Whisper milestone reached! +3 Crystals`);
    logChallenge(state, challenge, "Cave Keystone: Whisper milestone reached! +3 Crystals");
    keystoneReward = { type: "cave", reward: "+3 Crystals (Whisper)" };
  }
  if (!caveTrack.rareUnlocked && caveTrack.progress >= CAVE_RARE_THRESHOLD) {
    grantSpecificTeaching(state, human, rng, "lantern_of_the_unseen", "Cave Keystone");
    caveTrack.rareUnlocked = true;
    keystoneReward = { type: "cave", reward: "Lantern of the Unseen (Rare)" };
  }
  if (!caveTrack.crystalTier2Claimed && caveTrack.progress >= CAVE_CRYSTAL_TIER_2) {
    human.crystals += 8;
    caveTrack.crystalTier2Claimed = true;
    state.log.push(`Cave Keystone: Resonance milestone reached! +8 Crystals`);
    logChallenge(state, challenge, "Cave Keystone: Resonance milestone reached! +8 Crystals");
    keystoneReward = { type: "cave", reward: "+8 Crystals (Resonance)" };
  }
  if (!caveTrack.mythicUnlocked && caveTrack.progress >= CAVE_MYTHIC_THRESHOLD) {
    grantSpecificTeaching(state, human, rng, "echoes_in_the_stone", "Cave Keystone");
    caveTrack.mythicUnlocked = true;
    keystoneReward = { type: "cave", reward: "Echoes in the Stone (Mythic)" };
  }

  // Mountain Keystone rewards
  if (!mountainTrack.crystalTier1Claimed && mountainTrack.progress >= MOUNTAIN_CRYSTAL_TIER_1) {
    human.crystals += 3;
    mountainTrack.crystalTier1Claimed = true;
    state.log.push(`Mountain Keystone: Whisper milestone reached! +3 Crystals`);
    logChallenge(state, challenge, "Mountain Keystone: Whisper milestone reached! +3 Crystals");
    keystoneReward = { type: "mountain", reward: "+3 Crystals (Whisper)" };
  }
  if (!mountainTrack.rareUnlocked && mountainTrack.progress >= MOUNTAIN_RARE_THRESHOLD) {
    grantSpecificTeaching(state, human, rng, "breath_of_the_summit", "Mountain Keystone");
    mountainTrack.rareUnlocked = true;
    keystoneReward = { type: "mountain", reward: "Breath of the Summit (Rare)" };
  }
  if (!mountainTrack.crystalTier2Claimed && mountainTrack.progress >= MOUNTAIN_CRYSTAL_TIER_2) {
    human.crystals += 8;
    mountainTrack.crystalTier2Claimed = true;
    state.log.push(`Mountain Keystone: Resonance milestone reached! +8 Crystals`);
    logChallenge(state, challenge, "Mountain Keystone: Resonance milestone reached! +8 Crystals");
    keystoneReward = { type: "mountain", reward: "+8 Crystals (Resonance)" };
  }
  if (!mountainTrack.mythicUnlocked && mountainTrack.progress >= MOUNTAIN_MYTHIC_THRESHOLD) {
    grantSpecificTeaching(state, human, rng, "crown_of_endurance", "Mountain Keystone");
    mountainTrack.mythicUnlocked = true;
    keystoneReward = { type: "mountain", reward: "Crown of Endurance (Mythic)" };
  }

  // Track keystone reward for turn start popup
  if (keystoneReward) {
    state.previousTurnRewards[human.id] = {
      ...state.previousTurnRewards[human.id],
      keystone: keystoneReward
    };
  }
}


export function resolveChallenge(state: GameState, rng: Rng): void {
  const challenge = state.challenge;
  if (!challenge) {
    return;
  }

  challenge.contestants.forEach((playerId) => {
    ensureFaceDownSelection(challenge.played, playerId);
  });

  const totals = challenge.totals ?? calculateChallengeTotals(state, challenge, rng);

  const beforeSnapshots = snapshotChallengeResources(state, challenge);

  const claimedRewards = new Map<string, RewardItem[]>();
  if (challenge.rewardPool) {
    challenge.rewardPool.rewards.forEach((reward) => {
      if (!reward.claimedByPlayerId || !reward.isClaimed) {
        return;
      }
      const list = claimedRewards.get(reward.claimedByPlayerId) ?? [];
      list.push(reward);
      claimedRewards.set(reward.claimedByPlayerId, list);
    });
  }

  // Resolve rewards/penalties and discard played cards.
  // Locked rule: If you stay through the rite, ALL played game cards are discarded (invocations are always discarded on use).
  // If you fold, you keep your game cards (but any invocations you used are still discarded).
  challenge.contestants.forEach((playerId) => {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) {
      return;
    }
    const played = challenge.played[playerId];

    const rewardsForPlayer = claimedRewards.get(playerId) ?? [];
    const beforeSnapshot = beforeSnapshots[playerId];

    if (rewardsForPlayer.length > 0 && challenge.rewardPool) {
      applyRewardPool(state, player, { ...challenge.rewardPool, rewards: rewardsForPlayer }, rng);
      state.log.push(`${player.name} claims guardian rewards.`);
    }
    if (rewardsForPlayer.length === 0 && (totals[playerId] ?? 0) > 0 && !challenge.folded.includes(playerId)) {
      addChallengeTP(state, challenge, player, rng, 2);
      state.log.push(`${player.name} gains +${Math.floor(2 * TP_GAIN_MULT)} Challenge TP (no rewards claimed).`);
    }

    // Track journey rewards for turn start popup (compare before/after)
    if (beforeSnapshot) {
      const cardsGained = Math.max(0, player.hand.length - beforeSnapshot.hand.length);
      const invocationsGained = Math.max(0, player.spells.length - beforeSnapshot.spells.length);
      const artifactsGained = Math.max(0, player.artifacts.length - beforeSnapshot.artifacts.length);
      const crystalsGained = Math.max(0, player.crystals - beforeSnapshot.crystals);
      const teachingsGained = Math.max(0, [...player.teachings, ...player.passiveTeachings].length - beforeSnapshot.teachings.length);

      if (cardsGained > 0 || invocationsGained > 0 || artifactsGained > 0 || crystalsGained > 0 || teachingsGained > 0) {
        state.previousTurnRewards[playerId] = {
          ...state.previousTurnRewards[playerId],
          journey: {
            cards: cardsGained,
            invocations: invocationsGained,
            artifacts: artifactsGained,
            crystals: crystalsGained,
            teachings: teachingsGained
          }
        };
      }
    }

    const outcome = "DRAW" as const;

    // Track challenge outcome for AI round memory
    if (challenge.folded.includes(playerId)) {
      player.lastChallengeOutcome = "withdrew";
    } else {
      const rewardCount = rewardsForPlayer.length;
      player.lastChallengeOutcome = rewardCount > 0 ? "won" : "lost";
      if (rewardCount > 0) {
        player.runChallengesWon = (player.runChallengesWon ?? 0) + 1;
      }
    }

    const keepRef: { value?: string } = {};
    triggerEffects("challenge_resolve", {
      state,
      player,
      rng,
      event: "challenge_resolve",
      challenge,
      played,
      outcome,
      keepCardIdRef: keepRef
    });

    // Default keep rule: keep the face-down committed game card ONLY on FOLD (withdraw), unless an effect overrides it.
    if (!keepRef.value) {
      const fd = played.faceDownId;
      if (challenge.folded.includes(playerId) && fd) {
        keepRef.value = fd;
      }
    }


    // 3) Ensure played game cards are discarded (cards were already removed from hand when committed).
    {
      const kept = keepRef.value;

      const removed = new Set<string>(played.removedFromGameCards ?? []);
      const unique = new Set<string>();
      played.selected.forEach((id) => unique.add(id));
      // Extra cards were drawn for this challenge (e.g., Tribal Spirits) and should be discarded.
      played.extraCards.forEach((id) => unique.add(id));


      // If the kept card was removed from hand during commit, restore it now.
      if (kept && !removed.has(kept) && !player.hand.includes(kept)) {
        player.hand.push(kept);
      }
      unique.forEach((cardId) => {
        if (removed.has(cardId)) {
          return;
        }
        if (kept && cardId === kept) {
          return;
        }
        const idx = player.hand.indexOf(cardId);
        if (idx >= 0) {
          player.hand.splice(idx, 1);
        }
        state.decks.discardGame.push(cardId);
      });

      // If an effect kept a card, move it back from discard -> hand.
      if (kept && !removed.has(kept)) {
        const dIdx = state.decks.discardGame.lastIndexOf(kept);
        if (dIdx >= 0) {
          state.decks.discardGame.splice(dIdx, 1);
          if (!player.hand.includes(kept)) {
            player.hand.push(kept);
          }
        }
      }
    }

    if (player.activeChallengeKey === `${state.turn}-${challenge.id}`) {
      player.activeChallengeDiceBonus = 0;
      player.activeChallengeKey = undefined;
    }

  });

  updateGuardianKeystones(state, challenge, totals, rng);

  const result = buildChallengeResult(state, challenge, beforeSnapshots, totals);
  state.ui.challengeResult = result;
  state.log.push(`Guardian Challenge resolved: ${challenge.id}.`);

  state.challenge = undefined;
}

type ResourceSnapshot = {
  crystals: number;
  bonusAp: number;
  hand: string[];
  spells: string[];
  artifacts: string[];
  teachings: string[];
  earth: string[];
  ap: number;
};

function snapshotChallengeResources(state: GameState, challenge: ChallengeState): Record<string, ResourceSnapshot> {
  const snapshots: Record<string, ResourceSnapshot> = {};
  challenge.contestants.forEach((playerId) => {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) {
      return;
    }
    snapshots[playerId] = {
      crystals: player.crystals,
      bonusAp: player.bonusAp ?? 0,
      hand: [...player.hand],
      spells: [...player.spells],
      artifacts: [...player.artifacts],
      teachings: [...player.teachings, ...player.passiveTeachings],
      earth: [...player.earthAdvancementsT1, ...player.earthAdvancementsT2, ...player.earthAdvancementsT3],
      ap: finalScore(player)
    };
  });
  return snapshots;
}

function diffAdded(before: string[], after: string[]): string[] {
  const counts = new Map<string, number>();
  before.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  const added: string[] = [];
  after.forEach((id) => {
    const count = counts.get(id) ?? 0;
    if (count > 0) {
      counts.set(id, count - 1);
    } else {
      added.push(id);
    }
  });
  return added;
}

function buildChallengeResult(
  state: GameState,
  challenge: ChallengeState,
  beforeSnapshots: Record<string, ResourceSnapshot>,
  totals: Record<string, number>
): ChallengeResult {
  const contributions = challenge.apContributionByPlayer ?? {};
  const participants = challenge.contestants.map((playerId) => {
    const player = state.players.find((p) => p.id === playerId);
    const before = beforeSnapshots[playerId];
    if (!player || !before) {
      return {
        playerId,
        playerName: "Unknown",
        playerAvatar: "👤",
        outcome: "DRAW" as const,
        totalPower: 0,
        cardsPlayed: [],
        delta: {}
      };
    }

    const afterAp = finalScore(player);
    const crystalsDelta = Math.max(0, player.crystals - before.crystals);
    const bonusApDelta = Math.max(0, (player.bonusAp ?? 0) - (before.bonusAp ?? 0));
    const spellsAddedIds = diffAdded(before.spells, player.spells);
    const teachingsAddedIds = diffAdded(before.teachings, [...player.teachings, ...player.passiveTeachings]);
    const artifactsAddedIds = diffAdded(before.artifacts, player.artifacts);
    const cardsAddedIds = diffAdded(before.hand, player.hand);
    const earthAddedIds = diffAdded(before.earth, [...player.earthAdvancementsT1, ...player.earthAdvancementsT2, ...player.earthAdvancementsT3]);

    const spellsAdded = spellsAddedIds.map((id) => dataStore.spellsById[id]?.name ?? id);
    const teachingsAdded = teachingsAddedIds.map((id) => dataStore.teachingsById[id]?.name ?? id);
    const artifactsAdded = artifactsAddedIds.map((id) => dataStore.artifactsById[id]?.name ?? id);
    const cardsAdded = cardsAddedIds.map((id) => dataStore.cardsById[id]?.name ?? id);

    const delta: ChallengeRewardDelta = {};
    if (crystalsDelta > 0) delta.crystals = crystalsDelta;
    const apDelta = Math.max(0, afterAp - before.ap);
    if (apDelta > 0) delta.ap = apDelta;
    if (teachingsAdded.length > 0) delta.teachings = teachingsAdded;
    if (spellsAdded.length > 0) delta.spells = spellsAdded;
    if (artifactsAdded.length > 0) delta.artifacts = artifactsAdded;
    if (cardsAdded.length > 0) delta.cards = cardsAdded;

    const withdrew = challenge.folded.includes(playerId);
    const outcome = "DRAW";

    const canRevealAll = !player.isAI || state.hotseatReveal;
    const played = challenge.played[playerId];

    const isCardHidden = (cardId: string): boolean => {
      if (!played) return false;
      const hiddenIds = played.hiddenCardIds && played.hiddenCardIds.length > 0
        ? played.hiddenCardIds
        : (played.faceDownId ? [played.faceDownId] : []);
      return hiddenIds.includes(cardId);
    };
    const isCardRevealedEarly = (cardId: string): boolean =>
      challenge.revealedEarly.some((entry) => entry.playerId === playerId && entry.cardId === cardId);

    const cardsPlayed = played
      ? played.selected.map((cardId) => {
          if (isCardHidden(cardId) && !canRevealAll && !isCardRevealedEarly(cardId)) {
            return "Face-down card";
          }
          return dataStore.cardsById[cardId]?.name ?? cardId;
        }).concat(
          played.extraCards.map((cardId) => {
            const source = played.extraCardSources?.[cardId] ?? "Extra";
            const name = dataStore.cardsById[cardId]?.name ?? cardId;
            return `${source} - ${name}`;
          }),
          played.spellsPlayed.map((spellId) => `Invocation: ${dataStore.spellsById[spellId]?.name ?? spellId}`)
        )
      : [];

    // --- Locked transparency breakdowns ---
    const powerBreakdown: string[] = [];
    if (played) {
      const extraSources = played.extraCardSources ?? {};
      const allPlayedCards = [...played.selected, ...played.extraCards];
      allPlayedCards.forEach((cardId) => {
        const isHidden = isCardHidden(cardId);
        const baseName = isHidden && !canRevealAll && !isCardRevealedEarly(cardId)
          ? "Face-down card"
          : (dataStore.cardsById[cardId]?.name ?? cardId);
        const isExtra = played.extraCards.includes(cardId);
        const source = isExtra ? (extraSources[cardId] ?? "Extra") : undefined;
        const name = source ? `${source} - ${baseName}` : baseName;
        const finalPower =
          played.finalCardPowers?.find((entry) => entry.cardId === cardId)?.power
          ?? cardValue(cardId);
        powerBreakdown.push(`Card: ${name} (+${finalPower} AP) from card`);
      });
      played.spellsPlayed.forEach((spellId) => {
        const name = dataStore.spellsById[spellId]?.name ?? spellId;
        powerBreakdown.push(`Invocation: ${name} (+${CHALLENGE_SPELL_BASE_AP} AP)`);
      });
      (played.powerBonusBreakdown ?? []).forEach((entry) => {
        const sourceLabel = entry.source === "invocation" ? "from invocation" : entry.source === "artifact" ? "from artifact" : "from teaching";
        powerBreakdown.push(`${entry.label} (+${entry.amount} AP) ${sourceLabel}`);
      });
    }

    const apBreakdown: string[] = [];
    let apBreakdownSum = 0;
    const rewardBreakdown: string[] = [];
    const provenance = "Guardian draft";

    if (crystalsDelta > 0) {
      const ap = crystalsDelta * CRYSTAL_VALUE;
      apBreakdownSum += ap;
      apBreakdown.push(`Crystals: +${crystalsDelta} (=${ap} AP)`);
      rewardBreakdown.push(`Crystals +${formatCrystals(crystalsDelta)} (${provenance})`);
    }
    if (bonusApDelta > 0) {
      apBreakdownSum += bonusApDelta;
      apBreakdown.push(`Bonus AP: +${bonusApDelta} AP`);
      rewardBreakdown.push(`Bonus AP +${bonusApDelta} (${provenance})`);
    }

    // Items gained: show name + the AP they contribute to final score.
    diffAdded(before.hand, player.hand).forEach((id) => {
      const name = dataStore.cardsById[id]?.name ?? id;
      const ap = cardValue(id);
      apBreakdownSum += ap;
      apBreakdown.push(`Game Card: ${name} (+${ap} AP)`);
      rewardBreakdown.push(`Game Card: ${name} (${provenance})`);
    });
    diffAdded(before.spells, player.spells).forEach((id) => {
      const name = dataStore.spellsById[id]?.name ?? id;
      const ap = spellValue(id);
      apBreakdownSum += ap;
      apBreakdown.push(`Invocation: ${name} (+${ap} AP)`);
      rewardBreakdown.push(`Invocation: ${name} (${provenance})`);
    });
    diffAdded(before.artifacts, player.artifacts).forEach((id) => {
      const name = dataStore.artifactsById[id]?.name ?? id;
      const ap = artifactValue(id);
      apBreakdownSum += ap;
      apBreakdown.push(`Artifact: ${name} (+${ap} AP)`);
      rewardBreakdown.push(`Artifact: ${name} (${provenance})`);
    });
    earthAddedIds.forEach((advId) => {
      const adv = dataStore.earthAdvancements.find((c) => c.id === advId);
      const name = adv?.name ?? advId;
      const ap = adv ? earthAdvancementAp(adv) : 0;
      apBreakdownSum += ap;
      apBreakdown.push(`Earth Advancement: ${name} (+${ap} AP)`);
      rewardBreakdown.push(`Earth Advancement: ${name} (${provenance})`);
    });

    // Teachings do not currently contribute to AP, but we still show provenance for clarity.
    diffAdded(before.teachings, [...player.teachings, ...player.passiveTeachings]).forEach((id) => {
      const name = dataStore.teachingsById[id]?.name ?? id;
      rewardBreakdown.push(`Teaching: ${name} (${provenance})`);
    });

    // If anything else changed the score, surface it.
    const apDeltaCheck = Math.max(0, afterAp - before.ap);
    if (apDeltaCheck > 0 && apBreakdownSum !== apDeltaCheck) {
      const extra = apDeltaCheck - apBreakdownSum;
      if (extra !== 0) {
        apBreakdown.push(`Other score changes: ${extra >= 0 ? "+" : ""}${extra} AP`);
      }
    }

    const contributionTotal = contributions[playerId] ?? totals[playerId] ?? 0;
    const challengeTP = challenge.challengeTPByPlayer?.[playerId] ?? 0;
    const thresholds = challenge.challengeTPThresholdsAwarded?.[playerId];
    const tpTeachingsGained: string[] = [];
    if (thresholds?.basic) tpTeachingsGained.push("Basic");
    if (thresholds?.rare) tpTeachingsGained.push("Rare");
    if (thresholds?.mythic) tpTeachingsGained.push("Mythic");

    return {
      playerId,
      playerName: player.name,
      playerAvatar: player.avatar,
      outcome: outcome as "DRAW",
      withdrew,
      totalPower: contributionTotal,
      challengeTP,
      tpTeachingsGained,
      cardsPlayed,
      artifactEffects: played?.artifactEffects,
      delta,
      powerBreakdown,
      apBreakdown,
      rewardBreakdown,
    };
  });

  // Calculate keystone progress for human player
  const human = state.players.find((p) => !p.isAI);
  let keystoneProgress: ChallengeResult["keystoneProgress"] = undefined;
  if (human && challenge.journeyType) {
    const track = challenge.journeyType === "cave" 
      ? state.guardianKeystones?.cave 
      : state.guardianKeystones?.mountain;
    if (track) {
      const gained = challenge.journeyType === "cave"
        ? (totals[human.id] ?? 0)
        : [...(challenge.played[human.id]?.selected ?? []), ...(challenge.played[human.id]?.extraCards ?? [])]
            .reduce((sum, cardId) => sum + cardTeachingPower(cardId), 0);
      keystoneProgress = {
        type: challenge.journeyType,
        gained,
        totalBefore: Math.max(0, track.progress - gained),
        totalAfter: track.progress
      };
    }
  }

  return {
    id: challenge.id,
    turn: state.turn,
    challengeName: challenge.id,
    journeyType: challenge.journeyType ?? null,
    participants,
    keystoneProgress
  };
}

export function clearSelections(state: GameState): void {
  state.players.forEach((player) => {
    player.action = undefined;
    player.locked = false;
  });
  state.ui.selectedAction = undefined;
  state.ui.selectedCards = [];
  state.ui.selectedFaceDown = undefined;
  state.ui.pendingSpellId = undefined;
  state.ui.pendingEscalationCardIndex = undefined;
}

export function resolveUncontestedActions(state: GameState, rng: Rng, action: ActionChoice, players: PlayerState[]): void {
  players.forEach((player) => {
    switch (action) {
      case "MEDITATE":
        meditate(state, player, rng);
        break;
      case "EARTH": {
        const tier = player.earthTierChoice ?? 1;
        if (!buyEarthAdvancement(state, player, tier, rng)) {
          state.log.push(`${player.name} could not complete an Earth Advancement (Tier ${tier}).`);
        }
        break;
      }
      default:
        break;
    }
  });
}
