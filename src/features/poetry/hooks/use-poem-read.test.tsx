// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import QueryProvider from "~/app/QueryProvider";
import { poetryPoem } from "~/lib/ipc";
import { createAppQueryClient } from "~/lib/query-client";
import type { PoemDetail } from "~/types";

import { usePoemRead } from "./use-poem-read";

vi.mock("~/lib/ipc", () => ({ poetryPoem: vi.fn() }));
const client = createAppQueryClient();
let root: Root;
let container: HTMLDivElement;
let current: ReturnType<typeof usePoemRead>;

function Probe({ uid }: { uid?: string }) {
  const value = usePoemRead(uid);
  useEffect(() => {
    current = value;
  });
  return <div>{value.detail?.uid}</div>;
}

async function render(uid?: string) {
  await act(async () =>
    root.render(
      <StrictMode>
        <QueryProvider client={client}>
          <Probe uid={uid} />
        </QueryProvider>
      </StrictMode>,
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

describe("诗词详情查询", () => {
  it("空标识禁用读取与手动重试，不显示加载中", async () => {
    await render();
    current.retry();
    expect(current.loading).toBe(false);
    expect(poetryPoem).not.toHaveBeenCalled();
    await render("  ");
    current.retry();
    expect(poetryPoem).not.toHaveBeenCalled();
  });

  it("严格模式复用在途请求，快速切换作品不接纳上一首结果", async () => {
    let resolveA!: (value: PoemDetail) => void;
    vi.mocked(poetryPoem).mockImplementation((uid) =>
      uid === "a"
        ? new Promise((resolve) => {
            resolveA = resolve;
          })
        : Promise.resolve({ uid } as PoemDetail),
    );
    await render("a");
    expect(poetryPoem).toHaveBeenCalledTimes(1);
    await render("b");
    await act(async () => {
      resolveA({ uid: "a" } as PoemDetail);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(current.detail?.uid).toBe("b");
    expect(container.textContent).toBe("b");
  });

  it("失败只执行一次，显式重试复用同一缓存身份", async () => {
    vi.mocked(poetryPoem)
      .mockRejectedValueOnce({
        kind: "custom",
        code: "poetry:not_found",
        message: "Not found",
        args: {},
      })
      .mockResolvedValue({ uid: "a" } as PoemDetail);
    await render("a");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(current.error?.code).toBe("poetry:not_found");
    expect(poetryPoem).toHaveBeenCalledTimes(1);
    await act(async () => current.retry());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(current.detail?.uid).toBe("a");
    expect(client.getQueryCache().getAll()).toHaveLength(1);
  });
});
