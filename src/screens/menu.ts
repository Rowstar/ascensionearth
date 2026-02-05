import { GameState } from "../engine/types";
import { drawButton, drawPanel } from "../render/ui";
import { gameSpeedLabel } from "../utils/gameSpeed";
import { setSoundEnabled } from "../render/sfx";
import { HitRegion } from "../render/canvas";
import { prefersReducedMotion, startMenuBackground } from "./startMenuBackground";

export type MenuHandlers = {
  onStart: () => void;
  onContinue?: () => void;
  onSeedFocus: () => void;
  onSeedBlur: () => void;
  onToggleSound: () => void;
  onCycleSpeed: () => void;
  onToggleMotion: () => void;
  onCycleParticleQuality: () => void;
  onToggleMouseParallax: () => void;
};

export type MenuFrameInfo = {
  dt: number;
  mouseX: number;
  mouseY: number;
};

export function renderMenu(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  regions: HitRegion[],
  handlers: MenuHandlers,
  hoveredId?: string,
  frame?: MenuFrameInfo
): void {
  const { width, height } = ctx.canvas;

  setSoundEnabled(state.ui.soundEnabled ?? true);

  ctx.clearRect(0, 0, width, height);
  const osReducedMotion = prefersReducedMotion();
  startMenuBackground.draw(
    ctx,
    frame?.dt ?? 16,
    { x: frame?.mouseX ?? width / 2, y: frame?.mouseY ?? height / 2 },
    {
      motionEnabled: state.ui.motionEnabled ?? true,
      reduceMotion: osReducedMotion,
      particleQuality: state.ui.particleQuality ?? "med",
      mouseParallaxEnabled: state.ui.menuMouseParallaxEnabled ?? true
    }
  );

  regions.push({
    id: "menu-bg",
    x: 0,
    y: 0,
    w: width,
    h: height,
    onClick: handlers.onSeedBlur,
    cursor: "default"
  });

  ctx.fillStyle = "#f5f1e6";
  ctx.font = "600 42px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.fillText("Ascension Earth", width / 2, height / 3);

  ctx.fillStyle = "#c7c2b4";
  ctx.font = "16px 'Source Serif 4', serif";
  ctx.fillText("A digital prototype of the Ascension Earth card battle.", width / 2, height / 3 + 32);

  const inputW = 320;
  const inputH = 44;
  const inputX = width / 2 - inputW / 2;
  const inputY = height / 2 - 10;

  drawPanel(ctx, inputX, inputY, inputW, inputH, "rgba(20,24,32,0.85)", "#6b7b92");
  ctx.fillStyle = "#f5f1e6";
  ctx.font = "16px 'Source Serif 4', serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const seedValue = state.ui.seedInput;
  const seedText = seedValue || "Enter seed (optional)";
  ctx.fillText(seedText, inputX + 16, inputY + inputH / 2);

  const caretX = inputX + 16 + ctx.measureText(seedValue).width + 4;
  if (state.ui.seedEditing) {
    ctx.strokeStyle = "#f5f1e6";
    ctx.beginPath();
    ctx.moveTo(caretX, inputY + 12);
    ctx.lineTo(caretX, inputY + inputH - 12);
    ctx.stroke();
  }

  regions.push({
    id: "seed-input",
    x: inputX,
    y: inputY,
    w: inputW,
    h: inputH,
    onClick: handlers.onSeedFocus,
    cursor: "text"
  });

  const buttonW = 180;
  const buttonH = 44;
  const hasContinue = !!handlers.onContinue;
  const totalButtonW = hasContinue ? buttonW * 2 + 16 : buttonW;
  const buttonStartX = width / 2 - totalButtonW / 2;
  const buttonY = inputY + 70;

  if (hasContinue) {
    drawButton(ctx, regions, "continue", buttonStartX, buttonY, buttonW, buttonH, "Continue", handlers.onContinue!, hoveredId === "continue");
    drawButton(ctx, regions, "start", buttonStartX + buttonW + 16, buttonY, buttonW, buttonH, "New Game", handlers.onStart, hoveredId === "start");
  } else {
    drawButton(ctx, regions, "start", width / 2 - buttonW / 2, buttonY, buttonW, buttonH, "New Game", handlers.onStart, hoveredId === "start");
  }

  const settingsH = 32;
  const settingsGap = 12;
  const settingsW = Math.min(160, Math.max(110, Math.floor((width - 80 - settingsGap * 2) / 3)));
  const row1Total = settingsW * 2 + settingsGap;
  const row2Total = settingsW * 3 + settingsGap * 2;
  const row1X = width / 2 - row1Total / 2;
  const row2X = width / 2 - row2Total / 2;
  const settingsY = buttonY + 58;
  const settingsY2 = settingsY + settingsH + 12;

  const soundLabel = state.ui.soundEnabled ? "Sound: ON" : "Sound: OFF";
  drawButton(ctx, regions, "menu-sound", row1X, settingsY, settingsW, settingsH, soundLabel, handlers.onToggleSound, hoveredId === "menu-sound");

  const speedLabel = `Speed: ${gameSpeedLabel(state.settings.gameSpeedMode)}`;
  drawButton(ctx, regions, "menu-speed", row1X + settingsW + settingsGap, settingsY, settingsW, settingsH, speedLabel, handlers.onCycleSpeed, hoveredId === "menu-speed");

  const motionEnabled = state.ui.motionEnabled ?? true;
  const motionLabel = !motionEnabled ? "Motion: OFF" : osReducedMotion ? "Motion: REDUCED" : "Motion: ON";
  drawButton(ctx, regions, "menu-motion", row2X, settingsY2, settingsW, settingsH, motionLabel, handlers.onToggleMotion, hoveredId === "menu-motion");

  const pq = (state.ui.particleQuality ?? "med").toUpperCase();
  drawButton(
    ctx,
    regions,
    "menu-particles",
    row2X + settingsW + settingsGap,
    settingsY2,
    settingsW,
    settingsH,
    `Particles: ${pq}`,
    handlers.onCycleParticleQuality,
    hoveredId === "menu-particles"
  );

  const mouseLabel = (state.ui.menuMouseParallaxEnabled ?? true) ? "Mouse: ON" : "Mouse: OFF";
  drawButton(
    ctx,
    regions,
    "menu-mouse-parallax",
    row2X + (settingsW + settingsGap) * 2,
    settingsY2,
    settingsW,
    settingsH,
    mouseLabel,
    handlers.onToggleMouseParallax,
    hoveredId === "menu-mouse-parallax"
  );

  const hintY = settingsY2 + settingsH + 28;
  ctx.fillStyle = "#b9b0a2";
  ctx.font = "14px 'Source Serif 4', serif";
  ctx.fillText("Press Enter to begin", width / 2, hintY);
  if (osReducedMotion) {
    ctx.fillStyle = "rgba(185,176,162,0.85)";
    ctx.font = "12px 'Source Serif 4', serif";
    ctx.fillText("Reduced motion is enabled in OS settings", width / 2, hintY + 18);
  }

  // Draw AI Opponents with avatars
  const aiOpponents = state.players?.filter(p => p.isAI) ?? [];
  if (aiOpponents.length > 0) {
    const aiY = hintY + (osReducedMotion ? 54 : 42);
    const aiBoxW = 140;
    const aiBoxH = 80;
    const aiGap = 16;
    const aiTotalW = aiOpponents.length * aiBoxW + (aiOpponents.length - 1) * aiGap;
    let aiX = width / 2 - aiTotalW / 2;

    ctx.fillStyle = "rgba(245,241,230,0.6)";
    ctx.font = "11px 'Cinzel', serif";
    ctx.textAlign = "center";
    ctx.fillText("Your Opponents", width / 2, aiY - 10);

    aiOpponents.forEach((ai) => {
      drawPanel(ctx, aiX, aiY, aiBoxW, aiBoxH, "rgba(18,24,36,0.85)", "#4a556d");
      
      // Draw avatar
      ctx.font = "32px serif";
      ctx.textAlign = "center";
      ctx.fillText(ai.avatar || "🤖", aiX + aiBoxW / 2, aiY + 40);
      
      // Draw name
      ctx.fillStyle = "#f5f1e6";
      ctx.font = "12px 'Source Serif 4', serif";
      ctx.fillText(ai.name.replace("AI ", ""), aiX + aiBoxW / 2, aiY + 65);
      
      aiX += aiBoxW + aiGap;
    });
  }

  // Background hit region is added first so controls remain clickable.
}
