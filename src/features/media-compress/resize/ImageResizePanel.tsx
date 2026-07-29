import { useEffect, useMemo, useRef, useState } from "react";
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
import { Slider } from "~/components/ui/slider";
import { CompressDropzone } from "~/features/media-compress/components/CompressDropzone";
import { CompressResultCard } from "~/features/media-compress/components/CompressResultCard";
import { formatBytes } from "~/features/media-compress/format";
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
import { useCompressResult } from "~/features/media-compress/useCompressResult";

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
  const [error, setError] = useState<string | null>(null);

  const [method, setMethod] = useState<ResizeMethod>("ratio");
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [dimensionMode, setDimensionMode] = useState<DimensionMode>("width");
  const [widthInput, setWidthInput] = useState("");
  const [heightInput, setHeightInput] = useState("");
  const [edgeInput, setEdgeInput] = useState("");
  const [resultDims, setResultDims] = useState<ResizeSize | null>(null);

  const { result, clearResult, setResult, setResultSize } =
    useCompressResult();

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

  // Seed inputs so every mode starts at the source dimensions (identity).
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

  const target = useMemo(() => {
    if (!meta) return null;
    return computeTargetSize(
      { width: meta.width, height: meta.height },
      {
        method,
        ratio,
        dimensionMode,
        width: parseDimensionInput(widthInput),
        height: parseDimensionInput(heightInput),
        edge: parseDimensionInput(edgeInput),
      },
    );
  }, [meta, method, ratio, dimensionMode, widthInput, heightInput, edgeInput]);

  const targetAllowed = target != null && isTargetSizeAllowed(target);

  const paramsKey = useMemo(
    () =>
      `${method}-${ratio}-${dimensionMode}-${widthInput}-${heightInput}-${edgeInput}`,
    [method, ratio, dimensionMode, widthInput, heightInput, edgeInput],
  );
  // Allow re-processing once any parameter changed after a completed run.
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
      setError(String(err));
      setPhase("error");
      toast.error(String(err));
    }
  }

  function onDimensionModeChange(next: DimensionMode) {
    setDimensionMode(next);
    // Re-seed so switching modes always previews the identity size first.
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
      setResultDims({ width: output.width, height: output.height });
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

  function onClear() {
    void applyFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const processing = phase === "compressing";

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
        disabled={processing}
        onFile={(next) => void applyFile(next)}
        icon={<ImageIcon className="size-5 text-muted-foreground" />}
        title={<Trans>拖放图片到此处，或选择文件</Trans>}
        description={<Trans>PNG · JPG · WebP，保持原格式输出</Trans>}
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

      <section className="rounded-lg border border-border bg-card p-2.5">
        <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
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
                <span className="text-xs tabular-nums text-muted-foreground">
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
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
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
                <SelectTrigger className="w-full" aria-label={t`选择尺寸模式`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIMENSION_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {dimensionModeLabel(mode)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>

        {method === "dimension" ? (
          <div className="mt-3">
            <div className="grid gap-3 sm:grid-cols-2">
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
              <p className="mt-2 text-xs text-muted-foreground">
                <Trans>宽高与原图比例不同时，图片会被拉伸变形</Trans>
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {target ? (
              <>
                <Badge variant="outline">
                  <Trans>
                    输出 {target.width} × {target.height} px
                  </Trans>
                </Badge>
                {meta ? (
                  <span>
                    <Trans>
                      原图 {meta.width} × {meta.height} px
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
          <Button
            size="sm"
            onClick={() => void onProcess()}
            disabled={!file || !targetAllowed || processing}
          >
            {processing ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : null}
            <Trans>开始处理</Trans>
          </Button>
        </div>

        {target && !targetAllowed ? (
          <p className="mt-2 text-xs text-destructive">
            <Trans>目标尺寸需在 1–10000 像素之间</Trans>
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-xs text-destructive">{error}</p>
        ) : null}
      </section>

      {(previewUrl || result.url) && (
        <section className="grid gap-2 md:grid-cols-2">
          {previewUrl ? (
            <div className="flex flex-col rounded-lg border border-border bg-card p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  <Trans>原图</Trans>
                </span>
                <div className="flex items-center gap-1.5">
                  {meta ? (
                    <Badge variant="outline">
                      {meta.width}×{meta.height}
                    </Badge>
                  ) : null}
                  {file ? (
                    <Badge variant="outline">{formatBytes(file.size)}</Badge>
                  ) : null}
                </div>
              </div>
              <div className="mt-auto h-64 w-full overflow-hidden rounded-md bg-muted/30">
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
                <div className="h-64 w-full overflow-hidden rounded-md bg-muted/30">
                  <img
                    src={result.url}
                    alt={t`处理结果预览`}
                    className="h-full w-full rounded-md object-contain"
                  />
                </div>
              }
            />
          ) : (
            <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-border bg-card p-2.5 text-xs text-muted-foreground">
              <Trans>处理完成后在此预览输出</Trans>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
