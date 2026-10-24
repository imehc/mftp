import { useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { RefreshCw, RotateCcw } from "lucide-react";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { SettingsEntry } from "~/features/settings/SettingsEntry";
import { checkForUpdateManually } from "~/features/updater/controller";
import { isUpdaterPlatform } from "~/lib/platform";
import { type UpdaterStatus, useUpdaterStore } from "~/store/updater";

export { checkForUpdateOnLaunch } from "~/features/updater/controller";
export { default as UpdaterActivity } from "./UpdaterActivity";
export { default as UpdaterDialog } from "./UpdaterDialog";

export interface UpdaterActivitySummary {
  running: boolean;
  pending: boolean;
  error: boolean;
}

/** 活动中心只读取更新状态；移动端别名会把这里替换为空状态。 */
export function useUpdaterActivitySummary(): UpdaterActivitySummary {
  const status = useUpdaterStore((state) => state.status);
  const failed = useUpdaterStore((state) => state.error !== null);
  return {
    running:
      status === "checking" ||
      status === "downloading" ||
      status === "restarting",
    pending: !failed && (status === "available" || status === "ready"),
    error: failed,
  };
}

/** 平台构建入口；普通浏览器开发仍按实际平台隐藏桌面能力。 */
export function UpdateMenuItem() {
  const { t } = useLingui();
  const status = useUpdaterStore((state) => state.status);
  const labels: Record<UpdaterStatus, string> = {
    idle: t`检查更新`,
    checking: t`正在检查`,
    current: t`检查更新`,
    available: t`查看更新`,
    downloading: t`下载中`,
    ready: t`查看更新`,
    restarting: t`重启中`,
    error: t`重新检查`,
  };
  if (!isUpdaterPlatform()) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => {
          // 菜单先关闭并恢复焦点，再展示根级弹窗。
          setTimeout(() => void checkForUpdateManually(), 0);
        }}
      >
        {status === "ready" ? (
          <RotateCcw />
        ) : (
          <RefreshCw className={cn(status === "checking" && "animate-spin")} />
        )}
        {labels[status]}
      </DropdownMenuItem>
    </>
  );
}

export function UpdateSettingsEntry() {
  const { t } = useLingui();
  const status = useUpdaterStore((state) => state.status);
  if (!isUpdaterPlatform()) return null;
  return (
    <SettingsEntry
      icon={RefreshCw}
      title={
        status === "ready" ||
        status === "available" ||
        status === "downloading" ||
        status === "restarting"
          ? t`查看更新`
          : status === "checking"
            ? t`正在检查`
            : t`检查更新`
      }
      onClick={() => void checkForUpdateManually()}
    />
  );
}
