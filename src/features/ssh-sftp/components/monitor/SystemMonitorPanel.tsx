import { plural } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  Activity,
  Cpu,
  LoaderCircle,
  MemoryStick,
  Network,
  RefreshCw,
  Server,
  TriangleAlert,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { TimeSeriesCard } from "~/features/ssh-sftp/components/monitor/MonitorCharts";
import {
  DisksSection,
  ProcessesSection,
} from "~/features/ssh-sftp/components/monitor/MonitorSections";
import {
  type RefreshIntervalMs,
  useSystemMonitor,
} from "~/features/ssh-sftp/components/monitor/useSystemMonitor";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";
import type { Session, SystemStats } from "~/types";

interface Props {
  session: Session;
}

const pct = (value: number) => `${value.toFixed(1)}%`;

/// 用于乐观首屏的清零快照，使布局在首个采样往返（约 1.2s）期间立即可见。
const PLACEHOLDER: SystemStats = {
  os: "",
  hostname: null,
  uptimeSecs: null,
  cpu: {
    user: 0,
    nice: 0,
    system: 0,
    idle: 100,
    used: 0,
  },
  cpuCores: null,
  load: null,
  memory: {
    total: 0,
    used: 0,
    available: 0,
    free: 0,
    cached: 0,
    swapTotal: 0,
    swapUsed: 0,
  },
  disks: [],
  network: [],
  diskIo: [],
  topProcesses: [],
};

export default function SystemMonitorPanel({ session }: Props) {
  const { t } = useLingui();
  const formatSeconds = (seconds: number) =>
    t({
      comment: "Refresh interval duration in seconds",
      message: plural(
        {
          seconds,
        },
        {
          one: "# 秒",
          other: "# 秒",
        },
      ),
    });
  const {
    data,
    history,
    loading,
    error,
    paused,
    refresh,
    retry,
    intervalMs,
    setIntervalMs,
    lastUpdated,
  } = useSystemMonitor(session);
  // 乐观渲染：先立即展示完整布局，待首个采样往返回来后再填入数值。
  const ready = !!data;
  const stats = data ?? PLACEHOLDER;
  const memPct =
    stats.memory.total > 0 ? (stats.memory.used / stats.memory.total) * 100 : 0;
  const last = history.length > 0 ? history[history.length - 1] : null;
  const updatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString()
    : "…";
  const formatUptimeValue = formatUptime(t, stats.uptimeSecs ?? 0);
  const toFixedValue = stats.load?.load1.toFixed(2);
  const toFixedValue2 = stats.load?.load5.toFixed(2);
  const toFixedValue3 = stats.load?.load15.toFixed(2);
  const pctValue = pct(stats.cpu.user);
  const pctValue2 = pct(stats.cpu.system);
  const pctValue3 = pct(stats.cpu.idle);
  const formatBytesValue = formatBytes(stats.memory.swapUsed);
  const formatBytesValue2 = formatBytes(stats.memory.swapTotal);
  return (
    <div className="bg-background flex h-full flex-col [--viz-1:var(--chart-1)] [--viz-2:var(--chart-2)] [--viz-3:var(--chart-3)]">
      <div className="border-border flex flex-wrap items-center gap-1 border-b px-3 py-1">
        <Button
          variant="ghost"
          size="icon-sm"
          title={t`刷新`}
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
        </Button>
        <span className="text-muted-foreground text-xs">
          {loading ? t`采集数据…` : t`更新于 ${updatedLabel}`}
        </span>
        <div className="flex-1" />
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Trans>刷新间隔</Trans>
          <Select
            value={String(intervalMs)}
            onValueChange={(value) =>
              setIntervalMs(Number(value) as RefreshIntervalMs)
            }
          >
            <SelectTrigger
              density="adaptive"
              className="w-24"
              aria-label={t`刷新间隔`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="ui-density-adaptive">
              <SelectItem value="0">
                {t({
                  context: "state",
                  comment: "Option that turns automatic monitor refresh off",
                  message: "关闭",
                })}
              </SelectItem>
              <SelectItem value="2000">{formatSeconds(2)}</SelectItem>
              <SelectItem value="5000">{formatSeconds(5)}</SelectItem>
              <SelectItem value="10000">{formatSeconds(10)}</SelectItem>
            </SelectContent>
          </Select>
        </span>
      </div>

      {error ? (
        <div className="border-border bg-destructive/10 text-destructive flex items-center gap-2 border-b px-3 py-1.5 text-xs">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {describeError(error)}
            {ready ? (
              <span className="ml-2">
                <Trans>当前显示上次采样</Trans>
              </span>
            ) : null}
          </span>
          {paused ? (
            <span className="shrink-0">
              <Trans>连续失败，已暂停刷新</Trans>
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="icon-xs"
            title={t`重试`}
            onClick={retry}
            disabled={loading}
          >
            <RefreshCw />
          </Button>
        </div>
      ) : null}

      <div className="app-scroll-safe-end min-h-0 flex-1 overflow-y-auto px-3 pt-3">
        <div className="mx-auto flex max-w-6xl flex-col gap-3">
          {ready ? (
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-xs">
              <span className="text-foreground flex items-center gap-1.5 text-sm font-medium">
                <Server className="text-muted-foreground size-4" />
                {stats.hostname ?? stats.os}
              </span>
              <span>{stats.os}</span>
              {stats.cpuCores != null ? (
                <span>
                  <Plural
                    value={{
                      cpuCoreCount: stats.cpuCores,
                    }}
                    one="# 核"
                    other="# 核"
                  />
                </span>
              ) : null}
              {stats.uptimeSecs != null ? (
                <span>
                  <Trans>运行 {formatUptimeValue}</Trans>
                </span>
              ) : null}
              {stats.load ? (
                <span>
                  <Trans>
                    负载 {toFixedValue} / {toFixedValue2} / {toFixedValue3}
                  </Trans>
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TimeSeriesCard
              title={<Trans>CPU</Trans>}
              icon={<Cpu className="text-muted-foreground size-4" />}
              headline={ready ? pct(stats.cpu.used) : "—"}
              subline={
                ready ? (
                  <Trans>
                    用户 {pctValue} · 系统 {pctValue2} · 空闲 {pctValue3}
                  </Trans>
                ) : null
              }
              series={[
                {
                  key: "cpu",
                  colorVar: "--viz-1",
                },
              ]}
              points={history}
              unit="percent"
            />
            <TimeSeriesCard
              title={<Trans>内存</Trans>}
              icon={<MemoryStick className="text-muted-foreground size-4" />}
              headline={ready ? pct(memPct) : "—"}
              subline={
                ready && stats.memory.total > 0 ? (
                  <>
                    {formatBytes(stats.memory.used)} /{" "}
                    {formatBytes(stats.memory.total)}
                    {stats.memory.swapTotal > 0 ? (
                      <>
                        {" · "}
                        <Trans>
                          交换 {formatBytesValue} / {formatBytesValue2}
                        </Trans>
                      </>
                    ) : null}
                  </>
                ) : null
              }
              series={[
                {
                  key: "mem",
                  colorVar: "--viz-3",
                },
              ]}
              points={history}
              unit="percent"
            />
            <TimeSeriesCard
              title={<Trans>网络</Trans>}
              icon={<Network className="text-muted-foreground size-4" />}
              series={[
                {
                  key: "rx",
                  colorVar: "--viz-1",
                  label: <Trans>下载</Trans>,
                  current: last ? `${formatBytes(last.rx)}/s` : undefined,
                },
                {
                  key: "tx",
                  colorVar: "--viz-2",
                  label: <Trans>上传</Trans>,
                  current: last ? `${formatBytes(last.tx)}/s` : undefined,
                },
              ]}
              points={history}
              unit="rate"
            />
            <TimeSeriesCard
              title={<Trans>磁盘 I/O</Trans>}
              icon={<Activity className="text-muted-foreground size-4" />}
              series={[
                {
                  key: "read",
                  colorVar: "--viz-1",
                  label: <Trans>读取</Trans>,
                  current: last ? `${formatBytes(last.read)}/s` : undefined,
                },
                {
                  key: "write",
                  colorVar: "--viz-2",
                  label: <Trans>写入</Trans>,
                  current: last ? `${formatBytes(last.write)}/s` : undefined,
                },
              ]}
              points={history}
              unit="rate"
            />
          </div>

          {ready ? (
            <>
              <DisksSection disks={stats.disks} />
              <ProcessesSection processes={stats.topProcesses} />
            </>
          ) : (
            <p role="status" className="text-muted-foreground text-sm">
              <Trans>等待监控数据</Trans>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatUptime(t: ReturnType<typeof useLingui>["t"], seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return t({
      message: plural(
        {
          days,
        },
        {
          one: `# 天 ${hours} 小时`,
          other: `# 天 ${hours} 小时`,
        },
      ),
    });
  }
  if (hours > 0) {
    return t({
      message: plural(
        {
          hours,
        },
        {
          one: `# 小时 ${minutes} 分钟`,
          other: `# 小时 ${minutes} 分钟`,
        },
      ),
    });
  }
  return t({
    message: plural(
      {
        minutes,
      },
      {
        one: "# 分钟",
        other: "# 分钟",
      },
    ),
  });
}
