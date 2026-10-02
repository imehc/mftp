import { describe, expect, it, vi } from "vitest";
import type { MessageDescriptor } from "@lingui/core";
import {
  createLanSettingsSchema,
  createLanSharedDirSchema,
} from "./lanTransferForms.schema";

describe("LAN 表单本地化校验", () => {
  it("无效端口被拒绝，并使用传入翻译器而非 Zod 默认文案", () => {
    const translate = vi.fn((_message: MessageDescriptor) => "本地化校验失败");
    const schema = createLanSettingsSchema(translate);
    const values = {
      deviceName: "QA",
      port: 0,
      bindHost: "",
      downloadDir: "",
      autoStart: false,
      securityMode: "code",
      defaultPermission: "readWrite",
      maxConcurrentTransfers: 3,
    };
    const result = schema.safeParse(values);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0].message).toBe("本地化校验失败");
    expect(
      translate.mock.calls.every(([message]) => typeof message.id === "string"),
    ).toBe(true);
    expect(schema.safeParse({ ...values, port: 8080 }).success).toBe(true);
  });
  it("共享目录未选择时保留本地化错误", () => {
    const result = createLanSharedDirSchema(() => "请选择目录").safeParse({
      name: "QA",
      path: " ",
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]).toMatchObject({
        path: ["path"],
        message: "请选择目录",
      });
  });
});
