import uiTokensJson from "../../docs/UI_TOKENS.json";

export const UI_TOKENS = uiTokensJson;

export type ArtImageKey =
  | "mapBackground"
  | "nodeCave"
  | "nodeMountain"
  | "nodeMeditate"
  | "nodeEarth"
  | "iconCrystal"
  | "iconTeachings"
  | "iconAp"
  | "iconTp"
  | "iconDice"
  | "iconTrophy"
  | "iconShop"
  | "iconMenu"
  | "iconSound"
  | "iconMusic"
  | "frameBasic"
  | "frameRare"
  | "frameMythic"
  | "vfxGlowPulse"
  | "vfxSheenSweep"
  | "vfxRuneCircle"
  | "vfxDustMotes"
  | "vfxRippleRing";

const ART_PATHS: Record<ArtImageKey, string> = {
  mapBackground: "/art/map/map_background_v2.png",
  nodeCave: "/art/nodes/node_cave_journey_v2.png",
  nodeMountain: "/art/nodes/node_mountain_journey_v2.png",
  nodeMeditate: "/art/nodes/node_meditate_v2.png",
  nodeEarth: "/art/nodes/node_earth_advancement_v2.png",
  iconCrystal: "/art/icons/icon_crystal_v2.png",
  iconTeachings: "/art/icons/icon_teachings_v2.png",
  iconAp: "/art/icons/icon_ap_v2.png",
  iconTp: "/art/icons/icon_tp_v2.png",
  iconDice: "/art/icons/icon_dice_v2.png",
  iconTrophy: "/art/icons/icon_trophy_v2.png",
  iconShop: "/art/icons/icon_shop_v2.png",
  iconMenu: "/art/icons/icon_menu_v2.png",
  iconSound: "/art/icons/icon_sound_v2.png",
  iconMusic: "/art/icons/icon_music_v2.png",
  frameBasic: "/art/frames/card_frame_basic_v2.png",
  frameRare: "/art/frames/card_frame_rare_v2.png",
  frameMythic: "/art/frames/card_frame_mythic_v2.png",
  vfxGlowPulse: "/art/vfx/vfx_glow_pulse_v2.png",
  vfxSheenSweep: "/art/vfx/vfx_sheen_sweep_v2.png",
  vfxRuneCircle: "/art/vfx/vfx_rune_circle_v2.png",
  vfxDustMotes: "/art/vfx/vfx_dust_motes_v2.png",
  vfxRippleRing: "/art/vfx/vfx_ripple_ring_v2.png"
};

const artImageCache = new Map<ArtImageKey, HTMLImageElement>();

export function getArtImagePath(key: ArtImageKey): string {
  return ART_PATHS[key];
}

export function getArtImage(key: ArtImageKey): HTMLImageElement | null {
  let img = artImageCache.get(key);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.src = getArtImagePath(key);
    artImageCache.set(key, img);
  }
  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
    return null;
  }
  return img;
}

export function withTokenAlpha(hexOrRgb: string, alpha: number): string {
  if (hexOrRgb.startsWith("rgba(")) {
    return hexOrRgb.replace(/rgba\(([^)]+),\s*[^)]+\)/, `rgba($1, ${alpha})`);
  }
  if (hexOrRgb.startsWith("rgb(")) {
    return hexOrRgb.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  }
  const hex = hexOrRgb.replace("#", "");
  const full = hex.length === 3
    ? hex.split("").map((ch) => ch + ch).join("")
    : hex.padEnd(6, "0");
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

