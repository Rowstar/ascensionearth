import { dataStore } from "./state";
import { ActionChoice, ChallengeState, GameState, PlayerState } from "./types";
import {
  canBuyEarthAdvancement,
  cardValue,
  earthAdvancementMissingRequirements,
  rewardPoolValue,
  CHALLENGE_COMMIT_MAX,
  SHOP_CARD_COST,
  SHOP_INVOCATION_COST
} from "./rules";
import { Rng } from "./rng";

type Weighted<T> = { item: T; w: number };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function softmaxPick<T>(rng: Rng, options: Weighted<T>[], temperature: number): T {
  // Numerically stable softmax sampling.
  const t = Math.max(0.05, temperature);
  const maxW = Math.max(...options.map((o) => o.w));
  const exps = options.map((o) => Math.exp((o.w - maxW) / t));
  const sum = exps.reduce((a, b) => a + b, 0);
  let r = rng.next() * sum;
  for (let i = 0; i < options.length; i += 1) {
    r -= exps[i];
    if (r <= 0) return options[i].item;
  }
  return options[options.length - 1].item;
}

// We intentionally avoid reading *any* opponent hidden hand/spell contents here.
// The AI should feel smart, not psychic.
function publicEstimateOpponentPower(state: GameState, opponent: PlayerState): number {
  // Baseline guess: scales with game progression so AI adapts to power creep.
  const base = 7 + state.turn * 0.8;
  const artifactBoost = (opponent.artifacts?.length ?? 0) * 1.6;
  const spellBoost = (opponent.spells?.length ?? 0) * 0.9;
  const teachingBoost = ((opponent.teachings?.length ?? 0) + (opponent.passiveTeachings?.length ?? 0)) * 0.35;
  const economyBoost = clamp(opponent.crystals / 50, 0, 3);
  const earthBoost =
    ((opponent.earthAdvancementsT1?.length ?? 0) +
      (opponent.earthAdvancementsT2?.length ?? 0) +
      (opponent.earthAdvancementsT3?.length ?? 0)) * 0.4;
  // Tiny noise so AI isn't perfectly consistent.
  const jitter = (hashToUnit(opponent.id + String(state.turn)) - 0.5) * 1.5;
  return base + artifactBoost + spellBoost + teachingBoost + economyBoost + earthBoost + jitter;
}

function hashToUnit(s: string): number {
  // Simple deterministic hash -> [0,1)
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function handAveragePower(player: PlayerState): number {
  if (player.hand.length === 0) {
    return 0;
  }
  const total = player.hand.reduce((sum, cardId) => sum + cardValue(cardId), 0);
  return total / player.hand.length;
}

function hasSpell(player: PlayerState, spellId: string): boolean {
  return player.spells.includes(spellId);
}

function estimateHandStrength(player: PlayerState): number {
  let score = handAveragePower(player);
  if (player.spells.length > 0) {
    score += 2;
  }
  if (player.artifacts.includes("giant_crystal")) {
    score += 3;
  }
  return score;
}

export function chooseAiEarthTier(state: GameState, player: PlayerState): 1 | 2 | 3 {
  if (canBuyEarthAdvancement(state, player, 3)) return 3;
  if (canBuyEarthAdvancement(state, player, 2)) return 2;
  if (canBuyEarthAdvancement(state, player, 1)) return 1;

  const tiers: Array<1 | 2 | 3> = [3, 2, 1];
  const scored = tiers.map((tier) => {
    const nextId = tier === 1 ? state.decks.earthAdvancementsT1[0] : tier === 2 ? state.decks.earthAdvancementsT2[0] : state.decks.earthAdvancementsT3[0];
    const card = nextId ? dataStore.earthAdvancementsById[nextId] : undefined;
    if (!card) return { tier, score: -999 };
    const missing = earthAdvancementMissingRequirements(card, player);
    const score = (card.apReward ?? 0) - missing.length * 5;
    return { tier, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.tier ?? 1;
}

function aiEarthNeeds(state: GameState, player: PlayerState): { wantsCards: boolean; wantsInvocations: boolean } {
  const tier = chooseAiEarthTier(state, player);
  const nextId = tier === 1 ? state.decks.earthAdvancementsT1[0] : tier === 2 ? state.decks.earthAdvancementsT2[0] : state.decks.earthAdvancementsT3[0];
  const card = nextId ? dataStore.earthAdvancementsById[nextId] : undefined;
  if (!card) {
    return { wantsCards: false, wantsInvocations: false };
  }
  const req = card.requirements ?? { crystals: 0 };
  const rarityNeed =
    (req.cardsByRarity?.common ?? 0) +
    (req.cardsByRarity?.uncommon ?? 0) +
    (req.cardsByRarity?.rare ?? 0) +
    (req.cardsByRarity?.cosmic ?? 0);
  const wantsCards = (req.cardsAny ?? 0) + rarityNeed > 0;
  const wantsInvocations = Math.max(0, req.spells ?? 0) + Math.max(0, req.invocations ?? 0) > 0;
  return { wantsCards, wantsInvocations };
}

export function decideAiAction(state: GameState, player: PlayerState, rng: Rng): ActionChoice {
  // The AI chooses using a softmax over utilities so it feels smart *and* less predictable.
  // Utilities include expected reward, contest risk, economy needs, and late-game urgency.

  const ascensionProgress = state.earthAscensionTarget > 0 ? state.earthAscensionPower / state.earthAscensionTarget : 0;
  const lateGame = ascensionProgress >= 0.75 || state.turn >= 8;
  const myEconomy = player.crystals;
  const myHand = player.hand.length;
  const mySpells = player.spells.length;
  const myTeachings = player.teachings.length + player.passiveTeachings.length;

  const mountainValue = rewardPoolValue(state.rewardPools.mountain);
  const caveValue = rewardPoolValue(state.rewardPools.cave);

  const earthRemaining =
    state.decks.earthAdvancementsT1.length + state.decks.earthAdvancementsT2.length + state.decks.earthAdvancementsT3.length;
  const canBuyEarth =
    earthRemaining > 0 &&
    (canBuyEarthAdvancement(state, player, 1) || canBuyEarthAdvancement(state, player, 2) || canBuyEarthAdvancement(state, player, 3));
  const preferredEarthTier = chooseAiEarthTier(state, player);
  const preferredEarthId =
    preferredEarthTier === 1 ? state.decks.earthAdvancementsT1[0] : preferredEarthTier === 2 ? state.decks.earthAdvancementsT2[0] : state.decks.earthAdvancementsT3[0];
  const preferredEarth = preferredEarthId ? dataStore.earthAdvancementsById[preferredEarthId] : undefined;
  const earthMissing = preferredEarth ? earthAdvancementMissingRequirements(preferredEarth, player).length : 99;

  // Rough prediction of how attractive each action is to opponents (no hidden info).
  const opponents = state.players.filter((p) => p.id !== player.id);
  const oppPull = {
    MEDITATE: 0,
    MOUNTAIN: 0,
    CAVE: 0,
    EARTH: 0
  } as Record<ActionChoice, number>;
  opponents.forEach((opp) => {
    const oppEco = opp.crystals;
    const oppCanEarth =
      earthRemaining > 0 &&
      (canBuyEarthAdvancement(state, opp, 1) || canBuyEarthAdvancement(state, opp, 2) || canBuyEarthAdvancement(state, opp, 3));
    // Opponent action "pull" is a heuristic preference score.
    oppPull.MEDITATE += opp.spells.length === 0 || opp.hand.length < 3 ? 1.2 : 0.2;
    oppPull.MOUNTAIN += mountainValue / 10;
    oppPull.CAVE += caveValue / 10;
    oppPull.EARTH += oppCanEarth ? 1.2 + oppEco / 150 : 0;
  });
  const contestProbMountain = clamp(oppPull.MOUNTAIN / (oppPull.MOUNTAIN + oppPull.CAVE + 0.0001), 0.25, 0.75);
  const contestProbCave = clamp(oppPull.CAVE / (oppPull.MOUNTAIN + oppPull.CAVE + 0.0001), 0.25, 0.75);
  const competitionHeat = (contestProbMountain + contestProbCave) * 0.5;

  // Journeys now always lead to a challenge, so this burn is guaranteed (not contest-probability-weighted).
  const avgCard = handAveragePower(player) || 10;
  const avgSpell = 10; // spells tend to be strong; treat as premium.
  const guaranteedChallengeBurn = avgCard * Math.min(2, myHand) + (mySpells > 0 ? avgSpell : 0);
  const challengeReadiness = clamp((myHand + mySpells) / CHALLENGE_COMMIT_MAX, 0, 1);
  const readinessPenalty = (1 - challengeReadiness) * 10 + (myHand + mySpells === 0 ? 8 : 0);

  // Value of meditating: cards + invocation.
  const meditateValue = 2 * (avgCard * 0.9) + (mySpells === 0 ? 11 : 8);
  const needRefillBoost = clamp((3 - myHand) * 2.4 + (mySpells === 0 ? 4 : 0), 0, 14);

  // Earth purchase value is hard to compute without peeking deck order; treat it as score+tempo.
  const nearEarth = earthMissing <= 2;
  const earthValue = canBuyEarth
    ? 18 + clamp(myEconomy / 45, 0, 10) + (lateGame ? 6 : 0)
    : nearEarth
      ? 8 + (lateGame ? 3 : 0) - earthMissing * 2
      : -999;

  // Journey utilities: expected pool reward - expected burn risk + situational boosts.
  const journeyBoost = clamp((myTeachings > 0 ? 1 : 0) + (mySpells > 0 ? 1 : 0), 0, 2);
  const mountainUtil = mountainValue + journeyBoost * 2 + competitionHeat * 1.2 - guaranteedChallengeBurn * 0.62 - readinessPenalty;
  const caveUtil = caveValue + journeyBoost * 2 + competitionHeat * 1.2 - guaranteedChallengeBurn * 0.62 - readinessPenalty;

  // Meditate becomes more attractive if hand/spells are low or early game.
  // Round memory: after poor challenge, prefer meditate (restock); after success, be more aggressive.
  let memoryBias = 0;
  if (player.lastChallengeOutcome === "lost" || player.lastChallengeOutcome === "withdrew") {
    memoryBias = 3;
  } else if (player.lastChallengeOutcome === "won") {
    memoryBias = -2;
  }
  const emergencyRefillBoost = myHand + mySpells === 0 ? 10 : (myHand === 0 || mySpells === 0 ? 3 : 0);
  const meditateUtil = meditateValue + needRefillBoost + emergencyRefillBoost + (lateGame ? -2 : 1) + memoryBias;

  // Earth becomes more attractive late-game and if we have currency.
  const earthUtil = earthValue;

  // Small personal style variance per AI so they don't all behave the same.
  const style = hashToUnit(player.id + state.seed);
  const riskAppetite = 0.7 + style * 0.9; // 0.7..1.6
  const meditative = 0.8 + (1 - style) * 0.8; // 0.8..1.6

  const options: Weighted<ActionChoice>[] = [
    { item: "MEDITATE" as ActionChoice, w: meditateUtil * meditative },
    { item: "MOUNTAIN" as ActionChoice, w: mountainUtil * riskAppetite },
    { item: "CAVE" as ActionChoice, w: caveUtil * riskAppetite },
    { item: "EARTH" as ActionChoice, w: earthUtil }
  ].filter((o) => o.w > -100);

  // Temperature: higher earlier (more variety), lower late-game (more focused).
  const temperature = lateGame ? 0.55 : 0.9;
  return softmaxPick(rng, options, temperature);
}

function scoreCardForChallenge(player: PlayerState, cardId: string): number {
  const data = dataStore.cardsById[cardId];
  if (!data) {
    return 0;
  }
  let score = data.basePower;
  if (player.artifacts.includes("sacred_plant_seed") && data.tags.includes("Plant")) {
    score += 4;
  }
  if (player.artifacts.includes("mysterious_totem") && data.tags.includes("Animal")) {
    score = Math.max(score, 18);
  }
  if (player.artifacts.includes("cosmic_robes") && data.tags.includes("Human")) {
    score += 2;
  }
  return score;
}

export function chooseCardsForChallenge(player: PlayerState, rng: Rng): { selected: string[]; faceDownId?: string } {
  // Pick 2 cards with weighted randomness to avoid always playing the obvious top two.
  // This creates bluffing and variety without tanking the AI's strength.
  const scored = player.hand.map((cardId) => ({ cardId, score: scoreCardForChallenge(player, cardId) }));
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, Math.min(5, scored.length));
  if (top.length === 0) return { selected: [], faceDownId: undefined };
  if (top.length === 1) return { selected: [top[0].cardId], faceDownId: top[0].cardId };

  // Weights favour higher scores, but still allow occasional "style" plays.
  const pick1 = softmaxPick(rng, top.map((t) => ({ item: t.cardId, w: t.score })), 0.7);
  const remaining = top.filter((t) => t.cardId !== pick1);
  const pick2 = softmaxPick(rng, remaining.map((t) => ({ item: t.cardId, w: t.score })), 0.85);
  const selected = [pick1, pick2];

  // Face-down selection: usually hide the stronger card, but sometimes show strength early.
  const s1 = scoreCardForChallenge(player, pick1);
  const s2 = scoreCardForChallenge(player, pick2);
  const stronger = s1 >= s2 ? pick1 : pick2;
  const weaker = stronger === pick1 ? pick2 : pick1;
  const showStrength = rng.nextInt(0, 99) < 22; // 22%: make the stronger card face-up
  const faceDownId = showStrength ? weaker : stronger;
  return { selected, faceDownId };
}

export function chooseSpellToPlay(state: GameState, challenge: ChallengeState, player: PlayerState, rng: Rng): string | undefined {
  const played = challenge.played[player.id];
  if (!played) {
    return undefined;
  }

  const allCards = [...played.selected, ...played.extraCards];
  const hasGrey = allCards.some((cardId) => dataStore.cardsById[cardId]?.color === "Grey");
  const hasGold = allCards.some((cardId) => dataStore.cardsById[cardId]?.color === "Gold");
  const totalCards = played.selected.length + played.extraCards.length;
  const otherInvocationCount = player.spells.filter((id) => id !== "resonant_amplifier").length;

  // Context-aware spell preference weights
  const candidates: Weighted<string>[] = [];
  const smallHand = player.hand.length <= 3;
  const greyCount = allCards.filter((id) => dataStore.cardsById[id]?.color === "Grey").length;
  const goldCount = allCards.filter((id) => dataStore.cardsById[id]?.color === "Gold").length;

  if (hasSpell(player, "tribal_spirits")) {
    // Tribal Spirits scales with small hands (more value when you need cards)
    candidates.push({ item: "tribal_spirits", w: smallHand ? 14 : 9 });
  }
  if (hasSpell(player, "empower_the_meek") && hasGrey && hasGold && !played.empowerMeek) {
    // Scales with how many grey/gold cards committed
    candidates.push({ item: "empower_the_meek", w: 8 + Math.min(greyCount, 2) * 2 + Math.min(goldCount, 2) * 2 });
  }
  if (hasSpell(player, "channel_group_energy") && totalCards >= 3) {
    // Scales with total committed cards (lowered threshold from 4 to 3 for 3-card max)
    candidates.push({ item: "channel_group_energy", w: 5 + totalCards * 1.2 });
  }
  if (hasSpell(player, "third_eye_awakening")) {
    // More valuable early in challenge when info matters
    const earlyCommit = played.selected.length <= 1;
    candidates.push({ item: "third_eye_awakening", w: earlyCommit ? 9 : 5 });
  }
  if (hasSpell(player, "resonant_amplifier") && !played.resonantAmplifierActive) {
    // Much better when other invocations are available to amplify
    const weight = otherInvocationCount > 0 ? 10 + otherInvocationCount : 3;
    candidates.push({ item: "resonant_amplifier", w: weight });
  }
  if (hasSpell(player, "confluence_of_voices")) {
    // Scales with total invocation count
    const weight = 6 + Math.min(5, player.spells.length) * 1.5;
    candidates.push({ item: "confluence_of_voices", w: weight });
  }

  if (candidates.length === 0) return undefined;

  // Slight randomness prevents identical play lines.
  return softmaxPick(rng, candidates, 0.6);
}

export type AiEscalationDecision =
  | { kind: "FOLD" }
  | { kind: "PASS" }
  | { kind: "CARD"; cardId: string }
  | { kind: "SPELL"; spellId: string }
  | { kind: "TEACHING"; teachingId: string };

function visibleCommittedPowerFor(playerId: string, challenge: ChallengeState): number {
  const played = challenge.played[playerId];
  if (!played) return 0;
  // Only count face-up cards here (can't assume face-down).
  const hiddenIds = played.hiddenCardIds && played.hiddenCardIds.length > 0
    ? played.hiddenCardIds
    : (played.faceDownId ? [played.faceDownId] : []);
  const faceUp = played.selected.filter((cid) => !hiddenIds.includes(cid));
  const extra = played.extraCards;
  const cards = [...faceUp, ...extra];
  return cards.reduce((s, cid) => s + cardValue(cid), 0);
}

function myTotalCommittedPower(playerId: string, challenge: ChallengeState): number {
  const played = challenge.played[playerId];
  if (!played) return 0;
  const cards = [...played.selected, ...played.extraCards];
  return cards.reduce((s, cid) => s + cardValue(cid), 0);
}

export function decideAiEscalation(state: GameState, challenge: ChallengeState, player: PlayerState, rng: Rng): AiEscalationDecision {
  const played = challenge.played[player.id];
  if (!played) return { kind: "PASS" };

  // Optional teaching use: save big teachings for when behind.
  const teaching = shouldUseTeaching(state, challenge, player);

  const canCast = player.spells.length > 0 && played.spellsPlayed.length < 1;
  const spell = canCast ? chooseSpellToPlay(state, challenge, player, rng) : undefined;

  const availableCards = player.hand.filter((cid) => !played.selected.includes(cid));
  const canAddCard = availableCards.length > 0 && (played.selected.length + played.extraCards.length) < 3;
  let bestCard = availableCards[0];
  availableCards.forEach((cid) => {
    if (cardValue(cid) > cardValue(bestCard)) bestCard = cid;
  });

  // Compare ourselves to opponents (visible + heuristic).
  const myNow = myTotalCommittedPower(player.id, challenge);
  const oppIds = challenge.contestants.filter((id) => id !== player.id && !challenge.folded.includes(id));
  const oppEst = oppIds.map((id) => {
    const opp = state.players.find((p) => p.id === id);
    return visibleCommittedPowerFor(id, challenge) + (opp ? publicEstimateOpponentPower(state, opp) * 0.35 : 4);
  });
  const bestOpp = Math.max(0, ...oppEst);
  const gap = bestOpp - myNow;

  // Create weighted decision options.
  const opts: Weighted<AiEscalationDecision>[] = [];

  // Fold option: only after you've committed at least one item.
  if (played.selected.length + played.spellsPlayed.length > 0) {
    const foldW = clamp((gap - 6) / 10, 0, 0.8) * 8;
    if (foldW > 0.2) opts.push({ item: { kind: "FOLD" }, w: foldW });
  }

  // If behind, prioritize swing actions.
  if (teaching && gap > 4) opts.push({ item: { kind: "TEACHING", teachingId: teaching }, w: 7 + gap / 2 });
  if (spell) opts.push({ item: { kind: "SPELL", spellId: spell }, w: 6 + gap / 2 });
  if (canAddCard) opts.push({ item: { kind: "CARD", cardId: bestCard }, w: 5 + (gap > 0 ? gap / 2 : 0) });

  // If ahead, sometimes pass to conserve resources / appear calm.
  const passW = gap <= 0 ? 7 + (-gap) / 2 : 3;
  opts.push({ item: { kind: "PASS" }, w: passW });

  return softmaxPick(rng, opts, 0.75);
}

export function shouldUseTeaching(state: GameState, challenge: ChallengeState, player: PlayerState): string | undefined {
  const played = challenge.played[player.id];
  if (!played) {
    return undefined;
  }

  const available = player.teachings.filter((t) =>
    t === "open_attention" || t === "prepared_mind" || t === "heightened_curiosity"
  );
  if (available.length === 0) return undefined;

  const chalTP = challenge.challengeTPByPlayer?.[player.id] ?? 0;
  const committedCount = played.selected.length + played.spellsPlayed.length;

  // Heightened Curiosity: use when near a TP threshold (grants most TP)
  if (available.includes("heightened_curiosity") && (chalTP >= 7 || chalTP >= 20)) {
    return "heightened_curiosity";
  }
  // Open Attention: use early for crystal economy benefit
  if (available.includes("open_attention") && committedCount <= 1) {
    return "open_attention";
  }
  // Prepared Mind: use when AP matters (committed cards on the table)
  if (available.includes("prepared_mind") && committedCount >= 2) {
    return "prepared_mind";
  }
  // Fallback: use whatever is available if we have 2+ commits
  if (committedCount >= 2) {
    return available[0];
  }

  return undefined;
}

export function considerEarthPurchase(state: GameState, player: PlayerState): boolean {
  return canBuyEarthAdvancement(state, player, 3) || canBuyEarthAdvancement(state, player, 2) || canBuyEarthAdvancement(state, player, 1);
}


export type ShopPurchaseChoice = "CARD" | "SPELL" | null;

export function decideAiShopPurchase(
  state: GameState,
  player: PlayerState,
  rng: Rng,
  planned?: { plannedCard?: number; plannedSpell?: number }
): ShopPurchaseChoice {
  // The shop is an optional, once-per-turn micro-action (cards + spells only).
  // We want the AI to use it intelligently but not deterministically.
  if (state.phase !== "ACTION_SELECT") return null;
  const hasDoctrine = player.passiveTeachings.includes("doctrine_of_abundance");
  const purchasesCard = planned?.plannedCard ?? player.purchasesCardThisTurn ?? 0;
  const purchasesSpell = planned?.plannedSpell ?? player.purchasesSpellThisTurn ?? 0;
  const totalPurchases = purchasesCard + purchasesSpell;
  if (!hasDoctrine && totalPurchases >= 1) return null;

  const ascensionProgress = state.earthAscensionTarget > 0 ? state.earthAscensionPower / state.earthAscensionTarget : 0;
  const lateGame = ascensionProgress >= 0.75 || state.turn >= 8;

  const crystalsTotal = player.crystals;
  const canBuyCard = crystalsTotal >= SHOP_CARD_COST && (hasDoctrine ? purchasesCard < 2 : totalPurchases < 1);
  const canBuySpell = crystalsTotal >= SHOP_INVOCATION_COST && (hasDoctrine ? purchasesSpell < 2 : totalPurchases < 1);

  if (!canBuyCard && !canBuySpell) return null;

  // If buying would likely block an Earth Advancement this turn in late game, avoid it.
  const earthRemaining =
    state.decks.earthAdvancementsT1.length + state.decks.earthAdvancementsT2.length + state.decks.earthAdvancementsT3.length;
  if (earthRemaining > 0) {
    const canEarthNow =
      canBuyEarthAdvancement(state, player, 1) || canBuyEarthAdvancement(state, player, 2) || canBuyEarthAdvancement(state, player, 3);

    if (canEarthNow && lateGame) {
      // Late game: prefer converting currency into guaranteed progress rather than shopping.
      // Still allow a small chance to shop (spicy unpredictability).
      if (rng.next() < 0.85) return null;
    }
  }

  const myHand = player.hand.length;
  const mySpells = player.spells.length;

  const mountainValue = rewardPoolValue(state.rewardPools.mountain);
  const caveValue = rewardPoolValue(state.rewardPools.cave);
  const contestHeat = clamp((mountainValue + caveValue) / 60, 0, 1); // higher pools -> more likely contests

  // Desire signals
  const needCards = clamp((4 - myHand) / 4, 0, 1); // strong if hand is small
  const needSpells = clamp((2 - mySpells) / 2, 0, 1); // strong if spells are low
  const earthNeeds = aiEarthNeeds(state, player);

  // Utilities: prefer spells when contests are hot; prefer cards when hand is thin.
  let uCard = 0.4 + 1.2 * needCards + 0.3 * (crystalsTotal >= 8 ? 1 : 0) - 0.25; // cost pressure
  let uSpell = 0.3 + 1.4 * needSpells + 0.8 * contestHeat + (lateGame ? 0.25 : 0) - 0.55; // more expensive
  if (earthNeeds.wantsCards) {
    uCard += 0.6;
  }
  if (earthNeeds.wantsInvocations) {
    uSpell += 0.8;
  }

  // If we can't afford something, nuke its utility.
  if (!canBuyCard) uCard = -999;
  if (!canBuySpell) uSpell = -999;

  // Add slight personal variance so AIs don't all behave identically.
  const personalityJitter = (player.id.charCodeAt(0) % 7) / 30; // 0..0.2-ish stable
  uCard += (rng.next() - 0.5) * 0.25 + personalityJitter * 0.10;
  uSpell += (rng.next() - 0.5) * 0.25 - personalityJitter * 0.05;

  const options: Weighted<ShopPurchaseChoice>[] = [
    { item: null, w: 0.35 }, // frequently skip; shop shouldn't dominate
    { item: "CARD", w: Math.exp(uCard) },
    { item: "SPELL", w: Math.exp(uSpell) }
  ];
  return softmaxPick(rng, options, 1.0);
}

// ENGINE-ONLY: AI respects withdraw/teaching rules (logic stub)
