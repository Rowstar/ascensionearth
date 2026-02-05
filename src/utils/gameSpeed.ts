import { GameSpeedMode } from "../engine/types";

export function nextGameSpeedMode(mode: GameSpeedMode): GameSpeedMode {
  if (mode === "NORMAL") return "FAST";
  if (mode === "FAST") return "INSTANT";
  return "NORMAL";
}

export function gameSpeedLabel(mode: GameSpeedMode): string {
  if (mode === "FAST") return "Fast";
  if (mode === "INSTANT") return "Instant";
  return "Normal";
}
