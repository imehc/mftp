import {
  baseName,
  downloadBlob,
  formatBytes,
  stripExtension,
} from "~/features/media-compress/format";

export type ImageInputFormat = "png" | "jpg" | "jpeg" | "webp";
export type ImageOutputFormat = "jpg" | "png" | "webp" | "avif";

/** Encoder quality 10–100, step 10. Higher keeps more detail. */
export type ImageQuality = number;

export const IMAGE_QUALITY_MIN = 10;
export const IMAGE_QUALITY_MAX = 100;
export const IMAGE_QUALITY_STEP = 10;
export const DEFAULT_IMAGE_QUALITY = 80;

export interface ImageCompressOptions {
  outputFormat: ImageOutputFormat;
  quality: ImageQuality;
}

export interface ImageMeta {
  name: string;
  size: number;
  width: number;
  height: number;
  type: string;
}

export interface ImageCompressEstimate {
  estimatedBytes: number;
  estimatedMin: number;
  estimatedMax: number;
  qualityValue: number;
  mimeType: string;
  ratio: number;
}

export interface ImageCompressResult {
  blob: Blob;
  size: number;
  fileName: string;
  mimeType: string;
}

const INPUT_EXT = new Set(["png", "jpg", "jpeg", "webp"]);

const ESTIMATE_HIGH: Record<ImageOutputFormat, number> = {
  jpg: 0.55,
  png: 0.95,
  webp: 0.4,
  avif: 0.28,
};

const ESTIMATE_LOW: Record<ImageOutputFormat, number> = {
  jpg: 0.14,
  png: 0.55,
  webp: 0.1,
  avif: 0.08,
};

export function clampImageQuality(quality: number): number {
  const stepped =
    Math.round(quality / IMAGE_QUALITY_STEP) * IMAGE_QUALITY_STEP;
  return Math.min(
    IMAGE_QUALITY_MAX,
    Math.max(IMAGE_QUALITY_MIN, stepped),
  );
}

/** Canvas encoder quality in 0–1. */
export function imageQualityValue(quality: number): number {
  return clampImageQuality(quality) / 100;
}

function estimateFactor(
  format: ImageOutputFormat,
  quality: number,
): number {
  const q = clampImageQuality(quality);
  const t = (q - IMAGE_QUALITY_MIN) / (IMAGE_QUALITY_MAX - IMAGE_QUALITY_MIN);
  const high = ESTIMATE_HIGH[format];
  const low = ESTIMATE_LOW[format];
  return low + (high - low) * t;
}

export { baseName, downloadBlob, formatBytes, stripExtension };

export function isSupportedImageFile(file: File | { name: string }): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return INPUT_EXT.has(ext);
}

/** Map source extension to export format; jpeg → jpg. Falls back to webp. */
export function detectImageOutputFormat(
  file: File | { name: string },
): ImageOutputFormat {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "png";
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "webp") return "webp";
  if (ext === "avif") return "avif";
  return "webp";
}

export function mimeForFormat(format: ImageOutputFormat): string {
  switch (format) {
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
  }
}

export function extensionForFormat(format: ImageOutputFormat): string {
  return format === "jpg" ? "jpg" : format;
}

export function estimateImageOutput(
  meta: ImageMeta,
  options: ImageCompressOptions,
): ImageCompressEstimate {
  const qualityValue = imageQualityValue(options.quality);
  const factor = estimateFactor(options.outputFormat, options.quality);
  const estimatedBytes = Math.max(1_024, Math.round(meta.size * factor));
  // ±30 % range to reflect content-dependent variance.
  const estimatedMin = Math.max(1_024, Math.round(estimatedBytes * 0.7));
  const estimatedMax = Math.round(estimatedBytes * 1.3);
  return {
    estimatedBytes,
    estimatedMin,
    estimatedMax,
    qualityValue,
    mimeType: mimeForFormat(options.outputFormat),
    ratio: meta.size > 0 ? estimatedBytes / meta.size : 1,
  };
}

export async function probeImageFile(file: File): Promise<ImageMeta> {
  if (!isSupportedImageFile(file)) {
    throw new Error("仅支持 PNG、JPG、WebP 格式");
  }
  const bitmap = await createImageBitmap(file);
  try {
    return {
      name: file.name,
      size: file.size,
      width: bitmap.width,
      height: bitmap.height,
      type: file.type || "application/octet-stream",
    };
  } finally {
    bitmap.close();
  }
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`浏览器无法导出 ${mimeType}`));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

export async function compressImageFile(
  file: File,
  options: ImageCompressOptions,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<ImageCompressResult> {
  if (!isSupportedImageFile(file)) {
    throw new Error("仅支持 PNG、JPG、WebP 格式");
  }
  if (signal?.aborted) {
    throw new DOMException("压缩已取消", "AbortError");
  }

  onProgress?.(10);
  const bitmap = await createImageBitmap(file);
  if (signal?.aborted) {
    bitmap.close();
    throw new DOMException("压缩已取消", "AbortError");
  }
  onProgress?.(35);

  try {
    if (signal?.aborted) {
      throw new DOMException("压缩已取消", "AbortError");
    }

    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("无法创建画布上下文");
    }

    // JPEG has no alpha; fill white to avoid black matte on transparent PNG.
    if (options.outputFormat === "jpg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0);
    onProgress?.(70);

    if (signal?.aborted) {
      throw new DOMException("压缩已取消", "AbortError");
    }

    const mimeType = mimeForFormat(options.outputFormat);
    const quality =
      options.outputFormat === "png"
        ? undefined
        : imageQualityValue(options.quality);

    let blob: Blob;
    try {
      blob = await canvasToBlob(canvas, mimeType, quality);
    } catch (error) {
      if (options.outputFormat === "avif") {
        throw new Error("当前环境不支持导出 AVIF，请改用 WebP 或 JPG");
      }
      throw error;
    }

    if (signal?.aborted) {
      throw new DOMException("压缩已取消", "AbortError");
    }

    onProgress?.(100);
    const stem = stripExtension(file.name) || "image";
    const ext = extensionForFormat(options.outputFormat);

    // If compressed result is larger than original, return original instead.
    if (blob.size >= file.size) {
      const origMime = file.type || mimeForFormat(options.outputFormat);
      return {
        blob: file,
        size: file.size,
        fileName: `${stem}.${file.name.split(".").pop()?.toLowerCase() ?? ext}`,
        mimeType: origMime,
      };
    }

    return {
      blob,
      size: blob.size,
      fileName: `${stem}.${ext}`,
      mimeType,
    };
  } finally {
    bitmap.close();
  }
}

export async function isAvifExportSupported(): Promise<boolean> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const blob = await canvasToBlob(canvas, "image/avif", 0.5);
    return blob.type.includes("avif") && blob.size > 0;
  } catch {
    return false;
  }
}
