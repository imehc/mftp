import { lazy, Suspense, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import { LoaderCircle } from "lucide-react";
import AppPageLayout from "~/components/AppPageLayout";
import { MediaProcessingGuard } from "./MediaProcessingGuard";
import { CompressModeTabs } from "~/features/media-compress/components/CompressModeTabs";
import type { CompressModeId } from "~/features/media-compress/types";
const ImageCompressPanel = lazy(
  () => import("~/features/media-compress/image/ImageCompressPanel"),
);
const ImageResizePanel = lazy(
  () => import("~/features/media-compress/resize/ImageResizePanel"),
);
const VideoCompressPanel = lazy(
  () => import("~/features/media-compress/video/VideoCompressPanel"),
);
interface MediaCompressToolProps {
  mode: CompressModeId;
}
export default function MediaCompressTool({ mode }: MediaCompressToolProps) {
  const navigate = useNavigate();
  const [visitedModes, setVisitedModes] = useState<Set<CompressModeId>>(
    () => new Set([mode]),
  );
  // 在渲染期间记录已访问的模式（React 的“在 prop 变化时调整 state”
  // 模式），而不是用 effect。
  const [prevMode, setPrevMode] = useState(mode);
  if (prevMode !== mode) {
    setPrevMode(mode);
    setVisitedModes((current) => {
      if (current.has(mode)) return current;
      const next = new Set(current);
      next.add(mode);
      return next;
    });
  }
  return (
    <MediaProcessingGuard>
      <AppPageLayout
        title={<Trans>媒体处理</Trans>}
        adaptiveDensity
        bottomInset="scroll"
        contentClassName="flex flex-col gap-3"
      >
        <CompressModeTabs
          value={mode}
          onChange={(next) => {
            void navigate({
              to: "/tools/media-compress",
              search: {
                mode: next,
              },
              replace: true,
            });
          }}
        />

        <Suspense
          fallback={
            <div className="border-border bg-card text-muted-foreground flex min-h-40 items-center justify-center gap-2 rounded-lg border text-sm">
              <LoaderCircle className="animate-spin" />
              <Trans>正在加载处理工具…</Trans>
            </div>
          }
        >
          {visitedModes.has("image") ? (
            <div
              role="tabpanel"
              id="media-panel-image"
              aria-labelledby="media-tab-image"
              tabIndex={0}
              hidden={mode !== "image"}
            >
              <ImageCompressPanel />
            </div>
          ) : null}
          {visitedModes.has("video") ? (
            <div
              role="tabpanel"
              id="media-panel-video"
              aria-labelledby="media-tab-video"
              tabIndex={0}
              hidden={mode !== "video"}
            >
              <VideoCompressPanel />
            </div>
          ) : null}
          {visitedModes.has("resize") ? (
            <div
              role="tabpanel"
              id="media-panel-resize"
              aria-labelledby="media-tab-resize"
              tabIndex={0}
              hidden={mode !== "resize"}
            >
              <ImageResizePanel />
            </div>
          ) : null}
        </Suspense>
      </AppPageLayout>
    </MediaProcessingGuard>
  );
}
