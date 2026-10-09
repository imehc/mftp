import { Trans } from "@lingui/react/macro";
import { useSyncExternalStore } from "react";

import { Button } from "~/components/ui/button";
import { isMobilePlatform } from "~/lib/platform";

import type { ModelViewerRuntime } from "../runtime/viewer";

export function RuntimeControls({
  runtime,
  onCanvas,
}: {
  runtime: ModelViewerRuntime;
  onCanvas: () => void;
}) {
  const phase = useSyncExternalStore(
    runtime.motion.subscribe,
    runtime.motion.snapshot,
  );
  const budget = useSyncExternalStore(
    runtime.budget.subscribe,
    runtime.budget.snapshot,
  );
  const { frameMs, workMs } = budget;
  return (
    <>
      {isMobilePlatform() ? (
        <>
          <Button
            variant="outline"
            density="adaptive"
            disabled={phase === "requesting"}
            onClick={() => {
              if (phase === "active") runtime.motion.stop();
              else {
                runtime.setMode("orbit");
                onCanvas();
                runtime.setInteractive(true);
                void runtime.motion.start();
              }
            }}
          >
            {phase === "active" ? (
              <Trans>停止陀螺仪控制</Trans>
            ) : phase === "requesting" ? (
              <Trans>正在连接方向传感器…</Trans>
            ) : (
              <Trans>启用陀螺仪控制</Trans>
            )}
          </Button>
          <p role="status" className="text-muted-foreground text-xs">
            {phase === "denied" ? (
              <Trans>未获得方向传感器权限，可继续手动操作。</Trans>
            ) : phase === "unsupported" ? (
              <Trans>当前设备未提供方向传感器，可继续手动操作。</Trans>
            ) : (
              <Trans>
                从当前视角开始转动设备。触碰画布、打开面板或进入后台会停止控制。
              </Trans>
            )}
          </p>
        </>
      ) : null}
      <details className="text-muted-foreground text-sm">
        <summary
          data-slot="touch-label"
          className="min-h-8 cursor-pointer content-center py-1"
        >
          <Trans>渲染与设备状态</Trans>
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <p>
            {budget.level === 0 ? (
              <Trans>标准画质 · 像素比例上限 2</Trans>
            ) : budget.level === 1 ? (
              <Trans>节能画质 · 像素比例上限 1.5 · 最高 30 帧/秒</Trans>
            ) : (
              <Trans>低负载画质 · 像素比例上限 1 · 最高 20 帧/秒</Trans>
            )}
          </p>
          <p>
            {budget.thermal === "unknown" ? (
              <Trans>系统热状态：当前平台不提供</Trans>
            ) : budget.thermal === "nominal" ? (
              <Trans>系统热状态：正常</Trans>
            ) : budget.thermal === "fair" ? (
              <Trans>系统热状态：轻度升高</Trans>
            ) : budget.thermal === "serious" ? (
              <Trans>系统热状态：较高</Trans>
            ) : (
              <Trans>系统热状态：严重</Trans>
            )}
          </p>
          {budget.frameMs > 0 ? (
            <p>
              <Trans>
                采样帧间隔 {frameMs} ms · 渲染提交耗时 {workMs} ms
              </Trans>
            </p>
          ) : (
            <p>
              <Trans>连续渲染后显示采样数据。</Trans>
            </p>
          )}
          <p className="text-xs">
            <Trans>
              持续慢帧或系统热状态升高时自动降级，稳定后逐步恢复。耗时来自应用采样，不代表
              GPU 时间或设备温度。
            </Trans>
          </p>
        </div>
      </details>
    </>
  );
}
