export type ColorTheme =
  "default" | "designbyte" | "mx-brutalist" | "cyberpunk" | "tiesen";

/**
 * 界面字体：只提供含中文字形的预设，西文字形始终由 Geist 承担。
 * 主题仍可覆盖 `--font-latin-token`，但不影响这里选定的汉字体。
 */
export type CjkFont = "system" | "wenkai" | "kuaile" | "longcang" | "pixel";

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

export const cjkFonts = [
  "system",
  "wenkai",
  "kuaile",
  "longcang",
  "pixel",
] as const satisfies ReadonlyArray<CjkFont>;

const colorThemeValues = new Set<string>(colorThemes.map((item) => item.value));
const cjkFontValues = new Set<string>(cjkFonts);

const legacyColorThemes: Record<string, ColorTheme> = {
  blue: "tiesen",
  emerald: "designbyte",
  violet: "cyberpunk",
  rose: "cyberpunk",
  amber: "mx-brutalist",
  cyan: "tiesen",
  "modern-minimal": "tiesen",
  "clean-slate": "tiesen",
  claude: "default",
  caffeine: "default",
  corporate: "tiesen",
  "midnight-bloom": "cyberpunk",
  "vs-code": "tiesen",
  spotify: "designbyte",
  perplexity: "tiesen",
  nature: "designbyte",
  "pastel-dreams": "cyberpunk",
  "neo-brutalism": "mx-brutalist",
  "sunset-horizon": "mx-brutalist",
  slack: "default",
  marshmallow: "cyberpunk",
};

export function isColorTheme(value: unknown): value is ColorTheme {
  return typeof value === "string" && colorThemeValues.has(value);
}

export function resolveColorTheme(value: unknown): ColorTheme {
  if (isColorTheme(value)) return value;
  if (typeof value === "string" && value in legacyColorThemes) {
    return legacyColorThemes[value];
  }
  return "default";
}

export function isCjkFont(value: unknown): value is CjkFont {
  return typeof value === "string" && cjkFontValues.has(value);
}

export function resolveCjkFont(value: unknown): CjkFont {
  return isCjkFont(value) ? value : "system";
}

export function applyColorTheme(theme: ColorTheme) {
  const root = document.documentElement;
  if (theme === "default") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export function applyCjkFont(font: CjkFont) {
  const root = document.documentElement;
  if (font === "system") {
    root.removeAttribute("data-cjk");
  } else {
    root.setAttribute("data-cjk", font);
  }
}

/** 在 React 渲染前，从已持久化的设置中恢复主题 / 字体。 */
export function applyStoredThemeAndFonts() {
  try {
    const raw = localStorage.getItem("mftp-settings");
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      state?: {
        colorTheme?: unknown;
        cjkFont?: unknown;
      };
    };
    applyColorTheme(resolveColorTheme(parsed.state?.colorTheme));
    applyCjkFont(resolveCjkFont(parsed.state?.cjkFont));
  } catch {
    // 忽略损坏的存储；React 完成 hydrate 后会重新应用。
  }
}
