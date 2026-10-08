import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDown, ChevronUp, Pause, Play, Square } from "lucide-react";
import { useId, useState, useSyncExternalStore } from "react";

import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Slider } from "~/components/ui/slider";

import type { LoopMode, ModelAnimation } from "../runtime/animation";

export function AnimationBar({
  animation,
  disabled,
}: {
  animation: ModelAnimation;
  disabled: boolean;
}) {
  const { t, i18n } = useLingui();
  const state = useSyncExternalStore(animation.subscribe, animation.snapshot);
  const id = useId();
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const seconds = new Intl.NumberFormat(i18n.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const clipLabel = (name: string, index: number) => {
    const number = index + 1;
    if (!name)
      return t({
        message: `片段 ${number}`,
        comment: "无名称的模型动画片段，number 从 1 开始。",
      });
    return state.clips.filter((clip) => clip.name === name).length > 1
      ? `${name} (${number})`
      : name;
  };

  const loops: { value: LoopMode; label: string }[] = [
    {
      value: "once",
      label: t({
        message: "单次",
        comment: "模型动画循环模式：播放一次后停在末帧。",
      }),
    },
    {
      value: "repeat",
      label: t({ message: "重复", comment: "模型动画从头反复播放。" }),
    },
    {
      value: "pingpong",
      label: t({ message: "往返", comment: "模型动画交替正向和反向播放。" }),
    },
  ];
  const duration = seconds.format(state.duration);
  return (
    <section
      aria-label={t({
        message: "模型动画",
        comment: "三维查看器的动画控制区域名称。",
      })}
      className="flex min-w-0 flex-col gap-3 rounded-xl border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">
          <Trans comment="三维模型动画控制条标题。">动画</Trans>
        </h2>
        {state.clips.length ? (
          <Button
            variant="ghost"
            density="adaptive"
            size="icon-sm"
            className="md:hidden"
            aria-expanded={!collapsed}
            aria-controls={`${id}-controls`}
            aria-label={t({
              message: "展开或收起动画控制",
              comment: "移动端动画条折叠按钮。",
            })}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronDown aria-hidden="true" />
            ) : (
              <ChevronUp aria-hidden="true" />
            )}
          </Button>
        ) : null}
      </div>
      {!state.clips.length ? (
        <p className="text-muted-foreground text-sm">
          <Trans>此模型不包含动画</Trans>
        </p>
      ) : (
        <div
          id={`${id}-controls`}
          className={
            collapsed
              ? "hidden md:flex md:flex-col md:gap-3"
              : "flex flex-col gap-3"
          }
        >
          <FieldGroup className="flex flex-row flex-wrap items-end gap-3">
            <Field className="min-w-0 flex-[2_1_10rem]">
              <FieldLabel htmlFor={`${id}-clip`}>
                <Trans comment="选择一个三维模型动画片段。">动画片段</Trans>
              </FieldLabel>
              <Select
                value={String(state.selected)}
                disabled={disabled}
                onValueChange={(value) => {
                  animation.select(Number(value));
                  setDraft(null);
                  const clipName = clipLabel(
                    state.clips[Number(value)].name,
                    Number(value),
                  );
                  setAnnouncement(
                    t({
                      message: `已选择 ${clipName}`,
                      comment:
                        "切换模型动画后的通知，clipName 为动画片段名称。",
                    }),
                  );
                }}
              >
                <SelectTrigger
                  id={`${id}-clip`}
                  density="adaptive"
                  className="w-full min-w-0"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="max-w-[calc(100vw-2rem)]"
                >
                  <SelectGroup>
                    {state.clips.map((clip, index) => (
                      <SelectItem
                        key={index}
                        value={String(index)}
                        className="min-h-11 md:min-h-8"
                      >
                        <span className="truncate">
                          {clipLabel(clip.name, index)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <div className="flex gap-2">
              <Button
                density="adaptive"
                disabled={disabled || !state.duration}
                onClick={() => {
                  if (state.playing) {
                    animation.pause();
                    setAnnouncement(
                      t({
                        message: "动画已暂停",
                        comment: "模型动画状态通知。",
                      }),
                    );
                  } else {
                    animation.play();
                    setAnnouncement(
                      t({
                        message: "动画正在播放",
                        comment: "模型动画状态通知。",
                      }),
                    );
                  }
                }}
              >
                {state.playing ? (
                  <Pause data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <Play data-icon="inline-start" aria-hidden="true" />
                )}
                {state.playing ? (
                  <Trans comment="暂停模型动画。">暂停</Trans>
                ) : (
                  <Trans comment="播放模型动画。">播放</Trans>
                )}
              </Button>
              <Button
                variant="outline"
                density="adaptive"
                disabled={disabled || !state.duration}
                onClick={() => {
                  animation.stop();
                  setDraft(null);
                  setAnnouncement(
                    t({
                      message: "动画已停止并归零",
                      comment: "模型动画停止后的状态通知。",
                    }),
                  );
                }}
              >
                <Square data-icon="inline-start" aria-hidden="true" />
                <Trans comment="停止模型动画并回到片段起点。">停止</Trans>
              </Button>
            </div>
            <Field className="min-w-0 flex-[1_1_6rem]">
              <FieldLabel htmlFor={`${id}-loop`}>
                <Trans comment="模型动画的循环播放方式。">循环模式</Trans>
              </FieldLabel>
              <Select
                value={state.loop}
                disabled={disabled || !state.duration}
                onValueChange={(value) => animation.setLoop(value as LoopMode)}
              >
                <SelectTrigger
                  id={`${id}-loop`}
                  density="adaptive"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {loops.map((loop) => (
                      <SelectItem
                        className="min-h-11 md:min-h-8"
                        key={loop.value}
                        value={loop.value}
                      >
                        {loop.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field className="min-w-0 flex-[1_1_5rem]">
              <FieldLabel htmlFor={`${id}-speed`}>
                <Trans comment="模型动画播放速度倍率。">播放速度</Trans>
              </FieldLabel>
              <Select
                value={String(state.speed)}
                disabled={disabled || !state.duration}
                onValueChange={(value) => animation.setSpeed(Number(value))}
              >
                <SelectTrigger
                  id={`${id}-speed`}
                  density="adaptive"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {[0.25, 0.5, 1, 1.5, 2].map((speed) => (
                      <SelectItem
                        className="min-h-11 md:min-h-8"
                        key={speed}
                        value={String(speed)}
                      >
                        {i18n.number(speed)}×
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <Slider
            min={0}
            max={state.duration || 1}
            step={Math.min(0.01, state.duration / 1000 || 0.01)}
            value={[state.time]}
            disabled={disabled || !state.duration}
            className="min-h-11"
            aria-label={t({
              message: "动画时间轴（秒）",
              comment: "拖动或用方向键、Home、End 定位动画。",
            })}
            onPointerDownCapture={() => animation.beginScrub()}
            onPointerUp={() => animation.endScrub()}
            onPointerCancel={() => animation.endScrub()}
            onLostPointerCapture={() => animation.endScrub()}
            onBlur={() => animation.endScrub()}
            onValueChange={([time]) => animation.seek(time)}
            onValueCommit={() => animation.endScrub()}
          />
          <FieldGroup className="flex flex-row flex-wrap items-end gap-3">
            <Field className="w-32">
              <FieldLabel htmlFor={`${id}-time`}>
                <Trans comment="可输入的模型动画时间，单位秒。">
                  时间（秒）
                </Trans>
              </FieldLabel>
              <Input
                id={`${id}-time`}
                type="number"
                inputMode="decimal"
                min={0}
                max={state.duration}
                step="0.01"
                disabled={disabled || !state.duration}
                className="min-h-11 md:min-h-8"
                value={draft ?? state.time.toFixed(2)}
                onFocus={(event) => {
                  setDraft(state.time.toFixed(2));
                  animation.beginScrub();
                  event.currentTarget.select();
                }}
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (event.target.value !== "")
                    animation.seek(Number(event.target.value));
                }}
                onBlur={() => {
                  setDraft(null);
                  animation.endScrub();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </Field>
            <p className="text-muted-foreground pb-2 text-xs tabular-nums">
              <Trans comment="当前动画片段总时长，duration 是本地化秒数。">
                总时长 {duration} 秒
              </Trans>
            </p>
          </FieldGroup>
          {!state.duration ? (
            <p className="text-muted-foreground text-xs">
              <Trans>此片段时长为零，仅显示静态姿态。</Trans>
            </p>
          ) : null}
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
