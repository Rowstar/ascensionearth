# Ascension Earth V5 - Art Bible (Vertical Slice Foundation)

Date: 2026-03-04  
Scope: AAA-feel vertical slice foundation, not a full replacement pass.

## 1) Core Materials

### Parchment base texture
- Use a muted sand parchment base with fine grain.
- Apply very subtle edge vignetting to frame attention toward center play space.
- Avoid strong noise or distressed grunge that reduces readability.

### Mystic ink lines
- Structural linework uses deep teal/navy inks only.
- Sacred geometry and cartographic marks must stay low-contrast relative to interactive UI.
- Decorative linework must never compete with gameplay text.

### Gold trim hierarchy rules
- Gold is a hierarchy accent, not a base color.
- Gold appears in order:
  1. Primary CTA edges and active confirmations.
  2. Reward/trophy accents.
  3. Rare/Mythic card framing.
- Do not apply gold to every border or panel.

### Glow tiers
- `contained`: soft local halo, small radius, low alpha.
- `radiant`: directional edge accent with constrained bloom.
- `mythic_structural`: frame-integrated luminous geometry; still restrained and readable.

## 2) Color Palette (Hex)

- Background parchment: `#D8C8A9`
- Deep map tone: `#123742`
- Primary accent: `#2A6A78`
- Secondary accent: `#1F4E5F`
- Gold trim: `#C7A157`
- Muted danger tone: `#8E5A4A`
- Success tone: `#5F8A63`
- Neutral UI ink: `#1E2328`

## 3) Stroke Rules

- Primary stroke width: `2px`
- Secondary stroke width: `1px`
- Panel border thickness: `2px`

No ad-hoc stroke widths outside this system.

## 4) Radii System

- Small radius: `8px`
- Medium radius: `12px`
- Large radius: `18px`

No arbitrary radii allowed.

## 5) Motion Language

- Glow pulse speed: `2200ms` cycle
- Sheen sweep duration: `1200ms`
- Map breathing cadence: `4800ms`
- Hover lift: `-2px` equivalent

Reduced-motion fallback:
- Disable sheen, pulse loops, particle-like overlays, and rotating rune effects.
- Keep only instant state transitions and opacity/color changes required for clarity.

## 6) Icon Language

- Flat engraved look with clean silhouette-first forms.
- Minimal internal shading; avoid realistic rendering.
- Consistent line weight and edge treatment across all icon families.
- No emoji styling, no cartoon exaggeration, no photographic detail.

## 7) Vertical Slice Guardrails

- No style drift from parchment + mystic blue-green + restrained gold.
- No hyper-saturated neon colors.
- Preserve high readability and calm hierarchy under ACTION_SELECT and CHALLENGE load.
- Visual effects must always obey reduced-motion settings.
