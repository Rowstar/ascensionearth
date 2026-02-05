type ChimeKind = "reward" | "keystone" | "tp" | "phase";

let soundEnabled = true;
let soundActivated = false;
let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let musicEnabled = true;
let musicVolume = 0.45;
let introAudio: HTMLAudioElement | null = null;
let introGain: GainNode | null = null;
let introSource: MediaElementAudioSourceNode | null = null;
let introPlaying = false;
let introFinished = false; // true once we've transitioned away from intro — never go back
let themeAudio: HTMLAudioElement | null = null;
let challengeAudio: HTMLAudioElement | null = null;
let themeGain: GainNode | null = null;
let challengeGain: GainNode | null = null;
let themeSource: MediaElementAudioSourceNode | null = null;
let challengeSource: MediaElementAudioSourceNode | null = null;
const MUSIC_FADE_MS = 800;
const INTRO_TO_THEME_FADE_MS = 1500;

let hoverAudio: HTMLAudioElement | null = null;
let hoverGainNode: GainNode | null = null;
let hoverSourceNode: MediaElementAudioSourceNode | null = null;
let hoverFadeStartTime = 0;
const HOVER_FADE_DURATION = 1500; // 1.5 seconds
const HOVER_MAX_VOLUME = 0.8; // 80% max volume

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.22;
    masterGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

export function setSoundEnabled(value: boolean): void {
  soundEnabled = value;
  if (!soundEnabled) {
    stopIntro();
    stopTheme();
    stopChallengeMusicImmediate();
  } else if (musicEnabled && soundActivated) {
    if (introPlaying && !introFinished) {
      startIntro();
    } else {
      startTheme();
    }
  }
  updateMusicGain();
}

export function activateSound(): void {
  if (!soundEnabled) return;
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  soundActivated = true;
  if (musicEnabled && !introPlaying && !introFinished) {
    startIntro();
  }
}

/** Attempt to start intro music immediately on page load (before user interaction). */
export function tryAutoplayIntro(): void {
  if (!soundEnabled || !musicEnabled) return;
  ensureIntroNode();
  if (!introAudio || introFinished) return;
  introPlaying = true;
  // Attempt autoplay — browsers may reject this
  const p = introAudio.play();
  if (p && typeof p.then === "function") {
    p.then(() => {
      // Autoplay succeeded — wire up WebAudio gain if possible
      soundActivated = true;
      const ctx = ensureContext();
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      if (introGain && audioCtx) {
        const now = audioCtx.currentTime;
        introGain.gain.cancelScheduledValues(now);
        introGain.gain.setValueAtTime(0, now);
        introGain.gain.linearRampToValueAtTime(musicVolume, now + 1.0);
      } else {
        introAudio!.volume = musicVolume;
      }
    }).catch(() => {
      // Autoplay blocked — will start on first user interaction via activateSound()
      introPlaying = false;
    });
  }
}

function canPlay(): boolean {
  return soundEnabled && soundActivated;
}

export function setMusicEnabled(value: boolean): void {
  musicEnabled = value;
  if (musicEnabled && soundActivated && soundEnabled) {
    if (introPlaying && !introFinished) {
      startIntro();
    } else {
      startTheme();
    }
  } else {
    stopIntro();
    stopTheme();
    stopChallengeMusicImmediate();
  }
}

export function setMusicVolume(value: number): void {
  musicVolume = Math.max(0, Math.min(1, value));
  updateMusicGain();
}

export function playClick(): void {
  if (!canPlay()) return;
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.005;
  scheduleTone(ctx, now, 520, 0.05, 0.04, "square");
}

function scheduleTone(
  ctx: AudioContext,
  start: number,
  frequency: number,
  duration: number,
  gain: number,
  type: OscillatorType = "sine"
): void {
  if (!masterGain) return;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp);
  amp.connect(masterGain);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

function scheduleSweep(ctx: AudioContext, start: number, from: number, to: number, duration: number, gain: number): void {
  if (!masterGain) return;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + duration);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp);
  amp.connect(masterGain);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

export function playChime(kind: ChimeKind): void {
  if (!canPlay()) return;
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.01;

  switch (kind) {
    case "reward": {
      scheduleTone(ctx, now, 523.25, 0.24, 0.09);
      scheduleTone(ctx, now + 0.08, 659.25, 0.22, 0.08);
      scheduleTone(ctx, now + 0.16, 783.99, 0.28, 0.07);
      break;
    }
    case "keystone": {
      scheduleTone(ctx, now, 392.0, 0.32, 0.08, "triangle");
      scheduleTone(ctx, now + 0.1, 523.25, 0.36, 0.07, "triangle");
      break;
    }
    case "tp": {
      scheduleSweep(ctx, now, 440, 740, 0.35, 0.07);
      scheduleTone(ctx, now + 0.18, 659.25, 0.22, 0.05);
      break;
    }
    case "phase": {
      scheduleTone(ctx, now, 392.0, 0.18, 0.06, "triangle");
      scheduleTone(ctx, now + 0.12, 523.25, 0.22, 0.05, "triangle");
      break;
    }
    default:
      break;
  }
}

/** Short whoosh for committing a card to a challenge. */
export function playCardCommit(): void {
  if (!canPlay()) return;
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.005;
  scheduleTone(ctx, now, 440, 0.06, 0.05, "sine");
  scheduleTone(ctx, now + 0.03, 580, 0.05, 0.04, "sine");
}

/** Ascending arpeggio for challenge completion. */
export function playChallengeComplete(): void {
  if (!canPlay()) return;
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.01;
  scheduleTone(ctx, now, 523.25, 0.20, 0.07, "sine");       // C5
  scheduleTone(ctx, now + 0.10, 659.25, 0.20, 0.06, "sine"); // E5
  scheduleTone(ctx, now + 0.20, 783.99, 0.26, 0.06, "sine"); // G5
  scheduleTone(ctx, now + 0.32, 1046.5, 0.30, 0.05, "sine"); // C6
}

/** Warm tone for gaining a teaching. */
export function playTeachingGained(): void {
  if (!canPlay()) return;
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.01;
  scheduleTone(ctx, now, 330, 0.18, 0.06, "triangle");       // E4
  scheduleTone(ctx, now + 0.08, 440, 0.22, 0.05, "triangle"); // A4
  scheduleSweep(ctx, now + 0.16, 440, 660, 0.20, 0.04);      // sweep up
}

/** Shimmering double-tone for gaining an artifact. */
export function playArtifactGained(): void {
  if (!canPlay()) return;
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.01;
  scheduleTone(ctx, now, 587.33, 0.15, 0.06, "sine");         // D5
  scheduleTone(ctx, now + 0.06, 880, 0.12, 0.05, "sine");     // A5
  scheduleTone(ctx, now + 0.12, 587.33, 0.10, 0.04, "sine");  // D5 echo
  scheduleTone(ctx, now + 0.18, 1174.66, 0.16, 0.03, "sine"); // D6 shimmer
}

/** Short low buzz for invalid/denied actions. */
export function playDeny(): void {
  if (!canPlay()) return;
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.005;
  scheduleTone(ctx, now, 150, 0.10, 0.06, "square");
  scheduleTone(ctx, now + 0.06, 120, 0.08, 0.05, "square");
}

export function playTurnStart(): void {
  if (!canPlay()) return;
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.005;
  // Rising whoosh sweep + soft chime
  scheduleSweep(ctx, now, 180, 600, 0.25, 0.06);
  scheduleTone(ctx, now + 0.18, 660, 0.12, 0.05, "sine");
  scheduleTone(ctx, now + 0.24, 880, 0.10, 0.04, "sine");
}

export function playHover(): void {
  if (!canPlay()) return;
  const ctx = ensureContext();
  if (!ctx || !masterGain) return;

  // Initialize audio element if needed
  if (!hoverAudio) {
    hoverAudio = new Audio("/audio/hover_pulse.mp3");
    hoverAudio.preload = "auto";
    hoverAudio.loop = true;
  }

  // Create source and gain nodes if not exists
  if (!hoverSourceNode && hoverAudio) {
    try {
      hoverSourceNode = ctx.createMediaElementSource(hoverAudio);
      hoverGainNode = ctx.createGain();
      hoverGainNode.gain.value = 0;
      hoverSourceNode.connect(hoverGainNode).connect(masterGain);
    } catch (e) {
      // Fallback to direct volume control if WebAudio fails
      hoverSourceNode = null;
      hoverGainNode = null;
    }
  }

  // Start playback
  hoverAudio.currentTime = 0;
  hoverFadeStartTime = performance.now();

  // Start playing
  hoverAudio.play().catch(() => {});

  // Fade in over 2 seconds to max 50% volume
  if (hoverGainNode) {
    const now = ctx.currentTime;
    hoverGainNode.gain.cancelScheduledValues(now);
    hoverGainNode.gain.setValueAtTime(0, now);
    hoverGainNode.gain.linearRampToValueAtTime(HOVER_MAX_VOLUME, now + HOVER_FADE_DURATION / 1000);
  } else if (hoverAudio) {
    // Fallback: animate volume manually
    hoverAudio.volume = 0;
    animateHoverVolume(0, HOVER_MAX_VOLUME, HOVER_FADE_DURATION);
  }
}

function animateHoverVolume(from: number, to: number, duration: number): void {
  const start = performance.now();
  const step = () => {
    const now = performance.now();
    const t = Math.min(1, (now - start) / duration);
    if (hoverAudio) {
      hoverAudio.volume = from + (to - from) * t;
    }
    if (t < 1) {
      requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}

export function stopHover(): void {
  if (hoverAudio) {
    hoverAudio.pause();
    hoverAudio.currentTime = 0;
  }
  if (hoverGainNode && audioCtx) {
    const now = audioCtx.currentTime;
    hoverGainNode.gain.cancelScheduledValues(now);
    hoverGainNode.gain.setValueAtTime(0, now);
  }
}

function ensureIntroNode(): void {
  const ctx = ensureContext();
  if (!ctx || !masterGain) return;
  if (!introAudio) {
    introAudio = new Audio("/audio/intro_theme.mp3");
    introAudio.loop = true;
    introAudio.preload = "auto";
  }
  if (!introSource && introAudio) {
    try {
      introSource = ctx.createMediaElementSource(introAudio);
      introGain = ctx.createGain();
      introGain.gain.value = 0;
      introSource.connect(introGain).connect(masterGain);
    } catch (e) {
      introSource = null;
      introGain = null;
    }
  }
}

function startIntro(): void {
  ensureIntroNode();
  if (!soundEnabled || !musicEnabled || !soundActivated) return;
  introPlaying = true;
  introAudio?.play().catch(() => {});
  if (introGain && audioCtx) {
    const now = audioCtx.currentTime;
    introGain.gain.cancelScheduledValues(now);
    introGain.gain.setValueAtTime(introGain.gain.value, now);
    introGain.gain.linearRampToValueAtTime(musicVolume, now + 0.5);
  } else if (introAudio) {
    introAudio.volume = musicVolume;
  }
}

function stopIntro(): void {
  if (introAudio) {
    introAudio.pause();
  }
  if (introGain && audioCtx) {
    try {
      const now = audioCtx.currentTime;
      introGain.gain.cancelScheduledValues(now);
      introGain.gain.setValueAtTime(0, now);
    } catch (e) {}
  }
  introPlaying = false;
}

/** Crossfade from intro theme to Starlit Council game theme. */
export function transitionToGameTheme(): void {
  ensureMusicNodes();
  introFinished = true;
  if (!canPlay() || !musicEnabled) {
    stopIntro();
    return;
  }
  // If intro was never actually playing (user's first click was New Game),
  // just start the game theme directly — no crossfade needed
  if (!introPlaying) {
    stopIntro();
    startTheme();
    return;
  }
  const sec = INTRO_TO_THEME_FADE_MS / 1000;
  // Start the game theme playing (at zero volume initially)
  themeAudio?.play().catch(() => {});
  if (audioCtx && introGain && themeGain) {
    const now = audioCtx.currentTime;
    // Fade out intro
    introGain.gain.cancelScheduledValues(now);
    introGain.gain.setValueAtTime(introGain.gain.value, now);
    introGain.gain.linearRampToValueAtTime(0, now + sec);
    // Fade in game theme
    themeGain.gain.cancelScheduledValues(now);
    themeGain.gain.setValueAtTime(themeGain.gain.value, now);
    themeGain.gain.linearRampToValueAtTime(musicVolume, now + sec);
    // After fade, pause intro element
    setTimeout(() => {
      introAudio?.pause();
      introPlaying = false;
    }, INTRO_TO_THEME_FADE_MS + 50);
  } else {
    // Fallback: element volume crossfade
    fadeElementVolumes({ fromEl: introAudio, toEl: themeAudio, ms: INTRO_TO_THEME_FADE_MS });
    setTimeout(() => {
      introAudio?.pause();
      introPlaying = false;
    }, INTRO_TO_THEME_FADE_MS + 50);
  }
}

function ensureMusicNodes(): void {
  const ctx = ensureContext();
  if (!ctx || !masterGain) return;
  ensureIntroNode();
  if (!themeAudio) {
    themeAudio = new Audio("/audio/Starlit_Council.mp3");
    themeAudio.loop = true;
    themeAudio.preload = "auto";
  }
  if (!themeSource && themeAudio) {
    try {
      themeSource = ctx.createMediaElementSource(themeAudio);
      themeGain = ctx.createGain();
      themeGain.gain.value = 0;
      themeSource.connect(themeGain).connect(masterGain);

    } catch (e) {
      themeSource = null;
      themeGain = null;

    }
  }
  if (!challengeAudio) {
    challengeAudio = new Audio("/audio/challenge.mp3");
    challengeAudio.loop = true;
    challengeAudio.preload = "auto";

  }
  if (!challengeSource && challengeAudio) {
    try {
      challengeSource = ctx.createMediaElementSource(challengeAudio);
      challengeGain = ctx.createGain();
      challengeGain.gain.value = 0;
      challengeSource.connect(challengeGain).connect(masterGain);

    } catch (e) {
      challengeSource = null;
      challengeGain = null;

    }
  }
}

function updateMusicGain(): void {
  const muted = !soundEnabled || !musicEnabled;
  // Intro gain
  if (introGain) {
    introGain.gain.value = muted ? 0 : (introGain.gain.value && introGain.gain.value > 0 ? introGain.gain.value : (introPlaying ? musicVolume : 0));
  } else if (introAudio) {
    introAudio.volume = muted ? 0 : (introPlaying ? musicVolume : 0);
  }
  // Theme gain
  if (themeGain) {
    themeGain.gain.value = muted ? 0 : (themeGain.gain.value && themeGain.gain.value > 0 ? themeGain.gain.value : musicVolume);
  } else if (themeAudio) {
    themeAudio.volume = muted ? 0 : musicVolume;
  }
  // Challenge gain
  if (challengeGain) {
    challengeGain.gain.value = muted ? 0 : (challengeGain.gain.value && challengeGain.gain.value > 0 ? challengeGain.gain.value : 0);
  } else if (challengeAudio) {
    challengeAudio.volume = muted ? 0 : 0;
  }
}

function startTheme(): void {
  ensureMusicNodes();
  updateMusicGain();
  if (!soundEnabled || !musicEnabled || !soundActivated) return;
  // Ensure theme is playing
  themeAudio?.play().catch(() => {});
  // Fade in theme and fade out challenge
  fadeToTheme(MUSIC_FADE_MS);
}

function stopTheme(): void {
  if (themeAudio) {
    themeAudio.pause();
  }
  if (themeGain) {
    // immediately zero gain
    try {
      const now = audioCtx?.currentTime ?? 0;
      themeGain.gain.cancelScheduledValues(now);
      themeGain.gain.setValueAtTime(0, now);
    } catch (e) {}
  }
}

function stopChallengeMusicImmediate(): void {
  // Pause and zero out challenge audio/gain
  if (challengeAudio) {
    challengeAudio.pause();
  }
  if (challengeGain) {
    try {
      const now = audioCtx?.currentTime ?? 0;
      challengeGain.gain.cancelScheduledValues(now);
      challengeGain.gain.setValueAtTime(0, now);
    } catch (e) {}
  }
}

export function setChallengeActive(active: boolean): void {
  ensureMusicNodes();

  if (!canPlay() || !musicEnabled || !soundEnabled) {

    return;
  }
  if (active) {
    // start challenge audio playback and crossfade
    challengeAudio?.play().catch(() => {});
    fadeToChallenge(MUSIC_FADE_MS);
  } else {
    // crossfade back to theme
    fadeToTheme(MUSIC_FADE_MS);
  }
}

// Debug helper: call from console for quick testing: import('./render/sfx').then(m => m._debugPlay())
export function _debugPlay(): void {

  setChallengeActive(true);
}

function fadeToChallenge(ms: number): void {
  const sec = ms / 1000;
  const ctx = audioCtx;
  if (ctx && challengeGain && themeGain) {
    const now = ctx.currentTime;
    try {

      themeGain.gain.cancelScheduledValues(now);
      challengeGain.gain.cancelScheduledValues(now);
      themeGain.gain.setValueAtTime(themeGain.gain.value, now);
      challengeGain.gain.setValueAtTime(challengeGain.gain.value, now);
      themeGain.gain.linearRampToValueAtTime(0, now + sec);
      challengeGain.gain.linearRampToValueAtTime(musicVolume, now + sec);
    } catch (e) {

      // fallback to element volume
      fadeElementVolumes({ fromEl: themeAudio, toEl: challengeAudio, ms });
    }
  } else {

    fadeElementVolumes({ fromEl: themeAudio, toEl: challengeAudio, ms });
  }
}

function fadeToTheme(ms: number): void {
  const sec = ms / 1000;
  const ctx = audioCtx;
  if (ctx && challengeGain && themeGain) {
    const now = ctx.currentTime;
    try {

      themeGain.gain.cancelScheduledValues(now);
      challengeGain.gain.cancelScheduledValues(now);
      themeGain.gain.setValueAtTime(themeGain.gain.value, now);
      challengeGain.gain.setValueAtTime(challengeGain.gain.value, now);
      themeGain.gain.linearRampToValueAtTime(musicVolume, now + sec);
      challengeGain.gain.linearRampToValueAtTime(0, now + sec);
      // after fade, pause challenge element
      setTimeout(() => {
        challengeAudio?.pause();
      }, ms + 30);
    } catch (e) {

      fadeElementVolumes({ fromEl: challengeAudio, toEl: themeAudio, ms });
    }
  } else {

    fadeElementVolumes({ fromEl: challengeAudio, toEl: themeAudio, ms });
    setTimeout(() => challengeAudio?.pause(), ms + 30);
  }
}

function fadeElementVolumes(opts: { fromEl: HTMLAudioElement | null; toEl: HTMLAudioElement | null; ms: number }) {
  const { fromEl, toEl, ms } = opts;
  if (!fromEl && !toEl) return;
  const startFrom = fromEl ? fromEl.volume : 0;
  const startTo = toEl ? toEl.volume : 0;
  const targetFrom = 0;
  const targetTo = musicVolume;
  const start = performance.now();
  const step = () => {
    const now = performance.now();
    const t = Math.min(1, (now - start) / ms);
    const eased = t; // linear for now
    if (fromEl) fromEl.volume = startFrom + (targetFrom - startFrom) * eased;
    if (toEl) toEl.volume = startTo + (targetTo - startTo) * eased;
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      if (fromEl) fromEl.volume = targetFrom;
      if (toEl) toEl.volume = targetTo;
    }
  };
  if (toEl && toEl.paused) {
    toEl.play().catch(() => {});
  }
  requestAnimationFrame(step);
}
