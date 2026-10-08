import { Trans } from "@lingui/react/macro";
import { cn } from "cn";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import type { PreviewKind } from "~/lib/preview-kind";

import ImagePreview from "./ImagePreview";
import MediaPlayer from "./MediaPlayer";
import { readTextPreview, type TextPreview } from "./read-text-preview";

export interface PreviewSurfaceProps {
  url: string;
  name: string;
  kind: PreviewKind;
  /** 整页预览独立处理安全区，嵌入来源面板时由来源外壳处理。 */
  bottomInset?: boolean;
}

export default function PreviewSurface(props: PreviewSurfaceProps) {
  // URL/类型切换须清理旧流与媒体状态；窗口尺寸变化则保留当前播放和缩放。
  return <PreviewContent key={`${props.kind}:${props.url}`} {...props} />;
}

function PreviewContent({
  url,
  name,
  kind,
  bottomInset = false,
}: PreviewSurfaceProps) {
  const [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [text, setText] = useState<TextPreview | null>(null);
  useEffect(() => {
    if (kind !== "text") return;
    const controller = new AbortController();

    const update = (value: TextPreview) => {
      if (!controller.signal.aborted) {
        setText(value);
        setLoading(false);
      }
    };

    void readTextPreview(url, controller.signal, update)
      .then(update)
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [url, kind, attempt]);
  const ready = () => setLoading(false);

  const fail = () => {
    setFailed(true);
    setLoading(false);
  };

  const retry = () => {
    setFailed(false);
    setLoading(true);
    setAttempt((v) => v + 1);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {kind === "image" ? (
        <ImagePreview
          key={attempt}
          url={url}
          name={name}
          bottomInset={bottomInset}
          onReady={ready}
          onError={fail}
        />
      ) : null}
      {kind === "video" || kind === "audio" ? (
        <MediaPlayer
          key={attempt}
          url={url}
          name={name}
          video={kind === "video"}
          bottomInset={bottomInset}
          onReady={ready}
          onLoading={() => setLoading(true)}
          onError={fail}
        />
      ) : null}
      {kind === "text" ? (
        <div
          className={cn(
            "min-h-0 flex-1 overflow-auto",
            bottomInset && "app-scroll-safe-end",
          )}
          tabIndex={0}
        >
          <pre className="font-mono text-sm leading-relaxed break-words whitespace-pre-wrap">
            {text?.body}
          </pre>
          {text?.truncated ? (
            <p className="text-muted-foreground mt-3 rounded-lg border p-3 text-xs">
              <Trans>仅显示开头部分</Trans>
            </p>
          ) : null}
          {text?.interrupted ? (
            <Button
              className="mt-2"
              variant="outline"
              size="sm"
              density="adaptive"
              onClick={retry}
            >
              <RotateCcw data-icon="inline-start" />
              <Trans>重新读取</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}
      {kind === "other" ? (
        <p className="text-muted-foreground m-auto p-6 text-center text-sm">
          <Trans>该格式不支持预览</Trans>
        </p>
      ) : null}
      {loading && !failed && kind !== "other" ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          role="status"
        >
          <div className="bg-background/80 flex items-center gap-2 rounded-full px-3 py-2 text-xs shadow-sm">
            <LoaderCircle className="size-4 animate-spin" />
            {kind === "video" || kind === "audio" ? (
              <Trans>缓冲中…</Trans>
            ) : (
              <Trans>加载中…</Trans>
            )}
          </div>
        </div>
      ) : null}
      {failed ? (
        <div className="bg-background/95 text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm">
          <p role="status">
            <Trans>暂时无法预览，文件可能尚未下载完整或编码不受支持</Trans>
          </p>
          <Button
            variant="outline"
            size="sm"
            density="adaptive"
            onClick={retry}
          >
            <RotateCcw data-icon="inline-start" />
            <Trans>重试</Trans>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
