import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ImageIcon, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
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
import {
  compressImageFile,
  DEFAULT_IMAGE_QUALITY,
  detectImageOutputFormat,
  estimateImageOutput,
  IMAGE_QUALITY_MAX,
  IMAGE_QUALITY_MIN,
  IMAGE_QUALITY_STEP,
  isAvifExportSupported,
  isSupportedImageFile,
  probeImageFile,
  type ImageMeta,
  type ImageOutputFormat,
} from "~/features/media-compress/image/compress";
import { formatBytes } from "~/features/media-compress/format";
import type { CompressPhase } from "~/features/media-compress/types";
import { useCompressResult } from "~/features/media-compress/useCompressResult";
export default function ImageCompressPanel() {
  const { t } = useLingui();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  const [outputFormat, setOutputFormat] = useState<ImageOutputFormat>("jpg");
  const [quality, setQuality] = useState(DEFAULT_IMAGE_QUALITY);
  const [phase, setPhase] = useState<CompressPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [avifOk, setAvifOk] = useState(true);
  const lastParamsRef = useRef<string>("");
  const probeRunRef = useRef(0);
  const { result, clearResult, setResult, setResultSize } = useCompressResult();
  useEffect(() => {
    void isAvifExportSupported().then(setAvifOk);
  }, []);
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
  const estimate = (() => {
    if (!meta) return null;
    return estimateImageOutput(meta, {
      outputFormat,
      quality,
    });
  })();
  const paramsKey = `${outputFormat}-${quality}`;
  useEffect(() => {
    if (phase !== "done" || lastParamsRef.current === paramsKey) return;
    setPhase("idle");
    setProgress(0);
  }, [paramsKey, phase]);
  function resetResultState() {
    clearResult();
    setError(null);
    setProgress(0);
  }
  async function applyFile(next: File | null) {
    abortRef.current?.abort();
    abortRef.current = null;
    const runId = probeRunRef.current + 1;
    probeRunRef.current = runId;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    resetResultState();
    setPreviewUrl(null);
    setPhase("idle");
    setMeta(null);
    setFile(null);
    lastParamsRef.current = "";
    if (!next) return;
    if (!isSupportedImageFile(next)) {
      setError(t`仅支持 PNG、JPG、WebP 格式`);
      toast.error(t`仅支持 PNG、JPG、WebP 格式`);
      return;
    }

    // 默认让导出格式与源文件保持一致。
    setOutputFormat(detectImageOutputFormat(next));
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setPhase("probing");
    try {
      const info = await probeImageFile(next);
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
      toast.error(t`请先选择图片文件`);
      return;
    }
    if (outputFormat === "avif" && !avifOk) {
      toast.error(t`当前环境不支持导出 AVIF`);
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
    try {
      const result = await compressImageFile(
        file,
        {
          outputFormat,
          quality,
        },
        (value) => {
          if (abortRef.current !== controller) return;
          setProgress(value);
        },
        controller.signal,
      );
      if (abortRef.current !== controller) return;
      setResult(result);
      setPhase("done");
      setProgress(100);
      lastParamsRef.current = paramsKey;
      toast.success(t`压缩完成`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (abortRef.current !== controller) return;
        setPhase("idle");
        setProgress(0);
        toast.message(t`已取消压缩`);
        return;
      }
      if (abortRef.current !== controller) return;
      const message = String(err);
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
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
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
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        nativeFilter={{
          title: t`选择图片`,
          filterName: t`图片文件`,
          extensions: ["png", "jpg", "jpeg", "webp"],
        }}
        disabled={phase === "compressing"}
        onFile={(next) => void applyFile(next)}
        icon={<ImageIcon className="text-muted-foreground size-5" />}
        title={<Trans>拖放图片到此处，或选择文件</Trans>}
        description={<Trans>PNG · JPG · WebP，默认保持原格式输出</Trans>}
        pickLabel={<Trans>选择图片</Trans>}
        footer={
          file ? (
            <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
              <Badge variant="secondary">{file.name}</Badge>
              <Badge variant="outline">{formatBytes(file.size)}</Badge>
              {meta ? (
                <Badge variant="outline">
                  {meta.width}×{meta.height}
                </Badge>
              ) : null}
            </div>
          ) : null
        }
      />

      <section className="border-border bg-card rounded-lg border p-2.5">
        <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
          <Field>
            <FieldLabel>
              <Trans>输出格式</Trans>
            </FieldLabel>
            <Select
              value={outputFormat}
              onValueChange={(value) => {
                if (
                  value === "jpg" ||
                  value === "png" ||
                  value === "webp" ||
                  value === "avif"
                ) {
                  setOutputFormat(value);
                }
              }}
              disabled={phase === "compressing"}
            >
              <SelectTrigger className="w-full" aria-label={t`选择输出格式`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="jpg">JPG</SelectItem>
                <SelectItem value="png">PNG</SelectItem>
                <SelectItem value="webp">WebP</SelectItem>
                <SelectItem value="avif" disabled={!avifOk}>
                  {avifOk ? "AVIF" : t`AVIF（不支持）`}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <CompressQualityField
            value={quality}
            min={IMAGE_QUALITY_MIN}
            max={IMAGE_QUALITY_MAX}
            step={IMAGE_QUALITY_STEP}
            disabled={phase === "compressing" || outputFormat === "png"}
            ariaLabel={t`选择压缩程度`}
            onChange={setQuality}
            rightHint={
              outputFormat === "png" ? (
                <span className="min-w-0 truncate text-right">
                  <Trans>PNG 为无损格式，压缩程度影响有限</Trans>
                </span>
              ) : undefined
            }
          />
        </div>

        <CompressEstimateBar
          estimatedBytes={estimate?.estimatedBytes}
          estimatedMin={estimate?.estimatedMin}
          estimatedMax={estimate?.estimatedMax}
          ratio={estimate?.ratio}
          emptyHint={<Trans>选择图片后显示预估体积</Trans>}
          showProgress={phase === "compressing" || progress > 0}
          progress={progress}
          progressLabel={
            phase === "compressing" ? (
              <Trans>压缩中</Trans>
            ) : phase === "done" ? (
              <Trans>完成</Trans>
            ) : (
              <Trans>准备中</Trans>
            )
          }
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
              disabled={!file || phase === "compressing"}
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
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs font-medium">
                  <Trans>原图</Trans>
                </span>
                {file ? (
                  <Badge variant="outline">{formatBytes(file.size)}</Badge>
                ) : null}
              </div>
              <div className="bg-muted/30 mt-auto h-64 w-full overflow-hidden rounded-md">
                <img
                  src={previewUrl}
                  alt={t`原图预览`}
                  className="h-full w-full rounded-md object-contain"
                />
              </div>
            </div>
          ) : null}

          {result.blob && result.url ? (
            <CompressResultCard
              fileName={result.fileName}
              size={result.size}
              originalSize={meta?.size ?? file?.size ?? 0}
              blob={result.blob}
              onSizeChange={setResultSize}
              preview={
                <div className="bg-muted/30 h-64 w-full overflow-hidden rounded-md">
                  <img
                    src={result.url}
                    alt={t`压缩结果预览`}
                    className="h-full w-full rounded-md object-contain"
                  />
                </div>
              }
            />
          ) : (
            <div className="border-border bg-card text-muted-foreground flex min-h-40 items-center justify-center rounded-lg border border-dashed p-2.5 text-xs">
              <Trans>压缩完成后在此预览输出</Trans>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
