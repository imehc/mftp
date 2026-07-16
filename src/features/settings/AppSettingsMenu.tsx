import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  Archive,
  Download,
  FolderTree,
  Monitor,
  Moon,
  RefreshCw,
  RotateCcw,
  Settings,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
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
  type DirectoryTransferMode,
  useSettingsStore,
} from "~/store/settings";
import { useTransfersStore } from "~/store/transfers";
import {
  type UpdaterStatus,
  useUpdaterStore,
} from "~/store/updater";
import { cn } from "~/lib/utils";

const themes = [
  { value: "system", label: "系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
] as const;

const directoryTransferModes = [
  { value: "archive", label: "压缩包", icon: Archive },
  { value: "direct", label: "直接", icon: FolderTree },
] as const;

const updateLabels: Record<UpdaterStatus, string> = {
  idle: "检查更新",
  checking: "正在检查",
  available: "查看更新",
  downloading: "下载中",
  ready: "重启更新",
  restarting: "重启中",
  error: "重新检查",
};

export default function AppSettingsMenu() {
  const { theme = "system", setTheme } = useTheme();
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
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

  async function toggleAutostart() {
    setAutostartBusy(true);
    try {
      if (autostartEnabled) {
        await disable();
        setAutostartEnabled(false);
        toast.success("已关闭开机自启");
      } else {
        await enable();
        setAutostartEnabled(true);
        toast.success("已开启开机自启");
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
          设置
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44 whitespace-nowrap">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={autostartBusy}
            onSelect={(event) => {
              event.preventDefault();
              void toggleAutostart();
            }}
          >
            <Monitor />
            {autostartEnabled ? "关闭开机自启" : "开启开机自启"}
          </DropdownMenuItem>
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
            文件夹传输
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
                    {item.label}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>主题</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          {themes.map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenuRadioItem key={item.value} value={item.value}>
                <Icon />
                {item.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
