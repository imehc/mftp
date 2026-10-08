import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { downloadBlob } from "./files";

const { save, writeFile, stat } = vi.hoisted(() => ({
  save: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile, stat }));
vi.mock("~/lib/platform", () => ({ isMobilePlatform: () => false }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  save.mockResolvedValue("/isolated/screenshot.png");
  stat.mockResolvedValue({ size: 3 });
});

afterEach(() => vi.unstubAllGlobals());

const blob = new Blob(["png"], { type: "image/png" });

it("预先取消不打开对话框，系统取消不写文件", async () => {
  const task = new AbortController();
  task.abort();
  expect(await downloadBlob(blob, "test.png", task.signal)).toBe(false);
  expect(save).not.toHaveBeenCalled();
  save.mockResolvedValue(null);
  expect(await downloadBlob(blob, "test.png")).toBe(false);
  expect(writeFile).not.toHaveBeenCalled();
});

it("原生对话框期间切页不写入随后返回的路径", async () => {
  const task = new AbortController();
  save.mockImplementation(async () => {
    task.abort();
    return "/isolated/screenshot.png";
  });
  expect(await downloadBlob(blob, "test.png", task.signal)).toBe(false);
  expect(writeFile).not.toHaveBeenCalled();
});

it("读取字节期间取消不会写入", async () => {
  const task = new AbortController();
  vi.spyOn(blob, "arrayBuffer").mockImplementationOnce(async () => {
    task.abort();
    return new ArrayBuffer(3);
  });
  expect(await downloadBlob(blob, "test.png", task.signal)).toBe(false);
  expect(writeFile).not.toHaveBeenCalled();
});

it("只写入用户选择的目标，写入失败直接向上抛出且不重试", async () => {
  expect(await downloadBlob(blob, "test.png")).toBe(3);
  expect(writeFile).toHaveBeenCalledWith(
    "/isolated/screenshot.png",
    new Uint8Array([112, 110, 103]),
  );
  const error = {
    kind: "external",
    code: "fs:write",
    message: "Write failed",
    args: {},
  };
  writeFile.mockRejectedValue(error);
  await expect(downloadBlob(blob, "test.png")).rejects.toBe(error);
  expect(writeFile).toHaveBeenCalledTimes(2);
});
