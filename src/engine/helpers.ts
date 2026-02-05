import { dataStore } from "./state";
import { Rng } from "./rng";

export function randomGameCardId(rng: Rng): string | undefined {
  if (dataStore.cards.length === 0) {
    return undefined;
  }
  return dataStore.cards[rng.nextInt(0, dataStore.cards.length - 1)].id;
}
