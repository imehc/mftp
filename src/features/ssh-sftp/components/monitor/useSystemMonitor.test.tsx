// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import QueryProvider from "~/app/QueryProvider";
import { createAppQueryClient } from "~/lib/query-client";
import type { Session, SystemStats } from "~/types";

const read = vi.hoisted(() => vi.fn());
vi.mock("~/lib/ipc", () => ({ sshSystemStats: read }));
vi.mock("~/store/sessions", () => ({
  useSessionsStore: { subscribe: vi.fn() },
}));
vi.mock("~/i18n/translate", () => ({ translate: () => "监控采集超时" }));
import { useSystemMonitor } from "./useSystemMonitor";

let root: Root;
let client: ReturnType<typeof createAppQueryClient>;
let value: ReturnType<typeof useSystemMonitor>;
let finish: (stats: SystemStats) => void;
const stats = {
  cpu: { used: 1 },
  memory: { total: 100, used: 10 },
  network: [],
  diskIo: [],
} as unknown as SystemStats;

function Probe() {
  const monitor = useSystemMonitor({ id: "test-monitor" } as Session);
  useEffect(() => {
    value = monitor;
  }, [monitor]);
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  read.mockReset().mockImplementation(
    () =>
      new Promise<SystemStats>((resolve) => {
        finish = resolve;
      }),
  );
  client = createAppQueryClient();
  root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <QueryProvider client={client}>
        <Probe />
      </QueryProvider>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("前端采样超时后继续复用原生在途读取，不堆积轮询", async () => {
  await act(async () => vi.advanceTimersByTimeAsync(13_000));
  expect(value.error?.message).toBe("监控采集超时");
  await act(async () => value.retry());
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(read).toHaveBeenCalledOnce();
  await act(async () => finish(stats));
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(value.error).toBeNull();
  expect(value.history).toHaveLength(1);
  expect(value.data).toEqual(stats);
});

it("关闭面板与清空缓存后旧采样不恢复数据或继续轮询", async () => {
  await act(async () => root.render(null));
  client.clear();
  await act(async () => {
    finish(stats);
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(read).toHaveBeenCalledOnce();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});
