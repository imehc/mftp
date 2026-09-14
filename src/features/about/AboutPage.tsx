import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Activity,
  Database,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Trash2,
  Wifi,
} from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import AppPageLayout from "~/components/AppPageLayout";
import { usePoetrySyncProgress } from "~/features/poetry/hooks/use-poetry-sync";
import * as ipc from "~/lib/ipc";
import { formatBytes } from "~/lib/format";
import { isDesktopPlatform } from "~/lib/platform";
import { useSessionsStore } from "~/store/sessions";
import { useTransfersStore } from "~/store/transfers";
import type {
  AppDataModule,
  AppDataUsage,
  BtCacheStats,
  LanTransferStatus,
} from "~/types";

const modules: AppDataModule[] = [
  "vault",
  "hosts",
  "todo",
  "poetry",
  "activityLogs",
  "btCache",
];

function statusLabel(value: boolean, labels: { active: string; idle: string }) {
  return value ? labels.active : labels.idle;
}

export default function AboutPage() {
  const { t } = useLingui();
  const sessions = useSessionsStore((state) => state.sessions);
  const transfers = useTransfersStore((state) => state.transfers);
  const sync = usePoetrySyncProgress();
  const [usage, setUsage] = useState<AppDataUsage | null>(null);
  const [lan, setLan] = useState<LanTransferStatus | null>(null);
  const [bt, setBt] = useState<BtCacheStats | null>(null);
  const [logCount, setLogCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState("-");
  const [clearModule, setClearModule] = useState<AppDataModule | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const moduleTitles: Record<AppDataModule, string> = {
    vault: t`密码本`,
    hosts: t`主机和密钥`,
    todo: t`待办`,
    poetry: t`诗词库`,
    activityLogs: t`活动日志`,
    btCache: t`BT 缓存`,
  };
  const statusLabels = { active: t`运行中`, idle: t`空闲` };
  const moduleBytes: Record<AppDataModule, number> = {
    vault: usage?.vaultBytes ?? 0,
    hosts: usage?.hostsBytes ?? 0,
    todo: usage?.todoBytes ?? 0,
    poetry: usage?.poetryDatabaseBytes ?? 0,
    activityLogs: usage?.activityLogsBytes ?? 0,
    btCache: usage?.btCacheBytes ?? 0,
  };
  const visibleModules = usage
    ? modules.filter((module) => moduleBytes[module] > 0)
    : modules;
  const activeSessions = sessions.filter(
    (item) => item.status === "connecting" || item.status === "connected",
  ).length;
  const activeTransfers = transfers.filter(
    (item) => item.status === "running",
  ).length;
  const clearTitle = clearModule ? moduleTitles[clearModule] : "";

  async function load() {
    setLoading(true);
    try {
      const [nextUsage, nextLan, nextBt, logs] = await Promise.all([
        ipc.appDataUsage(),
        ipc.lanTransferStatus(),
        ipc.btCacheStats(),
        ipc.activityLogs(500),
      ]);
      setUsage(nextUsage);
      setLan(nextLan);
      setBt(nextBt);
      setLogCount(logs.length);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  }

  const loadOnMount = useEffectEvent(load);
  useEffect(() => {
    queueMicrotask(() => void loadOnMount());
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("dev"));
  }, []);

  async function confirmClear() {
    if (!clearModule) return;
    try {
      const result = await ipc.appDataClear(clearModule);
      const title = moduleTitles[clearModule];
      const freed = formatBytes(result.bytesFreed);
      toast.success(t`${title}已清理，释放 ${freed}`);
      setClearModule(null);
      void load();
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function resetAll() {
    try {
      if (isDesktopPlatform()) {
        const { disable } = await import("@tauri-apps/plugin-autostart");
        await disable().catch(() => undefined);
      }
      await ipc.appDataReset();
      localStorage.removeItem("mftp-settings");
      localStorage.removeItem("mftp-games-history");
      localStorage.removeItem("mftp-poetry");
      window.location.href = "/";
    } catch (error) {
      toast.error(String(error));
    }
  }

  return (
    <AppPageLayout
      title={t`关于`}
      description={t`版本、状态和本地数据管理`}
      actions={
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw
            className={loading ? "animate-spin" : undefined}
            data-icon="inline-start"
          />
          {t`刷新`}
        </Button>
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <section className="border-border bg-card rounded-lg border p-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">MFTP</h2>
              <p className="text-muted-foreground mt-1 text-xs">{t`本地文件与数据工具`}</p>
            </div>
            <Badge variant="outline">v{version}</Badge>
          </div>
          <Button
            variant="link"
            className="mt-2 h-auto px-0"
            onClick={() => void openUrl("https://github.com/imehc/mftp")}
          >
            {t`项目帮助`}
          </Button>
        </section>

        <section className="border-border bg-card rounded-lg border p-2.5">
          <div className="mb-2 flex items-center gap-2">
            <Database className="size-4" />
            <h2 className="text-sm font-semibold">{t`存储占用`}</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <UsageRow
              label={t`主数据库`}
              value={usage ? formatBytes(usage.mainDatabaseBytes) : "-"}
            />
            <UsageRow
              label={t`诗词数据库`}
              value={usage ? formatBytes(usage.poetryDatabaseBytes) : "-"}
            />
            <UsageRow
              label={t`BT 缓存`}
              value={usage ? formatBytes(usage.btCacheBytes) : "-"}
            />
            <UsageRow
              label={t`应用内部数据`}
              value={usage ? formatBytes(usage.btInternalBytes) : "-"}
            />
            <UsageRow
              label={t`总占用`}
              value={usage ? formatBytes(usage.totalBytes) : "-"}
              strong
            />
          </div>
        </section>

        <section className="border-border bg-card rounded-lg border p-2.5">
          <div className="mb-2 flex items-center gap-2">
            <Activity className="size-4" />
            <h2 className="text-sm font-semibold">{t`当前状态`}</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <StatusRow
              label={t`SSH/SFTP 连接`}
              value={`${activeSessions}`}
              active={activeSessions > 0}
            />
            <StatusRow
              label={t`文件传输`}
              value={`${activeTransfers}`}
              active={activeTransfers > 0}
            />
            <StatusRow
              label={t`局域网服务`}
              value={statusLabel(lan?.running ?? false, statusLabels)}
              active={lan?.running ?? false}
              icon={<Wifi className="size-3.5" />}
            />
            <StatusRow
              label={t`BT 缓存任务`}
              value={`${bt?.items ?? 0}`}
              active={(bt?.items ?? 0) > 0}
            />
            <StatusRow
              label={t`诗词库同步`}
              value={statusLabel(sync.active, statusLabels)}
              active={sync.active}
            />
            <StatusRow
              label={t`活动日志`}
              value={`${logCount}`}
              active={false}
            />
          </div>
        </section>

        <section className="border-border bg-card rounded-lg border p-2.5">
          <div className="mb-2 flex items-center gap-2">
            <HardDrive className="size-4" />
            <h2 className="text-sm font-semibold">{t`数据管理`}</h2>
          </div>
          <div className="divide-border divide-y">
            {visibleModules.length === 0 ? (
              <p className="text-muted-foreground py-1 text-xs">
                {t`暂无可清理的数据`}
              </p>
            ) : null}
            {visibleModules.map((module) => (
              <div
                key={module}
                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <span className="text-sm">{moduleTitles[module]}</span>
                  <span className="text-muted-foreground ml-2 text-xs tabular-nums">
                    {usage ? formatBytes(moduleBytes[module]) : "-"}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setClearModule(module)}
                >
                  <Trash2 data-icon="inline-start" />
                  {t`清理`}
                </Button>
              </div>
            ))}
          </div>
          <div className="border-border mt-3 border-t pt-2.5">
            <Button variant="destructive" onClick={() => setResetOpen(true)}>
              <RotateCcw data-icon="inline-start" />
              {t`清空所有数据`}
            </Button>
            <p className="text-muted-foreground mt-2 text-xs">{t`恢复首次打开状态，不删除下载目录和共享目录中的文件。`}</p>
          </div>
        </section>
      </div>

      <AlertDialog
        open={clearModule !== null}
        onOpenChange={(open) => {
          if (!open) setClearModule(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t`清理${clearTitle}？`}</AlertDialogTitle>
            <AlertDialogDescription>{t`此操作无法撤销，其他模块数据不会受到影响。`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t`取消`}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmClear()}
            >{t`确认清理`}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t`清空所有数据？`}</AlertDialogTitle>
            <AlertDialogDescription>{t`将删除所有应用内数据、缓存、日志和设置，并恢复首次打开状态。下载目录和共享目录中的文件会保留。`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t`取消`}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void resetAll()}
            >{t`确认清空`}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppPageLayout>
  );
}

function UsageRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="bg-muted/40 flex items-center justify-between gap-2 rounded-md px-2.5 py-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span
        className={strong ? "text-sm font-semibold" : "text-sm tabular-nums"}
      >
        {value}
      </span>
    </div>
  );
}

function StatusRow({
  label,
  value,
  active,
  icon,
}: {
  label: string;
  value: string;
  active: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </span>
      <Badge variant={active ? "secondary" : "outline"}>{value}</Badge>
    </div>
  );
}
