import { Trans, useLingui } from "@lingui/react/macro";
import { Info } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

import type { ModelViewerRuntime } from "../runtime/viewer";
import { useRecordingExport } from "./RecordingExport";
import { useScreenshotExport } from "./ScreenshotExport";

export function CaptureToolbar({
  runtime,
  name,
  disabled,
}: {
  runtime: ModelViewerRuntime;
  name: string;
  disabled: boolean;
}) {
  const { t } = useLingui();
  const recording = useSyncExternalStore(
    runtime.recording.subscribe,
    runtime.recording.snapshot,
  );
  const screenshot = useScreenshotExport({ runtime, name, disabled });
  const video = useRecordingExport({ runtime, name, disabled, compact: true });
  if (!name && recording.status === "idle") return null;
  return (
    <div
      role="group"
      aria-label={t({
        message: "截图与录屏",
        comment: "三维查看器侧栏的导出操作区。",
      })}
      className="flex min-w-0 flex-col gap-3 rounded-xl border p-3"
    >
      {/* 入口行保持固定顺序与尺寸：左起截图、录屏及后续操作，说明固定在最右。 */}
      <div
        data-slot="capture-actions"
        className="flex min-w-0 items-center justify-between gap-2"
      >
        <div className="flex min-w-0 items-center gap-2">
          {screenshot.action}
          {video.action}
          {video.secondary}
        </div>
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  density="adaptive"
                  variant="ghost"
                  size="icon"
                  aria-label={t({
                    message: "导出说明",
                    comment: "打开三维截图与录屏的格式和限制说明。",
                  })}
                >
                  <Info aria-hidden="true" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <Trans comment="打开三维截图与录屏的格式和限制说明。">
                导出说明
              </Trans>
            </TooltipContent>
          </Tooltip>
          <PopoverContent
            align="end"
            className="ui-density-adaptive flex max-w-[calc(100vw-2rem)] flex-col gap-3"
          >
            <p>
              <Trans>PNG · 透明背景 · 不含工具面板</Trans>
            </p>
            <p>
              <Trans>最长 60 秒 · 黑色背景 · 无音频 · 不含工具面板</Trans>
            </p>
          </PopoverContent>
        </Popover>
      </div>
      {screenshot.feedback}
      {video.feedback}
      {video.error}
    </div>
  );
}
