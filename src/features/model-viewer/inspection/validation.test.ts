import { expect, it } from "vitest";
import { validateBytes } from "gltf-validator";
import { prepareGltf } from "../loaders/prepare";
import { browserSource } from "../sources/browser";

it("重写加载器 URL 时保留原始授权字节供校验", async () => {
  const original = JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ uri: "mesh%20data.bin", byteLength: 4 }],
  });
  const source = browserSource([
    new File([original], "model.gltf"),
    new File([new Uint8Array(4)], "mesh data.bin"),
  ]);
  const prepared = await prepareGltf(
    source,
    new AbortController().signal,
    () => {},
  );
  expect(await prepared.validationSource.entry.text()).toBe(original);
  expect(prepared.json.buffers![0].uri).toMatch(/^blob:/);
  const reads: string[] = [];
  const report = await validateBytes(
    new Uint8Array(await prepared.validationSource.entry.arrayBuffer()),
    {
      maxIssues: 200,
      writeTimestamp: false,
      externalResourceFunction: async (uri) => {
        reads.push(uri);
        const blob = prepared.validationSource.resources.get(uri);
        if (!blob) throw new Error("Unauthorized resource");
        return new Uint8Array(await blob.arrayBuffer());
      },
    },
  );
  expect(report.issues.numErrors).toBe(0);
  expect(reads).toEqual(["mesh%20data.bin"]);
  prepared.dispose();
  await source.close();
});
it("使用官方校验器报告格式错误的规范字段", async () => {
  const report = await validateBytes(
    new TextEncoder().encode(
      JSON.stringify({
        asset: { version: "2.0" },
        nodes: [{ translation: [1, 2] }],
      }),
    ),
    {
      maxIssues: 200,
      writeTimestamp: false,
      externalResourceFunction: async () => new Uint8Array(),
    },
  );
  expect(report.issues.numErrors).toBeGreaterThan(0);
  expect(
    report.issues.messages.some(
      (issue) => issue.pointer === "/nodes/0/translation",
    ),
  ).toBe(true);
});
