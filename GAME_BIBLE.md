# Ascension Earth - Current Game Bible

Version date: 2026-03-03  
Source of truth: implementation in `src/engine/*`, `src/screens/*`, `src/render/*`, `src/data/*`.

## 1) Game Overview

- Format: turn-based, deterministic, browser strategy card game.
- Players: 3 total (1 human, 2 AI).
- Primary objective: increase Earth Ascension Power to the target (`999`) and finish with the strongest final AP profile.
- Theme: mystic/arcane progression through meditation, journeys, teachings, artifacts, invocations, and Earth advancements.

## 2) Platform and Runtime (Web)

- Engine/runtime:
  - TypeScript (`strict`) + Vite.
  - Browser canvas app (`<canvas id="game-canvas">`) with custom render/input loop.
  - ESM build target (`ES2020`, `module: ESNext`).
- Scripts:
  - `npm run dev` -> Vite dev server (port `5173`).
  - `npm run build` -> production build.
  - `npm run preview` -> preview built output.
  - `npm run studio:brief`.
- Persistence:
  - Save key: `ascension-earth-save`.
  - Preferences key: `ascension-earth-preferences`.
- Determinism:
  - Seeded PRNG (`Rng`) with `snapshot()`/`restore()`.
  - Seed is user-editable in menu and persisted in game state.
- Input:
  - Pointer + touch support with hit regions.
  - Keyboard shortcuts for action selection and confirm in action phase.
- Audio:
  - Hybrid WebAudio + media tracks.
  - Intro theme, in-game theme, challenge theme, hover pulse, and procedural SFX.
  - Challenge music crossfades in/out with phase transitions.
- Build health (audit run):
  - `vite build` succeeds.
  - Current production JS chunk: ~330 KB (pre-gzip), CSS ~1.52 KB.

## 3) Core Loop and Phases

Game phase enum:
- `ROLL_POOLS`
- `ACTION_SELECT`
- `ACTION_REVEAL`
- `CHALLENGE`
- `EVALUATION`
- `TURN_END`
- `GAME_OVER`

Per-turn high-level flow:
1. Turn start grants each player `+1 Crystal`.
2. Trophy crystal drip may add additional crystals.
3. Mountain and Cave reward pools each roll 2 dice and merge with existing pools.
4. Shop offerings refresh.
5. Players choose one action (`MEDITATE`, `MOUNTAIN`, `CAVE`, `EARTH`).
6. `LOCK_ACTIONS` resolves:
   - `MEDITATE` resolves immediately.
   - `EARTH` attempts Earth Advancement purchase by selected tier.
   - `MOUNTAIN` and `CAVE` always queue Guardian Challenges (solo or contested).
7. Challenge queue resolves (one challenge at a time).
8. Turn advances.

Run endpoint:
- Endgame Evaluation starts when Earth Ascension reaches `999`.

## 4) Action Systems

### Meditate

- Draws 2 game cards baseline.
- Invocation gain chance:
  - Base 30%.
  - Basic teachings can add permanent and one-time bonuses.
  - Chance is capped at 100%.
- Late-game crystal bonus:
  - Turn >= 6: +1 Crystal.
  - Turn >= 10: +2 Crystals.
- Logs meditation gains into turn-start reward toast for next round.

### Mountain Journey / Cave Journey

- Always launches a Guardian Challenge.
- Reward pools are not directly claimed by solo action anymore.
- Human keystone progression tracks:
  - Cave uses AP gained in cave challenge.
  - Mountain uses teaching power gained in mountain challenge.

### Earth Advancement

- Solo action.
- Each player may select an Earth tier (`1`, `2`, `3`) before confirm.
- Purchase requires crystals plus mixed resource consumption:
  - artifacts/invocations/cardsAny/cardsByRarity depending on card.
- Provides large AP contribution and optional passive buffs.

## 5) Challenge System

Challenge phase enum:
- `ROLL_ORDER`
- `COMMIT_TURNS`
- `REVEAL`
- `RESOLVE`
- `DRAFT`

Core rules:
- Initiative via d6 roll; ties reroll.
- Commit structure:
  - One commit per beat: one card OR one invocation OR pass.
  - Max commits per player per challenge: `3` total items.
  - First committed game card is hidden by default.
- Commit ends when consecutive passes >= active player count.
- Reveal step logs each player reveal.
- Resolve step computes totals.
- Guardian draft:
  - Reward unlocks depend on total group AP.
  - Draft order is by AP contribution (descending).
- Fold/withdraw:
  - Supported during commit phase.
  - Default fold keep rule: folded player keeps their face-down committed card unless overridden by effects.

Reward unlock math:
- Base reward cost by kind:
  - crystal `6`
  - gameCard `9`
  - spell `12`
  - artifact `18`
- Final unlock cost formula:
  - `ceil(baseCost * participantCount * 1.25)`

## 6) TP, Keystone, Trophy, and Endgame Progression

### Teaching Potential (TP)

- Effective TP multiplier: `x2` (`TP_GAIN_MULT`).
- Base thresholds per challenge:
  - Basic: `8`
  - Rare: `16`
  - Mythic: `24`
- Threshold rewards grant teachings and can trigger additional artifact/passive effects.
- Tome of Enlightenment: lowers current thresholds by 3.

Card-commit TP gain (`teachingPotentialGainForCard`):
- Cosmic: `round(AP * 0.4)`, clamped to `1..5`.
- Non-cosmic:
  - AP <= 4 -> 5
  - AP <= 6 -> 4
  - AP <= 8 -> 3
  - AP <= 10 -> 2
  - else -> 1

### Keystone milestones (human only)

Cave track (AP-based):
- Crystal tier 1: 50 (+3 Crystals)
- Rare unlock: 100 (`lantern_of_the_unseen`)
- Crystal tier 2: 200 (+8 Crystals)
- Mythic unlock: 300 (`echoes_in_the_stone`)

Mountain track (teaching-power-based):
- Crystal tier 1: 40 (+3 Crystals)
- Rare unlock: 80 (`breath_of_the_summit`)
- Crystal tier 2: 160 (+8 Crystals)
- Mythic unlock: 250 (`crown_of_endurance`)

### Progress Review (trophies)

- Cadence: every 5 rounds.
- Warning lead: 1 round.
- Offer count: 3 trophies per review.
- Cooldown: recently offered trophies are cooled down for 2 reviews.
- Baseline gate per review index:
  - `minCrystals = 6 + (reviewIndex - 1)`
  - `minTeachings = 1 + floor((reviewIndex - 1) / 2)`
- Winner gets AP and optional passive buff.

### Endgame Evaluation

Triggered at Earth Ascension `999`.

Categories:
- Wisdom Reward (Teachings + Arcane Study), base AP 18.
- Balance Reward (Challenge Win Rate), base AP 16.
- Discipline Reward (Efficiency + Earth Progress), base AP 20.

## 7) Economy and Scoring Rules

Economy constants:
- Crystal AP value: `5`.
- Shop card cost: `2` Crystals.
- Shop invocation cost: `3` Crystals.
- Invocation slot cap: `8`.

Sell values:
- Game card: `+1 Crystal`
- Invocation: `+1 Crystal`
- Artifact: `+2 Crystals`
- Non-basic teaching: `+1 Crystal`

Final AP breakdown:
- crystals AP + hand AP + invocations AP + artifacts AP + earth AP + bonus AP + convergence AP.

Earth advancement AP:
- Requirement-driven AP floor plus tier bonus scaling.
- Crystal valuation inside Earth AP formula uses 7 AP per crystal.

## 8) Content Inventory

### 8.1 Game Cards

Dataset totals:
- 20 card types.
- 35 source copies.
- Runtime deck includes all non-cosmic plus 3 random cosmics per run (reduced cosmic frequency).

Card list:

| Name | ID | Category | AP | Tags | Count |
|---|---|---:|---:|---|---:|
| Blue Lotus | `blue_lotus` | game | 5 | Plant | 2 |
| Magical Butterfly | `magical_butterfly` | game | 6 | Animal | 2 |
| Temple Priestess | `temple_priestess` | game | 7 | Human | 2 |
| Happy Holy Man | `happy_holy_man` | game | 8 | Human | 2 |
| Ancient Turtle | `ancient_turtle` | game | 9 | Animal | 2 |
| Ethereal Cactus | `ethereal_cactus` | game | 10 | Plant | 2 |
| Kundalini Snake | `kundalini_snake` | game | 11 | Animal | 2 |
| Mystical Mushrooms | `mystical_mushrooms` | game | 12 | Plant | 2 |
| Astral Cockatoo | `astral_cockatoo` | game | 13 | Animal | 2 |
| Druid | `druid` | game | 14 | Human | 2 |
| Enlightened Dolphin | `enlightened_dolphin` | game | 15 | Animal | 2 |
| Cosmic Toad | `cosmic_toad` | game | 16 | Animal | 2 |
| Shaman | `shaman` | game | 17 | Human | 2 |
| Master Monk | `master_monk` | game | 18 | Human | 2 |
| Tree of Life | `tree_of_life` | game | 19 | Plant | 2 |
| Niam | `niam` | cosmic | 23 | Cosmic | 1 |
| Shengar | `shengar` | cosmic | 23 | Cosmic | 1 |
| Verla | `verla` | cosmic | 23 | Cosmic | 1 |
| Galactic Mushroom | `galactic_mushroom` | cosmic | 25 | Cosmic, Plant | 1 |
| Galactic Dragon | `galactic_dragon` | cosmic | 30 | Cosmic, Animal | 1 |

### 8.2 Invocations (Spells)

- 10 types, 20 copies (2 each).

`empower_the_meek`, `channel_group_energy`, `tribal_spirits`, `third_eye_awakening`, `resonant_amplifier`, `confluence_of_voices`, `wisdoms_harvest`, `inner_reflection`, `scholars_focus`, `threshold_surge`.

### 8.3 Artifacts

- 21 unique artifacts (1 each).

`mystic_orb`, `spell_staff`, `giant_crystal`, `lucky_beads`, `stone_of_balance`, `reincarnation_crystal`, `sacred_plant_seed`, `magnetic_crystal`, `spirit_totem`, `extra_terrestrial_artifact`, `crystal_seeker_goggles`, `mysterious_totem`, `cosmic_robes`, `verdant_seed_pod`, `celestial_compass`, `ancestors_drum`, `crown_of_stars`, `mentors_medallion`, `tome_of_enlightenment`, `scroll_of_wisdom`, `elders_signet`.

### 8.4 Teachings

- 35 teaching types, 42 total copies.
- Tier distribution:
  - basic: 7
  - rare: 20
  - mythic: 8

Basic IDs:
- `open_attention`, `prepared_mind`, `heightened_curiosity`, `quiet_knowing`, `disciplined_study`, `veil_of_uncertainty`, `false_signal`

Rare IDs:
- `animal_affinity`, `human_affinity`, `plant_affinity`, `cosmic_affinity`, `pilgrims_insight`, `rooted_patience`, `favourable_exchange`, `symbiotic_harmony`, `triune_expression`, `centered_resolve`, `lantern_of_the_unseen`, `breath_of_the_summit`, `ritual_continuance`, `doctrine_of_abundance`, `transmutation_of_focus`, `teachers_insight`, `earned_acknowledgement`, `emergent_convergence`, `wisdom_of_low_cards`, `total_commitment`

Mythic IDs:
- `worldseed_awakening`, `threshold_mastery`, `path_of_knowledge`, `convergence_of_paths`, `echoes_in_the_stone`, `crown_of_endurance`, `ledger_of_the_unseen`, `awakened_instinct`

### 8.5 Earth Advancements

- 6 cards total.

| Name | ID | Tier | Base AP Reward | Requirements | Passive |
|---|---|---:|---:|---|---|
| Circuit of Renewal | `circuit_of_renewal` | 1 | 12 | Crystals 6, CardsAny 2 | none |
| Rooted Exchange | `rooted_exchange` | 1 | 14 | Crystals 7, Artifacts 1 | Baseline forgiveness +1 |
| Concord of Voices | `concord_of_voices` | 2 | 23 | Crystals 13, Invocations 2 | +1 Crystal every 4 rounds |
| Glyph of Echoing Rites | `glyph_of_echoing_rites` | 2 | 21 | Crystals 11, Spells 2 | +1 AP on future trophy claims |
| Gaia Apex Protocol | `gaia_apex_protocol` | 3 | 34 | Crystals 20, Artifacts 1, Spells 1, CardsAny 1 | +1 Crystal every 3 rounds |
| Terran Mosaic | `terran_mosaic` | 3 | 29 | Crystals 17, Common 2 + Uncommon 1 | none |

## 9) UI and Presentation Structure

Main screens:
- Menu screen:
  - Seed input, continue/new game, settings toggles, opponent preview cards.
  - Layered animated background with parallax, cave glow, tree rays, particles, twinkles.
- Match screen:
  - Top bar: phase, scores, trophies, controls.
  - Left panel: inventory and tooltips.
  - Center: map board with 4 action nodes and animated ley lines.
  - Right panel: player stats, action summary, logs, confirm controls.
  - Overlays: challenge, draft, shop, Earth chamber, progress review, endgame evaluation, rules, game over, dev panel.

Visual direction:
- Fonts: Cinzel and Source Serif 4.
- Palette: dark parchment/mystic blue-green-gold.
- Full-canvas responsive rendering.

## 10) Public Asset Inventory

Audio (`public/audio`):
- `intro_theme.mp3`
- `Starlit_Council.mp3`
- `challenge.mp3`
- `hover_pulse.mp3`

Images (`public/images`):
- `theme_bg.png`

Other:
- `public/favicon.ico`

## 11) Current Implementation Notes

- `maxTurns` is present in state shape but currently not used as the live end-condition.
- Endgame entry is currently tied to Earth Ascension hitting target `999`.
- Starter hands draw non-cosmic game cards.
- Cosmic game-card frequency is intentionally reduced per run by selecting 3 of 5 cosmic IDs into the deck.
