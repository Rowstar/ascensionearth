import { HitRegion } from "./canvas";
import { ArtifactData, GameCardData, TeachingData } from "../engine/types";
import { dataStore } from "../engine/state";
import { calculateTeachingPower } from "../engine/rules";
import { getArtImage, UI_TOKENS, withTokenAlpha } from "./artSystem";

const noiseCanvas = document.createElement("canvas");
noiseCanvas.width = 64;
noiseCanvas.height = 64;
const noiseCtx = noiseCanvas.getContext("2d");
if (noiseCtx) {
  const imageData = noiseCtx.createImageData(noiseCanvas.width, noiseCanvas.height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const value = Math.floor(Math.random() * 40);
    imageData.data[i] = value;
    imageData.data[i + 1] = value;
    imageData.data[i + 2] = value;
    imageData.data[i + 3] = 30;
  }
  noiseCtx.putImageData(imageData, 0, 0);
}

export function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  border: string
): void {
  drawRoundedRect(ctx, x, y, w, h, UI_TOKENS.radii.medium);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = UI_TOKENS.strokes.primary;
  ctx.stroke();

  // Soft inner shadow for depth without heavy contrast.
  const innerShadow = UI_TOKENS.shadows.panelInner;
  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, UI_TOKENS.radii.medium);
  ctx.clip();
  const topShade = ctx.createLinearGradient(x, y, x, y + h);
  topShade.addColorStop(0, withTokenAlpha(UI_TOKENS.colors.neutralInk, 0.2));
  topShade.addColorStop(0.28, withTokenAlpha(UI_TOKENS.colors.neutralInk, 0.08));
  topShade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topShade;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = innerShadow.color;
  ctx.lineWidth = UI_TOKENS.strokes.secondary;
  drawRoundedRect(ctx, x + 1, y + 1, w - 2, h - 2, UI_TOKENS.radii.medium - 1);
  ctx.stroke();
  ctx.restore();
}

// Per-button hover progress for smooth transitions (0 = idle, 1 = fully hovered)
const buttonHoverProgress: Map<string, number> = new Map();
let lastButtonFrameTime = 0;
let uiMotionEnabled = true;

export function setUiMotionEnabled(enabled: boolean): void {
  uiMotionEnabled = enabled;
}

function lerpColor(a: string, b: string, t: number): string {
  const parseHex = (hex: string) => {
    const c = hex.replace("#", "");
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  };
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

export function drawButton(
  ctx: CanvasRenderingContext2D,
  regions: HitRegion[],
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  hovered: boolean
): void {
  const prev = buttonHoverProgress.get(id) ?? 0;
  const target = hovered ? 1 : 0;
  let t = target;
  if (uiMotionEnabled) {
    const now = performance.now();
    const dtSec = lastButtonFrameTime > 0 ? (now - lastButtonFrameTime) / 150 : 0;
    lastButtonFrameTime = now;
    t = Math.max(0, Math.min(1, prev + (target > prev ? dtSec : -dtSec)));
  }
  buttonHoverProgress.set(id, t);

  const hoverLift = hovered ? UI_TOKENS.motion.hoverLiftPx : 0;
  const drawY = y - hoverLift;
  const gradient = ctx.createLinearGradient(x, drawY, x + w, drawY + h);
  gradient.addColorStop(0, lerpColor(UI_TOKENS.colors.goldTrimSoft, UI_TOKENS.colors.goldTrim, t));
  gradient.addColorStop(1, lerpColor("#855124", "#b47935", t));
  drawRoundedRect(ctx, x, drawY, w, h, UI_TOKENS.radii.medium);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Specular highlight pass on the top third.
  const highlight = ctx.createLinearGradient(x, drawY, x, drawY + h * 0.55);
  highlight.addColorStop(0, "rgba(255,248,225,0.38)");
  highlight.addColorStop(1, "rgba(255,248,225,0)");
  ctx.fillStyle = highlight;
  drawRoundedRect(ctx, x + 1, drawY + 1, w - 2, h - 2, UI_TOKENS.radii.medium - 1);
  ctx.fill();

  // Sheen sweep (disabled when motion is reduced/disabled).
  if (uiMotionEnabled && hovered) {
    const sheen = getArtImage("vfxSheenSweep");
    if (sheen) {
      const sweepT = (performance.now() % UI_TOKENS.motion.sheenSweepMs) / UI_TOKENS.motion.sheenSweepMs;
      const sweepX = x - w + sweepT * (w * 2.2);
      ctx.save();
      drawRoundedRect(ctx, x, drawY, w, h, UI_TOKENS.radii.medium);
      ctx.clip();
      ctx.globalAlpha = 0.14;
      ctx.drawImage(sheen, sweepX, drawY - h * 0.65, w, h * 2.3);
      ctx.restore();
    }
  }

  ctx.strokeStyle = lerpColor("#6d3d16", "#fff2c0", t);
  ctx.lineWidth = UI_TOKENS.borders.button;
  ctx.stroke();
  ctx.fillStyle = "#1b120a";
  ctx.font = "600 16px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, drawY + h / 2);

  regions.push({ id, x, y: drawY, w, h, onClick, cursor: "pointer" });
}

export function drawCardFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  palette: { top: string; bottom: string; stroke: string },
  hovered: boolean,
  frameKind: "basic" | "rare" | "mythic" = "basic"
): void {
  const gradient = ctx.createLinearGradient(x, y, x, y + h);
  gradient.addColorStop(0, palette.top);
  gradient.addColorStop(1, palette.bottom);
  drawRoundedRect(ctx, x, y, w, h, UI_TOKENS.radii.medium);
  ctx.fillStyle = gradient;
  ctx.fill();
  if (noiseCtx) {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.drawImage(noiseCanvas, x, y, w, h);
    ctx.restore();
  }
  ctx.strokeStyle = palette.stroke;
  ctx.lineWidth = hovered ? UI_TOKENS.strokes.primary + 1 : UI_TOKENS.strokes.primary;
  ctx.stroke();

  const frameImage = frameKind === "mythic"
    ? getArtImage("frameMythic")
    : frameKind === "rare"
      ? getArtImage("frameRare")
      : getArtImage("frameBasic");
  if (frameImage) {
    ctx.save();
    ctx.globalAlpha = frameKind === "mythic" ? 0.78 : frameKind === "rare" ? 0.72 : 0.66;
    ctx.drawImage(frameImage, x, y, w, h);
    ctx.restore();
  }
}

export function cardPalette(type: "game" | "spell" | "artifact" | "teaching" | "cosmic"): {
  top: string;
  bottom: string;
  stroke: string;
} {
  switch (type) {
    case "spell":
      return { top: "#2d4f7c", bottom: "#1b2f4f", stroke: "#77b6f0" };
    case "artifact":
      return { top: "#5c4a2f", bottom: "#3c2f1d", stroke: "#d6b274" };
    case "teaching":
      return { top: "#2a6b5f", bottom: "#17453d", stroke: "#7dd9c4" };
    case "cosmic":
      return { top: "#3e3f63", bottom: "#23243d", stroke: "#c5c7ff" };
    default:
      return { top: "#3e5a3f", bottom: "#263827", stroke: "#8cd58e" };
  }
}

function gameCardPalette(card: GameCardData): { top: string; bottom: string; stroke: string } {
  if (card.category === "cosmic" || card.tags.includes("Cosmic")) {
    return cardPalette("cosmic");
  }
  if (card.tags.includes("Human")) {
    return { top: "#7a5a3a", bottom: "#3e2c1c", stroke: "#f0c27a" };
  }
  if (card.tags.includes("Plant")) {
    return { top: "#3e7a4a", bottom: "#1f3b24", stroke: "#9bf0a8" };
  }
  if (card.tags.includes("Animal")) {
    return { top: "#2b6f6a", bottom: "#173b39", stroke: "#76e0d2" };
  }
  return cardPalette("game");
}

function rarityStroke(card: GameCardData): string {
  if (card.category === "cosmic" || card.tags.includes("Cosmic")) {
    return "#ff6cf0";
  }
  if (card.color === "Gold") return "#ffd24a";
  if (card.color === "Blue") return "#4aa8ff";
  return "#aeb7c1";
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

function drawCardArt(ctx: CanvasRenderingContext2D, card: GameCardData, x: number, y: number, w: number, h: number, lift: number): void {
  const artX = x + 8;
  const artY = y + 48 + lift;
  const artW = w - 16;
  const artH = h - 92;
  if (artH < 36) {
    return;
  }

  const isCosmic = card.category === "cosmic" || card.tags.includes("Cosmic");
  const isPlant = card.tags.includes("Plant");
  const isAnimal = card.tags.includes("Animal");
  const isHuman = card.tags.includes("Human");
  const seed = hashString(card.id ?? card.name ?? "card");

  ctx.save();
  drawRoundedRect(ctx, artX, artY, artW, artH, 8);
  ctx.clip();

  const grad = ctx.createLinearGradient(artX, artY, artX, artY + artH);
  if (isCosmic) {
    grad.addColorStop(0, "#2a2144");
    grad.addColorStop(0.5, "#2a3b6a");
    grad.addColorStop(1, "#4a2d78");
  } else if (isPlant) {
    grad.addColorStop(0, "#234b33");
    grad.addColorStop(1, "#163326");
  } else if (isAnimal) {
    grad.addColorStop(0, "#1e4e52");
    grad.addColorStop(1, "#122b30");
  } else if (isHuman) {
    grad.addColorStop(0, "#4a3626");
    grad.addColorStop(1, "#261a12");
  } else {
    grad.addColorStop(0, "#2f4b3b");
    grad.addColorStop(1, "#1a2b22");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(artX, artY, artW, artH);

  // Soft top highlight
  const sheen = ctx.createLinearGradient(artX, artY, artX, artY + artH * 0.6);
  sheen.addColorStop(0, "rgba(255,255,255,0.12)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(artX, artY, artW, artH);

  if (isCosmic) {
    const glow = ctx.createRadialGradient(
      artX + artW * 0.5,
      artY + artH * 0.45,
      artW * 0.05,
      artX + artW * 0.5,
      artY + artH * 0.45,
      artW * 0.6
    );
    glow.addColorStop(0, "rgba(214,180,92,0.35)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(artX, artY, artW, artH);

    ctx.fillStyle = "rgba(245,241,230,0.85)";
    for (let i = 0; i < 18; i += 1) {
      const rx = seededRand(seed, i * 1.7);
      const ry = seededRand(seed, i * 2.3);
      const size = 1 + seededRand(seed, i * 3.1) * 2;
      ctx.beginPath();
      ctx.arc(artX + rx * artW, artY + ry * artH, size, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (isPlant) {
    ctx.fillStyle = "rgba(125,220,190,0.35)";
    const leaf = (cx: number, cy: number, scale: number, rot: number): void => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(10 * scale, -10 * scale, 0, -24 * scale);
      ctx.quadraticCurveTo(-10 * scale, -10 * scale, 0, 0);
      ctx.fill();
      ctx.restore();
    };
    leaf(artX + artW * 0.35, artY + artH * 0.8, 1.1, -0.4);
    leaf(artX + artW * 0.6, artY + artH * 0.75, 0.9, 0.4);
    leaf(artX + artW * 0.5, artY + artH * 0.55, 0.7, 0.05);
  } else if (isAnimal) {
    ctx.fillStyle = "rgba(118,224,210,0.35)";
    const pawX = artX + artW * 0.5;
    const pawY = artY + artH * 0.6;
    ctx.beginPath();
    ctx.arc(pawX, pawY + 8, 12, 0, Math.PI * 2);
    ctx.fill();
    const toeOffsets = [-16, -6, 6, 16];
    toeOffsets.forEach((dx) => {
      ctx.beginPath();
      ctx.arc(pawX + dx, pawY - 6, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  } else if (isHuman) {
    ctx.fillStyle = "rgba(240,194,122,0.35)";
    const cx = artX + artW * 0.5;
    const cy = artY + artH * 0.62;
    ctx.beginPath();
    ctx.arc(cx, cy - 18, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 6, cy - 10, 12, 26);
    ctx.fillRect(cx - 16, cy, 32, 6);
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy - 20, 14, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = "rgba(214,180,92,0.35)";
    ctx.beginPath();
    ctx.moveTo(artX + artW * 0.15, artY + artH * 0.8);
    ctx.lineTo(artX + artW * 0.35, artY + artH * 0.4);
    ctx.lineTo(artX + artW * 0.55, artY + artH * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(111,214,194,0.35)";
    ctx.beginPath();
    ctx.moveTo(artX + artW * 0.45, artY + artH * 0.8);
    ctx.lineTo(artX + artW * 0.7, artY + artH * 0.35);
    ctx.lineTo(artX + artW * 0.9, artY + artH * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(245,241,230,0.55)";
    ctx.beginPath();
    ctx.arc(artX + artW * 0.2, artY + artH * 0.35, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  if (noiseCtx) {
    ctx.globalAlpha = 0.12;
    ctx.drawImage(noiseCanvas, artX, artY, artW, artH);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, artX, artY, artW, artH, 8);
  ctx.stroke();

  ctx.restore();
}

export function drawCard(
  ctx: CanvasRenderingContext2D,
  card: GameCardData,
  x: number,
  y: number,
  w: number,
  h: number,
  hovered: boolean,
  faceDown: boolean
): void {
  const palette = gameCardPalette(card);
  const lift = hovered ? -6 : 0;
  const frameKind: "basic" | "rare" | "mythic" =
    (card.category === "cosmic" || card.tags.includes("Cosmic"))
      ? "mythic"
      : card.color === "Gold"
        ? "rare"
        : "basic";
  drawCardFrame(ctx, x, y + lift, w, h, palette, hovered, frameKind);
  ctx.save();
  const isCosmic = card.category === "cosmic" || card.tags.includes("Cosmic");
  const isGold = card.color === "Gold";
  const isBlue = card.color === "Blue";
  if (isCosmic) {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, "#ff5fd6");
    grad.addColorStop(0.33, "#ffd45f");
    grad.addColorStop(0.66, "#6fe3ff");
    grad.addColorStop(1, "#a36bff");
    ctx.strokeStyle = grad;
  } else if (isGold) {
    ctx.strokeStyle = "#ffd24a";
  } else if (isBlue) {
    ctx.strokeStyle = "#4aa8ff";
  } else {
    ctx.strokeStyle = "#c9d2db";
  }
  ctx.lineWidth = 5.5;
  drawRoundedRect(ctx, x + 1, y + 1 + lift, w - 2, h - 2, 10);
  ctx.stroke();
  if (!isCosmic && !isGold) {
    // Inner accent ring communicates rarity without leaking details on face-down cards.
    ctx.strokeStyle = isBlue ? "#7fc2ff" : "#7f8b97";
    ctx.lineWidth = 3.5;
    drawRoundedRect(ctx, x + 5, y + 5 + lift, w - 10, h - 10, 9);
    ctx.stroke();
  }
  ctx.restore();

  if (faceDown) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    drawRoundedRect(ctx, x + 8, y + 8 + lift, w - 16, h - 16, 8);
    ctx.fill();

    // Show *rarity only* on the back (no name/power) so opponents can read hand texture.
    const rarityLabel = isCosmic ? "COSMIC" : isGold ? "RARE" : isBlue ? "UNCOMMON" : "COMMON";
    ctx.fillStyle = "rgba(245,241,230,0.9)";
    ctx.font = "700 12px 'Cinzel', serif";
    ctx.textAlign = "center";
    ctx.fillText(rarityLabel, x + w / 2, y + h / 2 - 6 + lift);
    ctx.fillStyle = "rgba(245,241,230,0.65)";
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.fillText("(hidden)", x + w / 2, y + h / 2 + 12 + lift);
    return;
  }

  ctx.save();
  drawRoundedRect(ctx, x + 4, y + 4 + lift, w - 8, h - 8, 10);
  ctx.clip();

  const maxTextW = w - 20;
  const clampText = (text: string, maxWidth: number): string => {
    if (ctx.measureText(text).width <= maxWidth) {
      return text;
    }
    let trimmed = text;
    while (trimmed.length > 0 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
      trimmed = trimmed.slice(0, -1);
    }
    return trimmed.length > 0 ? `${trimmed}...` : text;
  };

  drawCardArt(ctx, card, x, y, w, h, lift);

  ctx.fillStyle = "#f8f3e8";
  ctx.font = "600 14px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText(clampText(card.name, maxTextW), x + 10, y + 22 + lift);

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillText(clampText(card.tags.join(" "), maxTextW), x + 10, y + 40 + lift);

  // AP and TP display at bottom of card
  // TP is calculated on inverse sliding scale: high AP = low TP (except Cosmic)
  const apValue = card.basePower ?? 0;
  const teachingPower = isCosmic ? apValue : calculateTeachingPower(apValue, isCosmic);

  // AP (left side)
  ctx.fillStyle = "#f8f3e8";
  ctx.font = "600 18px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText(`AP:${apValue}`, x + 10, y + h - 16 + lift);

  // TP (right side) - blue for normal, purple for cosmic (equal AP/TP)
  ctx.fillStyle = isCosmic ? "#d4a4ff" : "#7ec8e3";
  ctx.font = "600 18px 'Cinzel', serif";
  ctx.textAlign = "right";
  ctx.fillText(`TP:${teachingPower}`, x + w - 10, y + h - 16 + lift);

  ctx.restore();
}

export function drawCardBack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  hovered: boolean
): void {
  const palette = cardPalette("game");
  const lift = hovered ? -6 : 0;
  drawCardFrame(ctx, x, y + lift, w, h, palette, hovered);
  const innerX = x + 12;
  const innerY = y + 12 + lift;
  const innerW = w - 24;
  const innerH = h - 24;

  ctx.save();
  drawRoundedRect(ctx, innerX, innerY, innerW, innerH, 10);
  ctx.clip();
  const grad = ctx.createLinearGradient(innerX, innerY, innerX + innerW, innerY + innerH);
  grad.addColorStop(0, "rgba(18,20,34,0.95)");
  grad.addColorStop(1, "rgba(10,12,22,0.95)");
  ctx.fillStyle = grad;
  ctx.fillRect(innerX, innerY, innerW, innerH);

  ctx.fillStyle = "rgba(245,241,230,0.25)";
  for (let i = 0; i < 18; i += 1) {
    const rx = (i * 47) % 97;
    const ry = (i * 29) % 89;
    const px = innerX + (rx / 97) * innerW;
    const py = innerY + (ry / 89) * innerH;
    const size = 1 + (i % 3);
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }

  const emblemX = innerX + innerW / 2;
  const emblemY = innerY + innerH / 2;
  ctx.strokeStyle = "rgba(214,180,92,0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(emblemX, emblemY - 30);
  ctx.lineTo(emblemX + 30, emblemY);
  ctx.lineTo(emblemX, emblemY + 30);
  ctx.lineTo(emblemX - 30, emblemY);
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = "rgba(111,214,194,0.6)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(emblemX - 24, emblemY);
  ctx.lineTo(emblemX + 24, emblemY);
  ctx.moveTo(emblemX, emblemY - 24);
  ctx.lineTo(emblemX, emblemY + 24);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "#f3e5c0";
  ctx.font = "600 16px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.fillText("Ascension", x + w / 2, y + h / 2 + lift);
}

export function drawRewardIcon(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number): void {
  ctx.save();
  switch (kind) {
    case "crystal":
      ctx.fillStyle = "#6fd6c2";
      ctx.beginPath();
      ctx.moveTo(x + 8, y);
      ctx.lineTo(x + 16, y + 10);
      ctx.lineTo(x + 8, y + 20);
      ctx.lineTo(x, y + 10);
      ctx.closePath();
      ctx.fill();
      break;
    case "artifact":
      ctx.fillStyle = "#cfa96b";
      ctx.fillRect(x, y + 4, 16, 12);
      break;
    case "spell":
      ctx.strokeStyle = "#7db7ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + 8, y + 10, 7, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "gameCard":
      ctx.strokeStyle = "#9ce6a4";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, 12, 16);
      break;
    default:
      break;
  }
  ctx.restore();
}

function drawTeachingArt(ctx: CanvasRenderingContext2D, teaching: TeachingData, x: number, y: number, w: number, h: number): void {
  const seed = hashString(teaching.id ?? teaching.name ?? "teaching");
  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, 8);
  ctx.clip();
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, "rgba(120,170,160,0.2)");
  grad.addColorStop(1, "rgba(80,120,110,0.35)");
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = "rgba(90,140,130,0.55)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i += 1) {
    const rx = seededRand(seed, i * 3.1);
    const ry = seededRand(seed, i * 5.7);
    const cx = x + rx * w;
    const cy = y + ry * h;
    const r = 8 + seededRand(seed, i * 7.1) * 18;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0.2, Math.PI + 0.8);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(245,241,230,0.6)";
  for (let i = 0; i < 8; i += 1) {
    const px = x + seededRand(seed, i * 9.3) * w;
    const py = y + seededRand(seed, i * 11.2) * h;
    const size = 1 + seededRand(seed, i * 12.7) * 2;
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawArtifactArt(ctx: CanvasRenderingContext2D, artifact: ArtifactData, x: number, y: number, w: number, h: number): void {
  const seed = hashString(artifact.id ?? artifact.name ?? "artifact");
  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, 8);
  ctx.clip();
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, "rgba(60,45,25,0.95)");
  grad.addColorStop(1, "rgba(30,22,12,0.95)");
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  const glow = ctx.createRadialGradient(x + w * 0.5, y + h * 0.5, w * 0.1, x + w * 0.5, y + h * 0.5, w * 0.6);
  glow.addColorStop(0, "rgba(214,180,92,0.45)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = "rgba(245,214,160,0.65)";
  ctx.lineWidth = 2;
  const cx = x + w * 0.5;
  const cy = y + h * 0.55;
  const shape = Math.floor(seededRand(seed, 4.2) * 3);
  if (shape === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(w, h) * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(245,214,160,0.25)";
    ctx.fill();
  } else if (shape === 1) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 18);
    ctx.lineTo(cx + 16, cy);
    ctx.lineTo(cx, cy + 18);
    ctx.lineTo(cx - 16, cy);
    ctx.closePath();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy + 14);
    ctx.lineTo(cx, cy - 20);
    ctx.lineTo(cx + 18, cy + 14);
    ctx.closePath();
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(245,241,230,0.5)";
  for (let i = 0; i < 8; i += 1) {
    const px = x + seededRand(seed, i * 7.9) * w;
    const py = y + seededRand(seed, i * 8.6) * h;
    const size = 1 + seededRand(seed, i * 10.4) * 2;
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawTeachingScrollCard(
  ctx: CanvasRenderingContext2D,
  teaching: TeachingData,
  x: number,
  y: number,
  w: number,
  h: number,
  hovered: boolean,
  tierColor: string
): void {
  const lift = hovered ? -4 : 0;
  const scrollX = x;
  const scrollY = y + lift;
  const rodW = Math.max(10, Math.min(14, h * 0.22));
  const rollDepth = rodW * 0.65;
  const bodyX = scrollX + rodW * 0.75;
  const bodyW = w - rodW * 1.5;
  const bodyGrad = ctx.createLinearGradient(bodyX, scrollY, bodyX + bodyW, scrollY + h);
  bodyGrad.addColorStop(0, "#efe2c8");
  bodyGrad.addColorStop(0.6, "#e3d1b0");
  bodyGrad.addColorStop(1, "#cbb08a");

  drawRoundedRect(ctx, bodyX, scrollY, bodyW, h, 10);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(90,70,40,0.5)";
  ctx.lineWidth = hovered ? 2.5 : 2;
  ctx.stroke();

  // Top & bottom rods (golden caps)
  const rodGrad = ctx.createLinearGradient(scrollX, scrollY, scrollX + rodW * 2, scrollY + h);
  rodGrad.addColorStop(0, "#7a5a2b");
  rodGrad.addColorStop(0.5, "#d8b06a");
  rodGrad.addColorStop(1, "#f4d9a3");
  ctx.fillStyle = rodGrad;
  ctx.beginPath();
  ctx.ellipse(scrollX + rodW * 0.6, scrollY + h * 0.28, rodW * 0.7, h * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(scrollX + w - rodW * 0.6, scrollY + h * 0.72, rodW * 0.7, h * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Inner rolled paper hint
  ctx.fillStyle = "rgba(130,95,60,0.35)";
  ctx.beginPath();
  ctx.ellipse(scrollX + rodW * 0.6, scrollY + h * 0.28, rodW * 0.4, h * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(scrollX + w - rodW * 0.6, scrollY + h * 0.72, rodW * 0.4, h * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Decorative curls
  ctx.strokeStyle = "rgba(200,160,90,0.65)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(scrollX + rodW * 0.2, scrollY + h * 0.12);
  ctx.quadraticCurveTo(scrollX + rodW * 1.2, scrollY + h * 0.05, scrollX + rodW * 1.4, scrollY + h * 0.18);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(scrollX + w - rodW * 0.2, scrollY + h * 0.88);
  ctx.quadraticCurveTo(scrollX + w - rodW * 1.2, scrollY + h * 0.95, scrollX + w - rodW * 1.4, scrollY + h * 0.82);
  ctx.stroke();

  // Paper creases
  ctx.strokeStyle = "rgba(110,80,50,0.35)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(bodyX + 8, scrollY + 22);
  ctx.lineTo(bodyX + bodyW - 8, scrollY + 22);
  ctx.moveTo(bodyX + 8, scrollY + h - 20);
  ctx.lineTo(bodyX + bodyW - 8, scrollY + h - 20);
  ctx.stroke();

  const artX = bodyX + 10;
  const artY = scrollY + 30;
  const artW = bodyW - 20;
  const artH = h - 62;
  drawTeachingArt(ctx, teaching, artX, artY, artW, artH);

  ctx.fillStyle = "rgba(20,16,10,0.8)";
  ctx.font = "600 11px 'Cinzel', serif";
  const maxNameW = bodyW - 70;
  const name = ctx.measureText(teaching.name).width > maxNameW
    ? `${teaching.name.slice(0, Math.max(0, Math.floor(teaching.name.length * 0.7)))}...`
    : teaching.name;
  ctx.textAlign = "left";
  ctx.fillText(name, bodyX + 12, scrollY + 20);
  ctx.fillStyle = tierColor;
  ctx.textAlign = "right";
  ctx.fillText(teaching.tier.toUpperCase(), bodyX + bodyW - 10, scrollY + 20);
}

export function drawArtifactMiniCard(
  ctx: CanvasRenderingContext2D,
  artifact: ArtifactData,
  x: number,
  y: number,
  w: number,
  h: number,
  hovered: boolean
): void {
  const palette = cardPalette("artifact");
  const lift = hovered ? -4 : 0;
  drawCardFrame(ctx, x, y + lift, w, h, palette, hovered, "rare");

  const artX = x + 6;
  const artY = y + 22 + lift;
  const artW = w - 12;
  const artH = h - 38;
  if (artH > 24) {
    drawArtifactArt(ctx, artifact, artX, artY, artW, artH);
  }

  const clampText = (text: string, maxWidth: number): string => {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let trimmed = text;
    while (trimmed.length > 0 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
      trimmed = trimmed.slice(0, -1);
    }
    return trimmed.length > 0 ? `${trimmed}...` : text;
  };

  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 11px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText(clampText(artifact.name, w - 60), x + 8, y + 16 + lift);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(245,241,230,0.85)";
  ctx.font = "11px 'Source Serif 4', serif";
  ctx.fillText(`AP ${artifact.value}`, x + w - 8, y + 16 + lift);
}

function formatCount(value: number): string {
  return `${value}`;
}

export function drawRewardPool(
  ctx: CanvasRenderingContext2D,
  title: string,
  pool: { dice: number[]; rewards: { kind: string; count?: number }[] } | undefined,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  drawPanel(ctx, x, y, w, h, "rgba(20,26,36,0.75)", "#405069");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 16px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText(title, x + 16, y + 24);

  if (!pool) {
    return;
  }

  const pulse = uiMotionEnabled ? (Math.sin(performance.now() / 220) + 1) * 0.5 : 0;

  pool.dice.forEach((die, index) => {
    const dx = x + 20 + index * 40;
    const dy = y + 40;
    ctx.save();
    ctx.shadowColor = "rgba(230,193,90,0.6)";
    ctx.shadowBlur = 6 + pulse * 6;
    drawRoundedRect(ctx, dx, dy, 28, 28, 6);
    ctx.fillStyle = "#f3e5c0";
    ctx.fill();
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "600 16px 'Cinzel', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(die), dx + 14, dy + 14);
    ctx.restore();
  });

  pool.rewards.forEach((reward, index) => {
    if (reward.count === 0) {
      return;
    }
    drawRewardIcon(ctx, reward.kind, x + 20 + index * 40, y + 76);
    const count = reward.count ?? 1;
    if (count !== 1) {
      ctx.fillStyle = "#f5f1e6";
      ctx.font = "12px 'Source Serif 4', serif";
      ctx.textAlign = "left";
      ctx.fillText(`x${formatCount(count)}`, x + 38 + index * 40, y + 92);
    }
  });
}

export function drawLog(
  ctx: CanvasRenderingContext2D,
  log: string[],
  x: number,
  y: number,
  w: number,
  h: number
): void {
  drawPanel(ctx, x, y, w, h, "rgba(15,18,26,0.85)", "#3e485c");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 14px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillText("Match Log", x + 12, y + 22);
  const lines = log.slice(-6);
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.fillStyle = "#c7c2b4";
  lines.forEach((line, idx) => {
    ctx.fillText(line, x + 12, y + 44 + idx * 16);
  });
}

export function lookupCard(id: string): GameCardData | undefined {
  return dataStore.cardsById[id];
}
