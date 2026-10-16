// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { TodoNoteImageData } from "~/bindings";

import { createNoteImageCache } from "./note-image-cache";

afterEach(() => vi.restoreAllMocks());

function setup() {
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const read = vi.fn(async (id: string): Promise<TodoNoteImageData> => ({
    image: { id, mimeType: "image/png", byteLength: 1, width: 1, height: 1 },
    dataBase64: "AA==",
  }));
  return { cache: createNoteImageCache(read), read, create, revoke };
}

describe("待办图片缓存", () => {
  it("按归属和缩略图类型隔离读取，正式图片复用同一 URL", async () => {
    const { cache, read, revoke } = setup();
    const scope = { itemId: "item", draftId: null };
    const first = cache.acquire("image", scope, true);
    const second = cache.acquire("image", scope, true);
    await Promise.all([first.promise, second.promise]);
    expect(read).toHaveBeenCalledTimes(1);
    const full = cache.acquire("image", scope);
    await full.promise;
    expect(read).toHaveBeenCalledTimes(2);
    first.release();
    second.release();
    full.release();
    cache.dispose();
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it("草稿关闭释放 URL，迟到读取不会创建泄漏 URL", async () => {
    const { cache, read, create, revoke } = setup();
    const scope = { itemId: null, draftId: "draft" };
    const first = cache.acquire("first", scope);
    await first.promise;
    first.release();
    expect(revoke).toHaveBeenCalledTimes(1);
    let complete!: (value: TodoNoteImageData) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const late = cache.acquire("late", scope);
    late.release();
    cache.dispose();
    complete({
      image: {
        id: "late",
        mimeType: "image/png",
        byteLength: 1,
        width: 1,
        height: 1,
      },
      dataBase64: "AA==",
    });
    await expect(late.promise).rejects.toMatchObject({
      payload: { code: "todo:note_draft_closed" },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("页面销毁或严格模式清理后可重新读取，不复用旧快照", async () => {
    const { cache, read } = setup();
    const scope = { itemId: "item", draftId: null };
    const old = cache.acquire("image", scope);
    await old.promise;
    old.release();
    cache.dispose();
    const next = cache.acquire("image", scope);
    await next.promise;
    expect(read).toHaveBeenCalledTimes(2);
    next.release();
    cache.dispose();
  });

  it("缓存有界并淘汰无人使用的缩略图", async () => {
    const { cache, read, revoke } = setup();
    const scope = { itemId: "item", draftId: null };
    for (let index = 0; index < 65; index++) {
      const lease = cache.acquire(`image-${index}`, scope, true);
      await lease.promise;
      lease.release();
    }
    expect(revoke).toHaveBeenCalledTimes(1);
    const old = cache.acquire("image-0", scope, true);
    await old.promise;
    expect(read).toHaveBeenCalledTimes(66);
    old.release();
    cache.dispose();
  });
});
