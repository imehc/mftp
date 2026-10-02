import { enUS, zhCN } from "date-fns/locale";

export function dateLocale(locale: string) {
  return locale.startsWith("zh") ? zhCN : enUS;
}
