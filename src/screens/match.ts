import { ActionChoice, ChallengeState, GameAction, GameState, ProgressReviewState, TeachingData, TeachingTier } from "../engine/types";
import {
  CAVE_MYTHIC_THRESHOLD,
  CAVE_RARE_THRESHOLD,
  CAVE_CRYSTAL_TIER_1,
  CAVE_CRYSTAL_TIER_2,
  MOUNTAIN_MYTHIC_THRESHOLD,
  MOUNTAIN_RARE_THRESHOLD,
  MOUNTAIN_CRYSTAL_TIER_1,
  MOUNTAIN_CRYSTAL_TIER_2,
  INVOCATION_SLOT_MAX,
  earthAdvancementAp,
  finalScore,
  finalScoreWithAchievements,
  formatCrystals,
  hasFreeInvocationSlot,
  SHOP_CARD_COST,
  SHOP_INVOCATION_COST,
  CHALLENGE_COMMIT_MAX,
  TP_THRESHOLD_BASIC,
  TP_THRESHOLD_RARE,
  TP_THRESHOLD_MYTHIC,
  getMeditationInvocationChance
} from "../engine/rules";
import { cardPalette, drawArtifactMiniCard, drawButton, drawCard, drawCardBack, drawCardFrame, drawPanel, drawRoundedRect, drawTeachingScrollCard } from "../render/ui";
import { drawTooltip } from "../render/components/mapBoard";
import { DragPayload, HitRegion } from "../render/canvas";
import { dataStore } from "../engine/state";
import { renderMapBoard } from "./mapBoard";
import { drawChallengeResultModal } from "./challengeResult";
import { wrapText } from "../render/text";
import { activateSound, playChime, playTurnStart, setMusicEnabled, setMusicVolume, setSoundEnabled } from "../render/sfx";
import { savePreferences } from "../utils/preferences";
import { gameSpeedLabel, nextGameSpeedMode } from "../utils/gameSpeed";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
};

type FxPulse = {
  kind: "reward" | "keystone" | "tp";
  x: number;
  y: number;
  color: string;
  start: number;
  duration: number;
  label?: string;
  strength: number;
};

// --- Card Slide Animation (hand → commit slot) ---
type CardSlideAnim = {
  cardId: string;
  playerId: string;
  startTime: number;
  duration: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  fromW: number;
  fromH: number;
  toW: number;
  toH: number;
};

// --- Card Flip Animation (reveal phase) ---
type CardFlipAnim = {
  playerId: string;
  slotIndex: number;
  cardId: string;
  startTime: number;
  duration: number;
};

// --- AP Float-Up Animation ---
type ApFloat = {
  value: number;
  x: number;
  y: number;
  startTime: number;
  duration: number;
  color: string;
};

const cardSlideAnims: CardSlideAnim[] = [];
const cardFlipAnims: CardFlipAnim[] = [];
const apFloats: ApFloat[] = [];
let lastCommitCounts: Record<string, number> = {};
let lastRevealIndex = -1;
let lastChallengePhase: string | null = null;
let initiativePopupChallengeKey: string | null = null;
let initiativeRollPopupDismissedKey: string | null = null;

function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }

function spawnApFloat(value: number, x: number, y: number, color = "#e6c15a"): void {
  apFloats.push({ value, x, y, startTime: performance.now(), duration: 1200, color });
}

function updateAndDrawApFloats(ctx: CanvasRenderingContext2D): void {
  const now = performance.now();
  for (let i = apFloats.length - 1; i >= 0; i--) {
    const f = apFloats[i];
    const t = (now - f.startTime) / f.duration;
    if (t >= 1) { apFloats.splice(i, 1); continue; }
    const ease = 1 - Math.pow(1 - t, 3); // cubic out
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    const yOff = ease * -60;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = f.color;
    ctx.font = "700 18px 'Cinzel', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 4;
    ctx.fillText(`+${f.value} AP`, f.x, f.y + yOff);
    ctx.restore();
  }
}

const rewardParticles: Particle[] = [];
const fxPulses: FxPulse[] = [];
let lastLogCount = 0;
let lastParticleLogCount = 0;
let lastFxLogCount = 0;
let lastLogLineCount = 0;
let toastText: string | null = null;
let toastTime = 0;
let hoverTip: { lines: string[]; x: number; y: number; maxWidth: number; maxHeight: number } | null = null;
let hoverStartId: string | undefined;
let hoverStartTime = 0;
let hoverNow = 0;
let hoverHold: { lines: string[]; x: number; y: number; maxWidth: number; maxHeight: number } | null = null;
let hoverHoldUntil = 0;
let tooltipShowTime = 0; // timestamp when tooltip first became visible (for fade-in)
let lastSkipLogKey: string | null = null;

function queueHoverTip(id: string, lines: string[], x: number, y: number, maxWidth = 260, maxHeight = 220): void {
  if (!hoverStartId || id !== hoverStartId) {
    return;
  }
  if (hoverNow - hoverStartTime < 180) {
    return;
  }
  hoverTip = { lines, x, y, maxWidth, maxHeight };
  hoverHold = hoverTip;
  hoverHoldUntil = hoverNow + 100;
}

function formatPercent(value: number): string {
  const pct = (value * 100).toFixed(1);
  return `${pct}%`;
}

function formatRarityOdds(odds: { basic: number; rare: number; mythic: number }): string {
  return `Basic ${formatPercent(odds.basic)} / Rare ${formatPercent(odds.rare)} / Mythic ${formatPercent(odds.mythic)}`;
}

function clampValue(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex.startsWith("#")) return null;
  const clean = hex.replace("#", "");
  const normalized = clean.length === 3
    ? clean.split("").map((ch) => ch + ch).join("")
    : clean;
  if (normalized.length !== 6) return null;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
}

function withAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

function pushPulse(kind: FxPulse["kind"], x: number, y: number, color: string, label?: string): void {
  fxPulses.push({
    kind,
    x,
    y,
    color,
    label,
    start: performance.now(),
    duration: 900,
    strength: kind === "keystone" ? 0.35 : kind === "tp" ? 0.28 : 0.22
  });
}

const MAX_PARTICLES = 200;

function spawnBurst(x: number, y: number, count: number, color: string, size = 3): void {
  for (let i = 0; i < count; i += 1) {
    // Cull oldest particles if at cap
    if (rewardParticles.length >= MAX_PARTICLES) {
      rewardParticles.shift();
    }
    rewardParticles.push({
      x: x + (Math.random() - 0.5) * 40,
      y: y + (Math.random() - 0.5) * 20,
      vx: (Math.random() - 0.5) * 50,
      vy: -25 - Math.random() * 45,
      life: 0.9,
      color,
      size: size + Math.random() * 1.5
    });
  }
}

function rewardLabel(reward: { kind: string; count?: number; cardId?: string }): string {
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

function actionLabel(action?: ActionChoice): string {
  switch (action) {
    case "MEDITATE":
      return "Meditate";
    case "MOUNTAIN":
      return "Mountain Journey";
    case "CAVE":
      return "Cave Journey";
    case "EARTH":
      return "Earth Advancement";
    default:
      return "None";
  }
}

function rewardPoolSummaryLine(pool?: { rewards: Array<{ kind: string; count?: number; cardId?: string }> }): string {
  if (!pool || !pool.rewards || pool.rewards.length === 0) {
    return "Rewards: (not rolled)";
  }
  const visible = pool.rewards.filter((reward) => (reward.count ?? 1) > 0);
  if (visible.length === 0) {
    return "Rewards: (empty)";
  }
  return `Rewards: ${visible.map((reward) => rewardLabel(reward)).join(", ")}`;
}

function buildActionSummaryLines(state: GameState, human: GameState["players"][number]): string[] {
  const action = state.ui.selectedAction;
  if (!action) {
    return [
      "Select an action on the map.",
      `Invocations: ${human.spells.length} / ${INVOCATION_SLOT_MAX}`,
      "Tip: Hover map nodes for reward details."
    ];
  }
  if (action === "MEDITATE") {
    const { totalChance } = getMeditationInvocationChance(human);
    const pct = Math.round(Math.min(totalChance, 1) * 100);
    return [
      "Gain: 2 Game Cards.",
      `Invocation chance: ${pct}%`,
      `Invocations: ${human.spells.length} / ${INVOCATION_SLOT_MAX}`
    ];
  }
  if (action === "MOUNTAIN") {
    return [
      rewardPoolSummaryLine(state.rewardPools.mountain),
      "Solo or contested: Guardian Challenge unlocks rewards via AP."
    ];
  }
  if (action === "CAVE") {
    return [
      rewardPoolSummaryLine(state.rewardPools.cave),
      "Solo or contested: Guardian Challenge unlocks rewards via AP."
    ];
  }
  if (action === "EARTH") {
    const tier = state.ui.selectedEarthTier ?? 1;
    const deck =
      tier === 1
        ? state.decks.earthAdvancementsT1
        : tier === 2
          ? state.decks.earthAdvancementsT2
          : state.decks.earthAdvancementsT3;
    const nextId = deck[0];
    const card = nextId ? dataStore.earthAdvancementsById[nextId] : undefined;
    if (!card) {
      return [`Tier ${tier}: no advancements remaining.`];
    }
    const affordable = human.crystals >= card.costCrystals;
    return [
      `Next: ${card.name} (Tier ${tier})`,
      `Cost: ${formatCrystals(card.costCrystals)} Crystals (${affordable ? "Affordable" : "Not enough"})`,
      `AP: ${earthAdvancementAp(card)}`
    ];
  }
  return [];
}

function drawActionSummaryPanel(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  human: GameState["players"][number],
  x: number,
  y: number,
  w: number,
  hoveredId?: string
): number {
  const padding = 10;
  const headerH = 18;
  const lineH = 16;
  const lines = buildActionSummaryLines(state, human);
  ctx.font = "12px 'Source Serif 4', serif";
  const wrapped = lines.flatMap((line) => wrapText(ctx, line, w - padding * 2));
  const panelH = Math.max(86, padding + headerH + wrapped.length * lineH + 8);

  drawPanel(ctx, x, y, w, panelH, "rgba(18,22,30,0.9)", "#39465c");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 12px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText("ACTION SUMMARY", x + padding, y + 16);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(245,241,230,0.8)";
  ctx.fillText(actionLabel(state.ui.selectedAction), x + w - padding, y + 16);

  ctx.textAlign = "left";
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.85)";
  wrapped.forEach((line, idx) => {
    ctx.fillText(line, x + padding, y + 16 + headerH + idx * lineH);
  });

  if (hoveredId === "action-summary") {
    queueHoverTip(
      "action-summary",
      [
        "Summary of your current action.",
        "Confirm to lock in.",
        "Solo journeys resolve immediately."
      ],
      x + w + 8,
      y + 10,
      260,
      120
    );
  }

  return panelH;
}

let turnToastOpenTime = 0;
let turnToastSoundPlayed = false;
const TURN_TOAST_FADE_MS = 350;

function drawTurnToast(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void
): void {
  const toast = state.ui.turnToast;
  if (!toast) {
    turnToastOpenTime = 0;
    turnToastSoundPlayed = false;
    return;
  }

  const now = performance.now();
  if (turnToastOpenTime === 0) turnToastOpenTime = now;
  if (!turnToastSoundPlayed) {
    playTurnStart();
    turnToastSoundPlayed = true;
  }
  const fadeT = Math.min(1, (now - turnToastOpenTime) / TURN_TOAST_FADE_MS);
  const fadeAlpha = easeOutCubic(fadeT);

  const { width, height } = ctx.canvas;
  // Larger panel, centered on screen
  const panelW = Math.min(520, width - 60);
  const panelH = 140 + toast.lines.length * 22;
  const x = Math.floor(width / 2 - panelW / 2);
  const slideOffset = (1 - fadeAlpha) * 30;
  const y = Math.floor(height / 2 - panelH / 2) + slideOffset;

  // Semi-transparent backdrop with fade
  ctx.fillStyle = `rgba(0,0,0,${(0.6 * fadeAlpha).toFixed(3)})`;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.globalAlpha = fadeAlpha;

  // Main panel with glow
  drawPanel(ctx, x, y, panelW, panelH, "rgba(20,16,12,0.95)", "#e6c87a");
  
  // Title
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 22px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.fillText(toast.title, x + panelW / 2, y + 36);

  // Separator line
  ctx.strokeStyle = "rgba(230,200,122,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 40, y + 52);
  ctx.lineTo(x + panelW - 40, y + 52);
  ctx.stroke();

  // Gains section header
  ctx.font = "600 14px 'Source Serif 4', serif";
  ctx.fillStyle = "#e6c87a";
  ctx.fillText("━ TURN START GAINS ━", x + panelW / 2, y + 74);

  // Display lines with better formatting
  ctx.font = "16px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.95)";
  toast.lines.forEach((line, idx) => {
    // Highlight crystal gains
    if (line.includes("Crystal")) {
      ctx.fillStyle = "#72d7c6"; // Teal for crystals
      ctx.font = "700 16px 'Source Serif 4', serif";
    } else if (line.includes("🧘 Meditation")) {
      ctx.fillStyle = "#a8d4a8"; // Soft green for meditation
      ctx.font = "600 15px 'Source Serif 4', serif";
    } else if (line.includes("⚔️ Journey")) {
      ctx.fillStyle = "#d4a87a"; // Bronze/orange for journey rewards
      ctx.font = "600 15px 'Source Serif 4', serif";
    } else if (line.includes("🔷 Cave")) {
      ctx.fillStyle = "#7ec8e3"; // Light blue for Cave
      ctx.font = "600 15px 'Source Serif 4', serif";
    } else if (line.includes("🔶 Mountain")) {
      ctx.fillStyle = "#e6c87a"; // Gold for Mountain
      ctx.font = "600 15px 'Source Serif 4', serif";
    } else if (line.includes("Cave Reward")) {
      ctx.fillStyle = "#7ec8e3"; // Light blue for Cave rewards
      ctx.font = "700 15px 'Source Serif 4', serif";
    } else if (line.includes("Mountain Reward")) {
      ctx.fillStyle = "#e6c87a"; // Gold for Mountain rewards
      ctx.font = "700 15px 'Source Serif 4', serif";
    } else if (line.includes("TP") || line.includes("Teaching")) {
      ctx.fillStyle = "#e6c87a"; // Gold for teachings
      ctx.font = "600 16px 'Source Serif 4', serif";
    } else if (line.includes("AP")) {
      ctx.fillStyle = "#7e78c7"; // Purple for AP
      ctx.font = "600 16px 'Source Serif 4', serif";
    } else {
      ctx.fillStyle = "rgba(245,241,230,0.95)";
      ctx.font = "16px 'Source Serif 4', serif";
    }

    // Add bullet point for non-special lines
    const displayLine = line.startsWith("+") || line.includes("🔷") || line.includes("🔶") || line.includes("🧘") || line.includes("⚔️") ? line : `+ ${line}`;
    ctx.fillText(displayLine, x + panelW / 2, y + 100 + idx * 26);
  });

  // Click to continue hint
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.6)";
  ctx.fillText("(Click to continue)", x + panelW / 2, y + panelH - 16);
  ctx.restore(); // matches fade-in save

  regions.push({
    id: "turn-toast",
    x,
    y: y - slideOffset, // use un-offset y for hit region
    w: panelW,
    h: panelH + slideOffset,
    onClick: () => dispatch({ type: "UI_CLEAR_TURN_TOAST" }),
    cursor: "pointer"
  });
}

function worldseedStatusLabel(status?: "dormant" | "pending" | "active"): string {
  if (status === "active") return "Awakened";
  if (status === "pending") return "Awakening (next)";
  if (status === "dormant") return "Dormant";
  return "None";
}

function teachingTierLabel(tier: TeachingTier): string {
  switch (tier) {
    case "basic":
      return "Basic";
    case "rare":
      return "Rare";
    case "mythic":
      return "Mythic";
    default:
      return "Unknown";
  }
}

function teachingTierColor(tier: TeachingTier): string {
  switch (tier) {
    case "basic":
      return "#7ed9c4";
    case "rare":
      return "#f0d88c";
    case "mythic":
      return "#ff9f80";
    default:
      return "#c7c2b4";
  }
}

function teachingPhilosophy(teaching: TeachingData): string {
  switch (teaching.effect) {
    case "centered_resolve":
      return "Meditation";
    case "affinity_bonus":
      return "Affinity";
    case "earned_acknowledgement":
    case "favourable_exchange":
      return "Merchant";
    case "pilgrims_insight":
      return "Journey";
    case "triune_expression":
    case "emergent_convergence":
    case "total_commitment":
      return "Synthesis";
    case "worldseed_awakening":
      return "Mythic";
    case "basic_teaching_boost":
      return "Preparation";
    default:
      return "Practice";
  }
}

function buildTeachingTooltipLines(teaching: TeachingData): string[] {
  const tierLabel = teachingTierLabel(teaching.tier);
  const sellCrystals = teaching.tier === "basic" ? 0 : Math.max(1, Math.floor((teaching.value ?? 0) / 100));
  const lines = [
    teaching.name,
    `Tier: ${tierLabel}`,
    `Philosophy: ${teachingPhilosophy(teaching)}`,
    teaching.tier === "basic" ? "Sell: Not sellable" : `Sell: ${sellCrystals} Crystal${sellCrystals === 1 ? "" : "s"}`,
    `Unique: ${teaching.unique ? "Yes" : "No"}`
  ];

  if (teaching.tier === "basic") {
    const rulesText = teaching.rulesText ?? teaching.description ?? "";
    if (rulesText) {
      lines.push(rulesText);
    }
    lines.push("Click USE to consume.");
  } else {
    const rulesText = teaching.rulesText ?? teaching.description ?? "";
    if (rulesText) {
      lines.push(rulesText);
    }
  }
  return lines;
}

type Layout = {
  safeTop: number;
  safeBottom: number;
  safeLeft: number;
  safeRight: number;
  gap: number;
  topBar: { x: number; y: number; w: number; h: number };
  mapRect: { x: number; y: number; w: number; h: number };
  leftSidebar: { x: number; y: number; w: number; h: number };
  rightSidebar: { x: number; y: number; w: number; h: number };
  handDock: { x: number; y: number; w: number; h: number };
};

type HandTab = "ALL" | "CARDS" | "INVOCATIONS" | "SPELLS";

const COMMIT_RULES = {
  round1: { gameSlots: 2, spellSlots: 1 },
  round2: { gameSlots: 1, spellSlots: 1 }
};

type RarityTier = "common" | "uncommon" | "rare" | "cosmic";

function rarityForGameCard(card: { category: string; tags: string[]; basePower: number } | undefined): RarityTier {
  if (!card) return "common";
  // Cosmic is identity-based (legacy cosmic set), not threshold-based.
  if (card.category === "cosmic" || (card.tags ?? []).includes("Cosmic")) return "cosmic";
  const ap = card.basePower ?? 0;
  if (ap <= 7) return "common";
  if (ap <= 11) return "uncommon";
  return "rare";
}

function rarityStroke(tier: RarityTier): string {
  switch (tier) {
    case "cosmic":
      return "#ff6cf0";
    case "rare":
      return "#ffd24a";
    case "uncommon":
      return "#4aa8ff";
    default:
      return "#aeb7c1";
  }
}

function getRarityStrokeForCard(card: { category: string; tags: string[]; basePower: number } | undefined): string {
  return rarityStroke(rarityForGameCard(card));
}

function drawOpponentHiddenCommittedCard(
  ctx: CanvasRenderingContext2D,
  card: { category: string; tags: string[]; basePower: number },
  x: number,
  y: number,
  w: number,
  h: number
): void {
  // Face-down committed card: show rarity borders but no identity.
  drawCard(ctx, card, x, y, w, h, false, true);
  ctx.save();

  // Lock icon (simple)
  const cx = x + w - 18;
  const cy = y + 18;
  ctx.strokeStyle = 'rgba(245,241,230,0.85)';
  ctx.fillStyle = 'rgba(10,10,15,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(cx - 8, cy - 2, 16, 14);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy - 2, 6, Math.PI, 0);
  ctx.stroke();

  // Label
  ctx.fillStyle = 'rgba(245,241,230,0.82)';
  ctx.font = "700 10px 'Cinzel', serif";
  ctx.textAlign = 'center';
  ctx.fillText('HIDDEN', x + w / 2, y + h - 18);
  ctx.font = "10px 'Source Serif 4', serif";
  ctx.fillStyle = 'rgba(245,241,230,0.6)';
  ctx.fillText('(rarity only)', x + w / 2, y + h - 6);
  ctx.restore();
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash;
}

function seededRand(seed: number, idx: number): number {
  const s = Math.sin(seed * 12.9898 + idx * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function drawInvocationArt(
  ctx: CanvasRenderingContext2D,
  spellId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  revealName: boolean
): void {
  const spell = dataStore.spellsById[spellId];
  const artX = x + 8;
  const artY = y + 28;
  const artW = w - 16;
  const artH = h - 62;
  if (artH < 32) {
    return;
  }
  const seed = hashString(spell?.id ?? spell?.name ?? "invocation");
  const value = spell?.value ?? 15;
  const intensity = Math.min(1, Math.max(0, (value - 10) / 15));

  ctx.save();
  drawRoundedRect(ctx, artX, artY, artW, artH, 8);
  ctx.clip();
  const grad = ctx.createLinearGradient(artX, artY, artX, artY + artH);
  grad.addColorStop(0, "rgba(27,46,90,0.95)");
  grad.addColorStop(1, "rgba(15,24,48,0.95)");
  ctx.fillStyle = grad;
  ctx.fillRect(artX, artY, artW, artH);

  const glow = ctx.createRadialGradient(
    artX + artW * 0.5,
    artY + artH * 0.55,
    artW * 0.08,
    artX + artW * 0.5,
    artY + artH * 0.55,
    artW * 0.6
  );
  glow.addColorStop(0, `rgba(120,160,240,${0.25 + intensity * 0.35})`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(artX, artY, artW, artH);

  ctx.strokeStyle = `rgba(200,220,255,${0.3 + intensity * 0.4})`;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 4; i += 1) {
    const rx = seededRand(seed, i * 1.7);
    const ry = seededRand(seed, i * 2.9);
    const cx = artX + rx * artW;
    const cy = artY + ry * artH;
    const r = 10 + seededRand(seed, i * 4.1) * 16;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0.2, Math.PI + 0.6);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(245,241,230,0.7)";
  for (let i = 0; i < 10; i += 1) {
    const rx = seededRand(seed, i * 5.3);
    const ry = seededRand(seed, i * 6.1);
    const px = artX + rx * artW;
    const py = artY + ry * artH;
    const size = 1 + seededRand(seed, i * 7.7) * 2;
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }

  if (!revealName) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(artX, artY, artW, artH);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, artX, artY, artW, artH, 8);
  ctx.stroke();
  ctx.restore();
}

function drawInvocationCard(
  ctx: CanvasRenderingContext2D,
  spellId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  isPending: boolean,
  revealName: boolean
): void {
  const spell = dataStore.spellsById[spellId];
  const palette = cardPalette("spell");
  drawCardFrame(ctx, x, y, w, h, palette, false);
  drawInvocationArt(ctx, spellId, x, y, w, h, revealName);
  ctx.fillStyle = "rgba(245,241,230,0.9)";
  ctx.font = "700 11px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(revealName ? "Invocation" : "Hidden", x + w / 2, y + 18);
  ctx.font = "11px 'Source Serif 4', serif";
  const name = revealName ? (spell?.name ?? "Invocation") : "Hidden";
  wrapText(ctx, name, w - 16).slice(0, 3).forEach((line, idx) => {
    ctx.fillText(line, x + w / 2, y + 36 + idx * 14);
  });
  if (revealName) {
    ctx.fillStyle = "rgba(245,241,230,0.8)";
    ctx.font = "10px 'Source Serif 4', serif";
    const apValue = spell?.value ?? 15;
    ctx.fillText(`AP:${apValue}  TP:${apValue}`, x + w / 2, y + h - 22);
  }
  if (isPending) {
    ctx.font = "10px 'Source Serif 4', serif";
    ctx.fillStyle = "rgba(245,241,230,0.75)";
    ctx.fillText("(pending)", x + w / 2, y + h - 10);
  }
}

function drawHandBadge(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  style: "invocation" | "spell"
): void {
  const padding = 6;
  ctx.font = "700 9px 'Cinzel', serif";
  const textW = ctx.measureText(label).width;
  const badgeW = Math.max(54, Math.ceil(textW + padding * 2));
  const badgeH = 16;
  const fill = style === "invocation" ? "rgba(70,130,190,0.92)" : "rgba(170,80,60,0.92)";
  const stroke = style === "invocation" ? "rgba(140,200,255,0.9)" : "rgba(235,155,125,0.9)";
  drawRoundedRect(ctx, x, y, badgeW, badgeH, 7);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#f7f0e3";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + badgeW / 2, y + badgeH / 2 + 0.5);
}

function drawMagicHandCard(
  ctx: CanvasRenderingContext2D,
  spellId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  style: "invocation" | "spell",
  isPending: boolean,
  hovered: boolean
): void {
  const spell = dataStore.spellsById[spellId];
  const palette = style === "invocation"
    ? cardPalette("spell")
    : { top: "#6a3323", bottom: "#3a1e15", stroke: "#f0b47a" };
  drawCardFrame(ctx, x, y, w, h, palette, hovered || isPending);
  if (style === "invocation") {
    ctx.save();
    ctx.shadowColor = "rgba(120,180,255,0.45)";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = "rgba(120,180,255,0.55)";
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, x + 3, y + 3, w - 6, h - 6, 10);
    ctx.stroke();
    ctx.restore();
  }

  const badgeLabel = "Invocation";
  drawHandBadge(ctx, badgeLabel, x + 6, y + 6, style);

  ctx.fillStyle = "rgba(245,241,230,0.9)";
  ctx.font = "11px 'Source Serif 4', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const name = spell?.name ?? badgeLabel;
  wrapText(ctx, name, w - 16).slice(0, 3).forEach((line, idx) => {
    ctx.fillText(line, x + w / 2, y + 42 + idx * 14);
  });
  if (spell) {
    ctx.fillStyle = "rgba(245,241,230,0.8)";
    ctx.font = "10px 'Source Serif 4', serif";
    ctx.fillText(`AP ${spell.value}`, x + w / 2, y + h - 20);
  }
  if (isPending) {
    ctx.font = "10px 'Source Serif 4', serif";
    ctx.fillStyle = "rgba(245,241,230,0.75)";
    ctx.fillText("(pending)", x + w / 2, y + h - 8);
  }
}

function drawHandTabButton(
  ctx: CanvasRenderingContext2D,
  regions: HitRegion[],
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  active: boolean,
  disabled: boolean,
  hovered: boolean,
  onClick: () => void
): void {
  const fill = active ? "rgba(60,72,92,0.92)" : "rgba(20,24,34,0.85)";
  const border = active ? "#96a4bd" : "rgba(78,90,112,0.8)";
  drawRoundedRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = hovered && !disabled ? "rgba(80,94,118,0.95)" : fill;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = disabled ? "rgba(245,241,230,0.35)" : "rgba(245,241,230,0.9)";
  ctx.font = "700 11px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
  if (!disabled) {
    regions.push({ id, x, y, w, h, onClick, cursor: "pointer" });
  }
}


function drawOpponentHandPeek(
  ctx: CanvasRenderingContext2D,
  opponent: GameState["players"][number],
  anchorX: number,
  anchorY: number,
  panelW: number
): void {
  const cards = opponent.hand.map((id) => dataStore.cardsById[id]).filter(Boolean);
  const tiers = cards.map((c) => rarityForGameCard(c));
  const counts = tiers.reduce(
    (acc, t) => {
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    },
    { common: 0, uncommon: 0, rare: 0, cosmic: 0 } as Record<RarityTier, number>
  );

  const panelH = 138;
  drawPanel(ctx, anchorX, anchorY, panelW, panelH, "rgba(12,16,24,0.92)", "#54607a");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 12px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText("OPPONENT HAND (RARITY ONLY)", anchorX + 10, anchorY + 18);

  // Card backs grid (rarity only)
  const miniW = 20;
  const miniH = 28;
  const gap = 6;
  const cols = Math.max(1, Math.floor((panelW - 20) / (miniW + gap)));
  const startX = anchorX + 10;
  const startY = anchorY + 28;
  cards.slice(0, 18).forEach((card, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = startX + col * (miniW + gap);
    const y = startY + row * (miniH + gap);
    ctx.save();
    ctx.strokeStyle = rarityStroke(rarityForGameCard(card));
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, miniW, miniH);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x + 3, y + 3, miniW - 6, miniH - 6);
    ctx.restore();
  });
  if (cards.length > 18) {
    ctx.fillStyle = "rgba(245,241,230,0.75)";
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.fillText(`+${cards.length - 18} more`, anchorX + panelW - 76, anchorY + panelH - 10);
  }

  // Summary lines (invocations hidden, teachings hidden by design)
  ctx.fillStyle = "rgba(245,241,230,0.85)";
  ctx.font = "11px 'Source Serif 4', serif";
  ctx.fillText(`Cards: ${opponent.hand.length} (G ${counts.common} / B ${counts.uncommon} / Gold ${counts.rare} / Cosmic ${counts.cosmic})`, anchorX + 10, anchorY + panelH - 36);
  ctx.fillText(`Invocations: ${opponent.spells.length} (hidden)`, anchorX + 10, anchorY + panelH - 20);
  ctx.fillText(`Artifacts: ${opponent.artifacts.length} (visible)`, anchorX + 10, anchorY + panelH - 4);
}

function getLayout(width: number, height: number): Layout {
  const safeTop = 64;
  const safeLeft = 20;
  const safeRight = 20;
  const gap = 12;
  const safeBottom = width < 980 ? 200 : 220;
  const topBarH = 64;
  const topBarY = 8;
  let leftW = width < 1400 ? 220 : 260;
  let rightW = width < 1400 ? 260 : 320;
  if (width < 1200) {
    leftW = 200;
    rightW = 240;
  }
  if (width < 980) {
    leftW = 180;
    rightW = 200;
  }
  if (width < 760) {
    leftW = 0;
    rightW = 0;
  }
  const mainY = topBarY + topBarH + gap;
  const mapX = safeLeft + leftW + gap;
  const mapW = Math.max(420, width - safeLeft - safeRight - leftW - rightW - gap * 2);
  const mapH = Math.max(220, height - safeBottom - mainY - gap);
  const rightX = mapX + mapW + gap;
  return {
    safeTop,
    safeBottom,
    safeLeft,
    safeRight,
    gap,
    topBar: { x: safeLeft, y: topBarY, w: width - safeLeft - safeRight, h: topBarH },
    mapRect: { x: mapX, y: mainY, w: mapW, h: mapH },
    leftSidebar: { x: safeLeft, y: mainY, w: leftW, h: mapH },
    rightSidebar: { x: rightX, y: mainY, w: rightW, h: mapH },
    handDock: { x: 0, y: height - safeBottom, w: width, h: safeBottom }
  };
}

export function renderMatch(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId?: string,
  dt = 0
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  hoverTip = null;
  hoverNow = performance.now();
  if (hoveredId !== hoverStartId) {
    hoverStartId = hoveredId;
    hoverStartTime = hoverNow;
  }
  const hoverReady = !!hoveredId && hoverNow - hoverStartTime >= 180;
  const layout = getLayout(width, height);

  setSoundEnabled(state.ui.soundEnabled ?? true);

  const mapCenterX = layout.mapRect.x + layout.mapRect.w / 2;
  const mapCenterY = layout.mapRect.y + layout.mapRect.h * 0.35;
  const cavePulseX = layout.mapRect.x + 132;
  const cavePulseY = layout.mapRect.y + 35;
  const mountainPulseX = layout.mapRect.x + 132;
  const mountainPulseY = layout.mapRect.y + 89;

  if (state.log.length !== lastFxLogCount) {
    for (let i = lastFxLogCount; i < state.log.length; i += 1) {
      const line = state.log[i] ?? "";
      if (line.includes("surge of insight")) {
        pushPulse("tp", mapCenterX, mapCenterY, "#6fd6c2", "INSIGHT SURGE");
        spawnBurst(mapCenterX, mapCenterY, 18, "#6fd6c2", 3.5);
        playChime("tp");
      }
      if (
        line.includes("Reveal begins.") ||
        line.includes("Resolve begins.") ||
        line.includes("Guardian: The draft begins.") ||
        line.includes("Commit turns begin.")
      ) {
        playChime("phase");
      }
      if (line.includes("bought a Game Card") || line.includes("bought an Invocation")) {
        playChime("reward");
      }
      if (line.includes("Earth Ascension reaches its target")) {
        playChime("reward");
      }
      if (line.includes("Cave Keystone")) {
        pushPulse("keystone", cavePulseX, cavePulseY, "#f0d88c", "CAVE KEYSTONE");
        spawnBurst(cavePulseX, cavePulseY, 16, "#f0d88c", 3.5);
        playChime("keystone");
      }
      if (line.includes("Mountain Keystone")) {
        pushPulse("keystone", mountainPulseX, mountainPulseY, "#ffb78a", "MOUNTAIN KEYSTONE");
        spawnBurst(mountainPulseX, mountainPulseY, 16, "#ffb78a", 3.5);
        playChime("keystone");
      }
    }
    lastFxLogCount = state.log.length;
  }

  updateParticles(state, mapCenterX, layout.mapRect.y + 60, dt);
  drawParticles(ctx);
  drawFxPulses(ctx);

  drawTopBar(ctx, state, regions, dispatch, hoveredId, layout);
  // Toast: show latest log line briefly
  if (state.log.length !== lastLogCount) {
    lastLogCount = state.log.length;
    const last = state.log[state.log.length - 1];
    if (last) {
      toastText = last;
      toastTime = 2.6;
    }
  }
  if (toastTime > 0) {
    toastTime -= dt;
    if (toastTime <= 0) toastText = null;
  }
  if (toastText) {
    drawToast(ctx, toastText, toastTime);
  }
  if (state.phase !== "GAME_OVER") {
    renderMapBoard(ctx, state, regions, dispatch, hoveredId, dt, layout.mapRect, hoverReady);
  }
  if (layout.leftSidebar.w > 40) {
    drawLeftSidebar(ctx, state, regions, dispatch, hoveredId, layout);
  }
  if (layout.rightSidebar.w > 40) {
    drawRightSidebar(ctx, state, regions, dispatch, hoveredId, layout);
  }
  if (state.ui.menuOpen) {
    drawMenuOverlay(ctx, state, regions, dispatch, hoveredId, layout);
  }
  if (state.phase === "ACTION_REVEAL") {
    const aiWaiting = !!state.aiActive || state.aiQueue.length > 0 || state.aiPendingReveal;
    if (!aiWaiting) {
      dispatch({ type: "LOCK_ACTIONS" });
    }
  }

  if (state.phase === "CHALLENGE" && state.challenge) {
    drawChallengeOverlay(ctx, state, regions, dispatch, hoveredId, layout);
    if (state.ui.menuOpen) {
      drawMenuOverlay(ctx, state, regions, dispatch, hoveredId, layout);
    }
  }

  if (state.phase === "GAME_OVER") {
    drawGameOver(ctx, state, regions, dispatch, hoveredId);
  }

  drawPlayerHand(ctx, state, regions, dispatch, hoveredId, layout);

  
  if (state.phase === "ACTION_SELECT" && state.ui.shopOpen) {
    drawShopOverlay(ctx, state, regions, dispatch, hoveredId);
  }

  if (state.ui.debugEnabled) {
    drawDevOverlay(ctx, state, regions, dispatch, hoveredId);
  }

  // Draw turn toast LAST so it appears on top of everything
  drawTurnToast(ctx, state, regions, dispatch);

  if (state.ui.progressReview) {
    drawProgressReviewModal(ctx, state, regions, dispatch, hoveredId);
    hoverTip = null;
    return;
  }

  if (state.ui.pendingSell) {
    drawSellConfirmModal(ctx, state, regions, dispatch, hoveredId);
    hoverTip = null;
    return;
  }



  if (state.ui.challengeResult) {
    drawChallengeResultModal(ctx, state, regions, dispatch);
    hoverTip = null;
    return;
  }

  if (!hoverTip && hoverHold && hoverNow < hoverHoldUntil) {
    hoverTip = hoverHold;
  }
  if (hoverTip) {
    const now = performance.now();
    if (tooltipShowTime === 0) tooltipShowTime = now;
    const tipAlpha = Math.min(1, (now - tooltipShowTime) / 200); // 200ms fade-in
    drawTooltip(ctx, hoverTip.lines, hoverTip.x, hoverTip.y, hoverTip.maxWidth, hoverTip.maxHeight, undefined, tipAlpha);
  } else {
    hoverHold = null;
    tooltipShowTime = 0;
  }
}

function drawTopBar(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId: string | undefined,
  layout: Layout
): void {
  const { x, y, w, h } = layout.topBar;
  drawPanel(ctx, x, y, w, h, "rgba(14,18,26,0.8)", "#3a465e");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 16px 'Cinzel', serif";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const earthCurrent = Math.floor(state.earthAscensionPower);
  const earthTarget = state.earthAscensionTarget;
  ctx.fillText(`EARTH ASCENSION (GROUP): ${earthCurrent} / ${earthTarget}`, x + 16, y + 22);

  const barX = x + 16;
  const barY = y + 30;
  const barW = Math.min(320, w * 0.42);
  const barH = 10;
  ctx.fillStyle = "rgba(70,80,96,0.8)";
  ctx.fillRect(barX, barY, barW, barH);
  const pct = earthTarget > 0 ? Math.min(1, earthCurrent / earthTarget) : 0;
  ctx.fillStyle = "#8bd4a1";
  ctx.fillRect(barX, barY, barW * pct, barH);

  ctx.fillStyle = "rgba(245,241,230,0.75)";
  ctx.font = "11px 'Source Serif 4', serif";
  ctx.fillText(`Turn ${state.turn}`, barX, y + h - 10);

  // --- Compact keystone progress indicators ---
  const ks = state.guardianKeystones;
  if (ks) {
    const ksBarW = Math.min(120, barW * 0.35);
    const ksBarH = 4;
    const ksX = barX + 60;
    const ksY = y + h - 12;
    const tracks: Array<{ label: string; progress: number; max: number; color: string }> = [
      { label: "C", progress: ks.cave.progress, max: CAVE_MYTHIC_THRESHOLD, color: "#7ec8e3" },
      { label: "M", progress: ks.mountain.progress, max: MOUNTAIN_MYTHIC_THRESHOLD, color: "#f0d88c" },
    ];
    tracks.forEach((t, i) => {
      const tx = ksX + i * (ksBarW + 24);
      ctx.fillStyle = "rgba(245,241,230,0.5)";
      ctx.font = "9px 'Source Serif 4', serif";
      ctx.textAlign = "left";
      ctx.fillText(t.label, tx, ksY + 3);
      const bx = tx + 10;
      ctx.fillStyle = "rgba(70,80,96,0.6)";
      ctx.fillRect(bx, ksY - 1, ksBarW, ksBarH);
      const ksPct = t.max > 0 ? Math.min(1, t.progress / t.max) : 0;
      ctx.fillStyle = t.color;
      ctx.fillRect(bx, ksY - 1, ksBarW * ksPct, ksBarH);
      ctx.fillStyle = "rgba(245,241,230,0.45)";
      ctx.font = "8px 'Source Serif 4', serif";
      ctx.textAlign = "right";
      ctx.fillText(`${Math.floor(t.progress)}`, bx + ksBarW + 18, ksY + 3);
    });
    ctx.textAlign = "left";
  }

  // Draw player scores centered at the top of the top bar
  const playerScoresY = y + 24;

  // Calculate player scores
  const playerScores = state.players.map((player) => {
    const score = Math.floor(finalScore(player));
    const isHuman = !player.isAI;
    const label = isHuman ? "You" : player.name;
    return { label, score, isHuman };
  });

  // Sort by score descending to show who's winning
  playerScores.sort((a, b) => b.score - a.score);

  // Calculate button area start position using existing button dimensions
  // Buttons are: Dev, Shop, Menu, Settings - starting from right
  const settingsW2 = 40;
  const menuW2 = 96;
  const shopW2 = 96;
  const devW2 = 80;
  const buttonGap2 = 8;
  const rightPadding2 = 12;
  const buttonAreaStart = x + w - rightPadding2 - settingsW2 - buttonGap2 - menuW2 - buttonGap2 - shopW2 - buttonGap2 - devW2 - buttonGap2;

  // First pass: calculate total width with larger font
  ctx.font = "700 16px 'Cinzel', serif";
  let totalWidth = 0;
  const scoreWidths = playerScores.map((ps) => {
    const text = `${ps.label}: ${ps.score}`;
    const width = ctx.measureText(text).width;
    totalWidth += width + 32; // 32px gap for larger spacing
    return width;
  });
  totalWidth -= 32; // Remove extra gap from last item

  // Center the scores in the available space between Earth bar and buttons
  const earthBarEnd = barX + barW + 60;
  const centerX = (earthBarEnd + buttonAreaStart) / 2;
  let scoreX = centerX - totalWidth / 2;

  playerScores.forEach((ps, idx) => {
    const scoreText = `${ps.label}: ${ps.score}`;
    const textWidth = scoreWidths[idx];

    // Draw player name and score with larger, more prominent font
    ctx.fillStyle = ps.isHuman ? "#8bd4a1" : "rgba(245,241,230,0.9)";
    ctx.font = ps.isHuman ? "700 16px 'Cinzel', serif" : "600 16px 'Cinzel', serif";
    ctx.textAlign = "left";
    ctx.fillText(scoreText, scoreX, playerScoresY);

    scoreX += textWidth + 32;
  });

  const settingsW = 40;
  const settingsX = x + w - settingsW - 12;
  const menuW = 96;
  const menuX = settingsX - menuW - 8;
  const menuY = y + 10;
  const shopW = 96;
  const shopX = menuX - shopW - 8;
  const devW = 80;
  const devX = shopX - devW - 8;
  const human = state.players.find((p) => !p.isAI);

  if (human) {
    const chalTP = state.challenge?.challengeTPByPlayer?.[human.id] ?? 0;
    ctx.fillText(`Challenge TP: ${Math.floor(chalTP)}`, barX + 100, y + h - 10);
    const shopLabel = state.ui.shopOpen ? "Shop: ON" : "Shop";
    drawButton(ctx, regions, "toggle-shop", shopX, menuY, shopW, 34, shopLabel, () => {
      dispatch({ type: "TOGGLE_SHOP" });
    }, hoveredId === "toggle-shop");
  }

  const phaseText = (() => {
    if (state.phase === "ACTION_SELECT") return "Action Select";
    if (state.phase === "ACTION_REVEAL") return "Action Reveal";
    if (state.phase === "TURN_END") return "Turn End";
    if (state.phase === "GAME_OVER") return "Game Over";
    if (state.phase === "CHALLENGE") {
      const sub = state.challenge?.phase ?? "CHALLENGE";
      return `Challenge • ${sub.replace(/_/g, " ")}`;
    }
    return state.phase.replace(/_/g, " ");
  })();
  const phaseX = barX + barW + 16;
  const phaseMaxW = Math.max(0, menuX - 12 - phaseX);
  if (phaseMaxW > 80) {
    ctx.fillStyle = "rgba(245,241,230,0.7)";
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.textAlign = "left";
    ctx.fillText(`Phase: ${clampToWidth(ctx, phaseText, phaseMaxW)}`, phaseX, y + h - 10);
  }

  drawButton(ctx, regions, "settings", settingsX, menuY, settingsW, 34, "⚙", () => {
    dispatch({ type: "TOGGLE_MENU" });
  }, hoveredId === "settings");

  drawButton(ctx, regions, "menu", menuX, menuY, menuW, 34, "Menu", () => {
    dispatch({ type: "TOGGLE_MENU" });
  }, hoveredId === "menu");

  // Dev button
  const devLabel = state.ui.debugEnabled ? "Dev: ON" : "Dev";
  drawButton(ctx, regions, "toggle-dev", devX, menuY, devW, 34, devLabel, () => {
    dispatch({ type: "TOGGLE_DEBUG" });
  }, hoveredId === "toggle-dev");

  if (state.ui.showRules) {
    drawRulesOverlay(ctx, regions, dispatch, hoveredId);
  }

}

function rewardSummary(rewards?: { gameCards?: number; spells?: number; artifacts?: number }): string {
  if (!rewards) return "Rewards: none";
  const bits: string[] = [];
  if (rewards.gameCards) bits.push(`${rewards.gameCards} Card${rewards.gameCards === 1 ? "" : "s"}`);
  if (rewards.spells) bits.push(`${rewards.spells} Invocation${rewards.spells === 1 ? "" : "s"}`);
  if (rewards.artifacts) bits.push(`${rewards.artifacts} Artifact${rewards.artifacts === 1 ? "" : "s"}`);
  return bits.length ? `Rewards: ${bits.join(", ")}` : "Rewards: none";
}

function drawLeftSidebar(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId: string | undefined,
  layout: Layout
): void {
  const { x, y, w, h } = layout.leftSidebar;
  drawPanel(ctx, x, y, w, h, "rgba(14,18,26,0.88)", "#3a465e");

  const padding = 10;
  const gap = 10;
  const headerH = 18;
  const artifactsH = Math.floor((h - gap) * 0.4);
  const teachingsH = h - artifactsH - gap;

  const artifactsBox = { x: x + padding, y: y + padding, w: w - padding * 2, h: artifactsH - padding };
  const teachingsBox = { x: x + padding, y: artifactsBox.y + artifactsBox.h + gap, w: w - padding * 2, h: teachingsH };

  drawPanel(ctx, artifactsBox.x, artifactsBox.y, artifactsBox.w, artifactsBox.h, "rgba(18,22,30,0.9)", "#39465c");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 12px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText("ARTIFACTS", artifactsBox.x + 8, artifactsBox.y + headerH);

  const player = state.players.find((p) => !p.isAI);
  if (player) {
    const rowH = 72;
    const listY = artifactsBox.y + headerH + 6;
    const listH = artifactsBox.h - headerH - 10;
    const visibleCount = Math.max(1, Math.floor(listH / rowH));
    const maxOffset = Math.max(0, player.artifacts.length - visibleCount);
    const offset = Math.min(state.ui.artifactScroll ?? 0, maxOffset);

    ctx.save();
    ctx.beginPath();
    ctx.rect(artifactsBox.x + 6, listY, artifactsBox.w - 12, listH);
    ctx.clip();

    player.artifacts.slice(offset, offset + visibleCount).forEach((artifactId, idx) => {
      const artifact = dataStore.artifactsById[artifactId];
      if (!artifact) return;
      const rowY = listY + idx * rowH;
      const cardX = artifactsBox.x + 6;
      const cardW = artifactsBox.w - 12;
      const cardH = rowH - 6;
      const id = `artifact-row-${offset + idx}`;
      drawArtifactMiniCard(ctx, artifact, cardX, rowY, cardW, cardH, hoveredId === id);

      const rulesText = artifact.rulesText ?? artifact.description ?? "";
      if (hoveredId === id) {
        queueHoverTip(id, [artifact.name, rulesText, `Base: +${artifact.value} AP`, "Sell: 2 Crystals"], artifactsBox.x + artifactsBox.w + 6, rowY - 10);
      }
      regions.push({
        id,
        x: cardX,
        y: rowY,
        w: cardW,
        h: cardH,
        onClick: () => {
          if (state.phase === "ACTION_SELECT" && state.ui.shopOpen) {
            dispatch({ type: "UI_REQUEST_SELL", kind: "ARTIFACT", index: offset + idx });
          }
        },
        cursor: state.phase === "ACTION_SELECT" && state.ui.shopOpen ? "pointer" : "default"
      });
    });
    ctx.restore();

    if (player.artifacts.length > visibleCount) {
      drawButton(ctx, regions, "artifact-scroll-up", artifactsBox.x + artifactsBox.w - 60, artifactsBox.y + 4, 52, 20, "Up", () => {
        dispatch({ type: "SET_ARTIFACT_SCROLL", value: offset - 1 });
      }, hoveredId === "artifact-scroll-up");
      drawButton(ctx, regions, "artifact-scroll-down", artifactsBox.x + artifactsBox.w - 60, artifactsBox.y + artifactsBox.h - 26, 52, 20, "Down", () => {
        dispatch({ type: "SET_ARTIFACT_SCROLL", value: offset + 1 });
      }, hoveredId === "artifact-scroll-down");
    }
  }

  drawPanel(ctx, teachingsBox.x, teachingsBox.y, teachingsBox.w, teachingsBox.h, "rgba(18,22,30,0.9)", "#39465c");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 12px 'Cinzel', serif";
  ctx.fillText("TEACHINGS", teachingsBox.x + 8, teachingsBox.y + headerH);

  if (player) {
    const basicCount = player.teachings.length;
    const rareCount = player.passiveTeachings.filter((id) => dataStore.teachingsById[id]?.tier === "rare").length;
    const mythicCount = player.passiveTeachings.filter((id) => dataStore.teachingsById[id]?.tier === "mythic").length;
    ctx.fillStyle = "rgba(245,241,230,0.7)";
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.fillText(`Basic ${basicCount} | Rare ${rareCount} | Mythic ${mythicCount}`, teachingsBox.x + 8, teachingsBox.y + headerH + 14);

    const entries = [
      ...player.teachings.map((id, index) => ({ id, index, isBasic: true })),
      ...player.passiveTeachings.map((id) => ({ id, index: -1, isBasic: false }))
    ];
    const rowH = 78;
    const colGap = 8;
    const colW = Math.floor((teachingsBox.w - colGap - 12) / 2);
    const listY = teachingsBox.y + headerH + 26;
    const listH = teachingsBox.h - headerH - 32;
    const rowsVisible = Math.max(1, Math.floor(listH / rowH));
    const totalRows = Math.ceil(entries.length / 2);
    const maxOffset = Math.max(0, totalRows - rowsVisible);
    const offset = Math.min(state.ui.teachingScroll ?? 0, maxOffset);
    const canSell = state.phase === "ACTION_SELECT" && !!state.ui.shopOpen;
    const canUse = state.phase === "ACTION_SELECT" && !state.ui.shopOpen;

    ctx.save();
    ctx.beginPath();
    ctx.rect(teachingsBox.x + 6, listY, teachingsBox.w - 12, listH);
    ctx.clip();

    for (let row = 0; row < rowsVisible; row += 1) {
      const rowIndex = (row + offset) * 2;
      const rowY = listY + row * rowH;
      for (let col = 0; col < 2; col += 1) {
        const entry = entries[rowIndex + col];
        if (!entry) continue;
        const teaching = dataStore.teachingsById[entry.id];
        if (!teaching) continue;
        const cardX = teachingsBox.x + 6 + col * (colW + colGap);
        const cardY = rowY;
        const cardW = colW;
        const cardH = rowH - 6;
        const tipId = `teach-left-${rowIndex + col}`;

        drawTeachingScrollCard(ctx, teaching, cardX, cardY, cardW, cardH, hoveredId === tipId, teachingTierColor(teaching.tier));

        if (hoveredId === tipId) {
          queueHoverTip(tipId, buildTeachingTooltipLines(teaching), teachingsBox.x + teachingsBox.w + 6, cardY - 10, 300, 260);
        }

        regions.push({
          id: tipId,
          x: cardX,
          y: cardY,
          w: cardW,
          h: cardH,
          cursor: "default"
        });

        if (entry.isBasic && canUse) {
          const btnW = 40;
          const btnH = 18;
          const btnX = cardX + cardW - btnW - 6;
          const btnY = cardY + cardH - btnH - 6;
          drawButton(ctx, regions, `${tipId}-use`, btnX, btnY, btnW, btnH, "USE", () => {
            dispatch({ type: "PLAY_TEACHING", teachingId: entry.id });
          }, hoveredId === `${tipId}-use`);
        }
      }
    }
    ctx.restore();

    if (totalRows > rowsVisible) {
      drawButton(ctx, regions, "teach-scroll-up", teachingsBox.x + teachingsBox.w - 60, teachingsBox.y + 4, 52, 20, "Up", () => {
        dispatch({ type: "SET_TEACHING_SCROLL", value: offset - 1 });
      }, hoveredId === "teach-scroll-up");
      drawButton(ctx, regions, "teach-scroll-down", teachingsBox.x + teachingsBox.w - 60, teachingsBox.y + teachingsBox.h - 26, 52, 20, "Down", () => {
        dispatch({ type: "SET_TEACHING_SCROLL", value: offset + 1 });
      }, hoveredId === "teach-scroll-down");
    }
  }
}

function drawAiPanel(
  ctx: CanvasRenderingContext2D,
  player: GameState["players"][number],
  x: number,
  y: number,
  w: number,
  h: number,
  isActive: boolean,
  pulse: number
): void {
  drawPanel(ctx, x, y, w, h, "rgba(16,20,28,0.9)", "#39465c");
  if (isActive) {
    const glow = 0.5 + 0.5 * Math.sin(pulse);
    ctx.strokeStyle = `rgba(255,215,120,${0.5 + glow * 0.4})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  }
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 13px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText(player.name, x + 10, y + 18);
  ctx.font = "11px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.8)";
  ctx.fillText(`Cards ${player.hand.length}  Invocations ${player.spells.length}  Artifacts ${player.artifacts.length}`, x + 10, y + 34);
  ctx.fillText(`Crystals ${formatCrystals(player.crystals)}`, x + 10, y + 50);

  // Small rarity-only backs preview (no names, no power) to communicate opponent hand texture.
  const previewX = x + w - 10;
  const previewY = y + 12;
  const miniW = 10;
  const miniH = 14;
  const gap = 3;
  const maxMini = 8;
  const cardIds = player.hand;
  const shown = cardIds.slice(0, maxMini);
  let cx = previewX - miniW;
  shown.forEach((id) => {
    const card = dataStore.cardsById[id];
    const stroke = getRarityStrokeForCard(card);
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(cx, previewY, miniW, miniH);
    ctx.restore();
    cx -= miniW + gap;
  });
  if (cardIds.length > maxMini) {
    ctx.fillStyle = "rgba(245,241,230,0.75)";
    ctx.font = "10px 'Source Serif 4', serif";
    ctx.textAlign = "right";
    ctx.fillText(`+${cardIds.length - maxMini}`, previewX, previewY + miniH + 12);
  }
}

function drawRightSidebar(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId: string | undefined,
  layout: Layout
): void {
  const { x, y, w, h } = layout.rightSidebar;
  drawPanel(ctx, x, y, w, h, "rgba(14,18,26,0.88)", "#3a465e");

  const padding = 10;
  const gap = 10;
  const aiPanelH = 62;
  let cursorY = y + padding;

  const aiPlayers = state.players.filter((player) => player.isAI);
  const pulse = performance.now() / 300;
  aiPlayers.forEach((player) => {
    const isActive = state.ui.activeHighlightPlayerId === player.id;
    const panelX = x + padding;
    const panelY = cursorY;
    const panelW = w - padding * 2;
    drawAiPanel(ctx, player, panelX, panelY, panelW, aiPanelH, isActive, pulse);

    // Hoverable region: shows opponent hand summary (rarity-only backs; invocations hidden).
    const regionId = `ai-panel-${player.id}`;
    regions.push({
      id: regionId,
      x: panelX,
      y: panelY,
      w: panelW,
      h: aiPanelH,
      cursor: "help"
    });

    if (hoveredId === regionId) {
      const peekW = 260;
      const peekH = 138;
      const rawX = Math.max(layout.mapRect.x + layout.mapRect.w - 10 - peekW, panelX - peekW - 8);
      const rawY = Math.min(panelY, layout.mapRect.y + layout.mapRect.h - (peekH + 22));
      const peekX = clampValue(rawX, 8, ctx.canvas.width - peekW - 8);
      const peekY = clampValue(rawY, 8, ctx.canvas.height - peekH - 8);
      drawOpponentHandPeek(ctx, player, peekX, peekY, peekW);
    }
    cursorY += aiPanelH + gap;
  });

  const human = state.players.find((player) => !player.isAI);
  if (human) {
    const statsH = 150;
    const statsX = x + padding;
    const statsW = w - padding * 2;
    const statsY = cursorY;
    drawPanel(ctx, statsX, statsY, statsW, statsH, "rgba(18,22,30,0.9)", "#39465c");
    ctx.fillStyle = "#f5f1e6";
    ctx.font = "700 12px 'Cinzel', serif";
    ctx.textAlign = "left";
    ctx.fillText("PLAYER STATS", statsX + 8, statsY + 16);

    const rowY = statsY + 34;
    const rowH = 22;
    const valueX = statsX + statsW - 12;
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.fillStyle = "rgba(245,241,230,0.85)";
    ctx.fillText("Crystals", statsX + 10, rowY);
    ctx.textAlign = "right";
    ctx.fillText(`${formatCrystals(human.crystals)}`, valueX, rowY);
    ctx.textAlign = "left";

    const chalTP = state.challenge?.challengeTPByPlayer?.[human.id] ?? 0;
    ctx.fillText("Challenge TP", statsX + 10, rowY + rowH);
    ctx.textAlign = "right";
    ctx.fillText(`${Math.floor(chalTP)}`, valueX, rowY + rowH);
    ctx.textAlign = "left";

    const personalAp = Math.floor(finalScore(human));
    ctx.fillText("Your AP", statsX + 10, rowY + rowH * 2);
    ctx.textAlign = "right";
    ctx.fillText(`${personalAp}`, valueX, rowY + rowH * 2);
    ctx.textAlign = "left";

    ctx.fillText("Earth Ascension (Group)", statsX + 10, rowY + rowH * 3);
    ctx.textAlign = "right";
    ctx.fillText(`${Math.floor(state.earthAscensionPower)} / ${state.earthAscensionTarget}`, valueX, rowY + rowH * 3);
    ctx.textAlign = "left";

    const worldseedLabel = worldseedStatusLabel(human.worldseedStatus);
    ctx.fillText("Worldseed", statsX + 10, rowY + rowH * 4);
    ctx.textAlign = "right";
    ctx.fillText(worldseedLabel, valueX, rowY + rowH * 4);
    ctx.textAlign = "left";

    const statsRegions = [
      {
        id: "stats-crystals",
        y: rowY - 12,
        lines: [
          "Crystals",
          "Currency used to buy items in the shop.",
          "Gained at turn start (baseline) and from journeys/rewards.",
          "Spent when purchasing shop items."
        ]
      },
      {
        id: "stats-tp",
        y: rowY + rowH - 12,
        lines: [
          "Challenge TP (Teaching Potential)",
          "Earned by committing cards in challenges. Low-power cards give more TP.",
          "10 TP = Basic Teaching, 25 TP = Rare Teaching, 50 TP = Mythic Teaching.",
          "Resets each challenge."
        ]
      },
      {
        id: "stats-ap",
        y: rowY + rowH * 2 - 12,
        lines: [
          "Your AP (Ascension Power)",
          "Your personal score from cards, invocations, artifacts, earth advancements, crystals, and bonuses.",
          "Highest personal AP wins when the world ascends."
        ]
      },
      {
        id: "stats-ascension",
        y: rowY + rowH * 3 - 12,
        lines: [
          "Earth Ascension (Group)",
          "Group progress toward ending the game.",
          "Sum of all players' AP.",
          `When the group reaches ${state.earthAscensionTarget}, the game ends.`
        ]
      },
      {
        id: "stats-worldseed",
        y: rowY + rowH * 4 - 12,
        lines: [
          "Worldseed",
          "Mythic state gained by completing the Worldseed ritual.",
          "Pending: activates next round.",
          "Active: Meditation grants a large AP surge once per round."
        ]
      }
    ];

    statsRegions.forEach((region) => {
      const regionId = region.id;
      regions.push({
        id: regionId,
        x: statsX + 6,
        y: region.y,
        w: statsW - 12,
        h: rowH,
        cursor: "help"
      });
      if (hoveredId === regionId) {
        queueHoverTip(regionId, region.lines, statsX + statsW + 8, region.y - 6, 320, 160);
      }
    });

    cursorY += statsH + gap;
  }

  if (human && state.phase === "ACTION_SELECT") {
    const summaryX = x + padding;
    const summaryW = w - padding * 2;
    const summaryY = cursorY;
    const summaryH = drawActionSummaryPanel(ctx, state, human, summaryX, summaryY, summaryW, hoveredId);
    regions.push({
      id: "action-summary",
      x: summaryX,
      y: summaryY,
      w: summaryW,
      h: summaryH,
      cursor: "help"
    });
    cursorY += summaryH + gap;
  }


  const confirmH = state.phase === "ACTION_SELECT" && state.ui.selectedAction ? 44 : 0;
  const logH = Math.max(120, y + h - cursorY - padding - confirmH - (confirmH ? gap : 0));
  drawMatchLog(ctx, state, regions, dispatch, hoveredId, x + padding, cursorY, w - padding * 2, logH);

  if (confirmH) {
    const confirmY = y + h - padding - confirmH;
    drawButton(ctx, regions, "confirm-map", x + padding, confirmY, w - padding * 2, confirmH, "Confirm Choice", () => {
      dispatch({ type: "CONFIRM_ACTION" });
    }, hoveredId === "confirm-map");
  }
}



function drawToast(ctx: CanvasRenderingContext2D, text: string, timeRemaining: number = 2.6): void {
  const { width } = ctx.canvas;
  const maxW = Math.min(720, width - 80);
  const x = width / 2 - maxW / 2;
  const baseY = 144;

  // Entrance: first 200ms (timeRemaining near 2.6 → 2.4)
  const elapsed = 2.6 - timeRemaining;
  const enterT = Math.min(1, elapsed / 0.2); // 0→1 over 200ms
  // Exit: last 300ms (timeRemaining 0.3 → 0)
  const exitT = timeRemaining < 0.3 ? timeRemaining / 0.3 : 1; // 1→0 over 300ms
  const alpha = enterT * exitT;
  const yOff = (1 - enterT) * 20 - (1 - exitT) * 20;
  const y = baseY + yOff;

  ctx.save();
  ctx.globalAlpha = alpha;
  drawPanel(ctx, x, y, maxW, 42, "rgba(18,22,30,0.86)", "#54607a");
  ctx.fillStyle = "#f5f1e6";
  ctx.textAlign = "center";
  ctx.font = "13px 'Source Serif 4', serif";
  const clipped = text.length > 110 ? text.slice(0, 107) + "..." : text;
  ctx.fillText(clipped, width / 2, y + 26);
  ctx.restore();
}

function drawAiThinkingIndicator(
  ctx: CanvasRenderingContext2D,
  message: string,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const now = performance.now();
  const pulse = 0.5 + 0.5 * Math.sin(now / 300);

  // Subtle outer glow
  ctx.save();
  ctx.shadowColor = `rgba(120,160,220,${0.15 + pulse * 0.2})`;
  ctx.shadowBlur = 8 + pulse * 6;
  drawPanel(ctx, x, y, w, h, "rgba(18,22,30,0.9)", "#4a556d");
  ctx.restore();

  // Pulsing dot
  const dotX = x + 12;
  const dotY = y + h / 2;
  const dotR = 3 + pulse * 1.5;
  ctx.beginPath();
  ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(120,180,240,${0.6 + pulse * 0.4})`;
  ctx.fill();

  // Text
  const dotsCount = Math.floor(((now % 1400) / 350));
  const dots = ".".repeat(dotsCount);
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 12px 'Source Serif 4', serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(message, x + 22, y + h / 2);
  ctx.fillText(dots, x + w - 22, y + h / 2);
}

function drawMatchLog(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId: string | undefined,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const tabW = 60;
  const tabH = 24;
  const tabX = x + w - tabW - 6;
  const tabY = y + h - tabH - 6;
  if (!state.ui.logOpen) {
    drawButton(ctx, regions, "log-open", tabX, tabY, tabW, tabH, "LOG", () => {
      dispatch({ type: "TOGGLE_LOG" });
    }, hoveredId === "log-open");
    return;
  }

  drawPanel(ctx, x, y, w, h, "rgba(15,18,26,0.85)", "#3e485c");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 14px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Match Log", x + 12, y + 22);
  drawButton(ctx, regions, "log-close", x + w - 60, y + 8, 48, 22, "Hide", () => {
    dispatch({ type: "TOGGLE_LOG" });
  }, hoveredId === "log-close");

  const headerH = 32;
  const footerH = 28;
  const bodyX = x + 14;
  const bodyY = y + headerH;
  const bodyW = w - 28;
  const bodyH = Math.max(40, h - headerH - footerH);

  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.92)";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const wrappedLines: string[] = [];
  state.log.forEach((line) => {
    wrapText(ctx, line, bodyW - 10).forEach((wrapped) => wrappedLines.push(wrapped));
  });
  const lineHeight = 18;
  const visibleLines = Math.max(1, Math.floor(bodyH / lineHeight));
  const maxOffset = Math.max(0, wrappedLines.length - visibleLines);
  let offset = Math.min(state.ui.logScroll ?? 0, maxOffset);
  const addedLines = wrappedLines.length - lastLogLineCount;
  if (addedLines > 0 && offset > 0) {
    offset = Math.min(offset + addedLines, maxOffset);
  }
  const start = Math.max(0, wrappedLines.length - visibleLines - offset);
  const visible = wrappedLines.slice(start, start + visibleLines);

  ctx.save();
  ctx.beginPath();
  ctx.rect(bodyX, bodyY, bodyW, bodyH);
  ctx.clip();
  let textY = bodyY + 4;
  const textX = bodyX + 2;
  visible.forEach((line) => {
    ctx.fillText(line, textX, textY);
    textY += lineHeight;
  });
  ctx.restore();
  lastLogLineCount = wrappedLines.length;

  const footerY = y + h - footerH + 4;
  const controlH = footerH - 6;
  const btnW = 44;
  const downX = x + w - btnW - 8;
  const upX = downX - btnW - 6;

  drawButton(ctx, regions, "log-up", upX, footerY, btnW, controlH, "Up", () => {
    dispatch({ type: "SET_LOG_SCROLL", value: offset + 3 });
  }, hoveredId === "log-up");
  drawButton(ctx, regions, "log-down", downX, footerY, btnW, controlH, "Down", () => {
    dispatch({ type: "SET_LOG_SCROLL", value: offset - 3 });
  }, hoveredId === "log-down");
  if (offset > 0) {
    drawButton(ctx, regions, "log-latest", bodyX, footerY, 74, controlH, "Latest", () => {
      dispatch({ type: "SET_LOG_SCROLL", value: 0 });
    }, hoveredId === "log-latest");
  }
}


function drawPlayerHand(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId: string | undefined,
  layout: Layout
): void {
  const player = state.players.find((p) => !p.isAI);
  if (!player) {
    return;
  }
  const challenge = state.challenge;
  const order = challenge ? (challenge.turnOrder.length > 0 ? challenge.turnOrder : challenge.order) : [];
  const activeChallengeId = order[challenge?.activeTurnIndex ?? 0];
  const isHumanCommitTurn =
    state.phase === "CHALLENGE" &&
    challenge?.phase === "COMMIT_TURNS" &&
    !!challenge?.contestants.includes(player.id) &&
    activeChallengeId === player.id;
  const isChallengeCommit =
    state.phase === "CHALLENGE" && challenge?.phase === "COMMIT_TURNS" && !!challenge?.contestants.includes(player.id);
  const isChallengeView = state.phase === "CHALLENGE" && !!challenge;
  const isHumanTurn = state.phase === "ACTION_SELECT" || isHumanCommitTurn;
  const canDragChallengeCard = isHumanCommitTurn;
  const handDock = layout.handDock;
  const gap = 12;
  const cardW = 150;
  const hiddenCounts = new Map<string, number>();
  if (challenge && challenge.contestants.includes(player.id)) {
    const played = challenge.played[player.id];
    if (played) {
      played.selected.forEach((cardId) => hiddenCounts.set(cardId, (hiddenCounts.get(cardId) ?? 0) + 1));
    }
  }
  if (state.phase === "CHALLENGE" && challenge?.phase === "COMMIT_TURNS" && isHumanCommitTurn) {
    state.ui.selectedCards.forEach((idx) => {
      const cardId = player.hand[idx];
      if (cardId) hiddenCounts.set(cardId, (hiddenCounts.get(cardId) ?? 0) + 1);
    });
  }

  const visibleCards: { cardId: string; idx: number }[] = [];
  player.hand.forEach((cardId, idx) => {
    const count = hiddenCounts.get(cardId) ?? 0;
    if (count > 0) {
      hiddenCounts.set(cardId, count - 1);
      return;
    }
    visibleCards.push({ cardId, idx });
  });

  const playedInChallenge = challenge?.played?.[player.id];
  const committedCount = (playedInChallenge?.selected?.length ?? 0) + (playedInChallenge?.spellsPlayed?.length ?? 0);
  const canUseChallengeSpell = isChallengeCommit && isHumanCommitTurn && committedCount < CHALLENGE_COMMIT_MAX;
  const pendingSpellCounts = new Map<string, number>();
  if (state.ui.pendingSpellId && isChallengeCommit) {
    pendingSpellCounts.set(state.ui.pendingSpellId, 1);
  }
  const visibleSpells = player.spells.filter((spellId) => {
    const pending = pendingSpellCounts.get(spellId) ?? 0;
    if (pending > 0) {
      pendingSpellCounts.set(spellId, pending - 1);
      return false;
    }
    return true;
  });

  if (isChallengeView) {
    // During challenges, the sidebar extends to the bottom. Constrain hand dock width.
    const challengeSidebarW = ctx.canvas.width < 1200 ? 340 : ctx.canvas.width < 1400 ? 380 : 420;
    const panelPad = 12;
    const panelGap = 12;
    const panelX = handDock.x + panelGap;
    const panelY = handDock.y + 8;
    const panelW = handDock.w - panelGap * 2 - challengeSidebarW - 8;
    const panelH = handDock.h - 16;
    const headerH = 38;
    const cardH = Math.min(190, panelH - headerH - 12);
    const tabGap = 6;
    const tabW = Math.max(56, Math.floor((panelW - 24 - tabGap * 3) / 4));
    const tabRowW = tabW * 4 + tabGap * 3;
    const tabsX = panelX + panelW - tabRowW - 12;
    const tabY = panelY + 6;
    const activeTabRaw: HandTab = state.ui.handTab ?? "ALL";
    const activeTab: HandTab = activeTabRaw === "SPELLS" ? "INVOCATIONS" : activeTabRaw;
    const totalCount = visibleCards.length + visibleSpells.length;
    const tabDefs = [
      { tab: "ALL" as HandTab, label: "All", count: totalCount },
      { tab: "CARDS" as HandTab, label: "Game Cards", count: visibleCards.length },
      { tab: "INVOCATIONS" as HandTab, label: "Invocations", count: visibleSpells.length }
    ];

    drawPanel(ctx, panelX, panelY, panelW, panelH, "rgba(12,16,24,0.9)", "#2e394f");
    ctx.fillStyle = "#f5f1e6";
    ctx.font = "700 12px 'Cinzel', serif";
    ctx.textAlign = "left";
    ctx.fillText("HAND", panelX + 12, panelY + 22);

    tabDefs.forEach((tab, idx) => {
      const x = tabsX + idx * (tabW + tabGap);
      const id = `hand-tab-${tab.tab.toLowerCase()}`;
      const disabled = tab.tab !== "ALL" && tab.count === 0;
      drawHandTabButton(
        ctx,
        regions,
        id,
        x,
        tabY,
        tabW,
        24,
        tab.label,
        activeTab === tab.tab,
        disabled,
        hoveredId === id,
        () => dispatch({ type: "SET_HAND_TAB", tab: tab.tab })
      );
    });

    const handAreaX = panelX + panelPad;
    const handAreaW = panelW - panelPad * 2;
    const handAreaY = panelY + headerH;
    const handAreaH = panelH - headerH - 8;
    const magicStyle = "invocation";

    type HandItem =
      | { kind: "card"; cardId: string; idx: number }
      | { kind: "spell"; spellId: string; idx: number };

    let items: HandItem[] = [];
    if (activeTab === "CARDS") {
      items = visibleCards.map((entry) => ({ kind: "card", ...entry }));
    } else if (activeTab === "INVOCATIONS") {
      items = visibleSpells.map((spellId, idx) => ({ kind: "spell", spellId, idx }));
    } else {
      items = [
        ...visibleCards.map((entry) => ({ kind: "card", ...entry })),
        ...visibleSpells.map((spellId, idx) => ({ kind: "spell", spellId, idx }))
      ];
    }

    const totalW = items.length > 0 ? items.length * (cardW + gap) - gap : 0;
    const maxScroll = Math.max(0, totalW - handAreaW);
    const scrollX = Math.max(0, Math.min(state.ui.handScroll ?? 0, maxScroll));
    const startX = handAreaX - scrollX;
    const showScroll = totalW > handAreaW;

    if (showScroll) {
      const scrollY = handAreaY + Math.max(0, Math.floor((cardH - 36) / 2));
      drawButton(ctx, regions, "hand-scroll-left", handAreaX + 6, scrollY, 28, 36, "<", () => {
        dispatch({ type: "SET_HAND_SCROLL", value: scrollX - 160 });
      }, hoveredId === "hand-scroll-left");
      drawButton(ctx, regions, "hand-scroll-right", handAreaX + handAreaW - 34, scrollY, 28, 36, ">", () => {
        dispatch({ type: "SET_HAND_SCROLL", value: scrollX + 160 });
      }, hoveredId === "hand-scroll-right");
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(handAreaX, handAreaY, handAreaW, handAreaH);
    ctx.clip();

    items.forEach((entry, visibleIndex) => {
      const x = startX + visibleIndex * (cardW + gap);
      const y = handAreaY;
      if (entry.kind === "card") {
        const card = dataStore.cardsById[entry.cardId];
        if (!card) return;
        const id = `hand-${entry.cardId}-${entry.idx}`;
        const hovered = hoveredId === id;
        const isSelected = state.ui.selectedCards.includes(entry.idx);
        drawCard(ctx, card, x, y, cardW, cardH, hovered || isSelected, false);
        if (hovered) {
          const tags = card.tags?.length ? `Tags: ${card.tags.join(", ")}` : "";
          queueHoverTip(
            id,
            [
              `${card.name} (${card.basePower} AP)`,
              `Color: ${card.color}`,
              tags,
              "Sell: 1 Crystal"
            ].filter(Boolean),
            x - 40,
            y - 90
          );
        }
        regions.push({
          id,
          x,
          y,
          w: cardW,
          h: cardH,
          onClick: () => {
            if (challenge?.phase === "COMMIT_TURNS" && isHumanCommitTurn) {
              dispatch({ type: "SELECT_CARD", cardIndex: entry.idx });
            }
          },
          dragPayload: canDragChallengeCard ? ({ kind: "hand-card", cardIndex: entry.idx } as DragPayload) : undefined,
          cursor: challenge?.phase === "COMMIT_TURNS" ? (canDragChallengeCard ? "grab" : "pointer") : "default"
        });
        return;
      }

      const spell = dataStore.spellsById[entry.spellId];
      if (!spell) return;
      const id = `hand-spell-${entry.spellId}-${entry.idx}`;
      const hovered = hoveredId === id;
      const isPending = state.ui.pendingSpellId === entry.spellId && isHumanCommitTurn;
      drawMagicHandCard(ctx, entry.spellId, x, y, cardW, cardH, magicStyle, isPending, hovered);
      if (hovered) {
        const rulesText = spell.rulesText ?? spell.description ?? "";
        queueHoverTip(id, [`${spell.name} (${spell.value} AP)`, rulesText, "Sell: 1 Crystal"], x - 40, y - 90);
      }
      regions.push({
        id,
        x,
        y,
        w: cardW,
        h: cardH,
        onClick: () => {
          if (challenge?.phase === "COMMIT_TURNS" && isHumanCommitTurn) {
            if (!canUseChallengeSpell) return;
            dispatch({ type: "SET_PENDING_SPELL", spellId: entry.spellId });
          }
        },
        dragPayload: canUseChallengeSpell ? ({ kind: "spell", spellId: entry.spellId } as DragPayload) : undefined,
        cursor: isHumanCommitTurn ? (canUseChallengeSpell ? "grab" : "pointer") : "default"
      });
    });

    if (items.length === 0) {
      ctx.fillStyle = "rgba(245,241,230,0.65)";
      ctx.font = "12px 'Source Serif 4', serif";
      ctx.textAlign = "center";
      const label =
        activeTab === "CARDS"
          ? "No Game Cards available."
          : activeTab === "INVOCATIONS"
            ? "No Invocations available."
            : "No playables available.";
      ctx.fillText(label, handAreaX + handAreaW / 2, handAreaY + cardH / 2);
    }

    ctx.restore();
    return;
  }

  const panelPad = 12;
  const panelGap = 12;
  const sideW = ctx.canvas.width < 1400 ? 260 : 300;
  const handPanelX = handDock.x + panelGap;
  const handPanelY = handDock.y + 8;
  const handPanelW = handDock.w - sideW - panelGap * 2;
  const handPanelH = handDock.h - 16;
  const earthX = handPanelX + handPanelW + panelGap;
  const earthY = handPanelY;
  const earthW = sideW;
  const earthH = handPanelH;
  const headerH = 38;
  const cardH = Math.min(190, handPanelH - headerH - 12);
  const tabGap = 6;
  const tabW = Math.max(90, Math.floor((handPanelW - 24 - tabGap * 2) / 3));
  const tabRowW = tabW * 3 + tabGap * 2;
  const tabsX = handPanelX + handPanelW - tabRowW - 12;
  const tabY = handPanelY + 6;
  const activeTabRaw: HandTab = state.ui.handTab ?? "ALL";
  const activeTab: HandTab = activeTabRaw === "SPELLS" ? "INVOCATIONS" : activeTabRaw;

  drawPanel(ctx, handPanelX, handPanelY, handPanelW, handPanelH, "rgba(12,16,24,0.9)", "#2e394f");
  drawPanel(ctx, earthX, earthY, earthW, earthH, "rgba(12,16,24,0.9)", "#2e394f");

  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 12px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText("HAND", handPanelX + 12, handPanelY + 22);

  const tabDefs = [
    { tab: "ALL" as HandTab, label: "All", count: visibleCards.length + visibleSpells.length },
    { tab: "CARDS" as HandTab, label: "Game Cards", count: visibleCards.length },
    { tab: "INVOCATIONS" as HandTab, label: "Invocations", count: visibleSpells.length }
  ];
  tabDefs.forEach((tab, idx) => {
    const x = tabsX + idx * (tabW + tabGap);
    const id = `hand-tab-main-${tab.tab.toLowerCase()}`;
    const disabled = tab.tab !== "ALL" && tab.count === 0;
    drawHandTabButton(
      ctx,
      regions,
      id,
      x,
      tabY,
      tabW,
      24,
      tab.label,
      activeTab === tab.tab,
      disabled,
      hoveredId === id,
      () => dispatch({ type: "SET_HAND_TAB", tab: tab.tab })
    );
  });

  const earthCount =
    player.earthAdvancementsT1.length + player.earthAdvancementsT2.length + player.earthAdvancementsT3.length;
  drawHudPanelHeader(ctx, earthX, earthY, earthW, "Earth Advancements", earthCount);

  const handAreaX = handPanelX + panelPad;
  const handAreaW = handPanelW - panelPad * 2;
  const handAreaY = handPanelY + headerH;
  const handAreaH = handPanelH - headerH - 8;
  const magicStyle = "invocation";

  type HandItem =
    | { kind: "card"; cardId: string; idx: number }
    | { kind: "spell"; spellId: string; idx: number };

  let items: HandItem[] = [];
  if (activeTab === "CARDS") {
    items = visibleCards.map((entry) => ({ kind: "card", ...entry }));
  } else if (activeTab === "INVOCATIONS") {
    items = visibleSpells.map((spellId, idx) => ({ kind: "spell", spellId, idx }));
  } else {
    items = [
      ...visibleCards.map((entry) => ({ kind: "card", ...entry })),
      ...visibleSpells.map((spellId, idx) => ({ kind: "spell", spellId, idx }))
    ];
  }

  const totalW = items.length > 0 ? items.length * (cardW + gap) - gap : 0;
  const maxScroll = Math.max(0, totalW - handAreaW);
  const scrollX = Math.max(0, Math.min(state.ui.handScroll ?? 0, maxScroll));
  const startX = handAreaX - scrollX;
  const showScroll = totalW > handAreaW;

  if (showScroll) {
    const scrollY = handAreaY + Math.max(0, Math.floor((cardH - 36) / 2));
    drawButton(ctx, regions, "hand-scroll-left", handAreaX + 6, scrollY, 28, 36, "<", () => {
      dispatch({ type: "SET_HAND_SCROLL", value: scrollX - 160 });
    }, hoveredId === "hand-scroll-left");
    drawButton(ctx, regions, "hand-scroll-right", handAreaX + handAreaW - 34, scrollY, 28, 36, ">", () => {
      dispatch({ type: "SET_HAND_SCROLL", value: scrollX + 160 });
    }, hoveredId === "hand-scroll-right");
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(handAreaX, handAreaY, handAreaW, handAreaH);
  ctx.clip();

  items.forEach((entry, visibleIndex) => {
    const x = startX + visibleIndex * (cardW + gap);
    const y = handAreaY;
    if (entry.kind === "card") {
      const card = dataStore.cardsById[entry.cardId];
      if (!card) return;
      const id = `hand-${entry.cardId}-${entry.idx}`;
      const hovered = hoveredId === id;
      drawCard(ctx, card, x, y, cardW, cardH, hovered, false);
      if (hovered) {
        const tags = card.tags?.length ? `Tags: ${card.tags.join(", ")}` : "";
        queueHoverTip(
          id,
          [
            `${card.name} (${card.basePower} AP)`,
            `Color: ${card.color}`,
            tags,
            "Sell: 1 Crystal"
          ].filter(Boolean),
          x - 40,
          y - 90
        );
      }
      regions.push({
        id,
        x,
        y,
        w: cardW,
        h: cardH,
        onClick: () => {
          if (state.phase === "ACTION_SELECT" && state.ui.shopOpen && isHumanTurn) {
            dispatch({ type: "UI_REQUEST_SELL", kind: "HAND_CARD", index: entry.idx });
          }
        },
        cursor: state.phase === "ACTION_SELECT" && state.ui.shopOpen && isHumanTurn ? "pointer" : "default"
      });
      return;
    }

    const spell = dataStore.spellsById[entry.spellId];
    if (!spell) return;
    const id = `hand-spell-${entry.spellId}-${entry.idx}`;
    const hovered = hoveredId === id;
    drawMagicHandCard(ctx, entry.spellId, x, y, cardW, cardH, magicStyle, false, hovered);
    if (hovered) {
      const rulesText = spell.rulesText ?? spell.description ?? "";
      queueHoverTip(id, [`${spell.name} (${spell.value} AP)`, rulesText, "Use: Challenge only", "Sell: 1 Crystal"], x - 40, y - 90);
    }
    regions.push({
      id,
      x,
      y,
      w: cardW,
      h: cardH,
      onClick: () => {
        if (state.phase === "ACTION_SELECT" && state.ui.shopOpen && isHumanTurn) {
          dispatch({ type: "UI_REQUEST_SELL", kind: "SPELL", index: entry.idx });
        }
      },
      cursor: state.phase === "ACTION_SELECT" && state.ui.shopOpen && isHumanTurn ? "pointer" : "default"
    });
  });

  if (items.length === 0) {
    ctx.fillStyle = "rgba(245,241,230,0.65)";
    ctx.font = "12px 'Source Serif 4', serif";
    ctx.textAlign = "center";
    const label =
      activeTab === "CARDS"
        ? "No Game Cards available."
        : activeTab === "INVOCATIONS"
          ? "No Invocations available."
          : "No cards or invocations available.";
    ctx.fillText(label, handAreaX + handAreaW / 2, handAreaY + cardH / 2);
  }

  ctx.restore();

  drawEarthPanelSmall(ctx, state, regions, dispatch, hoveredId, earthX + panelPad, earthY + 34, earthW - panelPad * 2, earthH - 44);
}

function drawHudPanelHeader(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, title: string, count: number): void {
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 12px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText(title, x + 10, y + 18);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(245,241,230,0.75)";
  ctx.fillText(`(${count})`, x + w - 10, y + 18);
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 26);
  ctx.lineTo(x + w - 8, y + 26);
  ctx.stroke();
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

function drawSpellsPanel(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId: string | undefined,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const player = state.players.find((p) => !p.isAI);
  if (!player || w <= 0 || h <= 0) {
    return;
  }
  const pillH = 38;
  const gap = 8;
  const order = state.challenge ? (state.challenge.turnOrder.length > 0 ? state.challenge.turnOrder : state.challenge.order) : [];
  const activeChallengeId = order[state.challenge?.activeTurnIndex ?? 0];
  const isChallengeCommit = state.phase === "CHALLENGE" && state.challenge?.phase === "COMMIT_TURNS" && !!state.challenge?.contestants.includes(player.id);
  const isHumanTurn = isChallengeCommit && activeChallengeId === player.id;
  const canSell = state.phase === "ACTION_SELECT" && !!state.ui.shopOpen;
  const committedCount = (state.challenge?.played?.[player.id]?.selected?.length ?? 0) + (state.challenge?.played?.[player.id]?.spellsPlayed?.length ?? 0);
  // In the sequential beat commit flow, the player may switch freely between selecting a Card or an Invocation.
  // Selection exclusivity is enforced in the reducer (selecting one clears the other).
  const canUseChallengeSpell = isChallengeCommit && isHumanTurn && committedCount < CHALLENGE_COMMIT_MAX;
  const canDragSpell = canUseChallengeSpell;
  const pendingSpellCounts = new Map<string, number>();
  if (state.ui.pendingSpellId && isChallengeCommit) {
    pendingSpellCounts.set(state.ui.pendingSpellId, 1);
  }

  const entries = player.spells.filter((spellId) => {
    const pending = pendingSpellCounts.get(spellId) ?? 0;
    if (pending > 0) {
      pendingSpellCounts.set(spellId, pending - 1);
      return false;
    }
    return true;
  });

  const totalH = entries.length > 0 ? entries.length * (pillH + gap) - gap : 0;
  const showScroll = totalH > h;
  const listH = h - (showScroll ? 26 : 0);
  const visibleCount = Math.max(1, Math.floor((listH + gap) / (pillH + gap)));
  const maxOffset = Math.max(0, entries.length - visibleCount);
  const offset = Math.min(state.ui.spellScroll ?? 0, maxOffset);
  const startIndex = offset;
  const visible = entries.slice(startIndex, startIndex + visibleCount);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, listH);
  ctx.clip();
  let cursorY = y;
  visible.forEach((spellId, idx) => {
    const spell = dataStore.spellsById[spellId];
    if (!spell) {
      return;
    }
    const label = clampToWidth(ctx, `Invocation: ${spell.name} (${spell.value})`, w - 12);
    const id = `spell-panel-${spellId}-${startIndex + idx}`;
    drawPill(ctx, label, x, cursorY, w, pillH, "spell", hoveredId === id);
    if (hoveredId === id) {
      const rulesText = spell.rulesText ?? spell.description ?? "";
      queueHoverTip(id, [`${spell.name} (${spell.value} AP)`, rulesText, "Sell: 1 Crystal"], x + w + 8, cursorY - 10);
    }
    regions.push({
      id,
      x,
      y: cursorY,
      w,
      h: pillH,
      onClick: () => {
        if (!isHumanTurn && !canSell) return;
        if (isChallengeCommit && !canUseChallengeSpell) return;
        if (state.phase === "ACTION_SELECT" && state.ui.shopOpen) {
          const index = player.spells.indexOf(spellId);
          if (index >= 0) {
            dispatch({ type: "UI_REQUEST_SELL", kind: "SPELL", index });
          }
          return;
        }
        if (isChallengeCommit) {
          dispatch({ type: "SET_PENDING_SPELL", spellId });
        }
      },
      dragPayload: canDragSpell ? ({ kind: "spell", spellId } as DragPayload) : undefined,
      cursor: (isHumanTurn && isChallengeCommit) || canSell ? (canDragSpell ? "grab" : "pointer") : "default"
    });
    cursorY += pillH + gap;
  });
  ctx.restore();

  if (showScroll) {
    const btnW = 44;
    const btnH = 20;
    const btnY = y + listH + 4;
    drawButton(ctx, regions, "spell-scroll-up", x, btnY, btnW, btnH, "Up", () => {
      dispatch({ type: "SET_SPELL_SCROLL", value: offset - 1 });
    }, hoveredId === "spell-scroll-up");
    drawButton(ctx, regions, "spell-scroll-down", x + btnW + 6, btnY, btnW, btnH, "Down", () => {
      dispatch({ type: "SET_SPELL_SCROLL", value: offset + 1 });
    }, hoveredId === "spell-scroll-down");
  }
}

function drawEarthPanelSmall(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId: string | undefined,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const player = state.players.find((p) => !p.isAI);
  if (!player || w <= 0 || h <= 0) {
    return;
  }
  const ids = [...player.earthAdvancementsT1, ...player.earthAdvancementsT2, ...player.earthAdvancementsT3];
  const rowH = 48;
  const gap = 6;
  const totalH = ids.length > 0 ? ids.length * (rowH + gap) - gap : 0;
  const showScroll = totalH > h;
  const listH = h - (showScroll ? 26 : 0);
  const visibleCount = Math.max(1, Math.floor((listH + gap) / (rowH + gap)));
  const maxOffset = Math.max(0, ids.length - visibleCount);
  const offset = Math.min(state.ui.earthScroll ?? 0, maxOffset);
  const startIndex = offset;
  const visible = ids.slice(startIndex, startIndex + visibleCount);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, listH);
  ctx.clip();
  // Ensure text alignment is stable (some prior UI draws use centered text).
  ctx.textAlign = "left";
  let cursorY = y;
  visible.forEach((id, idx) => {
    const card = dataStore.earthAdvancements.find((c) => c.id === id);
    if (!card) return;
    drawPanel(ctx, x, cursorY, w, rowH - 4, "rgba(24,30,40,0.85)", "#46546b");
    ctx.fillStyle = "#f5f1e6";
    ctx.font = "12px 'Source Serif 4', serif";
    ctx.fillText(card.name, x + 8, cursorY + 16);
    ctx.font = "11px 'Source Serif 4', serif";
    const details = `Tier ${card.tier} | Cost ${formatCrystals(card.costCrystals)} | AP ${earthAdvancementAp(card)}`;
    const line = wrapText(ctx, details, w - 16)[0] ?? details;
    ctx.fillStyle = "rgba(245,241,230,0.8)";
    ctx.fillText(line, x + 8, cursorY + 32);

    const tipId = `earth-small-${startIndex + idx}`;
    if (hoveredId === tipId) {
      const full = [
        card.name,
        `Tier ${card.tier} | Cost ${formatCrystals(card.costCrystals)} | AP ${earthAdvancementAp(card)}`,
        rewardSummary(card.rewards)
      ];
      queueHoverTip(tipId, full, x + w + 8, cursorY - 10);
    }
    regions.push({
      id: tipId,
      x,
      y: cursorY,
      w,
      h: rowH - 4,
      onClick: () => {},
      cursor: "default"
    });
    cursorY += rowH + gap;
  });
  ctx.restore();

  if (showScroll) {
    const btnW = 44;
    const btnH = 20;
    const btnY = y + listH + 4;
    drawButton(ctx, regions, "earth-scroll-up", x, btnY, btnW, btnH, "Up", () => {
      dispatch({ type: "SET_EARTH_SCROLL", value: offset - 1 });
    }, hoveredId === "earth-scroll-up");
    drawButton(ctx, regions, "earth-scroll-down", x + btnW + 6, btnY, btnW, btnH, "Down", () => {
      dispatch({ type: "SET_EARTH_SCROLL", value: offset + 1 });
    }, hoveredId === "earth-scroll-down");
  }
}

function drawSpellTeachingRow(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId: string | undefined,
  x: number,
  y: number,
  maxW: number
): void {
  const player = state.players.find((p) => !p.isAI);
  if (!player) {
    return;
  }
  if (maxW <= 0) {
    return;
  }
  const pillH = 30;
  const gap = 8;
  ctx.font = "11px 'Source Serif 4', serif";
  let cursorX = x;
  const endX = x + maxW;
  const order = state.challenge ? (state.challenge.turnOrder.length > 0 ? state.challenge.turnOrder : state.challenge.order) : [];
  const activeChallengeId = order[state.challenge?.activeTurnIndex ?? 0];
  const isChallengeCommit = state.phase === "CHALLENGE" && state.challenge?.phase === "COMMIT_TURNS" && !!state.challenge?.contestants.includes(player.id);
  const isHumanTurn = isChallengeCommit && activeChallengeId === player.id;
  const canSellTeaching = state.phase === "ACTION_SELECT" && !!state.ui.shopOpen;
  const playedInChallenge = state.challenge?.played[player.id];
  const committedCount = (playedInChallenge?.selected?.length ?? 0) + (playedInChallenge?.spellsPlayed?.length ?? 0);
  // Allow selecting an Invocation at any time during commit; reducer enforces exclusivity with card selection.
  const canUseChallengeSpell = isChallengeCommit && isHumanTurn && committedCount < CHALLENGE_COMMIT_MAX;
  const canDragSpell = canUseChallengeSpell;
  const canSell = state.phase === "ACTION_SELECT" && !!state.ui.shopOpen;
  const pendingSpellCounts = new Map<string, number>();
  if (state.ui.pendingSpellId && isChallengeCommit) {
    pendingSpellCounts.set(state.ui.pendingSpellId, 1);
  }

  player.spells.forEach((spellId, idx) => {
    const pendingCount = pendingSpellCounts.get(spellId) ?? 0;
    if (pendingCount > 0) {
      pendingSpellCounts.set(spellId, pendingCount - 1);
      return;
    }
    const spell = dataStore.spellsById[spellId];
    if (!spell) {
      return;
    }
    const label = `Invocation: ${spell.name} (${spell.value})`;
    const available = endX - cursorX;
    if (available < 60) {
      return;
    }
    const pillW = Math.max(60, Math.min(200, ctx.measureText(label).width + 24, available));
    if (cursorX + pillW > endX) {
      return;
    }
    const id = `spell-${spellId}-${idx}`;
    drawPill(ctx, label, cursorX, y, pillW, pillH, "spell", hoveredId === id);
    if (hoveredId === id) {
      const rulesText = spell.rulesText ?? spell.description ?? "";
      queueHoverTip(id, [`${spell.name} (${spell.value} AP)`, rulesText, "Sell: 1 Crystal"], cursorX - 40, y - 70);
    }
    regions.push({
      id,
      x: cursorX,
      y,
      w: pillW,
      h: pillH,
      onClick: () => {
        if (!isHumanTurn && !canSell) return;
        if (!canUseChallengeSpell && isChallengeCommit) {
          return;
        }
        if (state.phase === "ACTION_SELECT" && state.ui.shopOpen) {
          dispatch({ type: "UI_REQUEST_SELL", kind: "SPELL", index: idx });
          return;
        }
        if (isChallengeCommit) {
          dispatch({ type: "SET_PENDING_SPELL", spellId });
        }
      },
      dragPayload: canDragSpell ? ({ kind: "spell", spellId } as DragPayload) : undefined,
      cursor:
        (isHumanTurn && isChallengeCommit) || canSell
          ? (canDragSpell ? "grab" : "pointer")
          : "default"
    });
    cursorX += pillW + gap;
  });

  player.teachings.forEach((teachingId, idx) => {
    const teaching = dataStore.teachingsById[teachingId];
    if (!teaching) {
      return;
    }
    const label = `Teaching: ${teaching.name}`;
    const available = endX - cursorX;
    if (available < 60) {
      return;
    }
    const pillW = Math.max(60, Math.min(200, ctx.measureText(label).width + 24, available));
    if (cursorX + pillW > endX) {
      return;
    }
    const id = `teach-${teachingId}-${idx}`;
    drawPill(ctx, label, cursorX, y, pillW, pillH, "teaching", hoveredId === id);
    if (hoveredId === id) {
      queueHoverTip(id, buildTeachingTooltipLines(teaching), cursorX - 40, y - 70, 300, 260);
    }
    const canPlay = isHumanTurn;
    regions.push({
      id,
      x: cursorX,
      y,
      w: pillW,
      h: pillH,
      onClick: () => {
        const canSellThisTeaching = canSellTeaching && teaching.tier !== "basic";
        if (canSellThisTeaching) {
          dispatch({ type: "UI_REQUEST_SELL", kind: "TEACHING", index: idx });
          return;
        }
        if (canPlay) {
          dispatch({ type: "PLAY_TEACHING", teachingId });
        }
      },
      cursor: canPlay || (canSellTeaching && teaching.tier !== "basic") ? "pointer" : "default"
    });
    cursorX += pillW + gap;
  });
}

function drawSmallCard(
  ctx: CanvasRenderingContext2D,
  type: "spell" | "artifact" | "teaching",
  label: string,
  value: number,
  x: number,
  y: number,
  w: number,
  h: number,
  hovered: boolean
): void {
  const palette = type === "spell"
    ? { top: "#335a8c", bottom: "#1c2f4b", stroke: "#79b7ff" }
    : type === "artifact"
      ? { top: "#5a4a33", bottom: "#3b2f22", stroke: "#d1b27a" }
      : { top: "#2c6e62", bottom: "#1b453d", stroke: "#7ed9c4" };
  drawCardFrame(ctx, x, y, w, h, palette, hovered);
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "11px 'Source Serif 4', serif";
  ctx.textAlign = "center";
  ctx.fillText(label, x + w / 2, y + h / 2);
  if (value > 0) {
    ctx.font = "600 11px 'Cinzel', serif";
    ctx.fillText(String(value), x + w - 10, y + h - 10);
  }
}

function truncateLabel(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

function drawInitiativeDie(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  value: number,
  rolling: boolean,
  seed: number
): void {
  const wobble = rolling ? Math.sin(performance.now() / 90 + seed) * 0.13 : 0;
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(wobble);
  ctx.translate(-size / 2, -size / 2);
  drawRoundedRect(ctx, 0, 0, size, size, 9);
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, rolling ? "rgba(80,110,150,0.95)" : "rgba(54,66,86,0.95)");
  grad.addColorStop(1, rolling ? "rgba(38,54,84,0.95)" : "rgba(28,36,52,0.95)");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = rolling ? 2.2 : 1.6;
  ctx.strokeStyle = rolling ? "rgba(130,190,255,0.9)" : "rgba(115,135,165,0.8)";
  ctx.stroke();

  const pipColor = "rgba(245,241,230,0.95)";
  const pip = (px: number, py: number): void => {
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2.6, size * 0.065), 0, Math.PI * 2);
    ctx.fillStyle = pipColor;
    ctx.fill();
  };
  const xl = size * 0.27;
  const xc = size * 0.5;
  const xr = size * 0.73;
  const yt = size * 0.27;
  const yc = size * 0.5;
  const yb = size * 0.73;
  const face = Math.max(1, Math.min(6, Math.round(value)));
  if (face === 1) {
    pip(xc, yc);
  } else if (face === 2) {
    pip(xl, yt); pip(xr, yb);
  } else if (face === 3) {
    pip(xl, yt); pip(xc, yc); pip(xr, yb);
  } else if (face === 4) {
    pip(xl, yt); pip(xr, yt); pip(xl, yb); pip(xr, yb);
  } else if (face === 5) {
    pip(xl, yt); pip(xr, yt); pip(xc, yc); pip(xl, yb); pip(xr, yb);
  } else {
    pip(xl, yt); pip(xr, yt); pip(xl, yc); pip(xr, yc); pip(xl, yb); pip(xr, yb);
  }
  ctx.restore();
}

function drawChallengeInitiativePopup(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  challenge: ChallengeState,
  regions: HitRegion[],
  hoveredId: string | undefined,
  dispatch: (action: GameAction) => void,
  challengeKey: string
): void {
  const now = performance.now();
  const participants = challenge.participants;
  if (participants.length === 0) return;
  // Modal blocker (prevents interacting with the board while reading the order).
  regions.push({
    id: "initiative-popup-blocker",
    x: 0,
    y: 0,
    w: ctx.canvas.width,
    h: ctx.canvas.height,
    onClick: () => {},
    onDrop: () => {},
    cursor: "default"
  });

  const playersById = new Map(state.players.map((p) => [p.id, p]));
  const rolledIds = participants.filter((id) => challenge.rolls[id] !== null);
  const provisionalOrder = [...rolledIds].sort((a, b) => (challenge.rolls[a] ?? 0) - (challenge.rolls[b] ?? 0));
  const finalOrder = challenge.turnOrder.length > 0 ? challenge.turnOrder : provisionalOrder;
  const rankById = new Map<string, number>();
  finalOrder.forEach((id, idx) => rankById.set(id, idx + 1));
  const firstActingId = finalOrder[0];
  const nextRollerId = challenge.phase === "ROLL_ORDER" ? challenge.rollQueue?.[0] : undefined;

  const cols = Math.max(1, Math.min(3, participants.length));
  const rows = Math.ceil(participants.length / cols);
  const cardGap = 10;
  const cardH = 94;
  const footerH = 78;
  const panelW = Math.min(820, ctx.canvas.width - 80);
  const panelH = 118 + rows * cardH + Math.max(0, rows - 1) * cardGap + footerH;
  const panelX = Math.floor((ctx.canvas.width - panelW) / 2);
  const panelY = Math.floor((ctx.canvas.height - panelH) / 2);
  const innerX = panelX + 16;
  const innerY = panelY + 16;
  const innerW = panelW - 32;
  const cardsY = innerY + 58;
  const cardW = Math.floor((innerW - (cols - 1) * cardGap) / cols);

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  drawRoundedRect(ctx, panelX, panelY, panelW, panelH, 14);
  const panelGrad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
  panelGrad.addColorStop(0, "rgba(14,20,34,0.98)");
  panelGrad.addColorStop(1, "rgba(9,13,24,0.98)");
  ctx.fillStyle = panelGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(104,129,166,0.9)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const rollingPhase = challenge.phase === "ROLL_ORDER";
  ctx.fillStyle = "#f5f1e6";
  ctx.textAlign = "left";
  ctx.font = "700 20px 'Cinzel', serif";
  ctx.fillText(rollingPhase ? "Initiative Roll" : "Turn Order Locked", innerX, innerY + 20);
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.78)";
  ctx.fillText("Lowest roll acts first. Highest roll acts last.", innerX, innerY + 40);

  participants.forEach((playerId, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const x = innerX + col * (cardW + cardGap);
    const y = cardsY + row * (cardH + cardGap);
    const rollVal = challenge.rolls[playerId];
    const rank = rankById.get(playerId);
    const isRolling = rollVal === null && rollingPhase;
    const isNextRoller = nextRollerId === playerId && rollingPhase;
    const dieFace = isRolling ? (1 + Math.floor(((now / 70) + idx * 1.9) % 6)) : Math.max(1, Math.min(6, Math.round(rollVal ?? 1)));
    const player = playersById.get(playerId);
    const playerName = player?.name ?? playerId;
    const isFirst = firstActingId === playerId && !!firstActingId;
    const border = isFirst ? "#f0d88c" : isNextRoller ? "#8bc5ff" : "rgba(82,98,124,0.95)";
    const fill = isFirst ? "rgba(48,42,28,0.8)" : isNextRoller ? "rgba(22,34,54,0.8)" : "rgba(18,24,38,0.82)";
    drawPanel(ctx, x, y, cardW, cardH, fill, border);

    drawInitiativeDie(ctx, x + 10, y + 12, 40, dieFace, isRolling, idx * 1.7);

    ctx.textAlign = "left";
    ctx.fillStyle = "#f5f1e6";
    ctx.font = "600 12px 'Cinzel', serif";
    ctx.fillText(truncateLabel(playerName, 18), x + 58, y + 24);
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.fillStyle = isRolling ? "rgba(170,214,255,0.95)" : "rgba(245,241,230,0.8)";
    const rollLabel = rollVal === null ? (isNextRoller ? "Rolling now..." : "Waiting...") : `Roll: ${rollVal}`;
    ctx.fillText(rollLabel, x + 58, y + 44);
    if (rank !== undefined) {
      ctx.fillStyle = isFirst ? "#f0d88c" : "rgba(197,219,255,0.9)";
      ctx.fillText(isFirst ? `#${rank} - acts first` : `#${rank} in order`, x + 58, y + 62);
    }
  });

  ctx.textAlign = "center";
  ctx.font = "600 12px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.86)";
  const orderY = panelY + panelH - footerH + 18;
  if (finalOrder.length > 0) {
    const line = finalOrder.map((id) => playersById.get(id)?.name ?? id).join("  ->  ");
    ctx.fillText(`Order: ${line}`, panelX + panelW / 2, orderY);
  } else {
    ctx.fillText("Rolling in progress...", panelX + panelW / 2, orderY);
  }

  // Resume button (dismiss roll popup, or resume commit phase once order is locked).
  const resumeId = "initiative-popup-resume";
  const btnW = 180;
  const btnH = 40;
  const btnX = panelX + panelW - btnW - 18;
  const btnY = panelY + panelH - btnH - 16;
  ctx.textAlign = "left";
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.72)";
  const hint = rollingPhase ? "You can resume anytime." : "Order is set. Resume to play.";
  ctx.fillText(hint, innerX, btnY + btnH / 2 + 2);
  drawButton(
    ctx,
    regions,
    resumeId,
    btnX,
    btnY,
    btnW,
    btnH,
    "RESUME",
    () => {
      if (rollingPhase) {
        initiativeRollPopupDismissedKey = challengeKey;
        return;
      }
      dispatch({ type: "CHALLENGE_RESUME_INITIATIVE" });
    },
    hoveredId === resumeId
  );
  ctx.restore();
}

function drawChallengeOverlay(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId: string | undefined,
  layout: Layout
): void {
  const { width, height } = ctx.canvas;
  const challenge = state.challenge;
  if (!challenge) {
    return;
  }
  const initiativeKey = `${state.turn}-${challenge.id}`;
  ctx.save();
  ctx.fillStyle = "rgb(0,0,0)";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  const human = state.players.find((player) => !player.isAI);
  const isHumanContestant = !!human && challenge.contestants.includes(human.id);
  if (initiativePopupChallengeKey !== initiativeKey) {
    initiativePopupChallengeKey = initiativeKey;
    initiativeRollPopupDismissedKey = null;
  }
  const showInitiativePopup =
    isHumanContestant &&
    (
      (challenge.phase === "ROLL_ORDER" && initiativeRollPopupDismissedKey !== initiativeKey) ||
      (challenge.phase === "COMMIT_TURNS" && challenge.initiativePaused === true)
    );
  const order = challenge.turnOrder.length > 0 ? challenge.turnOrder : challenge.order;
  const activeId = order[challenge.activeTurnIndex] ?? order[0];
  const draftOrder = challenge.draft?.pickOrderPlayerIds ?? [];
  const draftPickerId = draftOrder.length > 0
    ? draftOrder[(challenge.draft?.currentPickIndex ?? 0) % draftOrder.length]
    : undefined;
  const actingId = challenge.phase === "REVEAL"
    ? order[challenge.revealIndex ?? 0]
    : challenge.phase === "RESOLVE"
      ? order[challenge.resolveIndex ?? 0]
      : challenge.phase === "DRAFT"
        ? (draftPickerId ?? activeId)
        : activeId;
  const activePlayer = state.players.find((p) => p.id === actingId);
  const activeName = activePlayer?.name ?? "Unknown";
  const activeOrder = challenge.phase === "DRAFT" && draftOrder.length > 0 ? draftOrder : order;
  const activeIndex = activeOrder.indexOf(actingId);
  const isChallengePhase =
    challenge.phase === "COMMIT_TURNS" || challenge.phase === "REVEAL" || challenge.phase === "RESOLVE" || challenge.phase === "DRAFT";
  const isObserving = isChallengePhase && (!human || !challenge.contestants.includes(human.id)) && actingId !== human?.id;

  const panelX = layout.safeLeft;
  const panelY = layout.topBar.y + layout.topBar.h + layout.gap;
  const panelW = width - layout.safeLeft - layout.safeRight;
  const panelH = layout.handDock.y - panelY - layout.gap;
  drawPanel(ctx, panelX, panelY, panelW, panelH, "rgba(8,10,14,0.92)", "#3d4b64");

  const innerX = panelX + 12;
  const innerY = panelY + 12;
  const innerW = panelW - 24;
  const innerH = panelH - 24;
  const baseBannerH = 64;
  const bannerExtra = challenge.phase === "COMMIT_TURNS" ? 18 : 0;
  const bannerH = baseBannerH + bannerExtra;
  const stepperH = 24;
  const bannerY = innerY;
  const stepperY = bannerY + bannerH + 6;
  const contentY = stepperY + stepperH + 12;
  const contentH = innerY + innerH - contentY;

  // Sidebar extends to full page height (overlapping hand dock area) and is wider
  const sidebarW = width < 1200 ? 340 : width < 1400 ? 380 : 420;
  const sidebarX = width - layout.safeRight - sidebarW;
  const sidebarY = contentY;
  const sidebarBottomY = height - 10;
  const sidebarH = sidebarBottomY - sidebarY;

  const boardX = innerX;
  const boardY = contentY;
  const boardW = sidebarX - boardX - 12;
  const boardH = contentH;

  drawPanel(ctx, innerX, bannerY, innerW, bannerH, "rgba(15,18,26,0.86)", "#3a465e");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 16px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText(`CHALLENGE: ${challenge.id}`, innerX + 12, bannerY + 22);

  const phaseLabels: Record<string, string> = {
    ROLL_ORDER: "ROLL ORDER",
    COMMIT_TURNS: "COMMIT",
    REVEAL: "REVEAL",
    RESOLVE: "RESOLVE",
    REWARDS: "REWARDS",
    DRAFT: "DRAFT",
    SETUP: "SETUP"
  };
  const phaseLabel = phaseLabels[challenge.phase] ?? challenge.phase;
  const instructions: Record<string, string> = {
    ROLL_ORDER: "Rolling initiative dice. Highest roll acts last.",
    COMMIT_TURNS: "On your beat: commit 1 Game Card OR 1 Invocation, then Confirm. Confirm with nothing to PASS.",
    REVEAL: "Revealing committed cards...",
    RESOLVE: "Resolving totals...",
    REWARDS: "Distributing rewards.",
    DRAFT: "Guardian draft in progress. Highest contributors pick first."
  };
  const instruction = instructions[challenge.phase] ?? "";

  ctx.textAlign = "center";
  ctx.font = "600 12px 'Cinzel', serif";
  ctx.fillText(`PHASE: ${phaseLabel}`, innerX + innerW / 2, bannerY + 22);
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.75)";
  const instructionLines = wrapText(ctx, instruction, innerW * 0.4);
  const instructionMax = challenge.phase === "COMMIT_TURNS" ? 1 : 2;
  instructionLines.slice(0, instructionMax).forEach((line, idx) => {
    ctx.fillText(line, innerX + innerW / 2, bannerY + 40 + idx * 14);
  });

  if (challenge.phase === "COMMIT_TURNS") {
    const activePlayers = challenge.contestants.filter((id) => !challenge.folded.includes(id));
    const passStreak = challenge.passesInRow ?? 0;
    const humanId = state.players.find((p) => !p.isAI)?.id;
    const humanPlayed = humanId ? challenge.played[humanId] : undefined;
    const humanCommitsUsed = humanPlayed ? (humanPlayed.selected.length + humanPlayed.spellsPlayed.length) : 0;

    ctx.fillStyle = 'rgba(245,241,230,0.7)';
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.textAlign = 'center';

    const parts: string[] = [];
    if (humanId && challenge.contestants.includes(humanId) && !challenge.folded.includes(humanId)) {
      parts.push(`Commits used: ${humanCommitsUsed} / ${CHALLENGE_COMMIT_MAX}`);
    }
    parts.push(`Pass streak: ${passStreak} / ${activePlayers.length}`);
    parts.push(`Ends when streak = ${activePlayers.length}`);

    ctx.fillText(parts.join(" | "), innerX + innerW / 2, bannerY + bannerH - 8);
  }

  ctx.textAlign = "right";
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "12px 'Cinzel', serif";
  if (order.length > 0) {
    const turnSuffix = "";
    ctx.fillText(`ACTING NOW: ${activeName} (${activeIndex + 1}/${order.length})${turnSuffix}`, innerX + innerW - 50, bannerY + 22);
  }
  ctx.font = "11px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.75)";
  const orderLine = (challenge.phase === "DRAFT" && draftOrder.length > 0)
    ? `Draft order: ${draftOrder.map((id) => state.players.find((p) => p.id === id)?.name ?? id).join(" -> ")}`
    : order.length
      ? order.map((id) => {
          const name = state.players.find((p) => p.id === id)?.name ?? id;
          const roll = challenge.rolls[id];
          return roll ? `${name} (${roll})` : name;
        }).join(" -> ")
      : "Order: rolling...";
  const orderLines = wrapText(ctx, orderLine, innerW * 0.42);
  orderLines.slice(0, 2).forEach((line, idx) => {
    ctx.fillText(line, innerX + innerW - 50, bannerY + 40 + idx * 14);
  });

  ctx.textAlign = "left";
  const steps = ["Roll Order", "Commit", "Reveal", "Resolve", "Draft"];
  const stepIndex = challenge.phase === "ROLL_ORDER"
    ? 0
    : challenge.phase === "COMMIT_TURNS"
      ? 1
      : challenge.phase === "REVEAL"
        ? 2
        : challenge.phase === "RESOLVE"
          ? 3
          : 4;
  const stepX = innerX + 8;
  ctx.font = "12px 'Source Serif 4', serif";
  steps.forEach((step, idx) => {
    ctx.fillStyle = idx === stepIndex ? "#f5f1e6" : "rgba(245,241,230,0.45)";
    ctx.fillText(idx === stepIndex ? `> ${step}` : step, stepX + idx * 120, stepperY + 16);
  });

  const canSkipObserving = isObserving && !showInitiativePopup;

  // Auto-play availability (button drawn at bottom of sidebar with other action buttons)
  const isHumanInChallenge = challenge.contestants.includes(human?.id ?? "");
  const canAutoPlay = isHumanInChallenge && !state.ui.challengeResult &&
    (challenge.phase === "COMMIT_TURNS" || challenge.phase === "REVEAL" || challenge.phase === "RESOLVE" || challenge.phase === "DRAFT");

  // Settings cog at top-right of banner
  drawButton(ctx, regions, "challenge-settings", innerX + innerW - 40, bannerY + 8, 32, 28, "\u2699", () => {
    dispatch({ type: "TOGGLE_MENU" });
  }, hoveredId === "challenge-settings");

  // --- Commit table (sequential beats) ---
  // In COMMIT phase, each beat: active player may commit 1 Game Card OR 1 Invocation, or PASS.
  // Visibility rule (locked): only the FIRST committed game card per player is face-down. Subsequent committed cards are face-up.

  const cardW = 92;
  const cardH = 122;
  const cardGap = 10;
  const maxShown = CHALLENGE_COMMIT_MAX;

  const revealSet = new Set<string>();
  if (challenge.phase === "REVEAL") {
    const revealCount = challenge.revealIndex ?? 0;
    order.slice(0, revealCount).forEach((id) => revealSet.add(id));
  }
  if (challenge.phase === "RESOLVE" || challenge.phase === "REWARDS" || challenge.phase === "DRAFT") {
    order.forEach((id) => revealSet.add(id));
  }

  const isCardHidden = (played: ChallengeState["played"][string], cardId: string): boolean => {
    const hiddenIds = played.hiddenCardIds && played.hiddenCardIds.length > 0
      ? played.hiddenCardIds
      : (played.faceDownId ? [played.faceDownId] : []);
    return hiddenIds.includes(cardId);
  };
  const isCardRevealedEarly = (playerId: string, cardId: string): boolean =>
    challenge.revealedEarly.some((entry) => entry.playerId === playerId && entry.cardId === cardId);

  const drawCommittedRow = (playerId: string, cx: number, cy: number): void => {
    const player = state.players.find((p) => p.id === playerId);
    const played = challenge.played[playerId];
    if (!player || !played) return;

    const isActive = playerId === activeId && challenge.phase === "COMMIT_TURNS";
    const isHumanActiveRow = isActive && !!human && playerId === human.id;
    // Always reveal your own committed items; opponents only fully reveal during REVEAL/RESOLVE.
    const revealAll = revealSet.has(playerId) || (!!human && playerId === human.id);

    const committedItems = (played.committedItems && played.committedItems.length > 0)
      ? played.committedItems
      : [
        ...played.selected.map((id) => ({ kind: "card" as const, id })),
        ...played.spellsPlayed.map((id) => ({ kind: "spell" as const, id }))
      ];
    const committedCount = committedItems.length;
    const pendingCardIndex = isHumanActiveRow ? state.ui.selectedCards?.[0] : undefined;
    const pendingCardId = pendingCardIndex !== undefined ? human?.hand[pendingCardIndex] : undefined;
    const pendingSpellId = isHumanActiveRow ? state.ui.pendingSpellId : undefined;
    let pendingPreviewUsed = false;

    // --- Inline opponent intel above AI player rows ---
    if (player.isAI) {
      const intelY = cy - cardH / 2 - 38;
      const rowW2 = Math.max(1, maxShown) * cardW + (Math.max(1, maxShown) - 1) * cardGap;
      const intelX0 = cx - rowW2 / 2;
      const handCards = player.hand.map((id) => dataStore.cardsById[id]).filter(Boolean);
      const handCount = handCards.length;
      const ap = challenge.apContributionByPlayer?.[playerId] ?? 0;

      // Name and hand count label
      ctx.fillStyle = "rgba(245,241,230,0.9)";
      ctx.font = "600 11px 'Cinzel', serif";
      ctx.textAlign = "left";
      ctx.fillText(`${player.name}`, intelX0, intelY + 10);

      ctx.fillStyle = "rgba(245,241,230,0.65)";
      ctx.font = "10px 'Source Serif 4', serif";
      ctx.fillText(`Hand: ${handCount}`, intelX0 + ctx.measureText(player.name).width + 8, intelY + 10);

      // AP contribution
      ctx.fillStyle = "#7e78c7";
      ctx.font = "600 10px 'Source Serif 4', serif";
      ctx.fillText(`${ap} AP`, intelX0 + ctx.measureText(player.name).width + ctx.measureText(`Hand: ${handCount}`).width + 20, intelY + 10);

      // Mini card previews
      const miniW = 26;
      const miniH = Math.round(miniW * 1.35);
      const miniGap = 4;
      const maxMini = Math.min(6, handCards.length);
      const miniStartX = intelX0 + rowW2 - maxMini * (miniW + miniGap);
      handCards.slice(0, maxMini).forEach((card, idx) => {
        drawCard(ctx, card, miniStartX + idx * (miniW + miniGap), intelY - 4, miniW, miniH, false, true);
      });
      if (handCards.length > maxMini) {
        const badgeX = miniStartX + maxMini * (miniW + miniGap);
        ctx.fillStyle = "rgba(245,241,230,0.7)";
        ctx.font = "10px 'Source Serif 4', serif";
        ctx.textAlign = "center";
        ctx.fillText(`+${handCards.length - maxMini}`, badgeX + 10, intelY + 10);
        ctx.textAlign = "left";
      }
    }

    // Avatar card (80% of game card size: 74x98) positioned to the left
    const avatarW = 74;
    const avatarH = 98;
    const avatarX = cx - maxShown * (cardW + cardGap) / 2 - avatarW - 15;
    const avatarY = cy - avatarH / 2;

    // Avatar card background with player color
    const isAI = player.isAI;
    const playerColor = isAI ? "#4a5a7a" : "#5a7a4a";
    const playerColorLight = isAI ? "#5a6a8a" : "#6a8a5a";

    // Card frame
    ctx.fillStyle = "rgba(16,20,28,0.95)";
    ctx.fillRect(avatarX, avatarY, avatarW, avatarH);

    // Border with active highlight
    ctx.strokeStyle = isActive ? "#e6c15a" : playerColor;
    ctx.lineWidth = isActive ? 3 : 2;
    ctx.strokeRect(avatarX, avatarY, avatarW, avatarH);

    // Inner gradient
    const avatarGrad = ctx.createLinearGradient(avatarX, avatarY, avatarX, avatarY + avatarH);
    avatarGrad.addColorStop(0, playerColorLight);
    avatarGrad.addColorStop(1, playerColor);
    ctx.fillStyle = avatarGrad;
    ctx.fillRect(avatarX + 4, avatarY + 4, avatarW - 8, avatarH - 8);

    // Avatar icon (large)
    ctx.fillStyle = "#f5f1e6";
    ctx.font = "32px 'Cinzel', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const avatarIcon = player.avatar || (isAI ? "🤖" : "👤");
    ctx.fillText(avatarIcon, avatarX + avatarW / 2, avatarY + avatarH / 2 - 10);

    // Player name below icon
    ctx.fillStyle = "#f5f1e6";
    ctx.font = "600 9px 'Cinzel', serif";
    ctx.fillText(player.name.slice(0, 10), avatarX + avatarW / 2, avatarY + avatarH / 2 + 18);

    // "ACTING" badge if active
    if (isActive) {
      ctx.fillStyle = "#e6c15a";
      ctx.font = "700 8px 'Cinzel', serif";
      ctx.fillText("ACTING", avatarX + avatarW / 2, avatarY + avatarH - 8);
    }

    ctx.restore();
    ctx.save();

    // Slots (cards or invocations).
    const rowW = Math.max(1, maxShown) * cardW + (Math.max(1, maxShown) - 1) * cardGap;
    let x0 = cx - rowW / 2;
    for (let i = 0; i < maxShown; i += 1) {
      const entry = committedItems[i];
      const x = x0 + i * (cardW + cardGap);
      const slotState = !isActive
        ? "LOCKED"
        : i < committedCount
          ? "LOCKED"
          : i === committedCount
            ? "ACTIVE"
            : "DISABLED";
      const baseFill = slotState === "ACTIVE"
        ? "rgba(25,22,18,0.75)"
        : slotState === "DISABLED"
          ? "rgba(18,20,26,0.55)"
          : "rgba(25,22,18,0.55)";
      const baseStroke = slotState === "ACTIVE"
        ? "#e6c15a"
        : slotState === "DISABLED"
          ? "#3d475f"
          : "#6a5a3a";
      drawPanel(ctx, x, cy - cardH / 2, cardW, cardH, baseFill, baseStroke);

      if (!entry) {
        const canPreview = isHumanActiveRow && slotState === "ACTIVE" && !pendingPreviewUsed && committedCount < maxShown;
        if (canPreview && (pendingCardId || pendingSpellId)) {
          pendingPreviewUsed = true;
          ctx.save();
          ctx.globalAlpha = 0.86;
          if (pendingCardId) {
            const pendingCard = dataStore.cardsById[pendingCardId];
            if (pendingCard) {
              drawCard(ctx, pendingCard, x, cy - cardH / 2, cardW, cardH, true, false);
            }
          } else if (pendingSpellId) {
            drawInvocationCard(ctx, pendingSpellId, x, cy - cardH / 2, cardW, cardH, true, true);
          }
          ctx.restore();
        }

        if (slotState === "ACTIVE" && isActive && human && playerId === human.id && committedCount < maxShown) {
          regions.push({
            id: `challenge-slot-${playerId}-${i}`,
            x,
            y: cy - cardH / 2,
            w: cardW,
            h: cardH,
            onDrop: (payload) => {
              if (payload?.kind === "hand-card") {
                const idx = (payload as any).cardIndex as number;
                dispatch({ type: "SELECT_CARD", cardIndex: idx });
              } else if (payload?.kind === "spell") {
                const spellId = (payload as any).spellId as string;
                dispatch({ type: "SET_PENDING_SPELL", spellId });
              }
            },
            cursor: "copy"
          });
        }
      } else if (entry.kind === "card") {
        const card = dataStore.cardsById[entry.id];
        if (!card) continue;

        // --- Card slide-in animation ---
        const slideAnim = cardSlideAnims.find((a) => a.cardId === entry.id && a.playerId === playerId);
        const now = performance.now();
        let slideOffsetY = 0;
        let slideAlpha = 1;
        let slideScale = 1;
        if (slideAnim) {
          const st = Math.min(1, (now - slideAnim.startTime) / slideAnim.duration);
          const ease = 1 - Math.pow(1 - st, 3); // cubic out
          slideOffsetY = (1 - ease) * 80; // slide up from 80px below
          slideAlpha = ease;
          slideScale = 0.7 + 0.3 * ease; // scale from 70% to 100%
        }

        // --- Card flip animation ---
        const flipAnim = cardFlipAnims.find((a) => a.cardId === entry.id && a.playerId === playerId);
        let flipScaleX = 1;
        let showFront = revealAll;
        if (flipAnim) {
          const ft = Math.min(1, (now - flipAnim.startTime) / flipAnim.duration);
          if (ft < 0.5) {
            flipScaleX = 1 - ft * 2; // squish to 0
            showFront = false; // still showing back
          } else {
            flipScaleX = (ft - 0.5) * 2; // expand back
            showFront = true; // now showing front
          }
        }

        ctx.save();
        const drawX = x;
        const drawY = cy - cardH / 2 + slideOffsetY;
        ctx.globalAlpha *= slideAlpha;
        // Apply transforms for slide scale and flip
        const centerX = drawX + cardW / 2;
        const centerY = drawY + cardH / 2;
        ctx.translate(centerX, centerY);
        ctx.scale(flipScaleX * slideScale, slideScale);
        ctx.translate(-centerX, -centerY);

        if (showFront || (revealAll && !flipAnim)) {
          drawCard(ctx, card, drawX, drawY, cardW, cardH, false, false);
        } else {
          const isHidden = isCardHidden(played, entry.id) && !isCardRevealedEarly(playerId, entry.id);
          if (isHidden && (!human || playerId !== human.id)) {
            drawOpponentHiddenCommittedCard(ctx, card, drawX, drawY, cardW, cardH);
          } else {
            drawCard(ctx, card, drawX, drawY, cardW, cardH, false, isHidden);
          }
        }
        ctx.restore();
      } else {
        // --- Invocation slide-in animation ---
        const slideAnim2 = cardSlideAnims.find((a) => a.cardId === entry.id && a.playerId === playerId);
        const now2 = performance.now();
        let sOff = 0;
        let sAlpha = 1;
        let sScale = 1;
        if (slideAnim2) {
          const st = Math.min(1, (now2 - slideAnim2.startTime) / slideAnim2.duration);
          const ease = 1 - Math.pow(1 - st, 3);
          sOff = (1 - ease) * 80;
          sAlpha = ease;
          sScale = 0.7 + 0.3 * ease;
        }
        ctx.save();
        const iDrawY = cy - cardH / 2 + sOff;
        ctx.globalAlpha *= sAlpha;
        const iCx = x + cardW / 2;
        const iCy = iDrawY + cardH / 2;
        ctx.translate(iCx, iCy);
        ctx.scale(sScale, sScale);
        ctx.translate(-iCx, -iCy);
        const shouldHideInvocation = i === 0 && !revealAll && (!human || playerId !== human.id);
        drawInvocationCard(ctx, entry.id, x, iDrawY, cardW, cardH, false, !shouldHideInvocation);
        ctx.restore();
      }

      if (slotState === "ACTIVE") {
        ctx.save();
        ctx.strokeStyle = "rgba(240,216,140,0.85)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 3, cy - cardH / 2 + 3, cardW - 6, cardH - 6);
        ctx.restore();
      }
    }

    // Invocations count (details hidden until reveal)
    const invCount = played.spellsPlayed.length;
    const invLabel = invCount > 0 ? `${invCount} Invocation${invCount === 1 ? "" : "s"}` : "No Invocations";
    ctx.fillStyle = "rgba(245,241,230,0.75)";
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.fillText(invLabel, cx, cy + cardH / 2 + 16);


    // Active highlight ring
    if (isActive) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 280);
      const color = `rgba(240,216,140,${0.35 + pulse * 0.4})`;
      ctx.shadowColor = color;
      ctx.shadowBlur = 18 + pulse * 12;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - rowW / 2 - 8, cy - cardH / 2 - 22, rowW + 16, cardH + 52);
    }

    ctx.restore();
  };

  // Seat layout (same intent as before, but each seat is just a committed row).
  const tableCenterX = boardX + boardW / 2;
  const tableCenterY = boardY + boardH / 2 - 10;

  const humanSeat = !!human && challenge.contestants.includes(human.id);
  const aiContestants = challenge.contestants
    .map((id) => state.players.find((p) => p.id === id))
    .filter((p) => p && p.isAI) as typeof state.players;

  const seatIds: string[] = [];
  if (humanSeat && human) seatIds.push(human.id);
  aiContestants.forEach((p) => seatIds.push(p.id));
  if (!humanSeat) {
    challenge.contestants.forEach((id) => {
      if (!seatIds.includes(id)) seatIds.push(id);
    });
  }

  // AI rows have inline intel (+38px above), so push them higher to avoid overlap.
  if (seatIds.length === 1) {
    drawCommittedRow(seatIds[0], tableCenterX, tableCenterY + 20);
  } else if (seatIds.length === 2) {
    // seatIds[0] = human (bottom), seatIds[1] = AI (top with intel above)
    drawCommittedRow(seatIds[0], tableCenterX, tableCenterY + 140);
    drawCommittedRow(seatIds[1], tableCenterX, tableCenterY - 120);
  } else if (seatIds.length === 3) {
    const rowW2 = maxShown * cardW + (maxShown - 1) * cardGap;
    const sideOffset = Math.max(240, rowW2 / 2 + 50);
    drawCommittedRow(seatIds[0], tableCenterX, tableCenterY + 150);
    drawCommittedRow(seatIds[1], tableCenterX - sideOffset, tableCenterY - 110);
    drawCommittedRow(seatIds[2], tableCenterX + sideOffset, tableCenterY - 110);
  } else {
    // Fallback grid
    const rows = Math.ceil(seatIds.length / 2);
    for (let i = 0; i < seatIds.length; i += 1) {
      const r = Math.floor(i / 2);
      const c = i % 2;
      const cx = tableCenterX + (c === 0 ? -240 : 240);
      const cy = tableCenterY - 130 + r * 260;
      drawCommittedRow(seatIds[i], cx, cy);
    }
  }

  // --- Detect new card commits → spawn slide + AP float animations ---
  const nowAnim = performance.now();
  for (const pid of seatIds) {
    const pl = challenge.played[pid];
    if (!pl) continue;
    const items = pl.committedItems ?? [];
    const currentCount = items.length;
    const prevCount = lastCommitCounts[pid] ?? 0;
    if (currentCount > prevCount && challenge.phase === "COMMIT_TURNS") {
      for (let ni = prevCount; ni < currentCount; ni++) {
        const newItem = items[ni];
        if (!newItem) continue;
        // Spawn slide animation
        cardSlideAnims.push({
          cardId: newItem.id,
          playerId: pid,
          startTime: nowAnim,
          duration: 400,
          fromX: 0, fromY: 0, toX: 0, toY: 0,
          fromW: 0, fromH: 0, toW: 0, toH: 0
        });
        // Spawn AP float
        const apVal = newItem.kind === "card"
          ? (dataStore.cardsById[newItem.id]?.basePower ?? 0)
          : (dataStore.spellsById[newItem.id]?.value ?? 0);
        if (apVal > 0) {
          // Compute approximate slot position for the float
          const rowW2 = Math.max(1, maxShown) * cardW + (Math.max(1, maxShown) - 1) * cardGap;
          // Find which seat position this player is at
          let seatCx = tableCenterX;
          let seatCy = tableCenterY;
          if (seatIds.length === 1) { seatCy = tableCenterY + 20; }
          else if (seatIds.length === 2) {
            const si = seatIds.indexOf(pid);
            seatCy = si === 0 ? tableCenterY + 140 : tableCenterY - 120;
          } else if (seatIds.length === 3) {
            const si = seatIds.indexOf(pid);
            const sideOff = Math.max(240, rowW2 / 2 + 50);
            if (si === 0) { seatCy = tableCenterY + 150; }
            else if (si === 1) { seatCx = tableCenterX - sideOff; seatCy = tableCenterY - 110; }
            else { seatCx = tableCenterX + sideOff; seatCy = tableCenterY - 110; }
          }
          const slotX0 = seatCx - rowW2 / 2 + ni * (cardW + cardGap) + cardW / 2;
          spawnApFloat(apVal, slotX0, seatCy - cardH / 2 - 8);
          // Impact particles + glow ring at commit slot
          spawnBurst(slotX0, seatCy, 8, "#e6c15a", 2.5);
          pushPulse("reward", slotX0, seatCy, "#e6c15a");
        }
      }
    }
    lastCommitCounts[pid] = currentCount;
  }

  // --- Detect reveal phase transitions → spawn flip animations ---
  const currentRevealIdx = challenge.revealIndex ?? 0;
  if (challenge.phase === "REVEAL" && currentRevealIdx > lastRevealIndex && lastRevealIndex >= 0) {
    // New player(s) revealed
    for (let ri = Math.max(0, lastRevealIndex); ri < currentRevealIdx; ri++) {
      const revealedPid = order[ri];
      if (!revealedPid) continue;
      const pl = challenge.played[revealedPid];
      if (!pl) continue;
      const items = pl.committedItems ?? [];
      items.forEach((item) => {
        if (item.kind === "card") {
          cardFlipAnims.push({
            playerId: revealedPid,
            slotIndex: 0,
            cardId: item.id,
            startTime: nowAnim,
            duration: 500
          });
        }
      });
    }
  }
  if (challenge.phase === "REVEAL") {
    lastRevealIndex = currentRevealIdx;
  } else if (challenge.phase !== lastChallengePhase) {
    lastRevealIndex = 0;
  }
  lastChallengePhase = challenge.phase;

  // Reset tracking when challenge starts fresh
  if (challenge.phase === "ROLL_ORDER") {
    lastCommitCounts = {};
    lastRevealIndex = -1;
  }

  // --- Clean up expired animations ---
  for (let i = cardSlideAnims.length - 1; i >= 0; i--) {
    if (nowAnim - cardSlideAnims[i].startTime > cardSlideAnims[i].duration) cardSlideAnims.splice(i, 1);
  }
  for (let i = cardFlipAnims.length - 1; i >= 0; i--) {
    if (nowAnim - cardFlipAnims[i].startTime > cardFlipAnims[i].duration) cardFlipAnims.splice(i, 1);
  }

  // --- Draw AP float-up numbers ---
  updateAndDrawApFloats(ctx);

  // --- Centered AI thinking indicator ---
  const showChallengeThinking = state.ui.aiStatus && state.ui.activeHighlightScope === "CHALLENGE";
  if (showChallengeThinking) {
    const thinkW = Math.min(280, boardW - 40);
    const thinkH = 32;
    const thinkX = tableCenterX - thinkW / 2;
    const thinkY = tableCenterY - thinkH / 2;
    drawAiThinkingIndicator(ctx, state.ui.aiStatus!.message, thinkX, thinkY, thinkW, thinkH);
  }

  drawPanel(ctx, sidebarX, sidebarY, sidebarW, sidebarH, "rgba(14,18,26,0.86)", "#3a465e");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 12px 'Cinzel', serif";
  ctx.textAlign = "left";

  const keystoneTrack = challenge.journeyType === "cave"
    ? state.guardianKeystones?.cave
    : challenge.journeyType === "mountain"
      ? state.guardianKeystones?.mountain
      : undefined;
  const keystonePanelH = keystoneTrack ? 68 : 0;
  const keystonePad = keystonePanelH ? 8 : 0;
  const keystoneY = sidebarY + 10;
  if (keystoneTrack) {
    const isCave = challenge.journeyType === "cave";
    const trackLabel = isCave ? "Cave Keystone" : "Mountain Keystone";
    const maxValue = isCave ? CAVE_MYTHIC_THRESHOLD : MOUNTAIN_MYTHIC_THRESHOLD;
    const rareThreshold = isCave ? CAVE_RARE_THRESHOLD : MOUNTAIN_RARE_THRESHOLD;
    const crystalTier1 = isCave ? CAVE_CRYSTAL_TIER_1 : MOUNTAIN_CRYSTAL_TIER_1;
    const crystalTier2 = isCave ? CAVE_CRYSTAL_TIER_2 : MOUNTAIN_CRYSTAL_TIER_2;
    const progress = keystoneTrack.progress;

    // Check if close to next milestone (within 10% or 15 points, whichever is smaller)
    const nextThreshold = progress < crystalTier1 ? crystalTier1 :
                          progress < rareThreshold ? rareThreshold :
                          progress < crystalTier2 ? crystalTier2 :
                          progress < maxValue ? maxValue : null;
    const isCloseToMilestone = nextThreshold !== null && (nextThreshold - progress) <= Math.min(15, maxValue * 0.1);

    // "Almost there" pulse animation
    if (isCloseToMilestone) {
      const pulse = 0.4 + 0.6 * Math.sin(performance.now() / 200);
      ctx.shadowColor = `rgba(240,216,140,${0.3 + pulse * 0.4})`;
      ctx.shadowBlur = 15 + pulse * 15;
      ctx.strokeStyle = `rgba(240,216,140,${0.5 + pulse * 0.5})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(sidebarX + 8, keystoneY - 2, sidebarW - 16, keystonePanelH + 4);
      ctx.shadowBlur = 0;
    }

    drawPanel(ctx, sidebarX + 10, keystoneY, sidebarW - 20, keystonePanelH, "rgba(20,24,32,0.9)", isCloseToMilestone ? "#5a6a86" : "#3d475f");

    // Title
    ctx.fillStyle = isCloseToMilestone ? "#f0d88c" : "rgba(245,241,230,0.9)";
    ctx.font = "600 12px 'Cinzel', serif";
    ctx.textAlign = "left";
    ctx.fillText(isCloseToMilestone ? `${trackLabel} ⭐` : trackLabel, sidebarX + 20, keystoneY + 16);

    // Progress bar
    const barY = keystoneY + 22;
    const barH = 6;
    const barW = sidebarW - 50;
    const progressPct = Math.min(1, progress / maxValue);

    // Bar background
    ctx.fillStyle = "rgba(80,90,110,0.5)";
    ctx.fillRect(sidebarX + 20, barY, barW, barH);

    // Progress fill
    const gradient = ctx.createLinearGradient(sidebarX + 20, barY, sidebarX + 20 + barW * progressPct, barY);
    gradient.addColorStop(0, isCloseToMilestone ? "#d4a84a" : "#4a6fa5");
    gradient.addColorStop(1, isCloseToMilestone ? "#f0d88c" : "#6a9fd5");
    ctx.fillStyle = gradient;
    ctx.fillRect(sidebarX + 20, barY, barW * progressPct, barH);

    // Progress text
    ctx.font = "10px 'Source Serif 4', serif";
    ctx.fillStyle = "rgba(245,241,230,0.85)";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.floor(progress)}/${maxValue}`, sidebarX + sidebarW - 20, barY + 5);

    // Milestone indicators
    const milestoneY = keystoneY + 38;
    const drawMilestoneDot = (mx: number, active: boolean, color: string) => {
      ctx.beginPath();
      ctx.arc(mx, milestoneY, 4, 0, Math.PI * 2);
      ctx.fillStyle = active ? color : "rgba(120,130,150,0.4)";
      ctx.fill();
      ctx.strokeStyle = "rgba(245,241,230,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    const milestones = [
      { claimed: keystoneTrack.crystalTier1Claimed, color: "#7ec8e3" },
      { claimed: keystoneTrack.rareUnlocked, color: "#f0d88c" },
      { claimed: keystoneTrack.crystalTier2Claimed, color: "#7ec8e3" },
      { claimed: keystoneTrack.mythicUnlocked, color: "#ff9f80" }
    ];
    const milestoneX = sidebarX + 20;
    milestones.forEach((m, i) => {
      drawMilestoneDot(milestoneX + i * 14, m.claimed, m.color);
    });

    // This challenge metric
    ctx.textAlign = "left";
    ctx.font = "10px 'Source Serif 4', serif";
    ctx.fillStyle = "rgba(245,241,230,0.7)";
    const metricLabel = isCave
      ? `+${Math.floor(challenge.metrics?.apEarnedSoFar ?? 0)} AP this challenge`
      : `+${Math.floor(challenge.metrics?.teachingPowerPlayedSoFar ?? 0)} TP this challenge`;
    ctx.fillText(metricLabel, sidebarX + 20, keystoneY + 56);

    // Next milestone hint
    if (nextThreshold !== null && !isCloseToMilestone) {
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(240,216,140,0.6)";
      ctx.fillText(`${Math.ceil(nextThreshold - progress)} to next`, sidebarX + sidebarW - 20, keystoneY + 56);
    } else if (isCloseToMilestone) {
      ctx.textAlign = "right";
      ctx.fillStyle = "#f0d88c";
      ctx.font = "600 10px 'Source Serif 4', serif";
      ctx.fillText("Almost there!", sidebarX + sidebarW - 20, keystoneY + 56);
    }
  }

  const sidebarPad = 10;
  const sidebarInnerX = sidebarX + sidebarPad;
  const sidebarInnerW = sidebarW - sidebarPad * 2;
  const sectionGap = 6;
  // Reserve space for action buttons at bottom (auto-play + confirm/withdraw = 2 rows)
  const buttonAreaH = 100;
  const confirmY = sidebarY + sidebarH - buttonAreaH + 6;

  // --- TP Thresholds panel (fixed height, below keystone) ---
  const tpPanelH = 62;
  const tpPanelY = sidebarY + 10 + keystonePanelH + keystonePad;

  // Draw TP Thresholds panel
  {
    const humanPlayer = state.players.find((p) => !p.isAI);
    const playerTP = humanPlayer ? (challenge.challengeTPByPlayer?.[humanPlayer.id] ?? 0) : 0;
    const thresholdsAwarded = humanPlayer
      ? (challenge.challengeTPThresholdsAwarded?.[humanPlayer.id] ?? { basic: false, rare: false, mythic: false })
      : { basic: false, rare: false, mythic: false };

    drawPanel(ctx, sidebarX + 10, tpPanelY, sidebarW - 20, tpPanelH, "rgba(20,24,32,0.9)", "#3d475f");

    ctx.fillStyle = "rgba(245,241,230,0.9)";
    ctx.font = "600 11px 'Cinzel', serif";
    ctx.textAlign = "left";
    ctx.fillText("TP Thresholds", sidebarX + 20, tpPanelY + 14);

    // TP value + next hint on same line as title
    ctx.font = "700 11px 'Source Serif 4', serif";
    ctx.fillStyle = "#72d7c6";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.floor(playerTP)} TP`, sidebarX + sidebarW - 20, tpPanelY + 14);
    ctx.textAlign = "left";

    const tpThresholds = [
      { label: "Basic", value: TP_THRESHOLD_BASIC, awarded: thresholdsAwarded.basic, color: "#8bd4a1" },
      { label: "Rare", value: TP_THRESHOLD_RARE, awarded: thresholdsAwarded.rare, color: "#72b8d7" },
      { label: "Mythic", value: TP_THRESHOLD_MYTHIC, awarded: thresholdsAwarded.mythic, color: "#d4a8e0" },
    ];

    // Progress bar
    const tpBarLeft = sidebarX + 20;
    const tpBarW = sidebarW - 50;
    const tpBarY = tpPanelY + 22;
    const tpBarH = 8;
    const maxTP = TP_THRESHOLD_MYTHIC;

    ctx.fillStyle = "rgba(40,44,56,0.9)";
    drawRoundedRect(ctx, tpBarLeft, tpBarY, tpBarW, tpBarH, 3);
    ctx.fill();

    const fillFrac = Math.min(playerTP / maxTP, 1);
    if (fillFrac > 0) {
      const grd = ctx.createLinearGradient(tpBarLeft, 0, tpBarLeft + tpBarW * fillFrac, 0);
      grd.addColorStop(0, "rgba(114,215,198,0.7)");
      grd.addColorStop(1, "rgba(139,212,161,0.9)");
      ctx.fillStyle = grd;
      drawRoundedRect(ctx, tpBarLeft, tpBarY, Math.max(4, tpBarW * fillFrac), tpBarH, 3);
      ctx.fill();
    }

    // Threshold markers on bar
    tpThresholds.forEach((t) => {
      const mx = tpBarLeft + (t.value / maxTP) * tpBarW;
      ctx.strokeStyle = t.awarded ? t.color : "rgba(245,241,230,0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx, tpBarY - 1);
      ctx.lineTo(mx, tpBarY + tpBarH + 1);
      ctx.stroke();
    });

    // Threshold labels row
    const labelY = tpPanelY + 42;
    ctx.font = "10px 'Source Serif 4', serif";
    const colW = Math.floor(tpBarW / 3);
    tpThresholds.forEach((t, i) => {
      const cx = tpBarLeft + i * colW;
      const icon = t.awarded ? "✓" : "○";
      ctx.fillStyle = t.awarded ? t.color : "rgba(245,241,230,0.4)";
      ctx.fillText(`${icon} ${t.label} (${t.value})`, cx, labelY);
    });

    // Next threshold hint
    const nextT = tpThresholds.find((t) => !t.awarded);
    if (nextT) {
      ctx.fillStyle = "rgba(245,241,230,0.5)";
      ctx.font = "10px 'Source Serif 4', serif";
      ctx.textAlign = "right";
      ctx.fillText(`${Math.ceil(nextT.value - playerTP)} to ${nextT.label}`, sidebarX + sidebarW - 20, labelY);
      ctx.textAlign = "left";
    }

    // Hover tooltip for exact TP numbers
    const tpHoverId = "tp-threshold-bar";
    regions.push({
      id: tpHoverId,
      x: sidebarX + 10,
      y: tpPanelY,
      w: sidebarW - 20,
      h: tpPanelH,
      cursor: "default"
    });
    const tpFloor = Math.floor(playerTP * 10) / 10;
    const tipLines: string[] = [
      `Current TP: ${tpFloor}`,
      ``,
      `Basic  (${TP_THRESHOLD_BASIC}): ${thresholdsAwarded.basic ? "Reached ✓" : `${tpFloor} / ${TP_THRESHOLD_BASIC}  —  ${Math.ceil(TP_THRESHOLD_BASIC - playerTP)} to go`}`,
      `Rare   (${TP_THRESHOLD_RARE}): ${thresholdsAwarded.rare ? "Reached ✓" : `${tpFloor} / ${TP_THRESHOLD_RARE}  —  ${Math.ceil(TP_THRESHOLD_RARE - playerTP)} to go`}`,
      `Mythic (${TP_THRESHOLD_MYTHIC}): ${thresholdsAwarded.mythic ? "Reached ✓" : `${tpFloor} / ${TP_THRESHOLD_MYTHIC}  —  ${Math.ceil(TP_THRESHOLD_MYTHIC - playerTP)} to go`}`,
    ];
    queueHoverTip(tpHoverId, tipLines, sidebarX - 180, tpPanelY + tpPanelH / 2, 220, 120);
  }

  const contentTop = tpPanelY + tpPanelH + sectionGap;
  const contentBottom = confirmY - 10;
  const availableH = Math.max(120, contentBottom - contentTop);

  // Log is collapsible: collapsed = header only (28px), expanded = larger
  const logExpanded = !!state.ui.challengeLogExpanded;
  const logCollapsedH = 28;
  const logExpandedH = 140;
  const logH = logExpanded ? logExpandedH : logCollapsedH;

  // Rite Status gets all remaining space
  let statusH = availableH - logH - sectionGap;
  statusH = Math.max(120, statusH);

  let cursorY = contentTop;

  const statusX = sidebarInnerX;
  const statusY = cursorY;
  const statusW = sidebarInnerW;
  drawPanel(ctx, statusX, statusY, statusW, statusH, "rgba(20,24,32,0.82)", "#3d475f");
  ctx.fillStyle = "rgba(245,241,230,0.9)";
  ctx.font = "600 12px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText("Rite Status", statusX + 10, statusY + 18);

  const statusContentTop = statusY + 28;
  const statusContentBottom = statusY + statusH - 6;
  let statusCursorY = statusY + 34;
  let statusTruncated = false;

  ctx.save();
  ctx.beginPath();
  ctx.rect(statusX + 4, statusContentTop, statusW - 8, statusH - 32);
  ctx.clip();

  // --- Total Group AP (highlighted) ---
  const totalGroupAp = challenge.totalGroupAp;
  if (statusCursorY <= statusContentBottom) {
    ctx.fillStyle = "#72d7c6";
    ctx.font = "700 12px 'Source Serif 4', serif";
    ctx.fillText(`Total AP: ${totalGroupAp !== undefined ? totalGroupAp : "--"}`, statusX + 10, statusCursorY);
    statusCursorY += 18;
  } else {
    statusTruncated = true;
  }

  // --- Per-player AP contributions ---
  const apEntries = challenge.contestants.map((playerId) => {
    const pName = state.players.find((p) => p.id === playerId)?.name ?? playerId;
    const pIsHuman = state.players.find((p) => p.id === playerId)?.isAI === false;
    const ap = challenge.apContributionByPlayer?.[playerId];
    return { playerId, name: pName, ap: ap ?? 0, isHuman: pIsHuman };
  }).sort((a, b) => b.ap - a.ap);

  apEntries.forEach((entry) => {
    if (statusCursorY > statusContentBottom) {
      statusTruncated = true;
      return;
    }
    ctx.fillStyle = entry.isHuman ? "#8bd4a1" : "rgba(245,241,230,0.75)";
    ctx.font = entry.isHuman ? "600 11px 'Source Serif 4', serif" : "11px 'Source Serif 4', serif";
    const nameLabel = entry.isHuman ? `You` : entry.name;
    ctx.fillText(`${nameLabel}: ${entry.ap} AP`, statusX + 10, statusCursorY);
    statusCursorY += 15;
  });

  // --- Separator ---
  if (statusCursorY + 6 <= statusContentBottom) {
    statusCursorY += 3;
    ctx.strokeStyle = "rgba(245,241,230,0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(statusX + 10, statusCursorY);
    ctx.lineTo(statusX + statusW - 10, statusCursorY);
    ctx.stroke();
    statusCursorY += 6;
  }

  // --- Draft picker ---
  const draftPicker = draftPickerId
    ? state.players.find((p) => p.id === draftPickerId)?.name ?? draftPickerId
    : undefined;
  if (challenge.phase === "DRAFT" && draftPicker) {
    if (statusCursorY <= statusContentBottom) {
      ctx.fillStyle = "rgba(240,216,140,0.9)";
      ctx.font = "600 11px 'Cinzel', serif";
      ctx.fillText(`Current pick: ${draftPicker}`, statusX + 10, statusCursorY);
      statusCursorY += 16;
    } else {
      statusTruncated = true;
    }
  }

  // --- Rewards header ---
  if (statusCursorY <= statusContentBottom) {
    ctx.fillStyle = "rgba(245,241,230,0.9)";
    ctx.font = "600 11px 'Cinzel', serif";
    ctx.fillText("Rewards", statusX + 10, statusCursorY);
    statusCursorY += 16;
  } else {
    statusTruncated = true;
  }

  const rewards = challenge.rewardPool?.rewards ?? [];
  if (rewards.length === 0) {
    if (statusCursorY <= statusContentBottom) {
      ctx.fillStyle = "rgba(245,241,230,0.5)";
      ctx.font = "11px 'Source Serif 4', serif";
      ctx.fillText("No rewards in pool.", statusX + 10, statusCursorY);
    } else {
      statusTruncated = true;
    }
  } else {
    const humanId = human?.id;
    const participantCount = challenge.participants.length || 1;
    rewards.forEach((reward, index) => {
      if (statusCursorY > statusContentBottom) {
        statusTruncated = true;
        return;
      }
      const label = rewardLabel(reward);
      const claimedBy = reward.claimedByPlayerId
        ? state.players.find((p) => p.id === reward.claimedByPlayerId)?.name ?? reward.claimedByPlayerId
        : undefined;
      const finalCost = reward.finalCost ?? (reward.baseCostPerParticipant ?? 0) * participantCount;
      const isUnlocked = reward.isUnlocked;
      const isClaimed = reward.isClaimed;
      const canPick =
        challenge.phase === "DRAFT" &&
        humanId &&
        humanId === draftPickerId &&
        isUnlocked &&
        !isClaimed &&
        !!reward.id;

      // Reward name
      ctx.fillStyle = isClaimed
        ? "rgba(245,241,230,0.5)"
        : isUnlocked
          ? "rgba(195,232,176,0.95)"
          : "rgba(245,241,230,0.6)";
      ctx.font = canPick ? "700 11px 'Source Serif 4', serif" : "11px 'Source Serif 4', serif";
      ctx.fillText(`${canPick ? ">> " : ""}${label}`, statusX + 10, statusCursorY);
      statusCursorY += 13;

      // Status + AP progress on second line
      if (statusCursorY <= statusContentBottom) {
        const statusTag = isClaimed
          ? (claimedBy ? `Claimed (${claimedBy})` : "Claimed")
          : isUnlocked
            ? "UNLOCKED"
            : `LOCKED (${totalGroupAp ?? 0}/${finalCost} AP)`;
        ctx.fillStyle = isClaimed
          ? "rgba(245,241,230,0.4)"
          : isUnlocked
            ? "rgba(140,210,120,0.8)"
            : "rgba(245,241,230,0.35)";
        ctx.font = "10px 'Source Serif 4', serif";
        ctx.fillText(`  ${statusTag}`, statusX + 10, statusCursorY);
        statusCursorY += 15;
      }

      if (canPick) {
        regions.push({
          id: `challenge-reward-pick-${reward.id}-${index}`,
          x: statusX + 6,
          y: statusCursorY - 30,
          w: statusW - 12,
          h: 28,
          onClick: () => {
            playChime("reward");
            dispatch({ type: "CHALLENGE_DRAFT_PICK", rewardId: reward.id ?? "" });
          },
          cursor: "pointer"
        });
      }
    });
  }
  ctx.restore();
  if (statusTruncated) {
    ctx.fillStyle = "rgba(245,241,230,0.6)";
    ctx.font = "10px 'Source Serif 4', serif";
    ctx.textAlign = "right";
    ctx.fillText("More...", statusX + statusW - 10, statusY + statusH - 6);
    ctx.textAlign = "left";
  }

  cursorY = statusY + statusH + sectionGap;

  const logX = sidebarInnerX;
  const logY = cursorY;
  const logW = sidebarInnerW;
  drawPanel(ctx, logX, logY, logW, logH, "rgba(20,24,32,0.82)", "#3d475f");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 12px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText("Challenge Log", logX + 10, logY + 18);

  // Toggle expand/collapse button
  const toggleLabel = logExpanded ? "▼" : "▶";
  const toggleW = 28;
  const toggleH = 18;
  drawButton(ctx, regions, "challenge-log-toggle", logX + logW - toggleW - 6, logY + 4, toggleW, toggleH, toggleLabel, () => {
    dispatch({ type: "TOGGLE_CHALLENGE_LOG" });
  }, hoveredId === "challenge-log-toggle");

  if (logExpanded) {
    const logHeaderH = 22;
    const logContentY = logY + logHeaderH + 6;
    const logContentH = Math.max(40, logH - logHeaderH - 6 - 26);
    const rawLines = challenge.logEntries ?? [];
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const wrapped: string[] = [];
    rawLines.forEach((line) => {
      wrapText(ctx, line, logW - 16).forEach((wrappedLine) => wrapped.push(wrappedLine));
    });
    const lineHeight = 18;
    const visibleLines = Math.max(1, Math.floor(logContentH / lineHeight));
    const maxOffset = Math.max(0, wrapped.length - visibleLines);
    const offset = Math.min(state.ui.challengeLogScroll ?? 0, maxOffset);
    const start = Math.max(0, wrapped.length - visibleLines - offset);
    const visible = wrapped.slice(start, start + visibleLines);

    ctx.save();
    ctx.beginPath();
    ctx.rect(logX + 6, logContentY, logW - 12, logContentH);
    ctx.clip();
    ctx.fillStyle = "rgba(245,241,230,0.9)";
    visible.forEach((line, idx) => {
      ctx.fillText(line, logX + 8, logContentY + 2 + idx * lineHeight);
    });
    ctx.restore();

    const scrollBtnW = 40;
    const scrollBtnH = 20;
    const scrollY = logY + logH - scrollBtnH - 6;
    drawButton(ctx, regions, "challenge-log-up", logX + logW - scrollBtnW * 2 - 12, scrollY, scrollBtnW, scrollBtnH, "Up", () => {
      dispatch({ type: "SET_CHALLENGE_LOG_SCROLL", value: offset + 2 });
    }, hoveredId === "challenge-log-up");
    drawButton(ctx, regions, "challenge-log-down", logX + logW - scrollBtnW - 6, scrollY, scrollBtnW, scrollBtnH, "Down", () => {
      dispatch({ type: "SET_CHALLENGE_LOG_SCROLL", value: offset - 2 });
    }, hoveredId === "challenge-log-down");
  }

  // --- Action buttons at bottom of sidebar ---
  let actionBtnY = confirmY;
  if (canAutoPlay) {
    drawButton(ctx, regions, "challenge-auto-play", sidebarX + 14, actionBtnY, sidebarW - 28, 36, "Auto-Play (Skip to End)", () => {
      dispatch({ type: "CHALLENGE_AUTO_PLAY" });
    }, hoveredId === "challenge-auto-play");
    actionBtnY += 44;
  }

  if (canSkipObserving) {
    const skipKey = `${challenge.id}-${challenge.phase}-${actingId ?? "none"}`;
    if (lastSkipLogKey !== skipKey) {
      lastSkipLogKey = skipKey;
      dispatch({ type: "ADD_LOG", text: "Skip available (observing AI challenge)" });
    }
    drawButton(ctx, regions, "challenge-skip-sidebar", sidebarX + 14, actionBtnY, sidebarW - 28, 36, "Skip AI Phase", () => {
      dispatch({ type: "FAST_FORWARD_CHALLENGE" });
    }, hoveredId === "challenge-skip-sidebar");
    actionBtnY += 44;
  }

  if (challenge.phase === "COMMIT_TURNS" && human && isHumanContestant && activeId === human.id) {
    const btnGap = 10;
    const confirmW = Math.floor((sidebarW - 28 - btnGap) * 0.62);
    const withdrawW = (sidebarW - 28 - btnGap) - confirmW;

    drawButton(ctx, regions, "confirm-commit", sidebarX + 14, actionBtnY, confirmW, 40, "Confirm / Pass", () => {
      dispatch({ type: "LOCK_CARDS" });
    }, hoveredId === "confirm-commit");

    drawButton(ctx, regions, "withdraw-challenge", sidebarX + 14 + confirmW + btnGap, actionBtnY, withdrawW, 40, "WITHDRAW", () => {
      if (state.ui.confirmWithdraw) {
        dispatch({ type: "UI_SET_WITHDRAW_CONFIRM", value: false });
        dispatch({ type: "FOLD_CHALLENGE" });
      } else {
        dispatch({ type: "UI_SET_WITHDRAW_CONFIRM", value: true });
      }
    }, hoveredId === "withdraw-challenge");

    if (hoveredId === "withdraw-challenge") {
      queueHoverTip(
        "withdraw-challenge",
        [
          "Withdraw (Fold): leave the challenge immediately.",
          "You keep your remaining hand (uncommitted cards).",
          "You will not draft rewards.",
          "Your face-down committed game card returns to your hand.",
          "All other committed cards/invocations are still spent."
        ],
        sidebarX + sidebarW - 14,
        actionBtnY - 6,
        320,
        220
      );
    }
  } else if (challenge.phase === "COMMIT_TURNS" && activePlayer) {
    const waitLabel = activePlayer.isAI ? `Waiting for ${activePlayer.name}...` : "Waiting...";
    drawPanel(ctx, sidebarX + 14, actionBtnY, sidebarW - 28, 40, "rgba(20,24,32,0.85)", "#3d475f");
    ctx.fillStyle = "rgba(245,241,230,0.7)";
    ctx.font = "12px 'Source Serif 4', serif";
    ctx.textAlign = "center";
    ctx.fillText(waitLabel, sidebarX + sidebarW / 2, actionBtnY + 24);
  }



  // Withdraw confirmation modal (UI clarity: no surprises)
  if (challenge.phase === "COMMIT_TURNS" && state.ui.confirmWithdraw && human && isHumanContestant && activeId === human.id) {
    const modalW = Math.min(520, width - 80);
    const modalH = 220;
    const modalX = Math.floor(width / 2 - modalW / 2);
    const modalY = Math.floor(height / 2 - modalH / 2);

    // Dim backdrop
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    drawPanel(ctx, modalX, modalY, modalW, modalH, "rgba(14,16,22,0.96)", "#4a556d");
    ctx.fillStyle = "#f5f1e6";
    ctx.font = "700 16px 'Cinzel', serif";
    ctx.textAlign = "left";
    ctx.fillText("Confirm Withdraw", modalX + 18, modalY + 30);

    ctx.font = "12px 'Source Serif 4', serif";
    ctx.fillStyle = "rgba(245,241,230,0.8)";
    const lines = [
      "- You leave the challenge immediately.",
      "- You keep all uncommitted hand cards.",
      "- You will not draft rewards.",
      "- Your face-down committed Game Card returns to your hand.",
      "- All other committed items are still spent."
    ];
    lines.forEach((line, idx) => {
      ctx.fillText(line, modalX + 18, modalY + 56 + idx * 18);
    });

    const btnY = modalY + modalH - 52;
    const btnW = Math.floor((modalW - 18 * 2 - 10) / 2);
    drawButton(ctx, regions, "withdraw-cancel", modalX + 18, btnY, btnW, 36, "CANCEL", () => {
      dispatch({ type: "UI_SET_WITHDRAW_CONFIRM", value: false });
    }, hoveredId === "withdraw-cancel");

    drawButton(ctx, regions, "withdraw-confirm", modalX + 18 + btnW + 10, btnY, btnW, 36, "CONFIRM", () => {
      dispatch({ type: "UI_SET_WITHDRAW_CONFIRM", value: false });
      dispatch({ type: "FOLD_CHALLENGE" });
    }, hoveredId === "withdraw-confirm");
  }

  if (challenge.phase === "DRAFT") {
    drawDraftPickOverlay(ctx, state, regions, dispatch, challenge, hoveredId);
  }

  if (state.ui.pendingThirdEyeSelection) {
    drawThirdEyeSelectionModal(ctx, state, regions, dispatch, hoveredId);
  }

  if (showInitiativePopup) {
    drawChallengeInitiativePopup(ctx, state, challenge, regions, hoveredId, dispatch, initiativeKey);
  }

  if (state.ui.challengeFlashText) {
    drawPanel(ctx, width / 2 - 120, height / 2 - 40, 240, 80, "rgba(10,12,18,0.92)", "#4a556d");
    ctx.fillStyle = "#f5f1e6";
    ctx.font = "700 18px 'Cinzel', serif";
    ctx.textAlign = "center";
    ctx.fillText(state.ui.challengeFlashText, width / 2, height / 2 + 6);
  }
}

function drawDraftPickOverlay(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  challenge: GameState["challenge"],
  hoveredId?: string
): void {
  if (!challenge || challenge.phase !== "DRAFT") {
    return;
  }

  const { width, height } = ctx.canvas;
  const overlayId = "draft-pick-block";
  regions.push({
    id: overlayId,
    x: 0,
    y: 0,
    w: width,
    h: height,
    onClick: () => {},
    cursor: "default"
  });
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  const panelW = Math.min(720, width - 60);
  const panelH = Math.min(540, height - 60);
  const panelX = Math.floor(width / 2 - panelW / 2);
  const panelY = Math.floor(height / 2 - panelH / 2);
  drawPanel(ctx, panelX, panelY, panelW, panelH, "rgba(12,16,24,0.96)", "#4a556d");

  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 18px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText("Guardian Draft", panelX + 18, panelY + 30);
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.85)";
  wrapText(ctx, "Rewards unlocked. Players pick in order of AP contribution.", panelW - 36)
    .slice(0, 2)
    .forEach((line, idx) => {
      ctx.fillText(line, panelX + 18, panelY + 52 + idx * 16);
    });

  const pickOrder = challenge.draft?.pickOrderPlayerIds ?? [];
  const contributions = challenge.apContributionByPlayer ?? {};
  const currentPickerId = pickOrder.length > 0
    ? pickOrder[(challenge.draft?.currentPickIndex ?? 0) % pickOrder.length]
    : undefined;
  const currentPickerName = currentPickerId
    ? state.players.find((p) => p.id === currentPickerId)?.name ?? currentPickerId
    : "Unknown";

  ctx.font = "600 12px 'Cinzel', serif";
  ctx.fillStyle = "#f0d88c";
  ctx.fillText(`Current pick: ${currentPickerName}`, panelX + 18, panelY + 80);

  const listX = panelX + 18;
  const listY = panelY + 102;
  const listW = Math.floor((panelW - 54) * 0.45);
  const listH = panelH - 150;
  drawPanel(ctx, listX, listY, listW, listH, "rgba(18,22,30,0.9)", "#39465c");
  ctx.fillStyle = "rgba(245,241,230,0.9)";
  ctx.font = "600 12px 'Cinzel', serif";
  ctx.fillText("Pick Order", listX + 10, listY + 18);

  let orderY = listY + 36;
  ctx.font = "12px 'Source Serif 4', serif";
  pickOrder.forEach((playerId, index) => {
    const name = state.players.find((p) => p.id === playerId)?.name ?? playerId;
    const ap = contributions[playerId] ?? 0;
    const isCurrent = playerId === currentPickerId;
    ctx.fillStyle = isCurrent ? "rgba(240,216,140,0.9)" : "rgba(245,241,230,0.8)";
    ctx.fillText(`${index + 1}. ${name} (${ap} AP)`, listX + 10, orderY);
    orderY += 16;
  });

  const rewardX = listX + listW + 18;
  const rewardY = listY;
  const rewardW = panelW - (rewardX - panelX) - 18;
  const rewardH = listH;
  drawPanel(ctx, rewardX, rewardY, rewardW, rewardH, "rgba(18,22,30,0.9)", "#39465c");
  ctx.fillStyle = "rgba(245,241,230,0.9)";
  ctx.font = "600 12px 'Cinzel', serif";
  ctx.fillText("Unlocked Rewards", rewardX + 10, rewardY + 18);

  const rewards = (challenge.rewardPool?.rewards ?? []).filter((reward) => reward.isUnlocked && !reward.isClaimed);
  if (rewards.length === 0) {
    ctx.font = "12px 'Source Serif 4', serif";
    ctx.fillStyle = "rgba(245,241,230,0.65)";
    ctx.fillText("No unlocked rewards remain.", rewardX + 10, rewardY + 40);
    return;
  }

  const human = state.players.find((p) => !p.isAI);
  const canPick = human && human.id === currentPickerId;
  const rowH = 34;
  let rewardRowY = rewardY + 36;
  rewards.forEach((reward, index) => {
    const label = rewardLabel(reward);
    const id = `draft-pick-${reward.id ?? index}`;
    const isHover = hoveredId === id;
    const isDisabled = !canPick || !reward.id;
    if (isDisabled) {
      drawPanel(ctx, rewardX + 10, rewardRowY, rewardW - 20, rowH, "rgba(20,24,32,0.65)", "#3d475f");
      ctx.fillStyle = "rgba(245,241,230,0.6)";
      ctx.font = "12px 'Cinzel', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, rewardX + 10 + (rewardW - 20) / 2, rewardRowY + rowH / 2);
    } else {
      drawButton(
        ctx,
        regions,
        id,
        rewardX + 10,
        rewardRowY,
        rewardW - 20,
        rowH,
        label,
        () => dispatch({ type: "CHALLENGE_DRAFT_PICK", rewardId: reward.id ?? "" }),
        isHover
      );
    }
    rewardRowY += rowH + 6;
  });
}

function drawThirdEyeSelectionModal(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId?: string
): void {
  const selection = state.ui.pendingThirdEyeSelection;
  const challenge = state.challenge;
  if (!selection || !challenge) {
    return;
  }
  const { width, height } = ctx.canvas;
  const overlayId = "third-eye-block";
  regions.push({
    id: overlayId,
    x: 0,
    y: 0,
    w: width,
    h: height,
    onClick: () => {},
    cursor: "default"
  });
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  const targets = selection.targets.filter((target) => {
    const played = challenge.played[target.playerId];
    if (!played) return false;
    const hiddenIds = played.hiddenCardIds && played.hiddenCardIds.length > 0
      ? played.hiddenCardIds
      : (played.faceDownId ? [played.faceDownId] : []);
    const alreadyRevealed = challenge.revealedEarly.some((entry) => entry.playerId === target.playerId && entry.cardId === target.cardId);
    return hiddenIds.includes(target.cardId) && !alreadyRevealed;
  });
  if (targets.length === 0) {
    return;
  }

  const panelW = Math.min(560, width - 60);
  const panelH = 260;
  const panelX = Math.floor(width / 2 - panelW / 2);
  const panelY = Math.floor(height / 2 - panelH / 2);
  drawPanel(ctx, panelX, panelY, panelW, panelH, "rgba(12,16,24,0.96)", "#4a556d");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 16px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText("Third Eye Awakening", panelX + 18, panelY + 28);
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.8)";
  ctx.fillText("Select one hidden committed card to reveal.", panelX + 18, panelY + 48);

  const cardW = 90;
  const cardH = 120;
  const gap = 24;
  const totalW = targets.length * cardW + (targets.length - 1) * gap;
  const startX = Math.floor(panelX + panelW / 2 - totalW / 2);
  const y = panelY + 70;

  targets.forEach((target, index) => {
    const cardX = startX + index * (cardW + gap);
    const hoverKey = `third-eye-target-${target.playerId}-${index}`;
    const isHover = hoveredId === hoverKey;
    drawCardBack(ctx, cardX, y, cardW, cardH, isHover);
    const playerName = state.players.find((p) => p.id === target.playerId)?.name ?? target.playerId;
    ctx.fillStyle = "rgba(245,241,230,0.85)";
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.textAlign = "center";
    ctx.fillText(playerName, cardX + cardW / 2, y + cardH + 16);
    regions.push({
      id: hoverKey,
      x: cardX,
      y,
      w: cardW,
      h: cardH + 20,
      onClick: () => dispatch({ type: "UI_RESOLVE_THIRD_EYE_TARGET", targetPlayerId: target.playerId, targetCardId: target.cardId }),
      cursor: "pointer"
    });
  });
}

function drawPill(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  type: "spell" | "artifact" | "teaching",
  hovered: boolean
): void {
  if (w <= 0 || h <= 0) {
    return;
  }
  const palette = type === "spell"
    ? { top: "#335a8c", bottom: "#1c2f4b", stroke: "#79b7ff" }
    : type === "artifact"
      ? { top: "#5a4a33", bottom: "#3b2f22", stroke: "#d1b27a" }
      : { top: "#2c6e62", bottom: "#1b453d", stroke: "#7ed9c4" };
  drawCardFrame(ctx, x, y, w, h, palette, hovered);
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "11px 'Source Serif 4', serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 10, y + h / 2);
}

function updateParticles(state: GameState, x: number, y: number, dt: number): void {
  if (state.log.length !== lastParticleLogCount) {
    for (let i = lastParticleLogCount; i < state.log.length; i += 1) {
      const line = state.log[i] ?? "";
      if (line.includes("claims") || line.includes("gains")) {
        const tone = line.includes("Crystals") ? "#6fd6c2" : "#e6c15a";
        spawnBurst(x, y, 10, tone, 3);
      }
    }
    lastParticleLogCount = state.log.length;
  }
  const delta = dt / 1000;
  for (let i = rewardParticles.length - 1; i >= 0; i -= 1) {
    const p = rewardParticles[i];
    p.x += p.vx * delta;
    p.y += p.vy * delta;
    p.vy += 30 * delta;
    p.life -= delta;
    if (p.life <= 0) {
      rewardParticles.splice(i, 1);
    }
  }
}

function drawParticles(ctx: CanvasRenderingContext2D): void {
  rewardParticles.forEach((p) => {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawFxPulses(ctx: CanvasRenderingContext2D): void {
  const now = performance.now();
  for (let i = fxPulses.length - 1; i >= 0; i -= 1) {
    const pulse = fxPulses[i];
    const t = (now - pulse.start) / pulse.duration;
    if (t >= 1) {
      fxPulses.splice(i, 1);
      continue;
    }
    const ease = 1 - Math.pow(1 - t, 2);
    const radius = 70 + ease * 220;
    const alpha = (1 - t) * pulse.strength;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const grad = ctx.createRadialGradient(pulse.x, pulse.y, 0, pulse.x, pulse.y, radius);
    grad.addColorStop(0, withAlpha(pulse.color, alpha));
    grad.addColorStop(1, withAlpha(pulse.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pulse.x, pulse.y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (pulse.label && t < 0.6) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.min(1, alpha * 3);
      ctx.fillStyle = "#f5f1e6";
      ctx.font = "700 13px 'Cinzel', serif";
      ctx.textAlign = "center";
      ctx.fillText(pulse.label, pulse.x, pulse.y + 6);
    }
    ctx.restore();
  }
}

function drawRulesOverlay(
  ctx: CanvasRenderingContext2D,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId?: string
): void {
  const { width, height } = ctx.canvas;
  drawPanel(ctx, width / 2 - 260, height / 2 - 200, 520, 400, "rgba(8,10,16,0.95)", "#4a556d");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 18px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.fillText("Ascension Earth Rules", width / 2, height / 2 - 160);
  ctx.textAlign = "left";
  ctx.font = "12px 'Source Serif 4', serif";
  const lines = [
    "Turn Phases: Roll Reward Pools, Action Phase, Challenge Phase.",
    "Actions: Meditate draws 2 Game Cards. Journeys roll for Teaching/Invocation rewards; Meditate claims pending rewards.",
    "Mountain/Cave Journey: solo claims rewards immediately; if contested, resolve Challenge.",
    "Earth Advancement spends Crystals to gain Ascension Power and rewards.",
    "Challenge: Commit up to 3 items total (Game Cards and/or Invocations). Only your FIRST committed Game Card is face-down; the rest are face-up.",
    "After Reveal and Resolve, all played game cards are discarded (invocations are always discarded).",
    "Guardian Challenge: Total group AP unlocks rewards; unlocked rewards are drafted in contribution order."
  ];
  lines.forEach((line, idx) => {
    ctx.fillText(line, width / 2 - 230, height / 2 - 120 + idx * 20);
  });

  drawButton(ctx, regions, "close-rules", width / 2 - 60, height / 2 + 150, 120, 36, "Close", () => {
    dispatch({ type: "TOGGLE_RULES" });
  }, hoveredId === "close-rules");
}

function drawMenuOverlay(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId: string | undefined,
  layout: Layout
): void {
  const panelW = 200;
  const panelH = state.ui.debugEnabled ? 396 : 360;
  const x = layout.topBar.x + layout.topBar.w - panelW;
  const y = layout.topBar.y + layout.topBar.h + layout.gap;
  drawPanel(ctx, x, y, panelW, panelH, "rgba(10,12,18,0.92)", "#3a465e");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 13px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText("Game Menu", x + 14, y + 24);

  drawButton(ctx, regions, "menu-restart", x + 16, y + 38, 168, 32, "Restart", () => {
    dispatch({ type: "SET_SEED", seed: state.seed });
    dispatch({ type: "START_GAME" });
  }, hoveredId === "menu-restart");

  drawButton(ctx, regions, "menu-exit", x + 16, y + 76, 168, 32, "Exit", () => {
    dispatch({ type: "GO_MENU" });
  }, hoveredId === "menu-exit");

  drawButton(ctx, regions, "menu-rules", x + 16, y + 114, 168, 28, "Rules", () => {
    dispatch({ type: "TOGGLE_RULES" });
    dispatch({ type: "TOGGLE_MENU" });
  }, hoveredId === "menu-rules");

  drawButton(ctx, regions, "menu-hotseat", x + 16, y + 146, 168, 28, "Hotseat", () => {
    dispatch({ type: "TOGGLE_HOTSEAT" });
    dispatch({ type: "TOGGLE_MENU" });
  }, hoveredId === "menu-hotseat");

  const speedLabel = `Speed: ${gameSpeedLabel(state.settings.gameSpeedMode)}`;
  drawButton(ctx, regions, "menu-speed", x + 16, y + 178, 168, 28, speedLabel, () => {
    const nextMode = nextGameSpeedMode(state.settings.gameSpeedMode);
    dispatch({ type: "SET_GAME_SPEED", mode: nextMode });
    savePreferences({
      gameSpeedMode: nextMode,
      soundEnabled: state.ui.soundEnabled ?? true,
      musicEnabled: state.ui.musicEnabled ?? true,
      musicVolume: state.ui.musicVolume ?? 45
    });
  }, hoveredId === "menu-speed");

  const soundLabel = state.ui.soundEnabled ? "Sound: ON" : "Sound: OFF";
  drawButton(ctx, regions, "menu-sound", x + 16, y + 210, 168, 28, soundLabel, () => {
    const nextEnabled = !state.ui.soundEnabled;
    setSoundEnabled(nextEnabled);
    if (nextEnabled) {
      activateSound();
    }
    dispatch({ type: "TOGGLE_SOUND" });
    savePreferences({
      soundEnabled: nextEnabled,
      musicEnabled: state.ui.musicEnabled ?? true,
      musicVolume: state.ui.musicVolume ?? 45,
      gameSpeedMode: state.settings.gameSpeedMode
    });
  }, hoveredId === "menu-sound");

  const musicLabel = state.ui.musicEnabled ? "Music: ON" : "Music: OFF";
  drawButton(ctx, regions, "menu-music", x + 16, y + 242, 168, 28, musicLabel, () => {
    const nextEnabled = !(state.ui.musicEnabled ?? true);
    setMusicEnabled(nextEnabled);
    if (nextEnabled) {
      activateSound();
    }
    dispatch({ type: "TOGGLE_MUSIC" });
    savePreferences({
      soundEnabled: state.ui.soundEnabled ?? true,
      musicEnabled: nextEnabled,
      musicVolume: state.ui.musicVolume ?? 45,
      gameSpeedMode: state.settings.gameSpeedMode
    });
  }, hoveredId === "menu-music");

  const volumeValue = clampValue(state.ui.musicVolume ?? 45, 0, 100);
  const volY = y + 274;
  const volX = x + 16;
  const volW = 168;
  const volBtnW = 44;
  const volGap = 6;
  const volLabelW = volW - volBtnW * 2 - volGap * 2;
  const volLabelX = volX + volBtnW + volGap;
  drawButton(ctx, regions, "menu-music-down", volX, volY, volBtnW, 28, "-", () => {
    const nextVolume = clampValue(volumeValue - 10, 0, 100);
    setMusicVolume(nextVolume / 100);
    dispatch({ type: "SET_MUSIC_VOLUME", value: nextVolume });
    savePreferences({
      soundEnabled: state.ui.soundEnabled ?? true,
      musicEnabled: state.ui.musicEnabled ?? true,
      musicVolume: nextVolume,
      gameSpeedMode: state.settings.gameSpeedMode
    });
  }, hoveredId === "menu-music-down");
  drawPanel(ctx, volLabelX, volY, volLabelW, 28, "rgba(20,24,32,0.75)", "#3d475f");
  ctx.fillStyle = "rgba(245,241,230,0.85)";
  ctx.font = "600 11px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.fillText(`Vol ${volumeValue}%`, volLabelX + volLabelW / 2, volY + 18);
  drawButton(ctx, regions, "menu-music-up", volLabelX + volLabelW + volGap, volY, volBtnW, 28, "+", () => {
    const nextVolume = clampValue(volumeValue + 10, 0, 100);
    setMusicVolume(nextVolume / 100);
    dispatch({ type: "SET_MUSIC_VOLUME", value: nextVolume });
    savePreferences({
      soundEnabled: state.ui.soundEnabled ?? true,
      musicEnabled: state.ui.musicEnabled ?? true,
      musicVolume: nextVolume,
      gameSpeedMode: state.settings.gameSpeedMode
    });
  }, hoveredId === "menu-music-up");

  const debugLabel = state.ui.debugEnabled ? "Debug: ON" : "Debug: OFF";
  drawButton(ctx, regions, "menu-debug", x + 16, y + 306, 168, 28, debugLabel, () => {
    dispatch({ type: "TOGGLE_DEBUG" });
    dispatch({ type: "TOGGLE_MENU" });
  }, hoveredId === "menu-debug");

  if (state.ui.debugEnabled) {
    ctx.fillStyle = "rgba(245,241,230,0.7)";
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.textAlign = "left";
    const seedLines = wrapText(ctx, `Seed: ${state.seed}`, panelW - 28);
    let seedY = y + panelH - 12 - (seedLines.length - 1) * 14;
    seedLines.forEach((line) => {
      ctx.fillText(line, x + 14, seedY);
      seedY += 14;
    });
  }
}


function drawShopOverlay(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId?: string
): void {
  const { width, height } = ctx.canvas;
  const human = state.players.find((p) => !p.isAI);
  if (!human) return;

  const w = Math.min(740, width - 40);
  const h = Math.min(580, height - 60);
  const x = width / 2 - w / 2;
  const y = height / 2 - h / 2;
  drawPanel(ctx, x, y, w, h, "rgba(8,10,16,0.96)", "#4a556d");

  const aiThinking = state.ui.aiStatus && state.ui.activeHighlightScope === "SHOP";
  const contentX = x + 18;
  const contentW = w - 36;
  const inputLocked = !!aiThinking;

  // Header
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 18px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText("Crystal Shop", contentX, y + 32);

  // Crystals pill
  const fundsPillW = 150;
  const fundsPillH = 26;
  const fundsX = x + w - fundsPillW - 104;
  const fundsY = y + 18;
  drawRoundedRect(ctx, fundsX, fundsY, fundsPillW, fundsPillH, 12);
  ctx.fillStyle = "rgba(22,26,34,0.9)";
  ctx.fill();
  ctx.strokeStyle = "#6fd6c2";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#c9f0e6";
  ctx.font = "600 12px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.fillText(`${human.crystals} CRYSTALS`, fundsX + fundsPillW / 2, fundsY + 17);

  if (aiThinking) {
    drawAiThinkingIndicator(ctx, state.ui.aiStatus!.message, contentX, y + 46, contentW, 26);
  }

  let cursorY = y + (aiThinking ? 82 : 52);

  // Purchase limits
  const hasDoctrine = human.passiveTeachings.includes("doctrine_of_abundance");
  const cardPurchases = human.purchasesCardThisTurn ?? 0;
  const spellPurchases = human.purchasesSpellThisTurn ?? 0;
  const totalPurchases = cardPurchases + spellPurchases;
  const cardLimit = hasDoctrine ? 2 : 1;
  const spellLimit = hasDoctrine ? 2 : 1;
  const canBuyCardLimit = hasDoctrine ? cardPurchases < cardLimit : totalPurchases < 1;
  const canBuySpellLimit = hasDoctrine ? spellPurchases < spellLimit : totalPurchases < 1;
  const canAffordCard = human.crystals >= SHOP_CARD_COST;
  const canAffordSpell = human.crystals >= SHOP_INVOCATION_COST;
  const hasInvSlot = hasFreeInvocationSlot(human);

  const limitLine = hasDoctrine
    ? `Purchases: Cards ${cardPurchases}/${cardLimit} · Invocations ${spellPurchases}/${spellLimit}`
    : `Purchases: ${totalPurchases}/1 this turn`;
  ctx.fillStyle = "rgba(245,241,230,0.6)";
  ctx.font = "11px 'Source Serif 4', serif";
  ctx.textAlign = "left";
  ctx.fillText(limitLine, contentX, cursorY);
  cursorY += 16;

  // --- GAME CARDS SECTION ---
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 13px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText(`Game Cards — ${formatCrystals(SHOP_CARD_COST)} Crystals each`, contentX, cursorY + 12);
  cursorY += 22;

  const cardW = 96;
  const cardH = 128;
  const cardGap = 12;
  const offerings = state.shopOfferings;
  const totalCardsW = 3 * cardW + 2 * cardGap;
  const cardStartX = contentX + (contentW - totalCardsW) / 2;

  for (let i = 0; i < 3; i++) {
    const cid = offerings.cards[i];
    const cx = cardStartX + i * (cardW + cardGap);
    const cy = cursorY;
    if (cid) {
      const cardData = dataStore.cardsById[cid];
      if (cardData) {
        const isHov = hoveredId === `shop-card-${i}`;
        drawCard(ctx, cardData, cx, cy, cardW, cardH, isHov, false);
        // TP value label below card
        const tp = cardData.teachingPower ?? cardData.basePower ?? 0;
        ctx.fillStyle = "rgba(245,241,230,0.65)";
        ctx.font = "9px 'Source Serif 4', serif";
        ctx.textAlign = "center";
        ctx.fillText(`AP:${cardData.basePower}  TP:${tp}`, cx + cardW / 2, cy + cardH + 12);
        // Buy button / hit region
        const canBuyThis = canBuyCardLimit && canAffordCard && !inputLocked;
        if (canBuyThis) {
          regions.push({
            id: `shop-card-${i}`,
            x: cx, y: cy, w: cardW, h: cardH,
            onClick: () => dispatch({ type: "BUY_SHOP_CARD", cardId: cid }),
            cursor: "pointer"
          });
        }
      }
    } else {
      // Empty slot
      drawPanel(ctx, cx, cy, cardW, cardH, "rgba(20,24,32,0.6)", "#3d475f");
      ctx.fillStyle = "rgba(245,241,230,0.3)";
      ctx.font = "11px 'Source Serif 4', serif";
      ctx.textAlign = "center";
      ctx.fillText("Sold", cx + cardW / 2, cy + cardH / 2 + 4);
    }
  }

  if (!canBuyCardLimit) {
    ctx.fillStyle = "rgba(245,201,140,0.7)";
    ctx.font = "10px 'Source Serif 4', serif";
    ctx.textAlign = "right";
    ctx.fillText("Card purchase limit reached", contentX + contentW, cursorY + 6);
  } else if (!canAffordCard) {
    ctx.fillStyle = "rgba(245,201,140,0.7)";
    ctx.font = "10px 'Source Serif 4', serif";
    ctx.textAlign = "right";
    ctx.fillText(`Need ${formatCrystals(SHOP_CARD_COST)} Crystals`, contentX + contentW, cursorY + 6);
  }

  cursorY += cardH + 26;

  // --- INVOCATIONS SECTION ---
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 13px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText(`Invocations — ${formatCrystals(SHOP_INVOCATION_COST)} Crystals each`, contentX, cursorY + 12);

  const slotText = `Slots: ${human.spells.length}/${INVOCATION_SLOT_MAX}`;
  ctx.fillStyle = "rgba(245,241,230,0.5)";
  ctx.font = "10px 'Source Serif 4', serif";
  ctx.textAlign = "right";
  ctx.fillText(slotText, contentX + contentW, cursorY + 12);
  cursorY += 22;

  const invStartX = contentX + (contentW - totalCardsW) / 2;

  for (let i = 0; i < 3; i++) {
    const sid = offerings.invocations[i];
    const sx = invStartX + i * (cardW + cardGap);
    const sy = cursorY;
    if (sid) {
      const isHov = hoveredId === `shop-inv-${i}`;
      drawInvocationCard(ctx, sid, sx, sy, cardW, cardH, false, true);
      if (isHov) {
        ctx.strokeStyle = "rgba(200,180,120,0.6)";
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, sx - 1, sy - 1, cardW + 2, cardH + 2, 10);
        ctx.stroke();
      }
      const canBuyThis = canBuySpellLimit && canAffordSpell && hasInvSlot && !inputLocked;
      if (canBuyThis) {
        regions.push({
          id: `shop-inv-${i}`,
          x: sx, y: sy, w: cardW, h: cardH,
          onClick: () => dispatch({ type: "BUY_SHOP_SPELL", spellId: sid }),
          cursor: "pointer"
        });
      }
    } else {
      drawPanel(ctx, sx, sy, cardW, cardH, "rgba(20,24,32,0.6)", "#3d475f");
      ctx.fillStyle = "rgba(245,241,230,0.3)";
      ctx.font = "11px 'Source Serif 4', serif";
      ctx.textAlign = "center";
      ctx.fillText("Sold", sx + cardW / 2, sy + cardH / 2 + 4);
    }
  }

  if (!canBuySpellLimit) {
    ctx.fillStyle = "rgba(245,201,140,0.7)";
    ctx.font = "10px 'Source Serif 4', serif";
    ctx.textAlign = "right";
    ctx.fillText("Invocation purchase limit reached", contentX + contentW, cursorY + 6);
  } else if (!canAffordSpell) {
    ctx.fillStyle = "rgba(245,201,140,0.7)";
    ctx.font = "10px 'Source Serif 4', serif";
    ctx.textAlign = "right";
    ctx.fillText(`Need ${formatCrystals(SHOP_INVOCATION_COST)} Crystals`, contentX + contentW, cursorY + 6);
  } else if (!hasInvSlot) {
    ctx.fillStyle = "rgba(245,201,140,0.7)";
    ctx.font = "10px 'Source Serif 4', serif";
    ctx.textAlign = "right";
    ctx.fillText("No free Invocation slot", contentX + contentW, cursorY + 6);
  }

  cursorY += cardH + 20;

  // Sell mode footer
  drawRoundedRect(ctx, contentX, cursorY, 120, 24, 10);
  ctx.fillStyle = "rgba(20,24,32,0.9)";
  ctx.fill();
  ctx.strokeStyle = "#d6b45c";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#f5e9c8";
  ctx.font = "600 11px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.fillText("SELL MODE: ON", contentX + 60, cursorY + 16);

  ctx.fillStyle = "rgba(245,241,230,0.65)";
  ctx.font = "11px 'Source Serif 4', serif";
  ctx.textAlign = "left";
  ctx.fillText("Click your cards/invocations/artifacts/teachings below to sell.", contentX + 132, cursorY + 16);

  // Close button
  if (!inputLocked) {
    drawButton(ctx, regions, "shop-close", x + w - 92, y + 12, 74, 30, "Close", () => dispatch({ type: "TOGGLE_SHOP" }), hoveredId === "shop-close");
  } else {
    drawPanel(ctx, x + w - 92, y + 12, 74, 30, "rgba(20,24,32,0.65)", "#3d475f");
    ctx.fillStyle = "rgba(245,241,230,0.6)";
    ctx.font = "12px 'Cinzel', serif";
    ctx.textAlign = "center";
    ctx.fillText("Close", x + w - 55, y + 31);
  }
}

function nameForPlayerId(state: GameState, playerId: string | undefined): string {
  if (!playerId) return "No winner";
  return state.players.find((player) => player.id === playerId)?.name ?? playerId;
}

function drawProgressReviewModal(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId?: string
): void {
  const review = state.ui.progressReview as ProgressReviewState | undefined;
  if (!review) return;

  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  const panelW = Math.min(920, width - 36);
  const panelH = Math.min(620, height - 36);
  const x = Math.floor((width - panelW) / 2);
  const y = Math.floor((height - panelH) / 2);
  drawPanel(ctx, x, y, panelW, panelH, "rgba(9,12,18,0.97)", "#5b6f8f");

  const winner = review.winnerPlayerId
    ? state.players.find((player) => player.id === review.winnerPlayerId)
    : undefined;
  const winnerIsHuman = !!winner && !winner.isAI;
  const canChoose = winnerIsHuman && !review.resolved;

  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 20px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText(`Progress Review - Round ${review.reviewRound}`, x + 20, y + 34);

  ctx.fillStyle = "rgba(245,241,230,0.85)";
  ctx.font = "12px 'Source Serif 4', serif";
  const baselineLine =
    `Baseline: Crystals >= ${review.baseline.minCrystals} OR Teachings >= ${review.baseline.minTeachings}`;
  ctx.fillText(baselineLine, x + 20, y + 58);
  const passers = review.baselinePasserIds.map((id) => nameForPlayerId(state, id));
  const passersText = passers.length > 0 ? passers.join(", ") : "None";
  wrapText(ctx, `Baseline passers: ${passersText}`, panelW - 40).forEach((line, idx) => {
    ctx.fillText(line, x + 20, y + 78 + idx * 16);
  });

  ctx.fillStyle = "#d6e3ff";
  ctx.font = "600 14px 'Cinzel', serif";
  const categoryY = y + 118;
  ctx.fillText(`Category: ${review.categoryName}`, x + 20, categoryY);
  ctx.fillStyle = "rgba(245,241,230,0.9)";
  ctx.font = "12px 'Source Serif 4', serif";
  wrapText(ctx, review.winnerExplanation, panelW - 40).forEach((line, idx) => {
    ctx.fillText(line, x + 20, categoryY + 22 + idx * 16);
  });

  const winnerName = nameForPlayerId(state, review.winnerPlayerId);
  ctx.fillStyle = winner ? "#9cf7c4" : "#ffb3b3";
  ctx.font = "600 13px 'Cinzel', serif";
  ctx.fillText(`Winner: ${winnerName}`, x + 20, y + 190);

  const cardY = y + 208;
  const cardGap = 12;
  const cardW = Math.floor((panelW - 40 - cardGap * 2) / 3);
  const cardH = 248;
  review.trophyOptions.forEach((option, idx) => {
    const cardX = x + 20 + idx * (cardW + cardGap);
    const selected = review.selectedTrophyId === option.id;
    drawPanel(
      ctx,
      cardX,
      cardY,
      cardW,
      cardH,
      selected ? "rgba(28,46,64,0.94)" : "rgba(20,26,38,0.9)",
      selected ? "#8ec7ff" : "#4a5a73"
    );

    ctx.fillStyle = "#f5f1e6";
    ctx.font = "600 14px 'Cinzel', serif";
    wrapText(ctx, option.name, cardW - 18).slice(0, 2).forEach((line, lineIndex) => {
      ctx.fillText(line, cardX + 10, cardY + 24 + lineIndex * 16);
    });

    ctx.fillStyle = "rgba(245,241,230,0.85)";
    ctx.font = "12px 'Source Serif 4', serif";
    wrapText(ctx, option.shortDescription, cardW - 18).slice(0, 5).forEach((line, lineIndex) => {
      ctx.fillText(line, cardX + 10, cardY + 62 + lineIndex * 15);
    });

    ctx.fillStyle = "#9cf7c4";
    ctx.font = "600 12px 'Cinzel', serif";
    ctx.fillText(`Reward: +${option.rewardAp} AP`, cardX + 10, cardY + 158);
    if (option.winnerExplanation) {
      ctx.fillStyle = "rgba(245,241,230,0.8)";
      ctx.font = "11px 'Source Serif 4', serif";
      wrapText(ctx, `Why: ${option.winnerExplanation}`, cardW - 18).slice(0, 2).forEach((line, lineIndex) => {
        ctx.fillText(line, cardX + 10, cardY + 175 + lineIndex * 13);
      });
    }
    if (option.passiveBuff) {
      ctx.fillStyle = "rgba(210,235,255,0.9)";
      ctx.font = "11px 'Source Serif 4', serif";
      wrapText(ctx, `Passive: ${option.passiveBuff.description}`, cardW - 18).slice(0, 2).forEach((line, lineIndex) => {
        ctx.fillText(line, cardX + 10, cardY + 203 + lineIndex * 13);
      });
    }

    if (canChoose) {
      const btnId = `review-trophy-${option.id}`;
      drawButton(ctx, regions, btnId, cardX + 10, cardY + cardH - 40, cardW - 20, 30, "Choose Trophy", () => {
        dispatch({ type: "UI_SELECT_TROPHY", trophyId: option.id });
      }, hoveredId === btnId);
    } else if (selected) {
      ctx.fillStyle = "#8ec7ff";
      ctx.font = "600 12px 'Cinzel', serif";
      ctx.textAlign = "center";
      ctx.fillText("Selected", cardX + cardW / 2, cardY + cardH - 16);
      ctx.textAlign = "left";
    }
  });

  if (review.selectedTrophyId && review.selectedRewardAp !== undefined) {
    const selectedName = review.trophyOptions.find((option) => option.id === review.selectedTrophyId)?.name ?? "Trophy";
    const selectedBy = nameForPlayerId(state, review.selectedByPlayerId);
    const passive = review.selectedPassiveBuffText ? ` ${review.selectedPassiveBuffText}` : "";
    ctx.fillStyle = "rgba(245,241,230,0.92)";
    ctx.font = "12px 'Source Serif 4', serif";
    wrapText(
      ctx,
      `${selectedBy} claimed ${selectedName} for +${review.selectedRewardAp} AP.${passive}`,
      panelW - 40
    ).forEach((line, idx) => {
      ctx.fillText(line, x + 20, y + panelH - 72 + idx * 16);
    });
  } else if (winner && !winnerIsHuman) {
    ctx.fillStyle = "rgba(245,241,230,0.92)";
    ctx.font = "12px 'Source Serif 4', serif";
    ctx.fillText("AI winner auto-selected a trophy reward.", x + 20, y + panelH - 54);
  } else if (!winner) {
    ctx.fillStyle = "rgba(245,241,230,0.92)";
    ctx.font = "12px 'Source Serif 4', serif";
    ctx.fillText("No trophy awarded this review round.", x + 20, y + panelH - 54);
  } else {
    ctx.fillStyle = "rgba(245,241,230,0.92)";
    ctx.font = "12px 'Source Serif 4', serif";
    ctx.fillText("Choose one trophy to continue.", x + 20, y + panelH - 54);
  }

  if (!canChoose) {
    drawButton(
      ctx,
      regions,
      "review-continue",
      x + panelW - 164,
      y + panelH - 48,
      144,
      34,
      "Continue",
      () => dispatch({ type: "UI_CLOSE_PROGRESS_REVIEW" }),
      hoveredId === "review-continue"
    );
  }
}

function drawSellConfirmModal(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId?: string
): void {
  const pending = state.ui.pendingSell;
  if (!pending) return;

  // Backdrop
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();

  const w = Math.min(560, ctx.canvas.width - 60);
  const h = 220;
  const x = Math.floor((ctx.canvas.width - w) / 2);
  const y = Math.floor((ctx.canvas.height - h) / 2);

  drawPanel(ctx, x, y, w, h, "rgba(24,30,40,0.95)", "#52607a");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 16px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText("Confirm Sale", x + 18, y + 32);

  ctx.font = "14px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.92)";
  const crystalText = `${pending.crystals} Crystal${pending.crystals === 1 ? "" : "s"}`;
  wrapText(ctx, `Sell ${pending.label} for ${crystalText}?`, w - 36).forEach((line, i) => {
    ctx.fillText(line, x + 18, y + 70 + i * 18);
  });

  const btnW = 140;
  const btnH = 38;
  const btnY = y + h - btnH - 18;
  const yesId = "sell-confirm-yes";
  const noId = "sell-confirm-no";
  drawButton(ctx, regions, yesId, x + w - btnW - 18, btnY, btnW, btnH, "Yes, sell", () => {
    dispatch({ type: "UI_CONFIRM_SELL" });
  }, hoveredId === yesId);

  drawButton(ctx, regions, noId, x + w - btnW * 2 - 30, btnY, btnW, btnH, "No", () => {
    dispatch({ type: "UI_CANCEL_SELL" });
  }, hoveredId === noId);
}

function drawGameOver(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId?: string
): void {
  const { width, height } = ctx.canvas;
  const panelW = Math.min(660, width - 40);
  const panelH = Math.min(460, height - 40);
  const x = width / 2 - panelW / 2;
  const y = height / 2 - panelH / 2;
  drawPanel(ctx, x, y, panelW, panelH, "rgba(8,10,16,0.96)", "#4a556d");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 20px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.fillText("EARTH HAS ASCENDED", width / 2, y + 34);

  ctx.font = "14px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.82)";
  ctx.fillText("All players win as Earth ascends.", width / 2, y + 58);

  const tab = state.ui.gameOverTab ?? "SUMMARY";
  const tabW = 140;
  const tabH = 28;
  const tabGap = 16;
  const tabsX = width / 2 - (tabW * 2 + tabGap) / 2;
  const tabsY = y + 76;
  const summaryLabel = tab === "SUMMARY" ? "Summary *" : "Summary";
  const achievementLabel = tab === "ACHIEVEMENTS" ? "Achievements *" : "Achievements";
  drawButton(ctx, regions, "gameover-summary", tabsX, tabsY, tabW, tabH, summaryLabel, () => {
    dispatch({ type: "UI_SET_GAME_OVER_TAB", tab: "SUMMARY" });
  }, hoveredId === "gameover-summary");
  drawButton(ctx, regions, "gameover-achievements", tabsX + tabW + tabGap, tabsY, tabW, tabH, achievementLabel, () => {
    dispatch({ type: "UI_SET_GAME_OVER_TAB", tab: "ACHIEVEMENTS" });
  }, hoveredId === "gameover-achievements");

  const scores = state.players.map((player) => {
    const scoring = finalScoreWithAchievements(state, player);
    return {
      player,
      total: scoring.total,
      base: scoring.base,
      bonuses: scoring.bonuses,
      bonusTotal: scoring.total - scoring.base
    };
  });

  const contentX = x + 28;
  const contentY = y + 118;
  const contentW = panelW - 56;

  if (tab === "SUMMARY") {
    const maxTotal = Math.max(...scores.map((s) => s.total));
    const top = scores.filter((s) => s.total === maxTotal);
    const winnerLabel =
      top.length === 1
        ? `Highest Achievement Score: ${top[0].player.name} (${top[0].total})`
        : `Highest Achievement Score: ${top.map((s) => s.player.name).join(", ")} (${maxTotal})`;
    ctx.fillStyle = "#f5f1e6";
    ctx.font = "600 14px 'Cinzel', serif";
    wrapText(ctx, winnerLabel, contentW).forEach((line, idx) => {
      ctx.fillText(line, width / 2, contentY + idx * 18);
    });

    ctx.font = "13px 'Source Serif 4', serif";
    ctx.fillStyle = "rgba(245,241,230,0.9)";
    scores.forEach((entry, idx) => {
      const line = `${entry.player.name}: ${entry.total} total (Base ${entry.base} + Bonus ${entry.bonusTotal})`;
      ctx.fillText(line, width / 2, contentY + 26 + idx * 22);
    });
  } else {
    ctx.textAlign = "left";
    let rowY = contentY;
    scores.forEach((entry) => {
      ctx.fillStyle = "#f5f1e6";
      ctx.font = "600 14px 'Cinzel', serif";
      ctx.fillText(`${entry.player.name} (+${entry.bonusTotal} AP)`, contentX, rowY);
      rowY += 20;
      ctx.font = "12px 'Source Serif 4', serif";
      ctx.fillStyle = "rgba(245,241,230,0.85)";
      if (entry.bonuses.length === 0) {
        ctx.fillText("No achievement bonuses earned.", contentX + 8, rowY);
        rowY += 18;
      } else {
        entry.bonuses.forEach((bonus) => {
          const lines = wrapText(ctx, `- ${bonus.title} (+${bonus.bonus} AP)`, contentW - 12);
          lines.forEach((line) => {
            ctx.fillText(line, contentX + 8, rowY);
            rowY += 16;
          });
        });
      }
      rowY += 10;
    });
    ctx.textAlign = "center";
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.fillStyle = "rgba(245,241,230,0.6)";
    ctx.fillText("Achievement bonuses are capped to the top two per player.", width / 2, y + panelH - 82);
  }

  drawButton(ctx, regions, "menu", width / 2 - 70, y + panelH - 60, 140, 40, "Main Menu", () => {
    dispatch({ type: "GO_MENU" });
  }, hoveredId === "menu");
}

function drawDevOverlay(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  hoveredId?: string | null
): void {
  const { width, height } = ctx.canvas;

  // Backdrop
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // Panel
  const panelW = 480;
  const panelH = 400;
  const panelX = width / 2 - panelW / 2;
  const panelY = height / 2 - panelH / 2;

  drawPanel(ctx, panelX, panelY, panelW, panelH, "rgba(20,24,32,0.98)", "#6b7b92");

  // Header
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "700 18px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.fillText("Developer Options", panelX + panelW / 2, panelY + 28);

  // Close button
  drawButton(ctx, regions, "dev-close", panelX + panelW - 90, panelY + 10, 80, 30, "Close", () => {
    dispatch({ type: "TOGGLE_DEBUG" });
  }, hoveredId === "dev-close");

  // Tab buttons
  const tabW = panelW / 2 - 12;
  const tabH = 32;
  const tabY = panelY + 50;
  const activeTab = state.ui.devPanelTab ?? "TEACHINGS";

  drawButton(ctx, regions, "dev-tab-teachings", panelX + 8, tabY, tabW, tabH, "Teachings", () => {
    dispatch({ type: "SET_DEV_TAB", tab: "TEACHINGS" });
  }, activeTab === "TEACHINGS");

  drawButton(ctx, regions, "dev-tab-artifacts", panelX + 8 + tabW + 8, tabY, tabW, tabH, "Artifacts", () => {
    dispatch({ type: "SET_DEV_TAB", tab: "ARTIFACTS" });
  }, activeTab === "ARTIFACTS");

  // Scrollable list area
  const listY = tabY + tabH + 12;
  const listH = panelH - tabH - 80;
  const itemH = 28;
  const scroll = state.ui.devPanelScroll ?? 0;

  // Draw list background
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(panelX + 8, listY, panelW - 40, listH);

  // Clip region for list
  ctx.save();
  ctx.beginPath();
  ctx.rect(panelX + 8, listY, panelW - 40, listH);
  ctx.clip();

  const items = activeTab === "TEACHINGS"
    ? dataStore.teachings.map(t => ({ id: t.id, name: t.name, tier: t.tier }))
    : dataStore.artifacts.map(a => ({ id: a.id, name: a.name, tier: a.value >= 10 ? "rare" : "basic" }));

  const visibleStart = Math.floor(scroll / itemH);
  const visibleEnd = Math.min(items.length, Math.ceil((scroll + listH) / itemH));

  for (let i = visibleStart; i < visibleEnd; i++) {
    const item = items[i];
    const y = listY + i * itemH - scroll;
    const isHovered = hoveredId === `dev-item-${item.id}`;

    // Item background
    ctx.fillStyle = isHovered ? "rgba(100,120,150,0.5)" : (i % 2 === 0 ? "rgba(40,50,60,0.6)" : "rgba(50,60,70,0.6)");
    ctx.fillRect(panelX + 8, y, panelW - 48, itemH - 2);

    // Item text
    ctx.fillStyle = "#f5f1e6";
    ctx.font = "13px 'Source Serif 4', serif";
    ctx.textAlign = "left";
    ctx.fillText(`${item.name} (${item.tier})`, panelX + 16, y + 19);

    // Click region
    regions.push({
      id: `dev-item-${item.id}`,
      x: panelX + 8,
      y: y,
      w: panelW - 48,
      h: itemH - 2,
      onClick: () => {
        if (activeTab === "TEACHINGS") {
          dispatch({ type: "DEV_GRANT_TEACHING", id: item.id });
        } else {
          dispatch({ type: "DEV_GRANT_ARTIFACT", id: item.id });
        }
      },
      cursor: "pointer"
    });
  }

  ctx.restore();

  // Scrollbar
  const maxScroll = Math.max(0, items.length * itemH - listH);
  if (maxScroll > 0) {
    const scrollBarH = Math.max(40, listH * (listH / (items.length * itemH)));
    const scrollBarY = listY + (scroll / maxScroll) * (listH - scrollBarH);
    ctx.fillStyle = "rgba(100,110,130,0.7)";
    ctx.fillRect(panelX + panelW - 28, scrollBarY, 16, scrollBarH);
  }

  // Scroll buttons
  drawButton(ctx, regions, "dev-scroll-up", panelX + panelW - 30, listY, 20, 24, "▲", () => {
    const current = state.ui.devPanelScroll ?? 0;
    dispatch({ type: "SET_DEV_SCROLL", value: Math.max(0, current - itemH * 3) });
  }, false);

  drawButton(ctx, regions, "dev-scroll-down", panelX + panelW - 30, listY + listH - 24, 20, 24, "▼", () => {
    const current = state.ui.devPanelScroll ?? 0;
    dispatch({ type: "SET_DEV_SCROLL", value: Math.min(maxScroll, current + itemH * 3) });
  }, false);

  // Info text
  ctx.fillStyle = "#8a8a8a";
  ctx.font = "11px 'Source Serif 4', serif";
  ctx.textAlign = "center";
  ctx.fillText("Click items to grant to your player", panelX + panelW / 2, panelY + panelH - 12);
}
