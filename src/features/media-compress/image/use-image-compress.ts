import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  compressImageFile,
  DEFAULT_IMAGE_QUALITY,
  detectImageOutputFormat,
  estimateImageOutput,
  type ImageMeta,
  type ImageOutputFormat,
  isAvifExportSupported,
  isSupportedImageFile,
  probeImageFile,
} from "~/features/media-compress/image/compress";
import type { CompressPhase } from "~/features/media-compress/types";
import { useCompressResult } from "~/features/media-compress/useCompressResult";
import { describeError } from "~/lib/errors";

import { useMediaProcessing } from "../MediaProcessingGuard";
import { useObjectUrl } from "../use-object-url";

export function useImageCompress() {
  const { t } = useLingui();
  const mounted = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const { url: previewUrl, replaceUrl: replacePreviewUrl } = useObjectUrl();
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  const [outputFormat, setOutputFormat] = useState<ImageOutputFormat>("jpg");
  const [quality, setQuality] = useState(DEFAULT_IMAGE_QUALITY);
  const [taskPhase, setPhase] = useState<CompressPhase>("idle");
  useMediaProcessing("image", taskPhase === "compressing");
  const [taskProgress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [avifOk, setAvifOk] = useState(false);
  const [completedParams, setCompletedParams] = useState<string | null>(null);
  const probeRunRef = useRef(0);
  const { result, clearResult, setResult, setResultSize } = useCompressResult();
  useEffect(() => {
    let active = true;
    void isAvifExportSupported().then((supported) => {
      if (active) setAvifOk(supported);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      probeRunRef.current += 1;
    };
  }, []);
  const estimate = (() => {
    if (!meta) return null;
    return estimateImageOutput(meta, {
      outputFormat,
      quality,
    });
  })();
  const paramsKey = `${outputFormat}-${quality}`;
  const phase =
    taskPhase === "done" && completedParams !== paramsKey ? "idle" : taskPhase;
  const progress = taskPhase === "done" && phase === "idle" ? 0 : taskProgress;

  function resetResultState() {
    clearResult();
    setError(null);
    setProgress(0);
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

    // 默认让导出格式与源文件保持一致。
    setOutputFormat(detectImageOutputFormat(next));
    setFile(next);
    replacePreviewUrl(next);
    setPhase("probing");
    try {
      const info = await probeImageFile(next);
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
    if (!mounted.current || abortRef.current) return;
    if (!file) {
      toast.error(t`请先选择图片文件`);
      return;
    }
    if (outputFormat === "avif" && !avifOk) {
      toast.error(t`当前环境不支持导出 AVIF`);
      return;
    }
    if (phase === "done" && completedParams === paramsKey) {
      toast.message(t`参数未变化，无需重新处理`);
      return;
    }
    resetResultState();

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
      setCompletedParams(paramsKey);
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
  };
}
