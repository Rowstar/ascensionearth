import { GameAction, GameState, RewardItem } from "../engine/types";
import {
  CAVE_MYTHIC_THRESHOLD,
  CAVE_RARE_THRESHOLD,
  CAVE_CRYSTAL_TIER_1,
  CAVE_CRYSTAL_TIER_2,
  MOUNTAIN_MYTHIC_THRESHOLD,
  MOUNTAIN_RARE_THRESHOLD,
  MOUNTAIN_CRYSTAL_TIER_1,
  MOUNTAIN_CRYSTAL_TIER_2,
  canBuyEarthAdvancement,
  earthAdvancementCrystalCost,
  earthAdvancementRequirementLines,
  formatCrystals
} from "../engine/rules";
import { PROGRESS_REVIEW_INTERVAL, progressReviewBaseline } from "../engine/progression";
import { dataStore } from "../engine/state";
import { drawButton, drawPanel, drawRoundedRect } from "../render/ui";
import { HitRegion } from "../render/canvas";
import { playHover, stopHover } from "../render/sfx";
import {
  MAP_NODES,
  MapActionType,
  drawLeyLine,
  drawNode,
  drawParchment,
  drawTerrain,
  drawPlayerIcon,
  drawLightningRing,
  RewardOrbitItem,
  drawRewardOrbitCluster,
  drawTooltip
} from "../render/components/mapBoard";

let mapHoverHold: { content: string | string[]; x: number; y: number; maxWidth: number; maxHeight: number; bounds: { x: number; y: number; w: number; h: number } } | null = null;
let mapHoverHoldUntil = 0;
let mapTooltipShowTime = 0;
let lastHoveredNodeId: string | undefined = undefined;

const ACTION_LABELS: Record<MapActionType, string> = {
  MEDITATE: "Meditate",
  MOUNTAIN: "Mountain Journey",
  CAVE: "Cave Journey",
  EARTH: "Earth Advancement"
};

type RarityTier = "common" | "uncommon" | "rare" | "cosmic";

function rarityForGameCard(card: { category: string; tags: string[]; basePower: number } | undefined): RarityTier {
  if (!card) return "common";
  if (card.category === "cosmic" || (card.tags ?? []).includes("Cosmic")) return "cosmic";
  const ap = card.basePower ?? 0;
  if (ap <= 7) return "common";
  if (ap <= 11) return "uncommon";
  return "rare";
}

function rarityQuality(tier: RarityTier): number {
  switch (tier) {
    case "cosmic":
      return 0.98;
    case "rare":
      return 0.78;
    case "uncommon":
      return 0.58;
    default:
      return 0.42;
  }
}

function crystalQuality(count: number): number {
  if (count >= 5) return 0.7;
  if (count >= 3) return 0.55;
  if (count >= 2) return 0.45;
  return 0.35;
}

function spellQuality(spellId?: string): number {
  const spell = spellId ? dataStore.spellsById[spellId] : undefined;
  const value = spell?.value ?? 12;
  if (value >= 22) return 0.9;
  if (value >= 18) return 0.75;
  if (value >= 14) return 0.6;
  return 0.5;
}

function artifactQuality(artifactId?: string): number {
  const artifact = artifactId ? dataStore.artifactsById[artifactId] : undefined;
  const value = artifact?.value ?? 10;
  if (value >= 18) return 0.9;
  if (value >= 14) return 0.75;
  return 0.65;
}

function rewardOrbitItems(rewards: RewardItem[] | undefined): RewardOrbitItem[] {
  if (!rewards) return [];
  return rewards
    .filter((reward) => (reward.count ?? 1) > 0)
    .map((reward) => {
      switch (reward.kind) {
        case "crystal":
          return { kind: reward.kind, count: reward.count ?? 1, quality: crystalQuality(reward.count ?? 1), label: "C" };
        case "gameCard": {
          const card = reward.cardId ? dataStore.cardsById[reward.cardId] : undefined;
          const rarity = rarityForGameCard(card);
          return { kind: reward.kind, count: 1, quality: rarityQuality(rarity), label: "G" };
        }
        case "artifact":
          return { kind: reward.kind, count: 1, quality: artifactQuality(reward.cardId), label: "A" };
        case "spell":
          return { kind: reward.kind, count: 1, quality: spellQuality(reward.cardId), label: "I" };
        default:
          return { kind: reward.kind, count: reward.count ?? 1, quality: 0.45 };
      }
    });
}

function meditationQuality(rarity: string | undefined): number {
  switch (rarity) {
    case "cosmic":
      return 0.98;
    case "rare":
      return 0.82;
    case "uncommon":
      return 0.6;
    default:
      return 0.45;
  }
}

function rewardLabel(reward: RewardItem): string {
  switch (reward.kind) {
    case "crystal": {
      const count = reward.count ?? 1;
      return `${formatCrystals(count)} Crystal${count === 1 ? "" : "s"}`;
    }
    case "gameCard":
      return `Game Card: ${reward.cardId ? dataStore.cardsById[reward.cardId]?.name ?? "Unknown" : "Unknown"}`;
    case "artifact":
      return `Artifact: ${reward.cardId ? dataStore.artifactsById[reward.cardId]?.name ?? "Unknown" : "Unknown"}`;
    case "spell":
      return `Invocation: ${reward.cardId ? dataStore.spellsById[reward.cardId]?.name ?? "Unknown" : "Unknown"}`;
    default:
      return "Unknown reward";
  }
}

function rewardPoolLines(rewards: RewardItem[]): string[] {
  const visible = rewards.filter((reward) => (reward.count ?? 1) > 0);
  if (visible.length === 0) {
    return ["Current pool: (not rolled)"];
  }
  return ["Current pool:", ...visible.map((reward) => rewardLabel(reward))];
}

function measureTooltipHeight(ctx: CanvasRenderingContext2D, text: string | string[], maxWidth: number): number {
  ctx.save();
  ctx.font = "12px 'Source Serif 4', serif";
  const padding = 10;
  const lineHeight = 16;
  const lines = Array.isArray(text) ? text : String(text).split("\n");
  const wrapped: string[] = [];
  lines.forEach((line) => {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      wrapped.push("");
      return;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const test = current + " " + words[i];
      if (ctx.measureText(test).width + padding * 2 <= maxWidth) {
        current = test;
      } else {
        wrapped.push(current);
        current = words[i];
      }
    }
    wrapped.push(current);
  });
  ctx.restore();
  return padding * 2 + wrapped.length * lineHeight;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function nextThreshold(progress: number, thresholds: number[]): number | undefined {
  return thresholds.find((value) => progress < value);
}

function formatPercent(value: number): string {
  const pct = (value * 100).toFixed(1);
  return `${pct}%`;
}

function clampToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let trimmed = text;
  while (trimmed.length > 0 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.length > 0 ? `${trimmed}...` : text;
}

function drawTierChoice(
  ctx: CanvasRenderingContext2D,
  regions: HitRegion[],
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  enabled: boolean,
  hovered: boolean,
  onClick: () => void
): void {
  if (enabled) {
    drawButton(ctx, regions, id, x, y, w, h, label, onClick, hovered);
    return;
  }
  drawPanel(ctx, x, y, w, h, "rgba(26,30,38,0.85)", "#3d475f");
  ctx.fillStyle = "rgba(245,241,230,0.6)";
  ctx.font = "600 13px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2);
}

function drawKeystonePanel(
  ctx: CanvasRenderingContext2D,
  regions: HitRegion[],
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  progress: number,
  max: number,
  rareUnlocked: boolean,
  mythicUnlocked: boolean,
  hovered: boolean,
  crystalTier1: number,
  crystalTier2: number,
  crystalTier1Claimed: boolean,
  crystalTier2Claimed: boolean
): void {
  drawPanel(ctx, x, y, w, h, "rgba(16,20,28,0.9)", hovered ? "#6a7a96" : "#3d475f");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 12px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText(label, x + 10, y + 16);

  // Visual progress bar
  const barY = y + 22;
  const barH = 6;
  const barW = w - 60;
  const progressPct = Math.min(1, progress / max);

  // Bar background
  ctx.fillStyle = "rgba(80,90,110,0.5)";
  ctx.fillRect(x + 10, barY, barW, barH);

  // Progress fill with gradient
  const gradient = ctx.createLinearGradient(x + 10, barY, x + 10 + barW * progressPct, barY);
  gradient.addColorStop(0, "#4a6fa5");
  gradient.addColorStop(1, "#6a9fd5");
  ctx.fillStyle = gradient;
  ctx.fillRect(x + 10, barY, barW * progressPct, barH);

  // Milestone markers on bar (crystal tiers + rare + mythic)
  const markerPositions = [
    { pos: crystalTier1 / max, color: "#7ec8e3", claimed: crystalTier1Claimed, size: 4 },
    { pos: CAVE_RARE_THRESHOLD / max, color: "#f0d88c", claimed: rareUnlocked, size: 5 },
    { pos: crystalTier2 / max, color: "#7ec8e3", claimed: crystalTier2Claimed, size: 4 },
    { pos: 1, color: "#ff9f80", claimed: mythicUnlocked, size: 5 }
  ];

  markerPositions.forEach((marker) => {
    const mx = x + 10 + barW * marker.pos;
    ctx.beginPath();
    ctx.arc(mx, barY + barH / 2, marker.size, 0, Math.PI * 2);
    ctx.fillStyle = marker.claimed ? marker.color : "rgba(120,130,150,0.6)";
    ctx.fill();
    ctx.strokeStyle = "rgba(245,241,230,0.8)";
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // Progress text
  ctx.font = "10px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.9)";
  ctx.textAlign = "right";
  ctx.fillText(`${progress}/${max}`, x + w - 10, y + 28);

  // Reward indicators (right side)
  const markerY = y + 16;
  const markerSize = 7;
  const markerGap = 4;
  const markerX = x + w - 10 - markerSize * 4 - markerGap * 3;

  const drawRewardMarker = (mx: number, active: boolean, color: string, shape: "circle" | "diamond" = "circle"): void => {
    if (shape === "diamond") {
      ctx.beginPath();
      ctx.moveTo(mx, markerY - markerSize / 2);
      ctx.lineTo(mx + markerSize / 2, markerY);
      ctx.lineTo(mx, markerY + markerSize / 2);
      ctx.lineTo(mx - markerSize / 2, markerY);
      ctx.closePath();
    } else {
      ctx.beginPath();
      ctx.arc(mx, markerY, markerSize / 2, 0, Math.PI * 2);
    }
    ctx.fillStyle = active ? color : "rgba(120,130,150,0.35)";
    ctx.fill();
    ctx.strokeStyle = "rgba(245,241,230,0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  // Draw markers: Crystal1, Rare, Crystal2, Mythic
  drawRewardMarker(markerX, crystalTier1Claimed, "#7ec8e3", "diamond");
  drawRewardMarker(markerX + markerSize + markerGap, rareUnlocked, "#f0d88c", "circle");
  drawRewardMarker(markerX + (markerSize + markerGap) * 2, crystalTier2Claimed, "#7ec8e3", "diamond");
  drawRewardMarker(markerX + (markerSize + markerGap) * 3, mythicUnlocked, "#ff9f80", "circle");

  regions.push({
    id,
    x,
    y,
    w,
    h,
    onClick: () => {},
    cursor: "help"
  });
}

function actionTooltipLines(state: GameState, action: MapActionType): string[] {
  const human = state.players.find((player) => !player.isAI);
  switch (action) {
    case "MEDITATE":
      {
        const lines = [
          "━━━ MEDITATE ━━━",
          "✓ Gain 2 Game Cards",
          "",
          "► Invocation Chance:",
          "  Base: 30%",
        ];

        // Show permanent bonuses from basic teachings
        const teachingBonuses = [
          { id: "open_attention", name: "Open Attention", perm: 2, oneTime: 30 },
          { id: "prepared_mind", name: "Prepared Mind", perm: 3, oneTime: 60 },
          { id: "heightened_curiosity", name: "Heightened Curiosity", perm: 5, oneTime: 100 },
        ];
        const used = human?.usedTeachingOneTimeBonus ?? [];
        const consumed = human?.consumedBasicTeachings ?? [];
        let totalChance = 30;
        for (const t of teachingBonuses) {
          const owned = consumed.includes(t.id) || human?.teachings.includes(t.id);
          if (owned) {
            totalChance += t.perm;
            lines.push(`  +${t.perm}% ${t.name} (permanent)`);
            if (!used.includes(t.id)) {
              totalChance += t.oneTime;
              lines.push(`  +${t.oneTime}% ${t.name} (one-time, next meditation)`);
            }
          }
        }
        lines.push(`  ─── Total: ${Math.min(totalChance, 100)}%`);

        lines.push("", "━━━ No Challenge ━━━");
        return lines.filter(l => l !== "");
      }
    case "MOUNTAIN": {
      const current = state.rewardPools.mountain?.rewards ?? [];
      const currentLines = rewardPoolLines(current);
      const progress = Math.floor(state.guardianKeystones?.mountain.progress ?? 0);
      const next = nextThreshold(progress, [
        MOUNTAIN_CRYSTAL_TIER_1,
        MOUNTAIN_RARE_THRESHOLD,
        MOUNTAIN_CRYSTAL_TIER_2,
        MOUNTAIN_MYTHIC_THRESHOLD
      ]);
      return [
        "Mountain Journey",
        ...currentLines,
        "Teachings earned via Challenge TP thresholds.",
        "Solo or contested: Guardian Challenge unlocks the pool via AP.",
        `Keystone TP: ${progress}/${MOUNTAIN_MYTHIC_THRESHOLD}`,
        next ? `Next Keystone reward in ${next - progress} TP` : "Mountain Keystone complete"
      ];
    }
    case "CAVE": {
      const current = state.rewardPools.cave?.rewards ?? [];
      const currentLines = rewardPoolLines(current);
      const progress = Math.floor(state.guardianKeystones?.cave.progress ?? 0);
      const next = nextThreshold(progress, [
        CAVE_CRYSTAL_TIER_1,
        CAVE_RARE_THRESHOLD,
        CAVE_CRYSTAL_TIER_2,
        CAVE_MYTHIC_THRESHOLD
      ]);
      return [
        "Cave Journey",
        ...currentLines,
        "Teachings earned via Challenge TP thresholds.",
        "Solo or contested: Guardian Challenge unlocks the pool via AP.",
        `Keystone AP: ${progress}/${CAVE_MYTHIC_THRESHOLD}`,
        next ? `Next Keystone reward in ${next - progress} AP` : "Cave Keystone complete"
      ];
    }
    case "EARTH": {
      const crystalTotal = human ? formatCrystals(human.crystals) : "0";
      const t1 = state.decks.earthAdvancementsT1[0] ? dataStore.earthAdvancementsById[state.decks.earthAdvancementsT1[0]] : undefined;
      const t2 = state.decks.earthAdvancementsT2[0] ? dataStore.earthAdvancementsById[state.decks.earthAdvancementsT2[0]] : undefined;
      const t3 = state.decks.earthAdvancementsT3[0] ? dataStore.earthAdvancementsById[state.decks.earthAdvancementsT3[0]] : undefined;
      const can1 = human ? canBuyEarthAdvancement(state, human, 1) : false;
      const can2 = human ? canBuyEarthAdvancement(state, human, 2) : false;
      const can3 = human ? canBuyEarthAdvancement(state, human, 3) : false;
      const tierLine = (label: string, card: typeof t1, canBuy: boolean): string => {
        if (!card || !human) return `${label}: no advancements remaining`;
        const cost = earthAdvancementCrystalCost(card, human);
        const req = earthAdvancementRequirementLines(card).slice(1, 2)[0] ?? "no extra requirement";
        return `${label}: ${card.name} | ${formatCrystals(cost)} Crystals | ${req} (${canBuy ? "Ready" : "Missing requirements"})`;
      };
      return [
        "Earth Advancement (Solo)",
        "AP-focused path: spend Crystals + mixed resources for Personal AP and tiny passives.",
        `Your currency: ${crystalTotal} Crystals`,
        tierLine("Tier 1", t1, can1),
        tierLine("Tier 2", t2, can2),
        tierLine("Tier 3", t3, can3),
        "Hover the Earth node to reveal the Earth Chamber button."
      ];
    }
    default:
      return [];
  }
}


export function renderMapBoard(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId: string | undefined,
  dt: number,
  mapRect: { x: number; y: number; w: number; h: number },
  hoverReady: boolean
): void {
  const { width } = ctx.canvas;
  const now = performance.now();
  const t = now * 0.001;

  // Check if hover left a map node - if so, stop the hover sound
  const wasHoveringMapNode = lastHoveredNodeId?.startsWith("map-") ?? false;
  const isHoveringMapNode = hoveredId?.startsWith("map-") ?? false;
  if (wasHoveringMapNode && !isHoveringMapNode) {
    stopHover();
    lastHoveredNodeId = undefined;
  }

  drawParchment(ctx, mapRect.x, mapRect.y, mapRect.w, mapRect.h, t);
  drawTerrain(ctx, mapRect.x, mapRect.y, mapRect.w, mapRect.h, t);

  const nodes = MAP_NODES.map((node) => ({
    ...node,
    x: mapRect.x + node.xPct * mapRect.w,
    y: mapRect.y + node.yPct * mapRect.h
  }));
  const meditateNode = nodes.find((node) => node.id === "MEDITATE");

  const reviewW = 300;
  const reviewH = 70;
  const reviewX = mapRect.x + 12;
  const reviewY = mapRect.y + 12;
  const nextReviewRound = Math.max(
    state.turn,
    state.turn + ((PROGRESS_REVIEW_INTERVAL - (state.turn % PROGRESS_REVIEW_INTERVAL)) % PROGRESS_REVIEW_INTERVAL)
  );
  const baseline = progressReviewBaseline(nextReviewRound);
  drawPanel(
    ctx,
    reviewX,
    reviewY,
    reviewW,
    reviewH,
    "rgba(16,20,28,0.9)",
    hoveredId === "review-trophy-hud" ? "#6a7a96" : "#3d475f"
  );
  // Single trophy review callout for action-select readability.
  drawPanel(ctx, reviewX + 10, reviewY + 10, 26, 26, "rgba(46,36,20,0.9)", "#ad8b4e");
  ctx.fillStyle = "#f5d98a";
  ctx.font = "700 13px 'Source Serif 4', serif";
  ctx.textAlign = "center";
  ctx.fillText("🏆", reviewX + 23, reviewY + 28);
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 12px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText(`Trophy Review R${nextReviewRound}`, reviewX + 44, reviewY + 20);
  ctx.fillStyle = "rgba(245,241,230,0.9)";
  ctx.font = "10px 'Source Serif 4', serif";
  ctx.fillText(
    `Need ${formatCrystals(baseline.minCrystals)} Crystals OR ${baseline.minTeachings} Teachings`,
    reviewX + 44,
    reviewY + 36
  );
  ctx.fillText("Hover for category details and tie-break rules.", reviewX + 44, reviewY + 50);
  regions.push({
    id: "review-trophy-hud",
    x: reviewX,
    y: reviewY,
    w: reviewW,
    h: reviewH,
    onClick: () => {},
    cursor: "help"
  });

  const playerAnchor = {
    x: mapRect.x + mapRect.w - 96,
    y: mapRect.y + mapRect.h - 86
  };

  const human = state.players.find((player) => !player.isAI);
  const canBuyEarth = human ? (canBuyEarthAdvancement(state, human, 1) || canBuyEarthAdvancement(state, human, 2) || canBuyEarthAdvancement(state, human, 3)) : false;

  const allowInteract = state.phase === "ACTION_SELECT";
  const hoveredAction = allowInteract
    ? nodes.find((node) => hoveredId === `map-${node.id}`)?.id
    : undefined;
  const highlightAction = hoveredAction ?? (allowInteract ? (state.ui.selectedAction as MapActionType | undefined) : undefined);

  let queuedTooltip: { content: string | string[]; x: number; y: number; maxWidth: number; maxHeight: number } | null = null;

  const pathwayStyle = (id: MapActionType): { color: string; glow: string } => {
    switch (id) {
      case "MEDITATE":
        return { color: "rgba(114,215,198,0.7)", glow: "rgba(114,215,198,0.55)" };
      case "MOUNTAIN":
        return { color: "rgba(230,200,122,0.7)", glow: "rgba(230,200,122,0.55)" };
      case "CAVE":
        return { color: "rgba(215,180,120,0.7)", glow: "rgba(215,180,120,0.5)" };
      case "EARTH":
      default:
        return { color: "rgba(126,120,199,0.7)", glow: "rgba(126,120,199,0.5)" };
    }
  };

  nodes.forEach((node, idx) => {
    const baseStyle = pathwayStyle(node.id);
    const avoid = meditateNode && node.id !== "MEDITATE"
      ? { x: meditateNode.x, y: meditateNode.y, radius: meditateNode.radius + 34 }
      : undefined;
    drawLeyLine(ctx, playerAnchor, node, t + idx * 0.35, 0.08, {
      color: baseStyle.color,
      glow: baseStyle.glow,
      width: 2.1,
      highlight: false,
      meander: 26,
      trimStart: 30,
      trimEnd: node.radius * 0.7,
      trackColor: "rgba(90,80,60,0.35)",
      trackWidth: 6,
      seed: idx * 0.77 + node.x * 0.002,
      avoid
    });
    if (highlightAction === node.id) {
      drawLeyLine(ctx, playerAnchor, node, t + idx * 0.55 + 1.6, 0.2, {
        color: baseStyle.color,
        glow: baseStyle.glow,
        width: 2.8,
        highlight: true,
        lightning: true,
        meander: 26,
        trimStart: 30,
        trimEnd: node.radius * 0.7,
        trackColor: "rgba(90,80,60,0.2)",
        trackWidth: 6,
        seed: idx * 0.77 + node.x * 0.002,
        avoid
      });
    }
  });

  nodes.forEach((node) => {
    const id = `map-${node.id}`;
    const hovered = allowInteract && hoveredId === id;
    const selected = state.ui.selectedAction === node.id;
    const disabled = node.id === "EARTH" && !canBuyEarth;

    if (hovered && id !== lastHoveredNodeId) {
      playHover();
      lastHoveredNodeId = id;
    }

    drawNode(ctx, node, node.x, node.y, t, hovered, selected, disabled);
    if (highlightAction === node.id) {
      drawLightningRing(ctx, node.x, node.y, node.radius + 8, t, 0.7);
    }

    if (allowInteract) {
      regions.push({
        id,
        x: node.x - node.radius,
        y: node.y - node.radius,
        w: node.radius * 2,
        h: node.radius * 2,
        onClick: () => {
          if (!disabled) {
            dispatch({ type: "SELECT_ACTION", action: node.id });
          }
        },
        cursor: disabled ? "default" : "pointer"
      });
    }

    if (allowInteract && node.id === "EARTH") {
      const earthSelected = state.ui.selectedAction === "EARTH";
      const showEarthButton = hovered || hoveredId === "map-earth-shop-btn" || earthSelected || !!state.ui.earthShopOpen;
      if (showEarthButton) {
        const btnW = 156;
        const btnH = 28;
        const btnX = clamp(node.x - btnW / 2, mapRect.x + 10, mapRect.x + mapRect.w - btnW - 10);
        const btnY = clamp(node.y - btnH / 2, mapRect.y + 10, mapRect.y + mapRect.h - btnH - 10);
        drawButton(
          ctx,
          regions,
          "map-earth-shop-btn",
          btnX,
          btnY,
          btnW,
          btnH,
          earthSelected ? "Earth Selected" : "Open Earth Chamber",
          () => {
            if (!state.ui.earthShopOpen) {
              dispatch({ type: "TOGGLE_EARTH_SHOP" });
            }
          },
          hoveredId === "map-earth-shop-btn"
        );
        if (earthSelected) {
          ctx.strokeStyle = "rgba(159,235,188,0.95)";
          ctx.lineWidth = 2.2;
          drawRoundedRect(ctx, btnX - 2, btnY - 2, btnW + 4, btnH + 4, 10);
          ctx.stroke();
        }
      }
    }

    if (node.id === "MOUNTAIN") {
      const clusterX = node.x + 18;
      const clusterY = node.y - node.radius - 8;
      drawRewardOrbitCluster(ctx, clusterX, clusterY, rewardOrbitItems(state.rewardPools.mountain?.rewards), t);
    }
    if (node.id === "CAVE") {
      const clusterX = node.x - 18;
      const clusterY = node.y - node.radius - 8;
      drawRewardOrbitCluster(ctx, clusterX, clusterY, rewardOrbitItems(state.rewardPools.cave?.rewards), t + 0.7);
    }

    if (hovered && hoverReady) {
      const maxWidth = 260;
      const maxHeight = 220;
      const tipX = node.x - 140;
      const tooltipContent = actionTooltipLines(state, node.id);
      const tipHeight = Math.min(measureTooltipHeight(ctx, tooltipContent, maxWidth), maxHeight);
      let tipY = node.y + node.radius + 22;
      const bottomLimit = mapRect.y + mapRect.h - 10;
      if (tipY + tipHeight > bottomLimit) {
        tipY = node.y - tipHeight - 18;
      }
      queuedTooltip = { content: tooltipContent, x: tipX, y: tipY, maxWidth, maxHeight };
    }
  });

  if (hoverReady && hoveredId === "review-trophy-hud") {
    queuedTooltip = {
      content: [
        "Progress Review Trophy Rules",
        `Every ${PROGRESS_REVIEW_INTERVAL} rounds, 3 trophies are offered.`,
        `Baseline this cycle: ${formatCrystals(baseline.minCrystals)} Crystals OR ${baseline.minTeachings} Teachings.`,
        "Pass baseline, then lead a category to win the review.",
        "Category examples:",
        "Most Teachings, Most Crystals, Challenges, Win Rate,",
        "Invocations, Rares, Earth Advancement progress.",
        "Ties break by Crystals, then seeded tie-break."
      ],
      x: reviewX + reviewW + 8,
      y: reviewY + 4,
      maxWidth: 320,
      maxHeight: 240
    };
  }

  if (hoverReady && hoveredId === "map-earth-shop-btn") {
    queuedTooltip = {
      content: [
        "Earth Chamber",
        "Shop-style view for Earth Advancement variants.",
        "Inspect all tier options, costs, and missing requirements.",
        "Selecting a tier also selects EARTH for this turn."
      ],
      x: mapRect.x + mapRect.w - 300,
      y: mapRect.y + mapRect.h - 180,
      maxWidth: 300,
      maxHeight: 180
    };
  }

  if (!hoveredId?.startsWith("map-")) {
    lastHoveredNodeId = undefined;
  }

  drawPlayerIcon(ctx, playerAnchor.x, playerAnchor.y, human?.name ?? "You", t);

  if (queuedTooltip) {
    if (mapTooltipShowTime === 0) mapTooltipShowTime = now;
    const tipAlpha = Math.min(1, (now - mapTooltipShowTime) / 200);
    drawTooltip(ctx, queuedTooltip.content, queuedTooltip.x, queuedTooltip.y, queuedTooltip.maxWidth, queuedTooltip.maxHeight, mapRect, tipAlpha);
    mapHoverHold = { ...queuedTooltip, bounds: mapRect };
    mapHoverHoldUntil = now + 100;
  } else if (mapHoverHold && now < mapHoverHoldUntil) {
    const tipAlpha = Math.min(1, (now - mapTooltipShowTime) / 200);
    drawTooltip(ctx, mapHoverHold.content, mapHoverHold.x, mapHoverHold.y, mapHoverHold.maxWidth, mapHoverHold.maxHeight, mapHoverHold.bounds, tipAlpha);
  } else if (mapHoverHold && now >= mapHoverHoldUntil) {
    mapHoverHold = null;
    mapTooltipShowTime = 0;
  }

  if (state.phase === "ACTION_REVEAL") {
    drawPanel(ctx, width / 2 - 160, mapRect.y + 24, 320, 48, "rgba(20,16,10,0.75)", "#765c33");
    ctx.fillStyle = "#f5f1e6";
    ctx.font = "600 14px 'Cinzel', serif";
    ctx.textAlign = "center";
    const status = state.ui.aiStatus?.message ?? "Choice locked...";
    const label = clampToWidth(ctx, status, 292);
    ctx.fillText(label, width / 2, mapRect.y + 54);
  }

}

function drawPlayerAnchors(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  nodes: { id: string; x: number; y: number }[],
  t: number,
  reveal: boolean,
  mapRect: { x: number; y: number; w: number; h: number }
): void {
  const { width, height } = ctx.canvas;
  const human = state.players.find((player) => !player.isAI);
  const aiPlayers = state.players.filter((player) => player.isAI);

  const anchors = [
    human
      ? {
          player: human,
          x: width / 2,
          y: mapRect.y + mapRect.h - 20,
          align: "center" as const
        }
      : undefined,
    aiPlayers[0]
      ? {
          player: aiPlayers[0],
          x: mapRect.x + 40,
          y: mapRect.y + 24,
          align: "left" as const
        }
      : undefined,
    aiPlayers[1]
      ? {
          player: aiPlayers[1],
          x: mapRect.x + mapRect.w - 40,
          y: mapRect.y + 24,
          align: "right" as const
        }
      : undefined
  ].filter(Boolean) as { player: typeof state.players[number]; x: number; y: number; align: "left" | "right" | "center" }[];

  anchors.forEach((anchor) => {
    ctx.save();
    ctx.fillStyle = "rgba(20,16,10,0.75)";
    ctx.strokeStyle = "rgba(120,95,55,0.6)";
    ctx.lineWidth = 2;
    const boxW = 180;
    const boxH = 72;
    const boxX = anchor.align === "center" ? anchor.x - boxW / 2 : anchor.align === "right" ? anchor.x - boxW : anchor.x;
    const boxY = anchor.y - boxH / 2;
    ctx.beginPath();
    roundedRect(ctx, boxX, boxY, boxW, boxH, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f5f1e6";
    ctx.font = "600 13px 'Cinzel', serif";
    ctx.textAlign = anchor.align === "center" ? "center" : anchor.align;
    ctx.fillText(anchor.player.name, anchor.x, boxY + 20);
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.fillText(`Hand ${anchor.player.hand.length}  Invocations ${anchor.player.spells.length}`, anchor.x, boxY + 38);
    ctx.fillText(`Crystals ${formatCrystals(anchor.player.crystals)}`, anchor.x, boxY + 54);
    ctx.restore();

    if (reveal && anchor.player.action) {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "600 12px 'Cinzel', serif";
      ctx.textAlign = anchor.align === "center" ? "center" : anchor.align;
      ctx.fillText(ACTION_LABELS[anchor.player.action as MapActionType], anchor.x, boxY + 70);
      ctx.restore();
    }

    if (anchor.player.action) {
      const node = nodes.find((entry) => entry.id === anchor.player.action);
      if (node) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y + (anchor.align === "center" ? -20 : 20));
        ctx.lineTo(node.x, node.y);
        ctx.stroke();
        ctx.restore();
      }
    }
  });
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
