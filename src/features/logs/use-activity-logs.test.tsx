// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import QueryProvider from "~/app/QueryProvider";
import type { LogPage } from "~/bindings";
import { createAppQueryClient } from "~/lib/query-client";
import { messages as zhMessages } from "~/locales/zh-CN/messages";
import type { ActivityLog } from "~/types";

import { logPage } from "./__fixtures__/page";

const port = vi.hoisted(() => ({
  read: vi.fn(),
  clear: vi.fn(),
  remove: vi.fn(),
  diagnosticsClear: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("~/lib/ipc", () => ({
  logsPage: port.read,
  logsClear: undefined,
  activityLogs: port.read,
  activityLogsClear: port.clear,
  activityLogDelete: port.remove,
  diagnosticsClear: port.diagnosticsClear,
}));
vi.mock("sonner", () => ({
  toast: { success: port.success, error: port.error },
}));

import { useActivityLogs } from "./use-activity-logs";

const row: ActivityLog = {
  id: "history-1",
  operationId: "runtime-1",
  createdAt: 1000,
  source: "sftp",
  requestType: "upload",
  ip: "/workspace/file.txt",
  result: "success",
  detail: null,
  error: null,
};
const other = { ...row, id: "history-2", operationId: "runtime-2" };
const failure = {
  kind: "external",
  code: "storage:test",
  message: "Storage unavailable",
  args: {},
};
let client: ReturnType<typeof createAppQueryClient>;
let root: Root;
let container: HTMLDivElement;
let controller: ReturnType<typeof useActivityLogs>;

function Probe() {
  const logs = useActivityLogs();
  useEffect(() => {
    controller = logs;
  }, [logs]);
  return null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  client = createAppQueryClient();
  port.read.mockResolvedValue(logPage([], [row, other]));
  port.clear.mockResolvedValue(undefined);
  port.diagnosticsClear.mockResolvedValue(undefined);
  port.remove.mockResolvedValue(undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.load("zh-CN", zhMessages);
  i18n.activate("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryProvider client={client}>
        <I18nProvider i18n={i18n}>
          <Probe />
        </I18nProvider>
      </QueryProvider>,
    ),
  );
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  client.clear();
  vi.unstubAllGlobals();
});

describe("持久历史与运行期日志删除边界", () => {
  it("未确认删除时不执行写操作，单条删除只影响持久摘要", async () => {
    await act(async () => controller.remove());
    expect(port.remove).not.toHaveBeenCalled();
    await act(async () => controller.setDeleting(row));
    await act(async () => controller.remove());
    expect(port.remove).toHaveBeenCalledExactlyOnceWith(row.id);
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(controller.logs).toEqual([other]);
    expect(controller.deleting).toBeNull();
    expect(port.clear).not.toHaveBeenCalled();
    expect(port.diagnosticsClear).not.toHaveBeenCalled();
  });

  it("清空统一日志后按文件重读，释放历史与内存投影", async () => {
    port.read.mockResolvedValue(logPage());
    await act(async () => controller.setDeleting("all"));
    await act(async () => controller.remove());
    expect(port.clear).not.toHaveBeenCalled();
    expect(port.remove).not.toHaveBeenCalled();
    expect(port.diagnosticsClear).toHaveBeenCalledOnce();
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(controller.logs).toEqual([]);
  });

  it("删除失败保留已有历史与确认对象，不自动重放写操作", async () => {
    port.remove.mockRejectedValueOnce(failure);
    await act(async () => {
      controller.setSelected(row);
      controller.setDeleting(row);
    });
    await act(async () => controller.remove());
    expect(controller.logs).toEqual([row, other]);
    expect(controller.selected).toEqual(row);
    expect(controller.deleting).toEqual(row);
    expect(controller.busy).toBe(false);
    expect(port.remove).toHaveBeenCalledOnce();
    expect(port.error).toHaveBeenCalledOnce();
    expect(port.success).not.toHaveBeenCalled();
  });

  it("并发点击不会重复删除，在途旧读取不能恢复已删除记录", async () => {
    let finishRead!: (rows: LogPage) => void;
    const reading = new Promise<LogPage>((resolve) => {
      finishRead = resolve;
    });
    let finishRemove!: () => void;
    const removing = new Promise<void>((resolve) => {
      finishRemove = resolve;
    });
    port.read.mockReturnValueOnce(reading);
    port.remove.mockReturnValueOnce(removing);
    let reload: Promise<void> | undefined;
    await act(async () => {
      reload = controller.reload();
      controller.setDeleting(row);
    });
    let removal: Promise<void>;
    await act(async () => {
      removal = controller.remove();
    });
    await act(async () => controller.remove());
    expect(port.remove).toHaveBeenCalledOnce();
    await act(async () => {
      finishRemove();
      await removal;
      finishRead(logPage([], [row, other]));
      await reload;
    });
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(controller.logs).toEqual([other]);
  });

  it("重读失败保留原摘要与结构化错误，不伪装成空历史", async () => {
    port.read.mockRejectedValueOnce(failure);
    await act(async () => controller.reload());
    expect(controller.logs).toEqual([row, other]);
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(controller.error).toEqual(failure);
    expect(controller.loading).toBe(false);
    expect(port.remove).not.toHaveBeenCalled();
    expect(port.clear).not.toHaveBeenCalled();
  });

  it("删除期间切换筛选的迟到读取不能恢复已删除摘要", async () => {
    let finishRead!: (rows: LogPage) => void;
    const reading = new Promise<LogPage>((resolve) => {
      finishRead = resolve;
    });
    let finishRemove!: () => void;
    const removing = new Promise<void>((resolve) => {
      finishRemove = resolve;
    });
    port.read.mockReturnValueOnce(reading);
    port.remove.mockReturnValueOnce(removing);
    await act(async () => controller.setDeleting(row));
    let removal: Promise<void>;
    await act(async () => {
      removal = controller.remove();
      controller.setSource("sftp");
    });
    expect(port.read).toHaveBeenCalledOnce();
    let reload: Promise<void> | undefined;
    await act(async () => {
      reload = controller.reload();
    });
    await act(async () => {
      finishRemove();
      await removal;
      finishRead(logPage([], [row, other]));
      await reload;
    });
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(controller.logs).toEqual([other]);
    expect(controller.loading).toBe(false);
  });
});
