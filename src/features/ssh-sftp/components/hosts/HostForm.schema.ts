import { z } from "zod";
import type { Host, HostInput } from "~/types";

export const hostFormSchema = z
  .object({
    label: z.string().trim().min(1, "名称为必填项"),
    host: z.string().trim().min(1, "地址为必填项"),
    port: z.number().int("端口必须是整数").min(1, "端口不能小于 1").max(65535, "端口不能大于 65535"),
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
        message: "请选择一个密钥，或先在密钥管理中导入",
      });
    }
  });

export type HostFormValues = z.infer<typeof hostFormSchema>;

export const emptyHostFormValues: HostFormValues = {
  label: "",
  host: "",
  port: 22,
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
    port: host.port,
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
    username: values.username.trim(),
    password: values.authType === "password" ? values.password : null,
    keyId: values.authType === "key" ? values.keyId : null,
    defaultPath: defaultPath ? defaultPath : null,
  };
}
