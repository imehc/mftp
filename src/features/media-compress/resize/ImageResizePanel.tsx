import MediaProgress from "../components/MediaProgress";
import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Slider } from "~/components/ui/slider";
import { CompressDropzone } from "~/features/media-compress/components/CompressDropzone";
import { CompressResultCard } from "~/features/media-compress/components/CompressResultCard";
import { formatBytes } from "~/lib/format";
import {
  isSupportedImageFile,
  probeImageFile,
  type ImageMeta,
} from "~/features/media-compress/image/compress";
import {
  DimensionInput,
  DIMENSION_MODES,
  dimensionModeLabel,
  isDimensionMode,
  parseDimensionInput,
  ResizeMethodTabs,
} from "~/features/media-compress/resize/ResizeControls";
import {
  computeTargetSize,
  DEFAULT_RATIO,
  isTargetSizeAllowed,
  RATIO_MAX,
  RATIO_MIN,
  RATIO_STEP,
  resizeImageFile,
  type DimensionMode,
  type ResizeMethod,
  type ResizeSize,
} from "~/features/media-compress/resize/resize";
import type { CompressPhase } from "~/features/media-compress/types";
import { useMediaProcessing } from "../MediaProcessingGuard";
import { useCompressResult } from "~/features/media-compress/useCompressResult";
import { describeError } from "~/lib/errors";
export default function ImageResizePanel() {
  const { t } = useLingui();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const probeRunRef = useRef(0);
  const lastParamsRef = useRef<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  const [phase, setPhase] = useState<CompressPhase>("idle");
  useMediaProcessing("resize", phase === "compressing");
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<ResizeMethod>("ratio");
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [dimensionMode, setDimensionMode] = useState<DimensionMode>("width");
  const [widthInput, setWidthInput] = useState("");
  const [heightInput, setHeightInput] = useState("");
  const [edgeInput, setEdgeInput] = useState("");
  const [resultDims, setResultDims] = useState<ResizeSize | null>(null);
  const { result, clearResult, setResult, setResultSize } = useCompressResult();
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

  // 预填输入，使每种模式都从源尺寸（即原样）开始。
  function seedInputs(info: ImageMeta, mode: DimensionMode) {
    setWidthInput(String(info.width));
    setHeightInput(String(info.height));
    setEdgeInput(
      String(
        mode === "shortest"
          ? Math.min(info.width, info.height)
          : Math.max(info.width, info.height),
      ),
    );
  }
  const target = (() => {
    if (!meta) return null;
    return computeTargetSize(
      {
        width: meta.width,
        height: meta.height,
      },
      {
        method,
        ratio,
        dimensionMode,
        width: parseDimensionInput(widthInput),
        height: parseDimensionInput(heightInput),
        edge: parseDimensionInput(edgeInput),
      },
    );
  })();
  const targetAllowed = target != null && isTargetSizeAllowed(target);
  const paramsKey = `${method}-${ratio}-${dimensionMode}-${widthInput}-${heightInput}-${edgeInput}`;
  // 完成后若任意参数发生变化，允许重新处理。
  useEffect(() => {
    if (phase !== "done" || lastParamsRef.current === paramsKey) return;
    setPhase("idle");
  }, [paramsKey, phase]);
  function resetResultState() {
    clearResult();
    setResultDims(null);
    setError(null);
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
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setPhase("probing");
    try {
      const info = await probeImageFile(next);
      if (probeRunRef.current !== runId) return;
      setMeta(info);
      seedInputs(info, dimensionMode);
      setPhase("idle");
    } catch (err) {
      if (probeRunRef.current !== runId) return;
      setError(describeError(err));
      setPhase("error");
      toast.error(describeError(err));
    }
  }
  function onDimensionModeChange(next: DimensionMode) {
    setDimensionMode(next);
    // 重新预填，使切换模式时总是先预览原样尺寸。
    if (meta) seedInputs(meta, next);
  }
  async function onProcess() {
    if (!file || !meta) {
      toast.error(t`请先选择图片文件`);
      return;
    }
    if (!target || !targetAllowed) {
      toast.error(t`目标尺寸需在 1–10000 像素之间`);
      return;
    }
    if (phase === "done" && lastParamsRef.current === paramsKey) {
      toast.message(t`参数未变化，无需重新处理`);
      return;
    }
    resetResultState();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("compressing");
    try {
      const output = await resizeImageFile(file, target, controller.signal);
      if (abortRef.current !== controller) return;
      setResult(output);
      setResultDims({
        width: output.width,
        height: output.height,
      });
      setPhase("done");
      lastParamsRef.current = paramsKey;
      toast.success(t`处理完成`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (abortRef.current !== controller) return;
        setPhase("idle");
        return;
      }
      if (abortRef.current !== controller) return;
      const message = describeError(err);
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
  const processing = phase === "compressing";
  const targetWidth = target?.width;
  const targetHeight = target?.height;
  const metaWidth = meta?.width;
  const metaHeight = meta?.height;
  const processingView = phase === "compressing";
  return processingView ? (
    <MediaProgress
      fileName={file?.name ?? ""}
      onCancel={() => abortRef.current?.abort()}
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
        disabled={processing}
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
        description={<Trans>PNG · JPG · WebP，保持原格式输出</Trans>}
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
        <section className="border-border bg-card min-w-0 rounded-lg border p-3">
          <h2 className="mb-3 text-sm font-semibold">
            <Trans>输出设置</Trans>
          </h2>
          <div className="grid gap-3">
            <Field>
              <FieldLabel>
                <Trans>缩放方式</Trans>
              </FieldLabel>
              <ResizeMethodTabs
                value={method}
                onChange={setMethod}
                disabled={processing}
              />
            </Field>

            {method === "ratio" ? (
              <Field className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel>
                    <Trans>缩放比例</Trans>
                  </FieldLabel>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {ratio}%
                  </span>
                </div>
                <Slider
                  min={RATIO_MIN}
                  max={RATIO_MAX}
                  step={RATIO_STEP}
                  value={[ratio]}
                  onValueChange={(values) => {
                    const next = values[0];
                    if (typeof next === "number") setRatio(next);
                  }}
                  disabled={processing}
                  aria-label={t`选择缩放比例`}
                  className="mt-1"
                />
                <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
                  <span>
                    <Trans>缩小</Trans>
                  </span>
                  <span>
                    <Trans>放大</Trans>
                  </span>
                </div>
              </Field>
            ) : (
              <Field>
                <FieldLabel>
                  <Trans>尺寸模式</Trans>
                </FieldLabel>
                <Select
                  value={dimensionMode}
                  onValueChange={(value) => {
                    if (isDimensionMode(value)) onDimensionModeChange(value);
                  }}
                  disabled={processing}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={t`选择尺寸模式`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {DIMENSION_MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {dimensionModeLabel(mode)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>

          {method === "dimension" ? (
            <div className="mt-3">
              <div className="grid gap-3 md:grid-cols-2">
                {(dimensionMode === "exact" || dimensionMode === "width") && (
                  <DimensionInput
                    label={<Trans>宽度</Trans>}
                    value={widthInput}
                    disabled={processing}
                    ariaLabel={t`目标宽度`}
                    onChange={setWidthInput}
                  />
                )}
                {(dimensionMode === "exact" || dimensionMode === "height") && (
                  <DimensionInput
                    label={<Trans>高度</Trans>}
                    value={heightInput}
                    disabled={processing}
                    ariaLabel={t`目标高度`}
                    onChange={setHeightInput}
                  />
                )}
                {dimensionMode === "longest" && (
                  <DimensionInput
                    label={<Trans>最大边长</Trans>}
                    value={edgeInput}
                    disabled={processing}
                    ariaLabel={t`目标最大边长`}
                    onChange={setEdgeInput}
                  />
                )}
                {dimensionMode === "shortest" && (
                  <DimensionInput
                    label={<Trans>最小边长</Trans>}
                    value={edgeInput}
                    disabled={processing}
                    ariaLabel={t`目标最小边长`}
                    onChange={setEdgeInput}
                  />
                )}
              </div>
              {dimensionMode === "exact" ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  <Trans>宽高与原图比例不同时，图片会被拉伸变形</Trans>
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="border-border mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
              {target ? (
                <>
                  <Badge variant="outline">
                    <Trans>
                      输出 {targetWidth} × {targetHeight} px
                    </Trans>
                  </Badge>
                  {meta ? (
                    <span>
                      <Trans>
                        原图 {metaWidth} × {metaHeight} px
                      </Trans>
                    </span>
                  ) : null}
                </>
              ) : (
                <span>
                  {meta ? (
                    <Trans>请输入有效的目标尺寸</Trans>
                  ) : (
                    <Trans>选择图片后显示输出尺寸</Trans>
                  )}
                </span>
              )}
            </div>
            <div className="flex gap-2 max-md:w-full max-md:[&>button]:flex-1">
              <Button
                onClick={() => void onProcess()}
                disabled={!file || !targetAllowed || processing}
              >
                <Trans>开始处理</Trans>
              </Button>
            </div>
          </div>

          {target && !targetAllowed ? (
            <p className="text-destructive mt-2 text-xs">
              <Trans>目标尺寸需在 1–10000 像素之间</Trans>
            </p>
          ) : null}
          {error ? (
            <p className="text-destructive mt-2 text-xs">{error}</p>
          ) : null}
        </section>
      ) : null}

      <div className="md:col-span-2">
        {result.blob && result.url ? (
          <CompressResultCard
            title={<Trans>处理结果</Trans>}
            fileName={result.fileName}
            size={result.size}
            originalSize={meta?.size ?? file?.size ?? 0}
            blob={result.blob}
            onSizeChange={setResultSize}
            extraBadges={
              resultDims ? (
                <Badge variant="outline" className="shrink-0">
                  {resultDims.width}×{resultDims.height}
                </Badge>
              ) : null
            }
            preview={
              <div className="bg-muted/30 h-64 w-full overflow-hidden rounded-md">
                <img
                  src={result.url}
                  alt={t`处理结果预览`}
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
