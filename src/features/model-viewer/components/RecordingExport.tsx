import { Trans, useLingui } from "@lingui/react/macro";
import { Circle, Share2, Square } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { describeError } from "~/lib/errors";
import { isTauriRuntime } from "~/lib/files";
import { formatBytes } from "~/lib/format";
import { isMobilePlatform } from "~/lib/platform";

import type { ModelViewerRuntime } from "../runtime/viewer";

export function RecordingExport({
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
  const { t, i18n } = useLingui();
  const recording = runtime.recording;
  const state = useSyncExternalStore(recording.subscribe, recording.snapshot);
  const native = isTauriRuntime();
  const busy = ["starting", "stopping", "saving"].includes(state.status);
  const seconds = new Intl.NumberFormat(i18n.locale).format(state.seconds);
  const size = state.result ? formatBytes(state.result.blob.size) : "";
  const mobile = native && isMobilePlatform();
  if (!name && state.status === "idle") return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {state.result ? (
          <>
            <Button
              density="adaptive"
              variant="outline"
              disabled={busy}
              onClick={() => void recording.save()}
            >
              {state.status === "saving" ? (
                <Trans comment="正在通过文件保存或系统分享导出模型录屏。">
                  正在导出录屏…
                </Trans>
              ) : native ? (
                <Trans comment="保存已经生成的模型视口视频。">保存录屏</Trans>
              ) : (
                <Trans comment="通过浏览器下载已经生成的模型视口视频。">
                  下载录屏
                </Trans>
              )}
            </Button>
            {mobile ? (
              <Button
                density="adaptive"
                variant="outline"
                disabled={busy}
                onClick={() => void recording.save("share")}
              >
                <Share2 data-icon="inline-start" aria-hidden="true" />
                <Trans comment="通过移动系统分享面板分享已经生成的模型视口视频。">
                  分享录屏
                </Trans>
              </Button>
            ) : null}
            <Button
              density="adaptive"
              variant="ghost"
              disabled={busy}
              onClick={() => recording.discard()}
            >
              <Trans comment="丢弃本次录屏的内存副本，不删除已经保存的文件。">
                清除本次录屏
              </Trans>
            </Button>
            <span className="text-muted-foreground text-xs">
              {state.result.width} × {state.result.height} · {size}
            </span>
          </>
        ) : state.status === "recording" || state.status === "starting" ? (
          <Button
            density="adaptive"
            variant="outline"
            onClick={() => void recording.stop()}
          >
            <Square data-icon="inline-start" aria-hidden="true" />
            <Trans comment="结束模型视口录制并生成待保存视频。">停止录屏</Trans>
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                density="adaptive"
                variant="outline"
                size={compact ? "icon" : "default"}
                disabled={disabled || busy}
                aria-busy={busy}
                onClick={() =>
                  void recording.start(
                    runtime.renderer.domElement.width,
                    runtime.renderer.domElement.height,
                    name,
                  )
                }
              >
                <Circle data-icon="inline-start" aria-hidden="true" />
                <span className={compact ? "sr-only" : undefined}>
                  {state.status === "stopping" ? (
                    <Trans comment="正在等待编码完成并生成模型录屏文件。">
                      正在生成录屏…
                    </Trans>
                  ) : (
                    <Trans comment="开始录制三维场景的当前视口，不录制麦克风或其他应用。">
                      录制视口
                    </Trans>
                  )}
                </span>
              </Button>
            </TooltipTrigger>
            {compact ? (
              <TooltipContent>
                <Trans comment="开始录制三维场景的当前视口，不录制麦克风或其他应用。">
                  录制视口
                </Trans>
              </TooltipContent>
            ) : null}
          </Tooltip>
        )}
        {!compact ? (
          <p className="text-muted-foreground text-xs">
            <Trans>最长 60 秒 · 黑色背景 · 无音频 · 不含工具面板</Trans>
          </p>
        ) : null}
      </div>
      <p
        role="status"
        aria-atomic="true"
        className="text-muted-foreground text-sm empty:hidden"
      >
        {state.status === "starting" ? (
          <Trans>正在准备录屏编码器…</Trans>
        ) : state.status === "recording" ? (
          <Trans comment="seconds 是当前模型视口已录制的秒数。">
            正在录制：{seconds} 秒
          </Trans>
        ) : state.result ? (
          state.shared ? (
            <Trans>已打开系统分享，请在目标应用中确认。</Trans>
          ) : state.saved ? (
            native ? (
              <Trans>录屏已保存。</Trans>
            ) : (
              <Trans>已发起录屏下载，请在浏览器中查看。</Trans>
            )
          ) : (
            <Trans>录屏已生成。保存前请留在此页面。</Trans>
          )
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
