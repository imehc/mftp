import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { FileVideo, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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
import type { CompressPhase } from "~/features/media-compress/types";
import { useCompressResult } from "~/features/media-compress/useCompressResult";
import {
  audioCodecsSupported,
  compressVideoFile,
  DEFAULT_VIDEO_QUALITY,
  estimateVideoOutput,
  isSupportedVideoFile,
  probeVideoFile,
  VIDEO_QUALITY_MAX,
  VIDEO_QUALITY_MIN,
  VIDEO_QUALITY_STEP,
  type VideoMeta,
  type VideoResolution,
  webCodecsSupported,
} from "~/features/media-compress/video/compress";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";

import MediaProgress from "../components/MediaProgress";
import { useMediaProcessing } from "../MediaProcessingGuard";

export default function VideoCompressPanel() {
  const { t } = useLingui();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [resolution, setResolution] = useState<VideoResolution>("original");
  const [quality, setQuality] = useState(DEFAULT_VIDEO_QUALITY);
  const [keepAudio, setKeepAudio] = useState(true);
  const [phase, setPhase] = useState<CompressPhase>("idle");
  useMediaProcessing("video", phase === "compressing");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const codecOk = webCodecsSupported();
  const audioCodecOk = audioCodecsSupported();
  const lastParamsRef = useRef<string>("");
  const probeRunRef = useRef(0);
  const { result, clearResult, setResult, setResultSize } = useCompressResult();
  const effectiveKeepAudio = keepAudio && audioCodecOk;
  const estimate = (() => {
    if (!meta) return null;
    return estimateVideoOutput(meta, {
      resolution,
      quality,
      keepAudio: effectiveKeepAudio,
    });
  })();
  const paramsKey = `${resolution}-${quality}-${keepAudio}`;
  // 当编解码器变为不可用时，在渲染期间重置 keepAudio（React 的
  //“在 prop 变化时调整 state”模式），而不是用 effect。
  const [prevCodecOk, setPrevCodecOk] = useState(audioCodecOk);
  if (prevCodecOk !== audioCodecOk) {
    setPrevCodecOk(audioCodecOk);
    if (!audioCodecOk) setKeepAudio(false);
  }

  function resetResultState() {
    clearResult();
    setError(null);
    setProgress(0);
    setStage("");
  }

  useEffect(() => {
    if (phase !== "done" || lastParamsRef.current === paramsKey) return;
    setPhase("idle");
    setProgress(0);
    setStage("");
  }, [paramsKey, phase]);
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      probeRunRef.current += 1;
    };
  }, []);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function applyFile(next: File | null) {
    abortRef.current?.abort();
    abortRef.current = null;
    const runId = probeRunRef.current + 1;
    probeRunRef.current = runId;
    lastParamsRef.current = "";
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    resetResultState();
    setPreviewUrl(null);
    setPhase("idle");
    setMeta(null);
    setFile(null);
    if (!next) return;
    if (!isSupportedVideoFile(next)) {
      setError(t`仅支持 MP4、MOV、M4V 格式`);
      toast.error(t`仅支持 MP4、MOV、M4V 格式`);
      return;
    }
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setPhase("probing");
    try {
      const info = await probeVideoFile(next);
      if (probeRunRef.current !== runId) return;
      setMeta(info);
      setPhase("idle");
    } catch (err) {
      if (probeRunRef.current !== runId) return;
      setError(describeError(err));
      setPhase("error");
      toast.error(describeError(err));
    }
  }

  async function onCompress() {
    if (!file) {
      toast.error(t`请先选择视频文件`);
      return;
    }
    if (!codecOk) {
      toast.error(t`当前环境不支持 WebCodecs`);
      return;
    }
    if (phase === "done" && lastParamsRef.current === paramsKey) {
      toast.message(t`参数未变化，无需重新处理`);
      return;
    }
    resetResultState();

    // 开始新的压缩前，先取消正在进行的压缩。
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    probeRunRef.current += 1;
    setPhase("compressing");
    setProgress(0);
    setStage("reading");
    try {
      const currentMeta =
        meta ?? (await probeVideoFile(file, controller.signal));
      if (abortRef.current !== controller) return;
      setMeta(currentMeta);
      const result = await compressVideoFile(
        file,
        {
          resolution,
          quality,
          keepAudio: effectiveKeepAudio,
        },
        (value, nextStage) => {
          if (abortRef.current !== controller) return;
          setProgress(value);
          setStage(nextStage);
        },
        controller.signal,
        currentMeta,
      );
      if (abortRef.current !== controller) return;
      setResult(result);
      setPhase("done");
      setProgress(100);
      lastParamsRef.current = paramsKey;
      toast.success(t`压缩完成`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // 来自被取代的上一次压缩的陈旧处理器 —— 忽略。
        if (abortRef.current !== controller) return;
        // 用户通过取消按钮主动取消。
        setPhase("idle");
        setProgress(0);
        setStage("");
        toast.message(t`已取消压缩`);
        return;
      }
      const message = describeError(err);
      if (abortRef.current !== controller) return;
      setError(message);
      setPhase("error");
      toast.error(message);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  function onClear() {
    void applyFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const stageLabel =
    stage === "demuxing"
      ? t`解析中`
      : stage === "compressing"
        ? t`编码中`
        : stage === "done"
          ? t`完成`
          : stage === "reading"
            ? t`读取中`
            : phase === "probing"
              ? t`读取信息`
              : t`准备中`;
  const processingView = phase === "compressing";
  if (!codecOk) {
    return (
      <section
        role="status"
        className="border-border bg-card flex flex-col items-center gap-3 rounded-lg border p-6 text-center"
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
      onCancel={() => abortRef.current?.abort()}
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
        <section className="border-border bg-card min-w-0 rounded-lg border p-3">
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
                <FieldDescription className="!mt-0">
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
            ratio={estimate?.ratio}
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
