import { GameState, SfxEvent, SfxEventType } from "./types";

const MAX_SFX_EVENTS = 40;

export function emitSfxEvent(
  state: GameState,
  type: SfxEventType,
  payload?: Record<string, unknown>
): SfxEvent {
  state.sfxSeq = (state.sfxSeq ?? 0) + 1;
  const event: SfxEvent = {
    id: state.sfxSeq,
    type,
    timestamp: Date.now(),
    payload
  };
  if (!state.sfxEvents) {
    state.sfxEvents = [];
  }
  state.sfxEvents.push(event);
  if (state.sfxEvents.length > MAX_SFX_EVENTS) {
    state.sfxEvents.splice(0, state.sfxEvents.length - MAX_SFX_EVENTS);
  }
  return event;
}
