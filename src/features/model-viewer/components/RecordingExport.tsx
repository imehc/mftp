import { Trans, useLingui } from "@lingui/react/macro";
import { Circle, Download, Share2, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
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
import { formatBytes } from "~/lib/format";
import { isMobilePlatform } from "~/lib/platform";

import type { ModelViewerRuntime } from "../runtime/viewer";

type RecordingExportProps = {
  runtime: ModelViewerRuntime;
  name: string;
  disabled: boolean;
  compact?: boolean;
};

export function useRecordingExport({
  runtime,
  name,
  disabled,
  compact = false,
}: RecordingExportProps) {
  const { t, i18n } = useLingui();
  const recording = runtime.recording;
  const state = useSyncExternalStore(recording.subscribe, recording.snapshot);
  const native = isTauriRuntime();
  const busy = ["starting", "stopping", "saving"].includes(state.status);
  const canStop = state.status === "recording" || state.status === "starting";
  const seconds = new Intl.NumberFormat(i18n.locale).format(state.seconds);
  const result = state.result;
  const mobile = native && isMobilePlatform();
  // 录屏结果只存在于内存：生成与保存结果用提示反馈，按钮仍留在入口行。
  const announced = useRef({
    blob: null as Blob | null,
    saved: false,
    shared: false,
  });
  useEffect(() => {
    if (!result?.blob) {
      announced.current = { blob: null, saved: false, shared: false };
      return;
    }
    const previous = announced.current;
    announced.current = {
      blob: result.blob,
      saved: state.saved,
      shared: state.shared,
    };
    if (previous.blob !== result.blob) {
      toast.success(t`录屏已生成。保存前请留在此页面。`, {
        description: `${result.width} × ${result.height} · ${formatBytes(result.blob.size)}`,
        duration: 8000,
      });
      return;
    }
    if (state.shared && !previous.shared) {
      toast.success(t`已打开系统分享，请在目标应用中确认。`);
    } else if (state.saved && !previous.saved) {
      toast.success(
        native ? t`录屏已保存。` : t`已发起录屏下载，请在浏览器中查看。`,
      );
    }
  }, [result, state.saved, state.shared, native, t]);
  const label =
    state.status === "saving" ? (
      <Trans comment="正在通过文件保存或系统分享导出模型录屏。">
        正在导出录屏…
      </Trans>
    ) : state.status === "stopping" ? (
      <Trans comment="正在等待编码完成并生成模型录屏文件。">
        正在生成录屏…
      </Trans>
    ) : result ? (
      native ? (
        <Trans comment="保存已经生成的模型视口视频。">保存录屏</Trans>
      ) : (
        <Trans comment="通过浏览器下载已经生成的模型视口视频。">下载录屏</Trans>
      )
    ) : canStop ? (
      <Trans comment="结束模型视口录制并生成待保存视频。">停止录屏</Trans>
    ) : (
      <Trans comment="开始录制三维场景的当前视口，不录制麦克风或其他应用。">
        录制视口
      </Trans>
    );
  const action = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          density="adaptive"
          variant="outline"
          size={compact ? "icon" : "default"}
          disabled={!canStop && (busy || (!result && (disabled || !name)))}
          aria-busy={busy}
          onClick={() => {
            if (canStop) void recording.stop();
            else if (result) void recording.save();
            else
              void recording.start(
                runtime.renderer.domElement.width,
                runtime.renderer.domElement.height,
                name,
              );
          }}
        >
          {busy && !canStop ? (
            <Spinner aria-hidden="true" />
          ) : canStop ? (
            <Square aria-hidden="true" />
          ) : result ? (
            <Download aria-hidden="true" />
          ) : (
            <Circle aria-hidden="true" />
          )}
          <span className={compact ? "sr-only" : undefined}>{label}</span>
        </Button>
      </TooltipTrigger>
      {compact ? <TooltipContent>{label}</TooltipContent> : null}
    </Tooltip>
  );
  const secondary = (
    <>
      {result && mobile ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              density="adaptive"
              variant="outline"
              size="icon"
              disabled={busy}
              onClick={() => void recording.save("share")}
            >
              <Share2 aria-hidden="true" />
              <span className="sr-only">
                <Trans comment="通过移动系统分享面板分享已经生成的模型视口视频。">
                  分享录屏
                </Trans>
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <Trans comment="通过移动系统分享面板分享已经生成的模型视口视频。">
              分享录屏
            </Trans>
          </TooltipContent>
        </Tooltip>
      ) : null}
      {result ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              density="adaptive"
              variant="ghost"
              size="icon"
              disabled={busy}
              onClick={() => recording.discard()}
            >
              <Trash2 aria-hidden="true" />
              <span className="sr-only">
                <Trans comment="丢弃本次录屏的内存副本，不删除已经保存的文件。">
                  清除本次录屏
                </Trans>
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <Trans comment="丢弃本次录屏的内存副本，不删除已经保存的文件。">
              清除本次录屏
            </Trans>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </>
  );
  const feedback =
    state.status !== "idle" && !result ? (
      <div className="flex min-w-0 flex-col gap-2 wrap-anywhere">
        <p
          role="status"
          aria-atomic="true"
          className="text-muted-foreground text-sm tabular-nums empty:hidden"
        >
          {state.status === "starting" ? (
            <Trans>正在准备录屏编码器…</Trans>
          ) : state.status === "recording" ? (
            <Trans comment="seconds 是当前模型视口已录制的秒数。">
              正在录制：{seconds} 秒
            </Trans>
          ) : state.status === "stopping" ? (
            <Trans comment="正在等待编码完成并生成模型录屏文件。">
              正在生成录屏…
            </Trans>
          ) : state.status === "saving" ? (
            <Trans comment="正在通过文件保存或系统分享导出模型录屏。">
              正在导出录屏…
            </Trans>
          ) : null}
        </p>
      </div>
    ) : null;
  const error = state.error ? (
    <Alert variant="destructive">
      <AlertDescription>{describeError(state.error, t)}</AlertDescription>
    </Alert>
  ) : null;
  return { action, secondary, feedback, error };
}

export function RecordingExport(props: RecordingExportProps) {
  const { action, secondary, feedback, error } = useRecordingExport(props);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {action}
        {secondary}
      </div>
      {!props.compact ? (
        <p className="app-description">
          <Trans>最长 60 秒 · 黑色背景 · 无音频 · 不含工具面板</Trans>
        </p>
      ) : null}
      {feedback}
      {error}
    </div>
  );
}
