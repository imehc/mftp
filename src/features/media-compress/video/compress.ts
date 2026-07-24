import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
} from "mediabunny";

export type VideoResolution = "original" | "1080p" | "720p" | "480p" | "360p";

/** Bitrate quality 10–100, step 10. Higher keeps more detail. */
export type VideoQuality = number;

export const VIDEO_QUALITY_MIN = 10;
export const VIDEO_QUALITY_MAX = 100;
export const VIDEO_QUALITY_STEP = 10;
export const DEFAULT_VIDEO_QUALITY = 50;

export interface VideoCompressOptions {
  resolution: VideoResolution;
  quality: VideoQuality;
  keepAudio: boolean;
}

export interface VideoMeta {
  width: number;
  height: number;
  duration: number;
  size: number;
  name: string;
  hasAudio: boolean;
}

export interface VideoCompressEstimate {
  estimatedBytes: number;
  estimatedMin: number;
  estimatedMax: number;
  targetBitrate: number;
  outputWidth: number;
  outputHeight: number;
  ratio: number;
}

export interface VideoCompressResult {
  blob: Blob;
  size: number;
  fileName: string;
}

const QUALITY_RATIO_HIGH = 0.8;
const QUALITY_RATIO_LOW = 0.15;
const PROBE_CACHE_LIMIT = 8;

function abortError(): DOMException {
  return new DOMException("压缩已取消", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort?: () => void,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    onAbort?.();
    return Promise.reject(abortError());
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", abort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const abort = () => {
      finish(() => {
        onAbort?.();
        reject(abortError());
      });
    };

    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function isCanceledError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    error instanceof ConversionCanceledError ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

export function clampVideoQuality(quality: number): number {
  const stepped =
    Math.round(quality / VIDEO_QUALITY_STEP) * VIDEO_QUALITY_STEP;
  return Math.min(
    VIDEO_QUALITY_MAX,
    Math.max(VIDEO_QUALITY_MIN, stepped),
  );
}

const RESOLUTION_SIZE: Record<
  Exclude<VideoResolution, "original">,
  { width: number; height: number }
> = {
  "1080p": { width: 1920, height: 1080 },
  "720p": { width: 1280, height: 720 },
  "480p": { width: 854, height: 480 },
  "360p": { width: 640, height: 360 },
};

const SUPPORTED_EXT = new Set(["mp4", "mov", "m4v"]);

export function isSupportedVideoFile(file: File | { name: string }): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_EXT.has(ext);
}

export function webCodecsSupported(): boolean {
  return (
    typeof VideoEncoder !== "undefined" &&
    typeof VideoDecoder !== "undefined"
  );
}

export function audioCodecsSupported(): boolean {
  return (
    typeof AudioEncoder !== "undefined" &&
    typeof AudioDecoder !== "undefined"
  );
}

export function qualityRatio(quality: VideoQuality): number {
  const q = clampVideoQuality(quality);
  const t = (q - VIDEO_QUALITY_MIN) / (VIDEO_QUALITY_MAX - VIDEO_QUALITY_MIN);
  return QUALITY_RATIO_LOW + (QUALITY_RATIO_HIGH - QUALITY_RATIO_LOW) * t;
}

export function resolveOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  resolution: VideoResolution,
): { width: number; height: number } {
  if (resolution === "original" || sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: sourceWidth, height: sourceHeight };
  }
  const target = RESOLUTION_SIZE[resolution];
  // Fit inside target box, keep aspect ratio, never upscale.
  const scale = Math.min(
    1,
    target.width / sourceWidth,
    target.height / sourceHeight,
  );
  const width = Math.max(2, Math.round((sourceWidth * scale) / 2) * 2);
  const height = Math.max(2, Math.round((sourceHeight * scale) / 2) * 2);
  return { width, height };
}

function maxBitrateForPixels(width: number, height: number): number {
  const pixels = width * height;
  if (pixels <= 921_600) return 8_000_000;
  if (pixels <= 2_097_152) return 16_000_000;
  if (pixels <= 5_652_480) return 30_000_000;
  return 50_000_000;
}

export function estimateVideoOutput(
  meta: VideoMeta,
  options: VideoCompressOptions,
): VideoCompressEstimate {
  const ratio = qualityRatio(options.quality);
  const { width, height } = resolveOutputSize(
    meta.width,
    meta.height,
    options.resolution,
  );
  const sourcePixels = Math.max(1, meta.width * meta.height);
  const targetPixels = Math.max(1, width * height);
  const scale = Math.min(1, targetPixels / sourcePixels);
  const audioFactor = options.keepAudio ? 1 : 0.8;
  const estimatedBytes = Math.max(
    8_192,
    Math.round(meta.size * ratio * scale * audioFactor),
  );

  const duration = Math.max(0.1, meta.duration || 10);
  const originalBitrate = (meta.size * 8) / duration;
  const capped = Math.min(originalBitrate, maxBitrateForPixels(width, height));
  const targetBitrate = Math.max(50_000, Math.round(capped * ratio));

  // Guard against extremely low bpp at high resolution (matches MeTool heuristic).
  const fps = 30;
  if (
    options.resolution === "original" &&
    width * height > 2_100_000 &&
    targetBitrate / (width * height * fps) < 0.02 &&
    targetBitrate / (1920 * 1080 * fps) >= 0.01
  ) {
    return estimateVideoOutput(meta, {
      ...options,
      resolution: "1080p",
    });
  }

  // ±40 % range — video compression varies hugely with content complexity.
  const estimatedMin = Math.max(8_192, Math.round(estimatedBytes * 0.6));
  const estimatedMax = Math.round(estimatedBytes * 1.4);

  return {
    estimatedBytes,
    estimatedMin,
    estimatedMax,
    targetBitrate,
    outputWidth: width,
    outputHeight: height,
    ratio: meta.size > 0 ? estimatedBytes / meta.size : 1,
  };
}

const probeCache = new Map<string, VideoMeta>();

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export async function probeVideoFile(
  file: File,
  signal?: AbortSignal,
): Promise<VideoMeta> {
  throwIfAborted(signal);
  const key = fileKey(file);
  const cached = probeCache.get(key);
  if (cached) return cached;

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  try {
    video.src = objectUrl;

    await raceAbort(
      new Promise<void>((resolve, reject) => {
        video.addEventListener("loadedmetadata", () => resolve(), {
          once: true,
        });
        video.addEventListener(
          "error",
          () => reject(new Error("无法读取视频信息")),
          { once: true },
        );
      }),
      signal,
      () => {
        video.removeAttribute("src");
        video.load();
      },
    );

    // Wait until dimensions are ready on some WebViews.
    let tries = 0;
    while (
      (video.videoWidth === 0 || video.videoHeight === 0) &&
      tries < 40
    ) {
      await raceAbort(
        new Promise((resolve) => window.setTimeout(resolve, 50)),
        signal,
      );
      tries += 1;
    }

    let hasAudio = false;
    try {
      const input = new Input({
        source: new BlobSource(file),
        formats: ALL_FORMATS,
      });
      try {
        const audioTracks = await raceAbort(
          input.getAudioTracks(),
          signal,
          () => input.dispose(),
        );
        hasAudio = audioTracks.length > 0;
      } finally {
        input.dispose();
      }
    } catch (error) {
      if (isCanceledError(error, signal)) {
        throw abortError();
      }
      hasAudio = true;
    }

    const meta: VideoMeta = {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      size: file.size,
      name: file.name,
      hasAudio,
    };
    probeCache.set(key, meta);
    if (probeCache.size > PROBE_CACHE_LIMIT) {
      const oldestKey = probeCache.keys().next().value;
      if (oldestKey) probeCache.delete(oldestKey);
    }
    return meta;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

export async function compressVideoFile(
  file: File,
  options: VideoCompressOptions,
  onProgress?: (progress: number, stage: string) => void,
  signal?: AbortSignal,
  metadata?: VideoMeta,
): Promise<VideoCompressResult> {
  if (!webCodecsSupported()) {
    throw new Error("当前环境不支持 WebCodecs，无法压缩视频");
  }
  if (!isSupportedVideoFile(file)) {
    throw new Error("仅支持 MP4、MOV、M4V 格式");
  }
  throwIfAborted(signal);

  const meta = metadata ?? (await probeVideoFile(file, signal));
  const estimate = estimateVideoOutput(meta, options);
  let width = estimate.outputWidth;
  let height = estimate.outputHeight;
  const targetBitrate = estimate.targetBitrate;

  // Recompute if original resolution was forced down inside estimate.
  if (
    options.resolution === "original" &&
    (width !== meta.width || height !== meta.height)
  ) {
    // keep forced dimensions
  } else if (options.resolution !== "original") {
    const size = resolveOutputSize(meta.width, meta.height, options.resolution);
    width = size.width;
    height = size.height;
  }

  throwIfAborted(signal);

  onProgress?.(2, "demuxing");

  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });

  const keepAudio = options.keepAudio && meta.hasAudio && audioCodecsSupported();
  const videoOptions: {
    codec: "avc";
    bitrate: number;
    width?: number;
    height?: number;
  } = {
    codec: "avc",
    bitrate: targetBitrate,
  };
  if (
    options.resolution !== "original" ||
    width !== meta.width ||
    height !== meta.height
  ) {
    // Prefer height constraint like MeTool; mediabunny keeps aspect ratio.
    videoOptions.height = height;
    if (width > 0) videoOptions.width = width;
  }

  let conversion: Conversion | null = null;

  // Mediabunny initialization can spend time demuxing before a Conversion exists.
  // Disposing the input lets cancel update UI immediately and prevents stale writes.
  const abort = () => {
    void conversion?.cancel();
    input.dispose();
    void output.cancel().catch(() => undefined);
  };

  try {
    conversion = await raceAbort(
      Conversion.init({
        input,
        output,
        video: videoOptions,
        audio: keepAudio
          ? { codec: "aac", bitrate: 128_000 }
          : { discard: true },
        showWarnings: false,
      }),
      signal,
      abort,
    );

    if (!conversion.isValid) {
      const detail = conversion.discardedTracks
        .map((track) => `${track.track.type}: ${track.reason}`)
        .join("; ");
      throw new Error(
        detail
          ? `无法转换该视频（${detail}）`
          : "无法转换该视频，可能是不支持的编码",
      );
    }

    conversion.onProgress = (progress) => {
      onProgress?.(Math.min(99, Math.round(progress * 100)), "compressing");
    };

    onProgress?.(5, "compressing");
    await raceAbort(conversion.execute(), signal, abort);
    throwIfAborted(signal);

    const buffer = target.buffer;
    if (!buffer) {
      throw new Error("压缩未生成输出数据");
    }

    onProgress?.(100, "done");
    const blob = new Blob([buffer], { type: "video/mp4" });
    const stem = file.name.replace(/\.[^.]+$/, "") || "video";

    // If compressed result is larger than original, return original instead.
    if (blob.size >= file.size) {
      return {
        blob: file,
        size: file.size,
        fileName: `${stem}.${file.name.split(".").pop()?.toLowerCase() ?? "mp4"}`,
      };
    }

    return {
      blob,
      size: blob.size,
      fileName: `${stem}.mp4`,
    };
  } catch (err) {
    if (isCanceledError(err, signal)) {
      throw abortError();
    }
    throw err;
  } finally {
    if (conversion) {
      conversion.onProgress = undefined as never;
    }
    try {
      input.dispose();
    } catch {
      // ignore
    }
  }
}
