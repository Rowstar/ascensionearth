import { GameState, PlayerState, ProgressReviewBaseline, ProgressReviewState, TrophyChoice, TrophyPassiveBuff } from "./types";
import { Rng } from "./rng";

export const PROGRESS_REVIEW_INTERVAL = 5;
export const PROGRESS_REVIEW_WARNING_LEAD = 1;
const TROPHY_OFFER_COUNT = 3;

type TrophyDefinition = {
  id: string;
  name: string;
  shortDescription: string;
  baseAp: number;
  roundScaleAp: number;
  passiveBuff?: TrophyPassiveBuff;
};

const TROPHY_POOL: TrophyDefinition[] = [
  {
    id: "ledger_of_echoes",
    name: "Ledger of Echoes",
    shortDescription: "Your study path resonates through the next rites.",
    baseAp: 12,
    roundScaleAp: 1
  },
  {
    id: "stone_oath",
    name: "Stone Oath",
    shortDescription: "Your focus hardens; baseline checks are slightly kinder.",
    baseAp: 10,
    roundScaleAp: 1,
    passiveBuff: { kind: "BASELINE_FORGIVENESS", amount: 1, description: "Baseline forgiveness +1." }
  },
  {
    id: "resonant_ink",
    name: "Resonant Ink",
    shortDescription: "Every future trophy shines brighter.",
    baseAp: 8,
    roundScaleAp: 1,
    passiveBuff: { kind: "REVIEW_AP_BONUS", amount: 2, description: "+2 AP on future trophy claims." }
  },
  {
    id: "dew_clock",
    name: "Dew Clock",
    shortDescription: "A small crystal drip arrives on a steady cadence.",
    baseAp: 7,
    roundScaleAp: 1,
    passiveBuff: { kind: "CRYSTAL_DRIP", amount: 1, everyRounds: 3, description: "+1 Crystal every 3 rounds." }
  },
  {
    id: "quiet_constellation",
    name: "Quiet Constellation",
    shortDescription: "A calm alignment that boosts your ascent rhythm.",
    baseAp: 11,
    roundScaleAp: 1
  },
  {
    id: "vow_of_thrift",
    name: "Vow of Thrift",
    shortDescription: "Your careful pace is rewarded with direct AP.",
    baseAp: 10,
    roundScaleAp: 2
  },
  {
    id: "rising_chorus",
    name: "Rising Chorus",
    shortDescription: "Your group harmony converts into personal ascent.",
    baseAp: 9,
    roundScaleAp: 2
  },
  {
    id: "luminal_compass",
    name: "Luminal Compass",
    shortDescription: "A precise line toward higher ascension.",
    baseAp: 13,
    roundScaleAp: 1
  },
  {
    id: "ember_seal",
    name: "Ember Seal",
    shortDescription: "A compact power mark that stabilizes your growth.",
    baseAp: 9,
    roundScaleAp: 1,
    passiveBuff: { kind: "BASELINE_FORGIVENESS", amount: 1, description: "Baseline forgiveness +1." }
  },
  {
    id: "horizon_bell",
    name: "Horizon Bell",
    shortDescription: "Small, repeatable gains align with future rounds.",
    baseAp: 8,
    roundScaleAp: 1,
    passiveBuff: { kind: "CRYSTAL_DRIP", amount: 1, everyRounds: 4, description: "+1 Crystal every 4 rounds." }
  }
];

export function isProgressReviewRound(turn: number): boolean {
  return turn > 0 && turn % PROGRESS_REVIEW_INTERVAL === 0;
}

export function shouldAnnounceUpcomingReview(turn: number): boolean {
  return isProgressReviewRound(turn + PROGRESS_REVIEW_WARNING_LEAD);
}

export function progressReviewBaseline(round: number): ProgressReviewBaseline {
  const reviewIndex = Math.max(1, Math.floor(round / PROGRESS_REVIEW_INTERVAL));
  return {
    minCrystals: 6 + (reviewIndex - 1),
    minTeachings: 1 + Math.floor((reviewIndex - 1) / 2)
  };
}

export function totalTeachings(player: PlayerState): number {
  return (player.teachings?.length ?? 0) + (player.passiveTeachings?.length ?? 0);
}

export function passesReviewBaseline(player: PlayerState, baseline: ProgressReviewBaseline): boolean {
  const forgiveness = Math.max(0, player.reviewBaselineForgiveness ?? 0);
  const crystalNeed = Math.max(0, baseline.minCrystals - forgiveness);
  const teachingNeed = Math.max(0, baseline.minTeachings - forgiveness);
  return player.crystals >= crystalNeed || totalTeachings(player) >= teachingNeed;
}

function tieBreakScore(state: GameState, playerId: string, categoryId: string): number {
  return Rng.hash(`${state.seed}|${state.turn}|${categoryId}|${playerId}`);
}

function toTrophyChoice(def: TrophyDefinition, round: number): TrophyChoice {
  const roundsElapsed = Math.max(1, Math.floor(round / PROGRESS_REVIEW_INTERVAL));
  return {
    id: def.id,
    name: def.name,
    shortDescription: def.shortDescription,
    rewardAp: def.baseAp + Math.max(0, roundsElapsed - 1) * def.roundScaleAp,
    passiveBuff: def.passiveBuff
  };
}

function pickTrophyOptions(rng: Rng, round: number): TrophyChoice[] {
  return rng.shuffle(TROPHY_POOL).slice(0, TROPHY_OFFER_COUNT).map((def) => toTrophyChoice(def, round));
}

export function buildMostTeachingsReview(state: GameState, rng: Rng): ProgressReviewState {
  const baseline = progressReviewBaseline(state.turn);
  const passers = state.players.filter((player) => passesReviewBaseline(player, baseline));
  const sorted = [...passers].sort((a, b) => {
    const teachingsDelta = totalTeachings(b) - totalTeachings(a);
    if (teachingsDelta !== 0) return teachingsDelta;
    const crystalDelta = b.crystals - a.crystals;
    if (crystalDelta !== 0) return crystalDelta;
    return tieBreakScore(state, b.id, "MOST_TEACHINGS") - tieBreakScore(state, a.id, "MOST_TEACHINGS");
  });
  const winner = sorted[0];
  const winnerExplanation = winner
    ? `${winner.name} had ${totalTeachings(winner)} Teachings, highest among baseline passers.`
    : "No player passed the baseline this round.";

  return {
    reviewRound: state.turn,
    categoryId: "MOST_TEACHINGS",
    categoryName: "Most Teachings",
    baseline,
    baselinePasserIds: passers.map((player) => player.id),
    winnerPlayerId: winner?.id,
    winnerExplanation,
    trophyOptions: pickTrophyOptions(rng, state.turn),
    resolved: false
  };
}

export function chooseAiTrophyOption(review: ProgressReviewState): TrophyChoice | undefined {
  if (review.trophyOptions.length === 0) return undefined;
  const scored = review.trophyOptions.map((choice) => {
    let value = choice.rewardAp;
    if (choice.passiveBuff?.kind === "BASELINE_FORGIVENESS") value += 2;
    if (choice.passiveBuff?.kind === "REVIEW_AP_BONUS") value += 2.5;
    if (choice.passiveBuff?.kind === "CRYSTAL_DRIP") value += 1.5;
    return { choice, value };
  });
  scored.sort((a, b) => b.value - a.value);
  return scored[0]?.choice;
}

export function applyTrophyToPlayer(player: PlayerState, choice: TrophyChoice): { grantedAp: number; passiveText?: string } {
  const reviewApBonus = Math.max(0, player.reviewApBonus ?? 0);
  const grantedAp = choice.rewardAp + reviewApBonus;
  player.bonusAp = (player.bonusAp ?? 0) + grantedAp;
  player.runTrophiesWon = (player.runTrophiesWon ?? 0) + 1;

  let passiveText: string | undefined;
  const passive = choice.passiveBuff;
  if (!passive) {
    return { grantedAp };
  }

  if (passive.kind === "BASELINE_FORGIVENESS") {
    player.reviewBaselineForgiveness = (player.reviewBaselineForgiveness ?? 0) + Math.max(0, passive.amount);
    passiveText = passive.description;
  } else if (passive.kind === "REVIEW_AP_BONUS") {
    player.reviewApBonus = (player.reviewApBonus ?? 0) + Math.max(0, passive.amount);
    passiveText = passive.description;
  } else if (passive.kind === "CRYSTAL_DRIP") {
    const current = player.bonusCrystalEveryRounds;
    const next = Math.max(2, passive.everyRounds ?? 3);
    player.bonusCrystalEveryRounds = current ? Math.min(current, next) : next;
    passiveText = passive.description;
  }

  return { grantedAp, passiveText };
}

