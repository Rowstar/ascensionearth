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
