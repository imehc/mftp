import { modelError } from "../domain/errors";
import { RecordingBuffer } from "./recording-buffer";

export type RecordingEncoder = {
  extension: "mp4" | "webm";
  width: number;
  height: number;
  add: (source: HTMLCanvasElement, timestamp: number) => Promise<void>;
  finish: (duration: number) => Promise<Blob>;
  cancel: () => Promise<void>;
};

export function recordingSize(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 2 ||
    height < 2
  )
    throw modelError("recording_failed");
  const scale = Math.min(
    1,
    1920 / Math.max(width, height),
    Math.sqrt((1920 * 1080) / (width * height)),
  );
  return {
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2),
  };
}

export async function createRecordingEncoder(
  width: number,
  height: number,
): Promise<RecordingEncoder> {
  const size = recordingSize(width, height);
  const {
    canEncodeVideo,
    CanvasSource,
    Output,
    Mp4OutputFormat,
    WebMOutputFormat,
    StreamTarget,
  } = await import("mediabunny");
  const config = {
    ...size,
    bitrate: 4_000_000,
    frameRate: 30,
    latencyMode: "realtime" as const,
  };
  const codec = (await canEncodeVideo("avc", config))
    ? "avc"
    : (await canEncodeVideo("vp9", config))
      ? "vp9"
      : null;
  if (!codec) throw modelError("recording_unsupported");
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    canvas.width = canvas.height = 0;
    throw modelError("recording_failed");
  }
  const buffer = new RecordingBuffer();
  const output = new Output({
    format:
      codec === "avc"
        ? new Mp4OutputFormat({ fastStart: "fragmented" })
        : new WebMOutputFormat(),
    target: new StreamTarget(
      new WritableStream({
        write: ({ data, position }) => buffer.write(data, position),
      }),
      { chunked: true, chunkSize: 1024 * 1024 },
    ),
  });
  const source = new CanvasSource(canvas, {
    codec,
    bitrate: config.bitrate,
    latencyMode: "realtime",
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: 30 });

  const release = () => {
    canvas.width = canvas.height = 0;
    buffer.clear();
  };

  const cancel = async () => {
    try {
      await output.cancel();
    } finally {
      release();
    }
  };

  try {
    await output.start();
  } catch (error) {
    await cancel();
    throw error;
  }
  let lastTimestamp = -1;
  return {
    ...size,
    extension: codec === "avc" ? "mp4" : "webm",
    add: (input, timestamp) => {
      if (!input.width || !input.height) throw modelError("recording_failed");
      // 固定输出尺寸，窗口旋转或缩放时等比留边；不把透明区域编码成未知背景色。
      context.fillStyle = "#000000";
      context.fillRect(0, 0, size.width, size.height);
      const scale = Math.min(
        size.width / input.width,
        size.height / input.height,
      );
      const w = input.width * scale,
        h = input.height * scale;
      context.drawImage(
        input,
        (size.width - w) / 2,
        (size.height - h) / 2,
        w,
        h,
      );
      lastTimestamp = timestamp;
      return source.add(timestamp, 1 / 30);
    },
    finish: async (duration) => {
      try {
        // 编码或渲染受阻时保持最后画面到停止时刻，不能把停顿压缩成加速视频。
        if (lastTimestamp >= 0 && duration > lastTimestamp + 1 / 30)
          await source.add(duration - 1 / 30, 1 / 30);
        source.close();
        await output.finalize();
        return buffer.blob(codec === "avc" ? "video/mp4" : "video/webm");
      } finally {
        release();
      }
    },
    cancel,
  };
}
