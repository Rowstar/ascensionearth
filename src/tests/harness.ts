import { createNewGame, dataStore } from "../engine/state";
import { Rng } from "../engine/rng";
import { GameStore } from "../engine/reducer";
import {
  applyRewardPool,
  applySpellEffect,
  applyTeachingEffect,
  calculateChallengeTotals,
  earthAdvancementAp,
  finalScore,
  getDiceBonus,
  gainTeaching,
  meditate,
  prepareGuardianDraft,
  rollRewardPool,
  setupChallenge
} from "../engine/rules";
import { effectHandlers, resolveThirdEyeSelection, triggerEffects } from "../engine/effects";
import { ChallengeState, RewardPool } from "../engine/types";
import { buildProgressReview } from "../engine/progression";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function basePlayed(): ChallengeState["played"][string] {
  return {
    selected: [],
    faceDownId: undefined,
    hiddenCardIds: [],
    revealedHiddenCardIds: [],
    spellsPlayed: [],
    committedItems: [],
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
    finalCardPowers: [],
    echoesInStoneUsed: false,
    firstCommittedCardId: undefined,
    rewardThresholdsReached: 0,
    grounding: false,
    groundingValue: 0,
    revealAllFaceDown: false,
    reduceAllOpponents: 0,
    emergentConvergenceUsed: false,
    totalCommitmentGranted: false,
    worldseedRitualTriggered: false,
    removedFromGameCards: [],
    teachingMeditationStacks: 0
  };
}

function buildChallenge(state: ReturnType<typeof createNewGame>): ChallengeState {
  const p1 = state.players[0];
  const p2 = state.players[1];
  const challenge: ChallengeState = {
    id: "MOUNTAIN",
    journeyType: "mountain",
    phase: "COMMIT_TURNS",
    participants: [p1.id, p2.id],
    rolls: { [p1.id]: 4, [p2.id]: 2 },
    turnOrder: [p2.id, p1.id],
    activeTurnIndex: 0,
    logEntries: [],
    contestants: [p1.id, p2.id],
    order: [p1.id, p2.id],
    folded: [],
    played: {
      [p1.id]: basePlayed(),
      [p2.id]: basePlayed()
    },
    revealedEarly: [],
    rollQueue: [],
    revealIndex: 0,
    resolveIndex: 0,
    phaseTimerMs: 0,
    totals: {},
    resolvedTotals: {},
    aiPending: false,
    beatCount: 0,
    passesInRow: 0,
    apContributionByPlayer: { [p1.id]: 0, [p2.id]: 0 },
    totalGroupAp: 0,
    challengeTPByPlayer: { [p1.id]: 0, [p2.id]: 0 },
    challengeTPThresholdsAwarded: { [p1.id]: { basic: false, rare: false, mythic: false }, [p2.id]: { basic: false, rare: false, mythic: false } },
    draft: undefined,
    metrics: { apEarnedSoFar: 0, teachingPowerPlayedSoFar: 0 }
  };
  return challenge;
}

function findCard(criteria: (c: typeof dataStore.cards[number]) => boolean): string {
  const card = dataStore.cards.find(criteria);
  assert(!!card, "Missing required card for test.");
  return card!.id;
}

export function runSmokeTests(): void {
  const rng = new Rng("smoke-test");
  const rewardState = createNewGame("reward-test");
  const pool = rollRewardPool(rewardState, rng, "MOUNTAIN");
  assert(pool.dice.length === 2, "Reward pool should roll 2 dice.");
  assert(pool.rewards.length === 2, "Reward pool should have 2 rewards.");
  pool.dice.forEach((die, idx) => {
    const reward = pool.rewards[idx];
    if (die === 1) {
      assert(reward.kind === "crystal", "Die 1 should grant crystals.");
      assert((reward.count ?? 0) >= 2, "Die 1 should grant 2 crystals.");
    }
    if (die === 2) {
      assert(reward.kind === "crystal", "Die 2 should grant crystals.");
      assert((reward.count ?? 0) >= 3, "Die 2 should grant 3 crystals.");
    }
    if (die === 3) {
      assert(reward.kind === "crystal", "Die 3 should grant crystals.");
      assert((reward.count ?? 0) >= 5, "Die 3 should grant 5 crystals.");
    }
    if (die === 4) {
      assert(reward.kind === "gameCard", "Die 4 should grant game card.");
    }
    if (die === 5) {
      assert(reward.kind === "spell", "Die 5 should grant spell.");
    }
    if (die === 6) {
      assert(["crystal", "artifact", "spell"].includes(reward.kind), "Die 6 should grant crystal, artifact, or spell.");
    }
  });

  dataStore.spells.forEach((spell) => {
    assert(!!spell.rulesText, `Invocation ${spell.id} missing rulesText.`);
    assert(!!effectHandlers[spell.effect], `Invocation ${spell.id} missing effect handler.`);
  });
  dataStore.artifacts.forEach((artifact) => {
    assert(!!artifact.rulesText, `Artifact ${artifact.id} missing rulesText.`);
    assert(!!effectHandlers[artifact.effect], `Artifact ${artifact.id} missing effect handler.`);
  });
  dataStore.teachings.forEach((teaching) => {
    assert(!!teaching.rulesText, `Teaching ${teaching.id} missing rulesText.`);
    assert(!!effectHandlers[teaching.effect], `Teaching ${teaching.id} missing effect handler.`);
  });

  const state = createNewGame("spell-tests");
  const challenge = buildChallenge(state);
  state.challenge = challenge;
  const p1 = state.players[0];
  const p2 = state.players[1];

  const greyCard = findCard((c) => c.color === "Grey");
  const blueCard = findCard((c) => c.color === "Blue");
  const goldCard = findCard((c) => c.color === "Gold" && c.category === "game");
  const humanCard = findCard((c) => c.tags.includes("Human"));

  challenge.played[p1.id].selected = [greyCard, blueCard, goldCard];
  challenge.played[p1.id].faceDownId = greyCard;
  challenge.played[p1.id].hiddenCardIds = [greyCard];
  challenge.played[p2.id].selected = [humanCard];
  challenge.played[p2.id].faceDownId = humanCard;
  challenge.played[p2.id].hiddenCardIds = [humanCard];

  p1.spells = ["empower_the_meek", "channel_group_energy", "tribal_spirits", "third_eye_awakening"];

  const baseTotal =
    dataStore.cardsById[greyCard].basePower +
    dataStore.cardsById[blueCard].basePower +
    dataStore.cardsById[goldCard].basePower;
  applySpellEffect(state, challenge, p1, "empower_the_meek", rng);
  const totalsEmpower = calculateChallengeTotals(state, challenge, rng);
  const expectedEmpower = baseTotal + dataStore.cardsById[greyCard].basePower + dataStore.cardsById[blueCard].basePower;
  assert(totalsEmpower[p1.id] >= expectedEmpower, "Empower the Meek should double Common/Uncommon cards only.");

  applySpellEffect(state, challenge, p1, "channel_group_energy", rng);
  const totalsChannel = calculateChallengeTotals(state, challenge, rng);
  assert(totalsChannel[p1.id] >= expectedEmpower + 15, "Channel Group Energy should add card-count bonus.");

  const channelCountState = createNewGame("channel-count");
  const channelChallenge = buildChallenge(channelCountState);
  channelCountState.challenge = channelChallenge;
  const channelPlayer = channelCountState.players[0];
  const c1 = findCard((c) => c.category === "game");
  const c2 = findCard((c) => c.category === "game" && c.id !== c1);
  const c3 = findCard((c) => c.category === "game" && c.id !== c1 && c.id !== c2);
  channelChallenge.played[channelPlayer.id].beat1Cards = [c1, c2];
  channelChallenge.played[channelPlayer.id].beat2Cards = [c3];
  channelChallenge.played[channelPlayer.id].faceDownId = c1;
  channelPlayer.spells = ["channel_group_energy"];
  applySpellEffect(channelCountState, channelChallenge, channelPlayer, "channel_group_energy", rng);
  const totalsChannelCount = calculateChallengeTotals(channelCountState, channelChallenge, rng);
  assert(totalsChannelCount[channelPlayer.id] >= 15, "Channel Group Energy should add +15 AP for 3 committed cards.");

  const beforeExtra = challenge.played[p1.id].extraCards.length;
  applySpellEffect(state, challenge, p1, "tribal_spirits", rng);
  const afterExtra = challenge.played[p1.id].extraCards.length;
  assert(afterExtra >= beforeExtra + 2, "Tribal Spirits should add extra cards.");

  const beforeReveal = challenge.revealedEarly.length;
  applySpellEffect(state, challenge, p1, "third_eye_awakening", rng);
  assert(challenge.played[p1.id].powerBonus >= 7, "Third Eye Awakening should grant +7 power.");
  if (state.ui.pendingThirdEyeSelection) {
    resolveThirdEyeSelection(state, challenge, p1.id, p2.id, challenge.played[p2.id].hiddenCardIds?.[0] ?? "");
    state.ui.pendingThirdEyeSelection = undefined;
  }
  assert(challenge.revealedEarly.length > beforeReveal, "Third Eye Awakening should reveal a face-down card.");

  const teachingState = createNewGame("teaching-tests");
  const teachingChallenge = buildChallenge(teachingState);
  teachingState.challenge = teachingChallenge;
  const tPlayer = teachingState.players[0];
  tPlayer.teachings = ["open_attention", "prepared_mind", "heightened_curiosity"];

  const teachCrystalsBefore = tPlayer.crystals;
  const teachingsBefore = tPlayer.teachings.length;
  applyTeachingEffect(teachingState, teachingChallenge, tPlayer, "open_attention", rng);
  assert(tPlayer.crystals >= teachCrystalsBefore + 1, "Open Attention should grant +1 Crystal.");
  assert(tPlayer.teachings.length === teachingsBefore - 1, "Open Attention should be consumed when used.");

  const centeredState = createNewGame("centered-resolve");
  const centeredPlayer = centeredState.players[0];
  centeredPlayer.passiveTeachings.push("centered_resolve");
  const diceBefore = centeredPlayer.pendingChallengeDiceBonus ?? 0;
  meditate(centeredState, centeredPlayer, rng);
  assert((centeredPlayer.pendingChallengeDiceBonus ?? 0) >= diceBefore + 1, "Centered Resolve should add +1 to the next Challenge dice.");

  const diceBonusState = createNewGame("dice-tests");
  const dicePlayer = diceBonusState.players[0];
  dicePlayer.artifacts.push("giant_crystal");
  const diceBonus = getDiceBonus(diceBonusState, dicePlayer, rng);
  assert(diceBonus >= 1, "Giant Crystal should add +1 dice bonus.");

  const artifactState = createNewGame("artifact-tests");
  const artifactRng = new Rng("artifact-tests");
  const a1 = artifactState.players[0];
  const a2 = artifactState.players[1];

  a1.artifacts = ["spirit_totem"];
  const spiritChallenge = setupChallenge(artifactState, artifactRng, { id: "MOUNTAIN", contestants: [a1.id, a2.id] });
  assert(spiritChallenge.played[a1.id].extraCards.length >= 1, "Spirit Totem should add an extra card.");

  const extraTeachingState = createNewGame("extra-teaching");
  const extraPlayer = extraTeachingState.players[0];
  extraPlayer.artifacts = ["extra_terrestrial_artifact"];
  const countBasic = (player: typeof extraPlayer) =>
    player.teachings.filter((id) => dataStore.teachingsById[id]?.tier === "basic").length +
    player.passiveTeachings.filter((id) => dataStore.teachingsById[id]?.tier === "basic").length;
  const beforeTeachings = extraPlayer.teachings.length + extraPlayer.passiveTeachings.length;
  const beforeBasic = countBasic(extraPlayer);
  gainTeaching(extraTeachingState, extraPlayer, artifactRng, 1);
  const afterTeachings = extraPlayer.teachings.length + extraPlayer.passiveTeachings.length;
  const afterBasic = countBasic(extraPlayer);
  assert(afterTeachings >= beforeTeachings + 2, "Extra Terrestrial Artifact should add +1 Teaching.");
  assert(afterBasic >= beforeBasic + 1, "Extra Terrestrial Artifact should add +1 Basic Teaching.");

  const rewardState2 = createNewGame("reward-artifacts");
  const rewardPlayer = rewardState2.players[0];
  const rewardChallenge = buildChallenge(rewardState2);
  rewardChallenge.id = "CAVE";
  rewardState2.challenge = rewardChallenge;
  rewardPlayer.artifacts = ["magnetic_crystal", "crystal_seeker_goggles"];
  const crystalsBefore = rewardPlayer.crystals;
  triggerEffects("challenge_resolve", {
    state: rewardState2,
    player: rewardPlayer,
    rng: artifactRng,
    event: "challenge_resolve",
    challenge: rewardChallenge,
    played: rewardChallenge.played[rewardPlayer.id],
    outcome: "LOSS"
  });
  assert(rewardPlayer.crystals >= crystalsBefore + 1, "Crystal Seeker Goggles should grant a bonus crystal.");

  const mountainPool = rollRewardPool(rewardState2, artifactRng, "MOUNTAIN");
  const crystalsBeforeMountain = rewardPlayer.crystals;
  applyRewardPool(rewardState2, rewardPlayer, mountainPool, artifactRng);
  assert(rewardPlayer.crystals >= crystalsBeforeMountain + 2, "Magnetic Crystal should grant bonus crystals on Mountain rewards.");

  const resolveState = createNewGame("resolve-artifacts");
  const resolveChallenge = buildChallenge(resolveState);
  resolveState.challenge = resolveChallenge;
  const resolvePlayer = resolveState.players[0];
  resolvePlayer.artifacts = ["stone_of_balance", "magnetic_crystal", "reincarnation_crystal"];
  const resolvePlayed = resolveChallenge.played[resolvePlayer.id];
  resolvePlayed.faceDownId = findCard((c) => c.category === "game");
  const keepRef: { value?: string } = {};
  triggerEffects("challenge_resolve", {
    state: resolveState,
    player: resolvePlayer,
    rng: artifactRng,
    event: "challenge_resolve",
    challenge: resolveChallenge,
    played: resolvePlayed,
    outcome: "WIN",
    keepCardIdRef: keepRef
  });
  assert(!keepRef.value, "Reincarnation Crystal is dormant under Guardian challenge rules.");

  const crystalsLossBefore = resolvePlayer.crystals;
  triggerEffects("challenge_resolve", {
    state: resolveState,
    player: resolvePlayer,
    rng: artifactRng,
    event: "challenge_resolve",
    challenge: resolveChallenge,
    played: resolvePlayed,
    outcome: "LOSS"
  });
  assert(resolvePlayer.crystals === crystalsLossBefore, "Outcome-based artifacts are dormant under Guardian challenge rules.");

  const autoState = createNewGame("auto-artifacts");
  const autoChallenge = buildChallenge(autoState);
  autoState.challenge = autoChallenge;
  const autoPlayer = autoState.players[0];
  autoPlayer.artifacts = ["mystic_orb", "spell_staff", "cosmic_robes"];
  const autoPlayed = autoChallenge.played[autoPlayer.id];
  autoPlayed.selected = [greyCard, goldCard, humanCard];
  autoPlayed.faceDownId = greyCard;
  triggerEffects("challenge_after_commit", {
    state: autoState,
    player: autoPlayer,
    rng: artifactRng,
    event: "challenge_after_commit",
    challenge: autoChallenge,
    played: autoPlayed,
    castSpell: (spellId, fromArtifact) => applySpellEffect(autoState, autoChallenge, autoPlayer, spellId, artifactRng, fromArtifact)
  });
  const autoEffectFired =
    autoPlayed.powerBonus > 0 ||
    autoPlayed.extraCards.length > 0 ||
    autoPlayed.channelGroupEnergy ||
    autoPlayed.empowerMeek;
  assert(autoEffectFired, "Auto-spell artifacts should apply an effect after commit.");

  const meditationState = createNewGame("meditation-tp");
  const meditationPlayer = meditationState.players[0];
  const handBeforeMeditation = meditationPlayer.hand.length;
  meditate(meditationState, meditationPlayer, rng);
  assert(
    meditationPlayer.hand.length === handBeforeMeditation + 2,
    "Meditation should always grant exactly 2 game cards."
  );

  const guardianSoloState = createNewGame("guardian-solo");
  const soloPlayer = guardianSoloState.players[0];
  const soloArtifactId = dataStore.artifacts[0]?.id ?? "magnetic_crystal";
  const soloRewardPool: RewardPool = { id: "MOUNTAIN", dice: [6, 6], rewards: [{ kind: "artifact", cardId: soloArtifactId }] };
  const soloChallenge = setupChallenge(guardianSoloState, rng, {
    id: "MOUNTAIN",
    contestants: [soloPlayer.id],
    rewardPool: soloRewardPool
  });
  guardianSoloState.challenge = soloChallenge;
  soloChallenge.totals = { [soloPlayer.id]: 18 };
  const soloDraft = prepareGuardianDraft(guardianSoloState, soloChallenge);
  assert(soloDraft.pickOrderPlayerIds.length === 1, "Solo draft should have one picker.");
  assert((soloChallenge.rewardPool?.rewards[0]?.isUnlocked ?? false), "Solo total AP should unlock the artifact reward.");

  const guardianPairState = createNewGame("guardian-pair");
  const gp1 = guardianPairState.players[0];
  const gp2 = guardianPairState.players[1];
  const rewardCardId = dataStore.cards[0]?.id ?? "healer";
  const pairPool: RewardPool = {
    id: "CAVE",
    dice: [1, 4],
    rewards: [
      { kind: "crystal", count: 2 },
      { kind: "gameCard", cardId: rewardCardId }
    ]
  };
  const pairChallenge = setupChallenge(guardianPairState, rng, {
    id: "CAVE",
    contestants: [gp1.id, gp2.id],
    rewardPool: pairPool
  });
  guardianPairState.challenge = pairChallenge;
  pairChallenge.totals = { [gp1.id]: 12, [gp2.id]: 6 };
  const pairDraft = prepareGuardianDraft(guardianPairState, pairChallenge);
  assert(pairDraft.pickOrderPlayerIds[0] === gp1.id, "Draft order should start with highest AP contributor.");
  const unlockedCount = pairChallenge.rewardPool?.rewards.filter((r) => r.isUnlocked).length ?? 0;
  assert(unlockedCount >= 2, "Total group AP should unlock both crystal and game card rewards.");

  const reviewSeed = "review-determinism";
  const reviewStateA = createNewGame(reviewSeed);
  const reviewStateB = createNewGame(reviewSeed);
  reviewStateA.turn = 5;
  reviewStateB.turn = 5;
  reviewStateA.players[0].crystals = 12;
  reviewStateB.players[0].crystals = 12;
  reviewStateA.players[0].teachings.push("open_attention");
  reviewStateB.players[0].teachings.push("open_attention");
  const reviewRngA = new Rng(reviewSeed);
  const reviewRngB = new Rng(reviewSeed);
  const reviewA = buildProgressReview(reviewStateA, reviewRngA).review;
  const reviewB = buildProgressReview(reviewStateB, reviewRngB).review;
  assert(
    reviewA.winnerPlayerId === reviewB.winnerPlayerId &&
      reviewA.categoryId === reviewB.categoryId,
    "Progress review winner/category should be deterministic for same seed and state."
  );
  const optionsA = reviewA.trophyOptions.map((opt) => opt.id).join(",");
  const optionsB = reviewB.trophyOptions.map((opt) => opt.id).join(",");
  assert(optionsA === optionsB, "Progress review trophy options should be deterministic for same seed and state.");

  const saveStoreA = new GameStore();
  saveStoreA.dispatch({ type: "SET_SEED", seed: "save-load-determinism" });
  saveStoreA.dispatch({ type: "START_GAME" });
  saveStoreA.dispatch({ type: "END_TURN" });
  const savedSnapshot = structuredClone(saveStoreA.state);
  assert(typeof savedSnapshot.rngState === "number", "Saved state should include rngState for deterministic loads.");
  const saveStoreB = new GameStore();
  saveStoreB.dispatch({ type: "LOAD_GAME", state: savedSnapshot });
  saveStoreA.dispatch({ type: "END_TURN" });
  saveStoreB.dispatch({ type: "END_TURN" });
  const mountainA = saveStoreA.state.rewardPools.mountain?.dice.join(",") ?? "";
  const mountainB = saveStoreB.state.rewardPools.mountain?.dice.join(",") ?? "";
  const caveA = saveStoreA.state.rewardPools.cave?.dice.join(",") ?? "";
  const caveB = saveStoreB.state.rewardPools.cave?.dice.join(",") ?? "";
  assert(mountainA === mountainB && caveA === caveB, "Save/load should preserve deterministic RNG sequence.");
  assert(
    (saveStoreA.state.rngState ?? -1) === (saveStoreB.state.rngState ?? -2),
    "RNG snapshots should match after equivalent post-load actions."
  );

  const earthApState = createNewGame("earth-ap-consistency");
  const earthPlayer = earthApState.players[0];
  earthPlayer.passiveTeachings.push("convergence_of_paths");
  const earthCard = dataStore.earthAdvancements.find((card) => (card.requirements?.crystals ?? 0) >= 2);
  assert(!!earthCard, "Expected at least one Earth Advancement with crystal requirements.");
  const beforeEarthScore = finalScore(earthPlayer);
  if (earthCard) {
    if (earthCard.tier === 1) {
      earthPlayer.earthAdvancementsT1.push(earthCard.id);
    } else if (earthCard.tier === 2) {
      earthPlayer.earthAdvancementsT2.push(earthCard.id);
    } else {
      earthPlayer.earthAdvancementsT3.push(earthCard.id);
    }
    const afterEarthScore = finalScore(earthPlayer);
    const expectedDelta = earthAdvancementAp(earthCard, earthPlayer) + 3;
    assert(
      afterEarthScore - beforeEarthScore === expectedDelta,
      "Final score should use player-aware Earth AP and convergence bonus."
    );
  }

  const capStore = new GameStore();
  const capState = createNewGame("ascension-cap-end");
  capState.players.forEach((player) => {
    player.bonusAp = 420;
  });
  capStore.dispatch({ type: "LOAD_GAME", state: capState });
  assert(capStore.state.phase === "EVALUATION", "Reaching Earth cap should trigger Endgame Evaluation immediately.");
  capStore.dispatch({ type: "UI_CLOSE_EVALUATION" });
  assert(capStore.state.phase === "GAME_OVER", "Closing evaluation should finalize the run.");

  console.log("Ascension Earth smoke tests passed.");
}

export function simulateTurns(seed = "debug-sim", turns = 10): void {
  const store = new GameStore();
  store.dispatch({ type: "SET_SEED", seed });
  store.dispatch({ type: "START_GAME" });
  store.state.players.forEach((player) => {
    player.isAI = true;
  });

  const targetTurn = store.state.turn + turns;
  let safety = 0;
  let stall = 0;
  let lastSignature = "";
  while (store.state.turn < targetTurn && store.state.phase !== "GAME_OVER") {
    safety += 1;
    if (safety > 2000) {
      throw new Error("Simulation safety limit reached.");
    }
    const signature = `${store.state.phase}-${store.state.turn}-${store.state.log.length}-${store.state.ui.challengeResult ? 1 : 0}-${store.state.ui.turnToast ? 1 : 0}`;
    if (signature === lastSignature) {
      stall += 1;
      if (stall > 20) {
        throw new Error("Simulation stalled with no state progress.");
      }
    } else {
      stall = 0;
      lastSignature = signature;
    }
    if (store.state.ui.challengeResult) {
      store.dispatch({ type: "UI_CLEAR_CHALLENGE_RESULT" });
      continue;
    }
    if (store.state.ui.progressReview) {
      const review = store.state.ui.progressReview;
      if (!review.resolved && review.winnerPlayerId) {
        const first = review.trophyOptions[0];
        if (first) {
          store.dispatch({ type: "UI_SELECT_TROPHY", trophyId: first.id });
          continue;
        }
      }
      store.dispatch({ type: "UI_CLOSE_PROGRESS_REVIEW" });
      continue;
    }
    if (store.state.ui.endgameEvaluation) {
      store.dispatch({ type: "UI_CLOSE_EVALUATION" });
      continue;
    }
    if (store.state.ui.turnToast) {
      store.dispatch({ type: "UI_CLEAR_TURN_TOAST" });
      continue;
    }
    if (store.state.phase === "ACTION_SELECT") {
      store.dispatch({ type: "CONFIRM_ACTION" });
      store.dispatch({ type: "LOCK_ACTIONS" });
      continue;
    }
    if (store.state.phase === "ACTION_REVEAL") {
      store.dispatch({ type: "LOCK_ACTIONS" });
      continue;
    }
    if (store.state.phase === "ROLL_POOLS") {
      store.dispatch({ type: "ROLL_POOLS" });
      continue;
    }
    if (store.state.phase === "TURN_END") {
      store.dispatch({ type: "END_TURN" });
      continue;
    }
  }
}

if (typeof window !== "undefined") {
  (window as unknown as { runAscensionTests: () => void }).runAscensionTests = runSmokeTests;
  (window as unknown as { simulateAscensionTurns: (seed?: string, turns?: number) => void }).simulateAscensionTurns =
    simulateTurns;
}
