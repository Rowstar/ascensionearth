import { GameSpeedMode, ParticleQuality } from "../engine/types";

export type UserPreferences = {
  soundEnabled?: boolean;
  musicEnabled?: boolean;
  musicVolume?: number;
  gameSpeedMode?: GameSpeedMode;
  motionEnabled?: boolean;
  particleQuality?: ParticleQuality;
  menuMouseParallaxEnabled?: boolean;
};

const STORAGE_KEY = "ascension-earth-preferences";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadPreferences(): UserPreferences {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as UserPreferences;
    const next: UserPreferences = {};
    if (typeof parsed?.soundEnabled === "boolean") {
      next.soundEnabled = parsed.soundEnabled;
    }
    if (typeof parsed?.musicEnabled === "boolean") {
      next.musicEnabled = parsed.musicEnabled;
    }
    if (typeof parsed?.musicVolume === "number") {
      next.musicVolume = parsed.musicVolume;
    }
    if (parsed?.gameSpeedMode === "NORMAL" || parsed?.gameSpeedMode === "FAST" || parsed?.gameSpeedMode === "INSTANT") {
      next.gameSpeedMode = parsed.gameSpeedMode;
    }
    if (typeof parsed?.motionEnabled === "boolean") {
      next.motionEnabled = parsed.motionEnabled;
    }
    if (parsed?.particleQuality === "low" || parsed?.particleQuality === "med" || parsed?.particleQuality === "high") {
      next.particleQuality = parsed.particleQuality;
    }
    if (typeof parsed?.menuMouseParallaxEnabled === "boolean") {
      next.menuMouseParallaxEnabled = parsed.menuMouseParallaxEnabled;
    }
    return next;
  } catch {
    return {};
  }
}

export function savePreferences(next: UserPreferences): void {
  if (!canUseStorage()) return;
  try {
    const current = loadPreferences();
    const merged = { ...current, ...next };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Ignore storage failures (private mode, quota, etc).
  }
}
