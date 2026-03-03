import { GameState } from "../engine/types";

export function resolveMotionEnabled(state: GameState, prefersReducedMotion: boolean): boolean {
  return (state.ui.motionEnabled ?? true) && !prefersReducedMotion;
}
