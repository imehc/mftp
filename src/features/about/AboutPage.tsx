import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Database,
  ExternalLink,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import {
  SettingsEntry,
  SettingsGroup,
} from "~/features/settings/SettingsEntry";
import { usePoetrySyncProgress } from "~/features/poetry/sync-progress";
import { useSessionsStore } from "~/store/sessions";
import { useTransfersStore } from "~/store/transfers";
import { isDesktopPlatform } from "~/lib/platform";
import { formatBytes } from "~/lib/format";
import { describeError } from "~/lib/errors";
import { useAbout } from "./use-about";
import DataManagementDialogs from "./DataManagementDialogs";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 border-b py-2 last:border-0">
      <span className="min-w-0 text-sm">{label}</span>
      <Badge variant="secondary">{value}</Badge>
    </div>
  );
}
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
        }
      />
      <div className="app-scroll-safe-end mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-3 overflow-auto px-3 pt-3 md:px-4 md:pt-4">
        <div className="flex shrink-0 flex-col items-center gap-2 py-6">
          <div
            className="bg-foreground text-background flex size-10 items-center justify-center rounded-xl text-xl font-semibold"
            aria-hidden="true"
          >
            M
          </div>
          <h1 className="text-lg font-semibold">MFTP</h1>
          <p className="text-muted-foreground text-xs tabular-nums">
            {c.version}
          </p>
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
        <div className="grid shrink-0 gap-3 md:grid-cols-2">
          <SettingsGroup title={<Trans>存储占用</Trans>}>
            <InfoRow
              label={t`主数据库`}
              value={c.usage ? formatBytes(c.usage.mainDatabaseBytes) : "—"}
            />
            <InfoRow
              label={t`诗词数据库`}
              value={c.usage ? formatBytes(c.usage.poetryDatabaseBytes) : "—"}
            />
            <InfoRow
              label={t`应用内部数据`}
              value={c.usage ? formatBytes(c.usage.btInternalBytes) : "—"}
            />
            <InfoRow
              label={t`总占用`}
              value={c.usage ? formatBytes(c.usage.totalBytes) : "—"}
            />
          </SettingsGroup>
          <SettingsGroup title={<Trans>运行状态</Trans>}>
            <InfoRow
              label="SSH / SFTP"
              value={activeSessions ? String(activeSessions) : t`空闲`}
            />
            <InfoRow
              label={t`文件传输`}
              value={activeTransfers ? String(activeTransfers) : t`空闲`}
            />
            {isDesktopPlatform() ? (
              <>
                <InfoRow
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
                {c.lanError ? (
                  <p
                    role="status"
                    className="text-destructive text-xs break-words"
                  >
                    {describeError(c.lanError)}
                  </p>
                ) : null}
              </>
            ) : null}
            <InfoRow
              label={t`诗词同步`}
              value={
                sync.stale ? t`等待确认` : sync.active ? t`运行中` : t`空闲`
              }
            />
          </SettingsGroup>
        </div>
        <div className="shrink-0">
          <SettingsGroup title={<Trans>本地数据</Trans>}>
            <SettingsEntry
              icon={Database}
              title={<Trans>按模块清理</Trans>}
              description={<Trans>选择需要清理的数据范围</Trans>}
              disabled={c.busy}
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
        </div>
        <div className="shrink-0">
          <Button
            variant="outline"
            size="sm"
            density="adaptive"
            onClick={() =>
              void openUrl("https://github.com/imehc/mftp").catch((error) =>
                toast.error(describeError(error)),
              )
            }
          >
            <ExternalLink data-icon="inline-start" />
            <Trans>项目帮助</Trans>
          </Button>
        </div>
      </div>
      <DataManagementDialogs controller={c} />
    </main>
  );
}
