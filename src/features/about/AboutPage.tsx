import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Copy, Gauge, RefreshCw, Trash2 } from "lucide-react";

import AppPageContent from "~/components/AppPageContent";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import { useBtRunningTaskCount } from "~/features/bt/integration";
import { usePoetrySyncProgress } from "~/features/poetry/sync-progress";
import {
  SettingsEntry,
  SettingsGroup,
} from "~/features/settings/SettingsEntry";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";
import { isDesktopPlatform, isIosPlatform } from "~/lib/platform";
import { useSessionsStore } from "~/store/sessions";
import { useTransfersStore } from "~/store/transfers";

import DataManagementDialogs from "./DataManagementDialogs";
import { EnvironmentField } from "./EnvironmentField";
import { useAbout } from "./use-about";

export default function AboutPage() {
  const { t } = useLingui();
  const c = useAbout();
  const sessions = useSessionsStore((s) => s.sessions);
  const transfers = useTransfersStore((s) => s.transfers);
  const sync = usePoetrySyncProgress();
  const activeSessions = sessions.filter(
    (s) => s.status === "connecting" || s.status === "connected",
  ).length;
  const activeTransfers = transfers.filter(
    (s) => s.status === "running",
  ).length;
  // 任务快照由模块运行期维护；未加载完成时返回 null，页面显示占位符而不是「空闲」。
  const btTasks = useBtRunningTaskCount();
  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden"
    >
      <ToolPageHeader
        showHome={false}
        title={<Trans>关于</Trans>}
        leading={
          <Button variant="ghost" size="icon-sm" density="adaptive" asChild>
            <Link to="/settings" aria-label={t`返回设置`}>
              <ArrowLeft />
            </Link>
          </Button>
        }
        trailing={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              density="adaptive"
              aria-label={t`复制环境信息`}
              disabled={!c.environment}
              onClick={() => void c.copyEnvironmentInfo()}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              density="adaptive"
              aria-label={t`刷新状态`}
              disabled={c.loading || c.busy}
              onClick={() => void c.reload()}
            >
              <RefreshCw className={c.loading ? "animate-spin" : undefined} />
            </Button>
          </div>
        }
      />
      <AppPageContent bottomInset="scroll">
        <div className="flex shrink-0 flex-col items-center gap-2 py-6">
          <div
            className="bg-foreground text-background flex size-10 items-center justify-center rounded-xl text-xl font-semibold"
            aria-hidden="true"
          >
            M
          </div>
          <h1 className="text-lg font-semibold">MFTP</h1>
          <p className="text-muted-foreground text-xs">
            <Trans>本地文件与数据工具</Trans>
          </p>
        </div>
        {c.error || c.versionError ? (
          <div
            role="status"
            className="text-destructive flex shrink-0 items-center justify-between gap-3 text-sm"
          >
            <span>{describeError(c.error ?? c.versionError)}</span>
            <Button
              variant="outline"
              density="adaptive"
              disabled={c.loading || c.busy}
              onClick={() => void c.reload()}
            >
              <Trans>重试</Trans>
            </Button>
          </div>
        ) : null}
        <div className="shrink-0">
          <SettingsGroup title={<Trans>环境信息</Trans>}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-1 md:grid-cols-3">
              {c.environmentFields.map((field) => (
                <EnvironmentField
                  key={field.label}
                  label={field.label}
                  value={field.value}
                />
              ))}
            </dl>
          </SettingsGroup>
        </div>
        <div className="grid shrink-0 items-stretch gap-4 md:grid-cols-2">
          <SettingsGroup title={<Trans>存储</Trans>} className="h-full">
            <SettingsEntry
              icon={Gauge}
              title={t`总占用`}
              description={c.usage ? formatBytes(c.usage.totalBytes) : "—"}
              disabled={c.loading || c.busy}
              onClick={() => c.setModulesOpen(true)}
            />
            <SettingsEntry
              icon={Trash2}
              title={<Trans>清空所有数据</Trans>}
              description={<Trans>恢复首次打开状态</Trans>}
              disabled={c.busy}
              onClick={() => c.selectTarget("all")}
            />
          </SettingsGroup>
          {/*
            运行状态项多但每项只有一个状态词，按两列规格单元格排布，
            与「存储」两行卡片的高度保持一致，也避免单项独占一整行。
          */}
          <SettingsGroup title={<Trans>运行状态</Trans>} className="h-full">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-1">
              <EnvironmentField
                label="SSH / SFTP"
                value={activeSessions ? String(activeSessions) : t`空闲`}
              />
              <EnvironmentField
                label={t`文件传输`}
                value={activeTransfers ? String(activeTransfers) : t`空闲`}
              />
              {/* iOS 不提供本地下载引擎，状态位会一直读不到。 */}
              {isIosPlatform() ? null : (
                <EnvironmentField
                  label={t`下载任务`}
                  value={
                    btTasks === null
                      ? "—"
                      : btTasks
                        ? t({
                            message: `${btTasks} 个进行中`,
                            comment: "运行状态：正在运行的下载任务数量",
                          })
                        : t`空闲`
                  }
                />
              )}
              <EnvironmentField
                label={t`翻译引擎`}
                value={c.translationStatus ?? "—"}
              />
              {isDesktopPlatform() ? (
                <EnvironmentField
                  label={t`局域网服务`}
                  value={
                    c.lanError
                      ? t`状态读取失败`
                      : c.lan
                        ? c.lan.running
                          ? t`运行中`
                          : t`未启动`
                        : "—"
                  }
                />
              ) : null}
              <EnvironmentField
                label={t`诗词同步`}
                value={
                  sync.stale ? t`等待确认` : sync.active ? t`运行中` : t`空闲`
                }
              />
            </dl>
            {c.lanError ? (
              <p
                role="status"
                className="text-destructive px-1 text-xs wrap-break-word"
              >
                {describeError(c.lanError)}
              </p>
            ) : null}
          </SettingsGroup>
        </div>
      </AppPageContent>
      <DataManagementDialogs controller={c} />
    </main>
  );
}
