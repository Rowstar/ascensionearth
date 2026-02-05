import {
  EndgameEvaluationState,
  EvaluationCategoryResult,
  GameState,
  PlayerState,
  ProgressReviewBaseline,
  ProgressReviewState,
  TrophyChoice,
  TrophyPassiveBuff
} from "./types";
import { Rng } from "./rng";
import { dataStore } from "./state";

export const PROGRESS_REVIEW_INTERVAL = 5;
export const PROGRESS_REVIEW_WARNING_LEAD = 1;
const TROPHY_OFFER_COUNT = 3;
const TROPHY_COOLDOWN_REVIEWS = 2;

type TrophyDefinition = {
  id: string;
  name: string;
  shortDescription: string;
  eligibilityBaseline: (state: GameState, player: PlayerState, baseline: ProgressReviewBaseline) => boolean;
  scoringMetric: (state: GameState, player: PlayerState) => number;
  rewardAp: { base: number; perReview: number };
  optionalPassiveBuff?: TrophyPassiveBuff;
  isBroadStrategy: boolean;
  metricLabel: string;
};

type TrophyLeader = {
  player?: PlayerState;
  score: number;
};

const PASS_BASELINE = (state: GameState, player: PlayerState, baseline: ProgressReviewBaseline): boolean =>
  passesReviewBaseline(player, baseline);

const TROPHY_POOL: TrophyDefinition[] = [
  {
    id: "most_teachings",
    name: "Lore Steward",
    shortDescription: "Honors the highest teaching momentum this cycle.",
    eligibilityBaseline: PASS_BASELINE,
    scoringMetric: (_state, player) => totalTeachings(player),
    rewardAp: { base: 10, perReview: 1 },
    optionalPassiveBuff: { kind: "BASELINE_FORGIVENESS", amount: 1, description: "Baseline forgiveness +1." },
    isBroadStrategy: true,
    metricLabel: "Teachings"
  },
  {
    id: "most_crystals",
    name: "Crystal Vanguard",
    shortDescription: "Rewards players who keep robust crystal reserves.",
    eligibilityBaseline: PASS_BASELINE,
    scoringMetric: (_state, player) => player.crystals,
    rewardAp: { base: 11, perReview: 1 },
    isBroadStrategy: true,
    metricLabel: "Crystals"
  },
  {
    id: "most_challenges_cleared",
    name: "Guardian Breaker",
    shortDescription: "For the most successful challenge clear count.",
    eligibilityBaseline: PASS_BASELINE,
    scoringMetric: (_state, player) => player.runChallengesWon ?? 0,
    rewardAp: { base: 12, perReview: 1 },
    isBroadStrategy: false,
    metricLabel: "Challenges Cleared"
  },
  {
    id: "most_invocations_cast",
    name: "Invocation Conductor",
    shortDescription: "Celebrates the most invocations cast this run.",
    eligibilityBaseline: PASS_BASELINE,
    scoringMetric: (_state, player) => player.spellsCast ?? 0,
    rewardAp: { base: 11, perReview: 1 },
    optionalPassiveBuff: { kind: "REVIEW_AP_BONUS", amount: 1, description: "+1 AP on future trophy claims." },
    isBroadStrategy: false,
    metricLabel: "Invocations Cast"
  },
  {
    id: "highest_challenge_win_rate",
    name: "Balance Keeper",
    shortDescription: "Honors consistency with the best challenge win rate.",
    eligibilityBaseline: (state, player, baseline) =>
      PASS_BASELINE(state, player, baseline) && (player.runChallengesEntered ?? 0) > 0,
    scoringMetric: (_state, player) => {
      const entered = Math.max(1, player.runChallengesEntered ?? 0);
      return (player.runChallengesWon ?? 0) / entered;
    },
    rewardAp: { base: 9, perReview: 1 },
    optionalPassiveBuff: { kind: "CRYSTAL_DRIP", amount: 1, everyRounds: 4, description: "+1 Crystal every 4 rounds." },
    isBroadStrategy: true,
    metricLabel: "Challenge Win Rate"
  },
  {
    id: "most_artifacts_owned",
    name: "Relic Custodian",
    shortDescription: "For players carrying the deepest artifact suite.",
    eligibilityBaseline: PASS_BASELINE,
    scoringMetric: (_state, player) => player.artifacts.length,
    rewardAp: { base: 10, perReview: 1 },
    isBroadStrategy: false,
    metricLabel: "Artifacts"
  },
  {
    id: "least_crystals_spent",
    name: "Thrift Emblem",
    shortDescription: "Rewards disciplined spending patterns.",
    eligibilityBaseline: PASS_BASELINE,
    scoringMetric: (_state, player) => -(player.runCrystalsSpent ?? 0),
    rewardAp: { base: 10, perReview: 2 },
    optionalPassiveBuff: { kind: "BASELINE_FORGIVENESS", amount: 1, description: "Baseline forgiveness +1." },
    isBroadStrategy: true,
    metricLabel: "Least Crystals Spent"
  },
  {
    id: "most_rares_owned",
    name: "Rare Constellation",
    shortDescription: "Tracks ownership of rare and cosmic game cards.",
    eligibilityBaseline: PASS_BASELINE,
    scoringMetric: (_state, player) => countRareCards(player),
    rewardAp: { base: 12, perReview: 1 },
    isBroadStrategy: false,
    metricLabel: "Rare Cards"
  },
  {
    id: "most_earth_advancements",
    name: "Worldforger Crest",
    shortDescription: "Rewards consistent Earth Advancement progress.",
    eligibilityBaseline: PASS_BASELINE,
    scoringMetric: (_state, player) => totalEarthAdvancements(player),
    rewardAp: { base: 11, perReview: 2 },
    optionalPassiveBuff: { kind: "CRYSTAL_DRIP", amount: 1, everyRounds: 3, description: "+1 Crystal every 3 rounds." },
    isBroadStrategy: true,
    metricLabel: "Earth Advancements"
  }
];

const TROPHY_BY_ID: Record<string, TrophyDefinition> = TROPHY_POOL.reduce((acc, def) => {
  acc[def.id] = def;
  return acc;
}, {} as Record<string, TrophyDefinition>);

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

function totalEarthAdvancements(player: PlayerState): number {
  return player.earthAdvancementsT1.length + player.earthAdvancementsT2.length + player.earthAdvancementsT3.length;
}

function countRareCards(player: PlayerState): number {
  return player.hand.reduce((sum, cardId) => {
    const card = dataStore.cardsById[cardId];
    if (!card) return sum;
    if (card.category === "cosmic" || card.tags.includes("Cosmic") || card.basePower >= 12) {
      return sum + 1;
    }
    return sum;
  }, 0);
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

function compareScores(a: number, b: number): number {
  const delta = a - b;
  if (Math.abs(delta) < 0.00001) return 0;
  return delta > 0 ? 1 : -1;
}

function resolveTrophyLeader(state: GameState, trophy: TrophyDefinition, eligiblePlayers: PlayerState[]): TrophyLeader {
  let leader: PlayerState | undefined;
  let leaderScore = -Infinity;
  eligiblePlayers.forEach((player) => {
    const score = trophy.scoringMetric(state, player);
    if (!leader) {
      leader = player;
      leaderScore = score;
      return;
    }
    const metricCompare = compareScores(score, leaderScore);
    if (metricCompare > 0) {
      leader = player;
      leaderScore = score;
      return;
    }
    if (metricCompare === 0) {
      if (player.crystals > leader.crystals) {
        leader = player;
        leaderScore = score;
        return;
      }
      if (player.crystals === leader.crystals) {
        const tieA = tieBreakScore(state, player.id, trophy.id);
        const tieB = tieBreakScore(state, leader.id, trophy.id);
        if (tieA > tieB) {
          leader = player;
          leaderScore = score;
        }
      }
    }
  });
  return { player: leader, score: leaderScore };
}

function formatScore(trophy: TrophyDefinition, score: number): string {
  if (!Number.isFinite(score)) return "0";
  if (trophy.id === "highest_challenge_win_rate") {
    return `${Math.round(score * 100)}%`;
  }
  if (trophy.id === "least_crystals_spent") {
    return `${Math.abs(Math.floor(score))} spent`;
  }
  return `${Math.floor(score)}`;
}

function reviewScaling(round: number): number {
  return Math.max(1, Math.floor(round / PROGRESS_REVIEW_INTERVAL));
}

function toTrophyChoice(trophy: TrophyDefinition, round: number, leader: TrophyLeader): TrophyChoice {
  const scale = reviewScaling(round);
  const rewardAp = trophy.rewardAp.base + (scale - 1) * trophy.rewardAp.perReview;
  const leaderName = leader.player?.name ?? "No eligible leader";
  const scoreText = Number.isFinite(leader.score) ? formatScore(trophy, leader.score) : "--";
  return {
    id: trophy.id,
    name: trophy.name,
    shortDescription: trophy.shortDescription,
    rewardAp,
    passiveBuff: trophy.optionalPassiveBuff,
    currentLeaderPlayerId: leader.player?.id,
    winnerExplanation: leader.player
      ? `${leaderName} leads ${trophy.metricLabel} with ${scoreText}.`
      : "No eligible leader for this trophy yet."
  };
}

function decrementCooldowns(cooldowns: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};
  Object.entries(cooldowns).forEach(([id, value]) => {
    const reduced = Math.max(0, (value ?? 0) - 1);
    if (reduced > 0) next[id] = reduced;
  });
  return next;
}

function pickReviewTrophies(
  rng: Rng,
  cooldowns: Record<string, number>
): { selected: TrophyDefinition[]; updatedCooldowns: Record<string, number> } {
  const decremented = decrementCooldowns(cooldowns);
  const unlocked = TROPHY_POOL.filter((trophy) => (decremented[trophy.id] ?? 0) <= 0);
  const fallback = TROPHY_POOL.filter((trophy) => !unlocked.some((item) => item.id === trophy.id));
  const source = [...unlocked, ...fallback];
  const picked = rng.shuffle(source).slice(0, TROPHY_OFFER_COUNT);

  if (!picked.some((trophy) => trophy.isBroadStrategy)) {
    const broadCandidate = source.find((trophy) => trophy.isBroadStrategy && !picked.some((item) => item.id === trophy.id));
    if (broadCandidate) {
      picked[picked.length - 1] = broadCandidate;
    }
  }

  const updated = { ...decremented };
  picked.forEach((trophy) => {
    updated[trophy.id] = TROPHY_COOLDOWN_REVIEWS;
  });
  return { selected: picked, updatedCooldowns: updated };
}

export function buildProgressReview(
  state: GameState,
  rng: Rng
): { review: ProgressReviewState; updatedCooldowns: Record<string, number> } {
  const baseline = progressReviewBaseline(state.turn);
  const baselinePassers = state.players.filter((player) => passesReviewBaseline(player, baseline));
  const { selected, updatedCooldowns } = pickReviewTrophies(rng, state.trophyCooldowns ?? {});
  const spotlight = selected[0];
  const spotlightEligible = baselinePassers.filter((player) =>
    spotlight.eligibilityBaseline(state, player, baseline)
  );
  const spotlightLeader = resolveTrophyLeader(state, spotlight, spotlightEligible);
  const winner = spotlightLeader.player;
  const winnerExplanation = winner
    ? `${winner.name} won ${spotlight.name} with ${formatScore(spotlight, spotlightLeader.score)} ${spotlight.metricLabel}.`
    : "No player passed eligibility for the spotlight trophy.";

  const options = selected.map((trophy) => {
    const eligible = baselinePassers.filter((player) => trophy.eligibilityBaseline(state, player, baseline));
    const leader = resolveTrophyLeader(state, trophy, eligible);
    return toTrophyChoice(trophy, state.turn, leader);
  });

  return {
    review: {
      reviewRound: state.turn,
      categoryId: spotlight.id,
      categoryName: spotlight.name,
      baseline,
      baselinePasserIds: baselinePassers.map((player) => player.id),
      winnerPlayerId: winner?.id,
      winnerExplanation,
      trophyOptions: options,
      resolved: false
    },
    updatedCooldowns
  };
}

export function chooseAiTrophyOption(
  review: ProgressReviewState,
  state: GameState,
  player: PlayerState
): TrophyChoice | undefined {
  if (review.trophyOptions.length === 0) return undefined;
  const scored = review.trophyOptions.map((choice) => {
    const definition = TROPHY_BY_ID[choice.id];
    let value = choice.rewardAp;
    if (definition) {
      value += definition.scoringMetric(state, player) * 0.25;
    }
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

type EvaluationCategorySpec = {
  id: EvaluationCategoryResult["id"];
  title: string;
  metricLabel: string;
  metric: (state: GameState, player: PlayerState) => number;
  rewardAp: number;
  passiveBuff?: TrophyPassiveBuff;
};

const EVALUATION_CATEGORIES: EvaluationCategorySpec[] = [
  {
    id: "WISDOM",
    title: "Wisdom Reward",
    metricLabel: "Teachings and Arcane Study",
    metric: (_state, player) => totalTeachings(player) * 2 + (player.spellsCast ?? 0),
    rewardAp: 18,
    passiveBuff: { kind: "REVIEW_AP_BONUS", amount: 1, description: "+1 AP on future trophy claims." }
  },
  {
    id: "BALANCE",
    title: "Balance Reward",
    metricLabel: "Challenge Win Rate",
    metric: (_state, player) => {
      const entered = Math.max(1, player.runChallengesEntered ?? 0);
      return (player.runChallengesWon ?? 0) / entered;
    },
    rewardAp: 16,
    passiveBuff: { kind: "BASELINE_FORGIVENESS", amount: 1, description: "Baseline forgiveness +1." }
  },
  {
    id: "DISCIPLINE",
    title: "Discipline Reward",
    metricLabel: "Efficiency and Earth Progress",
    metric: (_state, player) => (totalEarthAdvancements(player) * 4) - ((player.runCrystalsSpent ?? 0) / 5),
    rewardAp: 20,
    passiveBuff: { kind: "CRYSTAL_DRIP", amount: 1, everyRounds: 4, description: "+1 Crystal every 4 rounds." }
  }
];

function resolveEvaluationWinner(
  state: GameState,
  category: EvaluationCategorySpec
): { winner?: PlayerState; score: number } {
  let winner: PlayerState | undefined;
  let winnerScore = -Infinity;
  state.players.forEach((player) => {
    const score = category.metric(state, player);
    if (!winner) {
      winner = player;
      winnerScore = score;
      return;
    }
    const cmp = compareScores(score, winnerScore);
    if (cmp > 0) {
      winner = player;
      winnerScore = score;
      return;
    }
    if (cmp === 0) {
      if (player.crystals > winner.crystals) {
        winner = player;
        winnerScore = score;
        return;
      }
      if (player.crystals === winner.crystals) {
        const tieA = tieBreakScore(state, player.id, category.id);
        const tieB = tieBreakScore(state, winner.id, category.id);
        if (tieA > tieB) {
          winner = player;
          winnerScore = score;
        }
      }
    }
  });
  return { winner, score: winnerScore };
}

function formatEvaluationScore(category: EvaluationCategorySpec, score: number): string {
  if (!Number.isFinite(score)) return "0";
  if (category.id === "BALANCE") {
    return `${Math.round(score * 100)}%`;
  }
  return `${Math.round(score * 10) / 10}`;
}

export function buildEndgameEvaluation(state: GameState): EndgameEvaluationState {
  const categories: EvaluationCategoryResult[] = EVALUATION_CATEGORIES.map((category) => {
    const resolved = resolveEvaluationWinner(state, category);
    const winnerName = resolved.winner?.name ?? "No winner";
    const scoreText = formatEvaluationScore(category, resolved.score);
    return {
      id: category.id,
      title: category.title,
      metricLabel: category.metricLabel,
      winnerPlayerId: resolved.winner?.id,
      winnerExplanation: `${winnerName} led ${category.metricLabel} with ${scoreText}.`,
      rewardAp: category.rewardAp,
      passiveBuffText: category.passiveBuff?.description
    };
  });
  return {
    round: state.turn,
    categories,
    totalApGranted: 0
  };
}

export function applyEndgameEvaluationRewards(state: GameState, evaluation: EndgameEvaluationState): EndgameEvaluationState {
  let total = 0;
  const updatedCategories = evaluation.categories.map((category) => {
    const winner = state.players.find((player) => player.id === category.winnerPlayerId);
    if (!winner) {
      return category;
    }
    const spec = EVALUATION_CATEGORIES.find((entry) => entry.id === category.id);
    const reward = applyTrophyToPlayer(winner, {
      id: `evaluation-${category.id.toLowerCase()}`,
      name: category.title,
      shortDescription: category.metricLabel,
      rewardAp: category.rewardAp,
      passiveBuff: spec?.passiveBuff
    });
    total += reward.grantedAp;
    return {
      ...category,
      rewardAp: reward.grantedAp,
      passiveBuffText: reward.passiveText
    };
  });
  return {
    ...evaluation,
    categories: updatedCategories,
    totalApGranted: total
  };
}
