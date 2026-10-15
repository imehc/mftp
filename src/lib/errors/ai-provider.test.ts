import { i18n } from "@lingui/core";
import { beforeEach, expect, test } from "vitest";

import { describeError, toIpcError } from "~/lib/errors";
import { messages as en } from "~/locales/en/messages";
import { messages as zh } from "~/locales/zh-CN/messages";

import { aiProviderErrorMessages } from "./ai-provider";

beforeEach(() => {
  i18n.load("zh-CN", zh);
  i18n.load("en", en);
  i18n.activate("zh-CN");
});

test.each(Object.keys(aiProviderErrorMessages))(
  "AI 服务错误 %s 按错误码翻译且保留诊断参数",
  (code) => {
    const error = {
      kind: "external" as const,
      code,
      message: "backend diagnostic",
      args: { protocol: "responses", phase: "reasoning", receivedBytes: "512" },
    };
    const ipcError = toIpcError(error);
    const chinese = describeError(ipcError);
    expect(chinese).toMatch(/[\u4e00-\u9fff]/);
    i18n.activate("en");
    const english = describeError(ipcError);
    expect(english).not.toMatch(/[\u4e00-\u9fff]/);
    expect(english).not.toContain("backend diagnostic");
    expect(english).not.toContain(code);
    expect(ipcError.payload).toEqual(error);
  },
);

test("不按相同诊断文案把其他错误误判为 AI 服务错误", () => {
  const error = {
    kind: "external" as const,
    code: "http:request",
    message: "AI provider returned an incomplete response",
    args: {},
  };
  expect(describeError(error)).toBe(error.message);
});
