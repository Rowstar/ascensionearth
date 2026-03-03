import { GameState, UiFocusMode } from "../engine/types";

export const FOCUS_MODE_ORDER: UiFocusMode[] = [
  "ACTION_SELECT",
  "CHALLENGE",
  "RESULTS",
  "EARTH_CHAMBER"
];

export function deriveFocusMode(state: GameState): UiFocusMode {
  const override = state.ui.focusModeOverride;
  if (override) {
    return override;
  }
  if (state.phase === "ACTION_SELECT" && state.ui.earthShopOpen) {
    return "EARTH_CHAMBER";
  }
  if (
    state.phase === "CHALLENGE"
  ) {
    return "CHALLENGE";
  }
  if (
    state.phase === "EVALUATION" ||
    state.phase === "GAME_OVER" ||
    !!state.ui.challengeResult ||
    !!state.ui.progressReview ||
    !!state.ui.endgameEvaluation
  ) {
    return "RESULTS";
  }
  return "ACTION_SELECT";
}

export function cycleFocusModeOverride(current?: UiFocusMode): UiFocusMode | undefined {
  const order: Array<UiFocusMode | undefined> = [undefined, ...FOCUS_MODE_ORDER];
  const currentIndex = order.findIndex((value) => value === current);
  const nextIndex = currentIndex < 0 ? 1 : (currentIndex + 1) % order.length;
  return order[nextIndex];
}

export function focusModeDataValue(mode: UiFocusMode): string {
  return mode.toLowerCase();
}

export function shortFocusModeLabel(mode: UiFocusMode): string {
  switch (mode) {
    case "ACTION_SELECT":
      return "AS";
    case "CHALLENGE":
      return "CH";
    case "RESULTS":
      return "RS";
    case "EARTH_CHAMBER":
      return "EC";
    default:
      return "??";
  }
}
