import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { CompressPhase } from "~/features/media-compress/types";
import { useCompressResult } from "~/features/media-compress/useCompressResult";
import {
  audioCodecsSupported,
  compressVideoFile,
  DEFAULT_VIDEO_QUALITY,
  estimateVideoOutput,
  isSupportedVideoFile,
  probeVideoFile,
  type VideoMeta,
  type VideoResolution,
  webCodecsSupported,
} from "~/features/media-compress/video/compress";
import { describeError } from "~/lib/errors";

import { useMediaProcessing } from "../MediaProcessingGuard";
import { useObjectUrl } from "../use-object-url";

export function useVideoCompress() {
  const { t } = useLingui();
  const mounted = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const { url: previewUrl, replaceUrl: replacePreviewUrl } = useObjectUrl();
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [resolution, setResolution] = useState<VideoResolution>("original");
  const [quality, setQuality] = useState(DEFAULT_VIDEO_QUALITY);
  const [keepAudio, setKeepAudio] = useState(true);
  const [taskPhase, setPhase] = useState<CompressPhase>("idle");
  useMediaProcessing("video", taskPhase === "compressing");
  const [taskProgress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const codecOk = webCodecsSupported();
  const audioCodecOk = audioCodecsSupported();
  const [completedParams, setCompletedParams] = useState<string | null>(null);
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
  const phase =
    taskPhase === "done" && completedParams !== paramsKey ? "idle" : taskPhase;
  const progress = taskPhase === "done" && phase === "idle" ? 0 : taskProgress;
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
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      probeRunRef.current += 1;
    };
  }, []);

  async function applyFile(next: File | null) {
    if (!mounted.current || abortRef.current) return;
    const runId = probeRunRef.current + 1;
    probeRunRef.current = runId;
    setCompletedParams(null);
    resetResultState();
    setPhase("idle");
    setMeta(null);
    setFile(null);
    replacePreviewUrl(null);
    if (!next) return;
    if (!isSupportedVideoFile(next)) {
      setError(t`仅支持 MP4、MOV、M4V 格式`);
      toast.error(t`仅支持 MP4、MOV、M4V 格式`);
      return;
    }
    setFile(next);
    replacePreviewUrl(next);
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
    if (!mounted.current || abortRef.current) return;
    if (!file) {
      toast.error(t`请先选择视频文件`);
      return;
    }
    if (!codecOk) {
      toast.error(t`当前环境不支持 WebCodecs`);
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
      setCompletedParams(paramsKey);
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

  const displayStage = taskPhase === "done" && phase === "idle" ? "" : stage;
  const stageLabel =
    displayStage === "demuxing"
      ? t`解析中`
      : displayStage === "compressing"
        ? t`编码中`
        : displayStage === "done"
          ? t`完成`
          : displayStage === "reading"
            ? t`读取中`
            : phase === "probing"
              ? t`读取信息`
              : t`准备中`;
  const cancel = () => abortRef.current?.abort();
  return {
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
  };
}
