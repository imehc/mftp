import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ExternalLink,
  Languages,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  RotateCcw,
  Settings,
  Sun,
  Type,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useLingui } from "@lingui/react/macro";
import { useLingui as useLinguiRuntime } from "@lingui/react";
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
import { isDesktopPlatform } from "~/lib/platform";
import { checkForUpdateManually, restartToApplyUpdate } from "~/lib/updater";
import {
  applyColorTheme,
  applyFontPreset,
  colorThemes,
  fontPresets,
  resolveColorTheme,
  resolveFontPreset,
  type ColorTheme,
  type FontPreset,
} from "~/lib/color-theme";
import { localeLabels, localeOptions } from "~/i18n/locales";
import { type AppLocale, useSettingsStore } from "~/store/settings";
import { type UpdaterStatus, useUpdaterStore } from "~/store/updater";
import { cn } from "cn";

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
  const fontPreset = useSettingsStore((s) => s.fontPreset);
  const setFontPreset = useSettingsStore((s) => s.setFontPreset);
  const updaterStatus = useUpdaterStore((s) => s.status);
  const checking = updaterStatus === "checking";
  const restarting = updaterStatus === "restarting";
  const ThemeIcon =
    themes.find((item) => item.value === theme)?.icon ?? Monitor;
  const updateLabels: Record<UpdaterStatus, string> = {
    idle: t`检查更新`,
    checking: t`正在检查`,
    available: t`查看更新`,
    downloading: t`下载中`,
    ready: t`重启更新`,
    restarting: t`重启中`,
    error: t`重新检查`,
  };

  useEffect(() => {
    applyColorTheme(resolveColorTheme(colorTheme));
  }, [colorTheme]);
  useEffect(() => {
    applyFontPreset(resolveFontPreset(fontPreset));
  }, [fontPreset]);

  function checkUpdate() {
    if (updaterStatus === "ready") void restartToApplyUpdate();
    else void checkForUpdateManually();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings data-icon="inline-start" />
          {t`设置`}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
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
          <DropdownMenuSubContent className="min-w-40 whitespace-nowrap">
            <DropdownMenuItem asChild>
              <Link to="/about">{t`关于`}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/logs">{t`日志`}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void openUrl("https://github.com/imehc/mftp")}
            >
              <ExternalLink />
              {t`项目帮助`}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {isDesktopPlatform() ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={checking || restarting}
              onSelect={checkUpdate}
            >
              {updaterStatus === "ready" ? (
                <RotateCcw />
              ) : (
                <RefreshCw className={cn(checking && "animate-spin")} />
              )}
              {updateLabels[updaterStatus]}
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages />
            {t`语言`}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-36 whitespace-nowrap">
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
          <DropdownMenuSubContent className="min-w-36 whitespace-nowrap">
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
          <DropdownMenuSubContent className="max-h-80 min-w-52 overflow-y-auto whitespace-nowrap">
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
          <DropdownMenuSubContent className="min-w-40 whitespace-nowrap">
            <DropdownMenuRadioGroup
              value={resolveFontPreset(fontPreset)}
              onValueChange={(value) => setFontPreset(value as FontPreset)}
            >
              {fontPresets.map((item) => (
                <DropdownMenuRadioItem key={item} value={item}>
                  {item === "theme"
                    ? t`跟随主题`
                    : item === "jakarta"
                      ? "Plus Jakarta"
                      : item[0].toUpperCase() + item.slice(1)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
