export type ColorTheme =
  | "default"
  | "designbyte"
  | "mx-brutalist"
  | "cyberpunk"
  | "tiesen"

export type FontPreset = "theme" | "geist" | "outfit" | "jakarta" | "montserrat";

export type ThemeSwatches = {
  background: string;
  primary: string;
  accent: string;
  secondary: string;
};

export const colorThemes: ReadonlyArray<{
  value: ColorTheme;
  swatches: ThemeSwatches;
}> = [
  {
    value: "default",
    swatches: {
      background: "oklch(1 0 0)",
      primary: "oklch(0.205 0 0)",
      accent: "oklch(0.97 0 0)",
      secondary: "oklch(0.97 0 0)",
    },
  },
  {
    value: "designbyte",
    swatches: {
      background: "oklch(0.9940 0 0)",
      primary: "oklch(0.8545 0.1675 159.6564)",
      accent: "oklch(0.9947 0.0074 164.9465)",
      secondary: "oklch(0.9933 0.0011 197.1390)",
    },
  },
  {
    value: "mx-brutalist",
    swatches: {
      background: "oklch(0.9923 0.0104 91.4994)",
      primary: "oklch(0.5687 0.1498 151.9380)",
      accent: "oklch(0.7721 0.1727 64.1585)",
      secondary: "oklch(0.6088 0.2498 29.2339)",
    },
  },
  {
    value: "cyberpunk",
    swatches: {
      background: "oklch(0.9816 0.0017 247.8390)",
      primary: "oklch(0.6726 0.2904 341.4084)",
      accent: "oklch(0.8903 0.1739 171.2690)",
      secondary: "oklch(0.9595 0.0200 286.0164)",
    },
  },
  {
    value: "tiesen",
    swatches: {
      background: "oklch(0.9851 0 0)",
      primary: "oklch(0.5144 0.1605 267.4400)",
      accent: "oklch(0.9214 0.0248 257.6500)",
      secondary: "oklch(0.9400 0 0)",
    },
  },
];

export const fontPresets = [
  "theme",
  "geist",
  "outfit",
  "jakarta",
  "montserrat",
] as const satisfies ReadonlyArray<FontPreset>;

const colorThemeValues = new Set<string>(colorThemes.map((item) => item.value));
const fontPresetValues = new Set<string>(fontPresets);

const legacyColorThemes: Record<string, ColorTheme> = {
  "blue": "tiesen",
  "emerald": "designbyte",
  "violet": "cyberpunk",
  "rose": "cyberpunk",
  "amber": "mx-brutalist",
  "cyan": "tiesen",
  "modern-minimal": "tiesen",
  "clean-slate": "tiesen",
  "claude": "default",
  "caffeine": "default",
  "corporate": "tiesen",
  "midnight-bloom": "cyberpunk",
  "vs-code": "tiesen",
  "spotify": "designbyte",
  "perplexity": "tiesen",
  "nature": "designbyte",
  "pastel-dreams": "cyberpunk",
  "neo-brutalism": "mx-brutalist",
  "sunset-horizon": "mx-brutalist",
  "slack": "default",
  "marshmallow": "cyberpunk",
};

export function isColorTheme(value: unknown): value is ColorTheme {
  return typeof value === "string" && colorThemeValues.has(value);
}

export function isFontPreset(value: unknown): value is FontPreset {
  return typeof value === "string" && fontPresetValues.has(value);
}

export function resolveColorTheme(value: unknown): ColorTheme {
  if (isColorTheme(value)) return value;
  if (typeof value === "string" && value in legacyColorThemes) {
    return legacyColorThemes[value];
  }
  return "default";
}

export function resolveFontPreset(value: unknown): FontPreset {
  return isFontPreset(value) ? value : "theme";
}

export function applyColorTheme(theme: ColorTheme) {
  const root = document.documentElement;
  if (theme === "default") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export function applyFontPreset(font: FontPreset) {
  const root = document.documentElement;
  if (font === "theme") {
    root.removeAttribute("data-font");
  } else {
    root.setAttribute("data-font", font);
  }
}

/** Restore theme/font from persisted settings before React paints. */
export function applyStoredColorTheme() {
  try {
    const raw = localStorage.getItem("mftp-settings");
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      state?: { colorTheme?: unknown; fontPreset?: unknown };
    };
    applyColorTheme(resolveColorTheme(parsed.state?.colorTheme));
    applyFontPreset(resolveFontPreset(parsed.state?.fontPreset));
  } catch {
    // Ignore corrupt storage; React will re-apply after hydrate.
  }
}
