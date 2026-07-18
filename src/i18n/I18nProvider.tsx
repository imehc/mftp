import type { PropsWithChildren } from "react";
import { useEffect, useMemo, useState } from "react";
import { I18nProvider as LinguiProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { messages as zhCnMessages } from "~/locales/zh-CN/messages";
import { messages as enMessages } from "~/locales/en/messages";
import { defaultLocale, resolveLocale } from "~/i18n/locales";
import { useSettingsStore } from "~/store/settings";

i18n.load({
  "zh-CN": zhCnMessages,
  en: enMessages,
});
i18n.activate(defaultLocale);

export function AppI18nProvider({ children }: PropsWithChildren) {
  const locale = useSettingsStore((s) => s.locale);
  const [systemLocaleVersion, setSystemLocaleVersion] = useState(0);
  const activeLocale = useMemo(() => {
    void systemLocaleVersion;
    return resolveLocale(locale);
  }, [locale, systemLocaleVersion]);

  useEffect(() => {
    if (locale !== "system") return;
    const onLanguageChange = () => setSystemLocaleVersion((value) => value + 1);
    window.addEventListener("languagechange", onLanguageChange);
    return () => window.removeEventListener("languagechange", onLanguageChange);
  }, [locale]);

  if (i18n.locale !== activeLocale) {
    i18n.activate(activeLocale);
  }

  return <LinguiProvider i18n={i18n}>{children}</LinguiProvider>;
}
