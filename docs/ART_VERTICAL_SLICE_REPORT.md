# Art Vertical Slice Report

Date: 2026-03-04  
Scope: Art system + visual polish only (no gameplay logic changes)

## 1) Asset List

### Map
- `public/art/map/map_background_v2.png` (`3840x2160`)

### Node Plates (`512x512`, transparent)
- `public/art/nodes/node_cave_journey_v2.png`
- `public/art/nodes/node_mountain_journey_v2.png`
- `public/art/nodes/node_meditate_v2.png`
- `public/art/nodes/node_earth_advancement_v2.png`

### UI Icons (`256x256`, transparent)
- `public/art/icons/icon_crystal_v2.png`
- `public/art/icons/icon_teachings_v2.png`
- `public/art/icons/icon_ap_v2.png`
- `public/art/icons/icon_tp_v2.png`
- `public/art/icons/icon_dice_v2.png`
- `public/art/icons/icon_trophy_v2.png`
- `public/art/icons/icon_shop_v2.png`
- `public/art/icons/icon_menu_v2.png`
- `public/art/icons/icon_sound_v2.png`
- `public/art/icons/icon_music_v2.png`

### Card Frames (`1024x1536`, transparent)
- `public/art/frames/card_frame_basic_v2.png`
- `public/art/frames/card_frame_rare_v2.png`
- `public/art/frames/card_frame_mythic_v2.png`

### VFX Overlays (`1024x1024`, transparent)
- `public/art/vfx/vfx_glow_pulse_v2.png`
- `public/art/vfx/vfx_sheen_sweep_v2.png`
- `public/art/vfx/vfx_rune_circle_v2.png`
- `public/art/vfx/vfx_dust_motes_v2.png`
- `public/art/vfx/vfx_ripple_ring_v2.png`

## 2) Integration Summary

### Art system + token usage
- Added `src/render/artSystem.ts`:
  - Central token import from `docs/UI_TOKENS.json`.
  - Stable key->path art lookup map.
  - Lazy image cache for runtime draw calls.

### Map + nodes
- `src/render/components/mapBoard.ts`:
  - Map background now uses `map_background_v2.png` with fallback to procedural parchment.
  - Node plates now render generated medallion assets (`Cave/Mountain/Meditate/Earth`) with fallback icon draw.
  - Added subtle active-node shadow and tokenized aura behavior.
- `src/screens/mapBoard.ts`:
  - Added restrained ambient overlays (dust + rune circle) gated by `motionEnabled`.

### UI hierarchy surfaces
- `src/screens/match.ts`:
  - ACTION_SELECT mini-HUD now uses icon-backed stats (crystals, teachings, AP, phase).
  - Top bar now includes icon hooks for AP/TP/dice/trophy/phase context.
  - CHALLENGE 3-beat header now uses icons for Threat/Readiness/Choices.

### Card frame usage
- `src/render/ui.ts`:
  - `drawCardFrame` now supports frame tier overlays (`basic`, `rare`, `mythic`) sourced from art assets.
  - Game cards map rarity to frame tier (cosmic -> mythic, gold -> rare, otherwise basic).
  - Artifact mini cards use rare frame tier.

### Visual polish pass
- `src/render/ui.ts`:
  - Gold button specular highlight added.
  - Hover lift applied to buttons (`-2px` equivalent token).
  - Sheen sweep overlay on hovered CTA when motion is enabled.
  - Soft panel inner shadow pass added.
- `src/screens/match.ts`:
  - FX pulse renderer now blends generated `glow_pulse` and `ripple_ring` overlays.

## 3) Reduced-Motion Compliance

- Sheen sweep and hover animation interpolation are gated by the shared motion system (`setUiMotionEnabled`).
- Map ambient VFX overlays (dust/rune) only draw when `motionEnabled` is true.
- Existing reduced-motion gating for pulses/particles/challenge animations remains active.

## 4) Verification

Automated:
- `npx tsc -p tsconfig.json --noEmit` -> PASS
- `npm run build` -> PASS

Manual smoke checklist (interactive):
- [ ] ACTION_SELECT
- [ ] CHALLENGE
- [ ] Drawer open/close
- [ ] Dev focus toggle
- [ ] Reduced-motion toggle
- [ ] Node hover
- [ ] Card rendering

Note: Interactive canvas smoke test is still required in-browser to complete the checklist.

## 5) Known Visual Issues / Follow-ups

- Card frame overlays from image generation may still need one more hand-tuned pass for exact edge behavior per rarity.
- Top bar and mini-HUD icon layout is integrated but can be tightened for very narrow widths.
- Additional migration of legacy hardcoded palette values to token references is recommended for full-system consistency.

## 6) Before / After Notes

Before:
- Procedural map parchment + procedural node symbols and mostly code-colored panels/buttons.
- Limited consistent iconography across top-bar and focused HUD surfaces.
- No shared art asset system for vertical-slice replacement.

After:
- Cohesive parchment/cosmic art direction across map/nodes/icons/frames/VFX.
- Token-backed art system and lazy-loaded image integration.
- Focused HUD and challenge header now visually aligned with the new vertical slice language.
