import { beforeEach, expect, it, vi } from "vitest";

import { hostsList, keysList } from "~/lib/ipc";

import { useHostsStore } from "./hosts";

vi.mock("~/lib/ipc", () => ({ hostsList: vi.fn(), keysList: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  useHostsStore.getState().invalidate();
  useHostsStore.setState({
    hosts: [],
    keys: [],
    loaded: false,
    loading: false,
    loadError: null,
  });
  vi.mocked(hostsList).mockResolvedValue([]);
  vi.mocked(keysList).mockResolvedValue([]);
});

it("并发读取复用请求，成功后不重复加载", async () => {
  await Promise.all([
    useHostsStore.getState().ensureLoaded(),
    useHostsStore.getState().ensureLoaded(),
  ]);
  await useHostsStore.getState().ensureLoaded();
  expect(hostsList).toHaveBeenCalledTimes(1);
  expect(useHostsStore.getState().loaded).toBe(true);
});

it("读取失败保留完整错误，重试成功清除错误", async () => {
  const error = {
    kind: "external" as const,
    code: "io:operation",
    message: "Read failed",
    args: {},
  };
  vi.mocked(hostsList).mockRejectedValueOnce(error);
  await expect(useHostsStore.getState().ensureLoaded()).rejects.toEqual(error);
  expect(useHostsStore.getState().loadError).toEqual(error);
  expect(useHostsStore.getState().loading).toBe(false);
  expect(useHostsStore.getState().loaded).toBe(false);
  await useHostsStore.getState().ensureLoaded();
  expect(useHostsStore.getState().loadError).toBeNull();
  expect(useHostsStore.getState().loaded).toBe(true);
});

it("清理使晚到的旧快照失效，后续读取不复用旧请求", async () => {
  let finish!: (value: Awaited<ReturnType<typeof hostsList>>) => void;
  vi.mocked(hostsList).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const old = useHostsStore.getState().ensureLoaded();
  useHostsStore.getState().invalidate();
  await useHostsStore.getState().ensureLoaded();
  finish([
    {
      id: "removed",
      label: "Deleted",
      host: "example.invalid",
      port: 22,
      username: "demo",
      authType: "password",
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  await old;
  expect(hostsList).toHaveBeenCalledTimes(2);
  expect(useHostsStore.getState().hosts).toEqual([]);
  expect(useHostsStore.getState().loaded).toBe(true);
});
