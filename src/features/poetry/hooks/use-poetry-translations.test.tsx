// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import QueryProvider from "~/app/QueryProvider";
import type { AiConfigurationView, PoetryTranslation } from "~/bindings";
import {
  aiConfigurationGet,
  poetryPackTranslationsList,
  poetryTranslationDelete,
  poetryTranslationGenerate,
  poetryTranslationsList,
  poetryTranslationUpdate,
} from "~/lib/ipc";
import { createAppQueryClient } from "~/lib/query-client";

import { usePoetryTranslations } from "./use-poetry-translations";

vi.mock("~/lib/ipc", () => ({
  aiConfigurationGet: vi.fn(),
  poetryPackTranslationsList: vi.fn(),
  poetryTranslationDelete: vi.fn(),
  poetryTranslationGenerate: vi.fn(),
  poetryTranslationsList: vi.fn(),
  poetryTranslationUpdate: vi.fn(),
}));
vi.mock("~/features/ai-configuration/request-readiness", () => ({
  hasAiRequestSelection: () => true,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
i18n.load("zh-CN", {});
i18n.activate("zh-CN");

const client = createAppQueryClient();
let root: Root;
let container: HTMLDivElement;
let controller: ReturnType<typeof usePoetryTranslations>;
let mounted: boolean;

function item(
  mode: PoetryTranslation["mode"],
  source: PoetryTranslation["source"] = "ai",
  updatedAt = 1,
): PoetryTranslation {
  return {
    id: mode,
    poemUid: "poem",
    bodyFingerprint: "body",
    language: "zh-CN",
    mode,
    promptVersion: 2,
    content: `${mode} 原有正文`,
    source,
    model: "model",
    createdAt: 1,
    updatedAt,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Probe() {
  const value = usePoetryTranslations("poem");
  useEffect(() => {
    controller = value;
  });
  return null;
}

async function mount() {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <QueryProvider client={client}>
          <Probe />
        </QueryProvider>
      </I18nProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(aiConfigurationGet).mockResolvedValue({} as AiConfigurationView);
  vi.mocked(poetryTranslationsList).mockResolvedValue([]);
  vi.mocked(poetryPackTranslationsList).mockResolvedValue([]);
  vi.mocked(poetryTranslationDelete).mockResolvedValue(undefined);
  vi.mocked(poetryTranslationGenerate).mockReturnValue({
    promise: Promise.resolve(item("literal", "ai", 3)),
    cancel: vi.fn(async () => {}),
    detach: vi.fn(),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});

describe("统一译文操作", () => {
  it("读取历史记录不自动生成，新请求统一白话并避免重复发送", async () => {
    vi.mocked(poetryTranslationsList).mockResolvedValue([item("literary")]);
    await mount();
    expect(poetryTranslationGenerate).not.toHaveBeenCalled();
    await act(async () => {
      controller.requestGeneration();
      controller.requestGeneration();
    });
    expect(poetryTranslationGenerate).toHaveBeenCalledTimes(1);
    expect(poetryTranslationGenerate).toHaveBeenCalledWith(
      "poem",
      "literal",
      expect.any(Function),
    );
    expect(controller.current?.mode).toBe("literal");
  });

  it("编辑和删除针对实际历史记录，删除后回退保留的另一条", async () => {
    const literal = item("literal");
    const literary = item("literary", "user", 2);
    vi.mocked(poetryTranslationsList).mockResolvedValue([literal, literary]);
    await mount();
    await act(async () => controller.startEdit());
    await act(async () => controller.setEditContent("修改后的现代汉语"));
    vi.mocked(poetryTranslationUpdate).mockResolvedValue({
      ...literary,
      content: "修改后的现代汉语",
      updatedAt: 4,
    });
    await act(async () => controller.saveEdit());
    expect(poetryTranslationUpdate).toHaveBeenCalledWith(
      "poem",
      "literary",
      "修改后的现代汉语",
    );
    expect(controller.current?.content).toBe("修改后的现代汉语");
    await act(async () => controller.remove());
    expect(poetryTranslationDelete).toHaveBeenCalledWith("poem", "literary");
    expect(controller.current).toEqual(literal);
  });

  it("人工修订先确认，确认后新译文可见且原有记录仍可回退", async () => {
    const edited = item("literary", "user", 2);
    vi.mocked(poetryTranslationsList).mockResolvedValue([edited]);
    await mount();
    await act(async () => controller.requestGeneration());
    expect(controller.regenerateOpen).toBe(true);
    expect(controller.replacesManualTranslation).toBe(false);
    expect(poetryTranslationGenerate).not.toHaveBeenCalled();
    await act(async () => controller.generate());
    expect(controller.current?.mode).toBe("literal");
    await act(async () => controller.remove());
    expect(controller.current).toEqual(edited);
  });

  it("覆盖统一译文中的人工修订时给出对应后果", async () => {
    vi.mocked(poetryTranslationsList).mockResolvedValue([
      item("literal", "user"),
    ]);
    await mount();
    await act(async () => controller.requestGeneration());
    expect(controller.regenerateOpen).toBe(true);
    expect(controller.replacesManualTranslation).toBe(true);
    expect(poetryTranslationGenerate).not.toHaveBeenCalled();
  });

  it("读取失败不当作没有译文，也不启动生成", async () => {
    vi.mocked(poetryTranslationsList).mockRejectedValue(
      new Error("read failed"),
    );
    await mount();
    expect(controller.readError).not.toBeNull();
    await act(async () => controller.requestGeneration());
    expect(poetryTranslationGenerate).not.toHaveBeenCalled();
  });
});

describe("生成的取消与生命周期", () => {
  it("配置读取期间取消后不再发送生成请求", async () => {
    const configuration = deferred<AiConfigurationView>();
    vi.mocked(aiConfigurationGet).mockReturnValue(configuration.promise);
    await mount();
    await act(async () => controller.requestGeneration());
    expect(controller.generating).toBe(true);
    await act(async () => controller.cancelGeneration());
    await act(async () => configuration.resolve({} as AiConfigurationView));
    expect(poetryTranslationGenerate).not.toHaveBeenCalled();
    expect(controller.generating).toBe(false);
  });

  it("用户取消后忽略迟到结果，保留原有译文", async () => {
    const old = item("literary");
    vi.mocked(poetryTranslationsList).mockResolvedValue([old]);
    const result = deferred<PoetryTranslation>();
    const cancel = vi.fn(async () => {});
    vi.mocked(poetryTranslationGenerate).mockReturnValue({
      promise: result.promise,
      cancel,
      detach: vi.fn(),
    });
    await mount();
    await act(async () => controller.requestGeneration());
    await act(async () => controller.cancelGeneration());
    await act(async () => result.resolve(item("literal", "ai", 3)));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(controller.current).toEqual(old);
    expect(controller.generating).toBe(false);
  });

  it("离开作品只解除订阅，不冒充用户取消", async () => {
    const result = deferred<PoetryTranslation>();
    const cancel = vi.fn(async () => {});
    const detach = vi.fn();
    vi.mocked(poetryTranslationGenerate).mockReturnValue({
      promise: result.promise,
      cancel,
      detach,
    });
    await mount();
    await act(async () => controller.requestGeneration());
    await act(async () => root.unmount());
    mounted = false;
    expect(detach).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    await act(async () => result.resolve(item("literal", "ai", 3)));
  });
});
