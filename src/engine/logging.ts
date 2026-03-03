import { GameState } from "./types";

export const MAX_LOG_ENTRIES = 1200;
export const MAX_CHALLENGE_LOG_ENTRIES = 500;

export function trimLogs(state: GameState): void {
  if (state.log.length > MAX_LOG_ENTRIES) {
    state.log = state.log.slice(-MAX_LOG_ENTRIES);
  }
  if (state.challenge?.logEntries && state.challenge.logEntries.length > MAX_CHALLENGE_LOG_ENTRIES) {
    state.challenge.logEntries = state.challenge.logEntries.slice(-MAX_CHALLENGE_LOG_ENTRIES);
  }
}
