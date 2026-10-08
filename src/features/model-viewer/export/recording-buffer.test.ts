import { expect, it } from "vitest";

import { RECORDING_MAX_BYTES, RecordingBuffer } from "./recording-buffer";
import { recordingSize } from "./recording-encoder";

it("容器分块跨页写入并回写头部时保留正确字节", async () => {
  const buffer = new RecordingBuffer();
  buffer.write(new Uint8Array([1, 2, 3]), 65535);
  buffer.write(new Uint8Array([4, 5]), 0);
  buffer.write(new Uint8Array([9]), 65536);
  const bytes = new Uint8Array(await buffer.blob("video/mp4").arrayBuffer());
  expect(bytes.length).toBe(65538);
  expect([...bytes.slice(0, 3)]).toEqual([4, 5, 0]);
  expect([...bytes.slice(-3)]).toEqual([1, 9, 3]);
  buffer.clear();
  buffer.write(new Uint8Array([8]), 0);
  expect(buffer.blob("video/mp4").size).toBe(1);
});

it("超限及非法写入在分配前失败", () => {
  for (const position of [-1, 0.5, NaN, RECORDING_MAX_BYTES]) {
    const buffer = new RecordingBuffer();
    let error: unknown;
    try {
      buffer.write(new Uint8Array([1]), position);
    } catch (value) {
      error = value;
    }
    expect(error).toMatchObject({ payload: { code: "model:recording_limit" } });
  }
});

it("录屏固定偶数尺寸并限制长边和像素数", () => {
  expect(recordingSize(321, 181)).toEqual({ width: 320, height: 180 });
  for (const [width, height] of [
    [8000, 8000],
    [1080, 3840],
    [7680, 2160],
  ]) {
    const result = recordingSize(width, height);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1920);
    expect(result.width * result.height).toBeLessThanOrEqual(1920 * 1080);
    expect(result.width % 2).toBe(0);
    expect(result.height % 2).toBe(0);
  }
});
