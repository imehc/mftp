import { msg } from "@lingui/core/macro";
export const locales = ["zh-CN", "en"] as const;
export const defaultLocale = "zh-CN";
export const localeOptions = ["system", ...locales] as const;
export const localeLabels = {
  system: msg`跟随系统`,
  "zh-CN": msg`简体中文`,
  en: msg`English`,
} as const;
export function resolveLocale(locale: "system" | (typeof locales)[number]) {
  if (locale !== "system") return locale;
  const languages =
    navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  return languages.some((item) => item.toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : "en";
}
