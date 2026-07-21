import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  Archive,
  Download,
  FolderTree,
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
import { toast } from "sonner";
import { useLingui } from "@lingui/react/macro";
import { useLingui as useLinguiRuntime } from "@lingui/react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  checkForUpdateManually,
  restartToApplyUpdate,
} from "~/lib/updater";
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
import {
  type AppLocale,
  type DirectoryTransferMode,
  useSettingsStore,
} from "~/store/settings";
import { useTransfersStore } from "~/store/transfers";
import {
  type UpdaterStatus,
  useUpdaterStore,
} from "~/store/updater";
import { localeLabels, localeOptions } from "~/i18n/locales";
import { cn } from "~/lib/utils";

const themes = [
  { value: "system", icon: Monitor },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
] as const;

const directoryTransferModes = [
  { value: "archive", icon: Archive },
  { value: "direct", icon: FolderTree },
] as const;

export default function AppSettingsMenu() {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const { theme = "system", setTheme } = useTheme();
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const colorTheme = useSettingsStore((s) => s.colorTheme);
  const setColorTheme = useSettingsStore((s) => s.setColorTheme);
  const fontPreset = useSettingsStore((s) => s.fontPreset);
  const setFontPreset = useSettingsStore((s) => s.setFontPreset);
  const directoryTransferMode = useSettingsStore(
    (s) => s.directoryTransferMode,
  );
  const setDirectoryTransferMode = useSettingsStore(
    (s) => s.setDirectoryTransferMode,
  );
  const hasRunningTransfer = useTransfersStore((s) =>
    s.transfers.some((item) => item.status === "running"),
  );
  const updaterStatus = useUpdaterStore((s) => s.status);
  const checkingUpdate = updaterStatus === "checking";
  const restarting = updaterStatus === "restarting";
  const updateLabels: Record<UpdaterStatus, string> = {
    idle: t`检查更新`,
    checking: t`正在检查`,
    available: t`查看更新`,
    downloading: t`下载中`,
    ready: t`重启更新`,
    restarting: t`重启中`,
    error: t`重新检查`,
  };
  const themeLabels = {
    system: t`系统`,
    light: t`浅色`,
    dark: t`深色`,
  } as const;
  const colorThemeLabels = {
    default: t`默认`,
    designbyte: t`DesignByte`,
    "mx-brutalist": t`MX-Brutalist`,
    cyberpunk: t`赛博朋克`,
    tiesen: t`Tiesen`,
  } as const;
  const fontPresetLabels = {
    theme: t`跟随主题`,
    geist: t`Geist`,
    outfit: t`Outfit`,
    jakarta: t`Plus Jakarta`,
    montserrat: t`Montserrat`,
  } as const;
  const ThemeIcon =
    themes.find((item) => item.value === theme)?.icon ?? Monitor;
  const directoryTransferModeLabels = {
    archive: t`压缩包`,
    direct: t`直接`,
  } as const;

  useEffect(() => {
    void refreshAutostart();
  }, []);

  useEffect(() => {
    applyColorTheme(resolveColorTheme(colorTheme));
  }, [colorTheme]);

  useEffect(() => {
    applyFontPreset(resolveFontPreset(fontPreset));
  }, [fontPreset]);

  async function refreshAutostart() {
    try {
      setAutostartEnabled(await isEnabled());
    } catch {
      setAutostartEnabled(false);
    }
  }

  function onCheckUpdate() {
    if (updaterStatus === "ready") {
      void restartToApplyUpdate();
      return;
    }
    void checkForUpdateManually();
  }

  async function setAutostartMode(nextEnabled: boolean) {
    if (nextEnabled === autostartEnabled) return;

    setAutostartBusy(true);
    try {
      if (nextEnabled) {
        await enable();
        setAutostartEnabled(true);
        toast.success(t`已开启开机自启`);
      } else {
        await disable();
        setAutostartEnabled(false);
        toast.success(t`已关闭开机自启`);
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setAutostartBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings data-icon="inline-start" />
          {t`设置`}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44 whitespace-nowrap">
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={autostartBusy}>
              <Monitor />
              {t`开机自启`}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-36 whitespace-nowrap">
              <DropdownMenuRadioGroup
                value={autostartEnabled ? "enabled" : "disabled"}
                onValueChange={(value) => {
                  void setAutostartMode(value === "enabled");
                }}
              >
                <DropdownMenuRadioItem value="enabled" disabled={autostartBusy}>
                  {t`开启`}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="disabled" disabled={autostartBusy}>
                  {t`关闭`}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            disabled={checkingUpdate || restarting}
            onSelect={onCheckUpdate}
          >
            {updaterStatus === "ready" ? (
              <RotateCcw />
            ) : updaterStatus === "downloading" ? (
              <Download />
            ) : (
              <RefreshCw className={cn(checkingUpdate && "animate-spin")} />
            )}
            {updateLabels[updaterStatus]}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={hasRunningTransfer}>
            <Archive />
            {t`文件夹传输`}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-36 whitespace-nowrap">
            <DropdownMenuRadioGroup
              value={directoryTransferMode}
              onValueChange={(value) => {
                if (hasRunningTransfer) return;
                setDirectoryTransferMode(value as DirectoryTransferMode);
              }}
            >
              {directoryTransferModes.map((item) => {
                const Icon = item.icon;
                return (
                  <DropdownMenuRadioItem
                    key={item.value}
                    value={item.value}
                    disabled={hasRunningTransfer}
                  >
                    <Icon />
                    {directoryTransferModeLabels[item.value]}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
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
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ThemeIcon />
            {t`外观`}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-36 whitespace-nowrap">
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              {themes.map((item) => {
                const Icon = item.icon;
                return (
                  <DropdownMenuRadioItem key={item.value} value={item.value}>
                    <Icon />
                    {themeLabels[item.value]}
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
                    className="flex shrink-0 overflow-hidden rounded-md border border-border"
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
                  {colorThemeLabels[item.value]}
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
                  {fontPresetLabels[item]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
