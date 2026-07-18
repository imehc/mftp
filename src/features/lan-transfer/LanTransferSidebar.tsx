import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { QRCodeSVG } from "qrcode.react";
import { Monitor, Unplug, XCircle } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import type {
  LanConnectedDevice,
  LanTransferSettings,
  LanTransferStatus,
  LanTransferTask,
} from "~/types";
import { translate } from "~/i18n/translate";

interface LanTransferSidebarProps {
  settings: LanTransferSettings | null;
  status: LanTransferStatus | null;
  devices: LanConnectedDevice[];
  tasks: LanTransferTask[];
  disconnectDevice: (id: string) => void;
  cancelTask: (id: string) => void;
}

function permissionLabel(value?: string | null) {
  if (value === "readOnly") return translate(msg`只读`);
  if (value === "uploadOnly") return translate(msg`仅上传`);
  return translate(msg`读写`);
}

function securityModeLabel(value?: string | null) {
  if (value === "open") return translate(msg`开放`);
  if (value === "trusted") return translate(msg`白名单`);
  return translate(msg`确认码`);
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${restSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}h ${restMinutes}m`;
}

function taskStatusLabel(value: string) {
  if (value === "running") return translate(msg`进行中`);
  if (value === "success") return translate(msg`完成`);
  if (value === "failed") return translate(msg`失败`);
  if (value === "canceled") return translate(msg`已取消`);
  return value;
}

function taskDirectionLabel(value: string) {
  if (value === "upload") return translate(msg`上传`);
  if (value === "download") return translate(msg`下载`);
  return value;
}

function taskSpeed(task: LanTransferTask) {
  const elapsedMs = Math.max(0, task.updatedAt - task.startedAt);
  if (elapsedMs <= 0 || task.transferred <= 0) return 0;
  return task.transferred / (elapsedMs / 1000);
}

function taskEta(task: LanTransferTask) {
  if (task.status !== "running") {
    return formatDuration(task.updatedAt - task.startedAt);
  }
  const speed = taskSpeed(task);
  if (speed <= 0 || task.total <= task.transferred) return "-";
  return formatDuration(((task.total - task.transferred) / speed) * 1000);
}

export default function LanTransferSidebar({
  settings,
  status,
  devices,
  tasks,
  disconnectDevice,
  cancelTask,
}: LanTransferSidebarProps) {
  const { t } = useLingui();
  return (
    <aside className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
      <section className="rounded-lg border border-border bg-card p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            <Trans>访问</Trans>
          </h2>
          <Badge variant="outline">
            {securityModeLabel(settings?.securityMode)}
          </Badge>
        </div>
        {status?.url ? (
          <div className="flex items-center gap-2 lg:flex-col lg:items-start">
            <div className="rounded-md border border-border bg-background p-1.5">
              <QRCodeSVG value={status.url} size={118} />
            </div>
            <div className="min-w-0 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">
                <Trans>扫码访问</Trans>
              </div>
              <div className="truncate">{status.url}</div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-36 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            <Trans>服务未启动</Trans>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            <Trans>连接设备</Trans>
          </h2>
          <Badge variant="outline">{devices.length}</Badge>
        </div>
        {devices.length === 0 ? (
          <div className="flex min-h-20 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            <Trans>暂无设备</Trans>
          </div>
        ) : (
          <div className="flex max-h-44 flex-col gap-1 overflow-auto">
            {devices.map((device) => (
              <div
                key={device.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border px-2 py-1.5"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Monitor className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">
                      {device.deviceName}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {device.ip} · {permissionLabel(device.permission)} ·{" "}
                    {device.currentOperation}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void disconnectDevice(device.id)}
                >
                  <Unplug className="text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            <Trans>传输任务</Trans>
          </h2>
          <Badge variant="outline">{tasks.length}</Badge>
        </div>
        {tasks.length === 0 ? (
          <div className="flex min-h-20 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            <Trans>暂无任务</Trans>
          </div>
        ) : (
          <div className="flex max-h-48 flex-col gap-1.5 overflow-auto">
            {tasks.map((task) => {
              const percent =
                task.total > 0
                  ? Math.min(100, Math.round((task.transferred / task.total) * 100))
                  : 0;
              const speed = taskSpeed(task);
              return (
                <div
                  key={task.id}
                  className="rounded-md border border-border px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium">
                      {taskDirectionLabel(task.direction)} · {task.fileName}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-muted-foreground">
                        {taskStatusLabel(task.status)}
                      </span>
                      {task.status === "running" ? (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => void cancelTask(task.id)}
                        >
                          <XCircle className="text-destructive" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{task.ip}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatBytes(task.transferred)} / {formatBytes(task.total)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {speed > 0 ? `${formatBytes(speed)}/s` : "-"}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {task.status === "running" ? t`剩余 ` : t`耗时 `}
                      {taskEta(task)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-2.5">
        <h2 className="mb-2 text-sm font-semibold">
          <Trans>接收</Trans>
        </h2>
        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground"><Trans>端口</Trans></span>
            <span className="tabular-nums">{settings?.port ?? "-"}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground"><Trans>绑定</Trans></span>
            <span className="truncate text-right">{settings?.bindHost || t`自动`}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground"><Trans>默认权限</Trans></span>
            <span>{permissionLabel(settings?.defaultPermission)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground"><Trans>并发上限</Trans></span>
            <span>{settings?.maxConcurrentTransfers ?? 3}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground"><Trans>自动启动</Trans></span>
            <span>{settings?.autoStart ? t`开启` : t`关闭`}</span>
          </div>
          <div className="min-w-0">
            <div className="text-muted-foreground"><Trans>接收目录</Trans></div>
            <div className="mt-1 truncate">{settings?.downloadDir ?? "-"}</div>
          </div>
        </div>
      </section>
    </aside>
  );
}
