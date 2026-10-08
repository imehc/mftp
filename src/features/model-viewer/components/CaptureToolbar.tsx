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
import { RecordingExport } from "./RecordingExport";
import { ScreenshotExport } from "./ScreenshotExport";

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
  if (!name && recording.status === "idle") return null;
  return (
    <div
      role="group"
      aria-label={t({
        message: "截图与录屏",
        comment: "三维查看器侧栏的导出操作区。",
      })}
      className="flex min-w-0 flex-wrap items-start gap-2 rounded-xl border p-2"
    >
      {name ? (
        <ScreenshotExport
          runtime={runtime}
          name={name}
          disabled={disabled}
          compact
        />
      ) : null}
      <RecordingExport
        runtime={runtime}
        name={name}
        disabled={disabled}
        compact
      />
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
        <PopoverContent align="end" className="max-w-[calc(100vw-2rem)]">
          <p>
            <Trans>PNG · 透明背景 · 不含工具面板</Trans>
          </p>
          <p>
            <Trans>最长 60 秒 · 黑色背景 · 无音频 · 不含工具面板</Trans>
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
