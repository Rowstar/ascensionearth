import { GameState } from "../engine/types";

const SAVE_KEY = "ascension-earth-save";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function saveGame(state: GameState): boolean {
  if (!canUseStorage()) return false;
  try {
    const json = JSON.stringify(state);
    window.localStorage.setItem(SAVE_KEY, json);
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): GameState | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as GameState;
    // Basic validation: must have players and a turn number
    if (!state.players || !Array.isArray(state.players) || typeof state.turn !== "number") {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export function hasSavedGame(): boolean {
  if (!canUseStorage()) return false;
  return window.localStorage.getItem(SAVE_KEY) !== null;
}

export function deleteSave(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Ignore
  }
}
