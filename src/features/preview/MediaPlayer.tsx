import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import {
  AudioLines,
  Maximize,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Slider } from "~/components/ui/slider";
import { describeError } from "~/lib/errors";

function timestamp(value: number) {
  if (!Number.isFinite(value)) return "0:00";
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** 统一媒体控件由语义主题与 shadcn 组件组成，各平台共用同一套交互。 */
export default function MediaPlayer({
  url,
  name,
  video,
  bottomInset,
  onReady,
  onLoading,
  onError,
}: {
  url: string;
  name: string;
  video: boolean;
  bottomInset: boolean;
  onReady: () => void;
  onLoading: () => void;
  onError: () => void;
}) {
  const { t } = useLingui();
  const media = useRef<HTMLMediaElement | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playError, setPlayError] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const synchronize = () => {
    if (!media.current) return;
    setPosition(media.current.currentTime);
    setDuration(
      Number.isFinite(media.current.duration) ? media.current.duration : 0,
    );
  };

  const togglePlay = async () => {
    const element = media.current;
    if (!element) return;
    if (!element.paused) element.pause();
    else {
      try {
        await element.play();
        setPlayError(false);
      } catch {
        setPlayError(true);
      }
    }
  };

  const events = {
    src: url,
    preload: "metadata",
    onLoadedMetadata: () => {
      synchronize();
      onReady();
    },
    onDurationChange: synchronize,
    onTimeUpdate: synchronize,
    onPlaying: () => {
      setPlaying(true);
      onReady();
    },
    onPause: () => setPlaying(false),
    onEnded: () => {
      setPlaying(false);
      onReady();
    },
    onCanPlay: onReady,
    onWaiting: onLoading,
    onError,
    onVolumeChange: () => {
      setMuted(media.current?.muted ?? false);
      setVolume(media.current?.volume ?? 1);
    },
  };
  return (
    <div
      ref={container}
      className="bg-background flex h-full min-h-0 w-full flex-col gap-3"
    >
      {video ? (
        <video
          {...events}
          ref={(element) => {
            media.current = element;
          }}
          playsInline
          aria-label={name}
          className="bg-muted/40 min-h-0 w-full flex-1 rounded-lg object-contain"
        />
      ) : (
        <div className="bg-muted/40 flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-lg p-4">
          <div className="bg-muted text-muted-foreground rounded-xl p-6">
            <AudioLines className="size-12" />
          </div>
          <p className="max-w-full truncate text-sm font-medium">{name}</p>
          <p className="text-muted-foreground text-xs tabular-nums">
            {timestamp(duration)}
          </p>
          <audio
            {...events}
            ref={(element) => {
              media.current = element;
            }}
            aria-label={name}
          />
        </div>
      )}
      <div
        className={cn(
          "bg-background flex shrink-0 flex-col gap-2 border-t pt-2",
          bottomInset && "pb-[max(0.75rem,var(--safe-bottom,0px))]",
        )}
      >
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            title={playing ? t`暂停` : t`播放`}
            aria-label={playing ? t`暂停` : t`播放`}
            onClick={() => void togglePlay()}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-muted-foreground text-xs tabular-nums">
              {timestamp(scrubbing ?? position)} / {timestamp(duration)}
            </span>
            <Slider
              aria-label={t`播放进度`}
              min={0}
              max={duration || 1}
              step={0.1}
              value={[scrubbing ?? position]}
              disabled={!duration}
              onValueChange={([next]) => setScrubbing(next)}
              onValueCommit={([next]) => {
                if (media.current) media.current.currentTime = next;
                setPosition(next);
                setScrubbing(null);
              }}
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            title={muted ? t`取消静音` : t`静音`}
            aria-label={muted ? t`取消静音` : t`静音`}
            aria-pressed={muted}
            onClick={() => {
              if (media.current) media.current.muted = !muted;
            }}
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>
          <Slider
            className="hidden w-20 md:flex"
            aria-label={t`音量`}
            min={0}
            max={1}
            step={0.05}
            value={[muted ? 0 : volume]}
            onValueChange={([next]) => {
              if (media.current) {
                media.current.volume = next;
                media.current.muted = next === 0;
              }
            }}
          />
          {video ? (
            <Button
              variant="ghost"
              size="icon-sm"
              density="adaptive"
              title={t`全屏`}
              aria-label={t`全屏`}
              onClick={async () => {
                try {
                  setFullscreenError(null);
                  // iOS 的视频全屏与标准元素全屏分开检测，不改整个页面的方向或缩放。
                  const native = media.current as HTMLVideoElement & {
                    webkitEnterFullscreen?: () => void;
                  };
                  if (document.fullscreenElement)
                    await document.exitFullscreen();
                  else if (container.current?.requestFullscreen)
                    await container.current.requestFullscreen();
                  else if (native?.webkitEnterFullscreen)
                    native.webkitEnterFullscreen();
                  else setFullscreenError(t`当前设备不支持全屏播放`);
                } catch (error) {
                  setFullscreenError(describeError(error));
                }
              }}
            >
              <Maximize />
            </Button>
          ) : null}
        </div>
        {fullscreenError ? (
          <p role="status" className="text-destructive text-xs">
            {fullscreenError}
          </p>
        ) : null}
        {playError ? (
          <p className="text-destructive text-xs">
            <Trans>无法播放，请重试或使用系统应用打开</Trans>
          </p>
        ) : null}
      </div>
    </div>
  );
}
