import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useSyncExternalStore } from "react";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { formatBytes } from "~/lib/format";

import { textureFormat } from "../runtime/inspection";
import type { MemoryHistory } from "../runtime/memory";

export function MemoryWarning({ memory }: { memory: MemoryHistory }) {
  const state = useSyncExternalStore(memory.subscribe, memory.snapshot);
  if (state.total.known < state.threshold) return null;
  return (
    <Alert variant="destructive" role="status">
      <AlertTitle>
        <Trans>模型内存估算已达到提醒阈值</Trans>
      </AlertTitle>
      <AlertDescription>
        <Trans>可以移除不需要的模型以释放资源。此阈值不是设备剩余内存。</Trans>
      </AlertDescription>
    </Alert>
  );
}

export function MemoryPanel({
  memory,
  selected,
}: {
  memory: MemoryHistory;
  selected: string | null;
}) {
  const { t, i18n } = useLingui();
  const id = useId();
  const state = useSyncExternalStore(memory.subscribe, memory.snapshot);
  const current = selected ? state.models[selected] : undefined;
  const inventory = selected ? memory.inventory(selected) : undefined;
  const mib = 1024 * 1024;
  const data = state.history.map((point) => ({
    time: point.time,
    value: point.known / mib,
  }));
  const knownLabel = t({
    message: "已知分配估算",
    comment: "可计算 CPU 数据与 GPU 分配的估算合计，不含未知开销。",
  });
  const rows = [
    [
      t({
        message: "保留的源数据",
        comment: "为离线规范验证保留的 Blob 字节量，不等同于常驻内存。",
      }),
      state.total.source,
    ],
    [
      t({
        message: "总计（去重）",
        comment: "所有模型的已知分配估算，共享分配只计算一次。",
      }),
      state.total.known,
    ],
    [
      t({
        message: "CPU 数据估算",
        comment: "模型底层数组与解码像素数据的估算。",
      }),
      state.total.cpu,
    ],
    [
      t({
        message: "GPU 分配估算",
        comment: "模型几何缓冲和纹理的估算，不是显存实测。",
      }),
      state.total.gpu,
    ],
    [
      t({
        message: "当前模型",
        comment: "选中模型包含共享引用的已知分配估算。",
      }),
      current?.known ?? null,
    ],
  ] as const;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <dl className="flex flex-col gap-3 text-xs">
        {rows.map(([label, bytes]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">
              {bytes === null ? <Trans>未知</Trans> : formatBytes(bytes)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-xs leading-relaxed">
        <Trans>
          逐模型值包含共享引用，总计去重；隐藏模型仍占用内存。源数据字节量单列，不等于常驻内存。未计入临时预览、环境与诊断任务、材质对象、场景节点、着色器、驱动缓存与进程开销。
        </Trans>
      </p>
      {state.total.unknown > 0 ? (
        <p className="text-muted-foreground text-xs">
          <Trans>部分纹理、变形目标或动画分配无法估算，当前合计不完整。</Trans>
        </p>
      ) : null}
      <Field>
        <FieldLabel htmlFor={id}>
          <Trans comment="模型已知分配估算的提醒阈值，单位 MiB。">
            提醒阈值（MiB）
          </Trans>
        </FieldLabel>
        <Input
          id={id}
          type="number"
          min="1"
          max="65536"
          defaultValue={state.threshold / mib}
          onBlur={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isFinite(value) && value >= 1 && value <= 65536)
              memory.setThreshold(value * mib);
            else event.currentTarget.value = String(state.threshold / mib);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <FieldDescription>
          <Trans>仅用于提示，不代表设备内存上限。</Trans>
        </FieldDescription>
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          <Trans comment="模型内存估算最近两分钟的曲线。">内存历史</Trans>
        </h3>
        <Button
          density="adaptive"
          variant="outline"
          onClick={() => memory.pause(!state.paused)}
        >
          {state.paused ? (
            <Trans comment="恢复内存曲线采样。">继续记录</Trans>
          ) : (
            <Trans comment="暂停内存曲线采样，不暂停模型。">暂停记录</Trans>
          )}
        </Button>
      </div>
      <div className="h-36 min-w-0" role="img" aria-label={knownLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            accessibilityLayer
          >
            <XAxis
              dataKey="time"
              type="number"
              domain={["dataMin", "dataMax"]}
              hide
            />
            <YAxis
              width="auto"
              tick={{ fontSize: "0.625rem", fill: "var(--muted-foreground)" }}
              tickFormatter={(value) => formatBytes(Number(value) * mib)}
            />
            <Tooltip
              labelFormatter={(value) =>
                i18n.date(Number(value), {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              }
              formatter={(value) => [
                formatBytes(Number(value) * mib),
                knownLabel,
              ]}
              contentStyle={{
                background: "var(--background)",
                borderColor: "var(--border)",
                fontSize: "0.75rem",
              }}
            />
            <ReferenceLine
              y={state.threshold / mib}
              stroke="var(--destructive)"
              strokeDasharray="4 4"
              ifOverflow="hidden"
            />
            <Line
              type="stepAfter"
              dataKey="value"
              stroke="var(--foreground)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-muted-foreground text-xs">
        <Trans>
          每秒最多记录一次，保留最近 120
          个样本；后台停止记录。虚线表示提醒阈值。
        </Trans>
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer py-2">
          <Trans comment="展开内存历史曲线的数值表格。">历史数值</Trans>
        </summary>
        <div className="max-h-40 overflow-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>
                  <Trans comment="内存采样的时间列。">时间</Trans>
                </th>
                <th>{knownLabel}</th>
              </tr>
            </thead>
            <tbody>
              {state.history.map((point) => (
                <tr key={point.time}>
                  <td>
                    {i18n.date(point.time, {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </td>
                  <td>{formatBytes(point.known)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {inventory ? (
        <>
          <h3 className="text-sm font-medium">
            <Trans comment="选中模型的各类分配与资源数量。">资源明细</Trans>
          </h3>
          <dl className="flex flex-col gap-2 text-xs">
            {(
              [
                "geometry",
                "texture",
                "animation",
                "skeleton",
                "shared",
              ] as const
            ).map((category, index) => {
              const labels = [
                t({
                  message: "几何数据",
                  comment: "模型顶点、索引和实例数组内存。",
                }),
                t({
                  message: "纹理数据",
                  comment: "模型纹理与解码像素估算。",
                }),
                t({
                  message: "动画数据",
                  comment: "模型动画关键帧数组内存。",
                }),
                t({ message: "骨骼数据", comment: "模型骨骼矩阵数组内存。" }),
                t({
                  message: "共用数据缓冲",
                  comment: "几何、动画等共用的底层数组分配，仅统计一次。",
                }),
              ];
              const cpu = [...inventory.cpu.values()]
                .filter((a) => a.category === category)
                .reduce((sum, a) => sum + a.bytes, 0);
              const gpu = [...inventory.gpu.values()]
                .filter((a) => a.category === category)
                .reduce((sum, a) => sum + a.bytes, 0);
              return (
                <div
                  key={category}
                  className="flex flex-wrap justify-between gap-1"
                >
                  <dt>{labels[index]}</dt>
                  <dd>
                    CPU {formatBytes(cpu)} · GPU{" "}
                    {category === "animation" ? "—" : formatBytes(gpu)}
                  </dd>
                </div>
              );
            })}
            <div className="flex justify-between gap-2">
              <dt>
                <Trans comment="材质数量与字节数的未知状态。">材质对象</Trans>
              </dt>
              <dd>
                {i18n.number(inventory.materials)} · <Trans>字节数未知</Trans>
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>
                <Trans comment="模型动画片段的数量。">动画片段</Trans>
              </dt>
              <dd>{i18n.number(inventory.animations)}</dd>
            </div>
          </dl>
          {inventory.textures.map((texture, index) => {
            const number = index + 1;
            return (
              <div key={texture.id} className="flex flex-col gap-1 text-xs">
                <p className="truncate" title={texture.name}>
                  {texture.name ||
                    t({
                      message: `纹理 ${number}`,
                      comment: "无名称模型纹理的序号。",
                    })}
                </p>
                <p className="text-muted-foreground">
                  {texture.width ?? "?"} × {texture.height ?? "?"} · GPU{" "}
                  {texture.gpu === null ? t`未知` : formatBytes(texture.gpu)}
                </p>
                <p className="text-muted-foreground break-all">
                  {textureFormat(texture.format) ?? t`未知`}
                </p>
              </div>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
