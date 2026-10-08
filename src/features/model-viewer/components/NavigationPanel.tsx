import { Trans, useLingui } from "@lingui/react/macro";
import { useState, useSyncExternalStore } from "react";

import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";

import type { InteractionMode } from "../inspection/tools";
import type { ModelViewerRuntime } from "../runtime/viewer";
import {
  InspectionChoice,
  InspectionRange,
  InspectionToggle,
} from "./InspectionFields";

export function NavigationPanel({
  runtime,
  onCanvas,
}: {
  runtime: ModelViewerRuntime;
  onCanvas: () => void;
}) {
  const { t } = useLingui();
  const state = useSyncExternalStore(
    runtime.tools.subscribe,
    runtime.tools.snapshot,
  );
  const [speed, setSpeed] = useState(runtime.flight.speed);
  const [name, setName] = useState("");
  return (
    <FieldGroup>
      <InspectionChoice
        label={t({
          message: "交互模式",
          comment: "3D 画布的轨道、自由移动、测量、摆放模式。",
        })}
        value={state.mode}
        onChange={(v) => {
          runtime.setMode(v as InteractionMode);
          onCanvas();
        }}
        options={[
          {
            value: "orbit",
            label: t({
              message: "轨道查看",
              comment: "围绕目标旋转三维相机。",
            }),
          },
          {
            value: "fly",
            label: t({
              message: "自由移动",
              comment: "第一人称飞行相机，无碰撞和重力。",
            }),
          },
          {
            value: "measure",
            label: t({
              message: "两点测量",
              comment: "在当前三维模型表面拾取两点测量距离。",
            }),
          },
          {
            value: "place",
            label: t({
              message: "摆放模型",
              comment: "进入拖动三维模型的交互模式。",
            }),
          },
        ]}
      />
      <InspectionRange
        label={t({
          message: "移动速度",
          comment: "自由相机在归一化预览空间内每秒的移动速度。",
        })}
        value={speed}
        min={0.1}
        max={10}
        step={0.1}
        onChange={(v) => {
          runtime.flight.setSpeed(v);
          setSpeed(v);
        }}
      />
      <InspectionToggle
        label={
          <Trans comment="三维相机自动绕目标旋转，可关闭。">自动旋转</Trans>
        }
        checked={state.autoRotate}
        onChange={(v) => runtime.setAutoRotate(v)}
      />
      <Field>
        <FieldLabel htmlFor="model-view-name">
          <Trans comment="用户为本次会话保存的相机位置命名。">视角名称</Trans>
        </FieldLabel>
        <Input
          id="model-view-name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Button
        density="adaptive"
        variant="outline"
        disabled={!name.trim() || state.views.length >= 20}
        onClick={() => {
          runtime.saveView(name);
          setName("");
        }}
      >
        <Trans comment="保存当前三维相机位置，仅当前会话有效。">
          保存当前视角
        </Trans>
      </Button>
      <p className="text-muted-foreground text-xs">
        <Trans>视角仅在本次会话保留。</Trans>
      </p>
      {state.views.map(({ id, name }) => (
        <div key={id} className="flex min-w-0 items-center gap-2">
          <Button
            density="adaptive"
            variant="outline"
            className="min-w-0 flex-1"
            onClick={() => runtime.restoreView(id)}
          >
            <span className="truncate">{name}</span>
          </Button>
          <Button
            density="adaptive"
            variant="ghost"
            onClick={() => runtime.tools.removeView(id)}
            aria-label={t({
              message: `移除视角 ${name}`,
              comment: "删除用户命名的会话相机视角。",
            })}
          >
            <Trans comment="移除当前保存的三维相机视角。">移除</Trans>
          </Button>
        </div>
      ))}
    </FieldGroup>
  );
}
