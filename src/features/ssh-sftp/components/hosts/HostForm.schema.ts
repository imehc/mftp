import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { z } from "zod";

import type { Host, HostInput } from "~/types";

const messages = {
  labelRequired: msg`名称为必填项`,
  hostRequired: msg`地址为必填项`,
  portRequired: msg`端口为必填项`,
  portInteger: msg`端口必须是整数`,
  portMin: msg`端口不能小于 1`,
  portMax: msg`端口不能大于 65535`,
  keyRequired: msg`请选择一个密钥，或先在密钥管理中导入`,
};

type TranslateMessage = (message: MessageDescriptor) => string;

// 校验消息用 msg 描述符 + 运行时 t，不能在普通函数里把 t 当标签模板调用；
// 那样拿不到翻译，Zod 会退回英文默认文案。
function requiredText(t: TranslateMessage, message: MessageDescriptor) {
  return z.string().superRefine((value, ctx) => {
    if (!value.trim()) {
      ctx.addIssue({ code: "custom", message: t(message) });
    }
  });
}

function hostField(t: TranslateMessage) {
  return requiredText(t, messages.hostRequired);
}

function portField(t: TranslateMessage) {
  return z.string().superRefine((raw, ctx) => {
    const value = raw.trim();
    // 输入框保留字符串，允许用户清空后重新输入；保存和测试前再转换。
    if (!value) {
      ctx.addIssue({ code: "custom", message: t(messages.portRequired) });
      return;
    }
    if (!/^\d+$/.test(value)) {
      ctx.addIssue({ code: "custom", message: t(messages.portInteger) });
      return;
    }
    const port = Number(value);
    if (port < 1) {
      ctx.addIssue({ code: "custom", message: t(messages.portMin) });
    } else if (port > 65535) {
      ctx.addIssue({ code: "custom", message: t(messages.portMax) });
    }
  });
}

/** 保存校验：名称、地址、端口、认证方式与密钥都必须可用。 */
export function createHostFormSchema(t: TranslateMessage) {
  return z
    .object({
      label: requiredText(t, messages.labelRequired),
      host: hostField(t),
      port: portField(t),
      username: z.string(),
      authType: z.enum(["password", "key"]),
      password: z.string().nullable(),
      keyId: z.string().nullable(),
      defaultPath: z.string().nullable(),
    })
    .superRefine((value, ctx) => {
      if (value.authType === "key" && !value.keyId) {
        ctx.addIssue({
          code: "custom",
          path: ["keyId"],
          message: t(messages.keyRequired),
        });
      }
    });
}

/**
 * 测试连接只校验实际发往服务器的字段：名称等仅用于本地保存的必填项不参与，
 * 其余规则与保存保持一致，避免测试通过后保存才失败。
 */
export function createHostTestSchema(t: TranslateMessage) {
  return z
    .object({
      host: hostField(t),
      port: portField(t),
      authType: z.enum(["password", "key"]),
      keyId: z.string().nullable(),
    })
    .superRefine((value, ctx) => {
      if (value.authType === "key" && !value.keyId) {
        ctx.addIssue({
          code: "custom",
          path: ["keyId"],
          message: t(messages.keyRequired),
        });
      }
    });
}

export type HostFormValues = z.infer<ReturnType<typeof createHostFormSchema>>;

export const emptyHostFormValues: HostFormValues = {
  label: "",
  host: "",
  port: "22",
  username: "",
  authType: "password",
  password: "",
  keyId: null,
  defaultPath: "",
};

export function hostToFormValues(host: Host | null): HostFormValues {
  if (!host) return emptyHostFormValues;
  return {
    label: host.label,
    host: host.host,
    port: String(host.port),
    username: host.username,
    authType: host.authType,
    password: host.password ?? "",
    keyId: host.keyId ?? null,
    defaultPath: host.defaultPath ?? "",
  };
}

export function hostFormValuesToInput(values: HostFormValues): HostInput {
  const defaultPath = values.defaultPath?.trim();
  return {
    ...values,
    label: values.label.trim(),
    host: values.host.trim(),
    port: Number(values.port),
    username: values.username.trim(),
    password: values.authType === "password" ? values.password : null,
    keyId: values.authType === "key" ? values.keyId : null,
    defaultPath: defaultPath ? defaultPath : null,
  };
}
