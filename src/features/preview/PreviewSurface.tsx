import { useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { LoaderCircle } from "lucide-react";
import type { PreviewKind } from "~/lib/preview-kind";
export interface PreviewSurfaceProps {
  /** WebView 能加载的任意 URL：回环流、blob:、asset:。 */
  url: string;
  /** 文件名；用作图片的 alt 文本。 */
  name: string;
  kind: PreviewKind;
}

/** 文本预览只取文件开头部分：足以阅读，且对仍在
 *  下载中的种子分片开销很低。 */
const TEXT_HEAD_BYTES = 128 * 1024;

/**
 * 按类型渲染的预览元素。刻意与来源解耦，便于其他模块复用；
 * 由调用方解析 URL 并负责周围的界面框架。
 */
export default function PreviewSurface({
  url,
  name,
  kind,
}: PreviewSurfaceProps) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState<{
    body: string;
    truncated: boolean;
  } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // 文本自身没有 load 事件：直接拉取开头部分并渲染。
  useEffect(() => {
    if (kind !== "text" || !url) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Range: `bytes=0-${TEXT_HEAD_BYTES - 1}`,
          },
        });
        if (!response.ok && response.status !== 206)
          throw new Error("read failed");
        const body = await response.text();
        setText({
          body,
          truncated: body.length >= TEXT_HEAD_BYTES,
        });
        setLoading(false);
      } catch {
        if (controller.signal.aborted) return;
        setFailed(true);
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [kind, url]);
  const ready = () => setLoading(false);
  const fail = () => {
    setFailed(true);
    setLoading(false);
  };
  useEffect(() => {
    if (kind !== "image") return;
    const image = imageRef.current;
    if (!image?.complete) return;
    if (image.naturalWidth > 0) ready();
    else fail();
  }, [kind]);
  return (
    <div className="border-border bg-muted/40 relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border">
      {kind === "video" ? (
        <video
          className="h-full max-h-full w-full bg-black"
          src={url}
          controls
          autoPlay
          playsInline
          onPlaying={ready}
          onCanPlay={ready}
          onWaiting={() => setLoading(true)}
          onError={fail}
        />
      ) : null}
      {kind === "audio" ? (
        <audio
          className="w-full max-w-md px-4"
          src={url}
          controls
          autoPlay
          onPlaying={ready}
          onCanPlay={ready}
          onWaiting={() => setLoading(true)}
          onError={fail}
        />
      ) : null}
      {kind === "image" ? (
        <img
          ref={imageRef}
          className="max-h-full max-w-full object-contain"
          src={url}
          alt={name}
          onLoad={ready}
          onError={fail}
        />
      ) : null}
      {kind === "text" ? (
        <div className="h-full w-full overflow-auto p-3">
          <pre className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
            {text?.body}
          </pre>
          {text?.truncated ? (
            <p className="text-muted-foreground pt-2 text-[10px]">
              <Trans>仅显示开头部分</Trans>
            </p>
          ) : null}
        </div>
      ) : null}
      {kind === "other" ? (
        <p className="text-muted-foreground p-6 text-center text-xs">
          <Trans>该格式不支持预览</Trans>
        </p>
      ) : null}

      {loading && !failed && kind !== "other" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="bg-background/80 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs shadow-sm">
            <LoaderCircle className="size-3.5 animate-spin" />
            {kind === "video" || kind === "audio" ? (
              <Trans>缓冲中…</Trans>
            ) : (
              <Trans>加载中…</Trans>
            )}
          </div>
        </div>
      ) : null}
      {failed ? (
        <div className="bg-background/95 text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-1 p-4 text-center text-xs">
          {kind === "video" || kind === "audio" ? (
            <>
              <span>
                <Trans>该格式无法在线播放（mkv 等格式支持度有限）</Trans>
              </span>
              <span>
                <Trans>建议下载后用外部播放器打开</Trans>
              </span>
            </>
          ) : (
            <span>
              <Trans>读取失败</Trans>
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
