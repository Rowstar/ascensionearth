import { Rng } from "./rng";
import {
  ActionChoice,
  AiQueuedAction,
  ChallengeState,
  GameAction,
  GameState,
  PendingChallenge,
  PlayerState,
  RewardItem
} from "./types";
import { createEmptyUiState, createNewGame, dataStore } from "./state";
import {
  applySpellEffect,
  applyTeachingEffect,
  addChallengeTP,
  canBuyEarthAdvancement,
  clearSelections,
  buyEarthAdvancement,
  getDiceBonus,
  resetTempDiceBonus,
  resolveChallenge,
  calculateChallengeTotals,
  cardValue,
  cardTeachingPower,
  finalScore,
  finalScoreBreakdown,
  applyRewardPool,
  resolveUncontestedActions,
  rollRewardPool,
  prepareGuardianDraft,
  recordChallengeApContribution,
  setupChallenge,
  teachingPotentialGainForCard,
  sellHandCard,
  sellSpell,
  sellArtifact,
  sellTeaching,
  grantInvocation,
  gainTeaching,
  hasFreeInvocationSlot,
  formatCrystals,
  SHOP_CARD_COST,
  SHOP_INVOCATION_COST,
  CHALLENGE_SPELL_BASE_AP,
  CHALLENGE_COMMIT_MAX,
  TP_GAIN_MULT,
  refreshShopOfferings
} from "./rules";
import { resolveThirdEyeSelection, triggerEffects } from "./effects";
import { scaledDelayMs } from "../utils/timing";
import { nextGameSpeedMode } from "../utils/gameSpeed";
import { playCardCommit, playChallengeComplete, playTeachingGained, playArtifactGained, playDeny } from "../render/sfx";
import { saveGame } from "../utils/save";
import {
  decideAiAction,
  chooseSpellToPlay,
  chooseAiEarthTier,
  decideAiShopPurchase
} from "./ai";
import {
  applyEndgameEvaluationRewards,
  applyTrophyToPlayer,
  buildEndgameEvaluation,
  buildProgressReview,
  chooseAiTrophyOption,
  isProgressReviewRound,
  shouldAnnounceUpcomingReview
} from "./progression";
import { trimLogs } from "./logging";
import { cycleFocusModeOverride } from "../utils/focusMode";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const VEIL_OF_UNCERTAINTY_CHANCE = 0.25;

function scaledChallengeDelay(state: GameState, baseMs: number): number {
  return scaledDelayMs(baseMs, state.settings.gameSpeedMode);
}

function hasPassiveTeaching(player: PlayerState, id: string): boolean {
  return player.passiveTeachings?.includes(id) ?? false;
}

/** Snapshot human player's teaching/artifact counts, run callback, then play gained sounds. */
function withRewardSfx(state: GameState, fn: () => void): void {
  const human = state.players.find((p) => !p.isAI);
  const preTeachings = human ? human.teachings.length + human.passiveTeachings.length : 0;
  const preArtifacts = human ? human.artifacts.length : 0;
  fn();
  if (human) {
    if (human.teachings.length + human.passiveTeachings.length > preTeachings) playTeachingGained();
    if (human.artifacts.length > preArtifacts) playArtifactGained();
  }
}

/** Wrapper: resolves challenge and plays appropriate sounds for the human player. */
function resolveChallengeWithSfx(state: GameState, rng: Rng): void {
  withRewardSfx(state, () => resolveChallenge(state, rng));
  playChallengeComplete();
}

function hasDoctrineOfAbundance(player: PlayerState): boolean {
  return hasPassiveTeaching(player, "doctrine_of_abundance");
}

function totalPurchasesThisTurn(player: PlayerState): number {
  return (player.purchasesCardThisTurn ?? 0) + (player.purchasesSpellThisTurn ?? 0);
}

function canShopBuyCard(player: PlayerState): boolean {
  if (hasDoctrineOfAbundance(player)) {
    return (player.purchasesCardThisTurn ?? 0) < 2;
  }
  return totalPurchasesThisTurn(player) < 1;
}

function canShopBuySpell(player: PlayerState): boolean {
  if (hasDoctrineOfAbundance(player)) {
    return (player.purchasesSpellThisTurn ?? 0) < 2;
  }
  return totalPurchasesThisTurn(player) < 1;
}

function registerShopPurchase(player: PlayerState, kind: "CARD" | "SPELL"): void {
  if (kind === "CARD") {
    player.purchasesCardThisTurn = (player.purchasesCardThisTurn ?? 0) + 1;
  } else {
    player.purchasesSpellThisTurn = (player.purchasesSpellThisTurn ?? 0) + 1;
  }
  player.purchasesThisTurn = totalPurchasesThisTurn(player);
}

export class GameStore {
  state: GameState;
  private rng: Rng;

  constructor() {
    this.state = {
      seed: "ascension-earth",
      rngState: undefined,
      turn: 1,
      maxTurns: 0,
      earthAscensionPower: 0,
      earthAscensionTarget: 999,
      ascensionCapReachedAnnounced: false,
      settings: {
        gameSpeedMode: "NORMAL"
      },
      phase: "ROLL_POOLS",
      players: [],
      rewardPools: {},
      decks: {
        game: [],
        spells: [],
        artifacts: [],
        teachingsBasic: [],
        teachingsRare: [],
        teachingsMythic: [],
        earthAdvancementsT1: [],
        earthAdvancementsT2: [],
        earthAdvancementsT3: [],
        discardGame: [],
        discardSpells: [],
        discardTeachingsBasic: []
      },
      log: [],
      pendingChallenges: [],
      challenge: undefined,
      hotseatReveal: false,
      ui: createEmptyUiState(),
      shopOfferings: { cards: [], invocations: [] },
      aiQueue: [],
      aiActive: undefined,
      aiPendingReveal: false,
      reviewHistory: [],
      trophyCooldowns: {},
      guardianKeystones: {
        cave: { progress: 0, rareUnlocked: false, mythicUnlocked: false, crystalTier1Claimed: false, crystalTier2Claimed: false },
        mountain: { progress: 0, rareUnlocked: false, mythicUnlocked: false, crystalTier1Claimed: false, crystalTier2Claimed: false }
      },
      lastTurnStartGains: {},
      previousTurnRewards: {}
    };
    this.rng = new Rng(this.state.seed);
    this.state.rngState = this.rng.snapshot();
  }

  dispatch(action: GameAction): void {
    const next = this.reduce(this.state, action);
    const withAscension = this.applyEarthAscension(next);
    withAscension.rngState = this.rng.snapshot();
    trimLogs(withAscension);
    this.state = withAscension;
  }

  private applyEarthAscension(state: GameState): GameState {
    const earthPower = state.players.reduce((sum, player) => sum + finalScore(player), 0);
    state.earthAscensionPower = earthPower;
    const hasReachedCap = earthPower >= state.earthAscensionTarget;
    if (!hasReachedCap) {
      state.ascensionCapReachedAnnounced = false;
      return state;
    }
    if (!state.ascensionCapReachedAnnounced) {
      state.log.push("Earth Ascension reaches its target.");
      state.ascensionCapReachedAnnounced = true;
    }
    if (state.phase === "GAME_OVER" || state.phase === "EVALUATION") {
      return state;
    }
    if (state.challenge || state.ui.progressReview) {
      return state;
    }
    this.startEndgameEvaluation(state, "Earth Ascension reached 999. Endgame Evaluation begins.");
    state.earthAscensionPower = state.players.reduce((sum, player) => sum + finalScore(player), 0);
    return state;
  }

  private startEndgameEvaluation(state: GameState, reasonLog: string): void {
    if (state.phase === "EVALUATION" || state.phase === "GAME_OVER") {
      return;
    }
    const built = buildEndgameEvaluation(state);
    const evaluated = applyEndgameEvaluationRewards(state, built);
    state.ui.endgameEvaluation = evaluated;
    state.phase = "EVALUATION";
    state.pendingChallenges = [];
    state.challenge = undefined;
    state.ui.shopOpen = false;
    state.ui.earthShopOpen = false;
    state.ui.pendingSell = undefined;
    state.log.push(reasonLog);
  }

  private rollPoolsForTurn(state: GameState): void {
    const human = state.players.find((p) => !p.isAI);
    const names = state.players.map((p) => {
      p.crystals += 1;
      p.purchasesThisTurn = 0;
      p.purchasesCardThisTurn = 0;
      p.purchasesSpellThisTurn = 0;
      p.transmutationFocusSalesThisTurn = 0;
      p.transmutationFocusUsedTurn = undefined;
      const gains = ["+1 Crystal"];
      const dripEvery = p.bonusCrystalEveryRounds ?? 0;
      if (dripEvery > 0 && state.turn % dripEvery === 0) {
        p.crystals += 1;
        gains.push("+1 Crystal (Trophy Drip)");
      }

      // Show previous turn meditation/journey rewards
      const prevRewards = state.previousTurnRewards[p.id];
      if (prevRewards) {
        if (prevRewards.meditation) {
          const med = prevRewards.meditation;
          if (med.cards > 0) gains.push(`🧘 Meditation: +${med.cards} Cards`);
          if (med.teachings > 0) gains.push(`🧘 Meditation: +${med.teachings} Teaching${med.teachings === 1 ? '' : 's'}`);
          if (med.invocations > 0) gains.push(`🧘 Meditation: +${med.invocations} Invocation${med.invocations === 1 ? '' : 's'}`);
        }
        if (prevRewards.journey) {
          const j = prevRewards.journey;
          const journeyIcon = '⚔️';
          if (j.crystals > 0) {
            gains.push(`${journeyIcon} Journey: +${j.crystals} Crystals`);

          }
          if (j.cards > 0) {
            gains.push(`${journeyIcon} Journey: +${j.cards} Game Card${j.cards === 1 ? '' : 's'}`);

          }
          if (j.invocations > 0) {
            gains.push(`${journeyIcon} Journey: +${j.invocations} Invocation${j.invocations === 1 ? '' : 's'}`);

          }
          if (j.artifacts > 0) {
            gains.push(`${journeyIcon} Journey: +${j.artifacts} Artifact${j.artifacts === 1 ? '' : 's'}`);

          }
          if (j.teachings > 0) {
            gains.push(`${journeyIcon} Journey: +${j.teachings} Teaching${j.teachings === 1 ? '' : 's'}`);

          }
        }
        if (prevRewards.challengeTeachings) {
          const ct = prevRewards.challengeTeachings;
          const total = ct.basic + ct.rare + ct.mythic;
          if (total > 0) {
            const parts: string[] = [];
            if (ct.basic > 0) parts.push(`${ct.basic} Basic`);
            if (ct.rare > 0) parts.push(`${ct.rare} Rare`);
            if (ct.mythic > 0) parts.push(`${ct.mythic} Mythic`);
            gains.push(`📖 Challenge TP: +${parts.join(', ')} Teaching${total === 1 ? '' : 's'}`);
          }
        }
        if (prevRewards.keystone) {
          const ks = prevRewards.keystone;
          const icon = ks.type === 'cave' ? '🔷' : '🔶';
          gains.push(`${icon} ${ks.type === 'cave' ? 'Cave' : 'Mountain'} Reward: ${ks.reward}`);
        }
        // Clear previous turn rewards after showing
        delete state.previousTurnRewards[p.id];
      }

      // Add keystone journey progress for human player
      if (!p.isAI && state.guardianKeystones) {
        const cave = state.guardianKeystones.cave;
        const mountain = state.guardianKeystones.mountain;

        // Cave keystone progress
        if (cave.progress > 0) {
          const nextCaveMilestone = cave.crystalTier1Claimed ?
            (cave.rareUnlocked ? (cave.crystalTier2Claimed ? (cave.mythicUnlocked ? null : 300) : 200) : 100) : 50;
          if (nextCaveMilestone) {
            const remaining = Math.ceil(nextCaveMilestone - cave.progress);
            gains.push(`🔷 Cave Keystone: ${Math.floor(cave.progress)}/300 (${remaining} to next)`);
          } else {
            gains.push(`🔷 Cave Keystone: Mastery Complete! (${Math.floor(cave.progress)} AP)`);
          }
        }

        // Mountain keystone progress
        if (mountain.progress > 0) {
          const nextMtnMilestone = mountain.crystalTier1Claimed ?
            (mountain.rareUnlocked ? (mountain.crystalTier2Claimed ? (mountain.mythicUnlocked ? null : 250) : 160) : 80) : 40;
          if (nextMtnMilestone) {
            const remaining = Math.ceil(nextMtnMilestone - mountain.progress);
            gains.push(`🔶 Mountain Keystone: ${Math.floor(mountain.progress)}/250 (${remaining} to next)`);
          } else {
            gains.push(`🔶 Mountain Keystone: Mastery Complete! (${Math.floor(mountain.progress)} TP)`);
          }
        }
      }

      state.lastTurnStartGains[p.id] = gains;
      state.log.push(`Turn start: ${p.name} gains +1 Crystal (baseline).`);
      if (dripEvery > 0 && state.turn % dripEvery === 0) {
        state.log.push(`Turn start: ${p.name} gains +1 Crystal from Trophy Drip.`);
      }
      return p.name;
    });
    if (names.length > 0) {
      state.log.push(`Round ${state.turn}: ${names.join(", ")} gain +1 Crystal.`);
    }
    if (human) {
      showTurnToast(state, human);
    }
    const newMountain = rollRewardPool(state, this.rng, "MOUNTAIN");
    const newCave = rollRewardPool(state, this.rng, "CAVE");
    const existingMountain = state.rewardPools.mountain;
    const existingCave = state.rewardPools.cave;
    const combinedMountain = [...(existingMountain?.rewards ?? []), ...newMountain.rewards].filter(
      (reward) => (reward.count ?? 1) > 0
    );
    const combinedCave = [...(existingCave?.rewards ?? []), ...newCave.rewards].filter(
      (reward) => (reward.count ?? 1) > 0
    );
    state.rewardPools.mountain = { ...newMountain, rewards: combinedMountain };
    state.rewardPools.cave = { ...newCave, rewards: combinedCave };
    refreshShopOfferings(state, this.rng);
    state.phase = "ACTION_SELECT";
    state.log.push(
      `Turn ${state.turn}: Mountain dice ${state.rewardPools.mountain.dice.join(",")}, Cave dice ${state.rewardPools.cave.dice.join(",")}.`
    );
    if (state.ui.debugEnabled) {
      const summary = state.players
        .map((player) => {
          const b = finalScoreBreakdown(player);
          return `${player.name}=${b.total} (cards ${b.handAp}, inv ${b.invocationsAp}, art ${b.artifactsAp}, earth ${b.earthAp}, crystal ${b.crystalsAp}, bonus ${b.bonusAp + b.convergenceAp})`;
        })
        .join(" | ");
      state.log.push(`[AP SNAPSHOT][T${state.turn}] ${summary}`);
    }

    if (isProgressReviewRound(state.turn)) {
      const built = buildProgressReview(state, this.rng);
      state.trophyCooldowns = built.updatedCooldowns;
      const review = built.review;
      state.ui.progressReview = review;
      state.log.push(`Progress Review Round ${state.turn}: ${review.categoryName}.`);
      if (!review.winnerPlayerId) {
        review.resolved = true;
        state.log.push("No player met the Progress Review baseline.");
        return;
      }

      const winner = state.players.find((player) => player.id === review.winnerPlayerId);
      if (winner?.isAI) {
        const aiChoice = chooseAiTrophyOption(review, state, winner);
        if (aiChoice) {
          const reward = applyTrophyToPlayer(winner, aiChoice);
          review.selectedTrophyId = aiChoice.id;
          review.selectedByPlayerId = winner.id;
          review.selectedRewardAp = reward.grantedAp;
          review.selectedPassiveBuffText = reward.passiveText;
          review.resolved = true;
          const passive = reward.passiveText ? ` ${reward.passiveText}` : "";
          state.log.push(
            `${winner.name} claims Trophy: ${aiChoice.name} (+${reward.grantedAp} AP).${passive}`
          );
        } else {
          review.resolved = true;
        }
      }
    }
  }

  private advanceTurn(state: GameState): GameState {
    if (shouldAnnounceUpcomingReview(state.turn)) {
      state.log.push(`Progress Review next round! (Round ${state.turn + 1})`);
    }

    state.turn += 1;
    const saved = saveGame(state);
    if (!saved) {
      if (!state.ui.saveWarning) {
        state.ui.saveWarning = "Autosave failed. Check browser storage settings.";
        state.log.push(state.ui.saveWarning);
      }
    } else if (state.ui.saveWarning) {
      state.log.push("Autosave restored.");
      state.ui.saveWarning = undefined;
    }
    // Reset per-turn counters and close transient UI.
    state.players.forEach((p) => {
      p.purchasesThisTurn = 0;
      p.purchasesCardThisTurn = 0;
      p.purchasesSpellThisTurn = 0;
      p.transmutationFocusSalesThisTurn = 0;
      p.transmutationFocusUsedTurn = undefined;
      p.locked = false;
      p.action = undefined;
      p.earthTierChoice = undefined;
      if (p.worldseedStatus === "pending" && p.worldseedActivationTurn === state.turn) {
        p.worldseedStatus = "active";
        state.log.push(`${p.name}'s Worldseed Awakening takes root.`);
      }
    });
    state.ui.shopOpen = false;
    state.ui.earthShopOpen = false;
    state.ui.pendingSell = undefined;
    clearSelections(state);
    this.rollPoolsForTurn(state);
    return state;
  }

  private reduce(state: GameState, action: GameAction): GameState {
    if (action.type === "SET_SEED") {
      return {
        ...state,
        ui: {
          ...state.ui,
          seedInput: action.seed
        }
      };
    }

    if (action.type === "SET_SEED_EDITING") {
      return {
        ...state,
        ui: {
          ...state.ui,
          seedEditing: action.editing
        }
      };
    }

    if (action.type === "START_GAME") {
      const seed = state.ui.seedInput || `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      this.rng = new Rng(seed);
      const next = createNewGame(seed);
      next.settings.gameSpeedMode = state.settings.gameSpeedMode;
      next.ui.soundEnabled = state.ui.soundEnabled;
      next.ui.musicEnabled = state.ui.musicEnabled;
      next.ui.musicVolume = state.ui.musicVolume;
      next.ui.debugEnabled = state.ui.debugEnabled;
      next.ui.saveWarning = undefined;
      next.hotseatReveal = state.hotseatReveal;
      this.rollPoolsForTurn(next);
      next.rngState = this.rng.snapshot();
      return next;
    }

    if (action.type === "LOAD_GAME") {
      this.rng = new Rng(action.state.seed);
      const loaded = structuredClone(action.state) as GameState;
      loaded.rngState = loaded.rngState ?? undefined;
      loaded.ascensionCapReachedAnnounced = loaded.ascensionCapReachedAnnounced ?? false;
      loaded.reviewHistory = loaded.reviewHistory ?? [];
      loaded.trophyCooldowns = loaded.trophyCooldowns ?? {};
      loaded.ui.progressReview = loaded.ui.progressReview ?? undefined;
      loaded.ui.endgameEvaluation = loaded.ui.endgameEvaluation ?? undefined;
      loaded.ui.earthShopOpen = loaded.ui.earthShopOpen ?? false;
      loaded.ui.saveWarning = loaded.ui.saveWarning ?? undefined;
      loaded.players.forEach((player) => {
        player.reviewBaselineForgiveness = player.reviewBaselineForgiveness ?? 0;
        player.reviewApBonus = player.reviewApBonus ?? 0;
        player.bonusCrystalEveryRounds = player.bonusCrystalEveryRounds ?? undefined;
        player.runChallengesEntered = player.runChallengesEntered ?? 0;
        player.runChallengesWon = player.runChallengesWon ?? 0;
        player.runCrystalsSpent = player.runCrystalsSpent ?? 0;
        player.runTrophiesWon = player.runTrophiesWon ?? 0;
      });
      if (typeof loaded.rngState === "number") {
        this.rng.restore(loaded.rngState);
      } else {
        // Backward compatibility for older saves that predate rng snapshots.
        for (let i = 0; i < loaded.turn * 100; i++) this.rng.next();
        loaded.rngState = this.rng.snapshot();
      }
      return loaded;
    }

    if (action.type === "GO_MENU") {
      return {
        ...state,
        ui: {
          ...state.ui,
          screen: "MENU",
          seedEditing: false
        }
      };
    }

    const next = structuredClone(state) as GameState;

    if (
      next.ui.progressReview &&
      action.type !== "UI_SELECT_TROPHY" &&
      action.type !== "UI_CLOSE_PROGRESS_REVIEW" &&
      action.type !== "UI_CLEAR_TURN_TOAST" &&
      action.type !== "TOGGLE_MENU"
    ) {
      return next;
    }

    if (
      next.ui.endgameEvaluation &&
      action.type !== "UI_CLOSE_EVALUATION" &&
      action.type !== "UI_CLEAR_TURN_TOAST" &&
      action.type !== "TOGGLE_MENU"
    ) {
      return next;
    }

    switch (action.type) {
      case "TOGGLE_RULES":
        next.ui.showRules = !next.ui.showRules;
        return next;
      case "TOGGLE_HOTSEAT":
        next.hotseatReveal = !next.hotseatReveal;
        return next;
      case "TOGGLE_MENU":
        next.ui.menuOpen = !next.ui.menuOpen;
        return next;
      case "TOGGLE_LOG":
        next.ui.logOpen = !next.ui.logOpen;
        return next;
      case "TOGGLE_DEBUG":
        next.ui.debugEnabled = !next.ui.debugEnabled;
        if (next.ui.debugEnabled) {
          next.log.push("Debug mode enabled.");
        } else {
          next.log.push("Debug mode disabled.");
        }
        return next;
      case "TOGGLE_SOUND":
        next.ui.soundEnabled = !next.ui.soundEnabled;
        next.log.push(`Sound ${next.ui.soundEnabled ? "enabled" : "disabled"}.`);
        return next;
      case "TOGGLE_MUSIC":
        next.ui.musicEnabled = !(next.ui.musicEnabled ?? true);
        next.log.push(`Music ${next.ui.musicEnabled ? "enabled" : "disabled"}.`);
        return next;
      case "SET_MUSIC_VOLUME":
        next.ui.musicVolume = clamp(action.value, 0, 100);
        next.log.push(`Music volume set to ${next.ui.musicVolume}%.`);
        return next;
      case "TOGGLE_MOTION":
        next.ui.motionEnabled = !(next.ui.motionEnabled ?? true);
        next.log.push(`Menu motion ${next.ui.motionEnabled ? "enabled" : "disabled"}.`);
        return next;
      case "CYCLE_PARTICLE_QUALITY": {
        const current = next.ui.particleQuality ?? "med";
        const nextQuality = current === "low" ? "med" : current === "med" ? "high" : "low";
        next.ui.particleQuality = nextQuality;
        next.log.push(`Particle quality set to ${nextQuality}.`);
        return next;
      }
      case "TOGGLE_MENU_MOUSE_PARALLAX":
        next.ui.menuMouseParallaxEnabled = !(next.ui.menuMouseParallaxEnabled ?? true);
        next.log.push(`Menu mouse parallax ${next.ui.menuMouseParallaxEnabled ? "enabled" : "disabled"}.`);
        return next;
      case "UI_TOGGLE_FOCUS_DRAWER":
        if (next.phase === "ACTION_SELECT") {
          next.ui.focusDrawerOpen = !(next.ui.focusDrawerOpen ?? false);
          if (!next.ui.focusDrawerOpen) {
            next.ui.pendingSell = undefined;
          }
        }
        return next;
      case "UI_SET_FOCUS_DRAWER_OPEN":
        if (next.phase === "ACTION_SELECT") {
          next.ui.focusDrawerOpen = action.value;
          if (!action.value) {
            next.ui.pendingSell = undefined;
          }
        }
        return next;
      case "UI_SET_FOCUS_DRAWER_TAB":
        next.ui.focusDrawerTab = action.tab;
        return next;
      case "UI_SET_FOCUS_MODE_OVERRIDE":
        next.ui.focusModeOverride = action.mode;
        return next;
      case "UI_CYCLE_FOCUS_MODE_OVERRIDE":
        next.ui.focusModeOverride = cycleFocusModeOverride(next.ui.focusModeOverride);
        return next;
      case "SET_GAME_SPEED":
        next.settings.gameSpeedMode = action.mode;
        next.log.push(`Game speed set to ${action.mode.toLowerCase()}.`);
        return next;
      case "CYCLE_GAME_SPEED": {
        const nextMode = nextGameSpeedMode(next.settings.gameSpeedMode);
        next.settings.gameSpeedMode = nextMode;
        next.log.push(`Game speed set to ${nextMode.toLowerCase()}.`);
        return next;
      }
      case "APPLY_PREFERENCES":
        if (action.prefs.soundEnabled !== undefined) {
          next.ui.soundEnabled = action.prefs.soundEnabled;
        }
        if (action.prefs.musicEnabled !== undefined) {
          next.ui.musicEnabled = action.prefs.musicEnabled;
        }
        if (action.prefs.musicVolume !== undefined) {
          next.ui.musicVolume = clamp(action.prefs.musicVolume, 0, 100);
        }
        if (action.prefs.motionEnabled !== undefined) {
          next.ui.motionEnabled = action.prefs.motionEnabled;
        }
        if (action.prefs.particleQuality) {
          next.ui.particleQuality = action.prefs.particleQuality;
        }
        if (action.prefs.menuMouseParallaxEnabled !== undefined) {
          next.ui.menuMouseParallaxEnabled = action.prefs.menuMouseParallaxEnabled;
        }
        if (action.prefs.gameSpeedMode) {
          next.settings.gameSpeedMode = action.prefs.gameSpeedMode;
        }
        return next;
      case "UI_SET_AI_STATUS":
        next.ui.aiStatus = action.payload;
        return next;
      case "UI_CLEAR_AI_STATUS":
        next.ui.aiStatus = null;
        return next;
      case "UI_SET_ACTIVE_HIGHLIGHT":
        next.ui.activeHighlightPlayerId = action.payload.playerId;
        next.ui.activeHighlightScope = action.payload.scope;
        return next;
      case "UI_CLEAR_ACTIVE_HIGHLIGHT":
        next.ui.activeHighlightPlayerId = null;
        next.ui.activeHighlightScope = null;
        return next;
      case "AI_TICK":
        tickAiActions(next, this.rng, action.dt);
        return next;
      case "ADD_LOG":
        next.log.push(action.text);
        if (next.challenge) {
          next.challenge.logEntries.push(action.text);
        }
        return next;
      case "SET_LOG_SCROLL":
        next.ui.logScroll = clamp(action.value, 0, 5000);
        return next;
      case "SET_SPELL_SCROLL":
        next.ui.spellScroll = clamp(action.value, 0, 5000);
        return next;
      case "SET_TEACHING_SCROLL":
        next.ui.teachingScroll = clamp(action.value, 0, 5000);
        return next;
      case "SET_CHALLENGE_LOG_SCROLL":
        next.ui.challengeLogScroll = clamp(action.value, 0, 5000);
        return next;
      case "SET_ARTIFACT_SCROLL":
        next.ui.artifactScroll = clamp(action.value, 0, 5000);
        return next;
      case "SET_EARTH_SCROLL":
        next.ui.earthScroll = clamp(action.value, 0, 5000);
        return next;
      case "SET_HAND_SCROLL":
        next.ui.handScroll = clamp(action.value, 0, 5000);
        return next;
      case "SET_HAND_TAB":
        next.ui.handTab = action.tab;
        next.ui.handScroll = 0;
        return next;
      case "FAST_FORWARD_CHALLENGE":
        fastForwardChallenge(next, this.rng);
        return next;
      case "CHALLENGE_AUTO_PLAY":
        fastForwardChallenge(next, this.rng);
        return next;
      case "CHALLENGE_RESUME_INITIATIVE": {
        const challenge = next.challenge;
        if (!challenge || next.phase !== "CHALLENGE" || challenge.phase !== "COMMIT_TURNS") {
          return next;
        }
        if (challenge.initiativePaused) {
          challenge.initiativePaused = false;
          addChallengeLog(next, "Commit turns begin.");
        }
        return next;
      }
      case "TOGGLE_CHALLENGE_LOG":
        next.ui.challengeLogExpanded = !next.ui.challengeLogExpanded;
        return next;
      case "CHALLENGE_TICK":
        tickChallengeFlow(next, this.rng, action.dt);
        return next;
      case "UI_SET_CHALLENGE_RESULT":
        next.ui.challengeResult = action.result;
        next.ui.challengeResultMode = "verdict";
        next.ui.challengeResultTab = "POWER";
        next.ui.challengeResultPlayerId =
          action.result.participants.find((p) => next.players.find((player) => !player.isAI && player.id === p.playerId))?.playerId
          ?? action.result.participants[0]?.playerId;
        return next;
      case "UI_CLEAR_CHALLENGE_RESULT":
        next.ui.challengeResult = undefined;
        next.ui.challengeResultMode = "verdict";
        next.ui.challengeResultTab = "POWER";
        next.ui.challengeResultPlayerId = undefined;
        next.ui.pendingThirdEyeSelection = undefined;
        return resumeAfterChallenge(next, this.rng, (state) => this.advanceTurn(state));
      case "UI_SET_WITHDRAW_CONFIRM":
        next.ui.confirmWithdraw = action.value;
        return next;
      case "UI_CLEAR_TURN_TOAST":
        next.ui.turnToast = null;
        return next;
      case "ROLL_POOLS": {
        this.rollPoolsForTurn(next);
        return next;
      }
      case "SELECT_ACTION":
        next.ui.selectedAction = action.action;
        return next;
      case "CLEAR_SELECTED_ACTION":
        if (next.phase === "ACTION_SELECT") {
          next.ui.selectedAction = undefined;
        }
        return next;

      case "SET_EARTH_TIER":
        next.ui.selectedEarthTier = action.tier;
        return next;
      case "TOGGLE_SHOP":
        if (next.phase === "ACTION_SELECT") {
          next.ui.shopOpen = !next.ui.shopOpen;
          if (next.ui.shopOpen) {
            next.ui.shopTab = next.ui.shopTab ?? "CARDS";
            next.ui.earthShopOpen = false;
            next.ui.focusDrawerOpen = true;
          } else {
            next.ui.pendingSell = undefined;
          }
        }
        return next;
      case "TOGGLE_EARTH_SHOP":
        if (next.phase === "ACTION_SELECT") {
          next.ui.earthShopOpen = !next.ui.earthShopOpen;
          if (next.ui.earthShopOpen) {
            next.ui.shopOpen = false;
            next.ui.pendingSell = undefined;
            next.ui.focusDrawerOpen = false;
          }
        }
        return next;
      case "UI_SET_CHALLENGE_RESULT_TAB":
        next.ui.challengeResultTab = action.tab;
        return next;
      case "UI_SET_CHALLENGE_RESULT_MODE":
        next.ui.challengeResultMode = action.mode;
        return next;
      case "UI_SET_CHALLENGE_RESULT_PLAYER":
        next.ui.challengeResultPlayerId = action.playerId;
        return next;
      case "UI_SET_GAME_OVER_TAB":
        next.ui.gameOverTab = action.tab;
        return next;
      case "UI_CLOSE_EVALUATION":
        next.ui.endgameEvaluation = undefined;
        next.phase = "GAME_OVER";
        next.pendingChallenges = [];
        next.challenge = undefined;
        next.ui.shopOpen = false;
        next.ui.earthShopOpen = false;
        next.ui.pendingSell = undefined;
        next.log.push("Evaluation complete. Final standings locked.");
        return next;
      case "UI_SELECT_TROPHY": {
        const review = next.ui.progressReview;
        if (!review || review.resolved || !review.winnerPlayerId) {
          return next;
        }
        const winner = next.players.find((player) => player.id === review.winnerPlayerId);
        if (!winner || winner.isAI) {
          return next;
        }
        const choice = review.trophyOptions.find((option) => option.id === action.trophyId);
        if (!choice) {
          return next;
        }
        const reward = applyTrophyToPlayer(winner, choice);
        review.selectedTrophyId = choice.id;
        review.selectedByPlayerId = winner.id;
        review.selectedRewardAp = reward.grantedAp;
        review.selectedPassiveBuffText = reward.passiveText;
        review.resolved = true;
        const passive = reward.passiveText ? ` ${reward.passiveText}` : "";
        next.log.push(
          `${winner.name} claims Trophy: ${choice.name} (+${reward.grantedAp} AP).${passive}`
        );
        return next;
      }
      case "UI_CLOSE_PROGRESS_REVIEW": {
        const review = next.ui.progressReview;
        if (!review) {
          return next;
        }
        if (!review.resolved && review.winnerPlayerId) {
          return next;
        }
        next.reviewHistory.push(structuredClone(review));
        next.ui.progressReview = undefined;
        return next;
      }
      case "UI_RESOLVE_THIRD_EYE_TARGET": {
        const selection = next.ui.pendingThirdEyeSelection;
        const challenge = next.challenge;
        if (!selection || !challenge) {
          return next;
        }
        const target = selection.targets.find((t) => t.playerId === action.targetPlayerId && t.cardId === action.targetCardId);
        if (!target) {
          return next;
        }
        resolveThirdEyeSelection(next, challenge, selection.casterId, target.playerId, target.cardId);
        next.ui.pendingThirdEyeSelection = undefined;
        return next;
      }
      case "CHALLENGE_DRAFT_PICK": {
        const challenge = next.challenge;
        if (!challenge || next.phase !== "CHALLENGE" || challenge.phase !== "DRAFT") {
          return next;
        }
        const reward = challenge.rewardPool?.rewards.find((item) => item.id === action.rewardId);
        if (!reward || !reward.isUnlocked || reward.isClaimed) {
          return next;
        }
        const human = next.players.find((p) => !p.isAI);
        const currentPickerId = currentDraftPickerId(challenge);
        if (!human || human.id !== currentPickerId) {
          return next;
        }
        reward.isClaimed = true;
        reward.claimedByPlayerId = human.id;
        addChallengeLog(next, `${human.name} claims ${rewardDisplayLabel(reward)}.`);

        const remaining = unlockedUnclaimedRewards(challenge);
        if (remaining.length === 0 || !challenge.draft || challenge.draft.pickOrderPlayerIds.length === 0) {
          addChallengeLog(next, "Draft concludes.");
          resolveChallengeWithSfx(next, this.rng);
          return next;
        }
        challenge.draft.currentPickIndex =
          (challenge.draft.currentPickIndex + 1) % Math.max(1, challenge.draft.pickOrderPlayerIds.length);
        return next;
      }
      case "UI_REQUEST_SELL": {
        if (!next.ui.shopOpen) {
          return next;
        }
        const human = next.players.find((p) => !p.isAI);
        if (!human) return next;

        const kind = action.kind;
        const index = action.index;

        const setPending = (label: string, crystals: number) => {
          next.ui.pendingSell = { kind, index, label, crystals };
        };

        if (kind === "HAND_CARD") {
          const cardId = human.hand[index];
          if (!cardId) return next;
          const name = dataStore.cardsById[cardId]?.name ?? cardId;
          setPending(name, 1);
          return next;
        }
        if (kind === "SPELL") {
          const spellId = human.spells[index];
          if (!spellId) return next;
          const name = dataStore.spellsById[spellId]?.name ?? spellId;
          setPending(name, 1);
          return next;
        }
        if (kind === "ARTIFACT") {
          const artifactId = human.artifacts[index];
          if (!artifactId) return next;
          const name = dataStore.artifactsById[artifactId]?.name ?? artifactId;
          setPending(name, 2);
          return next;
        }
        // TEACHING
        const teachingId = human.teachings[index];
        if (!teachingId) return next;
        const t = dataStore.teachingsById[teachingId];
        if (!t) return next;
        if (t.tier === "basic") {
          next.log.push(`${human.name} cannot sell Basic Teachings.`);
          playDeny();
          return next;
        }
        // Locked economy: sellable items are 1 Crystal (Artifacts are 2).
        setPending(t.name, 1);
        return next;
      }
      case "UI_CANCEL_SELL":
        next.ui.pendingSell = undefined;
        return next;
      case "UI_CONFIRM_SELL": {
        if (!next.ui.pendingSell) return next;
        const human = next.players.find((p) => !p.isAI);
        if (!human) return next;

        const p = next.ui.pendingSell;
        next.ui.pendingSell = undefined;
        if (p.kind === "HAND_CARD") {
          sellHandCard(human, p.index, next);
        } else if (p.kind === "SPELL") {
          sellSpell(human, p.index, next);
        } else if (p.kind === "ARTIFACT") {
          sellArtifact(human, p.index, next);
        } else {
          sellTeaching(human, p.index, next);
        }
        return next;
      }
      case "DEV_GRANT_ARTIFACT": {
        const human = next.players.find((p) => !p.isAI);
        if (!human) return next;
        const artifactId = action.id;
        const artifact = dataStore.artifactsById[artifactId];
        if (!artifact) return next;
        human.artifacts.push(artifactId);
        next.log.push(`[DEV] Granted artifact: ${artifact.name}`);
        return next;
      }
      case "DEV_GRANT_TEACHING": {
        const human = next.players.find((p) => !p.isAI);
        if (!human) return next;
        const teachingId = action.id;
        const teaching = dataStore.teachingsById[teachingId];
        if (!teaching) return next;
        if (teaching.tier === "basic") {
          human.teachings.push(teachingId);
        } else {
          human.passiveTeachings.push(teachingId);
        }
        next.log.push(`[DEV] Granted teaching: ${teaching.name}`);
        return next;
      }
      case "SET_DEV_TAB":
        next.ui.devPanelTab = action.tab;
        return next;
      case "SET_DEV_SCROLL":
        next.ui.devPanelScroll = action.value;
        return next;
      case "SET_SHOP_TAB":
        next.ui.shopTab = action.tab;
        return next;
      case "BUY_SHOP_CARD": {
        const human = next.players.find((p) => !p.isAI);
        if (!human || next.phase !== "ACTION_SELECT") {
          return next;
        }
        if (!canShopBuyCard(human)) {
          next.log.push(`${human.name} has already reached the purchase limit this turn.`);
          return next;
        }
        const costCrystals = SHOP_CARD_COST;
        if (!canAffordCrystals(human, costCrystals)) {
          next.log.push(`${human.name} cannot afford a Game Card (cost ${formatCrystals(costCrystals)} Crystals).`);
          playDeny();
          return next;
        }
        const cardIdx = next.shopOfferings.cards.indexOf(action.cardId);
        if (cardIdx < 0) {
          next.log.push("That card is no longer available in the shop.");
          return next;
        }
        next.shopOfferings.cards.splice(cardIdx, 1);
        payCostCrystals(human, costCrystals);
        human.hand.push(action.cardId);
        registerShopPurchase(human, "CARD");
        const cardName = dataStore.cardsById[action.cardId]?.name ?? "Game Card";
        next.log.push(`${human.name} bought ${cardName} for ${formatCrystals(costCrystals)} Crystals.`);
        return next;
      }
      case "BUY_SHOP_SPELL": {
        const human = next.players.find((p) => !p.isAI);
        if (!human || next.phase !== "ACTION_SELECT") {
          return next;
        }
        if (!canShopBuySpell(human)) {
          next.log.push(`${human.name} has already reached the purchase limit this turn.`);
          return next;
        }
        const costCrystals = SHOP_INVOCATION_COST;
        if (!canAffordCrystals(human, costCrystals)) {
          next.log.push(`${human.name} cannot afford an Invocation (cost ${formatCrystals(costCrystals)} Crystals).`);
          playDeny();
          return next;
        }
        if (!hasFreeInvocationSlot(human)) {
          next.log.push("Invocation skipped: no free slot.");
          return next;
        }
        const spellIdx = next.shopOfferings.invocations.indexOf(action.spellId);
        if (spellIdx < 0) {
          next.log.push("That invocation is no longer available in the shop.");
          return next;
        }
        next.shopOfferings.invocations.splice(spellIdx, 1);
        if (!grantInvocation(next, human, action.spellId)) {
          // Put it back if grant failed
          next.shopOfferings.invocations.push(action.spellId);
          return next;
        }
        payCostCrystals(human, costCrystals);
        registerShopPurchase(human, "SPELL");
        const spellName = dataStore.spellsById[action.spellId]?.name ?? "Invocation";
        next.log.push(`${human.name} bought ${spellName} for ${formatCrystals(costCrystals)} Crystals.`);
        return next;
      }
      case "CONFIRM_ACTION": {
        const human = next.players.find((player) => !player.isAI);
        if (human && !next.ui.selectedAction) {
          next.log.push("Select an action before confirming.");
          return next;
        }
        if (human && next.ui.selectedAction) {
          human.action = next.ui.selectedAction;
          human.locked = true;
          next.ui.shopOpen = false;
          next.ui.earthShopOpen = false;
          next.ui.focusDrawerOpen = false;
          if (human.action === "EARTH") {
            human.earthTierChoice = next.ui.selectedEarthTier ?? 1;
          }
        }
        const aiActions: AiQueuedActionInput[] = [];
        next.players.forEach((player) => {
          if (!player.isAI) {
            return;
          }
          if (next.phase === "ACTION_SELECT") {
            const hasDoctrine = hasDoctrineOfAbundance(player);
            const maxCard = hasDoctrine ? 2 : 1;
            const maxSpell = hasDoctrine ? 2 : 1;
            const maxTotal = hasDoctrine ? maxCard + maxSpell : 1;
            let plannedCard = player.purchasesCardThisTurn ?? 0;
            let plannedSpell = player.purchasesSpellThisTurn ?? 0;
            for (let i = 0; i < maxTotal; i += 1) {
              if (!hasDoctrine && plannedCard + plannedSpell >= 1) break;
              if (hasDoctrine && plannedCard >= maxCard && plannedSpell >= maxSpell) break;
              const shopChoice = decideAiShopPurchase(next, player, this.rng, {
                plannedCard,
                plannedSpell
              });
              if (shopChoice === "CARD" && plannedCard < maxCard) {
                plannedCard += 1;
                aiActions.push({
                  playerId: player.id,
                  scope: "SHOP",
                  kind: "AI_SHOP_BUY_CARD",
                  label: `${player.name} is thinking... (buying a card)`
                });
                continue;
              }
              if (shopChoice === "SPELL" && plannedSpell < maxSpell) {
                plannedSpell += 1;
                aiActions.push({
                  playerId: player.id,
                  scope: "SHOP",
                  kind: "AI_SHOP_BUY_SPELL",
                  label: `${player.name} is thinking... (buying an invocation)`
                });
                continue;
              }
              break;
            }
          }
          aiActions.push({
            playerId: player.id,
            scope: "BOARD",
            kind: "AI_SELECT_ACTION",
            label: `${player.name} is thinking... (choosing action)`
          });
        });
        aiActions.forEach((aiAction) => enqueueAiAction(next, aiAction));
        next.phase = "ACTION_REVEAL";
        if (aiActions.length > 0) {
          next.aiPendingReveal = true;
        } else {
          next.aiPendingReveal = false;
          next.log.push("Actions locked in.");
        }
        return next;
      }
      case "LOCK_ACTIONS": {
        next.aiPendingReveal = false;
        const groups: Record<ActionChoice, PlayerState[]> = {
          MEDITATE: [],
          MOUNTAIN: [],
          CAVE: [],
          EARTH: []
        };
        next.players.forEach((player) => {
          if (player.action) {
            groups[player.action].push(player);
            // Journey streak removed — TP is now per-challenge
          }
        });

        (Object.keys(groups) as ActionChoice[]).forEach((key) => {
          const group = groups[key];
          if (key === "MEDITATE" && group.length > 0) {
            withRewardSfx(next, () => resolveUncontestedActions(next, this.rng, key, group));
            return;
          }
          if (group.length === 1 && key !== "EARTH" && key !== "MOUNTAIN" && key !== "CAVE") {
            withRewardSfx(next, () => resolveUncontestedActions(next, this.rng, key, group));
          }
        });

        const pending: PendingChallenge[] = [];

        // Earth Advancement is a deliberate, solo "integration" action.
// Anyone who chooses EARTH may attempt to complete an Earth Advancement by spending Crystals.
// (Tier choice is stored on the player: earthTierChoice.)
if (groups.EARTH.length > 0) {
  for (const player of groups.EARTH) {
    const tier = player.earthTierChoice ?? 1;
    if (!canBuyEarthAdvancement(next, player, tier)) {
      next.log.push(`${player.name} cannot afford an Earth Advancement (Tier ${tier}) or the deck is empty.`);
      continue;
    }
    buyEarthAdvancement(next, player, tier, this.rng);
  }
}

        // Journeys always trigger a Guardian Challenge now (even if uncontested),
        // so rewards must be unlocked via AP during the rite rather than granted instantly.
        if (groups.MOUNTAIN.length > 0) {
          pending.push({
            id: "MOUNTAIN",
            contestants: groups.MOUNTAIN.map((p) => p.id),
            rewardPool: next.rewardPools.mountain
          });
          next.log.push(`Mountain Journey: Guardian Challenge begins - ${rewardPoolSummary(next.rewardPools.mountain ?? { rewards: [] })}.`);
        }
        if (groups.CAVE.length > 0) {
          pending.push({
            id: "CAVE",
            contestants: groups.CAVE.map((p) => p.id),
            rewardPool: next.rewardPools.cave
          });
          next.log.push(`Cave Journey: Guardian Challenge begins - ${rewardPoolSummary(next.rewardPools.cave ?? { rewards: [] })}.`);
        }

        next.pendingChallenges = pending;
        clearSelections(next);
        next.ui.focusDrawerOpen = false;

        if (next.pendingChallenges.length > 0) {
          const first = next.pendingChallenges.shift();
          if (first) {
            next.challenge = setupChallenge(next, this.rng, first);
            next.phase = "CHALLENGE";
            next.ui.challengeLogScroll = 0;
            next.ui.challengeFlashText = "ROLL ORDER";
            next.ui.challengeFlashTimerMs = scaledChallengeDelay(next, 700);
            next.ui.handTab = "ALL";
            next.ui.handScroll = 0;
            addChallengeLog(next, "Initiative rolls begin.");
          }
        }

        if (!next.challenge && next.pendingChallenges.length === 0) {
          return this.advanceTurn(next);
        }

        return next;
      }
      case "SELECT_CARD": {
        const challenge = next.challenge;
        if (!challenge || next.phase !== "CHALLENGE" || challenge.phase !== "COMMIT_TURNS") {
          return next;
        }
        const human = next.players.find((player) => !player.isAI);
        const order = challenge.turnOrder.length > 0 ? challenge.turnOrder : challenge.order;
        const activeId = order[challenge.activeTurnIndex] ?? order[0];
        if (!human || activeId !== human.id) {
          return next;
        }
        const played = challenge.played[human.id];
        const committedCount = played ? played.selected.length + played.spellsPlayed.length : 0;
        if (committedCount >= CHALLENGE_COMMIT_MAX) {
          return next;
        }
        // One-card-per-beat commit flow: you may select at most 1 game card OR 1 invocation.
        const cardIndex = action.cardIndex;
        const cardId = human.hand[cardIndex];
        if (!cardId) {
          return next;
        }
        if (next.ui.pendingSpellId) {
          return next;
        }
        const selected = next.ui.selectedCards;
        if (selected.length > 0 && selected[0] === cardIndex) {
          next.ui.selectedCards = [];
        } else {
          next.ui.selectedCards = [cardIndex];
        }
        return next;
      }
      case "SET_FACE_DOWN": {
        // Face-down selection is no longer used in the sequential beat flow.
        next.ui.selectedFaceDown = undefined;
        return next;
      }
      case "SET_PENDING_SPELL": {
        const challenge = next.challenge;
        if (!challenge || next.phase !== "CHALLENGE" || challenge.phase !== "COMMIT_TURNS") {
          return next;
        }
        const human = next.players.find((player) => !player.isAI);
        const order = challenge.turnOrder.length > 0 ? challenge.turnOrder : challenge.order;
        const activeId = order[challenge.activeTurnIndex] ?? order[0];
        if (!human || activeId !== human.id) {
          return next;
        }
        const played = challenge.played[human.id];
        const committedCount = played ? played.selected.length + played.spellsPlayed.length : 0;
        if (committedCount >= CHALLENGE_COMMIT_MAX) {
          return next;
        }
        // One-card-per-beat: selecting an invocation clears any card selection, and vice-versa.
        next.ui.pendingSpellId = action.spellId;
        next.ui.selectedCards = [];
        next.ui.selectedFaceDown = undefined;
        return next;
      }
      case "SET_PENDING_ESCALATION_CARD":
        return next;
      case "LOCK_CARDS": {
        // Close any pending withdraw confirmation when you act.
        next.ui.confirmWithdraw = false;
        const challenge = next.challenge;
        if (!challenge || next.phase !== "CHALLENGE" || challenge.phase !== "COMMIT_TURNS") {
          return next;
        }
        const human = next.players.find((p) => !p.isAI);
        if (!human) {
          return next;
        }
        const order = challenge.turnOrder.length > 0 ? challenge.turnOrder : challenge.order;
        const activeId = order[challenge.activeTurnIndex] ?? order[0];
        if (activeId !== human.id) {
          return next;
        }
        const played = challenge.played[human.id];
        if (!played) {
          return next;
        }

        // Sequential beat flow: one action per beat (Card OR Invocation). If you choose neither, you PASS.
        // Hard cap: each player may commit at most 3 total items (cards + invocations) per challenge.
        const committedCount = played.selected.length + played.spellsPlayed.length;
        if (committedCount >= CHALLENGE_COMMIT_MAX && (next.ui.selectedCards[0] !== undefined || next.ui.pendingSpellId)) {
          next.log.push(`Max ${CHALLENGE_COMMIT_MAX} commits per challenge.`);
          addChallengeLog(next, `${human.name} cannot commit more (max ${CHALLENGE_COMMIT_MAX}).`);
          playDeny();
          return next;
        }
        const selectedIdx = next.ui.selectedCards[0];
        const pendingSpellId = next.ui.pendingSpellId;

        if (selectedIdx !== undefined && pendingSpellId) {
          next.log.push("Choose either a Card OR an Invocation (one per beat).");
          playDeny();
          return next;
        }

        let acted = false;
        if (selectedIdx !== undefined) {
          const cardId = human.hand[selectedIdx];
          if (!cardId) {
            return next;
          }
          // Remove immediately; used cards are discarded.
          human.hand.splice(selectedIdx, 1);
          next.decks.discardGame.push(cardId);
          const wasFirstCard = played.selected.length === 0 && played.extraCards.length === 0;
          played.selected.push(cardId);
          if (!played.firstCommittedCardId) {
            played.firstCommittedCardId = cardId;
          }
          if (challenge.metrics) {
            challenge.metrics.teachingPowerPlayedSoFar += cardTeachingPower(cardId);
          }
          let isHidden = false;
          if (wasFirstCard) {
            isHidden = true;
          } else if (hasPassiveTeaching(human, "veil_of_uncertainty") && this.rng.next() < VEIL_OF_UNCERTAINTY_CHANCE) {
            isHidden = true;
          }
          if (isHidden) {
            played.hiddenCardIds = played.hiddenCardIds ?? [];
            if (!played.hiddenCardIds.includes(cardId)) {
              played.hiddenCardIds.push(cardId);
            }
            if (!played.faceDownId) {
              played.faceDownId = cardId;
            }
            if (hasPassiveTeaching(human, "false_signal")) {
              addChallengeLog(next, "A card was concealed.");
            }
          }
          played.committedItems = played.committedItems ?? [];
          played.committedItems.push({ kind: "card", id: cardId });
          const tpGain = teachingPotentialGainForCard(cardId);
          addChallengeTP(next, challenge, human, this.rng, tpGain);
          // Trigger card_committed event for artifacts/teachings that grant bonus TP
          triggerEffects("card_committed", {
            state: next,
            player: human,
            rng: this.rng,
            event: "card_committed",
            challenge,
            played,
            cardId
          });
          const card = dataStore.cardsById[cardId];
          const chalTP = challenge.challengeTPByPlayer?.[human.id] ?? 0;
          addChallengeLog(next, `${human.name} commits ${card?.name ?? 'a card'}${isHidden ? ' (face-down)' : ''}.`);
          addChallengeLog(next, `+${Math.floor(tpGain * TP_GAIN_MULT)} Challenge TP (Total: ${Math.floor(chalTP)}).`);
          recordChallengeApContribution(next, challenge, human.id, cardValue(cardId), this.rng);
          acted = true;
        } else if (pendingSpellId) {
          if (!human.spells.includes(pendingSpellId)) {
            return next;
          }
          const prevBonus = played.powerBonus;
          const prevExtra = played.extraCards.length;
          applySpellEffect(next, challenge, human, pendingSpellId, this.rng);
          const bonusDelta = Math.max(0, played.powerBonus - prevBonus);
          const addedExtras = played.extraCards.slice(prevExtra);
          const extraDelta = addedExtras.reduce((sum, cardId) => sum + cardValue(cardId), 0);
          if (challenge.metrics) {
            challenge.metrics.teachingPowerPlayedSoFar += addedExtras.reduce(
              (sum, cardId) => sum + cardTeachingPower(cardId),
              0
            );
          }
          recordChallengeApContribution(next, challenge, human.id, CHALLENGE_SPELL_BASE_AP + bonusDelta + extraDelta);
          addChallengeTP(next, challenge, human, this.rng, 1);
          const invChalTP = challenge.challengeTPByPlayer?.[human.id] ?? 0;
          addChallengeLog(next, `${human.name} invokes (hidden).`);
          addChallengeLog(next, `+${Math.floor(1 * TP_GAIN_MULT)} Challenge TP from invocation (Total: ${Math.floor(invChalTP)}).`);
          played.committedItems = played.committedItems ?? [];
          played.committedItems.push({ kind: "spell", id: pendingSpellId });
          acted = true;
        }

        if (acted) {
          challenge.passesInRow = 0;
          playCardCommit();
        } else {
          challenge.passesInRow = (challenge.passesInRow ?? 0) + 1;
          addChallengeLog(next, `${human.name} passes.`);
        }
        challenge.beatCount = (challenge.beatCount ?? 0) + 1;

        // Clear UI selections for the next beat.
        next.ui.selectedCards = [];
        next.ui.selectedFaceDown = undefined;
        next.ui.pendingSpellId = undefined;
        next.ui.pendingEscalationCardIndex = undefined;

        // Advance to the next player.
        challenge.activeTurnIndex = (challenge.activeTurnIndex + 1) % Math.max(1, (challenge.turnOrder.length || challenge.order.length));

        // End commit when everyone has passed consecutively once.
        const playerCount = (challenge.turnOrder.length || challenge.order.length);
        if ((challenge.passesInRow ?? 0) >= playerCount) {
          triggerChallengeAutoEffects(next, this.rng);
          challenge.phase = "REVEAL";
          challenge.revealIndex = 0;
          challenge.phaseTimerMs = scaledChallengeDelay(next, 500);
          next.ui.challengeFlashText = "REVEAL";
          next.ui.challengeFlashTimerMs = scaledChallengeDelay(next, 600);
          addChallengeLog(next, "Reveal begins." );
        }
        return next;
      }

case "ADD_ESCALATION_CARD":
  return next;
case "FOLD_CHALLENGE": {
        next.ui.confirmWithdraw = false;
        const challenge = next.challenge;
        if (!challenge || next.phase !== "CHALLENGE" || challenge.phase !== "COMMIT_TURNS") {
          return next;
        }
        const human = next.players.find((p) => !p.isAI);
        if (!human) {
          return next;
        }
        const order = challenge.turnOrder.length > 0 ? challenge.turnOrder : challenge.order;
        const activeId = order[challenge.activeTurnIndex];
        if (activeId !== human.id) {
          return next;
        }
        if (!challenge.folded.includes(human.id)) {
          challenge.folded.push(human.id);
          addChallengeLog(next, `${human.name} folds (withdraws).`);
        }
        // Remove from turn order so PASS end-condition counts only active players.
        challenge.turnOrder = challenge.turnOrder.filter((id) => id !== human.id);
        challenge.order = challenge.order.filter((id) => id !== human.id);
        if (challenge.activeTurnIndex >= (challenge.turnOrder.length || 1)) {
          challenge.activeTurnIndex = 0;
        }
        // Folding does not count as a PASS; reset consecutive passes.
        challenge.passesInRow = 0;
        return next;
      }
      case "PLAY_SPELL":
        return next;
      case "PLAY_TEACHING": {
        const teaching = dataStore.teachingsById[action.teachingId];
        if (!teaching) {
          return next;
        }
        if (next.phase === "ACTION_SELECT") {
          const player = next.players.find((p) => !p.isAI);
          if (!player) {
            return next;
          }
          if (teaching.tier !== "basic") {
            next.log.push(`${player.name} cannot use ${teaching.name} right now.`);
            return next;
          }
          applyTeachingEffect(next, undefined, player, action.teachingId, this.rng);
          next.log.push(`${player.name} consumed ${teaching.name}.`);
          return next;
        }
        const challenge = next.challenge;
        if (!challenge || next.phase !== "CHALLENGE" || challenge.phase !== "COMMIT_TURNS") {
          return next;
        }
        const order = challenge.turnOrder.length > 0 ? challenge.turnOrder : challenge.order;
        const currentId = order[challenge.activeTurnIndex] ?? order[0];
        const player = next.players.find((p) => p.id === currentId);
        if (!player || player.isAI) {
          return next;
        }
        applyTeachingEffect(next, challenge, player, action.teachingId, this.rng);
        addChallengeLog(next, `${player.name} uses ${dataStore.teachingsById[action.teachingId]?.name ?? "a teaching"}.`);
        return next;
      }
      case "PASS_SPELL":
        return next;
      case "END_TURN":
        return this.advanceTurn(next);
      case "NEXT_CHALLENGE": {
        if (next.pendingChallenges.length > 0) {
          const pending = next.pendingChallenges.shift();
          if (pending) {
            next.challenge = setupChallenge(next, this.rng, pending);
            next.phase = "CHALLENGE";
            next.ui.focusDrawerOpen = false;
            next.ui.challengeLogScroll = 0;
            next.ui.challengeFlashText = "ROLL ORDER";
            next.ui.challengeFlashTimerMs = scaledChallengeDelay(next, 700);
            next.ui.handTab = "ALL";
            next.ui.handScroll = 0;
            addChallengeLog(next, "Initiative rolls begin.");
          }
        } else {
          return this.advanceTurn(next);
        }
        return next;
      }
      default:
        return next;
    }
  }
}

function rollD6(rng: Rng, bonus = 0): number {
  return rng.rollDie(6, bonus);
}

function addChallengeLog(state: GameState, text: string): void {
  if (state.challenge) {
    state.challenge.logEntries.push(text);
  }
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

function rewardPoolSummary(pool: { rewards: RewardItem[] }): string {
  if (!pool.rewards || pool.rewards.length === 0) {
    return "no rewards";
  }
  return pool.rewards.map((reward) => rewardDisplayLabel(reward)).join(", ");
}

function unlockedUnclaimedRewards(challenge: ChallengeState): RewardItem[] {
  return (challenge.rewardPool?.rewards ?? []).filter((reward) => reward.isUnlocked && !reward.isClaimed);
}

function currentDraftPickerId(challenge: ChallengeState): string | undefined {
  const draft = challenge.draft;
  if (!draft || draft.pickOrderPlayerIds.length === 0) {
    return undefined;
  }
  const idx = draft.currentPickIndex % draft.pickOrderPlayerIds.length;
  return draft.pickOrderPlayerIds[idx];
}

function beginGuardianDraft(state: GameState, rng: Rng, challenge: ChallengeState): void {
  if (!challenge.totals) {
    challenge.totals = calculateChallengeTotals(state, challenge, rng);
  }
  const { newlyUnlocked, pickOrderPlayerIds, totalGroupAp } = prepareGuardianDraft(state, challenge);

  challenge.contestants.forEach((playerId) => {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return;
    const ap = challenge.apContributionByPlayer?.[playerId] ?? 0;
    addChallengeLog(state, `${player.name} contributes ${ap} AP.`);
  });
  addChallengeLog(state, `Total group AP: ${totalGroupAp}.`);

  newlyUnlocked.forEach((reward) => {
    addChallengeLog(state, "Guardian: A new offering awakens.");
    addChallengeLog(state, `Reward unlocked: ${rewardDisplayLabel(reward)}.`);
  });

  const remaining = unlockedUnclaimedRewards(challenge);
  if (remaining.length === 0 || pickOrderPlayerIds.length === 0) {
    addChallengeLog(state, "No rewards unlocked.");
    resolveChallengeWithSfx(state, rng);
    return;
  }

  challenge.phase = "DRAFT";
  challenge.draft = {
    isDraftPhase: true,
    pickOrderPlayerIds,
    currentPickIndex: 0
  };
  addChallengeLog(state, "Guardian: The draft begins.");
}

function showTurnToast(state: GameState, player: PlayerState): void {
  const gains = state.lastTurnStartGains[player.id] ?? [];
  const title = player.isAI
    ? `Round ${state.turn} - ${player.name}'s Turn`
    : `Round ${state.turn} - Your Turn`;
  // Removed auto-expiration - toast now requires click to dismiss
  state.ui.turnToast = {
    title,
    lines: gains,
    expiresAt: Number.MAX_SAFE_INTEGER // Never expires
  };
  state.log.push(`Turn toast shown: ${title}`);
}

type AiQueuedActionInput = Omit<AiQueuedAction, "remainingMs">;

function startAiAction(state: GameState, action: AiQueuedActionInput): void {
  const delayMs = scaledDelayMs(2000, state.settings.gameSpeedMode);
  state.aiActive = { ...action, remainingMs: delayMs };
  state.ui.aiStatus = {
    playerId: action.playerId,
    message: action.label,
    isThinking: true,
    startedAt: Date.now()
  };
  state.ui.activeHighlightPlayerId = action.playerId;
  state.ui.activeHighlightScope = action.scope;
}

function enqueueAiAction(state: GameState, action: AiQueuedActionInput): void {
  if (!state.aiQueue) {
    state.aiQueue = [];
  }
  if (state.aiActive) {
    state.aiQueue.push({ ...action, remainingMs: 0 });
  } else {
    startAiAction(state, action);
  }
}

function clearAiIndicators(state: GameState): void {
  state.ui.aiStatus = null;
  state.ui.activeHighlightPlayerId = null;
  state.ui.activeHighlightScope = null;
}

function executeAiAction(state: GameState, rng: Rng, action: AiQueuedActionInput): void {
  const player = state.players.find((p) => p.id === action.playerId);
  if (!player) {
    return;
  }
  switch (action.kind) {
    case "AI_SHOP_BUY_CARD": {
      if (!canShopBuyCard(player)) return;
      const costCrystals = SHOP_CARD_COST;
      if (!canAffordCrystals(player, costCrystals)) return;
      if (state.shopOfferings.cards.length === 0) return;
      // AI picks a random card from offerings
      const aiCardIdx = Math.floor(rng.next() * state.shopOfferings.cards.length);
      const cardId = state.shopOfferings.cards.splice(aiCardIdx, 1)[0];
      payCostCrystals(player, costCrystals);
      player.hand.push(cardId);
      registerShopPurchase(player, "CARD");
      const aiCardName = dataStore.cardsById[cardId]?.name ?? "Game Card";
      state.log.push(`${player.name} bought ${aiCardName} for ${formatCrystals(costCrystals)} Crystals.`);
      return;
    }
    case "AI_SHOP_BUY_SPELL": {
      if (!canShopBuySpell(player)) return;
      const costCrystals = SHOP_INVOCATION_COST;
      if (!canAffordCrystals(player, costCrystals)) return;
      if (!hasFreeInvocationSlot(player)) {
        state.log.push("Invocation skipped: no free slot.");
        return;
      }
      if (state.shopOfferings.invocations.length === 0) return;
      // AI picks a random invocation from offerings
      const aiSpellIdx = Math.floor(rng.next() * state.shopOfferings.invocations.length);
      const spellId = state.shopOfferings.invocations.splice(aiSpellIdx, 1)[0];
      if (!grantInvocation(state, player, spellId)) {
        state.shopOfferings.invocations.push(spellId);
        return;
      }
      payCostCrystals(player, costCrystals);
      registerShopPurchase(player, "SPELL");
      const aiSpellName = dataStore.spellsById[spellId]?.name ?? "Invocation";
      state.log.push(`${player.name} bought ${aiSpellName} for ${formatCrystals(costCrystals)} Crystals.`);
      return;
    }
    case "AI_SELECT_ACTION": {
      player.action = decideAiAction(state, player, rng);
      player.locked = true;
      if (player.action === "EARTH") {
        player.earthTierChoice = chooseAiEarthTier(state, player);
      }
      if (player.action) {
        const actionLabel = player.action === "EARTH"
          ? `EARTH (Tier ${player.earthTierChoice ?? 1})`
          : player.action;
        state.log.push(`${player.name} chooses ${actionLabel}.`);
      }
      return;
    }
    case "AI_COMMIT_CHALLENGE": {
      const challenge = state.challenge;
      if (!challenge || state.phase !== "CHALLENGE") return;
      commitAiTurn(state, rng, player.id);
      challenge.aiPending = false;
      const order = challenge.turnOrder.length > 0 ? challenge.turnOrder : challenge.order;
      challenge.activeTurnIndex = (challenge.activeTurnIndex + 1) % Math.max(1, order.length);
      
      // If auto-play is enabled and it's the human's turn again, queue another action
      const human = state.players.find((p) => !p.isAI);
      if (human && state.ui.challengeAutoPlay) {
        const nextActiveId = order[challenge.activeTurnIndex ?? 0];
        if (nextActiveId === human.id && challenge.phase === "COMMIT_TURNS") {
          state.aiQueue.push({
            playerId: human.id,
            label: "Auto-playing...",
            scope: "CHALLENGE",
            kind: "AI_COMMIT_CHALLENGE",
            remainingMs: scaledDelayMs(600, state.settings.gameSpeedMode)
          });
        }
      }
      
      const playerCount = order.length;
      if ((challenge.passesInRow ?? 0) >= playerCount) {
        triggerChallengeAutoEffects(state, rng);
        challenge.phase = "REVEAL";
        challenge.revealIndex = 0;
        challenge.phaseTimerMs = scaledChallengeDelay(state, 500);
        state.ui.challengeFlashText = "REVEAL";
        state.ui.challengeFlashTimerMs = scaledChallengeDelay(state, 600);
        addChallengeLog(state, "Reveal begins.");
        // Disable auto-play when challenge ends
        if (state.ui.challengeAutoPlay) {
          state.ui.challengeAutoPlay = false;
        }
      }
      return;
    }
    default:
      return;
  }
}

function tickAiActions(state: GameState, rng: Rng, dt: number): void {
  if (!state.aiActive) {
    if (state.aiQueue.length > 0) {
      const next = state.aiQueue.shift();
      if (next) {
        startAiAction(state, next);
      }
    }
    return;
  }

  state.aiActive.remainingMs = Math.max(0, state.aiActive.remainingMs - dt);
  if (state.aiActive.remainingMs > 0) {
    return;
  }

  const active = state.aiActive;
  state.aiActive = undefined;
  executeAiAction(state, rng, active);
  clearAiIndicators(state);

  if (state.aiQueue.length > 0) {
    const next = state.aiQueue.shift();
    if (next) {
      startAiAction(state, next);
    }
    return;
  }

  if (state.aiPendingReveal) {
    state.aiPendingReveal = false;
    state.log.push("Actions locked in.");
  }
}

function resolveInitiative(rolls: Record<string, number | null>): string[] {
  const entries = Object.entries(rolls)
    .filter((entry): entry is [string, number] => entry[1] !== null)
    .map(([id, roll]) => ({ id, roll }));
  entries.sort((a, b) => a.roll - b.roll);
  return entries.map((entry) => entry.id);
}

function findTieGroups(rolls: Record<string, number | null>): Array<{ value: number; ids: string[] }> {
  const grouped = new Map<number, string[]>();
  Object.entries(rolls).forEach(([id, roll]) => {
    if (roll === null) return;
    const list = grouped.get(roll) ?? [];
    list.push(id);
    grouped.set(roll, list);
  });
  return Array.from(grouped.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([value, ids]) => ({ value, ids }));
}

function commitAiTurn(state: GameState, rng: Rng, playerId: string): void {
  const challenge = state.challenge;
  if (!challenge) return;
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !player.isAI) return;
  const played = challenge.played[playerId];
  if (!played) return;

  // Hard cap: each player may commit at most 3 total items (cards + invocations) per challenge.
  const committedCount = played.selected.length + played.spellsPlayed.length;
  if (committedCount >= CHALLENGE_COMMIT_MAX) {
    challenge.passesInRow = (challenge.passesInRow ?? 0) + 1;
    addChallengeLog(state, `${player.name} passes.`);
    challenge.beatCount = (challenge.beatCount ?? 0) + 1;
    return;
  }

  // Teachings can still be used by AI (not visible to the opponent).
  if (player.teachings.length > 0) {
    const toUse = [...player.teachings];
    toUse.forEach((teachingId) => {
      applyTeachingEffect(state, challenge, player, teachingId, rng);
      addChallengeLog(state, `${player.name} uses a teaching.`);
    });
  }

  const playSpellChance = 0.30;
  let acted = false;

  if (player.spells.length > 0 && (player.hand.length === 0 || rng.next() < playSpellChance)) {
    const spellId = player.spells[0];
    const prevBonus = played.powerBonus;
    const prevExtra = played.extraCards.length;
    applySpellEffect(state, challenge, player, spellId, rng);
    const bonusDelta = Math.max(0, played.powerBonus - prevBonus);
    const extraDelta = played.extraCards
      .slice(prevExtra)
      .reduce((sum, cardId) => sum + cardValue(cardId), 0);
    recordChallengeApContribution(state, challenge, player.id, CHALLENGE_SPELL_BASE_AP + bonusDelta + extraDelta);
    addChallengeTP(state, challenge, player, rng, 1);
    const aiInvTP = challenge.challengeTPByPlayer?.[player.id] ?? 0;
    addChallengeLog(state, `${player.name} invokes (hidden).`);
    addChallengeLog(state, `+${Math.floor(1 * TP_GAIN_MULT)} Challenge TP from invocation (Total: ${Math.floor(aiInvTP)}).`);
    played.committedItems = played.committedItems ?? [];
    played.committedItems.push({ kind: "spell", id: spellId });
    acted = true;
  } else if (player.hand.length > 0) {
    // Play the highest Ascension Power card available.
    let bestIdx = 0;
    let bestPower = -1;
    for (let i = 0; i < player.hand.length; i++) {
      const cid = player.hand[i];
      // Use canonical card store. (Some earlier builds referenced a non-existent gameCardsById map.)
      const c = dataStore.cardsById[cid];
      const pwr = c?.basePower ?? 0;
      if (pwr > bestPower) { bestPower = pwr; bestIdx = i; }
    }
    const cardId = player.hand[bestIdx];
    player.hand.splice(bestIdx, 1);
    state.decks.discardGame.push(cardId);
    const wasFirstCard = played.selected.length === 0 && played.extraCards.length === 0;
    played.selected.push(cardId);
    if (!played.firstCommittedCardId) {
      played.firstCommittedCardId = cardId;
    }
    if (!player.isAI && challenge.metrics) {
      challenge.metrics.teachingPowerPlayedSoFar += cardTeachingPower(cardId);
    }
    let isHidden = false;
    if (wasFirstCard) {
      isHidden = true;
    } else if (hasPassiveTeaching(player, "veil_of_uncertainty") && rng.next() < VEIL_OF_UNCERTAINTY_CHANCE) {
      isHidden = true;
    }
    if (isHidden) {
      played.hiddenCardIds = played.hiddenCardIds ?? [];
      if (!played.hiddenCardIds.includes(cardId)) {
        played.hiddenCardIds.push(cardId);
      }
      if (!played.faceDownId) {
        played.faceDownId = cardId;
      }
      if (hasPassiveTeaching(player, "false_signal")) {
        addChallengeLog(state, "A card was concealed.");
      }
    }
    played.committedItems = played.committedItems ?? [];
    played.committedItems.push({ kind: "card", id: cardId });
    const aiTpGain = teachingPotentialGainForCard(cardId);
    addChallengeTP(state, challenge, player, rng, aiTpGain);
    // Trigger card_committed event for artifacts/teachings that grant bonus TP
    triggerEffects("card_committed", {
      state,
      player,
      rng,
      event: "card_committed",
      challenge,
      played,
      cardId
    });
    const aiCard = dataStore.cardsById[cardId];
    const aiCardTP = challenge.challengeTPByPlayer?.[player.id] ?? 0;
    addChallengeLog(state, `${player.name} commits ${aiCard?.name ?? "a card"}${isHidden ? " (hidden)" : ""}.`);
    addChallengeLog(state, `+${Math.floor(aiTpGain * TP_GAIN_MULT)} Challenge TP (Total: ${Math.floor(aiCardTP)}).`);
    recordChallengeApContribution(state, challenge, player.id, cardValue(cardId), rng);
    acted = true;
  }

  if (acted) {
    challenge.passesInRow = 0;
  } else {
    challenge.passesInRow = (challenge.passesInRow ?? 0) + 1;
    addChallengeLog(state, `${player.name} passes.`);
  }
  challenge.beatCount = (challenge.beatCount ?? 0) + 1;
}

function commitHumanAutoTurn(state: GameState, rng: Rng, playerId: string): void {
  const challenge = state.challenge;
  if (!challenge) return;
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.isAI) return;
  const played = challenge.played[playerId];
  if (!played) return;

  // Hard cap: each player may commit at most 3 total items (cards + invocations) per challenge.
  const committedCount = played.selected.length + played.spellsPlayed.length;
  if (committedCount >= CHALLENGE_COMMIT_MAX) {
    challenge.passesInRow = (challenge.passesInRow ?? 0) + 1;
    addChallengeLog(state, `${player.name} passes.`);
    challenge.beatCount = (challenge.beatCount ?? 0) + 1;
    return;
  }

  let acted = false;

  // Auto-play: prefer playing a card over passing
  if (player.hand.length > 0) {
    // Play the highest Ascension Power card available.
    let bestIdx = 0;
    let bestPower = -1;
    for (let i = 0; i < player.hand.length; i++) {
      const cid = player.hand[i];
      const c = dataStore.cardsById[cid];
      const pwr = c?.basePower ?? 0;
      if (pwr > bestPower) { bestPower = pwr; bestIdx = i; }
    }
    const cardId = player.hand[bestIdx];
    player.hand.splice(bestIdx, 1);
    state.decks.discardGame.push(cardId);
    const wasFirstCard = played.selected.length === 0 && played.extraCards.length === 0;
    played.selected.push(cardId);
    if (!played.firstCommittedCardId) {
      played.firstCommittedCardId = cardId;
    }
    if (challenge.metrics) {
      challenge.metrics.teachingPowerPlayedSoFar += cardTeachingPower(cardId);
    }
    let isHidden = false;
    if (wasFirstCard) {
      isHidden = true;
    } else if (hasPassiveTeaching(player, "veil_of_uncertainty") && rng.next() < VEIL_OF_UNCERTAINTY_CHANCE) {
      isHidden = true;
    }
    if (isHidden) {
      played.hiddenCardIds = played.hiddenCardIds ?? [];
      if (!played.hiddenCardIds.includes(cardId)) {
        played.hiddenCardIds.push(cardId);
      }
      if (!played.faceDownId) {
        played.faceDownId = cardId;
      }
      if (hasPassiveTeaching(player, "false_signal")) {
        addChallengeLog(state, "A card was concealed.");
      }
    }
    played.committedItems = played.committedItems ?? [];
    played.committedItems.push({ kind: "card", id: cardId });
    const autoTpGain = teachingPotentialGainForCard(cardId);
    addChallengeTP(state, challenge, player, rng, autoTpGain);
    // Trigger card_committed event for artifacts/teachings that grant bonus TP
    triggerEffects("card_committed", {
      state,
      player,
      rng,
      event: "card_committed",
      challenge,
      played,
      cardId
    });
    const card = dataStore.cardsById[cardId];
    const autoTP = challenge.challengeTPByPlayer?.[player.id] ?? 0;
    addChallengeLog(state, `${player.name} commits ${card?.name ?? "a card"}${isHidden ? " (hidden)" : ""}.`);
    addChallengeLog(state, `+${Math.floor(autoTpGain * TP_GAIN_MULT)} Challenge TP (Total: ${Math.floor(autoTP)}).`);
    recordChallengeApContribution(state, challenge, player.id, cardValue(cardId), rng);
    acted = true;
  }

  if (acted) {
    challenge.passesInRow = 0;
  } else {
    challenge.passesInRow = (challenge.passesInRow ?? 0) + 1;
    addChallengeLog(state, `${player.name} passes.`);
  }
  challenge.beatCount = (challenge.beatCount ?? 0) + 1;
}

function formatRevealLine(state: GameState, challenge: ChallengeState, playerId: string): string {
  const player = state.players.find((p) => p.id === playerId);
  const played = challenge.played[playerId];
  if (!player || !played) {
    return "no cards";
  }
  const cardNames = played.selected.map((cardId) => {
    const card = dataStore.cardsById[cardId];
    if (!card) return cardId;
    return `${card.name} (${card.basePower})`;
  });
  const extra = played.extraCards.map((cardId) => {
    const card = dataStore.cardsById[cardId];
    return `Extra: ${card?.name ?? cardId}`;
  });
  const spells = played.spellsPlayed.map((spellId) => dataStore.spellsById[spellId]?.name ?? spellId);
  const parts: string[] = [];
  if (cardNames.length > 0) parts.push(cardNames.join(", "));
  if (extra.length > 0) parts.push(extra.join(", "));
  if (spells.length > 0) parts.push(`Invocation: ${spells.join(", ")}`);
  return parts.length > 0 ? parts.join(" + ") : "no cards";
}

function fastForwardChallenge(state: GameState, rng: Rng): void {
  const challenge = state.challenge;
  if (!challenge || state.phase !== "CHALLENGE") {
    return;
  }
  if (state.ui.challengeResult) {
    return;
  }
  if (challenge.phase !== "COMMIT_TURNS" && challenge.phase !== "REVEAL" && challenge.phase !== "RESOLVE" && challenge.phase !== "DRAFT") {
    return;
  }

  state.aiQueue = state.aiQueue.filter((action) => action.scope !== "CHALLENGE");
  if (state.aiActive?.scope === "CHALLENGE") {
    state.aiActive = undefined;
  }
  state.aiPendingReveal = false;
  challenge.aiPending = false;
  state.ui.pendingThirdEyeSelection = undefined;

  let order = challenge.turnOrder.length > 0 ? challenge.turnOrder : challenge.order;

  if (challenge.phase === "COMMIT_TURNS") {
    let safety = 0;
    while (challenge.phase === "COMMIT_TURNS" && safety < 200) {
      safety += 1;
      if (order.length === 0) break;
      const activeId = order[challenge.activeTurnIndex];
      const activePlayer = state.players.find((p) => p.id === activeId);
      if (!activePlayer) {
        break;
      }
      if (activePlayer.isAI) {
        commitAiTurn(state, rng, activePlayer.id);
      } else {
        commitHumanAutoTurn(state, rng, activePlayer.id);
      }
      challenge.aiPending = false;
      challenge.activeTurnIndex = (challenge.activeTurnIndex + 1) % Math.max(1, order.length);
      if ((challenge.passesInRow ?? 0) >= order.length) {
        triggerChallengeAutoEffects(state, rng);
        challenge.phase = "REVEAL";
        challenge.revealIndex = 0;
        challenge.phaseTimerMs = 0;
        state.ui.challengeFlashText = "REVEAL";
        state.ui.challengeFlashTimerMs = 0;
        addChallengeLog(state, "Reveal begins.");
        break;
      }
      order = challenge.turnOrder.length > 0 ? challenge.turnOrder : challenge.order;
    }
  }

  if (challenge.phase !== "REVEAL" && challenge.phase !== "RESOLVE") {
    return;
  }

  if (challenge.phase === "REVEAL") {
    const start = challenge.revealIndex ?? 0;
    for (let i = start; i < order.length; i += 1) {
      const playerId = order[i];
      const playerName = state.players.find((p) => p.id === playerId)?.name ?? playerId;
      addChallengeLog(state, `${playerName} reveals ${formatRevealLine(state, challenge, playerId)}.`);
    }
    challenge.revealIndex = order.length;
    challenge.phase = "RESOLVE";
    challenge.resolveIndex = 0;
    challenge.totals = calculateChallengeTotals(state, challenge, rng);
    challenge.resolvedTotals = challenge.resolvedTotals ?? {};
    challenge.phaseTimerMs = 0;
    addChallengeLog(state, "Resolve begins.");
  }

  if (challenge.phase === "RESOLVE") {
    if (!challenge.totals) {
      challenge.totals = calculateChallengeTotals(state, challenge, rng);
    }
    challenge.resolvedTotals = challenge.resolvedTotals ?? {};
    const start = challenge.resolveIndex ?? 0;
    for (let i = start; i < order.length; i += 1) {
      const playerId = order[i];
      if (challenge.resolvedTotals[playerId] !== undefined) {
        continue;
      }
      const total = challenge.totals[playerId] ?? 0;
      const playerName = state.players.find((p) => p.id === playerId)?.name ?? playerId;
      challenge.resolvedTotals[playerId] = total;
      addChallengeLog(state, `${playerName} total ${total}.`);
    }
    challenge.resolveIndex = order.length;
    if (!state.ui.challengeResult) {
      beginGuardianDraft(state, rng, challenge);
    }
  }

  if ((challenge.phase as string) === "DRAFT") {
    let safety = 0;
    while ((challenge.phase as string) === "DRAFT" && safety < 200) {
      safety += 1;
      const remaining = unlockedUnclaimedRewards(challenge);
      if (remaining.length === 0) {
        addChallengeLog(state, "Draft concludes.");
        resolveChallengeWithSfx(state, rng);
        break;
      }
      const pickerId = currentDraftPickerId(challenge);
      if (!pickerId || !challenge.draft) {
        addChallengeLog(state, "Draft concludes.");
        resolveChallengeWithSfx(state, rng);
        break;
      }
      const reward = remaining[0];
      reward.isClaimed = true;
      reward.claimedByPlayerId = pickerId;
      const pickerName = state.players.find((p) => p.id === pickerId)?.name ?? pickerId;
      addChallengeLog(state, `${pickerName} claims ${rewardDisplayLabel(reward)}.`);
      if (unlockedUnclaimedRewards(challenge).length === 0) {
        addChallengeLog(state, "Draft concludes.");
        resolveChallengeWithSfx(state, rng);
        break;
      }
      challenge.draft.currentPickIndex =
        (challenge.draft.currentPickIndex + 1) % Math.max(1, challenge.draft.pickOrderPlayerIds.length);
    }
  }
}

function tickChallengeFlow(state: GameState, rng: Rng, dt: number): void {
  const challenge = state.challenge;
  if (!challenge || state.phase !== "CHALLENGE") {
    return;
  }
  if (state.ui.challengeResult) {
    return;
  }
  if (state.ui.pendingThirdEyeSelection) {
    return;
  }

  if ((state.ui.challengeFlashTimerMs ?? 0) > 0) {
    state.ui.challengeFlashTimerMs = Math.max(0, (state.ui.challengeFlashTimerMs ?? 0) - dt);
    if ((state.ui.challengeFlashTimerMs ?? 0) <= 0) {
      state.ui.challengeFlashText = undefined;
    }
  }

  challenge.phaseTimerMs = Math.max(0, (challenge.phaseTimerMs ?? 0) - dt);

  if (challenge.phase === "ROLL_ORDER") {
    if (!challenge.rollQueue) {
      challenge.rollQueue = [...challenge.participants];
    }
    if (challenge.rollQueue.length === 0) {
      const tieGroups = findTieGroups(challenge.rolls);
      if (tieGroups.length > 0) {
        tieGroups.forEach((group) => {
          const names = group.ids
            .map((id) => state.players.find((p) => p.id === id)?.name ?? id)
            .join(" and ");
          addChallengeLog(state, `Tie on ${group.value} between ${names}. Rerolling...`);
          group.ids.forEach((id) => {
            challenge.rolls[id] = null;
          });
        });
        challenge.rollQueue = tieGroups.flatMap((group) => group.ids);
        challenge.phaseTimerMs = scaledChallengeDelay(state, 400);
        return;
      }
      const order = resolveInitiative(challenge.rolls);
      challenge.turnOrder = [...order];
      challenge.order = [...order];
      challenge.activeTurnIndex = 0;
      challenge.phase = "COMMIT_TURNS";
      const hasHumanContestant = challenge.contestants.some((id) => {
        const player = state.players.find((p) => p.id === id);
        return player ? !player.isAI : false;
      });
      challenge.initiativePaused = hasHumanContestant;
      challenge.phaseTimerMs = 0;
      challenge.aiPending = false;
      if (challenge.initiativePaused) {
        addChallengeLog(state, "Initiative locked. Press RESUME to begin commit turns.");
      } else {
        addChallengeLog(state, "Commit turns begin.");
      }
      return;
    }
    if ((challenge.phaseTimerMs ?? 0) > 0) {
      return;
    }
    const nextId = challenge.rollQueue.shift();
    if (!nextId) {
      return;
    }
    const player = state.players.find((p) => p.id === nextId);
    const bonus = player ? getDiceBonus(state, player, rng) : 0;
    const roll = rollD6(rng, bonus);
    if (player) {
      resetTempDiceBonus(player);
      addChallengeLog(state, `${player.name} rolls ${roll}.`);
    }
    challenge.rolls[nextId] = roll;
    challenge.phaseTimerMs = scaledChallengeDelay(state, 420);
    return;
  }

  if (challenge.phase === "COMMIT_TURNS") {
    if (challenge.initiativePaused) {
      return;
    }
    const order = challenge.turnOrder.length > 0 ? challenge.turnOrder : challenge.order;
    if (order.length === 0) {
      return;
    }
    const activeId = order[challenge.activeTurnIndex];
    const activePlayer = state.players.find((p) => p.id === activeId);
    if (!activePlayer) {
      challenge.activeTurnIndex = (challenge.activeTurnIndex + 1) % order.length;
      return;
    }
    // Human turn: UI will dispatch LOCK_CARDS (or PASS via LOCK_CARDS with no selection).
    if (!activePlayer.isAI) {
      return;
    }
    if (!challenge.aiPending) {
      challenge.aiPending = true;
      enqueueAiAction(state, {
        playerId: activePlayer.id,
        scope: "CHALLENGE",
        kind: "AI_COMMIT_CHALLENGE",
        label: `${activePlayer.name} is thinking...`,
        payload: {}
      });
    }
    return;
  }

  if (challenge.phase === "REVEAL") {
    if ((challenge.phaseTimerMs ?? 0) > 0) {
      return;
    }
    const order = challenge.turnOrder.length > 0 ? challenge.turnOrder : challenge.order;
    const idx = challenge.revealIndex ?? 0;
    if (idx < order.length) {
      const playerId = order[idx];
      const playerName = state.players.find((p) => p.id === playerId)?.name ?? playerId;
      addChallengeLog(state, `${playerName} reveals ${formatRevealLine(state, challenge, playerId)}.`);
      challenge.revealIndex = idx + 1;
      challenge.phaseTimerMs = scaledChallengeDelay(state, 700);
      return;
    }
    challenge.phase = "RESOLVE";
    challenge.resolveIndex = 0;
    challenge.totals = calculateChallengeTotals(state, challenge, rng);
    challenge.resolvedTotals = {};
    challenge.phaseTimerMs = scaledChallengeDelay(state, 600);
    addChallengeLog(state, "Resolve begins.");
    return;
  }

  if (challenge.phase === "RESOLVE") {
    if ((challenge.phaseTimerMs ?? 0) > 0) {
      return;
    }
    const order = challenge.turnOrder.length > 0 ? challenge.turnOrder : challenge.order;
    const idx = challenge.resolveIndex ?? 0;
    if (!challenge.totals) {
      challenge.totals = calculateChallengeTotals(state, challenge, rng);
    }
    if (idx < order.length) {
      const playerId = order[idx];
      const total = challenge.totals[playerId] ?? 0;
      const playerName = state.players.find((p) => p.id === playerId)?.name ?? playerId;
      challenge.resolvedTotals = challenge.resolvedTotals ?? {};
      challenge.resolvedTotals[playerId] = total;
      addChallengeLog(state, `${playerName} total ${total}.`);
      challenge.resolveIndex = idx + 1;
      challenge.phaseTimerMs = scaledChallengeDelay(state, 600);
      return;
    }
    beginGuardianDraft(state, rng, challenge);
    return;
  }

  if (challenge.phase === "DRAFT") {
    const remaining = unlockedUnclaimedRewards(challenge);
    if (remaining.length === 0) {
      addChallengeLog(state, "Draft concludes.");
      resolveChallengeWithSfx(state, rng);
      return;
    }
    const pickerId = currentDraftPickerId(challenge);
    const picker = pickerId ? state.players.find((p) => p.id === pickerId) : undefined;
    if (!picker || !challenge.draft) {
      addChallengeLog(state, "Draft concludes.");
      resolveChallengeWithSfx(state, rng);
      return;
    }
    if (picker.isAI) {
      const reward = remaining[0];
      reward.isClaimed = true;
      reward.claimedByPlayerId = picker.id;
      addChallengeLog(state, `${picker.name} claims ${rewardDisplayLabel(reward)}.`);
      if (unlockedUnclaimedRewards(challenge).length === 0) {
        addChallengeLog(state, "Draft concludes.");
        resolveChallengeWithSfx(state, rng);
        return;
      }
      challenge.draft.currentPickIndex =
        (challenge.draft.currentPickIndex + 1) % Math.max(1, challenge.draft.pickOrderPlayerIds.length);
    }
    return;
  }
}

function enableChallengeAutoPlay(state: GameState, enabled: boolean): void {
  state.ui.challengeAutoPlay = enabled;
  if (enabled) {
    addChallengeLog(state, "Auto-play enabled: playing random cards until challenge ends.");
    // Immediately trigger one auto-commit if it's human's turn
    const challenge = state.challenge;
    if (challenge && challenge.phase === "COMMIT_TURNS") {
      const human = state.players.find((p) => !p.isAI);
      const order = challenge.turnOrder.length > 0 ? challenge.turnOrder : challenge.order;
      const activeId = order[challenge.activeTurnIndex ?? 0];
      if (human && activeId === human.id) {
        // Queue an AI action for the human player
        state.aiQueue.push({
          playerId: human.id,
          label: "Auto-playing...",
          scope: "CHALLENGE",
          kind: "AI_COMMIT_CHALLENGE",
          remainingMs: scaledDelayMs(800, state.settings.gameSpeedMode)
        });
      }
    }
  }
}

function resumeAfterChallenge(state: GameState, rng: Rng, onTurnEnd: (state: GameState) => void): GameState {
  if (state.pendingChallenges.length > 0) {
    const pending = state.pendingChallenges.shift();
    if (pending) {
      state.challenge = setupChallenge(state, rng, pending);
      state.ui.selectedCards = [];
      state.ui.selectedFaceDown = undefined;
      state.ui.challengeLogScroll = 0;
      state.ui.challengeFlashText = "ROLL ORDER";
      state.ui.challengeFlashTimerMs = scaledChallengeDelay(state, 700);
      state.ui.handTab = "ALL";
      state.ui.handScroll = 0;
      addChallengeLog(state, "Initiative rolls begin.");
    }
    state.phase = "CHALLENGE";
  } else {
    onTurnEnd(state);
  }
  return state;
}
function triggerChallengeAutoEffects(state: GameState, rng: Rng): void {
  const challenge = state.challenge;
  if (!challenge) {
    return;
  }
  challenge.contestants.forEach((playerId) => {
    const player = state.players.find((p) => p.id === playerId);
    const played = challenge.played[playerId];
    if (!player || !played) {
      return;
    }
    const prevBonus = played.powerBonus;
    const prevExtra = played.extraCards.length;
    triggerEffects("challenge_after_commit", {
      state,
      player,
      rng,
      event: "challenge_after_commit",
      challenge,
      played,
      castSpell: (spellId, fromArtifact) => applySpellEffect(state, challenge, player, spellId, rng, fromArtifact),
      gainTeaching: (count = 1) => gainTeaching(state, player, rng, count)
    });
    const bonusDelta = Math.max(0, played.powerBonus - prevBonus);
    const addedExtras = played.extraCards.slice(prevExtra);
    const extraDelta = addedExtras.reduce((sum, cardId) => sum + cardValue(cardId), 0);
    if (!player.isAI && challenge.metrics) {
      challenge.metrics.teachingPowerPlayedSoFar += addedExtras.reduce(
        (sum, cardId) => sum + cardTeachingPower(cardId),
        0
      );
    }
    recordChallengeApContribution(state, challenge, playerId, bonusDelta + extraDelta);
  });
}


// --- Shop currency helpers ---
function canAffordCrystals(player: PlayerState, costCrystals: number): boolean {
  return player.crystals >= costCrystals;
}

function payCostCrystals(player: PlayerState, costCrystals: number): void {
  player.crystals = Math.max(0, player.crystals - costCrystals);
  player.runCrystalsSpent = (player.runCrystalsSpent ?? 0) + Math.max(0, costCrystals);
}
