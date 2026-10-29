// @vitest-environment happy-dom
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import QueryProvider from "~/app/QueryProvider";
import type { BtFileListing, BtProbeResult, BtTaskInfo } from "~/bindings";
import { createAppQueryClient } from "~/lib/query-client";
import { messages } from "~/locales/zh-CN/messages";

const port = vi.hoisted(() => ({
  control: vi.fn(),
  export: vi.fn(),
  browse: vi.fn(),
  preview: vi.fn(),
  open: vi.fn(),
  probe: vi.fn(),
  add: vi.fn(),
  pick: vi.fn(),
  refresh: vi.fn(),
  finish: vi.fn(),
  pause: vi.fn(),
  forget: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  mobile: false,
}));
vi.mock("~/lib/ipc", () => ({
  btList: vi.fn(),
  btControl: port.control,
  btExport: port.export,
  btBrowseFiles: port.browse,
  btPreviewFile: port.preview,
  btOpenFile: port.open,
  btProbe: port.probe,
  btAddDownload: port.add,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: port.pick }));
vi.mock("~/lib/platform", () => ({ isMobilePlatform: () => port.mobile }));
vi.mock("./file-actions", () => ({
  systemDownloadDir: async () => "/isolated/downloads",
}));
vi.mock("./tasks-store", () => ({ refreshBtTasks: port.refresh }));
vi.mock("./task-sync", () => ({ forgetBtTask: port.forget }));
vi.mock("~/store/transfers", () => ({
  useTransfersStore: {
    getState: () => ({ finish: port.finish, setPaused: port.pause }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: port.success, error: port.error },
}));

import { useBtFileBrowser } from "./use-file-browser";
import { useBtTaskActions } from "./use-task-actions";
import { type TorrentDraftOptions, useTorrentDraft } from "./use-torrent-draft";

const task = { infoHash: "hash-a", label: "文件" } as BtTaskInfo;
const probe = {
  infoHash: "hash-a",
  name: "文件",
  totalLen: 30,
  files: [
    { index: 0, path: "a.txt", len: 10 },
    { index: 1, path: "b.txt", len: 20 },
  ],
} as BtProbeResult;
const failure = {
  kind: "external",
  code: "bt:test",
  message: "Test failure",
  args: {},
};
let root: Root;
let container: HTMLDivElement;
let client: ReturnType<typeof createAppQueryClient>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function mount<T>(useSubject: () => T) {
  let current!: T;

  function Probe() {
    const state = useSubject();
    useEffect(() => {
      current = state;
    }, [state]);
    return null;
  }

  const render = () =>
    root.render(
      <QueryProvider client={client}>
        <I18nProvider i18n={i18n}>
          <Probe />
        </I18nProvider>
      </QueryProvider>,
    );
  await act(async () => {
    render();
  });
  return {
    get state() {
      return current;
    },
    render,
  };
}

async function flush() {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 5));
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  port.mobile = false;
  port.refresh.mockResolvedValue(undefined);
  port.control.mockResolvedValue(undefined);
  port.export.mockResolvedValue(undefined);
  port.probe.mockResolvedValue(probe);
  port.add.mockResolvedValue(task);
  port.pick.mockResolvedValue(null);
  client = createAppQueryClient();
  i18n.load("zh-CN", messages);
  i18n.activate("zh-CN");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  client.clear();
  vi.unstubAllGlobals();
});

it("任务操作锁覆盖实际命令退出，取消成功后同步传输状态", async () => {
  const action = deferred<void>();
  port.control.mockReturnValueOnce(action.promise);
  const hook = await mount(useBtTaskActions);
  let running!: Promise<void>;
  await act(async () => {
    running = hook.state.control(task, "Cancel");
    void hook.state.remove(task);
  });
  expect(port.control).toHaveBeenCalledExactlyOnceWith(
    "hash-a",
    "Cancel",
    false,
  );
  expect(hook.state.busyTasks.has("hash-a")).toBe(true);
  expect(port.finish).not.toHaveBeenCalled();
  await act(async () => {
    action.resolve();
    await running;
  });
  expect(port.forget).toHaveBeenCalledWith("hash-a");
  expect(port.finish).toHaveBeenCalledWith("bt:hash-a", "cancelled");
  expect(hook.state.busyTasks.size).toBe(0);
});

it("取消导出目录选择不执行写操作，移动端使用系统目录", async () => {
  const hook = await mount(useBtTaskActions);
  await act(async () => hook.state.exportTask(task));
  expect(port.export).not.toHaveBeenCalled();
  expect(port.refresh).not.toHaveBeenCalled();
  port.mobile = true;
  await act(async () => hook.state.exportTask(task));
  expect(port.export).toHaveBeenCalledExactlyOnceWith("hash-a", "");
  expect(port.pick).toHaveBeenCalledOnce();
});

it("删除失败不移除任务投影，写操作不自动重试", async () => {
  port.control.mockRejectedValueOnce(failure);
  const hook = await mount(useBtTaskActions);
  await act(async () => hook.state.remove(task));
  expect(port.control).toHaveBeenCalledOnce();
  expect(port.forget).not.toHaveBeenCalled();
  expect(port.finish).not.toHaveBeenCalled();
  expect(port.error).toHaveBeenCalledOnce();
});

function draftOptions(): TorrentDraftOptions {
  return {
    open: true,
    onOpenChange: vi.fn(),
    onAdded: vi.fn(),
    existingInfoHashes: new Set(),
  };
}

it("关闭后重新打开时忽略旧探测结果，失败保留结构化错误", async () => {
  const options = draftOptions();
  const old = deferred<BtProbeResult>();
  port.probe.mockReturnValueOnce(old.promise);
  const hook = await mount(() => useTorrentDraft(options));
  let reading!: Promise<void>;
  await act(async () => {
    reading = hook.state.doProbe("old");
  });
  await act(async () => {
    hook.state.close();
    options.open = false;
    hook.render();
  });
  await act(async () => {
    options.open = true;
    hook.render();
  });
  await act(async () => {
    old.resolve(probe);
    await reading;
  });
  expect(hook.state.probe).toBeNull();
  port.probe.mockRejectedValueOnce(failure);
  await act(async () => hook.state.doProbe("new"));
  expect(hook.state.probeError).toEqual(failure);
});

it("已有解析结果不重新探测，启动锁阻止双击和提前关闭", async () => {
  const options = {
    ...draftOptions(),
    initialSource: "magnet:?test",
    initialProbe: probe,
    initialSelected: [1],
  };
  const pending = deferred<BtTaskInfo>();
  port.add.mockReturnValueOnce(pending.promise);
  const hook = await mount(() => useTorrentDraft(options));
  let running!: Promise<void>;
  await act(async () => {
    running = hook.state.startDownload();
    void hook.state.startDownload();
    hook.state.close();
  });
  expect(port.probe).not.toHaveBeenCalled();
  expect(port.add).toHaveBeenCalledExactlyOnceWith(
    "magnet:?test",
    "hash-a",
    [1],
  );
  expect(options.onOpenChange).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve(task);
    await running;
  });
  expect(options.onAdded).toHaveBeenCalledOnce();
  expect(options.onOpenChange).toHaveBeenCalledWith(false);
});

function listing(path: string): BtFileListing {
  return {
    current: { path, name: path || "根目录", isDir: !path, size: 10 },
    entries: [],
  } as BtFileListing;
}

it("快速切换文件忽略旧预览能力，URL 不进入查询缓存", async () => {
  const old = deferred<{ url: string }>();
  port.browse.mockImplementation(async (_hash: string, path: string) =>
    listing(path),
  );
  port.preview.mockImplementation((_hash: string, path: string) =>
    path === "old.txt"
      ? old.promise
      : Promise.resolve({ url: "http://isolated/?token=new" }),
  );
  const hook = await mount(() => useBtFileBrowser("hash-a"));
  await flush();
  await act(async () => hook.state.navigate("old.txt"));
  await flush();
  await act(async () => hook.state.navigate("new.txt"));
  await flush();
  await act(async () => {
    old.resolve({ url: "http://isolated/?token=old" });
  });
  expect(hook.state.url).toContain("token=new");
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((entry) => entry.state.data),
    ),
  ).not.toContain("token=");
  await act(async () => hook.state.reload());
  await flush();
  expect(hook.state.url).toContain("attempt=1");
});

it("文件查询失败显示读取错误，不伪装为空目录且不自动重试", async () => {
  port.browse.mockRejectedValue(failure);
  const hook = await mount(() => useBtFileBrowser("hash-a"));
  await flush();
  expect(hook.state.error).toEqual(failure);
  expect(hook.state.loading).toBe(false);
  expect(port.browse).toHaveBeenCalledOnce();
  expect(port.preview).not.toHaveBeenCalled();
});
