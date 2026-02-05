import { dataStore } from "./state";
import { Rng } from "./rng";
import {
  ChallengeState,
  EffectEvent,
  EffectTrigger,
  GameState,
  PlayerState,
  RewardPool
} from "./types";
import { randomGameCardId } from "./helpers";
import { addChallengeTP, TP_GAIN_MULT, teachingPotentialGainForCard } from "./rules";

// Locked nerf: artifacts that grant free spells/cards in challenges now proc at ~30%.
const ARTIFACT_FREE_PROC_CHANCE = 0.3;

type SourceKind = "spell" | "artifact" | "teaching";

export type EffectContext = {
  state: GameState;
  player: PlayerState;
  rng: Rng;
  event: EffectEvent;
  challenge?: ChallengeState;
  rewardPool?: RewardPool;
  played?: ChallengeState["played"][string];
  cardPowers?: { id: string; base: number; color?: string; tags: string[] }[];
  allCardCount?: number;
  totalRef?: { value: number };
  modifiers?: Record<string, number>;
  outcome?: "WIN" | "LOSS" | "DRAW";
  keepCardIdRef?: { value?: string };
  castSpell?: (spellId: string, fromArtifact?: boolean) => boolean;
  drawGameCard?: () => string | undefined;
  gainTeaching?: (count?: number) => void;
  source?: { type: SourceKind; id: string };
  spellPowerMultiplier?: number;
  spellWasAmplified?: boolean;
  spellIsGenerated?: boolean;
  cardId?: string; // Card ID for card_committed events
};

type EffectHandler = (ctx: EffectContext) => boolean;


function challengeKey(state: GameState, challenge?: ChallengeState): string | undefined {
  if (!challenge) return undefined;
  return `${state.turn}-${challenge.id}`;
}

function isDebugEnabled(state: GameState): boolean {
  if (state.ui.debugEnabled) return true;
  if (typeof window !== "undefined" && (window as unknown as { DEBUG?: boolean }).DEBUG) {
    return true;
  }
  return false;
}

function snapshotResources(player: PlayerState): string {
  return `crystals ${player.crystals} hand ${player.hand.length} spells ${player.spells.length} artifacts ${player.artifacts.length} teachings ${player.teachings.length}`;
}

function logEffect(state: GameState, ctx: EffectContext, handlerId: string, applied: boolean, before: string, after: string): void {
  if (!isDebugEnabled(state)) return;
  const source = ctx.source ? `${ctx.source.type}:${ctx.source.id}` : "system";
  state.log.push(
    `[DEBUG] ${ctx.event} -> ${handlerId} (${source}) for ${ctx.player.name} applied=${applied} | ${before} -> ${after}`
  );
}

export function applyEffectHandler(handlerId: string, ctx: EffectContext): boolean {
  const handler = effectHandlers[handlerId];
  if (!handler) {
    if (isDebugEnabled(ctx.state)) {
      ctx.state.log.push(`[DEBUG] Missing effect handler: ${handlerId}`);
    }
    return false;
  }
  const before = snapshotResources(ctx.player);
  const applied = handler(ctx);
  const after = snapshotResources(ctx.player);
  logEffect(ctx.state, ctx, handlerId, applied, before, after);
  return applied;
}

function logChallenge(state: GameState, challenge: ChallengeState | undefined, text: string): void {
  if (challenge) {
    challenge.logEntries.push(text);
  }
  state.log.push(`Challenge: ${text}`);
}

type HiddenTarget = { playerId: string; cardId: string };

function isCardRevealedEarly(challenge: ChallengeState, playerId: string, cardId: string): boolean {
  return challenge.revealedEarly.some((entry) => entry.playerId === playerId && entry.cardId === cardId);
}

function getHiddenCommittedCards(state: GameState, challenge: ChallengeState, casterId: string): HiddenTarget[] {
  const hidden: HiddenTarget[] = [];
  challenge.contestants.forEach((playerId) => {
    if (playerId === casterId) return;
    const played = challenge.played[playerId];
    if (!played) return;
    if (played.revealAllFaceDown) return;
    const hiddenIds = (played.hiddenCardIds && played.hiddenCardIds.length > 0)
      ? played.hiddenCardIds
      : (played.faceDownId ? [played.faceDownId] : []);
    hiddenIds.forEach((cardId) => {
      if (played.revealedHiddenCardIds?.includes(cardId)) return;
      if (isCardRevealedEarly(challenge, playerId, cardId)) return;
      hidden.push({ playerId, cardId });
    });
  });
  return hidden;
}

function pickHighestRarityHidden(state: GameState, targets: HiddenTarget[]): HiddenTarget | undefined {
  if (targets.length === 0) return undefined;
  const score = (target: HiddenTarget): number => {
    const card = dataStore.cardsById[target.cardId];
    if (!card) return 0;
    const rarityScore = card.category === "cosmic" ? 2 : 1;
    return rarityScore * 100 + card.basePower;
  };
  return targets.reduce((best, target) => (score(target) > score(best) ? target : best), targets[0]);
}

function revealHiddenForPlayer(state: GameState, challenge: ChallengeState, target: HiddenTarget, label: string): void {
  if (!isCardRevealedEarly(challenge, target.playerId, target.cardId)) {
    challenge.revealedEarly.push({ playerId: target.playerId, cardId: target.cardId });
  }
  const played = challenge.played[target.playerId];
  if (played) {
    played.revealedHiddenCardIds = played.revealedHiddenCardIds ?? [];
    if (!played.revealedHiddenCardIds.includes(target.cardId)) {
      played.revealedHiddenCardIds.push(target.cardId);
    }
  }
  const targetName = state.players.find((p) => p.id === target.playerId)?.name ?? "an opponent";
  const cardName = dataStore.cardsById[target.cardId]?.name ?? "a hidden card";
  logChallenge(state, challenge, `${label} reveals ${targetName}'s hidden card: ${cardName}.`);
}

export function resolveThirdEyeSelection(
  state: GameState,
  challenge: ChallengeState,
  casterId: string,
  targetPlayerId: string,
  targetCardId: string
): void {
  if (!isCardRevealedEarly(challenge, targetPlayerId, targetCardId)) {
    challenge.revealedEarly.push({ playerId: targetPlayerId, cardId: targetCardId });
  }
  const played = challenge.played[targetPlayerId];
  if (played) {
    played.revealedHiddenCardIds = played.revealedHiddenCardIds ?? [];
    if (!played.revealedHiddenCardIds.includes(targetCardId)) {
      played.revealedHiddenCardIds.push(targetCardId);
    }
  }
  const casterName = state.players.find((p) => p.id === casterId)?.name ?? "Unknown";
  const targetName = state.players.find((p) => p.id === targetPlayerId)?.name ?? "an opponent";
  logChallenge(state, challenge, `${casterName} reveals ${targetName}'s hidden card using Third Eye Awakening (+7 AP).`);
}

function shouldTrigger(
  player: PlayerState,
  state: GameState,
  trigger: EffectTrigger,
  sourceId: string,
  challenge?: ChallengeState
): boolean {
  const flags = player.effectFlags ?? {};
  const key = `${sourceId}:${trigger.handler}:${trigger.event}`;
  const flag = flags[key];
  if (trigger.oncePerTurn && flag?.turn === state.turn) {
    return false;
  }
  const cKey = challengeKey(state, challenge);
  if (trigger.oncePerChallenge && cKey && flag?.challengeKey === cKey) {
    return false;
  }
  return true;
}

function markTriggered(
  player: PlayerState,
  state: GameState,
  trigger: EffectTrigger,
  sourceId: string,
  challenge?: ChallengeState
): void {
  if (!player.effectFlags) {
    player.effectFlags = {};
  }
  const key = `${sourceId}:${trigger.handler}:${trigger.event}`;
  const cKey = challengeKey(state, challenge);
  player.effectFlags[key] = {
    turn: state.turn,
    challengeKey: cKey
  };
}

export function triggerEffects(event: EffectEvent, ctx: EffectContext): void {
  const player = ctx.player;
  const artifacts = player.artifacts.map((id) => ({ type: "artifact" as const, id, triggers: dataStore.artifactsById[id]?.triggers ?? [] }));
  const passiveTeachings = player.passiveTeachings.map((id) => ({ type: "teaching" as const, id, triggers: dataStore.teachingsById[id]?.triggers ?? [] }));
  const items = [...artifacts, ...passiveTeachings];

  items.forEach((item) => {
    item.triggers.forEach((trigger) => {
      if (trigger.event !== event) return;
      if (!shouldTrigger(player, ctx.state, trigger, item.id, ctx.challenge)) return;
      const applied = applyEffectHandler(trigger.handler, {
        ...ctx,
        source: { type: item.type, id: item.id }
      });
      if (applied) {
        // Record artifact outcomes for the challenge results UI.
        if (item.type === "artifact" && ctx.played) {
          const artifactName = dataStore.artifactsById[item.id]?.name ?? item.id;
          const handlerName = trigger.handler.replace(/_/g, " ");
          ctx.played.artifactEffects = ctx.played.artifactEffects ?? [];
          ctx.played.artifactEffects.push(`${artifactName}: ${handlerName}`);
        }
        markTriggered(player, ctx.state, trigger, item.id, ctx.challenge);
      }
    });
  });
}

function committedTypeCount(played?: ChallengeState["played"][string]): number {
  if (!played) return 0;
  const types = new Set<string>();
  played.selected.forEach((cardId) => {
    const tags = dataStore.cardsById[cardId]?.tags ?? [];
    tags.forEach((tag) => types.add(tag));
  });
  return types.size;
}

export const effectHandlers: Record<string, EffectHandler> = {
  empower_the_meek: (ctx) => {
    if (ctx.event === "spell_cast") {
      const played = ctx.played;
      if (!played) return false;
      if (played.empowerMeek) {
        ctx.state.log.push(`${ctx.player.name}'s Empower the Meek is already active.`);
        return false;
      }
      played.empowerMeek = true;
      played.empowerMeekMultiplier = ctx.spellPowerMultiplier ?? 1;
      return true;
    }
    if (ctx.event === "challenge_totals") {
      const played = ctx.played;
      const cardPowers = ctx.cardPowers;
      if (!played || !cardPowers || !played.empowerMeek) return false;
      const multiplier = played.empowerMeekMultiplier ?? 1;
      let bonusTotal = 0;
      cardPowers.forEach((card) => {
        if (card.color === "Grey" || card.color === "Blue") {
          const base = card.base;
          const bonus = base * multiplier;
          card.base = base + bonus;
          bonusTotal += bonus;
        }
      });
      if (bonusTotal > 0) {
        played.powerBonusBreakdown = played.powerBonusBreakdown ?? [];
        played.powerBonusBreakdown.push({
          label: "Empower the Meek",
          amount: bonusTotal,
          source: "invocation"
        });
      }
      return bonusTotal > 0;
    }
    return false;
  },
  channel_group_energy: (ctx) => {
    if (ctx.event === "spell_cast") {
      if (!ctx.played) return false;
      ctx.played.channelGroupEnergy = true;
      ctx.played.channelGroupEnergyMultiplier = ctx.spellPowerMultiplier ?? 1;
      return true;
    }
    if (ctx.event === "challenge_totals") {
      if (!ctx.played?.channelGroupEnergy || !ctx.totalRef) return false;
      const faceDownCount = ctx.played.faceDownId ? 1 : 0;
      const beatCount = (ctx.played.beat1Cards?.length ?? 0) + (ctx.played.beat2Cards?.length ?? 0);
      const extraCount = ctx.played.extraCards?.length ?? 0;
      const count = faceDownCount + beatCount + extraCount;
      const multiplier = ctx.played.channelGroupEnergyMultiplier ?? 1;
      const bonus = count * 5 * multiplier;
      if (bonus > 0) {
        ctx.totalRef.value += bonus;
        ctx.played.powerBonusBreakdown = ctx.played.powerBonusBreakdown ?? [];
        ctx.played.powerBonusBreakdown.push({
          label: "Channel Group Energy",
          amount: bonus,
          source: "invocation"
        });
        logChallenge(ctx.state, ctx.challenge, `${ctx.player.name} channels group energy (+${bonus} AP from ${count} game cards).`);
      }
      return bonus > 0;
    }
    return false;
  },
  tribal_spirits: (ctx) => {
    if (ctx.event !== "spell_cast" || !ctx.played) return false;
    const multiplier = ctx.spellPowerMultiplier ?? 1;
    const eligible = dataStore.cards.filter((card) => card.category !== "cosmic");
    const pickCard = (): string | undefined => {
      if (eligible.length === 0) return undefined;
      return eligible[ctx.rng.nextInt(0, eligible.length - 1)].id;
    };
    const draws = Math.max(1, 2 * multiplier);
    const drawn: string[] = [];
    for (let i = 0; i < draws; i += 1) {
      const extra = pickCard();
      if (!extra) continue;
      ctx.played.extraCards.push(extra);
      ctx.played.extraCardSources = ctx.played.extraCardSources ?? {};
      ctx.played.extraCardSources[extra] = "Invocation: Tribal Spirits";
      drawn.push(dataStore.cardsById[extra]?.name ?? extra);
    }
    if (drawn.length > 0) {
      ctx.state.log.push(`${ctx.player.name} summons ${drawn.join(" and ")} with Tribal Spirits.`);
    }
    return drawn.length > 0;
  },
  third_eye_awakening: (ctx) => {
    if (ctx.event !== "spell_cast" || !ctx.played || !ctx.challenge) return false;
    ctx.played.thirdEye = true;
    const multiplier = ctx.spellPowerMultiplier ?? 1;
    const bonus = 7 * multiplier;
    ctx.played.powerBonus += bonus;
    ctx.played.powerBonusBreakdown = ctx.played.powerBonusBreakdown ?? [];
    ctx.played.powerBonusBreakdown.push({
      label: "Third Eye Awakening",
      amount: bonus,
      source: "invocation"
    });
    const hiddenTargets = getHiddenCommittedCards(ctx.state, ctx.challenge, ctx.player.id);
    if (hiddenTargets.length === 0) {
      logChallenge(ctx.state, ctx.challenge, `${ctx.player.name} plays Third Eye Awakening (+${bonus} AP). No hidden cards available.`);
      return true;
    }
    if (ctx.player.isAI) {
      const target = pickHighestRarityHidden(ctx.state, hiddenTargets);
      if (target) {
        resolveThirdEyeSelection(ctx.state, ctx.challenge, ctx.player.id, target.playerId, target.cardId);
      }
      return true;
    }
    ctx.state.ui.pendingThirdEyeSelection = {
      casterId: ctx.player.id,
      targets: hiddenTargets
    };
    return true;
  },
  resonant_amplifier: (ctx) => {
    if (ctx.event !== "spell_cast" || !ctx.played) return false;
    ctx.played.resonantAmplifierActive = true;
    return true;
  },
  confluence_of_voices: (ctx) => {
    if (ctx.event === "spell_cast") {
      if (!ctx.played) return false;
      ctx.played.confluenceVoices = true;
      ctx.played.confluenceVoicesMultiplier = ctx.spellPowerMultiplier ?? 1;
      return true;
    }
    if (ctx.event === "challenge_totals") {
      if (!ctx.played?.confluenceVoices || !ctx.totalRef) return false;
      const count = ctx.played.invocationsCastCount ?? 0;
      const multiplier = ctx.played.confluenceVoicesMultiplier ?? 1;
      const bonus = count * 5 * multiplier;
      if (bonus > 0) {
        ctx.totalRef.value += bonus;
        ctx.played.powerBonusBreakdown = ctx.played.powerBonusBreakdown ?? [];
        ctx.played.powerBonusBreakdown.push({
          label: `Confluence of Voices: ${count} Invocations cast`,
          amount: bonus,
          source: "invocation"
        });
      }
      return bonus > 0;
    }
    return false;
  },
  basic_teaching_boost: (ctx) => {
    if (ctx.event !== "teaching_played") return false;
    const teaching = ctx.source?.id ? dataStore.teachingsById[ctx.source.id] : undefined;
    if (!teaching) return false;

    // Immediate reward based on which basic teaching
    let immediateReward = "";
    let permBonus = 0;
    let oneTimeBonus = 0;
    switch (teaching.id) {
      case "open_attention":
        ctx.player.crystals += 1;
        immediateReward = "+1 Crystal";
        permBonus = 2; oneTimeBonus = 30;
        break;
      case "prepared_mind":
        ctx.player.bonusAp = (ctx.player.bonusAp ?? 0) + 3;
        immediateReward = "+3 AP";
        permBonus = 3; oneTimeBonus = 60;
        break;
      case "heightened_curiosity":
        if (ctx.challenge) {
          addChallengeTP(ctx.state, ctx.challenge, ctx.player, ctx.rng, 2);
          immediateReward = `+${Math.floor(2 * TP_GAIN_MULT)} Challenge TP`;
        } else {
          immediateReward = "(no active challenge)";
        }
        permBonus = 5; oneTimeBonus = 100;
        break;
      case "quiet_knowing":
        ctx.player.crystals += 2;
        immediateReward = "+2 Crystals";
        permBonus = 3; oneTimeBonus = 45;
        break;
      case "disciplined_study":
        if (ctx.challenge) {
          addChallengeTP(ctx.state, ctx.challenge, ctx.player, ctx.rng, 3);
          immediateReward = `+${Math.floor(3 * TP_GAIN_MULT)} Challenge TP`;
        } else {
          immediateReward = "(no active challenge)";
        }
        permBonus = 2; oneTimeBonus = 35;
        break;
    }

    ctx.state.log.push(
      `${ctx.player.name} internalizes ${teaching.name}: ${immediateReward}. Permanent +${permBonus}% invocation chance. Next meditation: +${oneTimeBonus}% one-time bonus.`
    );
    return true;
  },
  centered_resolve: (ctx) => {
    if (ctx.event !== "meditate") return false;
    const value = ctx.source?.id ? dataStore.teachingsById[ctx.source.id]?.value ?? 1 : 1;
    if ((ctx.player.pendingChallengeDiceBonus ?? 0) >= value) {
      return false;
    }
    ctx.player.pendingChallengeDiceBonus = value;
    ctx.state.log.push(`${ctx.player.name} centers resolve (+${value} to all dice rolls in the next Challenge).`);
    return true;
  },
  affinity_bonus: (ctx) => {
    if (ctx.event !== "teaching_gained") return false;
    const value = ctx.source?.id ? dataStore.teachingsById[ctx.source.id]?.value ?? 0 : 0;
    const name = ctx.source?.id ? dataStore.teachingsById[ctx.source.id]?.name ?? "an affinity" : "an affinity";
    ctx.player.bonusAp = (ctx.player.bonusAp ?? 0) + value;
    ctx.state.log.push(`${ctx.player.name} attunes to ${name} (+${value} AP).`);
    return value > 0;
  },
  earned_acknowledgement: (ctx) => {
    if (ctx.event !== "earth_advancement_purchase") return false;
    const value = ctx.source?.id ? dataStore.teachingsById[ctx.source.id]?.value ?? 0 : 0;
    ctx.player.crystals += value;
    ctx.state.log.push(`${ctx.player.name} gains ${value} Crystals from Earned Acknowledgement.`);
    return value > 0;
  },
  favourable_exchange: (ctx) => {
    if (ctx.event !== "sell_item") return false;
    const value = ctx.source?.id ? dataStore.teachingsById[ctx.source.id]?.value ?? 0 : 0;
    ctx.player.crystals += value;
    ctx.state.log.push(`${ctx.player.name} gains ${value} Crystal${value === 1 ? "" : "s"} from Favourable Exchange.`);
    return value > 0;
  },
  pilgrims_insight: (ctx) => {
    if (ctx.event !== "reward_pool_applied" || !ctx.rewardPool) return false;
    if (ctx.rewardPool.id !== "MOUNTAIN" && ctx.rewardPool.id !== "CAVE") return false;
    const lastId = ctx.player.lastJourneyId;
    const lastTurn = ctx.player.lastJourneyTurn;
    const currentId = ctx.rewardPool.id;
    let granted = false;
    if (currentId === "CAVE" && lastId === "MOUNTAIN" && lastTurn === ctx.state.turn - 1) {
      ctx.gainTeaching?.(1);
      ctx.state.log.push(`${ctx.player.name} gains a bonus Teaching from Pilgrim's Insight.`);
      granted = true;
    }
    ctx.player.lastJourneyId = currentId;
    ctx.player.lastJourneyTurn = ctx.state.turn;
    return granted;
  },
  triune_expression: (ctx) => {
    if (ctx.event !== "challenge_after_commit" || !ctx.played) return false;
    if (committedTypeCount(ctx.played) < 3) return false;
    const value = ctx.source?.id ? dataStore.teachingsById[ctx.source.id]?.value ?? 0 : 0;
    ctx.played.powerBonus += value;
    ctx.state.log.push(`${ctx.player.name} gains +${value} power from Triune Expression.`);
    return value > 0;
  },
  emergent_convergence: (ctx) => {
    if (ctx.event !== "challenge_after_commit" || !ctx.played) return false;
    if (ctx.played.emergentConvergenceUsed) return false;
    if (committedTypeCount(ctx.played) < 3) return false;
    const extra = randomGameCardId(ctx.rng);
    if (!extra) return false;
    ctx.played.extraCards.push(extra);
    ctx.played.extraCardSources = ctx.played.extraCardSources ?? {};
    ctx.played.extraCardSources[extra] = "Teaching: Emergent Convergence";
    ctx.played.emergentConvergenceUsed = true;
    ctx.state.log.push(`${ctx.player.name} manifests ${dataStore.cardsById[extra]?.name ?? extra} with Emergent Convergence.`);
    return true;
  },
  total_commitment: (ctx) => {
    if (ctx.event !== "challenge_after_commit" || !ctx.played) return false;
    if (ctx.played.totalCommitmentGranted) return false;
    const fullCards = ctx.played.selected.length === 3;
    const fullInvocations = (ctx.played.beat1Spells.length > 0 && ctx.played.beat2Spells.length > 0);
    if (!fullCards || !fullInvocations) return false;
    ctx.gainTeaching?.(1);
    ctx.played.totalCommitmentGranted = true;
    ctx.state.log.push(`${ctx.player.name} gains a Teaching from Total Commitment.`);
    return true;
  },
  worldseed_awakening: (ctx) => {
    if (ctx.event === "challenge_after_commit") {
      if (!ctx.played || !ctx.challenge) return false;
      if (ctx.player.worldseedStatus && ctx.player.worldseedStatus !== "dormant") return false;
      if (ctx.played.selected.length !== 3) return false;
      const allCosmic = ctx.played.selected.every((cardId) =>
        dataStore.cardsById[cardId]?.tags.includes("Cosmic")
      );
      if (!allCosmic) return false;
      ctx.played.worldseedRitualTriggered = true;
      ctx.played.removedFromGameCards = [...ctx.played.selected];
      ctx.played.selected.forEach((cardId) => {
        const idx = ctx.player.hand.indexOf(cardId);
        if (idx >= 0) {
          ctx.player.hand.splice(idx, 1);
        }
      });
      ctx.player.worldseedStatus = "pending";
      ctx.player.worldseedActivationTurn = ctx.state.turn + 1;
      ctx.state.log.push(`${ctx.player.name} performs the Worldseed ritual and withdraws from the rite.`);
      return true;
    }
    if (ctx.event === "meditate") {
      if (ctx.player.worldseedStatus !== "active") return false;
      if (ctx.player.worldseedMeditationTurn === ctx.state.turn) return false;
      const value = ctx.source?.id ? dataStore.teachingsById[ctx.source.id]?.value ?? 50 : 50;
      ctx.player.bonusAp = (ctx.player.bonusAp ?? 0) + value;
      ctx.player.worldseedMeditationTurn = ctx.state.turn;
      ctx.state.log.push(`${ctx.player.name} draws Worldseed power (+${value} AP).`);
      return true;
    }
    return false;
  },
  mystic_orb: (ctx) => {
    if (ctx.event !== "challenge_after_commit" || !ctx.castSpell) return false;
    if (ctx.rng.next() > ARTIFACT_FREE_PROC_CHANCE) return false;
    const applied = ctx.castSpell("third_eye_awakening", true);
    if (applied) {
      ctx.state.log.push(`${ctx.player.name} invokes Mystic Orb.`);
    }
    return applied;
  },
  spell_staff: (ctx) => {
    if (ctx.event !== "challenge_after_commit" || !ctx.castSpell) return false;
    if (ctx.rng.next() > ARTIFACT_FREE_PROC_CHANCE) return false;
    const spellIds = dataStore.spells.map((spell) => spell.id);
    if (spellIds.length === 0) return false;
    const randomSpell = spellIds[ctx.rng.nextInt(0, spellIds.length - 1)];
    const applied = ctx.castSpell(randomSpell, true);
    if (applied) {
      ctx.state.log.push(`${ctx.player.name}'s Invocation Staff releases ${dataStore.spellsById[randomSpell].name}.`);
    } else {
      ctx.state.log.push(`${ctx.player.name}'s Invocation Staff fizzles.`);
    }
    return applied;
  },
  giant_crystal: (ctx) => {
    if (ctx.event === "challenge_totals" && ctx.totalRef) {
      ctx.totalRef.value += 5;
      return true;
    }
    if (ctx.event === "dice_bonus" && ctx.modifiers) {
      ctx.modifiers.bonus = (ctx.modifiers.bonus ?? 0) + 1;
      return true;
    }
    return false;
  },
  lucky_beads: (ctx) => {
    if (ctx.event === "meditate" && ctx.modifiers) {
      ctx.modifiers.extraCards = (ctx.modifiers.extraCards ?? 0) + 1;
      return true;
    }
    if (ctx.event === "dice_bonus" && ctx.modifiers) {
      ctx.modifiers.bonus = (ctx.modifiers.bonus ?? 0) + 1;
      return true;
    }
    return false;
  },
  stone_of_balance: (ctx) => {
    if (ctx.event !== "challenge_totals" || !ctx.totalRef || !ctx.played) return false;
    // If player committed 2+ card types, gain +5 AP (rewards balanced play)
    const types = new Set<string>();
    ctx.played.selected.forEach((cardId) => {
      const tags = dataStore.cardsById[cardId]?.tags ?? [];
      tags.forEach((tag) => types.add(tag));
    });
    if (types.size < 2) return false;
    ctx.totalRef.value += 5;
    ctx.played.powerBonusBreakdown = ctx.played.powerBonusBreakdown ?? [];
    ctx.played.powerBonusBreakdown.push({
      label: "Stone of Balance",
      amount: 5,
      source: "artifact"
    });
    ctx.state.log.push(`${ctx.player.name} gains +5 AP from Stone of Balance (${types.size} card types).`);
    return true;
  },
  reincarnation_crystal: (ctx) => {
    if (ctx.event !== "challenge_after_commit" || !ctx.played) return false;
    // Check if Worldseed ritual removed cards
    if (!ctx.played.worldseedRitualTriggered) return false;
    const extra = randomGameCardId(ctx.rng);
    if (!extra) return false;
    ctx.player.hand.push(extra);
    ctx.state.log.push(`${ctx.player.name}'s Reincarnation Crystal grants ${dataStore.cardsById[extra]?.name ?? extra} as a replacement.`);
    return true;
  },
  sacred_plant_seed: (ctx) => {
    if (ctx.event !== "challenge_totals" || !ctx.totalRef || !ctx.cardPowers) return false;
    const plantCount = ctx.cardPowers.filter((card) => card.tags.includes("Plant")).length;
    if (plantCount > 0) {
      ctx.totalRef.value += plantCount * 5;
      return true;
    }
    return false;
  },
  magnetic_crystal: (ctx) => {
    if (ctx.event === "reward_pool_applied" && ctx.rewardPool?.id === "MOUNTAIN") {
      ctx.player.crystals += 2;
      ctx.state.log.push(`${ctx.player.name} gains 2 bonus Crystals from Magnetic Crystal.`);
      return true;
    }
    return false;
  },
  spirit_totem: (ctx) => {
    if (ctx.event !== "challenge_setup" || !ctx.played) return false;
    // Spirit Totem has a 50% proc chance (higher than standard artifact 30%).
    if (ctx.rng.next() > 0.5) {
      return false;
    }
    const extra = randomGameCardId(ctx.rng);
    if (!extra) return false;
    ctx.played.extraCards.push(extra);
    ctx.played.extraCardSources = ctx.played.extraCardSources ?? {};
    ctx.played.extraCardSources[extra] = "Artifact: Spirit Totem";
    ctx.state.log.push(`${ctx.player.name} summons ${dataStore.cardsById[extra]?.name ?? extra} with Spirit Totem.`);
    return true;
  },
  extra_terrestrial_artifact: (ctx) => {
    if (ctx.event !== "gain_teaching" || !ctx.modifiers) return false;
    ctx.modifiers.extraBasicTeachings = (ctx.modifiers.extraBasicTeachings ?? 0) + 1;
    return true;
  },
  ledger_of_the_unseen: (ctx) => {
    if (ctx.event !== "challenge_totals" || !ctx.played || !ctx.totalRef) return false;
    const hiddenIds = ctx.played.hiddenCardIds ?? [];
    const revealed = ctx.played.revealedHiddenCardIds ?? [];
    const remaining = hiddenIds.filter((id, idx) => hiddenIds.indexOf(id) === idx && !revealed.includes(id));
    const count = remaining.length;
    const bonus = count * 10;
    if (bonus > 0) {
      ctx.totalRef.value += bonus;
      ctx.played.powerBonusBreakdown = ctx.played.powerBonusBreakdown ?? [];
      ctx.played.powerBonusBreakdown.push({
        label: `Ledger of the Unseen: ${count} cards remained hidden`,
        amount: bonus,
        source: "teaching"
      });
    }
    return bonus > 0;
  },
  // Passive teachings — logic handled directly in reducer.ts / rules.ts; stubs satisfy the handler registry.
  veil_of_uncertainty: () => false, // Handled: reducer.ts VEIL_OF_UNCERTAINTY_CHANCE check during card commits
  false_signal: () => false,        // Handled: reducer.ts hides committed card names from opponent
  ritual_continuance: () => false,  // Handled: rules.ts grants invocation on challenge resolve
  transmutation_of_focus: () => false, // Handled: rules.ts grants invocation on challenge resolve
  doctrine_of_abundance: () => false,  // Handled: reducer.ts doubles shop purchase limits
  crystal_seeker_goggles: (ctx) => {
    if (ctx.event === "challenge_resolve") {
      if (ctx.challenge?.id !== "CAVE") return false;
      ctx.player.crystals += 1;
      ctx.state.log.push(`${ctx.player.name} gains 1 Crystal from Crystal Seeker Goggles.`);
      return true;
    }
    if (ctx.event === "reward_pool_applied") {
      if (ctx.rewardPool?.id !== "CAVE") return false;
      if (ctx.state.challenge?.id === "CAVE") return false;
      ctx.player.crystals += 1;
      ctx.state.log.push(`${ctx.player.name} gains 1 Crystal from Crystal Seeker Goggles.`);
      return true;
    }
    return false;
  },
  mysterious_totem: (ctx) => {
    if (ctx.event !== "challenge_totals" || !ctx.cardPowers || ctx.cardPowers.length === 0) return false;
    // Set the lowest-power committed card to 15 AP (18 if Animal)
    const target = ctx.cardPowers.reduce((lowest, card) => (card.base < lowest.base ? card : lowest));
    const isAnimal = target.tags.includes("Animal");
    const threshold = isAnimal ? 18 : 15;
    if (target.base < threshold) {
      target.base = threshold;
      return true;
    }
    return false;
  },
  cosmic_robes: (ctx) => {
    if (ctx.event !== "challenge_after_commit" || !ctx.played || !ctx.castSpell) return false;
    if (ctx.rng.next() > ARTIFACT_FREE_PROC_CHANCE) return false;
    const hasHuman = ctx.played.selected.concat(ctx.played.extraCards).some((cardId) => dataStore.cardsById[cardId]?.tags.includes("Human"));
    if (!hasHuman) return false;
    const applied = ctx.castSpell("empower_the_meek", true);
    if (applied) {
      ctx.state.log.push(`${ctx.player.name}'s Cosmic Robes invoke Empower the Meek.`);
    }
    return applied;
  },
  lantern_of_the_unseen: (ctx) => {
    if (ctx.event !== "challenge_after_commit" || !ctx.challenge) return false;
    const hiddenTargets = getHiddenCommittedCards(ctx.state, ctx.challenge, ctx.player.id);
    if (hiddenTargets.length === 0) {
      addChallengeTP(ctx.state, ctx.challenge, ctx.player, ctx.rng, 1);
      ctx.state.log.push(`${ctx.player.name} gains +${Math.floor(1 * TP_GAIN_MULT)} Challenge TP from Lantern of the Unseen (no hidden cards).`);
      return true;
    }
    const pick = hiddenTargets[ctx.rng.nextInt(0, hiddenTargets.length - 1)];
    revealHiddenForPlayer(ctx.state, ctx.challenge, pick, "Lantern of the Unseen");
    return true;
  },
  echoes_in_the_stone: () => false,
  breath_of_the_summit: () => false,
  crown_of_endurance: (ctx) => {
    if (ctx.event !== "challenge_totals" || !ctx.played || !ctx.cardPowers) return false;
    const firstCardId = ctx.played.firstCommittedCardId;
    if (!firstCardId) return false;
    const target = ctx.cardPowers.find((card) => card.id === firstCardId);
    if (!target) return false;
    const card = dataStore.cardsById[firstCardId];
    const isCommonOrUncommon = card?.color === "Grey" || card?.color === "Blue";
    let bonus = isCommonOrUncommon ? 5 : 3;
    // Extra bonus if the card is face-down
    const isHidden = ctx.played.hiddenCardIds?.includes(firstCardId) ?? false;
    if (isHidden) bonus += 2;
    target.base += bonus;
    ctx.played.powerBonusBreakdown = ctx.played.powerBonusBreakdown ?? [];
    ctx.played.powerBonusBreakdown.push({
      label: `Crown of Endurance: ${card?.name ?? "first card"}${isHidden ? " (hidden)" : ""}`,
      amount: bonus,
      source: "teaching"
    });
    return bonus > 0;
  },
  // --- New teaching handlers ---
  cosmic_affinity: (ctx) => {
    if (ctx.event !== "challenge_after_commit" || !ctx.played) return false;
    const allCards = [...ctx.played.selected, ...ctx.played.extraCards];
    const hasCosmic = allCards.some((cardId) => dataStore.cardsById[cardId]?.tags.includes("Cosmic"));
    if (!hasCosmic) return false;
    ctx.played.powerBonus += 3;
    ctx.player.crystals += 1;
    ctx.played.powerBonusBreakdown = ctx.played.powerBonusBreakdown ?? [];
    ctx.played.powerBonusBreakdown.push({
      label: "Cosmic Affinity",
      amount: 3,
      source: "teaching"
    });
    ctx.state.log.push(`${ctx.player.name} gains +3 AP and +1 Crystal from Cosmic Affinity.`);
    return true;
  },
  rooted_patience: (ctx) => {
    if (ctx.event !== "meditate") return false;
    if (ctx.player.rootedPatienceUsed) return false;
    const lastMed = ctx.player.lastMeditateTurn;
    // lastMeditateTurn is set AFTER effects trigger, so it holds the previous meditation's turn
    if (lastMed === undefined || lastMed !== ctx.state.turn - 1) return false;
    ctx.player.rootedPatienceUsed = true;
    ctx.gainTeaching?.(1);
    ctx.state.log.push(`${ctx.player.name} gains a Teaching from Rooted Patience (consecutive meditations).`);
    return true;
  },
  symbiotic_harmony: (ctx) => {
    if (ctx.event !== "challenge_totals" || !ctx.cardPowers || !ctx.played) return false;
    const plants = ctx.cardPowers.filter((c) => c.tags.includes("Plant"));
    const animals = ctx.cardPowers.filter((c) => c.tags.includes("Animal"));
    if (plants.length !== 1 || animals.length !== 1) return false;
    plants[0].base += 4;
    animals[0].base += 4;
    ctx.played.powerBonusBreakdown = ctx.played.powerBonusBreakdown ?? [];
    ctx.played.powerBonusBreakdown.push({
      label: "Symbiotic Harmony: Plant + Animal",
      amount: 8,
      source: "teaching"
    });
    ctx.state.log.push(`${ctx.player.name} gains +8 AP from Symbiotic Harmony (1 Plant + 1 Animal).`);
    return true;
  },
  convergence_of_paths: (ctx) => {
    if (ctx.event !== "earth_advancement_purchase") return false;
    // The cost discount is handled inline in the reducer. This handler just logs.
    ctx.state.log.push(`${ctx.player.name}'s Convergence of Paths reduces the cost.`);
    return true;
  },
  awakened_instinct: (ctx) => {
    if (ctx.event !== "challenge_totals" || !ctx.played || !ctx.cardPowers || !ctx.totalRef) return false;
    // Grant +5 AP for each card that stayed hidden
    const hiddenIds = ctx.played.hiddenCardIds ?? [];
    const revealed = ctx.played.revealedHiddenCardIds ?? [];
    const stillHidden = hiddenIds.filter((id) => !revealed.includes(id));
    const bonus = stillHidden.length * 5;
    if (bonus > 0) {
      ctx.totalRef.value += bonus;
      ctx.played.powerBonusBreakdown = ctx.played.powerBonusBreakdown ?? [];
      ctx.played.powerBonusBreakdown.push({
        label: `Awakened Instinct: ${stillHidden.length} hidden card${stillHidden.length === 1 ? "" : "s"}`,
        amount: bonus,
        source: "teaching"
      });
      ctx.state.log.push(`${ctx.player.name} gains +${bonus} AP from Awakened Instinct (${stillHidden.length} hidden cards).`);
    }
    return bonus > 0;
  },
  // Affinity sub-handlers (triggered from JSON, distinct from the base affinity_bonus on teaching_gained)
  human_affinity: (ctx) => {
    if (ctx.event !== "challenge_totals" || !ctx.cardPowers || !ctx.played) return false;
    let bonus = 0;
    ctx.cardPowers.forEach((c) => {
      if (c.tags.includes("Human")) {
        c.base += 1;
        bonus += 1;
      }
    });
    if (bonus > 0) {
      ctx.played.powerBonusBreakdown = ctx.played.powerBonusBreakdown ?? [];
      ctx.played.powerBonusBreakdown.push({
        label: "Human Affinity",
        amount: bonus,
        source: "teaching"
      });
    }
    return bonus > 0;
  },
  plant_affinity: (ctx) => {
    if (ctx.event !== "meditate") return false;
    const plantCount = ctx.player.hand.filter((cardId) => dataStore.cardsById[cardId]?.tags.includes("Plant")).length;
    if (plantCount < 2) return false;
    ctx.player.crystals += 1;
    ctx.state.log.push(`${ctx.player.name} gains +1 Crystal from Plant Affinity (${plantCount} Plant cards in hand).`);
    return true;
  },
  animal_affinity: (ctx) => {
    if (ctx.event !== "dice_bonus" || !ctx.modifiers) return false;
    // Check if player has committed an Animal card in the current challenge
    const challenge = ctx.challenge;
    if (!challenge) return false;
    const played = challenge.played[ctx.player.id];
    if (!played) return false;
    const allCards = [...played.selected, ...played.extraCards];
    const hasAnimal = allCards.some((cardId) => dataStore.cardsById[cardId]?.tags.includes("Animal"));
    if (!hasAnimal) return false;
    ctx.modifiers.bonus = (ctx.modifiers.bonus ?? 0) + 1;
    return true;
  },
  // --- New artifact handlers ---
  verdant_seed_pod: (ctx) => {
    if (ctx.event !== "meditate" || !ctx.modifiers) return false;
    if (ctx.rng.next() > 0.4) return false;
    ctx.modifiers.extraCards = (ctx.modifiers.extraCards ?? 0) + 1;
    // Plant crystal bonus is checked after draw in meditation logic
    ctx.modifiers.verdantSeedPodActive = 1;
    ctx.state.log.push(`${ctx.player.name}'s Verdant Seed Pod grants an extra Game Card.`);
    return true;
  },
  celestial_compass: (ctx) => {
    if (ctx.event !== "challenge_setup" || !ctx.played) return false;
    if (ctx.rng.next() > 0.5) return false;
    const extra = ctx.drawGameCard?.();
    if (!extra) return false;
    ctx.played.extraCards.push(extra);
    ctx.played.extraCardSources = ctx.played.extraCardSources ?? {};
    ctx.played.extraCardSources[extra] = "Artifact: Celestial Compass";
    ctx.state.log.push(`${ctx.player.name}'s Celestial Compass reveals ${dataStore.cardsById[extra]?.name ?? extra}.`);
    return true;
  },
  ancestors_drum: (ctx) => {
    if (ctx.event !== "challenge_totals" || !ctx.played || !ctx.totalRef) return false;
    const castCount = ctx.played.invocationsCastCount ?? 0;
    if (castCount < 1) return false;
    const bonus = 3;
    ctx.totalRef.value += bonus;
    ctx.played.powerBonusBreakdown = ctx.played.powerBonusBreakdown ?? [];
    ctx.played.powerBonusBreakdown.push({
      label: "Ancestor's Drum",
      amount: bonus,
      source: "artifact"
    });
    return true;
  },
  crown_of_stars: (ctx) => {
    if (ctx.event === "dice_bonus" && ctx.modifiers) {
      ctx.modifiers.bonus = (ctx.modifiers.bonus ?? 0) + 2;
      return true;
    }
    return false;
  },

  // ===== NEW TP-FOCUSED SPELL HANDLERS =====
  wisdoms_harvest: (ctx) => {
    if (ctx.event !== "spell_cast" || !ctx.played || !ctx.challenge) return false;
    const handSize = ctx.player.hand.length;
    const tpGain = handSize * 2;
    if (tpGain > 0) {
      addChallengeTP(ctx.state, ctx.challenge, ctx.player, ctx.rng, tpGain);
      ctx.state.log.push(`${ctx.player.name}'s Wisdom's Harvest grants +${Math.floor(tpGain * TP_GAIN_MULT)} Challenge TP (${handSize} cards in hand).`);
    }
    return tpGain > 0;
  },
  inner_reflection: (ctx) => {
    if (ctx.event !== "spell_cast" || !ctx.played || !ctx.totalRef || !ctx.challenge) return false;
    const challengeTP = ctx.challenge.challengeTPByPlayer?.[ctx.player.id] ?? 0;
    const bonus = Math.floor(challengeTP / 3);
    if (bonus > 0) {
      ctx.totalRef.value += bonus;
      ctx.played.powerBonusBreakdown = ctx.played.powerBonusBreakdown ?? [];
      ctx.played.powerBonusBreakdown.push({
        label: `Inner Reflection: ${challengeTP} TP / 3`,
        amount: bonus,
        source: "invocation"
      });
      ctx.state.log.push(`${ctx.player.name}'s Inner Reflection grants +${bonus} AP (${challengeTP} TP accumulated).`);
    }
    return bonus > 0;
  },
  scholars_focus: (ctx) => {
    if (ctx.event !== "spell_cast" || !ctx.played || !ctx.cardPowers || !ctx.challenge) return false;
    let tpBonus = 0;
    for (const cp of ctx.cardPowers) {
      if (cp.base <= 5) {
        tpBonus += 3;
      }
    }
    if (tpBonus > 0) {
      addChallengeTP(ctx.state, ctx.challenge, ctx.player, ctx.rng, tpBonus);
      ctx.state.log.push(`${ctx.player.name}'s Scholar's Focus grants +${Math.floor(tpBonus * TP_GAIN_MULT)} Challenge TP (low-AP cards).`);
    }
    return tpBonus > 0;
  },
  threshold_surge: (ctx) => {
    if (ctx.event !== "spell_cast" || !ctx.played || !ctx.totalRef || !ctx.challenge) return false;
    const thresholds = ctx.challenge.challengeTPThresholdsAwarded?.[ctx.player.id];
    if (!thresholds) return false;
    const count = (thresholds.basic ? 1 : 0) + (thresholds.rare ? 1 : 0) + (thresholds.mythic ? 1 : 0);
    if (count === 0) return false;
    const bonus = count >= 2 ? 12 : 8;
    ctx.totalRef.value += bonus;
    ctx.played.powerBonusBreakdown = ctx.played.powerBonusBreakdown ?? [];
    ctx.played.powerBonusBreakdown.push({
      label: `Threshold Surge: ${count} threshold${count !== 1 ? "s" : ""} crossed`,
      amount: bonus,
      source: "invocation"
    });
    ctx.state.log.push(`${ctx.player.name}'s Threshold Surge grants +${bonus} AP (${count} TP threshold${count !== 1 ? "s" : ""} crossed).`);
    return true;
  },

  // ===== NEW TP-FOCUSED ARTIFACT HANDLERS =====
  mentors_medallion: (ctx) => {
    if (ctx.event !== "card_committed" || !ctx.challenge) return false;
    addChallengeTP(ctx.state, ctx.challenge, ctx.player, ctx.rng, 2);
    ctx.state.log.push(`${ctx.player.name}'s Mentor's Medallion grants +${Math.floor(2 * TP_GAIN_MULT)} Challenge TP.`);
    return true;
  },
  tome_of_enlightenment: () => {
    // Passive effect checked inline in addChallengeTP threshold logic
    return false;
  },
  scroll_of_wisdom: () => {
    // Passive effect checked inline in addChallengeTP threshold logic
    return false;
  },
  elders_signet: () => {
    // Passive effect checked inline in addChallengeTP threshold logic
    return false;
  },

  // ===== NEW TP-FOCUSED TEACHING HANDLERS =====
  wisdom_of_low_cards: (ctx) => {
    if (ctx.event !== "card_committed" || !ctx.challenge || !ctx.cardId) return false;
    const card = dataStore.cardsById[ctx.cardId];
    if (!card || card.basePower > 5) return false;
    // Grant bonus TP for low-power cards (doubles the TP from this card)
    const baseTP = teachingPotentialGainForCard(ctx.cardId);
    addChallengeTP(ctx.state, ctx.challenge, ctx.player, ctx.rng, baseTP);
    ctx.state.log.push(`${ctx.player.name}'s Wisdom of Low Cards grants +${Math.floor(baseTP * TP_GAIN_MULT)} bonus TP.`);
    return true;
  },
  teachers_insight: (ctx) => {
    if (ctx.event !== "teaching_gained") return false;
    ctx.player.bonusAp = (ctx.player.bonusAp ?? 0) + 3;
    ctx.state.log.push(`${ctx.player.name}'s Teacher's Insight grants +3 AP.`);
    return true;
  },
  path_of_knowledge: () => {
    // Passive effect checked inline in addChallengeTP threshold logic
    return false;
  },
  threshold_mastery: () => {
    // Passive effect checked inline in addChallengeTP threshold logic
    return false;
  }
};
