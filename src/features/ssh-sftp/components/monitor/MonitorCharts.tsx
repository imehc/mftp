import { type ReactNode, useState } from "react";
import { Trans } from "@lingui/react/macro";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  matchByDataKey,
} from "recharts";
import { formatBytes } from "~/lib/format";
import { prefersReducedMotion } from "~/lib/motion";
import type { MonitorPoint } from "~/features/ssh-sftp/components/monitor/useSystemMonitor";
export type SeriesKey = Exclude<keyof MonitorPoint, "t">;
export interface SeriesDef {
  key: SeriesKey;
  /** 承载系列颜色的 CSS 变量（明 / 暗色值设置在面板根上）。 */
  colorVar: string;
  /** 图例 + 提示框标签。一张卡片有两条系列时必填。 */
  label?: ReactNode;
  /** 图例标签旁的实时数值。 */
  current?: string;
}

/** 百分比图表把坐标轴固定在 0–100；速率图表按 bytes/s 自适应。 */
type Unit = "percent" | "rate";
const formatAxisTime = (t: number) =>
  new Date(t).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
const formatValue = (unit: Unit, value: number) =>
  unit === "percent" ? `${value.toFixed(1)}%` : `${formatBytes(value)}/s`;
const matchMonitorPoint = matchByDataKey("t");
interface TipEntry {
  dataKey?: string | number;
  value?: number | string;
}
function ChartTip({
  active,
  payload,
  label,
  series,
  unit,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TipEntry>;
  label?: number;
  series: SeriesDef[];
  unit: Unit;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border-border bg-popover text-popover-foreground rounded-md border px-2.5 py-1.5 text-xs shadow-md">
      <p className="text-muted-foreground mb-1">
        {label != null ? new Date(label).toLocaleTimeString() : ""}
      </p>
      <div className="flex flex-col gap-0.5">
        {payload.map((entry) => {
          const def = series.find((s) => s.key === entry.dataKey);
          if (!def) return null;
          return (
            <p key={def.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{
                  background: `var(${def.colorVar})`,
                }}
              />
              {def.label ? (
                <span className="text-muted-foreground">{def.label}</span>
              ) : null}
              <span className="ml-auto pl-3 font-medium tabular-nums">
                {formatValue(unit, Number(entry.value ?? 0))}
              </span>
            </p>
          );
        })}
      </div>
    </div>
  );
}
interface TimeSeriesCardProps {
  title: ReactNode;
  icon?: ReactNode;
  /** 标题栏右侧的大号当前值（单系列卡片）。 */
  headline?: ReactNode;
  /** 标题栏下方的小号辅助行。 */
  subline?: ReactNode;
  series: SeriesDef[];
  points: MonitorPoint[];
  unit: Unit;
}

/**
 * 一张监控图表卡片：标题栏（标题 + 实时值）、可选图例行（双系列卡片
 * 显示实时值），以及时序面积图。
 */
export function TimeSeriesCard({
  title,
  icon,
  headline,
  subline,
  series,
  points,
  unit,
}: TimeSeriesCardProps) {
  const percent = unit === "percent";
  // 用“是否渲染过一次”的渲染态来记录，而不是在渲染期间读 ref；
  // 动画从第二次渲染起才生效。
  const [renderedPoints, setRenderedPoints] = useState(0);
  if (renderedPoints < 2 && points.length >= 2)
    setRenderedPoints(points.length);
  const animationActive = renderedPoints >= 2 && !prefersReducedMotion();
  return (
    <section className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          {icon}
          <span className="min-w-0 truncate">{title}</span>
        </span>
        {headline != null ? (
          <span className="shrink-0 text-xl leading-none font-semibold">
            {headline}
          </span>
        ) : null}
      </div>
      {series.length > 1 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{
                  background: `var(${s.colorVar})`,
                }}
              />
              <span className="text-muted-foreground">{s.label}</span>
              {s.current ? (
                <span className="font-medium tabular-nums">{s.current}</span>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      {subline ? (
        <p className="text-muted-foreground text-xs">{subline}</p>
      ) : null}
      <div className="h-32 sm:h-36">
        {points.length < 2 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
            <Trans>暂无数据</Trans>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={points}
              margin={{
                top: 4,
                right: 4,
                bottom: 0,
                left: 0,
              }}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={formatAxisTime}
                minTickGap={48}
                tickLine={false}
                axisLine={{
                  stroke: "var(--border)",
                }}
                tick={{
                  fontSize: 10,
                  fill: "var(--muted-foreground)",
                }}
                height={18}
              />
              <YAxis
                width={percent ? 34 : 50}
                domain={percent ? [0, 100] : [0, "auto"]}
                ticks={percent ? [0, 50, 100] : undefined}
                tickFormatter={(value: number) =>
                  percent ? `${value}%` : formatBytes(value)
                }
                tickLine={false}
                axisLine={false}
                tick={{
                  fontSize: 10,
                  fill: "var(--muted-foreground)",
                }}
              />
              <Tooltip
                content={<ChartTip series={series} unit={unit} />}
                cursor={{
                  stroke: "var(--muted-foreground)",
                  strokeOpacity: 0.4,
                  strokeWidth: 1,
                }}
                isAnimationActive={false}
              />
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={`var(${s.colorVar})`}
                  strokeWidth={2}
                  fill={`var(${s.colorVar})`}
                  fillOpacity={0.1}
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: `var(${s.colorVar})`,
                    stroke: "var(--card)",
                    strokeWidth: 2,
                  }}
                  animationDuration={350}
                  animationEasing="ease-out"
                  animationMatchBy={matchMonitorPoint}
                  isAnimationActive={animationActive}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
