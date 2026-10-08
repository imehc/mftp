import { Trans, useLingui } from "@lingui/react/macro";
import { Camera, Share2 } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { describeError } from "~/lib/errors";
import { isTauriRuntime } from "~/lib/files";
import { isMobilePlatform } from "~/lib/platform";

import { ScreenshotExport as ExportController } from "../export/screenshot";
import type { ModelViewerRuntime } from "../runtime/viewer";

export function ScreenshotExport({
  runtime,
  name,
  disabled,
  compact = false,
}: {
  runtime: ModelViewerRuntime;
  name: string;
  disabled: boolean;
  compact?: boolean;
}) {
  const { t } = useLingui();
  const [controller] = useState(() => new ExportController());
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => controller.cancel, [controller, runtime]);
  const native = isTauriRuntime();
  const mobile = native && isMobilePlatform();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              density="adaptive"
              size={compact ? "icon" : "default"}
              variant="outline"
              disabled={disabled || state.status === "busy"}
              aria-busy={state.status === "busy"}
              onClick={() =>
                void controller.save(() => runtime.screenshot(), name)
              }
            >
              <Camera data-icon="inline-start" aria-hidden="true" />
              <span className={compact ? "sr-only" : undefined}>
                {state.status === "busy" ? (
                  <Trans comment="模型截图正在编码或等待保存对话框完成。">
                    正在导出截图…
                  </Trans>
                ) : native ? (
                  <Trans comment="将三维场景的当前视角保存为本地 PNG 文件。">
                    保存截图
                  </Trans>
                ) : (
                  <Trans comment="通过浏览器下载三维场景的 PNG 截图。">
                    下载截图
                  </Trans>
                )}
              </span>
            </Button>
          </TooltipTrigger>
          {compact ? (
            <TooltipContent>
              {native ? (
                <Trans comment="将三维场景的当前视角保存为本地 PNG 文件。">
                  保存截图
                </Trans>
              ) : (
                <Trans comment="通过浏览器下载三维场景的 PNG 截图。">
                  下载截图
                </Trans>
              )}
            </TooltipContent>
          ) : null}
        </Tooltip>
        {mobile ? (
          <Button
            density="adaptive"
            variant="outline"
            disabled={disabled || state.status === "busy"}
            onClick={() =>
              void controller.save(() => runtime.screenshot(), name, "share")
            }
          >
            <Share2 data-icon="inline-start" aria-hidden="true" />
            <Trans comment="通过移动系统分享面板分享模型视口 PNG 截图。">
              分享截图
            </Trans>
          </Button>
        ) : null}
        {!compact ? (
          <p className="text-muted-foreground text-xs">
            <Trans>PNG · 透明背景 · 不含工具面板</Trans>
          </p>
        ) : null}
      </div>
      <p role="status" className="text-muted-foreground text-sm empty:hidden">
        {state.status === "saved" ? (
          native ? (
            <Trans>截图已保存。</Trans>
          ) : (
            <Trans>已发起截图下载，请在浏览器中查看。</Trans>
          )
        ) : state.status === "shared" ? (
          <Trans>已打开系统分享，请在目标应用中确认。</Trans>
        ) : state.status === "cancelled" ? (
          <Trans>已取消截图导出。</Trans>
        ) : null}
      </p>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{describeError(state.error, t)}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
