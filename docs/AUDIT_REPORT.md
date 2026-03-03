# Ascension Earth V5 - AAA UX + Polish Audit

Date: 2026-03-03  
Reviewer lens: Senior AAA UX, readability, production polish, runtime safety

## Executive Summary

Ascension Earth V5 already has strong systemic depth and a distinctive visual direction. The main quality gap is not content; it is presentation control under load. During `ACTION_SELECT` and `CHALLENGE`, the player is exposed to too many concurrent UI surfaces, mixed hierarchy, and inconsistent readability. A focused presentation layer is the highest-leverage improvement.

Top recommendation: implement `Phase Focus Mode` first, then tune typography/contrast tokens, then optimize UI render hot paths.

## Implementation Update (2026-03-03)

Completed in this slice (`ACTION_SELECT`, P0):

- Added focus mode concept and resolver (`ACTION_SELECT`, `CHALLENGE`, `RESULTS`, `EARTH_CHAMBER`) with dev override toggle.
- Applied root data attribute updates each frame: `data-focus-mode` and drawer state metadata for CSS-driven layout hooks.
- Implemented `ACTION_SELECT` focused composition:
  - Primary: map + selected action detail + confirm CTA.
  - Always-on compact mini-HUD: crystals, teachings, personal AP, phase label.
  - Secondary surfaces collapsed into a single drawer (`right` desktop, `bottom` mobile).
- Added drawer keyboard support:
  - `Esc` closes drawer.
  - `Tab` is trapped while drawer is open (focus remains in drawer interaction mode).
- Added reduced-motion behavior integration:
  - Respects `prefers-reduced-motion` and in-game motion toggle.
  - Disables match particles/pulse overlays and suppresses major time-based pulsing accents when reduced motion is active.

Completed in this slice (`CHALLENGE` + systems, P0/P1):

- [DONE] Reduced CHALLENGE information density with a focused 3-beat decision layout:
  - Beat 1: Threat summary.
  - Beat 2: Readiness summary with pass/fail baseline reason.
  - Beat 3: Choice CTAs.
  - Secondary detail content moved into focus drawer tabs (`Status`, `Rewards`, `Log`), with mobile bottom-drawer behavior.
- [DONE] Replaced brittle log-string audio triggers with typed `SfxEvent` pipeline:
  - Engine emits typed events at gameplay truth points (shop, sell, rewards, challenge phases/outcomes, trophies, milestones, thresholds, deny actions).
  - Match renderer consumes events and plays SFX/VFX without parsing log text.
  - Added dev diagnostics readout for recent SFX events.
- [DONE] Expanded reduced-motion compliance beyond ACTION_SELECT:
  - Introduced unified `motionEnabled` derivation (`prefers-reduced-motion` + user setting).
  - Gated map/challenge heavy motion paths and reward/button animation hooks.
  - Prevented non-essential challenge animation loops when reduced motion is active.

## Prioritized Top 15 Issues

| # | Priority | Area | Issue | Player/Production Impact | Recommended Fix |
|---|---:|---|---|---|---|
| 1 | P0 | UX phase clarity | No single explicit "Do this now" rail; multiple simultaneous surfaces compete for attention. | New and returning players lose intent, especially between Action Select and Challenge Commit. | Add Phase Focus Mode with a persistent objective strip and phase-scoped primary CTA. |
| 2 | P0 | UI hierarchy | `ACTION_SELECT` renders top bar, map, two sidebars, hand dock, log/toasts, plus shop overlays simultaneously. | Cognitive overload and decision fatigue; weak AAA clarity. | Demote non-critical panels per phase (dim/collapse) and gate interactions outside primary zone. |
| 3 | P0 | UX mobile | At small widths, both sidebars collapse to zero width. | Core context (stats, teachings/artifacts, action summary) disappears on mobile. | Add mobile bottom-sheet tabs: `Objective`, `Inventory`, `Stats`, `Log`. |
| 4 | P0 | Challenge UX | [DONE 2026-03-03] Challenge view previously contained banner, stepper, table, side panel, TP/keystone/reward/log/buttons concurrently. | High cognitive load in highest-stakes phase. | Implemented 3-beat decision layout + details drawer tabs (`Status`, `Rewards`, `Log`) in CHALLENGE focus mode. |
| 5 | P1 | Hierarchy responsiveness | Top bar score centering and trophy strip are dynamic but lack hard truncation strategy under pressure. | Text overlap/clipping risk, unstable scan path. | Introduce responsive top-bar priority: objective > phase > score > trophies > controls; truncate lower-priority content first. |
| 6 | P1 | Readability typography | Core informational text often uses 10-11 px equivalents in dense panels. | Reduced legibility, especially on high-DPI laptops/mobile. | Enforce font scale tokens: body >= 12 desktop, >= 13 mobile; metadata >= 11. |
| 7 | P1 | Contrast consistency | Multiple low-alpha text-on-alpha layers create variable contrast. | Intermittent readability failures across background values. | Add contrast-safe token pairings and fallback opaque scrim under functional text blocks. |
| 8 | P1 | Layout consistency | Spacing and alignment rules vary by panel; no global 8-pt rhythm is enforced. | "Indie prototype" feel vs "AAA production UI." | Standardize panel internals around spacing tokens and shared layout helpers. |
| 9 | P1 | Motion accessibility | [DONE 2026-03-03] Motion-heavy surfaces previously continued running in reduced-motion paths. | Accessibility mismatch; unnecessary GPU/CPU work on low-power devices. | Added unified `motionEnabled` resolution and gated heavy map/challenge/reward/button animations accordingly. |
|10| P1 | Audio architecture | [DONE 2026-03-03] Cues previously depended on log-string matching. | Fragile, non-localized, hard to maintain; accidental/missed cue risk. | Replaced with typed `SfxEvent` emission in engine/reducer and event consumption in renderer/audio layer. |
|11| P2 | Audio polish | Low-cost confirmation/transition cues are missing in several UI transitions. | Reduced tactile feedback and perceived production quality. | Add lightweight SFX for modal open/close, action lock, draft pick, evaluation reveals. |
|12| P2 | Performance UI | Match log wraps every log line every frame when open. | Avoidable frame-time spikes during long sessions. | Cache wrapped log lines and only recompute on log version change or width change. |
|13| P2 | Performance UI | Challenge log wraps entire log every frame when expanded. | Similar avoidable cost during challenge-heavy turns. | Same memoization strategy for challenge logs. |
|14| P2 | Performance UI | Top-bar score sorting/measuring recalculates each frame. | Small but continuous CPU tax. | Recompute only on relevant state changes (AP, turn, width). |
|15| P2 | Art pipeline | No production-safe asset manifest/versioning/fallback model for incoming ImageGen pack. | Integration risk and brittle runtime if assets are missing/renamed. | Introduce manifest-driven loading, validation checks, and procedural fallback paths. |

## Evidence Map (Code Anchors)

| Topic | Evidence |
|---|---|
| Render overload stack | `src/screens/match.ts:1078-1167` |
| Mobile sidebars collapse | `src/screens/match.ts:987-990` |
| Top bar dynamic packing | `src/screens/match.ts:1391-1449` |
| Dense challenge composition | `src/screens/match.ts:3189-3200`, `3905-4208` |
| Small text density | `src/screens/match.ts:1607-1618`, `3970-3987`, `4210-4224` |
| Match VFX always ticking | `src/screens/match.ts:1074-1076`, `4627-4660` |
| Audio via log-string parsing | `src/screens/match.ts:1038-1069` |
| Per-frame audio state setters | `src/main.ts:101-103`, `src/screens/match.ts:1029`, `src/screens/menu.ts:36` |
| Per-frame log wrapping | `src/screens/match.ts:2055-2057`, `4226-4228` |

## Concrete Implementation Plan - Phase Focus Mode

### Goal

Make each phase instantly understandable by emphasizing only the actionable surface, while preserving depth for advanced users.

### Functional Spec

| Phase | Primary Surface | Secondary Surface | Dim/Disable |
|---|---|---|---|
| `ACTION_SELECT` | Map nodes + selected action summary + confirm button | Crystal/shop summary | AI panels, deep logs, non-essential inventories |
| `ACTION_REVEAL` | Reveal/wait banner | Top bar phase state | Most interaction panels disabled |
| `CHALLENGE: ROLL_ORDER` | Initiative card + order strip | Compact challenge log | Inventory/action-select UI fully dimmed |
| `CHALLENGE: COMMIT_TURNS` | Commit board + commit controls | TP threshold mini panel | Reward details and verbose logs collapsed |
| `CHALLENGE: REVEAL/RESOLVE` | Central reveal/resolve board | Current actor + totals | Commit controls disabled, non-phase widgets dim |
| `CHALLENGE: DRAFT` | Draft picker modal | AP contribution order | Commit and hand interactions disabled |
| `EVALUATION` | Evaluation modal | Top-line AP delta | Background panels blocked |
| `GAME_OVER` | Final results modal | Optional detail tabs | Gameplay panels blocked |

### Technical Design

1. Create `src/render/phaseFocus.ts` with:
   - `FocusRole` enum (`PRIMARY`, `SECONDARY`, `CONTEXT`, `BACKGROUND`).
   - `PhaseFocusProfile` map by phase/subphase.
   - `resolveFocusState(state)` returning allowed roles + dim alpha + interaction policy.
2. Introduce optional UI state flags:
   - `ui.phaseFocusEnabled` (default `true`).
   - `ui.phaseFocusDebug` (optional overlay for tuning).
3. In `renderMatch`, register major blocks with bounds + role before draw.
4. After drawing blocks, apply a per-block dim pass for non-priority roles.
5. Interaction policy:
   - Non-allowed roles keep hover but block click.
   - Provide subtle toast: "Complete current step first."
6. Add a compact objective strip:
   - Single sentence + one highlighted CTA label.
7. Respect accessibility:
   - If motion reduced, dim transitions become instant.
8. Acceptance criteria:
   - New player can identify next action in <2 seconds in each phase.
   - No critical control hidden in focused mode.
   - Mobile keeps at least one clear CTA at all times.

### Rollout Sequence

1. Build focus resolver and draw-time dim pass.
2. Wire `ACTION_SELECT` and `CHALLENGE: COMMIT_TURNS` first.
3. Add remaining phases.
4. Playtest and tune alpha/role mappings.
5. Ship with a temporary debug toggle for balancing.

## Audio Hooks for AAA feel at low cost

1. UI confirm lock (Action Confirm, Draft Pick).
2. Modal open/close stingers (shop, earth chamber, review, evaluation).
3. Phase transition whoosh by challenge subphase.
4. Soft ambient beds:
   - low cave rumble in cave challenge,
   - wind shimmer in mountain challenge.
5. Reward rarity accent:
   - uncommon tick, rare flourish, mythic tail.

Implementation note: route all via explicit event emitters, not log parsing.

## Art Pipeline Recommendation (Safe Integration)

Recommended structure:

```text
public/art/
  manifests/
    art_manifest.v1.json
  backgrounds/
    map/
      map_bg_v001_3840x2160.webp
  nodes/
    cave_plate_v001_512.png
    mountain_plate_v001_512.png
    meditate_plate_v001_512.png
    earth_plate_v001_512.png
  icons/
    crystal_v001_256.png
    teachings_v001_256.png
    ap_v001_256.png
    tp_v001_256.png
    dice_v001_256.png
    trophy_v001_256.png
    shop_v001_256.png
    menu_v001_256.png
    sound_v001_256.png
    music_v001_256.png
  frames/
    card_frame_basic_v001_1024x1536.png
    card_frame_rare_v001_1024x1536.png
    card_frame_mythic_v001_1024x1536.png
  vfx/
    glow_pulse_v001_1024.png
    sheen_sweep_v001_1024.png
    rune_ring_v001_1024.png
    dust_motes_v001_1024.png
    ripple_v001_1024.png
    sparks_v001_1024.png
```

Naming rules:
- lowercase snake_case
- semantic name + version + size
- explicit alpha assets as `.png`, backgrounds as `.webp`

Safety integration:
1. Load through manifest lookup only.
2. Validate required keys at boot.
3. Fallback to procedural draw if asset missing.
4. Track asset load errors in a single debug panel.
