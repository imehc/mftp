import { expect, it } from "vitest";

import { browserSource } from "../sources/browser";
import { modelExtension, modelFileAccept, modelFormat } from "./formats";

it("文件选择、拖放与格式标识使用同一份扩展名定义", () => {
  for (const [name, format] of [
    ["a.glb", "GLB"],
    ["a.gltf", "glTF"],
    ["a.FBX", "FBX"],
  ]) {
    expect(modelFormat(name)).toBe(format);
    expect(browserSource([new File(["model"], name)]).name).toBe(name);
  }
  expect(modelFileAccept.split(",")).toContain(".fbx");
  expect(modelExtension("fbx")).toBeNull();
  expect(modelExtension("model.fbx.exe")).toBeNull();
});
