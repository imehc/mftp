import { type ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { HardDrive, LayoutList } from "lucide-react";
import type { SystemStats } from "~/types";
import { formatBytes } from "~/lib/format";
import { cn } from "~/lib/utils";
function Section({
  title,
  icon,
  children,
}: {
  title: ReactNode;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        <span className="min-w-0 truncate">{title}</span>
      </div>
      {children}
    </section>
  );
}
function EmptyHint() {
  return (
    <p className="text-muted-foreground py-2 text-center text-xs">
      <Trans>暂无数据</Trans>
    </p>
  );
}

/** 用量条；磁盘越满，填充色越接近警告 / 危险。 */
function UsageBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300 ease-out",
          clamped >= 90
            ? "bg-destructive"
            : clamped >= 75
              ? "bg-amber-500"
              : "bg-primary",
        )}
        style={{
          width: `${clamped}%`,
        }}
      />
    </div>
  );
}
export function DisksSection({ disks }: { disks: SystemStats["disks"] }) {
  return (
    <Section
      title={<Trans>磁盘</Trans>}
      icon={<HardDrive className="text-muted-foreground size-4" />}
    >
      {disks.length === 0 ? (
        <EmptyHint />
      ) : (
        <div className="flex flex-col gap-2.5">
          {disks.map((disk) => {
            const percent = disk.total > 0 ? (disk.used / disk.total) * 100 : 0;
            const formatBytesValue = formatBytes(disk.available);
            return (
              <div
                key={`${disk.filesystem}-${disk.mount}`}
                className="flex items-center gap-3 text-xs"
              >
                <div className="flex w-32 shrink-0 flex-col leading-tight sm:w-44">
                  <span className="text-foreground truncate font-mono">
                    {disk.mount}
                  </span>
                  <span className="text-muted-foreground truncate">
                    {disk.filesystem}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <UsageBar percent={percent} />
                </div>
                <span className="w-10 shrink-0 text-right font-medium tabular-nums">
                  {percent.toFixed(0)}%
                </span>
                <span className="text-muted-foreground hidden w-32 shrink-0 text-right tabular-nums sm:inline">
                  {formatBytes(disk.used)} / {formatBytes(disk.total)}
                </span>
                <span className="text-muted-foreground hidden w-24 shrink-0 text-right tabular-nums md:inline">
                  <Trans>可用 {formatBytesValue}</Trans>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
function ProcessRow({ proc }: { proc: SystemStats["topProcesses"][number] }) {
  return (
    <>
      <span className="text-right font-mono tabular-nums">{proc.pid}</span>
      <span className="truncate">{proc.user}</span>
      <span className="flex items-center gap-1.5 tabular-nums">
        <span className="w-9 text-right">{proc.cpu.toFixed(1)}%</span>
        <span className="bg-muted hidden h-1 flex-1 overflow-hidden rounded-full sm:block">
          <span
            className="block h-full bg-[var(--viz-1)]"
            style={{
              width: `${Math.min(100, proc.cpu)}%`,
            }}
          />
        </span>
      </span>
      <span className="flex items-center gap-1.5 tabular-nums">
        <span className="w-9 text-right">{proc.memory.toFixed(1)}%</span>
        <span className="bg-muted hidden h-1 flex-1 overflow-hidden rounded-full sm:block">
          <span
            className="block h-full bg-[var(--viz-3)]"
            style={{
              width: `${Math.min(100, proc.memory)}%`,
            }}
          />
        </span>
      </span>
      <span className="text-muted-foreground truncate font-mono">
        {proc.command}
      </span>
    </>
  );
}
export function ProcessesSection({
  processes,
}: {
  processes: SystemStats["topProcesses"];
}) {
  return (
    <Section
      title={<Trans>Top 进程</Trans>}
      icon={<LayoutList className="text-muted-foreground size-4" />}
    >
      {processes.length === 0 ? (
        <EmptyHint />
      ) : (
        <div className="grid grid-cols-[3rem_5rem_4.5rem_4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs sm:grid-cols-[3rem_5rem_6rem_6rem_minmax(0,1fr)]">
          <span className="text-muted-foreground">
            <Trans>PID</Trans>
          </span>
          <span className="text-muted-foreground">
            <Trans>用户</Trans>
          </span>
          <span className="text-muted-foreground">
            <Trans>CPU</Trans>
          </span>
          <span className="text-muted-foreground">
            <Trans>内存</Trans>
          </span>
          <span className="text-muted-foreground">
            <Trans>命令</Trans>
          </span>
          {processes.map((proc) => (
            <ProcessRow key={proc.pid} proc={proc} />
          ))}
        </div>
      )}
    </Section>
  );
}
export { Section as MonitorSection };
