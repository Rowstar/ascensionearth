import { GameAction, GameState, ChallengeParticipantResult, ChallengeResult } from "../engine/types";
import { drawButton, drawPanel } from "../render/ui";
import { HitRegion } from "../render/canvas";
import { wrapText } from "../render/text";
type ChallengeResultMode = "verdict" | "details";
type ChallengeResultTab = "POWER" | "PLAYED" | "REWARDS";

type PowerTotals = {
  cards: number;
  invocations: number;
  effects: number;
  total: number;
  hasInvocations: boolean;
};

const ICONS = {
  cards: "[Cards]",
  invocations: "[Inv]",
  effects: "[AP]"
};

let modalOpenTime = 0; // timestamp when modal first appeared
let verdictStaggerStart = 0; // timestamp for row stagger in verdict view
const MODAL_SLIDE_MS = 400;
const STAGGER_DELAY_MS = 120; // delay between each row appearing
const STAGGER_FADE_MS = 250; // how long each row takes to fade in
function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }

/** Returns alpha (0..1) for a staggered row at the given index. */
function staggerAlpha(index: number, now: number): number {
  if (verdictStaggerStart === 0) return 1;
  const rowStart = verdictStaggerStart + index * STAGGER_DELAY_MS;
  const elapsed = now - rowStart;
  if (elapsed <= 0) return 0;
  return Math.min(1, elapsed / STAGGER_FADE_MS);
}

const parsePowerValue = (line: string): number | null => {
  const match = line.match(/\(\+(-?\d+)\s+(Power|AP)\)/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
};

const stripParenSuffix = (line: string): string => line.replace(/\s*\(.*\)\s*$/, "").trim();

const getOutcomeText = (p?: ChallengeParticipantResult): { banner: string; explanation: string } => {
  if (!p) {
    return { banner: "RITE COMPLETE", explanation: "The Guardian Challenge resolves through collective contribution." };
  }
  if (p.withdrew) {
    return { banner: "WITHDRAWN", explanation: "You withdrew from the rite and preserved uncommitted cards." };
  }
  return { banner: "RITE COMPLETE", explanation: "Rewards are unlocked by total AP and drafted by contribution." };
};

const computePowerTotals = (p: ChallengeParticipantResult): PowerTotals => {
  let cards = 0;
  let invocations = 0;
  let effects = 0;
  let hasInvocations = false;

  (p.powerBreakdown ?? []).forEach((line) => {
    const value = parsePowerValue(line) ?? 0;
    if (line.startsWith("Invocation:")) {
      invocations += value;
      hasInvocations = true;
      return;
    }
    if (line.includes("from invocation") || line.includes("from teaching") || line.includes("from artifact")) {
      effects += value;
      return;
    }
    if (line.includes("from card") || line.startsWith("Card:")) {
      cards += value;
      return;
    }
    cards += value;
  });

  const total = p.totalPower ?? 0;
  const remaining = total - cards - invocations;
  if (remaining !== 0) {
    effects += remaining;
  }

  return { cards, invocations, effects, total, hasInvocations };
};

const getSelectedPlayerId = (state: GameState, result: { participants: ChallengeParticipantResult[] }): string | undefined => {
  const humanId = state.players.find((p) => !p.isAI)?.id;
  if (state.ui.challengeResultPlayerId) {
    const exists = result.participants.some((p) => p.playerId === state.ui.challengeResultPlayerId);
    if (exists) {
      return state.ui.challengeResultPlayerId;
    }
  }
  return result.participants.find((p) => p.playerId === humanId)?.playerId ?? result.participants[0]?.playerId;
};

export function drawChallengeResultModal(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  motionEnabled = true
): void {
  const result = state.ui.challengeResult;
  if (!result) {
    modalOpenTime = 0;
    verdictStaggerStart = 0;
    return;
  }
  const now = motionEnabled ? performance.now() : 1;
  if (modalOpenTime === 0) {
    modalOpenTime = now;
    verdictStaggerStart = motionEnabled ? 0 : now;
  }
  // Start stagger after slide-in completes
  if (motionEnabled && verdictStaggerStart === 0 && now - modalOpenTime >= MODAL_SLIDE_MS) {
    verdictStaggerStart = now;
  }
  const p = motionEnabled ? easeOutCubic(Math.min(1, (now - modalOpenTime) / MODAL_SLIDE_MS)) : 1;

  const { width, height } = ctx.canvas;
  const overlayId = "challenge-result-block";
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
  ctx.fillStyle = `rgba(0,0,0,${(0.62 * p).toFixed(2)})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  const panelW = Math.min(820, width - 40);
  const panelH = Math.min(720, height - 40);
  const x = width / 2 - panelW / 2;
  const y = height / 2 - panelH / 2 + (1 - p) * height * 0.15;
  ctx.save();
  ctx.globalAlpha = p;
  drawPanel(ctx, x, y, panelW, panelH, "rgba(10,12,18,0.95)", "#4a556d");
  ctx.fillStyle = "#f5f1e6";
  ctx.textAlign = "left";
  ctx.font = "700 20px 'Cinzel', serif";
  ctx.fillText("Challenge Result", x + 20, y + 32);
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.8)";
  ctx.fillText(`Turn ${result.turn} - ${result.challengeName}`, x + 20, y + 52);

  const mode: ChallengeResultMode = state.ui.challengeResultMode ?? "verdict";
  if (mode === "details") {
    drawDetailsView(ctx, state, regions, dispatch, result, x, y, panelW, panelH);
  } else {
    drawVerdictView(ctx, state, regions, dispatch, result, x, y, panelW, panelH, motionEnabled);
  }
  ctx.restore(); // matches slide-in animation save
}

function drawVerdictView(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  result: ChallengeResult,
  x: number,
  y: number,
  panelW: number,
  panelH: number,
  motionEnabled: boolean
): void {
  const humanId = state.players.find((p) => !p.isAI)?.id;
  const human = result.participants.find((p) => p.playerId === humanId) ?? result.participants[0];
  const { banner, explanation } = getOutcomeText(human);

  const contentX = x + 20;
  const contentW = panelW - 40;
  let yy = y + 72;

  const bannerH = 72;
  drawPanel(ctx, contentX, yy, contentW, bannerH, "rgba(20,28,42,0.92)", "#41506a");
  ctx.fillStyle = "#f5f1e6";
  ctx.textAlign = "center";
  ctx.font = "700 30px 'Cinzel', serif";
  ctx.fillText(banner, contentX + contentW / 2, yy + 46);
  ctx.textAlign = "left";
  yy += bannerH + 18;

  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 12px 'Cinzel', serif";
  ctx.fillText("Challenge AP Contributions", contentX, yy);
  yy += 12;

  const scores = result.participants.map((p) => ({
    playerId: p.playerId,
    name: p.playerName,
    avatar: p.playerAvatar,
    ap: p.totalPower ?? 0,
    tp: p.challengeTP ?? 0
  })).sort((a, b) => b.ap - a.ap);

  const tableY = yy + 8;
  const rowH = 26;
  const colNameX = contentX + 10;
  const colTpX = contentX + contentW - 12;
  const colApX = contentX + contentW - 120;

  ctx.fillStyle = "rgba(18,22,30,0.9)";
  ctx.fillRect(contentX, tableY, contentW, rowH);
  ctx.fillStyle = "rgba(245,241,230,0.85)";
  ctx.font = "600 11px 'Cinzel', serif";
  ctx.fillText("Player", colNameX, tableY + 17);
  ctx.textAlign = "right";
  ctx.fillText("Contribution AP", colApX, tableY + 17);
  ctx.fillText("TP", colTpX, tableY + 17);
  ctx.textAlign = "left";

  const now = motionEnabled ? performance.now() : 0;
  const stagger = (index: number): number => (motionEnabled ? staggerAlpha(index, now) : 1);
  scores.forEach((entry, index) => {
    const rowY = tableY + rowH * (index + 1);
    const alpha = stagger(index);
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = "rgba(18,22,30,0.75)";
    ctx.fillRect(contentX, rowY, contentW, rowH);
    ctx.fillStyle = "rgba(245,241,230,0.82)";
    // Draw avatar
    ctx.font = "16px serif";
    ctx.fillText(entry.avatar || "👤", colNameX, rowY + 17);
    // Draw name
    ctx.font = "12px 'Source Serif 4', serif";
    ctx.fillText(entry.name, colNameX + 28, rowY + 17);
    ctx.textAlign = "right";
    ctx.fillText(`${entry.ap}`, colApX, rowY + 17);
    ctx.fillText(`${entry.tp}`, colTpX, rowY + 17);
    ctx.textAlign = "left";
    ctx.restore();
  });

  // Stagger index continues after score rows
  let sIdx = scores.length;
  yy = tableY + rowH * (scores.length + 1) + 18;
  const groupTotal = result.participants
    .filter((p) => !p.withdrew)
    .reduce((sum, p) => sum + (p.totalPower ?? 0), 0);
  const groupAlpha = stagger(sIdx++);
  if (groupAlpha > 0) {
    ctx.save();
    ctx.globalAlpha *= groupAlpha;
    ctx.fillStyle = "rgba(245,241,230,0.85)";
    ctx.font = "12px 'Source Serif 4', serif";
    ctx.fillText(`Total group AP: ${groupTotal}`, contentX, yy);
    ctx.restore();
  }
  yy += 18;

  // Keystone progress summary
  if (result.keystoneProgress) {
    const kp = result.keystoneProgress;
    const typeLabel = kp.type === "cave" ? "Cave Keystone" : "Mountain Keystone";
    const unitLabel = kp.type === "cave" ? "AP" : "TP";
    const maxValue = kp.type === "cave" ? 300 : 250;
    const ksAlpha = stagger(sIdx++);
    if (ksAlpha > 0) {
      ctx.save();
      ctx.globalAlpha *= ksAlpha;
      ctx.fillStyle = "rgba(240,216,140,0.9)";
      ctx.font = "600 12px 'Source Serif 4', serif";
      ctx.fillText(`${typeLabel}: +${Math.floor(kp.gained)} ${unitLabel} → ${Math.floor(kp.totalAfter)}/${maxValue}`, contentX, yy);
      ctx.restore();
    }
    yy += 16;

    // Show next milestone
    const milestones = kp.type === "cave"
      ? [50, 100, 200, 300]
      : [40, 80, 160, 250];
    const nextMilestone = milestones.find((m) => kp.totalAfter < m);
    const msAlpha = stagger(sIdx++);
    if (msAlpha > 0) {
      ctx.save();
      ctx.globalAlpha *= msAlpha;
      if (nextMilestone) {
        ctx.fillStyle = "rgba(245,241,230,0.6)";
        ctx.font = "11px 'Source Serif 4', serif";
        ctx.fillText(`${Math.ceil(nextMilestone - kp.totalAfter)} ${unitLabel} until next milestone`, contentX, yy);
      } else {
        ctx.fillStyle = "rgba(240,216,140,0.7)";
        ctx.font = "600 11px 'Source Serif 4', serif";
        ctx.fillText("✓ Keystone Mastery Achieved!", contentX, yy);
      }
      ctx.restore();
    }
    yy += 18;
  }

  const explAlpha = stagger(sIdx);
  if (explAlpha > 0) {
    ctx.save();
    ctx.globalAlpha *= explAlpha;
    ctx.fillStyle = "rgba(245,241,230,0.85)";
    ctx.font = "13px 'Source Serif 4', serif";
    ctx.fillText(explanation, contentX, yy);
    ctx.restore();
  }

  drawButton(ctx, regions, "challenge-result-details", contentX, y + panelH - 56, 160, 40, "View Details", () => {
    dispatch({ type: "UI_SET_CHALLENGE_RESULT_MODE", mode: "details" });
  }, false);
  drawButton(ctx, regions, "challenge-result-continue", x + panelW - 180, y + panelH - 56, 160, 40, "Continue", () => {
    dispatch({ type: "UI_CLEAR_CHALLENGE_RESULT" });
  }, false);
}

function drawDetailsView(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  dispatch: (action: GameAction) => void,
  result: ChallengeResult,
  x: number,
  y: number,
  panelW: number,
  panelH: number
): void {
  const contentX = x + 20;
  const contentW = panelW - 40;
  let yy = y + 76;

  const hasRewards = result.participants.some((p) => {
    const d = p.delta ?? {};
    return (d.crystals ?? 0) > 0 || (d.ap ?? 0) > 0 || (d.spells?.length ?? 0) > 0 || (d.artifacts?.length ?? 0) > 0 || (d.cards?.length ?? 0) > 0;
  });

  const tabs: Array<{ id: string; label: string; value: ChallengeResultTab }> = [
    { id: "cr-tab-power", label: "Power Breakdown", value: "POWER" },
    { id: "cr-tab-played", label: "Played", value: "PLAYED" }
  ];
  if (hasRewards) {
    tabs.push({ id: "cr-tab-reward", label: "Rewards", value: "REWARDS" });
  }

  const selectedTab = ((state.ui.challengeResultTab ?? "POWER") === "REWARDS" && !hasRewards)
    ? "POWER"
    : (state.ui.challengeResultTab ?? "POWER");

  const tabH = 26;
  const tabW = Math.floor((contentW - (tabs.length - 1) * 8) / tabs.length);
  tabs.forEach((tab, index) => {
    const bx = contentX + index * (tabW + 8);
    const active = selectedTab === tab.value;
    drawButton(ctx, regions, tab.id, bx, yy, tabW, tabH, tab.label, () => {
      dispatch({ type: "UI_SET_CHALLENGE_RESULT_TAB", tab: tab.value });
    }, active);
  });
  yy += tabH + 14;

  const selectedPlayerId = getSelectedPlayerId(state, result);
  ctx.fillStyle = "rgba(245,241,230,0.8)";
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillText("Selected player:", contentX, yy + 16);

  let px = contentX + 110;
  result.participants.forEach((p, index) => {
    const label = p.playerName;
    ctx.font = "12px 'Source Serif 4', serif";
    const w = Math.max(90, Math.ceil(ctx.measureText(label).width) + 20);
    const active = selectedPlayerId === p.playerId;
    drawButton(ctx, regions, `cr-player-${p.playerId}-${index}`, px, yy, w, 26, label, () => {
      dispatch({ type: "UI_SET_CHALLENGE_RESULT_PLAYER", playerId: p.playerId });
    }, active);
    px += w + 8;
  });
  yy += 42;

  drawTpDetailsPanel(ctx, result, contentX, yy, contentW);
  yy += 86;

  if (selectedTab === "POWER") {
    drawPowerTab(ctx, result, selectedPlayerId, contentX, yy, contentW);
  } else if (selectedTab === "PLAYED") {
    drawPlayedTab(ctx, result, selectedPlayerId, contentX, yy, contentW);
  } else if (selectedTab === "REWARDS") {
    drawRewardsTab(ctx, result, selectedPlayerId, contentX, yy, contentW);
  }

  drawButton(ctx, regions, "challenge-result-back", contentX, y + panelH - 56, 160, 40, "Back", () => {
    dispatch({ type: "UI_SET_CHALLENGE_RESULT_MODE", mode: "verdict" });
  }, false);
  drawButton(ctx, regions, "challenge-result-continue", x + panelW - 180, y + panelH - 56, 160, 40, "Continue", () => {
    dispatch({ type: "UI_CLEAR_CHALLENGE_RESULT" });
  }, false);
}

function drawTpDetailsPanel(
  ctx: CanvasRenderingContext2D,
  result: { participants: ChallengeParticipantResult[] },
  x: number,
  y: number,
  w: number
): void {
  const panelH = 78;
  drawPanel(ctx, x, y, w, panelH, "rgba(18,22,30,0.9)", "#39465c");
  ctx.fillStyle = "rgba(245,241,230,0.9)";
  ctx.font = "600 12px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText("Challenge TP (Teaching Potential)", x + 12, y + 18);
  ctx.font = "11px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.8)";
  ctx.fillText("TP earned per challenge from card commits. 8 = Basic, 16 = Rare, 24 = Mythic Teaching.", x + 12, y + 34);

  const startX = x + 12;
  const rowY = y + 52;
  const colW = Math.min(220, Math.floor((w - 24) / Math.max(1, result.participants.length)));
  result.participants.forEach((p, idx) => {
    const tp = p.challengeTP ?? 0;
    const teachings = p.tpTeachingsGained ?? [];
    const colX = startX + idx * colW;
    ctx.fillStyle = "rgba(245,241,230,0.85)";
    ctx.font = "11px 'Source Serif 4', serif";
    const teachLabel = teachings.length > 0 ? ` — ${teachings.join(", ")}` : "";
    ctx.fillText(`${p.playerName}: ${Math.floor(tp)} TP${teachLabel}`, colX, rowY);
  });
}

function drawPowerTab(
  ctx: CanvasRenderingContext2D,
  result: { participants: ChallengeParticipantResult[] },
  selectedPlayerId: string | undefined,
  x: number,
  y: number,
  w: number
): void {
  let yy = y;
  const rowGap = 10;
  result.participants.forEach((p) => {
    const expanded = p.playerId === selectedPlayerId;
    const rowH = expanded ? 110 : 46;
    drawPanel(ctx, x, yy, w, rowH, "rgba(18,22,30,0.9)", "#39465c");
    ctx.fillStyle = "#f5f1e6";
    ctx.font = "600 13px 'Cinzel', serif";
    ctx.fillText(p.playerName, x + 14, yy + 22);
    ctx.fillStyle = "rgba(245,241,230,0.75)";
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.fillText(expanded ? "Focused" : "Collapsed", x + 14, yy + 40);

    const totals = computePowerTotals(p);
    if (expanded) {
      const col1 = x + 160;
      const col2 = x + w - 18;
      let lineY = yy + 24;
      ctx.font = "12px 'Source Serif 4', serif";
      ctx.fillStyle = "rgba(245,241,230,0.85)";
      ctx.fillText(`${ICONS.cards} Game Cards`, col1, lineY);
      ctx.textAlign = "right";
      ctx.fillText(`${totals.cards}`, col2, lineY);
      ctx.textAlign = "left";
      lineY += 18;
      ctx.fillText(`${ICONS.invocations} Invocations`, col1, lineY);
      ctx.textAlign = "right";
      ctx.fillText(`${totals.invocations}`, col2, lineY);
      ctx.textAlign = "left";
      lineY += 18;
      if (totals.effects !== 0) {
        ctx.fillText(`${ICONS.effects} Effects/Bonuses`, col1, lineY);
        ctx.textAlign = "right";
        ctx.fillText(`${totals.effects}`, col2, lineY);
        ctx.textAlign = "left";
        lineY += 18;
      }
      ctx.font = "600 12px 'Cinzel', serif";
      ctx.fillStyle = "rgba(245,241,230,0.9)";
      ctx.fillText(`Total: ${totals.total}`, col1, lineY);
    } else {
      ctx.font = "12px 'Source Serif 4', serif";
      ctx.fillStyle = "rgba(245,241,230,0.85)";
      ctx.fillText(`Total: ${totals.total}`, x + 160, yy + 28);
    }
    yy += rowH + rowGap;
  });
}

function drawPlayedTab(
  ctx: CanvasRenderingContext2D,
  result: { participants: ChallengeParticipantResult[] },
  selectedPlayerId: string | undefined,
  x: number,
  y: number,
  w: number
): void {
  const player = result.participants.find((p) => p.playerId === selectedPlayerId) ?? result.participants[0];
  if (!player) {
    return;
  }

  drawPanel(ctx, x, y, w, 330, "rgba(18,22,30,0.9)", "#39465c");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 13px 'Cinzel', serif";
  ctx.fillText(player.playerName, x + 14, y + 22);

  const powerLines = player.powerBreakdown ?? [];
  const cardRows = powerLines
    .filter((line) => line.includes("from card") || line.startsWith("Card:"))
    .map((line) => {
      const label = stripParenSuffix(line)
        .replace(/^Card:\s*/i, "")
        .replace(/\s+from card$/i, "");
      return { label, power: parsePowerValue(line) ?? 0 };
    });

  const invocationRows = powerLines
    .filter((line) => line.startsWith("Invocation:"))
    .map((line) => ({
      label: stripParenSuffix(line).replace(/^Invocation:\s*/i, ""),
      power: 0
    }));

  const col1 = x + 16;
  const col2 = x + w - 18;
  let yy = y + 44;
  const lineH = 16;

  ctx.fillStyle = "rgba(245,241,230,0.9)";
  ctx.font = "600 12px 'Cinzel', serif";
  ctx.fillText(`${ICONS.cards} Game Cards`, col1, yy);
  yy += lineH;
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.8)";

  const maxItems = 10;
  (cardRows.length ? cardRows : [{ label: "No game cards committed", power: 0 }]).slice(0, maxItems).forEach((row) => {
    const label = wrapText(ctx, row.label, col2 - col1 - 50)[0] ?? row.label;
    ctx.fillText(label, col1, yy);
    ctx.textAlign = "right";
    ctx.fillText(`${row.power}`, col2, yy);
    ctx.textAlign = "left";
    yy += lineH;
  });
  if (cardRows.length > maxItems) {
    ctx.fillStyle = "rgba(245,241,230,0.65)";
    ctx.fillText(`...and ${cardRows.length - maxItems} more`, col1, yy);
    yy += lineH;
    ctx.fillStyle = "rgba(245,241,230,0.8)";
  }

  yy += 8;
  ctx.fillStyle = "rgba(245,241,230,0.9)";
  ctx.font = "600 12px 'Cinzel', serif";
  ctx.fillText(`${ICONS.invocations} Invocations`, col1, yy);
  yy += lineH;
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.8)";
  (invocationRows.length ? invocationRows : [{ label: "No invocations played", power: 0 }]).slice(0, maxItems).forEach((row) => {
    const label = wrapText(ctx, row.label, col2 - col1 - 50)[0] ?? row.label;
    ctx.fillText(label, col1, yy);
    ctx.textAlign = "right";
    ctx.fillText(`${row.power}`, col2, yy);
    ctx.textAlign = "left";
    yy += lineH;
  });
  if (invocationRows.length > maxItems) {
    ctx.fillStyle = "rgba(245,241,230,0.65)";
    ctx.fillText(`...and ${invocationRows.length - maxItems} more`, col1, yy);
  }
}

function drawRewardsTab(
  ctx: CanvasRenderingContext2D,
  result: { participants: ChallengeParticipantResult[] },
  selectedPlayerId: string | undefined,
  x: number,
  y: number,
  w: number
): void {
  const player = result.participants.find((p) => p.playerId === selectedPlayerId) ?? result.participants[0];
  if (!player) {
    return;
  }
  drawPanel(ctx, x, y, w, 330, "rgba(18,22,30,0.9)", "#39465c");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 13px 'Cinzel', serif";
  ctx.fillText("Draft Rewards", x + 14, y + 22);

  const col1 = x + 16;
  const col2 = x + w - 18;
  let yy = y + 44;
  const lineH = 16;
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillStyle = "rgba(245,241,230,0.8)";

  const entries: Array<{ title: string; lines: string[] }> = [];
  if ((player.delta.crystals ?? 0) > 0) {
    entries.push({ title: "Crystals", lines: [`+${player.delta.crystals}`] });
  }
  if ((player.delta.ap ?? 0) > 0) {
    entries.push({ title: "Ascension Power", lines: [`+${player.delta.ap}`] });
  }
  if ((player.delta.cards ?? []).length > 0) {
    entries.push({ title: "Game Cards", lines: player.delta.cards ?? [] });
  }
  if ((player.delta.spells ?? []).length > 0) {
    entries.push({ title: "Invocations", lines: player.delta.spells ?? [] });
  }
  if ((player.delta.artifacts ?? []).length > 0) {
    entries.push({ title: "Artifacts", lines: player.delta.artifacts ?? [] });
  }

  if (entries.length === 0) {
    ctx.fillText("No rewards gained.", col1, yy);
    return;
  }

  entries.forEach((group) => {
    ctx.font = "600 12px 'Cinzel', serif";
    ctx.fillStyle = "rgba(245,241,230,0.9)";
    ctx.fillText(group.title, col1, yy);
    yy += lineH;
    ctx.font = "12px 'Source Serif 4', serif";
    ctx.fillStyle = "rgba(245,241,230,0.8)";
    const maxItems = 10;
    group.lines.slice(0, maxItems).forEach((line) => {
      const label = wrapText(ctx, line, col2 - col1 - 10)[0] ?? line;
      ctx.fillText(label, col1, yy);
      yy += lineH;
    });
    if (group.lines.length > maxItems) {
      ctx.fillStyle = "rgba(245,241,230,0.65)";
      ctx.fillText(`...and ${group.lines.length - maxItems} more`, col1, yy);
      ctx.fillStyle = "rgba(245,241,230,0.8)";
      yy += lineH;
    }
    yy += 6;
  });
}
