import { useEffect, useId, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import {
  Check,
  Eye,
  EyeOff,
  Focus,
  Move3d,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";
import type { ViewerSession, ViewerState } from "../runtime/session";
import type { ModelLayout } from "../runtime/collection";

const statuses = {
  queued: msg({ message: "等待导入", comment: "批量模型导入的排队状态。" }),
  reading: msg({ message: "正在读取", comment: "模型文件读取状态。" }),
  decoding: msg({ message: "正在解析", comment: "模型解码状态。" }),
  uploading: msg({ message: "准备显示", comment: "模型 GPU 上传状态。" }),
  missing: msg({
    message: "缺少依赖",
    comment: "模型等待用户补充文件的状态。",
  }),
  ready: msg({ message: "已加载", comment: "三维模型成功导入状态。" }),
  error: msg({ message: "导入失败", comment: "单个三维模型导入失败状态。" }),
  cancelling: msg({ message: "正在取消", comment: "等待模型导入任务退出。" }),
  cancelled: msg({ message: "已取消", comment: "模型导入任务已退出。" }),
};

export function ModelList({
  session,
  state,
}: {
  session: ViewerSession;
  state: ViewerState;
}) {
  const { t } = useLingui();
  const id = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const runtime = session.runtime;
  const items = state.items;
  const selected = items.find((item) => item.id === state.selected);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewport.current,
    getItemKey: (index) => items[index].id,
    estimateSize: () =>
      (probe.current?.getBoundingClientRect().height || 16) * 9,
    overscan: 3,
  });
  useEffect(() => {
    const observer = new ResizeObserver(() => virtualizer.measure());
    if (probe.current) observer.observe(probe.current);
    return () => observer.disconnect();
  }, [virtualizer]);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ToggleGroup
        type="single"
        variant="outline"
        value={runtime?.models.layout}
        className="w-full flex-wrap"
        aria-label={t({
          message: "模型布局",
          comment: "多个三维模型的自动摆放方式。",
        })}
        onValueChange={(value) => {
          if (value) runtime?.arrange(value as ModelLayout);
        }}
        disabled={!state.model}
      >
        <ToggleGroupItem value="row">
          <Trans comment="模型沿一行排列。">并排</Trans>
        </ToggleGroupItem>
        <ToggleGroupItem value="grid">
          <Trans comment="模型按行列排列。">网格</Trans>
        </ToggleGroupItem>
        <ToggleGroupItem value="ring">
          <Trans comment="模型围绕中心排列。">环形</Trans>
        </ToggleGroupItem>
      </ToggleGroup>
      <div
        ref={viewport}
        className="relative max-h-[40dvh] overflow-auto"
        style={{ height: `${Math.min(3, items.length) * 9}rem` }}
      >
        <span
          ref={probe}
          aria-hidden="true"
          className="pointer-events-none absolute h-[1rem] w-px opacity-0"
        />
        <div
          role="list"
          aria-label={t({
            message: "已导入模型",
            comment: "当前三维查看器的模型与导入任务列表。",
          })}
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const item = items[row.index];
            const name = item.name;
            const ready = item.status === "ready";
            return (
              <div
                role="listitem"
                key={item.id}
                ref={virtualizer.measureElement}
                data-index={row.index}
                className="absolute top-0 left-0 w-full pb-2"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <div
                  className={cn(
                    "flex min-w-0 flex-col gap-1 rounded-lg border p-2",
                    selected?.id === item.id && "border-primary",
                  )}
                >
                  <Button
                    variant="ghost"
                    density="adaptive"
                    className="w-full min-w-0 justify-start"
                    disabled={!ready}
                    aria-pressed={selected?.id === item.id}
                    onClick={() => runtime?.select(item.id)}
                    title={name}
                  >
                    <span className="min-w-0 flex-1 truncate text-left">
                      {name}
                    </span>
                    {selected?.id === item.id ? (
                      <Check aria-hidden="true" />
                    ) : null}
                  </Button>
                  <p className="text-muted-foreground px-1 text-xs">
                    {item.format} · {formatBytes(item.size)} ·{" "}
                    {t(statuses[item.status])}
                  </p>
                  {item.error ? (
                    <p className="text-destructive px-1 text-xs break-words">
                      {describeError(item.error)}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      density="adaptive"
                      variant="ghost"
                      size="icon-sm"
                      disabled={!ready}
                      aria-label={t({
                        message: `显示或隐藏 ${name}`,
                        comment: "切换指定三维模型的可见性。",
                      })}
                      title={t({
                        message: "显示或隐藏",
                        comment: "模型可见性操作。",
                      })}
                      aria-pressed={item.visible}
                      onClick={() => runtime?.visible(item.id, !item.visible)}
                    >
                      {item.visible ? (
                        <Eye aria-hidden="true" />
                      ) : (
                        <EyeOff aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      density="adaptive"
                      variant="ghost"
                      size="icon-sm"
                      disabled={!ready}
                      aria-label={t({
                        message: `聚焦 ${name}`,
                        comment: "将相机对准指定三维模型，必要时显示模型。",
                      })}
                      title={t({
                        message: "聚焦模型",
                        comment: "将相机对准指定模型。",
                      })}
                      onClick={() => {
                        runtime?.select(item.id);
                        runtime?.fit(item.id);
                      }}
                    >
                      <Focus aria-hidden="true" />
                    </Button>
                    <Button
                      density="adaptive"
                      variant="ghost"
                      size="icon-sm"
                      disabled={item.status === "cancelling"}
                      aria-label={t({
                        message: `移除 ${name}`,
                        comment: "从三维查看器移除模型，不删除源文件。",
                      })}
                      title={t({
                        message: "移除模型",
                        comment: "移除查看器模型及资源，不删除源文件。",
                      })}
                      onClick={() => session.remove(item.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {selected ? (
        <div className="flex flex-col gap-3">
          <p className="truncate text-sm font-medium" title={selected.name}>
            {selected.name}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              density="adaptive"
              aria-pressed={runtime?.placing}
              onClick={() => runtime?.setPlacing(!runtime.placing)}
            >
              <Move3d data-icon="inline-start" aria-hidden="true" />
              <Trans comment="切换画布拖动模型位置的模式。">摆放模型</Trans>
            </Button>
            <Button
              variant="outline"
              density="adaptive"
              onClick={() => runtime?.reset(selected.id)}
            >
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              <Trans comment="恢复选中模型在最近一次自动布局中的位置。">
                重置位置
              </Trans>
            </Button>
          </div>
          <FieldGroup className="grid grid-cols-3 gap-2">
            {(["X", "Y", "Z"] as const).map((axis, index) => (
              <Field key={`${selected.id}-${axis}`}>
                <FieldLabel htmlFor={`${id}-${axis}`}>{axis}</FieldLabel>
                <Input
                  id={`${id}-${axis}`}
                  type="number"
                  step="any"
                  min={-10000}
                  max={10000}
                  key={`${selected.id}-${axis}-${selected.position[index]}`}
                  defaultValue={Number(selected.position[index].toFixed(3))}
                  onBlur={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    if (
                      event.currentTarget.value &&
                      Number.isFinite(value) &&
                      Math.abs(value) <= 10000
                    ) {
                      const position = [...selected.position];
                      position[index] = value;
                      runtime?.move(selected.id, position);
                    } else
                      event.currentTarget.value = String(
                        Number(selected.position[index].toFixed(3)),
                      );
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </Field>
            ))}
          </FieldGroup>
          <FieldDescription>
            <Trans>
              坐标用于预览摆放，不改变源模型尺寸。摆放模式可拖动模型，Esc
              退出；也可直接输入坐标。
            </Trans>
          </FieldDescription>
        </div>
      ) : null}
      <p className="text-muted-foreground text-xs">
        <Trans>导入会追加模型。隐藏保留资源，移除不会删除源文件。</Trans>
      </p>
    </div>
  );
}
