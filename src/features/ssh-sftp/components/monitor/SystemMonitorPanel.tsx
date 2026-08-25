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
import type { Session, SystemStats } from "~/types";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatBytes } from "~/lib/format";
import { TimeSeriesCard } from "~/features/ssh-sftp/components/monitor/MonitorCharts";
import {
  DisksSection,
  ProcessesSection,
} from "~/features/ssh-sftp/components/monitor/MonitorSections";
import {
  useSystemMonitor,
  type RefreshIntervalMs,
} from "~/features/ssh-sftp/components/monitor/useSystemMonitor";

interface Props {
  session: Session;
}

const pct = (value: number) => `${value.toFixed(1)}%`;

/// Zeroed snapshot used for the optimistic first render so the layout is
/// visible immediately while the first sample round-trips (~1.2s).
const PLACEHOLDER: SystemStats = {
  os: "",
  hostname: null,
  uptimeSecs: null,
  cpu: { user: 0, nice: 0, system: 0, idle: 100, used: 0 },
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
      message: plural({ seconds }, { one: "# 秒", other: "# 秒" }),
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
  // Optimistic render: show the full layout immediately and fill in values
  // once the first sample round-trips.
  const ready = !!data;
  const stats = data ?? PLACEHOLDER;
  const memPct =
    stats.memory.total > 0 ? (stats.memory.used / stats.memory.total) * 100 : 0;
  const last = history.length > 0 ? history[history.length - 1] : null;
  const updatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString()
    : "…";

  return (
    <div className="flex h-full flex-col bg-background [--viz-1:#2a78d6] [--viz-2:#eb6834] [--viz-3:#1baf7a] dark:[--viz-1:#3987e5] dark:[--viz-2:#d95926] dark:[--viz-3:#199e70]">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          title={t`刷新`}
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
        </Button>
        <span className="text-xs text-muted-foreground">
          {loading ? t`采集数据…` : t`更新于 ${updatedLabel}`}
        </span>
        <div className="flex-1" />
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Trans>刷新间隔</Trans>
          <Select
            value={String(intervalMs)}
            onValueChange={(value) =>
              setIntervalMs(Number(value) as RefreshIntervalMs)
            }
          >
            <SelectTrigger className="h-7 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
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
        <div className="flex items-center gap-2 border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{error}</span>
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

      <div className="flex-1 overflow-y-auto p-3">
        <div className="mx-auto flex max-w-6xl flex-col gap-3">
          {ready ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Server className="size-4 text-muted-foreground" />
                {stats.hostname ?? stats.os}
              </span>
              <span>{stats.os}</span>
              {stats.cpuCores != null ? (
                <span>
                  <Plural
                    value={{ cpuCoreCount: stats.cpuCores }}
                    one="# 核"
                    other="# 核"
                  />
                </span>
              ) : null}
              {stats.uptimeSecs != null ? (
                <span>
                  <Trans>运行 {formatUptime(t, stats.uptimeSecs)}</Trans>
                </span>
              ) : null}
              {stats.load ? (
                <span>
                  <Trans>
                    负载 {stats.load.load1.toFixed(2)} /{" "}
                    {stats.load.load5.toFixed(2)} /{" "}
                    {stats.load.load15.toFixed(2)}
                  </Trans>
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <TimeSeriesCard
              title={<Trans>CPU</Trans>}
              icon={<Cpu className="size-4 text-muted-foreground" />}
              headline={ready ? pct(stats.cpu.used) : "—"}
              subline={
                ready ? (
                  <Trans>
                    用户 {pct(stats.cpu.user)} · 系统 {pct(stats.cpu.system)} ·
                    空闲 {pct(stats.cpu.idle)}
                  </Trans>
                ) : null
              }
              series={[{ key: "cpu", colorVar: "--viz-1" }]}
              points={history}
              unit="percent"
            />
            <TimeSeriesCard
              title={<Trans>内存</Trans>}
              icon={<MemoryStick className="size-4 text-muted-foreground" />}
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
                          交换 {formatBytes(stats.memory.swapUsed)} /{" "}
                          {formatBytes(stats.memory.swapTotal)}
                        </Trans>
                      </>
                    ) : null}
                  </>
                ) : null
              }
              series={[{ key: "mem", colorVar: "--viz-3" }]}
              points={history}
              unit="percent"
            />
            <TimeSeriesCard
              title={<Trans>网络</Trans>}
              icon={<Network className="size-4 text-muted-foreground" />}
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
              icon={<Activity className="size-4 text-muted-foreground" />}
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

          <DisksSection disks={stats.disks} />
          <ProcessesSection processes={stats.topProcesses} />
        </div>
      </div>
    </div>
  );
}

function formatUptime(
  t: ReturnType<typeof useLingui>["t"],
  seconds: number,
) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return t({
      message: plural(
        { days },
        { one: `# 天 ${hours} 小时`, other: `# 天 ${hours} 小时` },
      ),
    });
  }
  if (hours > 0) {
    return t({
      message: plural(
        { hours },
        { one: `# 小时 ${minutes} 分钟`, other: `# 小时 ${minutes} 分钟` },
      ),
    });
  }
  return t({
    message: plural({ minutes }, { one: "# 分钟", other: "# 分钟" }),
  });
}
