import { useLingui } from "@lingui/react/macro";
import { Languages, Monitor, Palette, Type } from "lucide-react";
import { useTheme } from "next-themes";

import { localeLabels, localeOptions } from "~/i18n/locales";
import {
  cjkFonts,
  colorThemes,
  resolveCjkFont,
  resolveColorTheme,
} from "~/lib/color-theme";
import { useSettingsStore } from "~/store/settings";

import DisplaySizeSettings from "./DisplaySizeSettings";
import { fontOptionLabels } from "./font-options";
import SettingChoice from "./SettingChoice";
import { SettingsGroup } from "./SettingsEntry";

export default function AppearanceSettings() {
  const { t, i18n } = useLingui();
  const { theme, setTheme } = useTheme();
  const settings = useSettingsStore();
  return (
    <SettingsGroup title={t`外观与语言`}>
      <SettingChoice
        id="settings-appearance"
        icon={Monitor}
        title={t`外观`}
        segmented
        value={theme ?? "system"}
        onChange={setTheme}
        options={[
          { value: "system", label: t`跟随系统` },
          {
            value: "light",
            label: t({ message: "浅色", comment: "应用外观模式" }),
          },
          {
            value: "dark",
            label: t({ message: "深色", comment: "应用外观模式" }),
          },
        ]}
      />
      <SettingChoice
        id="settings-theme"
        icon={Palette}
        title={t({ message: "主题", comment: "应用配色主题选择" })}
        value={settings.colorTheme}
        onChange={(value) => settings.setColorTheme(resolveColorTheme(value))}
        options={colorThemes.map(({ value }) => ({
          value,
          label:
            value === "default"
              ? t`默认`
              : value === "cyberpunk"
                ? t`赛博朋克`
                : value,
        }))}
      />
      <SettingChoice
        id="settings-font"
        icon={Type}
        title={t({ message: "字体", comment: "应用界面字体选择（中文字体）" })}
        value={settings.cjkFont}
        onChange={(value) => settings.setCjkFont(resolveCjkFont(value))}
        options={cjkFonts.map((value) => ({
          value,
          label: i18n._(fontOptionLabels[value]),
        }))}
      />
      <DisplaySizeSettings />
      <SettingChoice
        id="settings-locale"
        icon={Languages}
        title={t`语言`}
        value={settings.locale}
        onChange={(value) => {
          const locale = localeOptions.find((option) => option === value);
          if (locale) settings.setLocale(locale);
        }}
        options={localeOptions.map((value) => ({
          value,
          label: i18n._(localeLabels[value]),
        }))}
      />
    </SettingsGroup>
  );
}
