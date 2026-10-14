import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { FileVideo, VideoOff } from "lucide-react";
import { useRef } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { CompressDropzone } from "~/features/media-compress/components/CompressDropzone";
import { CompressEstimateBar } from "~/features/media-compress/components/CompressEstimateBar";
import { CompressQualityField } from "~/features/media-compress/components/CompressQualityField";
import { CompressResultCard } from "~/features/media-compress/components/CompressResultCard";
import { formatDuration } from "~/features/media-compress/format";
import {
  VIDEO_QUALITY_MAX,
  VIDEO_QUALITY_MIN,
  VIDEO_QUALITY_STEP,
} from "~/features/media-compress/video/compress";
import { formatBytes } from "~/lib/format";

import MediaProgress from "../components/MediaProgress";
import { useVideoCompress } from "./use-video-compress";

export default function VideoCompressPanel() {
  const { t } = useLingui();
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    file,
    previewUrl,
    meta,
    resolution,
    setResolution,
    quality,
    setQuality,
    keepAudio,
    setKeepAudio,
    phase,
    progress,
    error,
    codecOk,
    audioCodecOk,
    estimate,
    stageLabel,
    result,
    setResultSize,
    applyFile,
    onCompress,
    cancel,
  } = useVideoCompress();

  function onClear() {
    void applyFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const processingView = phase === "compressing";
  if (!codecOk) {
    return (
      <section
        role="status"
        className="border-border bg-card flex flex-col items-center gap-3 rounded-xl border p-6 text-center"
      >
        <VideoOff className="text-muted-foreground size-6" />
        <h2 className="text-sm font-semibold">
          <Trans>当前设备不支持视频压缩</Trans>
        </h2>
        <p className="text-muted-foreground text-sm">
          <Trans>当前环境缺少所需的视频编码能力，可以继续使用图片压缩。</Trans>
        </p>
        <Button asChild density="adaptive" className="max-md:w-full">
          <Link to="/tools/media-compress" search={{ mode: "image" }} replace>
            <Trans>图片压缩</Trans>
          </Link>
        </Button>
      </section>
    );
  }
  return processingView ? (
    <MediaProgress
      fileName={file?.name ?? ""}
      progress={progress}
      label={stageLabel}
      onCancel={cancel}
    />
  ) : (
    <div className="grid min-w-0 grid-cols-1 items-start gap-3 md:grid-cols-2">
      <CompressDropzone
        preview={
          previewUrl ? (
            <video
              src={previewUrl}
              controls
              className="size-full object-contain"
            />
          ) : undefined
        }
        onClear={onClear}
        inputRef={inputRef}
        accept=".mp4,.mov,.m4v,video/mp4,video/quicktime"
        nativeFilter={{
          title: t`选择视频`,
          filterName: t`视频文件`,
          extensions: ["mp4", "mov", "m4v"],
        }}
        disabled={!codecOk}
        onFile={(next) => void applyFile(next)}
        icon={<FileVideo className="text-muted-foreground size-5" />}
        title={
          <>
            <span className="md:hidden">
              <Trans>选择一个视频</Trans>
            </span>
            <span className="hidden md:inline">
              <Trans>拖放视频到此处，或选择文件</Trans>
            </span>
          </>
        }
        description={<Trans>MP4 · MOV · M4V，文件不会上传</Trans>}
        pickLabel={<Trans>选择视频</Trans>}
        footer={
          file ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span
                className="w-full truncate text-left text-sm"
                title={file.name}
              >
                {file.name}
              </span>
              <Badge variant="outline">{formatBytes(file.size)}</Badge>
              {meta ? (
                <>
                  <Badge variant="outline">
                    {meta.width}×{meta.height}
                  </Badge>
                  <Badge variant="outline">
                    {formatDuration(meta.duration)}
                  </Badge>
                </>
              ) : null}
            </div>
          ) : null
        }
      />

      {file ? (
        <section className="border-border bg-card min-w-0 rounded-xl border p-3">
          <h2 className="mb-3 text-sm font-semibold">
            <Trans>输出设置</Trans>
          </h2>
          <div className="grid gap-3">
            <Field className="min-w-0">
              <FieldLabel>
                <Trans>输出分辨率</Trans>
              </FieldLabel>
              <Select
                value={resolution}
                onValueChange={(value) => {
                  if (
                    value === "original" ||
                    value === "1080p" ||
                    value === "720p" ||
                    value === "480p" ||
                    value === "360p"
                  ) {
                    setResolution(value);
                  }
                }}
                disabled={phase === "probing"}
              >
                <SelectTrigger
                  className="w-full"
                  aria-label={t`选择输出分辨率`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="original">
                      <Trans>原始分辨率</Trans>
                    </SelectItem>
                    <SelectItem value="1080p">1080p</SelectItem>
                    <SelectItem value="720p">720p</SelectItem>
                    <SelectItem value="480p">480p</SelectItem>
                    <SelectItem value="360p">360p</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <CompressQualityField
              value={quality}
              min={VIDEO_QUALITY_MIN}
              max={VIDEO_QUALITY_MAX}
              step={VIDEO_QUALITY_STEP}
              disabled={phase === "probing"}
              ariaLabel={t`选择压缩程度`}
              onChange={setQuality}
            />

            <Field orientation="horizontal" className="items-center">
              <Checkbox
                id="video-keep-audio"
                checked={keepAudio}
                onCheckedChange={(checked) => setKeepAudio(checked === true)}
                disabled={meta?.hasAudio === false || !audioCodecOk}
              />
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <FieldLabel htmlFor="video-keep-audio" className="leading-none">
                  <Trans>保留音频</Trans>
                </FieldLabel>
                <FieldDescription className="mt-0!">
                  {meta && !meta.hasAudio ? (
                    <Trans>源视频没有音轨</Trans>
                  ) : !audioCodecOk ? (
                    <Trans>当前 WebView 不支持音频转码</Trans>
                  ) : (
                    <Trans>关闭可进一步减小体积</Trans>
                  )}
                </FieldDescription>
              </div>
            </Field>
          </div>

          <CompressEstimateBar
            estimatedBytes={estimate?.estimatedBytes}
            estimatedMin={estimate?.estimatedMin}
            estimatedMax={estimate?.estimatedMax}
            emptyHint={<Trans>选择视频后显示预估体积</Trans>}
            extraBadges={
              estimate ? (
                <Badge variant="outline">
                  {estimate.outputWidth}×{estimate.outputHeight}
                </Badge>
              ) : null
            }
            showProgress={progress > 0}
            progress={progress}
            progressLabel={stageLabel}
            primaryAction={
              <Button
                onClick={() => void onCompress()}
                disabled={!file || !codecOk}
              >
                <Trans>开始压缩</Trans>
              </Button>
            }
          />

          {error ? (
            <p className="text-destructive mt-2 text-xs">{error}</p>
          ) : null}
        </section>
      ) : null}

      <div className="md:col-span-2">
        {result.url && result.blob ? (
          <CompressResultCard
            fileName={result.fileName}
            size={result.size}
            originalSize={meta?.size ?? file?.size ?? 0}
            blob={result.blob}
            onSizeChange={setResultSize}
            preview={
              <div className="bg-muted h-64 w-full overflow-hidden rounded-md">
                <video
                  src={result.url}
                  controls
                  className="h-full w-full rounded-md object-contain"
                />
              </div>
            }
          />
        ) : null}
      </div>
      {error && !file ? (
        <p role="status" className="text-destructive text-sm md:col-span-2">
          {error}
        </p>
      ) : null}
    </div>
  );
}
