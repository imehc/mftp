import { useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { LoaderCircle } from "lucide-react";
import type { PreviewKind } from "~/lib/preview-kind";

export interface PreviewSurfaceProps {
  /** Any URL the WebView can load: loopback stream, blob:, asset:. */
  url: string;
  /** File name; used as the image alt text. */
  name: string;
  kind: PreviewKind;
}

/** Text previews only pull the head of the file: enough to read, cheap for
 *  a still-downloading torrent piece. */
const TEXT_HEAD_BYTES = 128 * 1024;

/**
 * Kind-driven preview element. Source-agnostic on purpose so other modules
 * can reuse it; the caller resolves the URL and owns any surrounding chrome.
 */
export default function PreviewSurface({ url, name, kind }: PreviewSurfaceProps) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState<{ body: string; truncated: boolean } | null>(
    null,
  );
  const imageRef = useRef<HTMLImageElement>(null);

  // Text has no load event of its own: fetch the head and render it.
  useEffect(() => {
    if (kind !== "text" || !url) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Range: `bytes=0-${TEXT_HEAD_BYTES - 1}` },
        });
        if (!response.ok && response.status !== 206) throw new Error("read failed");
        const body = await response.text();
        setText({ body, truncated: body.length >= TEXT_HEAD_BYTES });
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
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
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
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
            {text?.body}
          </pre>
          {text?.truncated ? (
            <p className="pt-2 text-[10px] text-muted-foreground">
              <Trans>仅显示开头部分</Trans>
            </p>
          ) : null}
        </div>
      ) : null}
      {kind === "other" ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          <Trans>该格式不支持预览</Trans>
        </p>
      ) : null}

      {loading && !failed && kind !== "other" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-full bg-background/80 px-3 py-1.5 text-xs shadow-sm">
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/95 p-4 text-center text-xs text-muted-foreground">
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
