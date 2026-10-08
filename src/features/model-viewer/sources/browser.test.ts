import { expect, it } from "vitest";
import { browserSource } from "./browser";
import { MissingResources } from "../domain/errors";
function file(path: string, contents: string) {
  const value = new File([contents], path.split("/").pop()!);
  Object.defineProperty(value, "webkitRelativePath", { value: path });
  return value;
}
it("批量源按所选模型目录隔离同名依赖", async () => {
  const a = file("one/model.gltf", "{}"),
    b = file("two/model.gltf", "{}");
  const files = [
    a,
    b,
    file("one/shared.bin", "A"),
    file("two/shared.bin", "B"),
  ];
  const first = browserSource(files, a),
    second = browserSource(files, b);
  const signal = new AbortController().signal;
  expect(
    new TextDecoder().decode(await first.read("shared.bin", signal, () => {})),
  ).toBe("A");
  await first.close();
  expect(
    new TextDecoder().decode(await second.read("shared.bin", signal, () => {})),
  ).toBe("B");
  await second.close();
});
it("有歧义的文件必须显式映射且绝不静默覆盖", async () => {
  const entry = file("model.gltf", "{}");
  const source = browserSource(
    [entry, file("same.bin", "a"), file("same.bin", "b")],
    entry,
  );
  await expect(
    source.read("same.bin", new AbortController().signal, () => {}),
  ).rejects.toBeInstanceOf(MissingResources);
  await source.attach("same.bin", file("same.bin", "c"));
  expect(await source.sizeOf("same.bin")).toBe(1);
});
