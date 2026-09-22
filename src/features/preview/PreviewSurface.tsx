import { useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { Button } from "~/components/ui/button";
import { type PreviewKind } from "~/lib/preview-kind";
import MediaPlayer from "./MediaPlayer";
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
  // 重试计数：作为媒体元素的 key，自增即重新挂载并重新拉流。首次尝试
  // 常常撞在种子刚加入、引擎还在校验文件的窗口上，重试一次就能过。
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState<{
    body: string;
    truncated: boolean;
    interrupted: boolean;
  } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // 文本自身没有 load 事件：直接拉取开头部分并渲染。
  useEffect(() => {
    if (kind !== "text" || !url) return;
    const controller = new AbortController();
    void (async () => {
      let body = "";
      let received = 0;
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
          headers: {
            Range: `bytes=0-${TEXT_HEAD_BYTES - 1}`,
          },
        });
        if (!response.ok && response.status !== 206)
          throw new Error("read failed");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("empty response");
        const decoder = new TextDecoder();
        // 边读边显示已到达的文本；缺失后续分片时保留可读内容，且始终限制内存用量。
        while (received < TEXT_HEAD_BYTES) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = value.subarray(0, TEXT_HEAD_BYTES - received);
          received += chunk.byteLength;
          body += decoder.decode(chunk, { stream: true });
          if (controller.signal.aborted) return;
          setText({ body, truncated: false, interrupted: false });
          setLoading(false);
        }
        body += decoder.decode();
        await reader.cancel();
        if (controller.signal.aborted) return;
        const total = Number(
          response.headers.get("Content-Range")?.split("/")[1] ??
            response.headers.get("Content-Length"),
        );
        setText({
          body,
          truncated: total > received || received >= TEXT_HEAD_BYTES,
          interrupted: false,
        });
        setLoading(false);
      } catch {
        if (controller.signal.aborted) return;
        if (received > 0) setText({ body, truncated: true, interrupted: true });
        else setFailed(true);
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [attempt, kind, url]);
  const ready = () => setLoading(false);
  const fail = () => {
    setFailed(true);
    setLoading(false);
  };
  const retry = () => {
    setFailed(false);
    setLoading(true);
    setAttempt((value) => value + 1);
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
      {kind === "video" || kind === "audio" ? (
        <MediaPlayer
          key={attempt}
          url={url}
          name={name}
          video={kind === "video"}
          onReady={ready}
          onLoading={() => setLoading(true)}
          onError={fail}
        />
      ) : null}
      {kind === "image" ? (
        <img
          key={attempt}
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
          {text?.interrupted ? (
            <Button
              className="mt-2"
              variant="outline"
              size="xs"
              onClick={retry}
            >
              <RotateCcw />
              <Trans>重新读取</Trans>
            </Button>
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
        <div className="bg-background/95 text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs">
          <span>
            <Trans>暂时无法预览，文件可能尚未下载完整或编码不受支持</Trans>
          </span>
          <Button variant="outline" size="xs" onClick={retry}>
            <RotateCcw data-icon="inline-start" />
            <Trans>重试</Trans>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
