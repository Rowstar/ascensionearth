import { GameSpeedMode } from "../engine/types";

export function getSpeedMultiplier(mode: GameSpeedMode): number {
  if (mode === "FAST") return 0.5;
  if (mode === "INSTANT") return 0.0;
  return 1.0;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function scaledDelayMs(baseMs: number, mode: GameSpeedMode): number {
  const ms = Math.round(baseMs * getSpeedMultiplier(mode));
  return Math.max(0, ms);
}
