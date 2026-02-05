import { ParticleQuality } from "../engine/types";

export type StartMenuBackgroundFit = "cover" | "contain";

export type StartMenuBackgroundSettings = {
  motionEnabled: boolean;
  reduceMotion: boolean;
  particleQuality: ParticleQuality;
  mouseParallaxEnabled: boolean;
};

export const START_MENU_BG_CONFIG = {
  imagePath: "/images/theme_bg.png",
  fit: "cover" as StartMenuBackgroundFit,

  // Draw each layer a bit larger than the canvas so parallax never reveals edges.
  overscan: {
    background: 1.05,
    midground: 1.06,
    foreground: 1.08
  },

  parallax: {
    idleDriftMaxPx: { x: 10, y: 6 },
    idleDriftPeriodMs: { x: 18000, y: 24000 },
    mouseMaxPx: { x: 10, y: 7 }
  },

  // "Good enough" masks when we only have a single flattened image.
  // Foreground is the bottom stone circle + nearby foliage.
  foregroundTopPct: 0.72,

  // Midground is primarily the left/right cliffs (leave the center Tree/valley mostly in the background).
  // Tweak these points if your art changes.
  midgroundPolysPct: {
    left: [
      { x: 0.0, y: 0.22 },
      { x: 0.45, y: 0.32 },
      { x: 0.48, y: 0.74 },
      { x: 0.0, y: 0.9 }
    ],
    right: [
      { x: 1.0, y: 0.22 },
      { x: 0.55, y: 0.32 },
      { x: 0.52, y: 0.74 },
      { x: 1.0, y: 0.9 }
    ]
  },

  vignette: {
    // Overall dim keeps text readable without washing the art out.
    overallDimAlpha: 0.12,
    // UI clear zone: subtle dark oval behind center UI cluster.
    uiSpot: { xPct: 0.5, yPct: 0.46, innerRadiusPct: 0.08, outerRadiusPct: 0.62, alpha: 0.55 },
    // Edge vignette: keep attention toward the center.
    edge: { innerRadiusPct: 0.55, outerRadiusPct: 0.98, alpha: 0.55 }
  },

  particles: {
    counts: { low: 30, med: 55, high: 80 } as Record<ParticleQuality, number>,
    reducedMotionCount: 3,
    radiusPx: { min: 1.2, max: 3.6 },
    // Percent of screen height per second.
    speedPctPerSec: { min: 0.015, max: 0.04 },
    swayAmpPct: { min: 0.0008, max: 0.0035 },
    swayHz: { min: 0.06, max: 0.14 },
    alpha: { min: 0.04, max: 0.13 },
    perf: { lowFps: 50, criticalFps: 40 },
    fpsEmaAlpha: 0.08
  },

  sparkles: {
    intervalMs: { min: 6000, max: 12000 },
    lifeMs: { min: 450, max: 750 }
  },

  // Crystal twinkle anchors (right path + cave only). Adjust these for your art if needed.
  crystalTwinkles: {
    intervalMs: { min: 1000, max: 3000 },
    lifeMs: { min: 550, max: 900 },
    radiusPx: { min: 6, max: 18 },
    anchorsPct: [
      { x: 0.74, y: 0.58 },
      { x: 0.79, y: 0.53 },
      { x: 0.83, y: 0.57 },
      { x: 0.86, y: 0.62 },
      { x: 0.9, y: 0.58 },
      { x: 0.82, y: 0.68 },
      { x: 0.88, y: 0.7 },
      { x: 0.92, y: 0.66 }
    ]
  },

  // Cave glow shimmer anchor. Adjust x/y until it sits on the cave entrance.
  caveGlow: {
    anchorPct: { x: 0.86, y: 0.62 },
    radiusPctOfMinDim: 0.22,
    baseAlpha: 0.16,
    pulseHz: 0.06,
    jitterPx: 2.5
  },

  // Tree-of-life god rays anchor. Adjust x/y until it sits behind the Tree of Life.
  treeRays: {
    anchorPct: { x: 0.52, y: 0.34 },
    rayCount: 8,
    rayLengthPctOfMinDim: 0.6,
    baseAlpha: 0.07,
    pulseHz: 0.045
  }
} as const;

type Vec2 = { x: number; y: number };

type Mote = {
  x: number; // 0..1
  y: number; // 0..1 (can go slightly beyond for wrap)
  radiusPx: number;
  speedPctPerSec: number;
  swayAmpPct: number;
  swayHz: number;
  phase: number;
  lifeMs: number;
  ageMs: number;
  baseAlpha: number;
  tint: { r: number; g: number; b: number };
};

type Sparkle = {
  x: number; // 0..1
  y: number; // 0..1
  vxPctPerSec: number;
  vyPctPerSec: number;
  ageMs: number;
  lifeMs: number;
  lengthPx: number;
};

type Twinkle = {
  x: number; // 0..1
  y: number; // 0..1
  ageMs: number;
  lifeMs: number;
  radiusPx: number;
};

const TAU = Math.PI * 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function hash01(n: number): number {
  // Deterministic pseudo-random in [0,1) for stable visuals across frames.
  const s = Math.sin(n * 999.123 + 0.17) * 43758.5453123;
  return s - Math.floor(s);
}

function easeInOutSine(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
}

function safeMatchMedia(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

export function prefersReducedMotion(): boolean {
  return safeMatchMedia("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

type FitDraw = { dx: number; dy: number; dw: number; dh: number };

function computeFitDrawRect(
  iw: number,
  ih: number,
  cw: number,
  ch: number,
  fit: StartMenuBackgroundFit,
  overscan: number,
  offsetPx: Vec2
): FitDraw {
  const scaleBase = fit === "contain" ? Math.min(cw / iw, ch / ih) : Math.max(cw / iw, ch / ih);
  const scale = scaleBase * overscan;
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (cw - dw) / 2 + offsetPx.x;
  const dy = (ch - dh) / 2 + offsetPx.y;
  return { dx, dy, dw, dh };
}

function buildPolyPath(width: number, height: number, ptsPct: readonly Vec2[]): Path2D {
  const p = new Path2D();
  if (ptsPct.length === 0) return p;
  p.moveTo(ptsPct[0].x * width, ptsPct[0].y * height);
  for (let i = 1; i < ptsPct.length; i += 1) {
    p.lineTo(ptsPct[i].x * width, ptsPct[i].y * height);
  }
  p.closePath();
  return p;
}

export class StartMenuBackground {
  private img: HTMLImageElement | null = null;
  private status: "idle" | "loading" | "ready" | "error" = "idle";
  private simTimeMs = 0;
  private motes: Mote[] = [];
  private sparkles: Sparkle[] = [];
  private twinkles: Twinkle[] = [];
  private nextSparkleAtMs = 0;
  private nextTwinkleAtMs = 0;
  private fpsEma = 60;
  private tabVisible = true;
  private cachedMasks?: { w: number; h: number; foreground: Path2D; midground: Path2D };

  constructor(private readonly config = START_MENU_BG_CONFIG) {
    if (typeof document !== "undefined") {
      this.tabVisible = document.visibilityState === "visible";
      document.addEventListener("visibilitychange", () => {
        this.tabVisible = document.visibilityState === "visible";
      });
    }
  }

  private ensureImageLoaded(): void {
    if (this.status !== "idle") return;
    this.status = "loading";
    const img = new Image();
    img.onload = () => {
      this.img = img;
      this.status = "ready";
    };
    img.onerror = () => {
      this.img = null;
      this.status = "error";
    };
    img.src = this.config.imagePath;
  }

  private ensureMasks(width: number, height: number): { foreground: Path2D; midground: Path2D } {
    if (this.cachedMasks && this.cachedMasks.w === width && this.cachedMasks.h === height) {
      return this.cachedMasks;
    }
    const fg = new Path2D();
    fg.rect(0, height * this.config.foregroundTopPct, width, height * (1 - this.config.foregroundTopPct));

    const mid = new Path2D();
    const left = buildPolyPath(width, height, this.config.midgroundPolysPct.left);
    const right = buildPolyPath(width, height, this.config.midgroundPolysPct.right);
    mid.addPath(left);
    mid.addPath(right);

    this.cachedMasks = { w: width, h: height, foreground: fg, midground: mid };
    return this.cachedMasks;
  }

  private spawnMote(): Mote {
    const cfg = this.config.particles;
    const tints = [
      { r: 235, g: 250, b: 255 },
      { r: 200, g: 236, b: 255 },
      { r: 214, g: 235, b: 255 }
    ];
    return {
      x: Math.random(),
      y: Math.random(),
      radiusPx: randRange(cfg.radiusPx.min, cfg.radiusPx.max),
      speedPctPerSec: randRange(cfg.speedPctPerSec.min, cfg.speedPctPerSec.max),
      swayAmpPct: randRange(cfg.swayAmpPct.min, cfg.swayAmpPct.max),
      swayHz: randRange(cfg.swayHz.min, cfg.swayHz.max),
      phase: Math.random() * TAU,
      lifeMs: randRange(5000, 12000),
      ageMs: randRange(0, 12000),
      baseAlpha: randRange(cfg.alpha.min, cfg.alpha.max),
      tint: tints[Math.floor(Math.random() * tints.length)] ?? tints[0]
    };
  }

  private spawnSparkle(): Sparkle {
    return {
      x: randRange(0.08, 0.92),
      y: randRange(0.15, 0.72),
      vxPctPerSec: randRange(0.18, 0.32),
      vyPctPerSec: randRange(-0.22, -0.14),
      ageMs: 0,
      lifeMs: randRange(this.config.sparkles.lifeMs.min, this.config.sparkles.lifeMs.max),
      lengthPx: randRange(18, 38)
    };
  }

  private spawnTwinkle(): Twinkle {
    const anchors = this.config.crystalTwinkles.anchorsPct;
    const a = anchors[Math.floor(Math.random() * anchors.length)] ?? anchors[0] ?? { x: 0.85, y: 0.62 };
    return {
      x: a.x,
      y: a.y,
      ageMs: 0,
      lifeMs: randRange(this.config.crystalTwinkles.lifeMs.min, this.config.crystalTwinkles.lifeMs.max),
      radiusPx: randRange(this.config.crystalTwinkles.radiusPx.min, this.config.crystalTwinkles.radiusPx.max)
    };
  }

  draw(
    ctx: CanvasRenderingContext2D,
    dtMs: number,
    pointerPx: Vec2,
    settings: StartMenuBackgroundSettings
  ): void {
    this.ensureImageLoaded();

    const { width, height } = ctx.canvas;
    const cfg = this.config;

    const reduceMotion = settings.reduceMotion;
    const motionEnabled = settings.motionEnabled;
    const animate = this.tabVisible && motionEnabled && !reduceMotion;
    const dtSim = animate ? dtMs : 0;
    // Update performance estimate (used to auto-reduce particles if FPS drops).
    if (dtSim > 0) {
      const fps = 1000 / dtSim;
      this.fpsEma = this.fpsEma * (1 - cfg.particles.fpsEmaAlpha) + fps * cfg.particles.fpsEmaAlpha;
    }
    if (dtSim > 0) {
      this.simTimeMs += dtSim;
    }

    // Background fallback while the image loads.
    const baseGrad = ctx.createLinearGradient(0, 0, 0, height);
    baseGrad.addColorStop(0, "#0b0f18");
    baseGrad.addColorStop(1, "#131a2a");
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, width, height);

    const img = this.status === "ready" ? this.img : null;
    const iw = img ? (img.naturalWidth || img.width) : 0;
    const ih = img ? (img.naturalHeight || img.height) : 0;

    const ptrNorm = {
      x: width > 0 ? (pointerPx.x / width - 0.5) * 2 : 0,
      y: height > 0 ? (pointerPx.y / height - 0.5) * 2 : 0
    };

    const idleT = this.simTimeMs;
    const driftX = animate ? Math.sin((idleT / cfg.parallax.idleDriftPeriodMs.x) * TAU) * cfg.parallax.idleDriftMaxPx.x : 0;
    const driftY = animate
      ? Math.sin((idleT / cfg.parallax.idleDriftPeriodMs.y) * TAU + 1.3) * cfg.parallax.idleDriftMaxPx.y
      : 0;

    const mouseParallax = animate && settings.mouseParallaxEnabled;
    const mouseX = mouseParallax ? clamp(ptrNorm.x, -1, 1) * cfg.parallax.mouseMaxPx.x : 0;
    const mouseY = mouseParallax ? clamp(ptrNorm.y, -1, 1) * cfg.parallax.mouseMaxPx.y : 0;

    const baseOffset = { x: driftX + mouseX, y: driftY + mouseY };

    // Layered image draw (background + midground cliffs + foreground stone circle).
    if (img && iw > 0 && ih > 0) {
      const masks = this.ensureMasks(width, height);

      const drawLayer = (overscan: number, offset: Vec2, clip?: Path2D) => {
        const draw = computeFitDrawRect(iw, ih, width, height, cfg.fit, overscan, offset);
        ctx.save();
        if (clip) {
          ctx.clip(clip);
        }
        ctx.drawImage(img, draw.dx, draw.dy, draw.dw, draw.dh);
        ctx.restore();
      };

      // Background (slowest)
      drawLayer(cfg.overscan.background, { x: baseOffset.x * 0.35, y: baseOffset.y * 0.35 });
      // Midground (cliffs, medium)
      drawLayer(cfg.overscan.midground, { x: baseOffset.x * 0.6, y: baseOffset.y * 0.6 }, masks.midground);
      // Foreground (stone circle, fastest)
      drawLayer(cfg.overscan.foreground, { x: baseOffset.x * 0.95, y: baseOffset.y * 0.95 }, masks.foreground);
    }

    // Cave glow shimmer (right side cave entrance).
    this.drawCaveGlow(ctx, width, height, animate);

    // Tree god-rays pulse (behind the tree).
    this.drawTreeRays(ctx, width, height, animate);

    // Particles (ambient motes + occasional sparkle streak).
    this.drawParticles(ctx, width, height, dtSim, settings);

    // Crystal twinkles (right path/cave only).
    this.drawCrystalTwinkles(ctx, width, height, dtSim, settings);

    // UI clear-zone + edge vignette on top so the UI reads cleanly.
    this.drawVignette(ctx, width, height);
  }

  private resolveTargetParticleCount(settings: StartMenuBackgroundSettings): number {
    const cfg = this.config.particles;
    if (!settings.motionEnabled) return 0;
    if (settings.reduceMotion) return cfg.reducedMotionCount;

    const base = cfg.counts[settings.particleQuality] ?? cfg.counts.med;
    let perfFactor = 1;
    if (this.fpsEma < cfg.perf.criticalFps) perfFactor = 0.45;
    else if (this.fpsEma < cfg.perf.lowFps) perfFactor = 0.72;
    return Math.max(0, Math.floor(base * perfFactor));
  }

  private drawParticles(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    dtSim: number,
    settings: StartMenuBackgroundSettings
  ): void {
    const target = this.resolveTargetParticleCount(settings);
    while (this.motes.length < target) this.motes.push(this.spawnMote());
    if (this.motes.length > target) this.motes.length = target;

    if (!settings.motionEnabled) {
      this.sparkles.length = 0;
      this.nextSparkleAtMs = this.simTimeMs + randRange(this.config.sparkles.intervalMs.min, this.config.sparkles.intervalMs.max);
      return;
    }

    // Schedule sparkles rarely.
    if (dtSim > 0) {
      if (this.nextSparkleAtMs <= 0) {
        this.nextSparkleAtMs = this.simTimeMs + randRange(this.config.sparkles.intervalMs.min, this.config.sparkles.intervalMs.max);
      }
      if (!settings.reduceMotion && this.simTimeMs >= this.nextSparkleAtMs) {
        this.sparkles.push(this.spawnSparkle());
        this.nextSparkleAtMs = this.simTimeMs + randRange(this.config.sparkles.intervalMs.min, this.config.sparkles.intervalMs.max);
      }
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Motes
    for (let i = 0; i < this.motes.length; i += 1) {
      const m = this.motes[i];
      if (dtSim > 0) {
        m.ageMs += dtSim;
        m.y -= (m.speedPctPerSec * dtSim) / 1000;
        if (m.y < -0.12 || m.ageMs > m.lifeMs) {
          // Respawn just below the bottom.
          const next = this.spawnMote();
          next.y = randRange(1.0, 1.12);
          this.motes[i] = next;
          continue;
        }
      }

      const fadeT = m.lifeMs > 0 ? clamp(m.ageMs / m.lifeMs, 0, 1) : 0.5;
      const fade = Math.sin(Math.PI * fadeT);
      const sway = Math.sin(((this.simTimeMs / 1000) * TAU) * m.swayHz + m.phase) * m.swayAmpPct;

      const x = (m.x + sway) * width;
      const y = m.y * height;
      const a = m.baseAlpha * fade;

      ctx.fillStyle = `rgba(${m.tint.r},${m.tint.g},${m.tint.b},${a.toFixed(4)})`;
      ctx.beginPath();
      ctx.arc(x, y, m.radiusPx, 0, TAU);
      ctx.fill();
    }

    // Sparkle streaks
    for (let i = this.sparkles.length - 1; i >= 0; i -= 1) {
      const s = this.sparkles[i];
      if (dtSim > 0) {
        s.ageMs += dtSim;
        s.x += (s.vxPctPerSec * dtSim) / 1000;
        s.y += (s.vyPctPerSec * dtSim) / 1000;
      }
      const t = s.lifeMs > 0 ? clamp(s.ageMs / s.lifeMs, 0, 1) : 1;
      if (t >= 1 || s.x < -0.2 || s.x > 1.2 || s.y < -0.2 || s.y > 1.2) {
        this.sparkles.splice(i, 1);
        continue;
      }
      const a = 0.18 * (1 - t) * (1 - t);
      const x = s.x * width;
      const y = s.y * height;
      const vxPx = s.vxPctPerSec * width;
      const vyPx = s.vyPctPerSec * height;
      const mag = Math.hypot(vxPx, vyPx) || 1;
      const dx = (vxPx / mag) * s.lengthPx;
      const dy = (vyPx / mag) * s.lengthPx;
      ctx.strokeStyle = `rgba(245,252,255,${a.toFixed(4)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - dx, y - dy);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawCrystalTwinkles(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    dtSim: number,
    settings: StartMenuBackgroundSettings
  ): void {
    if (!settings.motionEnabled) {
      this.twinkles.length = 0;
      this.nextTwinkleAtMs = this.simTimeMs + randRange(this.config.crystalTwinkles.intervalMs.min, this.config.crystalTwinkles.intervalMs.max);
      return;
    }
    if (settings.reduceMotion) {
      // Keep it nearly static (no bursts) when reduced motion is requested.
      this.twinkles.length = 0;
      return;
    }

    if (dtSim > 0) {
      if (this.nextTwinkleAtMs <= 0) {
        this.nextTwinkleAtMs = this.simTimeMs + randRange(this.config.crystalTwinkles.intervalMs.min, this.config.crystalTwinkles.intervalMs.max);
      }
      if (this.simTimeMs >= this.nextTwinkleAtMs) {
        this.twinkles.push(this.spawnTwinkle());
        this.nextTwinkleAtMs = this.simTimeMs + randRange(this.config.crystalTwinkles.intervalMs.min, this.config.crystalTwinkles.intervalMs.max);
      }
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = this.twinkles.length - 1; i >= 0; i -= 1) {
      const tw = this.twinkles[i];
      if (dtSim > 0) {
        tw.ageMs += dtSim;
      }
      const t = tw.lifeMs > 0 ? clamp(tw.ageMs / tw.lifeMs, 0, 1) : 1;
      if (t >= 1) {
        this.twinkles.splice(i, 1);
        continue;
      }
      const pulse = easeInOutSine(t);
      const a = 0.22 * (1 - t);
      const x = tw.x * width;
      const y = tw.y * height;
      const r = lerp(2, tw.radiusPx, pulse);

      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(200,245,255,${a.toFixed(4)})`);
      g.addColorStop(1, "rgba(200,245,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  private drawCaveGlow(ctx: CanvasRenderingContext2D, width: number, height: number, animate: boolean): void {
    const gcfg = this.config.caveGlow;
    const minDim = Math.min(width, height);
    const baseX = gcfg.anchorPct.x * width;
    const baseY = gcfg.anchorPct.y * height;

    const t = this.simTimeMs / 1000;
    const pulse = animate ? 0.65 + 0.35 * Math.sin(t * TAU * gcfg.pulseHz) : 0.85;
    const jitterX = animate ? Math.sin(t * 1.9) * gcfg.jitterPx : 0;
    const jitterY = animate ? Math.cos(t * 1.4) * gcfg.jitterPx : 0;

    const x = baseX + jitterX;
    const y = baseY + jitterY;
    const r = minDim * gcfg.radiusPctOfMinDim;
    const a = gcfg.baseAlpha * pulse;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(120,220,255,${a.toFixed(4)})`);
    grad.addColorStop(0.55, `rgba(120,220,255,${(a * 0.35).toFixed(4)})`);
    grad.addColorStop(1, "rgba(120,220,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  private drawTreeRays(ctx: CanvasRenderingContext2D, width: number, height: number, animate: boolean): void {
    const rcfg = this.config.treeRays;
    const minDim = Math.min(width, height);
    const x = rcfg.anchorPct.x * width;
    const y = rcfg.anchorPct.y * height;
    const len = minDim * rcfg.rayLengthPctOfMinDim;
    const t = this.simTimeMs / 1000;
    const pulse = animate ? 0.6 + 0.4 * Math.sin(t * TAU * rcfg.pulseHz + 0.7) : 0.8;
    const baseA = rcfg.baseAlpha * pulse;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(x, y);

    // Soft core glow
    const coreR = len * 0.45;
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
    core.addColorStop(0, `rgba(205,240,255,${(baseA * 0.6).toFixed(4)})`);
    core.addColorStop(1, "rgba(205,240,255,0)");
    ctx.fillStyle = core;
    ctx.fillRect(-coreR, -coreR, coreR * 2, coreR * 2);

    for (let i = 0; i < rcfg.rayCount; i += 1) {
      const seed = i + 1;
      const a = (i / rcfg.rayCount) * TAU + (hash01(seed * 3.1) - 0.5) * 0.22 + Math.sin(t * 0.12 + i) * 0.03;
      const w = len * lerp(0.06, 0.11, hash01(seed * 7.7));
      const l = len * lerp(0.75, 1.05, hash01(seed * 11.9));
      ctx.save();
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, 0, -l);
      g.addColorStop(0, `rgba(205,240,255,${(baseA * 0.18).toFixed(4)})`);
      g.addColorStop(0.5, `rgba(205,240,255,${(baseA * 0.32).toFixed(4)})`);
      g.addColorStop(1, "rgba(205,240,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-w / 2, -l, w, l);
      ctx.restore();
    }

    ctx.restore();
  }

  private drawVignette(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const v = this.config.vignette;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";

    // Overall dim.
    ctx.fillStyle = `rgba(0,0,0,${v.overallDimAlpha.toFixed(4)})`;
    ctx.fillRect(0, 0, width, height);

    // UI clear-zone: a darkened "spot" behind the menu UI cluster.
    const uiX = v.uiSpot.xPct * width;
    const uiY = v.uiSpot.yPct * height;
    const uiR0 = Math.min(width, height) * v.uiSpot.innerRadiusPct;
    const uiR1 = Math.min(width, height) * v.uiSpot.outerRadiusPct;
    const uiGrad = ctx.createRadialGradient(uiX, uiY, uiR0, uiX, uiY, uiR1);
    uiGrad.addColorStop(0, `rgba(0,0,0,${(v.uiSpot.alpha * 0.6).toFixed(4)})`);
    uiGrad.addColorStop(0.55, `rgba(0,0,0,${(v.uiSpot.alpha * 0.35).toFixed(4)})`);
    uiGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = uiGrad;
    ctx.fillRect(0, 0, width, height);

    // Edge vignette.
    const cx = width / 2;
    const cy = height / 2;
    const r0 = Math.min(width, height) * v.edge.innerRadiusPct;
    const r1 = Math.min(width, height) * v.edge.outerRadiusPct;
    const edge = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    edge.addColorStop(0, "rgba(0,0,0,0)");
    edge.addColorStop(1, `rgba(0,0,0,${v.edge.alpha.toFixed(4)})`);
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, width, height);

    ctx.restore();
  }
}

export const startMenuBackground = new StartMenuBackground();
