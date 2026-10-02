import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "cn";

export default function ImagePreview({
  url,
  name,
  onReady,
  onError,
  bottomInset,
}: {
  url: string;
  name: string;
  onReady: () => void;
  onError: () => void;
  bottomInset: boolean;
}) {
  const { t } = useLingui();
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // 图片按真实可用像素适配；内容倍率独立于界面 rem 缩放，不改变控件大小。
  const fit =
    natural.width && natural.height
      ? Math.min(size.width / natural.width, size.height / natural.height)
      : 0;
  const width = natural.width * fit * zoom,
    height = natural.height * fit * zoom;
  function resize(next: number) {
    setZoom(Math.min(4, Math.max(0.5, next)));
    if (next === 1) viewport.current?.scrollTo({ left: 0, top: 0 });
  }
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3">
      <div
        ref={viewport}
        className="bg-muted/40 min-h-0 flex-1 overflow-auto rounded-lg"
        tabIndex={0}
        aria-label={t`图片预览区域`}
      >
        <div
          className="grid min-h-full min-w-full place-items-center"
          style={{ width: width || "100%", height: height || "100%" }}
        >
          <img
            src={url}
            alt={name}
            draggable={false}
            className="block max-w-none"
            style={{
              width: width || undefined,
              height: height || undefined,
              visibility: natural.width ? "visible" : "hidden",
            }}
            onLoad={(e) => {
              setNatural({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              });
              onReady();
            }}
            onError={onError}
          />
        </div>
      </div>
      <div
        className={cn(
          "grid shrink-0 grid-cols-3 gap-2 border-t pt-2 md:flex md:justify-end",
          bottomInset && "pb-[max(0.75rem,var(--safe-bottom,0px))]",
        )}
      >
        <Button
          variant="outline"
          size="sm"
          density="adaptive"
          disabled={!natural.width || zoom <= 0.5}
          onClick={() => resize(zoom - 0.25)}
        >
          <ZoomOut data-icon="inline-start" />
          <Trans>缩小</Trans>
        </Button>
        <Button
          variant="outline"
          size="sm"
          density="adaptive"
          disabled={!natural.width}
          onClick={() => resize(1)}
        >
          <Maximize data-icon="inline-start" />
          <Trans>适应窗口</Trans>
        </Button>
        <Button
          variant="outline"
          size="sm"
          density="adaptive"
          disabled={!natural.width || zoom >= 4}
          onClick={() => resize(zoom + 0.25)}
        >
          <ZoomIn data-icon="inline-start" />
          <Trans>放大</Trans>
        </Button>
      </div>
    </div>
  );
}
