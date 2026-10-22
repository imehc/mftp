import { Trans, useLingui } from "@lingui/react/macro";
import { ImageIcon } from "lucide-react";
import { useRef } from "react";

import FixedSelect from "~/components/FixedSelect";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import {
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
import {
  IMAGE_QUALITY_MAX,
  IMAGE_QUALITY_MIN,
  IMAGE_QUALITY_STEP,
} from "~/features/media-compress/image/compress";
import { formatBytes } from "~/lib/format";

import MediaProgress from "../components/MediaProgress";
import { useImageCompress } from "./use-image-compress";

export default function ImageCompressPanel() {
  const { t } = useLingui();
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    file,
    previewUrl,
    meta,
    outputFormat,
    setOutputFormat,
    quality,
    setQuality,
    phase,
    progress,
    error,
    avifOk,
    estimate,
    result,
    setResultSize,
    applyFile,
    onCompress,
    cancel,
  } = useImageCompress();

  function onClear() {
    void applyFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const processingView = phase === "compressing";
  return processingView ? (
    <MediaProgress
      fileName={file?.name ?? ""}
      progress={progress}
      onCancel={cancel}
    />
  ) : (
    <div className="grid min-w-0 grid-cols-1 items-start gap-3 md:grid-cols-2">
      <CompressDropzone
        preview={
          previewUrl ? (
            <img
              src={previewUrl}
              alt={t`原图预览`}
              className="size-full object-contain"
            />
          ) : undefined
        }
        onClear={onClear}
        inputRef={inputRef}
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        nativeFilter={{
          title: t`选择图片`,
          filterName: t`图片文件`,
          extensions: ["png", "jpg", "jpeg", "webp"],
        }}
        disabled={phase === "probing"}
        onFile={(next) => void applyFile(next)}
        icon={<ImageIcon className="text-muted-foreground size-5" />}
        title={
          <>
            <span className="md:hidden">
              <Trans>选择一张图片</Trans>
            </span>
            <span className="hidden md:inline">
              <Trans>拖放图片到此处，或选择文件</Trans>
            </span>
          </>
        }
        description={<Trans>PNG · JPG · WebP</Trans>}
        pickLabel={<Trans>选择图片</Trans>}
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
                <Badge variant="outline">
                  {meta.width}×{meta.height}
                </Badge>
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
            <Field orientation="choice">
              <FieldLabel>
                <Trans>输出格式</Trans>
              </FieldLabel>
              <FixedSelect
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
                disabled={phase === "probing"}
              >
                <SelectTrigger className="w-full" aria-label={t`选择输出格式`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="jpg">JPG</SelectItem>
                    <SelectItem value="png">PNG</SelectItem>
                    <SelectItem value="webp">WebP</SelectItem>
                    {avifOk ? <SelectItem value="avif">AVIF</SelectItem> : null}
                  </SelectGroup>
                </SelectContent>
              </FixedSelect>
            </Field>

            <CompressQualityField
              value={quality}
              min={IMAGE_QUALITY_MIN}
              max={IMAGE_QUALITY_MAX}
              step={IMAGE_QUALITY_STEP}
              disabled={outputFormat === "png"}
              ariaLabel={t`选择压缩程度`}
              onChange={setQuality}
              rightHint={
                outputFormat === "png" ? (
                  <span className="min-w-0 text-right">
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
            showProgress={progress > 0}
            progress={progress}
            progressLabel={
              phase === "done" ? <Trans>完成</Trans> : <Trans>准备中</Trans>
            }
            primaryAction={
              <Button onClick={() => void onCompress()} disabled={!file}>
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
