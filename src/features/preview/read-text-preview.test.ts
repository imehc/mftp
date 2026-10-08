import { afterEach, expect, it, vi } from "vitest";

import { readTextPreview, TEXT_HEAD_BYTES } from "./read-text-preview";

afterEach(() => vi.unstubAllGlobals());

it("即使服务端忽略 Range 也截断并取消流", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(TEXT_HEAD_BYTES + 20).fill(65));
    },
    cancel,
  });
  const fetchMock = vi.fn().mockResolvedValue(new Response(body));
  vi.stubGlobal("fetch", fetchMock);
  const result = await readTextPreview(
    "https://example.invalid/test",
    new AbortController().signal,
    () => {},
  );
  expect(result.body).toHaveLength(TEXT_HEAD_BYTES);
  expect(result.truncated).toBe(true);
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][1].headers.Range).toBe(
    `bytes=0-${TEXT_HEAD_BYTES - 1}`,
  );
});

it("分段 UTF-8 正确解码且区分完整内容", async () => {
  const bytes = new TextEncoder().encode("测试文档");
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes.subarray(0, 2));
      c.enqueue(bytes.subarray(2));
      c.close();
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(body, {
        headers: { "Content-Length": String(bytes.length) },
      }),
    ),
  );
  expect(
    await readTextPreview("test", new AbortController().signal, () => {}),
  ).toEqual({ body: "测试文档", truncated: false, interrupted: false });
});

it("流中断保留已读内容，主动取消不会发布后续片段", async () => {
  let reads = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (reads++ === 0) c.enqueue(new TextEncoder().encode("readable"));
      else c.error(new Error("interrupted"));
    },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
  expect(
    await readTextPreview("test", new AbortController().signal, () => {}),
  ).toEqual({ body: "readable", truncated: true, interrupted: true });
  const controller = new AbortController();
  controller.abort();
  const onChunk = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("later")));
  await expect(
    readTextPreview("test", controller.signal, onChunk),
  ).rejects.toThrow();
  expect(onChunk).not.toHaveBeenCalled();
});
