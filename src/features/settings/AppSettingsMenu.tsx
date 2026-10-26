import { useLingui as useLinguiRuntime } from "@lingui/react";
import { useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ExternalLink,
  Languages,
  Monitor,
  Moon,
  Palette,
  Settings,
  Sun,
  Type,
} from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import AiModelMenu from "~/features/ai-configuration/AiModelMenu";
import { UpdateMenuItem } from "~/features/updater/integration";
import { localeLabels, localeOptions } from "~/i18n/locales";
import {
  type CjkFont,
  cjkFonts,
  type ColorTheme,
  colorThemes,
  resolveCjkFont,
  resolveColorTheme,
} from "~/lib/color-theme";
import { type AppLocale, useSettingsStore } from "~/store/settings";

import { fontOptionLabels } from "./font-options";

const themes = [
  { value: "system", icon: Monitor },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
] as const;

export default function AppSettingsMenu() {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const { theme = "system", setTheme } = useTheme();
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const colorTheme = useSettingsStore((s) => s.colorTheme);
  const setColorTheme = useSettingsStore((s) => s.setColorTheme);
  const cjkFont = useSettingsStore((s) => s.cjkFont);
  const setCjkFont = useSettingsStore((s) => s.setCjkFont);
  const ThemeIcon =
    themes.find((item) => item.value === theme)?.icon ?? Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings data-icon="inline-start" />
          {t`设置`}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        sticky="always"
        className="ui-density-adaptive min-w-48"
      >
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Settings />
            {t`设置`}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ExternalLink />
            {t`更多`}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="ui-density-adaptive min-w-40 whitespace-nowrap">
            <DropdownMenuItem asChild>
              <Link to="/about">{t`关于`}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/activity" search={{ tab: "logs" }}>{t`日志`}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void openUrl("https://github.com/imehc/mftp")}
            >
              <ExternalLink />
              {t`项目帮助`}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <UpdateMenuItem />
        <DropdownMenuSeparator />
        <AiModelMenu />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages />
            {t`语言`}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="ui-density-adaptive min-w-36 whitespace-nowrap">
            <DropdownMenuRadioGroup
              value={locale}
              onValueChange={(value) => setLocale(value as AppLocale)}
            >
              {localeOptions.map((item) => (
                <DropdownMenuRadioItem key={item} value={item}>
                  {_(localeLabels[item])}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ThemeIcon />
            {t`外观`}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="ui-density-adaptive min-w-36 whitespace-nowrap">
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              {themes.map((item) => {
                const Icon = item.icon;
                const label =
                  item.value === "system"
                    ? t`系统`
                    : item.value === "light"
                      ? t`浅色`
                      : t`深色`;
                return (
                  <DropdownMenuRadioItem key={item.value} value={item.value}>
                    <Icon />
                    {label}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette />
            {t`主题`}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="ui-density-adaptive max-h-80 min-w-52 overflow-y-auto whitespace-nowrap">
            <DropdownMenuRadioGroup
              value={resolveColorTheme(colorTheme)}
              onValueChange={(value) => setColorTheme(value as ColorTheme)}
            >
              {colorThemes.map((item) => (
                <DropdownMenuRadioItem key={item.value} value={item.value}>
                  <span
                    aria-hidden
                    className="border-border flex shrink-0 overflow-hidden rounded-md border"
                  >
                    <span
                      className="size-3.5"
                      style={{ backgroundColor: item.swatches.background }}
                    />
                    <span
                      className="size-3.5"
                      style={{ backgroundColor: item.swatches.primary }}
                    />
                    <span
                      className="size-3.5"
                      style={{ backgroundColor: item.swatches.accent }}
                    />
                    <span
                      className="size-3.5"
                      style={{ backgroundColor: item.swatches.secondary }}
                    />
                  </span>
                  {item.value === "default"
                    ? t`默认`
                    : item.value === "cyberpunk"
                      ? t`赛博朋克`
                      : item.value}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Type />
            {t`字体`}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="ui-density-adaptive min-w-40 whitespace-nowrap">
            <DropdownMenuRadioGroup
              value={resolveCjkFont(cjkFont)}
              onValueChange={(value) => setCjkFont(value as CjkFont)}
            >
              {cjkFonts.map((item) => (
                <DropdownMenuRadioItem key={item} value={item}>
                  {_(fontOptionLabels[item])}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
