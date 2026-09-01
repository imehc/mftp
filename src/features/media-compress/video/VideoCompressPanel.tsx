import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { FileVideo, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { CompressDropzone } from "~/features/media-compress/components/CompressDropzone";
import { CompressEstimateBar } from "~/features/media-compress/components/CompressEstimateBar";
import { CompressQualityField } from "~/features/media-compress/components/CompressQualityField";
import { CompressResultCard } from "~/features/media-compress/components/CompressResultCard";
import { formatBytes, formatDuration } from "~/features/media-compress/format";
import type { CompressPhase } from "~/features/media-compress/types";
import {
  audioCodecsSupported,
  compressVideoFile,
  DEFAULT_VIDEO_QUALITY,
  estimateVideoOutput,
  isSupportedVideoFile,
  probeVideoFile,
  type VideoMeta,
  type VideoResolution,
  VIDEO_QUALITY_MAX,
  VIDEO_QUALITY_MIN,
  VIDEO_QUALITY_STEP,
  webCodecsSupported,
} from "~/features/media-compress/video/compress";
import { useCompressResult } from "~/features/media-compress/useCompressResult";
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
      setError(String(err));
      setPhase("error");
      toast.error(String(err));
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
      const message = String(err);
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
  function onCancel() {
    abortRef.current?.abort();
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
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!codecOk ? (
          <p className="text-destructive text-xs">
            <Trans>当前 WebView 不支持 WebCodecs，无法压缩视频。</Trans>
          </p>
        ) : (
          <span />
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onClear}
          disabled={!file && !result.blob}
        >
          <Trans>清空</Trans>
        </Button>
      </div>

      <CompressDropzone
        inputRef={inputRef}
        accept=".mp4,.mov,.m4v,video/mp4,video/quicktime"
        nativeFilter={{
          title: t`选择视频`,
          filterName: t`视频文件`,
          extensions: ["mp4", "mov", "m4v"],
        }}
        disabled={phase === "compressing" || !codecOk}
        onFile={(next) => void applyFile(next)}
        icon={<FileVideo className="text-muted-foreground size-5" />}
        title={<Trans>拖放视频到此处，或选择文件</Trans>}
        description={<Trans>MP4 · MOV · M4V，文件不会上传</Trans>}
        pickLabel={<Trans>选择视频</Trans>}
        footer={
          file ? (
            <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
              <Badge variant="secondary">{file.name}</Badge>
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

      <section className="border-border bg-card rounded-lg border p-2.5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)_auto] lg:items-end">
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
              disabled={phase === "compressing"}
            >
              <SelectTrigger className="w-full" aria-label={t`选择输出分辨率`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="original">
                  <Trans>原始分辨率</Trans>
                </SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="360p">360p</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <CompressQualityField
            value={quality}
            min={VIDEO_QUALITY_MIN}
            max={VIDEO_QUALITY_MAX}
            step={VIDEO_QUALITY_STEP}
            disabled={phase === "compressing"}
            ariaLabel={t`选择压缩程度`}
            onChange={setQuality}
          />

          <Field
            orientation="horizontal"
            className="items-center self-end sm:col-span-2 lg:col-span-1 lg:min-w-[12rem] lg:pb-5"
          >
            <Checkbox
              id="video-keep-audio"
              checked={keepAudio}
              onCheckedChange={(checked) => setKeepAudio(checked === true)}
              disabled={
                phase === "compressing" ||
                meta?.hasAudio === false ||
                !audioCodecOk
              }
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
          showProgress={phase === "compressing" || progress > 0}
          progress={progress}
          progressLabel={stageLabel}
          secondaryAction={
            phase === "compressing" ? (
              <Button variant="outline" size="sm" onClick={onCancel}>
                <Trans>取消</Trans>
              </Button>
            ) : null
          }
          primaryAction={
            <Button
              size="sm"
              onClick={() => void onCompress()}
              disabled={!file || !codecOk || phase === "compressing"}
            >
              {phase === "compressing" ? (
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : null}
              <Trans>开始压缩</Trans>
            </Button>
          }
        />

        {error ? (
          <p className="text-destructive mt-2 text-xs">{error}</p>
        ) : null}
      </section>

      {(previewUrl || result.url) && (
        <section className="grid gap-2 md:grid-cols-2">
          {previewUrl ? (
            <div className="border-border bg-card flex flex-col rounded-lg border p-2.5">
              <div className="text-muted-foreground mb-1.5 text-xs font-medium">
                <Trans>原视频</Trans>
              </div>
              <div className="mt-auto h-64 w-full overflow-hidden rounded-md bg-black">
                <video
                  src={previewUrl}
                  controls
                  className="h-full w-full rounded-md object-contain"
                />
              </div>
            </div>
          ) : null}
          {result.url && result.blob ? (
            <CompressResultCard
              fileName={result.fileName}
              size={result.size}
              originalSize={meta?.size ?? file?.size ?? 0}
              blob={result.blob}
              onSizeChange={setResultSize}
              preview={
                <div className="h-64 w-full overflow-hidden rounded-md bg-black">
                  <video
                    src={result.url}
                    controls
                    className="h-full w-full rounded-md object-contain"
                  />
                </div>
              }
            />
          ) : null}
        </section>
      )}
    </div>
  );
}
