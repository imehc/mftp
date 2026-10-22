// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SshConnectionTest } from "~/bindings";
import { useHostsStore } from "~/store/hosts";
import type { Host, HostInput, SshKey } from "~/types";

import HostForm from "./HostForm";

const sshTestConnection = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("~/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/ipc")>()),
  sshTestConnection,
}));
vi.mock("sonner", () => ({ toast: toastMock }));

i18n.load("zh-CN", {});
i18n.activate("zh-CN");

const key: SshKey = {
  id: "key-1",
  label: "部署密钥",
  filename: "id_ed25519",
  hasPassphrase: true,
  createdAt: 0,
};

const keyHost: Host = {
  id: "host-1",
  label: "测试主机",
  host: "example.com",
  port: 2222,
  username: "root",
  authType: "key",
  password: null,
  keyId: "key-1",
  defaultPath: null,
  createdAt: 0,
  updatedAt: 0,
};

let root: Root;
let container: HTMLDivElement;
let createHost: Mock<(input: HostInput) => Promise<Host>>;
let updateHost: Mock<(id: string, input: HostInput) => Promise<Host>>;
let onOpenChange: Mock<(open: boolean) => void>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  createHost = vi
    .fn<(input: HostInput) => Promise<Host>>()
    .mockResolvedValue(keyHost);
  updateHost = vi
    .fn<(id: string, input: HostInput) => Promise<Host>>()
    .mockResolvedValue(keyHost);
  onOpenChange = vi.fn<(open: boolean) => void>();
  useHostsStore.setState({ keys: [key], createHost, updateHost });
  sshTestConnection.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function renderForm(host: Host | null) {
  await act(async () => {
    root.render(
      <I18nProvider i18n={i18n}>
        <HostForm open onOpenChange={onOpenChange} host={host} />
      </I18nProvider>,
    );
  });
  // 打开弹窗后的表单重置在微任务中执行。
  await act(async () => {});
}

function input(id: string) {
  return document.querySelector<HTMLInputElement>(`#${id}`);
}

async function type(id: string, value: string) {
  const field = input(id);
  if (!field) throw new Error(`找不到输入框 ${id}`);
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(label: string) {
  return Array.from(document.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(label),
  );
}

async function click(label: string) {
  const target = button(label);
  if (!target) throw new Error(`找不到按钮 ${label}`);
  await act(async () => {
    target.click();
    for (let index = 0; index < 8; index++) await Promise.resolve();
  });
}

describe("主机表单连接测试", () => {
  it("新主机未填名称也能测试并展示解析结果", async () => {
    sshTestConnection.mockResolvedValue({
      host: "example.com",
      port: 22,
      username: "tester",
      home: "/home/tester",
      latencyMs: 128,
    });
    await renderForm(null);
    await type("host-addr", " example.com ");
    await click("测试连接");

    expect(sshTestConnection).toHaveBeenCalledWith(
      {
        label: "",
        host: "example.com",
        port: 22,
        username: "",
        authType: "password",
        password: "",
        keyId: null,
        defaultPath: null,
      },
      undefined,
    );
    expect(toastMock.success).toHaveBeenCalledWith("连接成功", {
      description:
        "tester@example.com:22 · 主目录 /home/tester · 耗时 128 毫秒",
    });
  });

  it("测试失败时展示翻译后的结构化错误", async () => {
    sshTestConnection.mockRejectedValue({
      kind: "custom",
      code: "ssh:key_not_selected",
      message: "Host has no authentication key selected",
      args: {},
    });
    await renderForm(null);
    await type("host-addr", "example.com");
    await click("测试连接");

    expect(toastMock.error).toHaveBeenCalledWith("连接失败", {
      description: "请为主机选择认证密钥",
    });
  });

  it("端口可以清空并提示必填", async () => {
    await renderForm(null);
    await type("host-addr", "example.com");
    await type("host-port", "");
    expect(input("host-port")?.value).toBe("");

    await click("测试连接");
    expect(sshTestConnection).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith("端口为必填项");
  });

  it("带口令密钥先要求口令，且口令不进入保存载荷", async () => {
    sshTestConnection.mockResolvedValue({
      host: "example.com",
      port: 2222,
      username: "root",
      home: "/root",
      latencyMs: 64,
    });
    await renderForm(keyHost);

    expect(input("host-key-passphrase")).toBeTruthy();
    await click("测试连接");
    expect(sshTestConnection).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith("请输入密钥口令后再测试");

    await type("host-key-passphrase", "phrase");
    await click("测试连接");
    expect(sshTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({ keyId: "key-1" }),
      "phrase",
    );

    await click("保存");
    expect(updateHost).toHaveBeenCalledTimes(1);
    const payload = updateHost.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toMatchObject({ label: "测试主机", keyId: "key-1" });
    expect(payload).not.toHaveProperty("passphrase");
  });

  it("修改字段后丢弃晚到的测试结果", async () => {
    let resolveTest: (result: SshConnectionTest) => void = () => {};

    sshTestConnection.mockReturnValue(
      new Promise<SshConnectionTest>((resolve) => {
        resolveTest = resolve;
      }),
    );
    await renderForm(null);
    await type("host-addr", "example.com");
    await click("测试连接");
    expect(sshTestConnection).toHaveBeenCalledTimes(1);

    await type("host-addr", "other.example.com");
    await act(async () => {
      resolveTest({
        host: "example.com",
        port: 22,
        username: "tester",
        home: "/home/tester",
        latencyMs: 12,
      });
      for (let index = 0; index < 8; index++) await Promise.resolve();
    });
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
