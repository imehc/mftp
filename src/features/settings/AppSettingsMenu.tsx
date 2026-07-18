import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  Archive,
  Download,
  FolderTree,
  Languages,
  Monitor,
  Moon,
  RefreshCw,
  RotateCcw,
  Settings,
  Sun,
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
  DropdownMenuLabel,
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
  const directoryTransferModeLabels = {
    archive: t`压缩包`,
    direct: t`直接`,
  } as const;

  useEffect(() => {
    void refreshAutostart();
  }, []);

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
        <DropdownMenuLabel>{t`主题`}</DropdownMenuLabel>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
