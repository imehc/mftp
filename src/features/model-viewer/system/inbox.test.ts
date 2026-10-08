import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { modelSystemPoll } from "~/lib/ipc";

import type { ViewerSession } from "../runtime/session";

vi.mock("~/lib/files", () => ({ isTauriRuntime: () => true }));
vi.mock("~/lib/ipc", () => ({ modelSystemPoll: vi.fn() }));
vi.mock("../sources/native", () => ({ nativeSource: vi.fn() }));
const file = { id: "one", path: "/tmp/model.glb", name: "model.glb" };

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  const document = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", document);
  vi.mocked(modelSystemPoll).mockResolvedValue({
    files: [],
    failed: false,
    thermal: "unknown",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("冷启动先保留系统文件，页面挂载后只转交一次", async () => {
  vi.mocked(modelSystemPoll).mockResolvedValueOnce({
    files: [file],
    failed: false,
    thermal: "nominal",
  });
  const inbox = await import("./inbox");
  const navigate = vi.fn(async () => {});
  const stop = inbox.installModelSystemRuntime(navigate);
  await flush();
  expect(navigate).toHaveBeenCalledOnce();
  const enqueue = vi
    .fn<ViewerSession["enqueue"]>()
    .mockResolvedValue(undefined);
  const detach = inbox.attachSystemInbox({
    enqueue,
  } as unknown as ViewerSession);
  expect(enqueue).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2000);
  expect(enqueue).toHaveBeenCalledOnce();
  detach();
  stop();
});

it("热启动直接交给当前查看器，不重新导航或重复排队", async () => {
  const inbox = await import("./inbox");
  const enqueue = vi
    .fn<ViewerSession["enqueue"]>()
    .mockResolvedValue(undefined);
  const detach = inbox.attachSystemInbox({
    enqueue,
  } as unknown as ViewerSession);
  vi.mocked(modelSystemPoll).mockResolvedValueOnce({
    files: [file, file],
    failed: false,
    thermal: "fair",
  });
  const navigate = vi.fn(async () => {});
  const stop = inbox.installModelSystemRuntime(navigate);
  await flush();
  expect(navigate).not.toHaveBeenCalled();
  expect(enqueue.mock.calls[0][0]).toHaveLength(1);
  expect(inbox.systemSnapshot().thermal).toBe("fair");
  detach();
  stop();
});

it("在途轮询跨 StrictMode 挂载保留结果，后台不轮询", async () => {
  let finish!: (value: Awaited<ReturnType<typeof modelSystemPoll>>) => void;
  vi.mocked(modelSystemPoll).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const inbox = await import("./inbox");
  const first = inbox.installModelSystemRuntime(vi.fn(async () => {}));
  first();
  const stop = inbox.installModelSystemRuntime(vi.fn(async () => {}));
  finish({ files: [file], failed: false, thermal: "unknown" });
  await flush();
  const enqueue = vi
    .fn<ViewerSession["enqueue"]>()
    .mockResolvedValue(undefined);
  const detach = inbox.attachSystemInbox({
    enqueue,
  } as unknown as ViewerSession);
  expect(enqueue).toHaveBeenCalledOnce();
  Object.assign(document, { hidden: true });
  await vi.advanceTimersByTimeAsync(4000);
  expect(modelSystemPoll).toHaveBeenCalledOnce();
  detach();
  stop();
});
