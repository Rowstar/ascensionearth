# DECISION_LOG.md

Use this file for locked, high-level decisions only.

## Entry Template
### YYYY-MM-DD - Decision Title
- Context:
- Decision:
- Rationale:
- Consequences:
- Owner:
- Revisit Trigger:

## Entries
### 2026-02-05 - AP-First Meta Progression Rewards
- Context: Trophy rounds, Earth Advancement, and Endgame Evaluation were expanded as recurring progression systems.
- Decision: These systems grant Personal/Total Ascension Power as the primary reward, with only tiny passive buffs as optional secondary effects.
- Rationale: Keep macro progression focused, reduce reward-system sprawl, and preserve card/spell/artifact economy balance.
- Consequences: New systems must avoid granting cards, artifacts, spells, invocations, or similar inventory items.
- Owner: AI Studio
- Revisit Trigger: If AP progression pacing underperforms in playtests for 3+ consecutive balancing passes.

### 2026-02-05 - Structured Review + Evaluation Cadence
- Context: Mid-run and end-run performance reflection loops were requested.
- Decision: Add Progress Review rounds every 5 turns (configurable), with one-turn warning, and final Evaluation phase at turn 10 by default (configurable).
- Rationale: Creates predictable cadence for strategic checkpoints and clearer run-end identity.
- Consequences: UI, AI, and scoring logic all align to round-based milestone checks.
- Owner: AI Studio
- Revisit Trigger: If run length or pacing goals shift materially during next roadmap phase.

### 2026-02-05 - Dedicated Earth Chamber + Trophy Header Discoverability
- Context: Earth Advancement requirements and trophy outcomes were becoming hard to parse from map hover text alone.
- Decision: Add a dedicated Earth Advancement chamber overlay (shop-like) and a top-bar per-player trophy icon strip with hover explanations.
- Rationale: Improve discoverability and reduce cognitive load while preserving current action economy and AP-first progression design.
- Consequences: Earth selection is now faster/clearer; trophy outcomes remain visible throughout the run with contextual hover detail.
- Owner: AI Studio
- Revisit Trigger: If top bar density hurts readability on small viewports or if players still miss Earth requirements in playtests.

### 2026-02-05 - Map HUD Reallocation: Trophy Requirements In, Keystone Meters Out
- Context: CEO requested clearer trophy attainment guidance and to avoid showing journey keystones outside challenge context.
- Decision: Replace map keystone panels with Progress Review trophy-requirement panels; keep keystone bars only in challenge UI and surface keystone progress via journey-node hover tooltips.
- Rationale: Align information with immediate player decision (which action to take now) while reducing persistent HUD competition.
- Consequences: Action-select map now emphasizes review baselines/category paths and Earth entry affordance; keystone detail remains available where it matters (journey flow/challenge).
- Owner: AI Studio
- Revisit Trigger: If players report missing keystone state during action selection despite enriched node tooltips.

### 2026-02-05 - Single-Target Hover Controls for Earth Entry
- Context: Earth chamber entry was hard to click when detached from the hovered Earth node and duplicated in multiple HUD areas.
- Decision: Use one Earth-entry button that appears over the Earth node on hover; remove duplicate Earth-entry buttons from other persistent HUD zones.
- Rationale: Reduce control ambiguity and prevent hover-loss click failures.
- Consequences: Earth chamber remains discoverable through map intent while preserving cleaner top/bottom HUD hierarchy.
- Owner: AI Studio
- Revisit Trigger: If repeated playtests show users still miss Earth chamber entry timing.
