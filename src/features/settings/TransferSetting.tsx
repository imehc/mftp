import { useLingui } from "@lingui/react/macro";
import { Check, FolderTree } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { rsyncSupportedPlatform } from "~/lib/platform";
import { type DirectoryTransferMode, useSettingsStore } from "~/store/settings";
import { useTransfersStore } from "~/store/transfers";

import SettingMenuTrigger from "./SettingMenuTrigger";
import SettingsControl from "./SettingsControl";

export default function TransferSetting() {
  const { t } = useLingui();
  const mode = useSettingsStore((state) => state.directoryTransferMode);
  const setMode = useSettingsStore((state) => state.setDirectoryTransferMode);
  const deleteExtraneous = useSettingsStore(
    (state) => state.rsyncDeleteExtraneous,
  );
  const setDeleteExtraneous = useSettingsStore(
    (state) => state.setRsyncDeleteExtraneous,
  );
  const running = useTransfersStore((state) =>
    state.transfers.some((item) => item.status === "running"),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const rsyncSupported = rsyncSupportedPlatform();
  const rsyncUnavailable = mode === "rsync" && !rsyncSupported;
  const title = t`文件传输`;
  // 增量同步的删除策略是二级选项：和启动页面一样收进同一菜单，避免多出一行独立设置。
  const modeLabels: Record<DirectoryTransferMode, string> = {
    archive: t({ message: "压缩包", comment: "文件传输模式：打包传输" }),
    direct: t({
      message: "直连",
      comment: "文件传输模式：逐文件直接传输",
    }),
    rsync: rsyncSupported
      ? t({ message: "增量同步(rsync)", comment: "文件传输模式：增量同步" })
      : t`增量同步(当前平台不可用)`,
  };
  const policyLabels = {
    keep: t({
      message: "保留",
      comment: "增量同步删除策略：目标多余文件不删除",
    }),
    delete: t({
      message: "删除",
      comment: "增量同步删除策略：删除目标多余文件（--delete）",
    }),
  };
  let description: ReactNode;
  if (rsyncUnavailable) {
    description = t`当前平台不支持增量同步。`;
  } else if (running) {
    description = t`传输进行中，暂不可修改。`;
  }
  // Radix 的 Sub 在 StrictMode 挂载清理时会补发一次关闭；延后到挂载稳定后再展开，
  // 避免默认展开状态被这次清理覆盖。
  useEffect(() => {
    if (!menuOpen || mode !== "rsync") return;
    const timer = window.setTimeout(() => setPolicyOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [menuOpen, mode]);
  return (
    <SettingsControl
      id="settings-transfer"
      icon={FolderTree}
      title={title}
      description={description}
      error={rsyncUnavailable}
    >
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          // 非增量同步不沿用上次的二级展开状态，但仍允许用户手动展开。
          if (open && mode !== "rsync") setPolicyOpen(false);
        }}
      >
        <DropdownMenuTrigger asChild>
          <SettingMenuTrigger
            id="settings-transfer"
            label={modeLabels[mode]}
            aria-label={title}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          collisionPadding={8}
          className="ui-density-adaptive min-w-40"
        >
          <DropdownMenuItem
            disabled={running}
            onSelect={() => setMode("archive")}
          >
            <span className="flex-1 whitespace-nowrap">
              {modeLabels.archive}
            </span>
            {mode === "archive" ? <Check aria-hidden /> : null}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={running}
            onSelect={() => setMode("direct")}
          >
            <span className="flex-1 whitespace-nowrap">
              {modeLabels.direct}
            </span>
            {mode === "direct" ? <Check aria-hidden /> : null}
          </DropdownMenuItem>
          {rsyncSupported ? (
            <DropdownMenuSub
              open={menuOpen && policyOpen}
              onOpenChange={setPolicyOpen}
            >
              <DropdownMenuSubTrigger disabled={running}>
                <span className="flex-1 whitespace-nowrap">
                  {modeLabels.rsync}
                </span>
                {mode === "rsync" ? <Check aria-hidden /> : null}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="ui-density-adaptive min-w-40">
                <DropdownMenuLabel>{t`目标多余文件`}</DropdownMenuLabel>
                {(["keep", "delete"] as const).map((policy) => (
                  <DropdownMenuItem
                    key={policy}
                    disabled={running}
                    onSelect={() => {
                      setDeleteExtraneous(policy === "delete");
                      setMode("rsync");
                    }}
                  >
                    <span className="flex-1 whitespace-nowrap">
                      {policyLabels[policy]}
                    </span>
                    {mode === "rsync" &&
                    deleteExtraneous === (policy === "delete") ? (
                      <Check aria-hidden />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : rsyncUnavailable ? (
            <DropdownMenuItem disabled>{modeLabels.rsync}</DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsControl>
  );
}
