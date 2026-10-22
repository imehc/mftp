// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RsyncIntegration,
  RsyncSyncRequest,
} from "~/features/ssh-sftp/components/sftp/rsync-contract";
import { useSessionsStore } from "~/store/sessions";
import { useSettingsStore } from "~/store/settings";
import { useTransfersStore } from "~/store/transfers";
import type { AppError, RsyncCapabilities, RsyncPreview } from "~/types";

import { useRsyncCapabilityStore } from "./capability-store";
import { useRsyncIntegration } from "./integration";

const ipcMock = vi.hoisted(() => ({
  rsyncCapabilities: vi.fn(),
  rsyncPreview: vi.fn(),
  rsyncTransfer: vi.fn(),
}));

vi.mock("~/lib/ipc", () => ({
  rsyncCapabilities: ipcMock.rsyncCapabilities,
  rsyncPreview: ipcMock.rsyncPreview,
  rsyncTransfer: ipcMock.rsyncTransfer,
}));

const request: RsyncSyncRequest = {
  direction: "upload",
  localDir: "/Users/me/project",
  remoteDir: "/srv/project",
  displayName: "project",
};

function available(): RsyncCapabilities {
  return {
    local: { status: "available", version: "3.2.7", protocol: 31 },
    remote: { status: "available", version: "3.2.7", protocol: 31 },
  };
}

function preview(deleteExtraneous = false): RsyncPreview {
  return {
    token: "token",
    direction: "upload",
    localDir: request.localDir,
    remoteDir: request.remoteDir,
    deleteExtraneous,
    added: 1,
    updated: 0,
    deleted: 0,
    items: [{ kind: "added", path: "a.txt", isDir: false }],
    truncated: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let integration: RsyncIntegration | undefined;
let root: Root;
let container: HTMLDivElement;

function Probe({
  onReady,
  onUploaded,
}: {
  onReady: (value: RsyncIntegration) => void;
  onUploaded: () => Promise<void>;
}) {
  const value = useRsyncIntegration({ sessionId: "s1", onUploaded });
  // 测试探针只能在提交后取得 hook 结果，渲染期间不写外部变量。
  useEffect(() => {
    onReady(value);
  }, [onReady, value]);
  return (
    <>
      {value.notice}
      {value.dialog}
    </>
  );
}

function capture(value: RsyncIntegration) {
  integration = value;
}

function current(): RsyncIntegration {
  if (!integration) throw new Error("rsync integration 尚未挂载");
  return integration;
}

async function flush() {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

async function renderProbe(onUploaded: () => Promise<void> = async () => {}) {
  await act(async () => {
    root.render(
      <I18nProvider i18n={i18n}>
        <Probe onReady={capture} onUploaded={onUploaded} />
      </I18nProvider>,
    );
    await flush();
  });
}

function button(label: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === label,
  );
}

async function click(label: string) {
  await act(async () => {
    button(label)?.click();
    await flush();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  i18n.load("zh-CN", {});
  i18n.activate("zh-CN");
  ipcMock.rsyncCapabilities.mockResolvedValue(available());
  ipcMock.rsyncPreview.mockResolvedValue(preview());
  ipcMock.rsyncTransfer.mockResolvedValue({
    exitCode: 0,
    transferredBytes: 10,
    networkBytes: 20,
    changedItems: 1,
  });
  useRsyncCapabilityStore.setState({ entries: {} });
  useSettingsStore.setState({
    directoryTransferMode: "rsync",
    rsyncDeleteExtraneous: false,
  });
  useTransfersStore.setState({
    transfers: [],
    dismissed: new Set(),
    runtimeError: undefined,
  });
  useSessionsStore.setState({
    sessions: [
      {
        id: "s1",
        hostId: "h1",
        title: "host",
        status: "connected",
        view: "sftp",
      },
    ],
    activeId: "s1",
  });
  integration = undefined;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("rsync 目录同步交互", () => {
  it("预览与执行共用打开时的删除策略快照", async () => {
    const onUploaded = vi.fn(async () => {});
    await renderProbe(onUploaded);
    await act(async () => {
      await current().startPreview(request);
    });
    expect(ipcMock.rsyncPreview).toHaveBeenLastCalledWith(
      "s1",
      "upload",
      request.localDir,
      request.remoteDir,
      false,
    );
    await act(async () => {
      useSettingsStore.setState({ rsyncDeleteExtraneous: true });
    });
    await click("开始同步");
    expect(ipcMock.rsyncTransfer).toHaveBeenCalledWith(
      "s1",
      "token",
      "upload",
      request.localDir,
      request.remoteDir,
      false,
      expect.any(String),
    );
    expect(onUploaded).toHaveBeenCalledTimes(1);
    const task = useTransfersStore
      .getState()
      .transfers.find(
        (item) => item.id === ipcMock.rsyncTransfer.mock.calls[0][6],
      );
    expect(task).toMatchObject({ status: "success", pausable: false });
  });

  it("关闭弹窗后迟到的预览不重新打开", async () => {
    const pending = deferred<RsyncPreview>();
    ipcMock.rsyncPreview.mockReturnValueOnce(pending.promise);
    await renderProbe();
    await act(async () => {
      void current().startPreview(request);
      await flush();
    });
    expect(ipcMock.rsyncPreview).toHaveBeenCalledTimes(1);
    await click("取消");
    pending.resolve(preview());
    await act(async () => {
      await flush();
    });
    expect(button("开始同步")).toBeUndefined();
    expect(ipcMock.rsyncTransfer).not.toHaveBeenCalled();
  });

  it("取消错误标记为已取消而不是失败", async () => {
    const cancelled: AppError = {
      kind: "custom",
      code: "sftp:transfer_cancelled",
      message: "transfer cancelled",
      args: {},
    };
    ipcMock.rsyncTransfer.mockRejectedValueOnce(cancelled);
    await renderProbe();
    await act(async () => {
      await current().startPreview(request);
    });
    await click("开始同步");
    const task = useTransfersStore.getState().transfers[0];
    expect(task?.status).toBe("cancelled");
    expect(task?.error).toBeUndefined();
  });
});
