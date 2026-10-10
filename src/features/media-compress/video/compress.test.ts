import { i18n } from "@lingui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { compressVideoFile } from "./compress";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  dispose: vi.fn(),
  cancelOutput: vi.fn(),
}));
vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class {},
  BufferTarget: class {
    buffer = new ArrayBuffer(1);
  },
  Conversion: { init: mocks.init },
  ConversionCanceledError: class extends Error {},
  Input: class {
    dispose = mocks.dispose;
  },
  Mp4OutputFormat: class {},
  Output: class {
    cancel = mocks.cancelOutput;
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

const file = new File(["original-video"], "sample.mp4");
const metadata = {
  width: 640,
  height: 480,
  duration: 2,
  size: file.size,
  name: file.name,
  hasAudio: false,
};
const options = {
  resolution: "original" as const,
  quality: 50,
  keepAudio: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("VideoEncoder", class {});
  vi.stubGlobal("VideoDecoder", class {});
  i18n.loadAndActivate({ locale: "zh-CN", messages: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("视频转换资源退出", () => {
  it("取消后等待执行和异步清理全部完成", async () => {
    const execution = deferred<void>();
    const cleanup = deferred<void>();
    const conversion = {
      isValid: true,
      onProgress: undefined,
      execute: vi.fn(() => execution.promise),
      cancel: vi.fn(() => cleanup.promise),
    };
    mocks.init.mockResolvedValue(conversion);
    const controller = new AbortController();
    let settled = false;
    const pending = compressVideoFile(
      file,
      options,
      undefined,
      controller.signal,
      metadata,
    ).catch((error) => {
      settled = true;
      return error;
    });
    await vi.waitFor(() => expect(conversion.execute).toHaveBeenCalled());
    controller.abort();
    await vi.waitFor(() => expect(conversion.cancel).toHaveBeenCalled());
    expect(settled).toBe(false);
    execution.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    cleanup.resolve();
    expect(await pending).toMatchObject({ name: "AbortError" });
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.cancelOutput).toHaveBeenCalledTimes(1);
  });

  it("初始化晚于取消返回时释放新转换对象且不执行编码", async () => {
    const conversion = {
      isValid: true,
      onProgress: undefined,
      execute: vi.fn(),
      cancel: vi.fn(),
    };
    const initializing = deferred<typeof conversion>();
    mocks.init.mockReturnValue(initializing.promise);
    const controller = new AbortController();
    const pending = compressVideoFile(
      file,
      options,
      undefined,
      controller.signal,
      metadata,
    ).catch((error) => error);
    controller.abort();
    initializing.resolve(conversion);
    expect(await pending).toMatchObject({ name: "AbortError" });
    expect(conversion.cancel).toHaveBeenCalledTimes(1);
    expect(conversion.execute).not.toHaveBeenCalled();
  });

  it("正常完成释放输入，清理失败不能报告成功", async () => {
    mocks.init.mockResolvedValue({
      isValid: true,
      onProgress: undefined,
      execute: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
    });
    const failure = new Error("Cleanup failed");
    mocks.dispose.mockImplementationOnce(() => {
      throw failure;
    });
    await expect(
      compressVideoFile(file, options, undefined, undefined, metadata),
    ).rejects.toBe(failure);
    expect(mocks.cancelOutput).not.toHaveBeenCalled();
  });
});
