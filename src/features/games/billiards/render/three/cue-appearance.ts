import type { EquipmentId } from "../../equipment";

export interface CueBand {
  end: number;
  color: number;
  roughness: number;
  metalness?: number;
  surface?: "wood" | "points";
}

export interface CueAppearance {
  shaftEnd: number;
  shaftDiameterRatio: number;
  bands: readonly CueBand[];
}

export const CUE_APPEARANCE: Readonly<Record<EquipmentId, CueAppearance>> = {
  "chinese-eight": {
    shaftEnd: 0.36,
    shaftDiameterRatio: 0.52,
    bands: [
      { end: 0.004, color: 0x426c9b, roughness: 0.85 },
      { end: 0.012, color: 0xf4eee0, roughness: 0.42 },
      { end: 0.36, color: 0xf0d5a8, roughness: 0.4, surface: "wood" },
      { end: 0.372, color: 0x171512, roughness: 0.3 },
      { end: 0.377, color: 0xcbb895, roughness: 0.3, metalness: 0.3 },
      { end: 0.68, color: 0x352419, roughness: 0.35, surface: "points" },
      { end: 0.98, color: 0x211b17, roughness: 0.45, surface: "wood" },
      { end: 0.985, color: 0xcbb895, roughness: 0.3, metalness: 0.3 },
      { end: 1, color: 0x141414, roughness: 0.8 },
    ],
  },
  "american-nine": {
    shaftEnd: 0.63,
    shaftDiameterRatio: 0.56,
    bands: [
      { end: 0.004, color: 0x426c9b, roughness: 0.85 },
      { end: 0.016, color: 0xf5efe2, roughness: 0.4 },
      { end: 0.63, color: 0xf1d9b2, roughness: 0.36, surface: "wood" },
      { end: 0.635, color: 0xc8c8c4, roughness: 0.28, metalness: 0.65 },
      { end: 0.644, color: 0x121313, roughness: 0.26 },
      { end: 0.649, color: 0xc8c8c4, roughness: 0.28, metalness: 0.65 },
      { end: 0.96, color: 0x101312, roughness: 0.27, surface: "points" },
      { end: 0.966, color: 0xc8c8c4, roughness: 0.28, metalness: 0.65 },
      { end: 0.981, color: 0x151515, roughness: 0.3 },
      { end: 0.985, color: 0xc8c8c4, roughness: 0.28, metalness: 0.65 },
      { end: 1, color: 0x141414, roughness: 0.8 },
    ],
  },
  snooker: {
    shaftEnd: 0.7,
    shaftDiameterRatio: 0.61,
    bands: [
      { end: 0.002, color: 0x426c9b, roughness: 0.85 },
      { end: 0.006, color: 0xc8ab68, roughness: 0.32, metalness: 0.55 },
      { end: 0.7, color: 0xe4c28d, roughness: 0.42, surface: "wood" },
      { end: 0.704, color: 0xc8ab68, roughness: 0.32, metalness: 0.55 },
      { end: 0.71, color: 0x191815, roughness: 0.34 },
      { end: 0.714, color: 0xc8ab68, roughness: 0.32, metalness: 0.55 },
      { end: 0.979, color: 0x171916, roughness: 0.38, surface: "wood" },
      { end: 0.983, color: 0xc8ab68, roughness: 0.32, metalness: 0.55 },
      { end: 1, color: 0x111211, roughness: 0.8 },
    ],
  },
};
