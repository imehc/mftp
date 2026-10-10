import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  type ImageMeta,
  isSupportedImageFile,
  probeImageFile,
} from "~/features/media-compress/image/compress";
import {
  computeTargetSize,
  DEFAULT_RATIO,
  type DimensionMode,
  isTargetSizeAllowed,
  resizeImageFile,
  type ResizeMethod,
  type ResizeSize,
} from "~/features/media-compress/resize/resize";
import { parseDimensionInput } from "~/features/media-compress/resize/ResizeControls";
import type { CompressPhase } from "~/features/media-compress/types";
import { useCompressResult } from "~/features/media-compress/useCompressResult";
import { describeError } from "~/lib/errors";

import { useMediaProcessing } from "../MediaProcessingGuard";
import { useObjectUrl } from "../use-object-url";

export function useImageResize() {
  const { t } = useLingui();
  const mounted = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const probeRunRef = useRef(0);
  const [completedParams, setCompletedParams] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const { url: previewUrl, replaceUrl: replacePreviewUrl } = useObjectUrl();
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  const [taskPhase, setPhase] = useState<CompressPhase>("idle");
  useMediaProcessing("resize", taskPhase === "compressing");
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
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      probeRunRef.current += 1;
    };
  }, []);

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
  const phase =
    taskPhase === "done" && completedParams !== paramsKey ? "idle" : taskPhase;

  function resetResultState() {
    clearResult();
    setResultDims(null);
    setError(null);
  }

  async function applyFile(next: File | null) {
    if (!mounted.current || abortRef.current) return;
    const runId = probeRunRef.current + 1;
    probeRunRef.current = runId;
    resetResultState();
    setPhase("idle");
    setMeta(null);
    setFile(null);
    replacePreviewUrl(null);
    setCompletedParams(null);
    if (!next) return;
    if (!isSupportedImageFile(next)) {
      setError(t`仅支持 PNG、JPG、WebP 格式`);
      toast.error(t`仅支持 PNG、JPG、WebP 格式`);
      return;
    }
    setFile(next);
    replacePreviewUrl(next);
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
    if (!mounted.current || abortRef.current) return;
    if (!file || !meta) {
      toast.error(t`请先选择图片文件`);
      return;
    }
    if (!target || !targetAllowed) {
      toast.error(t`目标尺寸需在 1–10000 像素之间`);
      return;
    }
    if (phase === "done" && completedParams === paramsKey) {
      toast.message(t`参数未变化，无需重新处理`);
      return;
    }
    resetResultState();
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
      setCompletedParams(paramsKey);
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

  const cancel = () => abortRef.current?.abort();
  return {
    file,
    previewUrl,
    meta,
    phase,
    error,
    method,
    setMethod,
    ratio,
    setRatio,
    dimensionMode,
    onDimensionModeChange,
    widthInput,
    setWidthInput,
    heightInput,
    setHeightInput,
    edgeInput,
    setEdgeInput,
    resultDims,
    result,
    setResultSize,
    target,
    targetAllowed,
    applyFile,
    onProcess,
    cancel,
  };
}
