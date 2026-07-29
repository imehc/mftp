import { msg } from "@lingui/core/macro";
import {
  canvasToBlob,
  detectImageOutputFormat,
  extensionForFormat,
  isSupportedImageFile,
  mimeForFormat,
  stripExtension,
} from "~/features/media-compress/image/compress";
import { translate } from "~/i18n/translate";

export type ResizeMethod = "ratio" | "dimension";

export type DimensionMode =
  | "exact"
  | "width"
  | "height"
  | "longest"
  | "shortest";

export const RATIO_MIN = 1;
export const RATIO_MAX = 200;
export const RATIO_STEP = 1;
export const DEFAULT_RATIO = 50;

export const DIMENSION_MIN = 1;
/** Per-side cap; mobile WebViews reject very large canvases. */
export const DIMENSION_MAX = 10_000;

/** Re-encode quality for lossy formats; PNG stays lossless. */
const RESIZE_ENCODE_QUALITY = 0.92;

export interface ResizeSize {
  width: number;
  height: number;
}

export interface ResizeOptions {
  method: ResizeMethod;
  /** Percentage 1–200; used when method is "ratio". */
  ratio: number;
  /** Sub-mode; used when method is "dimension". */
  dimensionMode: DimensionMode;
  /** Target width for "exact" / "width" modes. */
  width: number | null;
  /** Target height for "exact" / "height" modes. */
  height: number | null;
  /** Target edge length for "longest" / "shortest" modes. */
  edge: number | null;
}

export interface ImageResizeResult {
  blob: Blob;
  size: number;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
}

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RATIO;
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, Math.round(value)));
}

export function clampDimension(value: number): number {
  if (!Number.isFinite(value)) return DIMENSION_MIN;
  return Math.min(DIMENSION_MAX, Math.max(DIMENSION_MIN, Math.round(value)));
}

function isPositiveInt(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value >= 1;
}

function roundSide(value: number): number {
  return Math.max(1, Math.round(value));
}

/**
 * Resolve the output size for the given source and options.
 * Returns null when the required input for the active mode is missing.
 * The result is NOT clamped — use isTargetSizeAllowed to validate.
 */
export function computeTargetSize(
  source: ResizeSize,
  options: ResizeOptions,
): ResizeSize | null {
  if (source.width < 1 || source.height < 1) return null;

  if (options.method === "ratio") {
    const scale = clampRatio(options.ratio) / 100;
    return {
      width: roundSide(source.width * scale),
      height: roundSide(source.height * scale),
    };
  }

  switch (options.dimensionMode) {
    case "exact": {
      if (!isPositiveInt(options.width) || !isPositiveInt(options.height)) {
        return null;
      }
      return {
        width: Math.round(options.width),
        height: Math.round(options.height),
      };
    }
    case "width": {
      if (!isPositiveInt(options.width)) return null;
      const width = Math.round(options.width);
      return {
        width,
        height: roundSide((source.height * width) / source.width),
      };
    }
    case "height": {
      if (!isPositiveInt(options.height)) return null;
      const height = Math.round(options.height);
      return {
        width: roundSide((source.width * height) / source.height),
        height,
      };
    }
    case "longest": {
      if (!isPositiveInt(options.edge)) return null;
      const edge = Math.round(options.edge);
      // Square images take the width branch.
      if (source.width >= source.height) {
        return {
          width: edge,
          height: roundSide((source.height * edge) / source.width),
        };
      }
      return {
        width: roundSide((source.width * edge) / source.height),
        height: edge,
      };
    }
    case "shortest": {
      if (!isPositiveInt(options.edge)) return null;
      const edge = Math.round(options.edge);
      if (source.width <= source.height) {
        return {
          width: edge,
          height: roundSide((source.height * edge) / source.width),
        };
      }
      return {
        width: roundSide((source.width * edge) / source.height),
        height: edge,
      };
    }
  }
}

/** Both sides within [DIMENSION_MIN, DIMENSION_MAX]. */
export function isTargetSizeAllowed(target: ResizeSize): boolean {
  return (
    target.width >= DIMENSION_MIN &&
    target.width <= DIMENSION_MAX &&
    target.height >= DIMENSION_MIN &&
    target.height <= DIMENSION_MAX
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException(translate(msg`处理已取消`), "AbortError");
  }
}

export async function resizeImageFile(
  file: File,
  target: ResizeSize,
  signal?: AbortSignal,
): Promise<ImageResizeResult> {
  if (!isSupportedImageFile(file)) {
    throw new Error(translate(msg`仅支持 PNG、JPG、WebP 格式`));
  }
  if (!isTargetSizeAllowed(target)) {
    throw new Error(translate(msg`目标尺寸需在 1–10000 像素之间`));
  }
  throwIfAborted(signal);

  const bitmap = await createImageBitmap(file);
  try {
    throwIfAborted(signal);

    // Progressive halving before the final draw: a single high-smoothing
    // pass still aliases when shrinking beyond ~2×.
    let current: ImageBitmap | HTMLCanvasElement = bitmap;
    let currentWidth = bitmap.width;
    let currentHeight = bitmap.height;
    while (
      currentWidth >= target.width * 2 &&
      currentHeight >= target.height * 2
    ) {
      const nextWidth = Math.max(target.width, Math.round(currentWidth / 2));
      const nextHeight = Math.max(target.height, Math.round(currentHeight / 2));
      const step = document.createElement("canvas");
      step.width = nextWidth;
      step.height = nextHeight;
      const stepContext = step.getContext("2d");
      if (!stepContext) break;
      stepContext.imageSmoothingEnabled = true;
      stepContext.imageSmoothingQuality = "high";
      stepContext.drawImage(current, 0, 0, nextWidth, nextHeight);
      current = step;
      currentWidth = nextWidth;
      currentHeight = nextHeight;
    }

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error(translate(msg`无法创建画布上下文`));
    }

    const outputFormat = detectImageOutputFormat(file);
    // JPEG has no alpha; fill white to avoid black matte on transparent PNG.
    if (outputFormat === "jpg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      current,
      0,
      0,
      currentWidth,
      currentHeight,
      0,
      0,
      target.width,
      target.height,
    );

    throwIfAborted(signal);

    const mimeType = mimeForFormat(outputFormat);
    const blob = await canvasToBlob(
      canvas,
      mimeType,
      outputFormat === "png" ? undefined : RESIZE_ENCODE_QUALITY,
    );
    throwIfAborted(signal);

    const stem = stripExtension(file.name) || "image";
    return {
      blob,
      size: blob.size,
      fileName: `${stem}-${target.width}x${target.height}.${extensionForFormat(outputFormat)}`,
      mimeType,
      width: target.width,
      height: target.height,
    };
  } finally {
    bitmap.close();
  }
}
