import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import { Archive, LoaderCircle } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { ToolPageHeader } from "~/components/ToolPageHeader";
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

  useEffect(() => {
    setVisitedModes((current) => {
      if (current.has(mode)) return current;
      const next = new Set(current);
      next.add(mode);
      return next;
    });
  }, [mode]);

  return (
    <main className="flex h-full flex-col bg-background text-foreground">
      <ToolPageHeader title={<Trans>媒体处理</Trans>} trailing={<Badge variant="outline"><Trans>本地处理</Trans></Badge>} />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-2 overflow-auto p-2.5 sm:p-3">
        <section className="rounded-lg border border-border bg-card p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <Archive className="size-4" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold">
                  <Trans>媒体处理</Trans>
                </h1>
                <p className="truncate text-xs text-muted-foreground">
                  <Trans>图片 / 视频本地压缩与调整图片尺寸</Trans>
                </p>
              </div>
            </div>
            <CompressModeTabs
              value={mode}
              onChange={(next) => {
                void navigate({
                  to: "/tools/media-compress",
                  search: { mode: next },
                  replace: true,
                });
              }}
            />
          </div>
        </section>

        <Suspense
          fallback={
            <div className="flex min-h-40 items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm text-muted-foreground">
              <LoaderCircle className="animate-spin" />
              <Trans>正在加载处理工具…</Trans>
            </div>
          }
        >
          {visitedModes.has("image") ? (
            <div hidden={mode !== "image"}>
              <ImageCompressPanel />
            </div>
          ) : null}
          {visitedModes.has("video") ? (
            <div hidden={mode !== "video"}>
              <VideoCompressPanel />
            </div>
          ) : null}
          {visitedModes.has("resize") ? (
            <div hidden={mode !== "resize"}>
              <ImageResizePanel />
            </div>
          ) : null}
        </Suspense>
      </div>
    </main>
  );
}
