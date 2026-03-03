# AAA Polish Backlog

Date: 2026-03-03  
Source: `docs/AUDIT_REPORT.md`

## 1-2 Hour Tasks (Quick Wins)

| Task | Outcome | Owner |
|---|---|---|
| Add objective strip text per phase in `renderMatch` | Clear "what to do now" prompt every phase | Frontend |
| Gate match particles/pulses by motion settings | Accessibility alignment and lower frame overhead | Frontend |
| Increase minimum small-body font usage in sidebars to 12 | Immediate readability uplift | Frontend |
| Normalize panel header spacing and row padding using one token set | Cleaner alignment consistency | Frontend |
| Add SFX hooks for confirm action and modal open/close | Better tactile UX feedback | Audio |
| Add explicit fallback tooltip for disabled interactions ("Complete current step first") | Reduces confusion in phased UI gating | Frontend |
| Add art manifest skeleton (`public/art/manifests/art_manifest.v1.json`) | Safe future asset integration path | Tech Art |

## 1 Day Tasks

| Task | Outcome | Owner |
|---|---|---|
| Implement Phase Focus Mode for `ACTION_SELECT` only | Significant reduction in decision overload | Frontend UX |
| Implement log wrapping cache for Match Log | Lower per-frame CPU cost when log is open | Frontend Perf |
| Implement log wrapping cache for Challenge Log | Lower per-frame CPU cost in challenge phases | Frontend Perf |
| Refactor top-bar layout priority with truncation rules | Prevent overlap/clipping on narrow widths | Frontend UX |
| Build mobile bottom-sheet tabs for `Inventory/Stats/Log` when sidebars collapse | Mobile usability parity | Frontend |
| Replace string-based audio triggers with typed event constants for 3 key events | Stable and maintainable audio hookups | Audio/Engine |

## 1 Week Tasks

| Task | Outcome | Owner |
|---|---|---|
| Full Phase Focus Mode rollout to all phases and challenge subphases | AAA-grade phase clarity and pacing control | Frontend UX |
| Challenge sidebar information architecture refactor (`Objective`, `Rewards`, `Log` tabs) | Better scanning under challenge pressure | Frontend UX |
| Asset integration pass for vertical-slice art pack via manifest + fallbacks | Safe replacement of procedural UI visuals | Tech Art + Frontend |
| Visual tokenization pass (`docs/UI_TOKENS.json` -> runtime constants) | Consistent hierarchy, spacing, contrast, glow | Art Director + Frontend |
| Audio pass: ambient beds + rarity accents + transition stingers | Stronger production feel with low implementation cost | Audio |
| Performance instrumentation pass (frame timing + heavy UI paths) | Data-backed optimization and regression control | Frontend Perf |

## Concrete Implementation Plan - Phase Focus Mode

### Scope

Phase Focus Mode controls visual emphasis and interaction eligibility by phase/subphase. It does not remove systems; it controls attention and clickability.

### Step-by-Step

| Step | Implementation | Definition of Done |
|---|---|---|
| 1 | Add `ui.phaseFocusEnabled` (default true) and `FocusRole` model in a new `src/render/phaseFocus.ts`. | App boots with no behavior change when profiles are permissive. |
| 2 | Define `PhaseFocusProfile` for `ACTION_SELECT` and `CHALLENGE/COMMIT_TURNS`. | Focus profile map exists with explicit `primary`, `secondary`, `dimAlpha`, `blockedRoles`. |
| 3 | In `renderMatch`, register major surfaces with role + bounds: top bar, map, sidebars, hand, overlays. | Surface registry visible in debug logs; no render regression. |
| 4 | Apply dim pass for non-priority surfaces after draw. | Non-primary surfaces visibly de-emphasized per profile. |
| 5 | Apply interaction gate to blocked roles. | Clicks outside allowed roles no longer execute actions; tooltip explains why. |
| 6 | Add objective strip ("Current objective", "Primary action"). | Player always sees one sentence CTA tied to phase. |
| 7 | Expand profiles to all phases/subphases. | Every phase has explicit focus policy and no dead-ends. |
| 8 | Add quick QA script/checklist for focus transitions and mobile behavior. | No trapped interactions; all required controls reachable. |

### Suggested Role Map

| UI Surface | Role |
|---|---|
| Objective strip + current CTA | PRIMARY |
| Active phase board (map node picker / commit board / draft picker) | PRIMARY |
| Immediate support data (resources, short status) | SECONDARY |
| Historical/verbose logs, inactive panels, deep inventory lists | CONTEXT |
| Decorative/ambient layers | BACKGROUND |

### Initial Profile Defaults

| Phase | Allowed Roles | Dim Alpha for others |
|---|---|---|
| ACTION_SELECT | PRIMARY + SECONDARY | 0.48 |
| ACTION_REVEAL | PRIMARY | 0.60 |
| CHALLENGE/ROLL_ORDER | PRIMARY + SECONDARY | 0.52 |
| CHALLENGE/COMMIT_TURNS | PRIMARY + SECONDARY | 0.45 |
| CHALLENGE/REVEAL | PRIMARY + SECONDARY | 0.52 |
| CHALLENGE/RESOLVE | PRIMARY + SECONDARY | 0.52 |
| CHALLENGE/DRAFT | PRIMARY | 0.62 |
| EVALUATION | PRIMARY | 0.65 |
| GAME_OVER | PRIMARY | 0.65 |

### QA Acceptance Checklist

| Check | Pass Condition |
|---|---|
| Phase intent | Tester can identify next action in <2 seconds. |
| Interaction safety | No blocked essential control in any phase. |
| Mobile viability | Small-width layout still exposes one clear CTA. |
| Accessibility | Motion-off mode disables non-essential animated emphasis. |
| Visual consistency | Dim levels and glow tiers match token rules. |

