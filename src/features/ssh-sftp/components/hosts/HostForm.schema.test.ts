import type { MessageDescriptor } from "@lingui/core";
import { describe, expect, it } from "vitest";

import {
  createHostFormSchema,
  createHostTestSchema,
  emptyHostFormValues,
} from "./HostForm.schema";

// 与组件里一样按描述符取文案，确保校验走的是可翻译的 msg。
const t = (message: MessageDescriptor) => message.message ?? message.id;

describe("主机连接测试校验", () => {
  it("不要求填写仅用于本地保存的名称", () => {
    const result = createHostTestSchema(t).safeParse({
      ...emptyHostFormValues,
      host: "example.com",
    });
    expect(result.success).toBe(true);
  });

  it("仍校验地址与端口", () => {
    const missingHost = createHostTestSchema(t).safeParse(emptyHostFormValues);
    expect(missingHost.success).toBe(false);
    expect(missingHost.error?.issues[0]?.message).toBe("地址为必填项");

    const emptyPort = createHostTestSchema(t).safeParse({
      ...emptyHostFormValues,
      host: "example.com",
      port: "",
    });
    expect(emptyPort.success).toBe(false);
    expect(emptyPort.error?.issues[0]?.message).toBe("端口为必填项");

    const invalidPort = createHostTestSchema(t).safeParse({
      ...emptyHostFormValues,
      host: "example.com",
      port: "70000",
    });
    expect(invalidPort.success).toBe(false);
    expect(invalidPort.error?.issues[0]?.message).toBe("端口不能大于 65535");
  });

  it("密钥认证必须选择密钥", () => {
    const result = createHostTestSchema(t).safeParse({
      ...emptyHostFormValues,
      host: "example.com",
      authType: "key",
      keyId: null,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "请选择一个密钥，或先在密钥管理中导入",
    );
  });

  it("保存校验仍要求名称", () => {
    const result = createHostFormSchema(t).safeParse({
      ...emptyHostFormValues,
      host: "example.com",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("名称为必填项");
  });
});
