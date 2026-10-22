// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RsyncIntegration } from "~/features/ssh-sftp/components/sftp/rsync-contract";
import type {
  ConflictState,
  PromptState,
} from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";
import { useSettingsStore } from "~/store/settings";
import type { SftpEntry } from "~/types";

import { useSftpTransferActions } from "./useSftpTransferActions";

const dialogMock = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: dialogMock.open,
  save: dialogMock.save,
}));

const ipcMock = vi.hoisted(() => ({
  sftpExists: vi.fn(),
  sftpUploadDir: vi.fn(),
}));

vi.mock("~/lib/ipc", () => ({
  sftpExists: ipcMock.sftpExists,
  sftpUploadDir: ipcMock.sftpUploadDir,
}));

const toastMock = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: toastMock.error } }));

type Actions = ReturnType<typeof useSftpTransferActions>;

const entry: SftpEntry = {
  name: "project",
  path: "/srv/project",
  isDir: true,
  isSymlink: false,
  size: 0,
  mtime: 0,
  mode: 0o755,
};

let actions: Actions | undefined;
let prompt: PromptState;
let conflict: ConflictState;
let root: Root;
let container: HTMLDivElement;

function Probe({
  rsync,
  onReady,
  onPrompt,
  onConflict,
}: {
  rsync: RsyncIntegration;
  onReady: (value: Actions) => void;
  onPrompt: (value: PromptState) => void;
  onConflict: (value: ConflictState) => void;
}) {
  const value = useSftpTransferActions({
    sessionId: "s1",
    cwd: "/home",
    load: async () => {},
    setPrompt: onPrompt,
    setConflict: onConflict,
    rsync,
  });
  // 测试探针只能在提交后取得 hook 结果，渲染期间不写外部变量。
  useEffect(() => {
    onReady(value);
  }, [onReady, value]);
  return null;
}

function capture(value: Actions) {
  actions = value;
}

function capturePrompt(next: PromptState) {
  prompt = next;
}

function captureConflict(next: ConflictState) {
  conflict = next;
}

function current(): Actions {
  if (!actions) throw new Error("transfer actions 尚未挂载");
  return actions;
}

function integration(
  overrides: Partial<RsyncIntegration> = {},
): RsyncIntegration {
  return {
    supported: true,
    active: true,
    startPreview: vi.fn(async () => {}),
    notice: null,
    dialog: null,
    ...overrides,
  };
}

async function render(rsync: RsyncIntegration) {
  await act(async () => {
    root.render(
      <I18nProvider i18n={i18n}>
        <Probe
          rsync={rsync}
          onReady={capture}
          onPrompt={capturePrompt}
          onConflict={captureConflict}
        />
      </I18nProvider>,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  i18n.load("zh-CN", {});
  i18n.activate("zh-CN");
  prompt = null;
  conflict = null;
  actions = undefined;
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

describe("SFTP 文件夹传输动作路由", () => {
  it("直连模式上传文件夹仍走冲突检查与命名提示", async () => {
    useSettingsStore.setState({ directoryTransferMode: "direct" });
    dialogMock.open.mockResolvedValue("/Users/me/project");
    ipcMock.sftpExists.mockResolvedValue(false);
    const rsync = integration();
    await render(rsync);

    await act(async () => {
      await current().onUploadDir();
    });

    expect(ipcMock.sftpExists).toHaveBeenCalledWith("s1", "/home/project");
    expect(prompt).toMatchObject({
      kind: "uploadDir",
      localDir: "/Users/me/project",
      initialName: "project",
    });
    expect(rsync.startPreview).not.toHaveBeenCalled();
    expect(ipcMock.sftpUploadDir).not.toHaveBeenCalled();
  });

  it("rsync 模式上传文件夹直接发起预览", async () => {
    useSettingsStore.setState({ directoryTransferMode: "rsync" });
    dialogMock.open.mockResolvedValue("/Users/me/project");
    const rsync = integration();
    await render(rsync);

    await act(async () => {
      await current().onUploadDir();
    });

    expect(rsync.startPreview).toHaveBeenCalledWith({
      direction: "upload",
      localDir: "/Users/me/project",
      remoteDir: "/home/project",
      displayName: "project",
    });
    expect(ipcMock.sftpExists).not.toHaveBeenCalled();
    expect(prompt).toBeNull();
    expect(conflict).toBeNull();
  });

  it("rsync 模式下载文件夹按远端目录生成本机目标", async () => {
    useSettingsStore.setState({ directoryTransferMode: "rsync" });
    dialogMock.open.mockResolvedValue("/Users/me/Downloads");
    const rsync = integration();
    await render(rsync);

    await act(async () => {
      await current().onDownload(entry);
    });

    expect(rsync.startPreview).toHaveBeenCalledWith({
      direction: "download",
      localDir: "/Users/me/Downloads/project",
      remoteDir: "/srv/project",
      displayName: "project",
    });
  });

  it("当前平台不支持 rsync 时先拦截，不打开目录选择器", async () => {
    useSettingsStore.setState({ directoryTransferMode: "rsync" });
    const rsync = integration({ supported: false });
    await render(rsync);

    await act(async () => {
      await current().onUploadDir();
    });

    expect(dialogMock.open).not.toHaveBeenCalled();
    expect(rsync.startPreview).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      "当前平台不支持 rsync，请选择压缩包或直连。",
    );
  });
});
