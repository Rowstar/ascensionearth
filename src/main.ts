import "./style.css";
import { CanvasApp, HitRegion } from "./render/canvas";
import { activateSound, setChallengeActive, setMusicEnabled, setMusicVolume, setSoundEnabled, transitionToGameTheme, tryAutoplayIntro } from "./render/sfx";
import { GameStore } from "./engine/reducer";
import { renderMenu } from "./screens/menu";
import { renderMatch } from "./screens/match";
import { loadPreferences, savePreferences } from "./utils/preferences";
import { nextGameSpeedMode } from "./utils/gameSpeed";
import { loadGame, hasSavedGame, deleteSave } from "./utils/save";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const store = new GameStore();
const app = new CanvasApp(canvas);

const prefs = loadPreferences();
if (
  prefs.soundEnabled !== undefined ||
  prefs.gameSpeedMode ||
  prefs.musicEnabled !== undefined ||
  prefs.musicVolume !== undefined ||
  prefs.motionEnabled !== undefined ||
  prefs.particleQuality ||
  prefs.menuMouseParallaxEnabled !== undefined
) {
  store.dispatch({ type: "APPLY_PREFERENCES", prefs });
}

// Try to autoplay intro music on page load (may be blocked by browser policy)
tryAutoplayIntro();

if (import.meta.env.DEV) {
  import("./tests/harness");
}

window.addEventListener("keydown", (event) => {
  activateSound();
  const state = store.state;
  if (state.ui.screen === "MENU") {
    if (event.key === "Enter") {
      store.dispatch({ type: "START_GAME" });
      return;
    }
    if (event.key === "Escape") {
      store.dispatch({ type: "SET_SEED_EDITING", editing: false });
      return;
    }
    if (!state.ui.seedEditing) {
      return;
    }
    if (event.key === "Backspace") {
      store.dispatch({ type: "SET_SEED", seed: state.ui.seedInput.slice(0, -1) });
      return;
    }
    if (event.key.length === 1) {
      const next = (state.ui.seedInput + event.key).slice(0, 24);
      store.dispatch({ type: "SET_SEED", seed: next });
    }
    return;
  }

  if (event.key === "F3") {
    event.preventDefault();
    showFps = !showFps;
    return;
  }

  if (state.ui.screen === "MATCH" && state.phase === "ACTION_SELECT") {
    switch (event.key) {
      case "1":
        store.dispatch({ type: "SELECT_ACTION", action: "MOUNTAIN" });
        break;
      case "2":
        store.dispatch({ type: "SELECT_ACTION", action: "CAVE" });
        break;
      case "3":
        store.dispatch({ type: "SELECT_ACTION", action: "MEDITATE" });
        break;
      case "4":
        store.dispatch({ type: "SELECT_ACTION", action: "EARTH" });
        break;
      case "Enter":
        store.dispatch({ type: "CONFIRM_ACTION" });
        break;
      default:
        break;
    }
  }
});

// FPS counter
let showFps = false;
const fpsFrames: number[] = [];

// Track previous phase/screen so we can trigger music transitions
let prevPhase: string | null = null;
let prevScreen: string | null = null;
let screenFadeAlpha = 0; // 1.0 = fully black, decays to 0 over 500ms

app.start((ctx, dt) => {
  let state = store.state;
  setSoundEnabled(state.ui.soundEnabled ?? true);
  setMusicEnabled(state.ui.musicEnabled ?? true);
  setMusicVolume((state.ui.musicVolume ?? 45) / 100);

  // Trigger music when entering/exiting CHALLENGE
  if (prevPhase !== state.phase) {
    const wasInChallenge = prevPhase === "CHALLENGE";
    const enteringChallenge = state.phase === "CHALLENGE";
    activateSound();
    if (enteringChallenge) {
      setChallengeActive(true);
    } else if (wasInChallenge) {
      setChallengeActive(false);
    }
  }
  prevPhase = state.phase;

  // Transition from intro theme to game theme when leaving menu
  if (prevScreen === "MENU" && state.ui.screen === "MATCH") {
    transitionToGameTheme();
    screenFadeAlpha = 1.0;
  }
  prevScreen = state.ui.screen;

  const regions: HitRegion[] = [];
  if (state.ui.screen === "MENU") {
    const saveMenuPreferences = () => {
      savePreferences({
        soundEnabled: store.state.ui.soundEnabled ?? true,
        musicEnabled: store.state.ui.musicEnabled ?? true,
        musicVolume: store.state.ui.musicVolume ?? 45,
        gameSpeedMode: store.state.settings.gameSpeedMode,
        motionEnabled: store.state.ui.motionEnabled ?? true,
        particleQuality: store.state.ui.particleQuality ?? "med",
        menuMouseParallaxEnabled: store.state.ui.menuMouseParallaxEnabled ?? true
      });
    };
    const handleToggleSound = () => {
      const nextEnabled = !(store.state.ui.soundEnabled ?? true);
      store.dispatch({ type: "TOGGLE_SOUND" });
      setSoundEnabled(nextEnabled);
      if (nextEnabled) {
        activateSound();
      }
      saveMenuPreferences();
    };
    const handleCycleSpeed = () => {
      const nextMode = nextGameSpeedMode(store.state.settings.gameSpeedMode);
      store.dispatch({ type: "SET_GAME_SPEED", mode: nextMode });
      saveMenuPreferences();
    };
    const handleToggleMotion = () => {
      store.dispatch({ type: "TOGGLE_MOTION" });
      saveMenuPreferences();
    };
    const handleCycleParticleQuality = () => {
      store.dispatch({ type: "CYCLE_PARTICLE_QUALITY" });
      saveMenuPreferences();
    };
    const handleToggleMouseParallax = () => {
      store.dispatch({ type: "TOGGLE_MENU_MOUSE_PARALLAX" });
      saveMenuPreferences();
    };
    const handleToggleDevPanel = () => {
      store.dispatch({ type: "TOGGLE_DEBUG" });
    };
    const handleSetDevTab = (tab: "TEACHINGS" | "ARTIFACTS") => {
      store.dispatch({ type: "SET_DEV_TAB", tab });
    };
    const handleGrantTeaching = (id: string) => {
      store.dispatch({ type: "DEV_GRANT_TEACHING", id });
    };
    const handleGrantArtifact = (id: string) => {
      store.dispatch({ type: "DEV_GRANT_ARTIFACT", id });
    };
    const handleDevScroll = (delta: number) => {
      const current = store.state.ui.devPanelScroll ?? 0;
      store.dispatch({ type: "SET_DEV_SCROLL", value: Math.max(0, current + delta) });
    };
    const handleContinue = hasSavedGame() ? () => {
      const saved = loadGame();
      if (saved) {
        store.dispatch({ type: "LOAD_GAME", state: saved });
        deleteSave();
      }
    } : undefined;
    renderMenu(
      ctx,
      state,
      regions,
      {
        onStart: () => {
          deleteSave();
          store.dispatch({ type: "START_GAME" });
        },
        onContinue: handleContinue,
        onSeedFocus: () => store.dispatch({ type: "SET_SEED_EDITING", editing: true }),
        onSeedBlur: () => store.dispatch({ type: "SET_SEED_EDITING", editing: false }),
        onToggleSound: handleToggleSound,
        onCycleSpeed: handleCycleSpeed,
        onToggleMotion: handleToggleMotion,
        onCycleParticleQuality: handleCycleParticleQuality,
        onToggleMouseParallax: handleToggleMouseParallax
      },
      app.hoveredId,
      { dt, mouseX: app.mouseX, mouseY: app.mouseY }
    );
  } else {
    if (state.phase === "CHALLENGE") {
      store.dispatch({ type: "CHALLENGE_TICK", dt });
      state = store.state;
    }
    store.dispatch({ type: "AI_TICK", dt });
    state = store.state;
    renderMatch(ctx, state, regions, (action) => store.dispatch(action), app.hoveredId, dt);
  }
  // FPS counter
  if (showFps) {
    const now = performance.now();
    fpsFrames.push(now);
    while (fpsFrames.length > 0 && fpsFrames[0] < now - 1000) fpsFrames.shift();
    const fps = fpsFrames.length;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(4, 4, 64, 22);
    ctx.fillStyle = fps >= 55 ? "#8bd4a1" : fps >= 30 ? "#e6c87a" : "#e66a5a";
    ctx.font = "700 13px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`${fps} FPS`, 10, 8);
    ctx.restore();
  }

  // Screen transition fade overlay
  if (screenFadeAlpha > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${screenFadeAlpha.toFixed(3)})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    screenFadeAlpha = Math.max(0, screenFadeAlpha - dt / 500);
  }
  return regions;
});
