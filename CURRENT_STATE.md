# CURRENT_STATE.md

## Snapshot Date
2026-02-05

## What Exists Now
- Browser-based TypeScript + Vite prototype with a canvas game loop.
- Menu and match screens with action selection, confirm flow, and challenge resolution.
- Deterministic seed input and reproducible game starts for debugging and balancing.
- AI turn ticking integrated into reducer-driven state updates.
- Audio system with intro/game/challenge music and hover/challenge SFX.
- Save/load support plus persisted preferences (sound, music, speed, motion, particle quality, parallax).
- Data-driven content from JSON sets (cards, spells, artifacts, teachings).
- In-browser test harness available via `runAscensionTests()` in the console.
- Progress Review rounds now trigger every 5 turns (configurable) with one-turn warning, baseline checks, trophy category winner resolution, and seeded deterministic 3-option trophy rewards.
- Trophy system now includes multi-category scoring with cooldown-aware sampling and winner explanation UI.
- Earth Advancement is redesigned around multi-requirement combinations (crystals + other resources) and AP-focused rewards with tiny passives.
- Endgame Evaluation phase now triggers when Earth Ascension reaches the 999 target, evaluates run categories, and grants themed AP rewards.
- AI decisioning now factors Earth requirement needs and AP-oriented progression goals.
- Earth Advancement now has a dedicated shop-like chamber overlay for tier card inspection, requirement clarity, and one-click EARTH tier selection.
- Top bar now includes organized per-player trophy icon strips with rich hover details (reward AP, passive, winner reason, round won).
- Action-select map now shows Progress Review trophy requirement panels (baseline + category guidance) in the previous keystone HUD location.
- Hovering the Earth node now reveals a single "Open Earth Chamber" button positioned directly over the node for reliable click flow.
- Journey node hover tooltips now include keystone progress and next milestone distance; persistent keystone meters were removed from map/top bar.
- Earth Chamber now renders all 6 unique advancement variants at once (not only active tier tops), with clear active-vs-queued status and persistent selected-state highlighting.
- Earth AP scaling is now requirement-driven: Crystals are valued at 7 AP each, with tier bonuses of +30% / +40% / +50% over requirement value (tier 1/2/3).

## Known Issues / Gaps
- Automated tests are minimal; most validation is still manual playtesting.
- UI complexity is growing, so periodic readability and hierarchy passes are needed.
- Build reports an existing Vite warning about mixed static/dynamic imports for `src/render/sfx.ts`.
- Macro-progression numbers (baseline scaling, AP reward scaling, trophy cadence feel) still need dedicated balance passes.

## Current Focus
- Balance and tune progression cadence for Progress Reviews, Earth Advancement costs, and endgame Evaluation rewards.
- Improve explanation UX density so new systems stay legible on desktop and mobile.
- Expand deterministic verification beyond smoke tests as progression systems grow.

## Open Questions (High-Level)
- Next priority direction: should tuning favor faster AP progression pace or stronger strategic divergence between trophy categories?
- Should the default run length remain 10 rounds, or move longer once progression loops feel stable?
