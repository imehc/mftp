import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pickFilePathNative, pickFilePathsNative } from "./files";

const { open } = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));
vi.mock("~/lib/platform", () => ({ isMobilePlatform: () => false }));

beforeEach(() => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  open.mockReset();
  open.mockResolvedValue("/tmp/paint.png");
});

afterEach(() => vi.unstubAllGlobals());

it.each([
  { name: "单选", pick: pickFilePathNative },
  { name: "多选", pick: pickFilePathsNative },
])("$name 的所有文件模式不向原生对话框传递星号后缀", async ({ pick }) => {
  await pick({ filterName: "依赖文件", extensions: ["*"] });
  expect(open).toHaveBeenCalledOnce();
  expect(open.mock.calls[0][0].filters).toBeUndefined();
});

it("指定后缀时保留原生过滤与文件选择结果", async () => {
  const path = await pickFilePathNative({
    filterName: "模型",
    extensions: ["glb", "gltf", "fbx"],
  });
  expect(path).toBe("/tmp/paint.png");
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({
      filters: [{ name: "模型", extensions: ["glb", "gltf", "fbx"] }],
    }),
  );
});
