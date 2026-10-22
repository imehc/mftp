// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppError, RsyncCapabilities } from "~/types";

import RsyncCapabilityNotice from "./RsyncCapabilityNotice";

i18n.load("zh-CN", {});
i18n.activate("zh-CN");

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderNotice({
  capabilities,
  loading = false,
  error = null,
  onRefresh = vi.fn(),
}: {
  capabilities: RsyncCapabilities | null;
  loading?: boolean;
  error?: AppError | null;
  onRefresh?: () => void;
}) {
  await act(async () => {
    root.render(
      <I18nProvider i18n={i18n}>
        <RsyncCapabilityNotice
          capabilities={capabilities}
          loading={loading}
          error={error}
          onRefresh={onRefresh}
        />
      </I18nProvider>,
    );
  });
}

function text() {
  return container.textContent ?? "";
}

function button(label: string) {
  return Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(label),
  );
}

describe("rsync 能力提示", () => {
  it("本机缺少 rsync 时展示安装命令并可重新检测", async () => {
    const onRefresh = vi.fn();
    await renderNotice({
      capabilities: {
        local: { status: "missing" },
        remote: { status: "available", version: "3.2.7" },
      },
      onRefresh,
    });
    expect(text()).toContain("未找到 rsync");
    expect(text()).toContain("brew install rsync");
    expect(text()).toContain("在本机终端执行对应命令。");
    await act(async () => button("重新检测")?.click());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("两侧可用且没有错误时不占用内容区", async () => {
    await renderNotice({
      capabilities: {
        local: { status: "available", version: "3.2.7" },
        remote: { status: "available", version: "3.2.7" },
      },
    });
    expect(container.innerHTML).toBe("");
  });

  it("探测失败按本机或远端本地化诊断", async () => {
    await renderNotice({
      capabilities: null,
      error: {
        kind: "custom",
        code: "rsync:probe_failed",
        message: "Local rsync probe failed",
        args: { side: "local", detail: "permission denied" },
      },
    });
    expect(text()).toContain("无法检测本机的 rsync：permission denied");
  });
});
