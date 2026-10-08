import { modelError } from "../domain/errors";

export function captureSize(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  )
    throw modelError("capture");
  const scale = Math.min(
    1,
    4096 / Math.max(width, height),
    Math.sqrt(8_000_000 / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/** 必须紧跟渲染同步复制，避免 WebGL 默认绘图缓冲在异步编码前失效。 */
export function capturePng(source: HTMLCanvasElement): Promise<Blob> {
  const size = captureSize(source.width, source.height);
  const image = document.createElement("canvas");
  image.width = size.width;
  image.height = size.height;
  const context = image.getContext("2d");
  if (!context) {
    image.width = image.height = 0;
    throw modelError("capture");
  }
  return new Promise<Blob>((resolve, reject) => {
    try {
      context.drawImage(source, 0, 0, size.width, size.height);
      image.toBlob((blob) => {
        image.width = image.height = 0;
        if (blob?.size && blob.type === "image/png") resolve(blob);
        else reject(modelError("capture"));
      }, "image/png");
    } catch {
      image.width = image.height = 0;
      reject(modelError("capture"));
    }
  });
}
