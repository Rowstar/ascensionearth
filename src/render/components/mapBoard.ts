import { getArtImage, UI_TOKENS, withTokenAlpha } from "../artSystem";

export type MapActionType = "MEDITATE" | "MOUNTAIN" | "CAVE" | "EARTH";

export type MapNode = {
  id: MapActionType;
  xPct: number;
  yPct: number;
  radius: number;
  label: string;
};

const PALETTE = {
  parchment: UI_TOKENS.colors.backgroundParchment,
  parchmentDark: UI_TOKENS.colors.backgroundParchmentDark,
  ink: UI_TOKENS.colors.neutralInk,
  inkSoft: withTokenAlpha(UI_TOKENS.colors.neutralInk, 0.35),
  glowGold: UI_TOKENS.colors.goldTrim,
  glowTeal: UI_TOKENS.colors.primaryAccent,
  glowIndigo: UI_TOKENS.colors.secondaryAccent,
  cave: "#2b3f44",
  mountain: "#294a5b",
  meditate: "#2f6267",
  earth: "#304565",
  panel: UI_TOKENS.colors.panelFill,
  panelStroke: UI_TOKENS.colors.panelStroke
} as const;

const NODE_ART_KEY: Record<MapActionType, "nodeCave" | "nodeMountain" | "nodeMeditate" | "nodeEarth"> = {
  CAVE: "nodeCave",
  MOUNTAIN: "nodeMountain",
  MEDITATE: "nodeMeditate",
  EARTH: "nodeEarth"
};

function drawMapBackgroundArt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  const mapImage = getArtImage("mapBackground");
  if (!mapImage) {
    return false;
  }
  ctx.save();
  roundRect(ctx, x, y, w, h, UI_TOKENS.radii.large);
  ctx.clip();
  ctx.drawImage(mapImage, x, y, w, h);
  ctx.restore();
  return true;
}

export const MAP_NODES: MapNode[] = [
  { id: "MOUNTAIN", xPct: 0.73, yPct: 0.24, radius: 70, label: "Mountain Journey" },
  { id: "CAVE", xPct: 0.23, yPct: 0.58, radius: 70, label: "Cave Journey" },
  { id: "MEDITATE", xPct: 0.69, yPct: 0.66, radius: 76, label: "Meditate" },
  { id: "EARTH", xPct: 0.32, yPct: 0.22, radius: 84, label: "Earth Advancement" }
];

const noiseCanvas = document.createElement("canvas");
noiseCanvas.width = 128;
noiseCanvas.height = 128;
const noiseCtx = noiseCanvas.getContext("2d");
if (noiseCtx) {
  const image = noiseCtx.createImageData(noiseCanvas.width, noiseCanvas.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 180 + Math.floor(Math.random() * 40);
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value - 10;
    image.data[i + 3] = 35;
  }
  noiseCtx.putImageData(image, 0, 0);
}

export function drawParchment(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  t: number
): void {
  if (drawMapBackgroundArt(ctx, x, y, w, h)) {
    ctx.save();
    ctx.strokeStyle = PALETTE.parchmentDark;
    ctx.lineWidth = UI_TOKENS.strokes.primary;
    roundRect(ctx, x, y, w, h, UI_TOKENS.radii.large);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.save();
  const bg = ctx.createLinearGradient(x, y, x + w, y + h);
  bg.addColorStop(0, "#dfd1b3");
  bg.addColorStop(0.45, PALETTE.parchment);
  bg.addColorStop(1, "#c3af8f");
  ctx.fillStyle = bg;
  ctx.strokeStyle = PALETTE.parchmentDark;
  ctx.lineWidth = UI_TOKENS.strokes.primary;
  roundRect(ctx, x, y, w, h, UI_TOKENS.radii.large);
  ctx.fill();
  ctx.stroke();

  if (noiseCtx) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.drawImage(noiseCanvas, x, y, w, h);
    ctx.restore();
  }

  ctx.save();
  const vignette = ctx.createRadialGradient(x + w / 2, y + h / 2, w * 0.15, x + w / 2, y + h / 2, w * 0.75);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(25,18,10,0.28)");
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  drawContours(ctx, x, y, w, h, t);
  ctx.restore();
}

function drawContours(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number): void {
  ctx.save();
  ctx.strokeStyle = "rgba(60,45,30,0.14)";
  ctx.lineWidth = 1.1;
  const lines = 8;
  for (let i = 0; i < lines; i += 1) {
    const offset = (i / lines) * h;
    ctx.beginPath();
    const wave = Math.sin(t * 0.6 + i) * 10;
    ctx.moveTo(x + 30, y + offset + 20);
    ctx.bezierCurveTo(
      x + w * 0.3,
      y + offset + 30 + wave,
      x + w * 0.6,
      y + offset - 20 - wave,
      x + w - 30,
      y + offset + 10
    );
    ctx.stroke();
  }
  ctx.restore();
}

function cubicPoint(t: number, p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }): { x: number; y: number } {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
  };
}

function cubicTangent(t: number, p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
  };
}

function buildWindyPath(
  start: { x: number; y: number },
  cp1: { x: number; y: number },
  cp2: { x: number; y: number },
  end: { x: number; y: number },
  segments: number,
  winding: number,
  phase: number,
  frequency: number
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const s = i / segments;
    const base = cubicPoint(s, start, cp1, cp2, end);
    const tan = cubicTangent(s, start, cp1, cp2, end);
    const tLen = Math.max(1, Math.hypot(tan.x, tan.y));
    const px = -tan.y / tLen;
    const py = tan.x / tLen;
    const edge = Math.sin(Math.PI * s);
    const wiggle = Math.sin(s * Math.PI * frequency + phase);
    const wiggle2 = Math.sin(s * Math.PI * (frequency * 1.6) - phase * 0.7);
    const offset = (wiggle * winding + wiggle2 * winding * 0.35) * edge;
    points.push({ x: base.x + px * offset, y: base.y + py * offset });
  }
  return points;
}

function strokePath(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[]): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

export function drawLeyLine(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number,
  intensity: number,
  options?: {
    color?: string;
    glow?: string;
    width?: number;
    highlight?: boolean;
    lightning?: boolean;
    meander?: number;
    trimStart?: number;
    trimEnd?: number;
    trackColor?: string;
    trackWidth?: number;
    seed?: number;
    avoid?: { x: number; y: number; radius: number };
  }
): void {
  const color = options?.color ?? "rgba(111,214,194,0.7)";
  const glow = options?.glow ?? "rgba(111,214,194,0.35)";
  const baseWidth = options?.width ?? 2.2;
  const highlight = options?.highlight ?? false;
  const lightning = options?.lightning ?? false;

  const dxRaw = to.x - from.x;
  const dyRaw = to.y - from.y;
  const distRaw = Math.max(1, Math.hypot(dxRaw, dyRaw));
  const trimStart = options?.trimStart ?? 0;
  const trimEnd = options?.trimEnd ?? 0;
  const trimTotal = trimStart + trimEnd;
  const safeTrim = distRaw > trimTotal + 6;
  const ux = dxRaw / distRaw;
  const uy = dyRaw / distRaw;
  const start = safeTrim
    ? { x: from.x + ux * trimStart, y: from.y + uy * trimStart }
    : { x: from.x, y: from.y };
  const end = safeTrim
    ? { x: to.x - ux * trimEnd, y: to.y - uy * trimEnd }
    : { x: to.x, y: to.y };

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / dist;
  const ny = dx / dist;
  const meander = Math.min(options?.meander ?? dist * 0.12, dist * 0.22);
  const seed = options?.seed ?? (Math.sin(from.x * 0.08 + to.y * 0.06 + from.y * 0.03 + to.x * 0.05) * 0.5 + 0.5);
  const signed = seed >= 0.5 ? 1 : -1;
  const bend1 = (0.35 + seed * 0.55) * meander * signed;
  const bend2 = (0.25 + (1 - seed) * 0.55) * meander * -signed * 0.6;
  let cp1 = {
    x: start.x + dx * 0.32 + nx * bend1,
    y: start.y + dy * 0.32 + ny * bend1
  };
  let cp2 = {
    x: start.x + dx * 0.68 + nx * bend2,
    y: start.y + dy * 0.68 + ny * bend2
  };
  const avoid = options?.avoid;
  if (avoid) {
    const proj = ((avoid.x - start.x) * dx + (avoid.y - start.y) * dy) / (dist * dist);
    const tProj = Math.max(0, Math.min(1, proj));
    const closest = { x: start.x + dx * tProj, y: start.y + dy * tProj };
    const distTo = Math.hypot(avoid.x - closest.x, avoid.y - closest.y);
    const clearance = avoid.radius + 26;
    if (distTo < clearance) {
      const side = ((avoid.x - start.x) * ny - (avoid.y - start.y) * nx) >= 0 ? -1 : 1;
      const push = (clearance - distTo) * 1.4;
      cp1 = { x: cp1.x + nx * push * side, y: cp1.y + ny * push * side };
      cp2 = { x: cp2.x + nx * push * side, y: cp2.y + ny * push * side };
    }
  }
  const phase = seed * Math.PI * 2;
  const frequency = 2.4 + seed * 1.7;
  const winding = Math.max(6, meander * 0.65);
  const pathPoints = buildWindyPath(start, cp1, cp2, end, 28, winding, phase, frequency);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Soft foundation path
  ctx.strokeStyle = options?.trackColor ?? "rgba(80,70,55,0.35)";
  ctx.lineWidth = options?.trackWidth ?? baseWidth + 4.5;
  ctx.shadowColor = "rgba(0,0,0,0)";
  strokePath(ctx, pathPoints);

  // Luminous inner line
  ctx.strokeStyle = color.replace("0.7", `${0.35 + intensity}`);
  ctx.lineWidth = baseWidth;
  ctx.shadowColor = glow;
  ctx.shadowBlur = highlight ? 16 : 8;
  strokePath(ctx, pathPoints);

  if (highlight) {
    ctx.strokeStyle = color.replace("0.7", `${0.65 + intensity}`);
    ctx.lineWidth = baseWidth + 1.2;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 22;
    strokePath(ctx, pathPoints);
  }

  if (highlight && lightning) {
    const segments = pathPoints.length - 1;
    const jitterBase = (10 + intensity * 40) * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = "rgba(140,220,255,0.95)";
    ctx.shadowBlur = 13;
    ctx.strokeStyle = "rgba(230,250,255,0.7)";
    ctx.lineWidth = baseWidth + 0.9;
    ctx.beginPath();
    for (let i = 0; i <= segments; i += 1) {
      const s = i / segments;
      const pt = pathPoints[i];
      const prev = pathPoints[Math.max(0, i - 1)];
      const next = pathPoints[Math.min(segments, i + 1)];
      const tan = { x: next.x - prev.x, y: next.y - prev.y };
      const tLen = Math.max(1, Math.hypot(tan.x, tan.y));
      const px = -tan.y / tLen;
      const py = tan.x / tLen;
      const jitter = (Math.sin(t * 10 + i * 1.7) + Math.cos(t * 6 + i * 2.3)) * 0.5;
      const amp = jitterBase * (0.25 + 0.75 * Math.sin(Math.PI * s));
      const ox = px * jitter * amp;
      const oy = py * jitter * amp;
      if (i === 0) {
        ctx.moveTo(pt.x + ox, pt.y + oy);
      } else {
        ctx.lineTo(pt.x + ox, pt.y + oy);
      }
    }
    ctx.stroke();

    ctx.shadowBlur = 4;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let i = 0; i <= segments; i += 1) {
      const s = i / segments;
      const pt = pathPoints[i];
      const prev = pathPoints[Math.max(0, i - 1)];
      const next = pathPoints[Math.min(segments, i + 1)];
      const tan = { x: next.x - prev.x, y: next.y - prev.y };
      const tLen = Math.max(1, Math.hypot(tan.x, tan.y));
      const px = -tan.y / tLen;
      const py = tan.x / tLen;
      const jitter = (Math.sin(t * 12 + i * 1.1) + Math.cos(t * 5 + i * 1.9)) * 0.35;
      const amp = jitterBase * 0.35 * Math.sin(Math.PI * s);
      const ox = px * jitter * amp;
      const oy = py * jitter * amp;
      if (i === 0) {
        ctx.moveTo(pt.x + ox, pt.y + oy);
      } else {
        ctx.lineTo(pt.x + ox, pt.y + oy);
      }
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.fillStyle = "rgba(70,90,70,0.45)";
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x - size * 0.6, y + size * 0.6);
  ctx.lineTo(x + size * 0.6, y + size * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(60,50,35,0.5)";
  ctx.fillRect(x - size * 0.15, y + size * 0.5, size * 0.3, size * 0.35);
  ctx.restore();
}

function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.fillStyle = "rgba(90,80,70,0.4)";
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(120,110,100,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawLake(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  const gradient = ctx.createRadialGradient(x, y, Math.min(w, h) * 0.2, x, y, Math.max(w, h) * 0.6);
  gradient.addColorStop(0, "rgba(120,170,190,0.45)");
  gradient.addColorStop(1, "rgba(80,120,150,0.2)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(140,190,210,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

export function drawTerrain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number): void {
  if (getArtImage("mapBackground")) {
    return;
  }
  ctx.save();
  ctx.globalAlpha = 0.9;

  drawLake(ctx, x + w * 0.36, y + h * 0.74, w * 0.08, h * 0.05);

  const treeCluster = [
    { x: x + w * 0.62, y: y + h * 0.2, size: 12 },
    { x: x + w * 0.66, y: y + h * 0.23, size: 10 },
    { x: x + w * 0.58, y: y + h * 0.24, size: 9 },
    { x: x + w * 0.18, y: y + h * 0.42, size: 11 },
    { x: x + w * 0.21, y: y + h * 0.46, size: 9 },
    { x: x + w * 0.44, y: y + h * 0.12, size: 10 },
    { x: x + w * 0.49, y: y + h * 0.18, size: 8 },
    { x: x + w * 0.74, y: y + h * 0.32, size: 11 },
    { x: x + w * 0.78, y: y + h * 0.36, size: 9 },
    { x: x + w * 0.32, y: y + h * 0.3, size: 10 },
    { x: x + w * 0.28, y: y + h * 0.26, size: 8 },
    { x: x + w * 0.86, y: y + h * 0.56, size: 9 }
  ];
  treeCluster.forEach((tree) => drawTree(ctx, tree.x, tree.y, tree.size + Math.sin(t * 0.3) * 0.6));

  const rocks = [
    { x: x + w * 0.48, y: y + h * 0.16, size: 6 },
    { x: x + w * 0.52, y: y + h * 0.17, size: 5 },
    { x: x + w * 0.15, y: y + h * 0.66, size: 7 },
    { x: x + w * 0.19, y: y + h * 0.69, size: 5 },
    { x: x + w * 0.82, y: y + h * 0.35, size: 6 },
    { x: x + w * 0.65, y: y + h * 0.5, size: 5 },
    { x: x + w * 0.61, y: y + h * 0.54, size: 6 },
    { x: x + w * 0.33, y: y + h * 0.6, size: 6 },
    { x: x + w * 0.28, y: y + h * 0.62, size: 5 },
    { x: x + w * 0.9, y: y + h * 0.22, size: 5 }
  ];
  rocks.forEach((rock) => drawRock(ctx, rock.x, rock.y, rock.size));

  ctx.restore();
}

export function drawPlayerIcon(ctx: CanvasRenderingContext2D, x: number, y: number, label: string | undefined, t: number): void {
  ctx.save();
  ctx.shadowColor = "rgba(120,200,240,0.6)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "rgba(24,24,30,0.9)";
  ctx.beginPath();
  ctx.arc(x, y, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(120,200,240,0.8)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, 26, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(235,245,255,0.9)";
  ctx.beginPath();
  ctx.arc(x, y - 8, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(235,245,255,0.7)";
  ctx.beginPath();
  ctx.moveTo(x - 10, y + 14);
  ctx.quadraticCurveTo(x, y + 2 + Math.sin(t * 2) * 1.5, x + 10, y + 14);
  ctx.lineTo(x + 10, y + 18);
  ctx.lineTo(x - 10, y + 18);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(245,241,230,0.9)";
  ctx.font = "600 11px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(label ?? "You", x, y + 30);
  ctx.restore();
}

export function drawNodeAura(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  t: number,
  hovered: boolean,
  selected: boolean,
  disabled: boolean
): void {
  ctx.save();
  const breathingHz = (Math.PI * 2) / Math.max(0.001, UI_TOKENS.motion.mapBreathingMs / 1000);
  const pulse = 1 + Math.sin(t * breathingHz) * 0.035;
  const size = radius * (selected ? 1.14 : pulse);
  ctx.globalAlpha = disabled ? 0.3 : 0.9;
  ctx.fillStyle = "rgba(18,16,14,0.4)";
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = hovered ? UI_TOKENS.strokes.primary + 2 : UI_TOKENS.strokes.primary + 0.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = hovered ? UI_TOKENS.glowTiers.radiant.radius : UI_TOKENS.glowTiers.contained.radius;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.stroke();

  if (selected) {
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, size + 10 + Math.sin(t * 4) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawNodeIcon(
  ctx: CanvasRenderingContext2D,
  nodeType: MapActionType,
  x: number,
  y: number,
  scale: number,
  t: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  switch (nodeType) {
    case "CAVE":
      ctx.fillStyle = PALETTE.cave;
      ctx.beginPath();
      ctx.moveTo(-22, 12);
      ctx.quadraticCurveTo(0, -24, 22, 12);
      ctx.lineTo(22, 26);
      ctx.lineTo(-22, 26);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = PALETTE.glowTeal;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(0, -12);
      ctx.lineTo(6, 0);
      ctx.closePath();
      ctx.fill();
      break;
    case "MOUNTAIN":
      ctx.fillStyle = PALETTE.mountain;
      ctx.beginPath();
      ctx.moveTo(-26, 20);
      ctx.lineTo(0, -22);
      ctx.lineTo(26, 20);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = PALETTE.glowGold;
      ctx.beginPath();
      ctx.arc(0, -12, 5 + Math.sin(t * 3) * 1.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "MEDITATE":
      ctx.strokeStyle = PALETTE.meditate;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = PALETTE.glowTeal;
      ctx.beginPath();
      ctx.arc(0, 0, 8 + Math.sin(t * 2) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "EARTH":
      ctx.fillStyle = PALETTE.earth;
      ctx.fillRect(-10, -22, 20, 40);
      ctx.beginPath();
      ctx.moveTo(-24, 18);
      ctx.lineTo(0, -6);
      ctx.lineTo(24, 18);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = PALETTE.glowIndigo;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-18, 24);
      ctx.lineTo(0, 4);
      ctx.lineTo(18, 24);
      ctx.stroke();
      break;
    default:
      break;
  }
  ctx.restore();
}

export function drawNode(
  ctx: CanvasRenderingContext2D,
  node: MapNode,
  x: number,
  y: number,
  t: number,
  hovered: boolean,
  selected: boolean,
  disabled: boolean
): void {
  const glow = node.id === "MEDITATE" ? PALETTE.glowTeal : node.id === "EARTH" ? PALETTE.glowIndigo : PALETTE.glowGold;
  if (selected || hovered) {
    const shadow = UI_TOKENS.shadows.nodeActive;
    ctx.save();
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur;
    ctx.fillStyle = "rgba(0,0,0,0.001)";
    ctx.beginPath();
    ctx.arc(x + shadow.offsetX, y + shadow.offsetY, node.radius * 0.92, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  drawNodeAura(ctx, x, y, node.radius, glow, t, hovered, selected, disabled);
  const nodePlate = getArtImage(NODE_ART_KEY[node.id]);
  if (nodePlate) {
    const lift = hovered ? UI_TOKENS.motion.hoverLiftPx : 0;
    const drawR = node.radius * (selected ? 1.02 : 0.98);
    ctx.save();
    ctx.globalAlpha = disabled ? 0.42 : 1;
    ctx.drawImage(nodePlate, x - drawR, y - drawR - lift, drawR * 2, drawR * 2);
    ctx.restore();
  } else {
    drawNodeIcon(ctx, node.id, x, y, 1, t);
  }

  ctx.save();
  ctx.font = "600 12px 'Cinzel', serif";
  const labelW = Math.max(120, Math.min(200, ctx.measureText(node.label).width + 32));
  const labelH = 24;
  const labelX = x - labelW / 2;
  const labelY = y + node.radius + 12;
  ctx.fillStyle = disabled ? "rgba(30,26,20,0.5)" : PALETTE.panel;
  roundRect(ctx, labelX, labelY, labelW, labelH, UI_TOKENS.radii.small);
  ctx.fill();
  ctx.strokeStyle = PALETTE.panelStroke;
  ctx.stroke();
  ctx.fillStyle = disabled ? "rgba(245,241,230,0.5)" : "#f5f1e6";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(node.label, x, labelY + labelH / 2);
  ctx.restore();
}

export function drawLightningRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  t: number,
  intensity: number
): void {
  const points = 28;
  const jitter = 4 + intensity * 6;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.shadowColor = "rgba(200,245,255,0.9)";
  ctx.shadowBlur = 10;
  ctx.strokeStyle = "rgba(230,250,255,0.75)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const a = (i / points) * Math.PI * 2;
    const wobble = Math.sin(t * 10 + i * 1.7) * jitter + Math.cos(t * 6 + i * 2.1) * jitter * 0.35;
    const r = radius + wobble;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
  ctx.shadowBlur = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const a = (i / points) * Math.PI * 2;
    const wobble = Math.sin(t * 12 + i * 1.2) * jitter * 0.5;
    const r = radius + wobble;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
  ctx.restore();
}

type RewardChip = { kind: string; count: number };

export type RewardOrbitItem = { kind: string; count?: number; quality?: number; label?: string };

function rewardChipPalette(kind: string): { fill: string; stroke: string; text: string } {
  switch (kind) {
    case "crystal":
      return { fill: "rgba(111,214,194,0.18)", stroke: "rgba(111,214,194,0.8)", text: "#c9f0e6" };
    case "gameCard":
      return { fill: "rgba(214,180,92,0.18)", stroke: "rgba(214,180,92,0.8)", text: "#f1ddb0" };
    case "spell":
      return { fill: "rgba(120,160,240,0.18)", stroke: "rgba(120,160,240,0.8)", text: "#c9d9ff" };
    case "artifact":
      return { fill: "rgba(210,160,90,0.18)", stroke: "rgba(210,160,90,0.75)", text: "#f0d0a8" };
    case "teaching":
      return { fill: "rgba(125,220,190,0.16)", stroke: "rgba(125,220,190,0.75)", text: "#c9f0e6" };
    default:
      return { fill: "rgba(245,241,230,0.12)", stroke: "rgba(245,241,230,0.4)", text: "#f5f1e6" };
  }
}

function rewardChipLabel(kind: string): string {
  if (kind === "gameCard") return "Card";
  if (kind === "spell") return "Invoc";
  if (kind === "artifact") return "Art";
  if (kind === "teaching") return "Teach";
  return kind.slice(0, 1).toUpperCase() + kind.slice(1);
}

function buildRewardChips(rewards: { kind: string; count?: number }[] | undefined): RewardChip[] {
  if (!rewards) return [];
  return rewards
    .filter((reward) => (reward.count ?? 1) > 0)
    .map((reward) => ({ kind: reward.kind, count: reward.count ?? 1 }));
}

export function drawRewardPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rewards: { kind: string; count?: number }[] | undefined,
  title: string
): void {
  const chips = buildRewardChips(rewards);
  const padding = 10;
  const chipH = 24;
  const chipGap = 8;
  const chipW = 66;
  const maxChips = Math.min(3, chips.length);
  const contentW = Math.max(140, padding * 2 + maxChips * chipW + Math.max(0, maxChips - 1) * chipGap);
  const panelH = chips.length > 0 ? 58 : 46;

  ctx.save();
  roundRect(ctx, x, y, contentW, panelH, 12);
  ctx.fillStyle = PALETTE.panel;
  ctx.fill();
  ctx.strokeStyle = PALETTE.panelStroke;
  ctx.stroke();

  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 11px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(title, x + padding, y + 18);

  if (chips.length === 0) {
    ctx.fillStyle = "rgba(245,241,230,0.6)";
    ctx.font = "11px 'Source Serif 4', serif";
    ctx.fillText("Not rolled yet", x + padding, y + 36);
    ctx.restore();
    return;
  }

  const chipY = y + 26;
  for (let i = 0; i < Math.min(maxChips, chips.length); i += 1) {
    const chip = chips[i];
    const px = x + padding + i * (chipW + chipGap);
    const palette = rewardChipPalette(chip.kind);
    roundRect(ctx, px, chipY, chipW, chipH, 10);
    ctx.fillStyle = palette.fill;
    ctx.fill();
    ctx.strokeStyle = palette.stroke;
    ctx.stroke();
    ctx.fillStyle = palette.text;
    ctx.font = "600 10px 'Cinzel', serif";
    ctx.textAlign = "left";
    ctx.fillText(rewardChipLabel(chip.kind), px + 8, chipY + 16);
    ctx.textAlign = "right";
    ctx.font = "600 10px 'Source Serif 4', serif";
    ctx.fillText(`x${chip.count}`, px + chipW - 8, chipY + 16);
  }
  if (chips.length > maxChips) {
    ctx.fillStyle = "rgba(245,241,230,0.65)";
    ctx.font = "600 12px 'Cinzel', serif";
    ctx.textAlign = "right";
    ctx.fillText("+", x + contentW - 12, chipY + 16);
  }
  ctx.restore();
}

function rewardOrbitPalette(kind: string): { core: string; glow: string; ring: string } {
  switch (kind) {
    case "crystal":
      return { core: "rgba(111,214,194,0.8)", glow: "rgba(111,214,194,0.85)", ring: "rgba(111,214,194,0.4)" };
    case "gameCard":
      return { core: "rgba(214,180,92,0.85)", glow: "rgba(214,180,92,0.9)", ring: "rgba(214,180,92,0.45)" };
    case "spell":
      return { core: "rgba(120,160,240,0.85)", glow: "rgba(120,160,240,0.9)", ring: "rgba(120,160,240,0.5)" };
    case "artifact":
      return { core: "rgba(210,160,90,0.85)", glow: "rgba(210,160,90,0.9)", ring: "rgba(210,160,90,0.5)" };
    case "teaching":
      return { core: "rgba(125,220,190,0.82)", glow: "rgba(125,220,190,0.88)", ring: "rgba(125,220,190,0.45)" };
    default:
      return { core: "rgba(245,241,230,0.8)", glow: "rgba(245,241,230,0.85)", ring: "rgba(245,241,230,0.4)" };
  }
}

function rewardOrbitLabel(kind: string): string {
  if (kind === "gameCard") return "G";
  if (kind === "spell") return "I";
  if (kind === "artifact") return "A";
  if (kind === "teaching") return "T";
  return kind.slice(0, 1).toUpperCase();
}

export function drawRewardOrbitCluster(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rewards: RewardOrbitItem[] | undefined,
  t: number
): void {
  if (!rewards || rewards.length === 0) {
    return;
  }
  const visible = rewards.filter((reward) => (reward.count ?? 1) > 0);
  if (visible.length === 0) {
    return;
  }
  const orbitRadius = 34;
  const tilt = 0.65;
  visible.forEach((reward, idx) => {
    const count = reward.count ?? 1;
    const quality = Math.max(0, Math.min(1, reward.quality ?? 0.45));
    const palette = rewardOrbitPalette(reward.kind);
    const angle = t * 0.55 + (idx / visible.length) * Math.PI * 2;
    const px = x + Math.cos(angle) * orbitRadius;
    const py = y + Math.sin(angle) * orbitRadius * tilt;
    const size = 12 + quality * 6;
    const glow = 6 + quality * 10;
    const alpha = 0.35 + quality * 0.5;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = glow;
    ctx.fillStyle = palette.core;
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = palette.ring;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, size + 2, 0, Math.PI * 2);
    ctx.stroke();

    if (quality >= 0.78) {
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(px, py, size + 6 + Math.sin(t * 3 + idx) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = PALETTE.ink;
    ctx.font = "600 11px 'Cinzel', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = reward.label ?? rewardOrbitLabel(reward.kind);
    ctx.fillText(label, px, py + 0.5);

    if (count !== 1) {
      ctx.fillStyle = PALETTE.ink;
      ctx.font = "10px 'Source Serif 4', serif";
      ctx.fillText(`x${count}`, px, py + size + 10);
    }
    ctx.restore();
  });
}


export function drawTooltip(
  ctx: CanvasRenderingContext2D,
  text: string | string[],
  x: number,
  y: number,
  maxWidth: number = 280,
  maxHeight: number = 220,
  bounds?: { x: number; y: number; w: number; h: number },
  alpha: number = 1
): void {
  ctx.save();
  if (alpha < 1) ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
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
    for (let i = 1; i < words.length; i++) {
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

  let width = 0;
  wrapped.forEach((l) => {
    width = Math.max(width, ctx.measureText(l).width);
  });
  width = Math.min(maxWidth, width + padding * 2);
  const maxLines = Math.max(1, Math.floor((maxHeight - padding * 2) / lineHeight));
  let visible = wrapped;
  if (wrapped.length > maxLines) {
    visible = wrapped.slice(0, maxLines);
    visible[maxLines - 1] = `${visible[maxLines - 1].replace(/\.*$/, "")}...`;
  }
  const height = Math.min(maxHeight, padding * 2 + visible.length * lineHeight);
  const boundX = bounds?.x ?? 0;
  const boundY = bounds?.y ?? 0;
  const boundW = bounds?.w ?? ctx.canvas.width;
  const boundH = bounds?.h ?? ctx.canvas.height;
  const clampedX = Math.min(boundX + boundW - width - 8, Math.max(boundX + 8, x));
  const clampedY = Math.min(boundY + boundH - height - 8, Math.max(boundY + 8, y));

  ctx.fillStyle = "rgba(20,15,10,0.90)";
  roundRect(ctx, clampedX, clampedY, width, height, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.stroke();

  ctx.fillStyle = "#f5f1e6";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  visible.forEach((line, idx) => {
    ctx.fillText(line, clampedX + padding, clampedY + padding + idx * lineHeight);
  });

  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
