// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import QueryProvider from "~/app/QueryProvider";
import type { DiagnosticOperation, DiagnosticText } from "~/bindings";
import { createAppQueryClient } from "~/lib/query-client";
import { messages as enMessages } from "~/locales/en/messages";
import { messages as zhMessages } from "~/locales/zh-CN/messages";

vi.mock("~/components/ToolPageHeader", () => ({
  ToolPageHeader: ({
    title,
    leading,
    trailing,
  }: {
    title: ReactNode;
    leading: ReactNode;
    trailing: ReactNode;
  }) => (
    <header>
      {leading}
      <h1>{title}</h1>
      {trailing}
    </header>
  ),
}));
vi.mock("~/components/ui/dropdown-menu", () => {
  const Container = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    DropdownMenu: Container,
    DropdownMenuContent: Container,
    DropdownMenuGroup: Container,
    DropdownMenuTrigger: Container,
    DropdownMenuItem: ({
      children,
      onSelect,
      disabled,
    }: {
      children: ReactNode;
      onSelect: () => void;
      disabled: boolean;
    }) => (
      <button onClick={onSelect} disabled={disabled}>
        {children}
      </button>
    ),
    DropdownMenuCheckboxItem: ({
      children,
      checked,
      onCheckedChange,
    }: {
      children: ReactNode;
      checked: boolean;
      onCheckedChange: (checked: boolean) => void;
    }) => (
      <button aria-pressed={checked} onClick={() => onCheckedChange(!checked)}>
        {children}
      </button>
    ),
  };
});

import {
  executionLogStream,
  executionLogStreamText,
} from "./execution-log-stream";
import ExecutionLogDetailView from "./ExecutionLogDetailView";

const body: DiagnosticText = {
  text: "line one\nline two\n",
  encoding: "utf8",
  receivedBytes: 18,
  capturedBytes: 18,
  redacted: false,
  truncated: false,
  end: "complete",
};
const operation: DiagnosticOperation = {
  id: "hidden-operation-id",
  source: "ssh",
  action: "connect",
  target: "example.test",
  correlationId: "hidden-correlation-id",
  trace: body,
  progress: null,
  discardedDetails: 0,
  metadataTruncated: false,
  redacted: false,
  startedAt: 1,
  elapsedMs: 20,
  status: "passed",
  phase: "finished",
  details: [],
  error: null,
};
vi.mock("~/lib/ipc", () => ({ logsDetail: vi.fn(async () => operation) }));

const copy = vi.fn();
const back = vi.fn();
let client: ReturnType<typeof createAppQueryClient>;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  client = createAppQueryClient();
  copy.mockResolvedValue(undefined);
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(copy);
  i18n.load("zh-CN", zhMessages);
  i18n.load("en", enMessages);
  i18n.activate("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(current = operation) {
  await act(async () =>
    root.render(
      <QueryProvider client={client}>
        <I18nProvider i18n={i18n}>
          <ExecutionLogDetailView operation={current} onBack={back} />
        </I18nProvider>
      </QueryProvider>,
    ),
  );
}

function button(label: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === label,
  );
}

describe("单条终端详情阅读与复制", () => {
  it("默认不显示元信息，复制与显示共享正文投影而非 JSON 快照", async () => {
    await render();
    const text = executionLogStreamText(
      executionLogStream(operation, { localize: (message) => i18n._(message) }),
    );
    expect(container.textContent).not.toMatch(
      /hidden-operation-id|hidden-correlation-id|已捕获/,
    );
    expect(container.querySelector("pre")?.textContent).toBe(body.text);
    await act(async () => button("复制日志")?.click());
    expect(copy).toHaveBeenCalledWith(text);
    await act(async () => button("元信息")?.click());
    expect(container.textContent).toContain(operation.id);
    expect(container.textContent).toContain("已捕获 18 / 已读取 18 字节");
  });

  it("正文获得键盘焦点，Esc 返回列表", async () => {
    await render();
    const region = container.querySelector<HTMLElement>('[role="region"]');
    expect(document.activeElement).toBe(region);
    await act(async () =>
      region?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(back).toHaveBeenCalledOnce();
  });

  it("复制失败在内容区报错，语言切换同步正文与复制标签", async () => {
    copy.mockRejectedValue(new Error("Clipboard denied"));
    await render();
    await act(async () => button("复制日志")?.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Clipboard denied",
    );
    await act(async () => i18n.activate("en"));
    expect(container.querySelector("[data-log-stream]")?.textContent).toContain(
      "SDK",
    );
    expect(
      container.querySelector("[data-log-stream]")?.textContent,
    ).not.toContain("库边界");
    expect(button("Copy log")).toBeDefined();
  });
});
