BOOTSTRAP
- Read CURRENT_STATE.md and GAME_BIBLE.md.
- Goal: AAA-feel vertical slice art + integration, not full content replacement.
- No random style drift. Establish Art Bible + UI tokens first.

AGENTS

1) ART DIRECTOR
- Create docs/ART_BIBLE.md using existing visual direction (parchment/mystic blue-green-gold, Cinzel + Source Serif).
- Create docs/UI_TOKENS.json (colors, radii, shadows, border thickness, glow tiers).
- Define asset specs: icon sizes, frame sizes, background sizes, transparency rules.

2) IMAGEGEN PRODUCER
- Generate a vertical-slice asset pack following the Art Bible:
  - Map background (3840x2160)
  - Node plates/icons (512x512 transparent): Cave, Mountain, Meditate, Earth
  - UI icons (256x256 transparent): Crystal, Teachings, AP, TP, Dice, Trophy, Shop, Menu, Sound, Music
  - Card frames (1024x1536 transparent): Basic, Rare, Mythic
  - VFX overlays (1024x1024 transparent): glow pulse, sheen sweep, rune ring, dust motes, ripple, sparks
- Save under /public/art/... with consistent naming.

3) FRONTEND INTEGRATOR
- Wire new assets into map nodes, top bar icons, card frames (where applicable).
- Implement Phase Focus Mode (dim non-primary UI per phase).
- Ensure scaling works on desktop + mobile.

4) MOTION/VFX
- Add subtle AAA micro-animations: node breathing glow, hover lift, route pulse.
- Keep perf sane; respect motion settings.

5) QA
- Verify contrast/readability, clipping, consistent glow tiers, file naming, asset loading.
- Output docs/ART_SLICE_REPORT.md with fixes.
