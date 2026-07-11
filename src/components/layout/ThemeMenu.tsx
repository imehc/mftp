import {
  Archive,
  Download,
  FolderTree,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  RotateCcw,
  Settings,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
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
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
] as const;

const directoryTransferModes = [
  { value: "archive", label: "压缩包", icon: Archive },
  { value: "direct", label: "直接传输", icon: FolderTree },
] as const;

const updateMenuLabels: Record<UpdaterStatus, string> = {
  idle: "检查更新",
  checking: "正在检查更新…",
  available: "查看可用更新",
  downloading: "查看更新下载进度",
  ready: "重启应用并更新",
  restarting: "正在重启应用…",
  error: "重新检查更新",
};

export default function ThemeMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { theme = "system", setTheme } = useTheme();
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

  function onCheckUpdate() {
    if (updaterStatus === "ready") {
      void restartToApplyUpdate();
      return;
    }
    void checkForUpdateManually();
  }

  const checkingUpdate = updaterStatus === "checking";
  const restarting = updaterStatus === "restarting";
  const updateMenuLabel = updateMenuLabels[updaterStatus];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-9 w-full gap-2 rounded-md px-2 text-left",
            collapsed ? "justify-center" : "justify-start",
            "aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground",
          )}
          title="设置"
        >
          <Settings data-icon="inline-start" />
          {collapsed ? null : (
            <span className="min-w-0 flex-1 truncate">设置</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="min-w-44 whitespace-nowrap"
      >
        <DropdownMenuGroup>
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
            {updateMenuLabel}
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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette />
            主题
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-36 whitespace-nowrap">
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
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
