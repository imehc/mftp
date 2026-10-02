import { beforeEach, expect, test } from "vitest";
import { i18n } from "@lingui/core";
import type { CustomErrorCode } from "~/bindings";
import { describeError } from "~/lib/errors";
import { messages as zh } from "~/locales/zh-CN/messages";
import { messages as en } from "~/locales/en/messages";

const codes: CustomErrorCode[] = [
  "ai:authentication_expired",
  "ai:active_provider_changed",
  "ai:revision_conflict",
  "ai:provider_not_found",
  "ai:key_not_found",
  "ai:model_not_found",
  "ai:provider_limit",
  "ai:key_limit",
  "ai:model_limit",
  "ai:provider_duplicate",
  "ai:key_duplicate",
  "ai:model_duplicate",
  "ai:provider_name_invalid",
  "ai:key_label_invalid",
  "ai:display_name_invalid",
  "ai:last_key",
  "ai:last_model",
  "ai:replacement_required",
];

beforeEach(() => {
  i18n.load("zh-CN", zh);
  i18n.load("en", en);
  i18n.activate("zh-CN");
});

test.each(codes)("AI 管理错误 %s 按当前语言展示并隐藏后端诊断", (code) => {
  const error = {
    kind: "custom" as const,
    code,
    message: "private diagnostic",
    args: {},
  };
  const chinese = describeError(error);
  expect(chinese).toMatch(/[\u4e00-\u9fff]/);
  i18n.activate("en");
  const english = describeError(error);
  expect(english).not.toMatch(/[\u4e00-\u9fff]/);
  expect(english).not.toBe(chinese);
  expect(english).not.toContain("private diagnostic");
  expect(english).not.toContain(code);
});
