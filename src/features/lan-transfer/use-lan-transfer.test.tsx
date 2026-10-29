// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import QueryProvider from "~/app/QueryProvider";
import type { LanTransferStatus } from "~/bindings";
import { clearQueryData, queryClient } from "~/lib/query-client";
import { messages } from "~/locales/zh-CN/messages";

const port = vi.hoisted(() => ({
  settings: vi.fn(),
  status: vi.fn(),
  list: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("~/lib/ipc", () => ({
  lanTransferSettings: port.settings,
  lanTransferStatus: port.status,
  lanTransferSharedDirs: port.list,
  lanTransferNetworkAddresses: port.list,
  lanTransferConnectedDevices: port.list,
  lanTransferTasks: port.list,
  lanTransferTrustedDevices: port.list,
  lanTransferPendingAuthRequests: port.list,
  lanTransferStart: port.start,
  lanTransferStop: port.stop,
}));
vi.mock("./useLanDiscovery", () => ({
  useLanDiscovery: () => ({ refreshDiscovery: vi.fn() }),
}));
vi.mock("~/lib/files", () => ({ pickDirectoryNative: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: port.success, error: port.error },
}));
import { useLanTransfer } from "./use-lan-transfer";

const settings = {
  deviceName: "Test",
  port: 3000,
  bindHost: "",
  downloadDir: "",
  autoStart: false,
  securityMode: "code",
  defaultPermission: "readWrite",
  maxConcurrentTransfers: 3,
};
const status = {
  running: false,
  confirmationCode: "SECRET-CODE",
} as LanTransferStatus;
const failure = {
  kind: "external",
  code: "lan:test",
  message: "Read failed",
  args: {},
};
let root: Root;
let container: HTMLDivElement;
let controller: ReturnType<typeof useLanTransfer>;

function Probe() {
  const value = useLanTransfer();
  useEffect(() => {
    controller = value;
  }, [value]);
  return null;
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  clearQueryData();
  port.settings.mockResolvedValue(settings);
  port.status.mockResolvedValue(status);
  port.list.mockResolvedValue([]);
  port.start.mockResolvedValue({ ...status, running: true });
  port.stop.mockResolvedValue(status);
  i18n.load("zh-CN", messages);
  i18n.activate("zh-CN");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryProvider>
        <I18nProvider i18n={i18n}>
          <Probe />
        </I18nProvider>
      </QueryProvider>,
    ),
  );
  await flush();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  clearQueryData();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("公开读取进入查询缓存，配对码只保留在页面状态", () => {
  expect(controller.status?.confirmationCode).toBe("SECRET-CODE");
  expect(queryClient.getQueryData(["lan", "settings"])).toEqual(settings);
  expect(
    JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain("SECRET-CODE");
  expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
});

it("同一事件循环的启动和停止共用写锁，不重放操作", async () => {
  let finish!: (value: LanTransferStatus) => void;
  port.start.mockReturnValueOnce(
    new Promise((done) => {
      finish = done;
    }),
  );
  let pending: Promise<void> | undefined;
  await act(async () => {
    pending = controller.start();
    void controller.start();
    void controller.stop();
  });
  expect(port.start).toHaveBeenCalledOnce();
  expect(port.stop).not.toHaveBeenCalled();
  await act(async () => {
    finish({ ...status, running: true });
    await pending;
  });
});

it("启动成功后重读失败仍报告启动成功，读取错误独立呈现", async () => {
  port.settings.mockRejectedValueOnce(failure);
  port.status.mockResolvedValue({ ...status, running: true });
  await act(async () => controller.start());
  await flush();
  expect(port.success).toHaveBeenCalledWith("服务已启动");
  expect(port.error).not.toHaveBeenCalled();
  expect(controller.coreError).toEqual(failure);
  expect(controller.status?.running).toBe(true);
});

it("重置后迟到的停止结果不重建已清除的任务缓存", async () => {
  let finish!: (value: LanTransferStatus) => void;
  port.stop.mockReturnValueOnce(
    new Promise((done) => {
      finish = done;
    }),
  );
  let pending: Promise<void> | undefined;
  await act(async () => {
    pending = controller.stop();
  });
  await act(async () => root.render(null));
  clearQueryData();
  await act(async () => {
    finish(status);
    await pending;
  });
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(port.success).not.toHaveBeenCalled();
});

it("写入期间离开后重开页面，旧请求退出会恢复新页面读取", async () => {
  let finish!: (value: LanTransferStatus) => void;
  port.stop.mockReturnValueOnce(
    new Promise((done) => {
      finish = done;
    }),
  );
  let pending: Promise<void> | undefined;
  await act(async () => {
    pending = controller.stop();
  });
  await act(async () => root.render(null));
  await act(async () =>
    root.render(
      <QueryProvider>
        <I18nProvider i18n={i18n}>
          <Probe />
        </I18nProvider>
      </QueryProvider>,
    ),
  );
  expect(controller.status).toBeNull();
  await act(async () => {
    finish(status);
    await pending;
  });
  await flush();
  expect(controller.status).toEqual(status);
  expect(controller.loading).toBe(false);
});
