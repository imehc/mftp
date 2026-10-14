import { Trans, useLingui } from "@lingui/react/macro";
import { Camera, Share2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
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

export function useScreenshotExport({
  runtime,
  name,
  disabled,
}: {
  runtime: ModelViewerRuntime;
  name: string;
  disabled: boolean;
}) {
  const { t } = useLingui();
  const [controller] = useState(() => new ExportController());
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const available = !!name;
  useEffect(() => controller.cancel, [controller, runtime, available]);
  const native = isTauriRuntime();
  const mobile = native && isMobilePlatform();
  const busy = state.status === "busy";
  const previous = useRef(state.status);
  useEffect(() => {
    if (previous.current === state.status) return;
    previous.current = state.status;
    // 完成、分享与取消都是一次性结果，用提示反馈，不长期占用导出区。
    if (state.status === "saved") {
      toast.success(
        native ? t`截图已保存。` : t`已发起截图下载，请在浏览器中查看。`,
      );
    } else if (state.status === "shared") {
      toast.success(t`已打开系统分享，请在目标应用中确认。`);
    } else if (state.status === "cancelled") {
      toast.info(t`已取消截图导出。`);
    }
  }, [state.status, native, t]);
  const label = busy ? (
    <Trans comment="模型截图正在编码或等待保存对话框完成。">
      正在导出截图…
    </Trans>
  ) : native ? (
    <Trans comment="将三维场景的当前视角保存为本地 PNG 文件。">保存截图</Trans>
  ) : (
    <Trans comment="通过浏览器下载三维场景的 PNG 截图。">下载截图</Trans>
  );
  const action = (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            density="adaptive"
            size="icon"
            variant="outline"
            disabled={disabled || busy || !available}
            aria-busy={busy}
            onClick={() =>
              void controller.save(() => runtime.screenshot(), name)
            }
          >
            {busy ? (
              <Spinner aria-hidden="true" />
            ) : (
              <Camera aria-hidden="true" />
            )}
            <span className="sr-only">{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {mobile ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              density="adaptive"
              variant="outline"
              size="icon"
              disabled={disabled || busy || !available}
              onClick={() =>
                void controller.save(() => runtime.screenshot(), name, "share")
              }
            >
              <Share2 aria-hidden="true" />
              <span className="sr-only">
                <Trans comment="通过移动系统分享面板分享模型视口 PNG 截图。">
                  分享截图
                </Trans>
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <Trans comment="通过移动系统分享面板分享模型视口 PNG 截图。">
              分享截图
            </Trans>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </>
  );
  const feedback =
    available && (busy || state.error) ? (
      <div className="flex min-w-0 flex-col gap-2 wrap-anywhere">
        {busy ? (
          <p
            role="status"
            className="text-muted-foreground text-sm empty:hidden"
          >
            <Trans comment="模型截图正在编码或等待保存对话框完成。">
              正在导出截图…
            </Trans>
          </p>
        ) : null}
        {state.error ? (
          <Alert variant="destructive">
            <AlertDescription>{describeError(state.error, t)}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    ) : null;
  return { action, feedback };
}
