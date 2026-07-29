import { Link, useNavigate } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import { Archive, Home } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CompressModeTabs } from "~/features/media-compress/components/CompressModeTabs";
import ImageCompressPanel from "~/features/media-compress/image/ImageCompressPanel";
import ImageResizePanel from "~/features/media-compress/resize/ImageResizePanel";
import type { CompressModeId } from "~/features/media-compress/types";
import VideoCompressPanel from "~/features/media-compress/video/VideoCompressPanel";

interface MediaCompressToolProps {
  mode: CompressModeId;
}

export default function MediaCompressTool({ mode }: MediaCompressToolProps) {
  const navigate = useNavigate();

  return (
    <main className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button variant="ghost" size="xs" asChild>
            <Link to="/">
              <Home data-icon="inline-start" />
              <Trans>首页</Trans>
            </Link>
          </Button>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="hidden truncate text-xs font-medium text-muted-foreground sm:block">
            <Trans>媒体处理</Trans>
          </div>
        </div>
        <Badge variant="outline">
          <Trans>本地处理</Trans>
        </Badge>
      </header>

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
                  <Trans>图片 / 视频本地压缩与图片改尺寸</Trans>
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

        <div hidden={mode !== "image"}>
          <ImageCompressPanel />
        </div>
        <div hidden={mode !== "video"}>
          <VideoCompressPanel />
        </div>
        <div hidden={mode !== "resize"}>
          <ImageResizePanel />
        </div>
      </div>
    </main>
  );
}
