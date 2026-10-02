import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { z } from "zod";
import type {
  LanSharedDirInput,
  LanTransferSettings,
  LanTrustedDeviceInput,
} from "~/types";
export const lanSecurityModeSchema = z.enum(["code", "trusted", "open"]);
export const lanPermissionSchema = z.enum([
  "readOnly",
  "readWrite",
  "uploadOnly",
]);
type TranslateMessage = (message: MessageDescriptor) => string;
export function createLanSettingsSchema(t: TranslateMessage) {
  return z.object({
    deviceName: z.string(),
    port: z
      .number()
      .int(t(msg`端口必须是整数`))
      .min(1, t(msg`端口不能小于 1`))
      .max(65535, t(msg`端口不能大于 65535`)),
    bindHost: z.string(),
    downloadDir: z.string(),
    autoStart: z.boolean(),
    securityMode: lanSecurityModeSchema,
    defaultPermission: lanPermissionSchema,
    maxConcurrentTransfers: z
      .number()
      .int(t(msg`同时传输数必须是整数`))
      .min(1, t(msg`同时传输数不能小于 1`))
      .max(16, t(msg`同时传输数不能大于 16`)),
  }) satisfies z.ZodType<LanTransferSettings>;
}
export function createLanTrustedDeviceSchema(t: TranslateMessage) {
  return z.object({
    label: z.string(),
    ip: z
      .string()
      .trim()
      .min(1, t(msg`请输入 IP 地址`)),
  });
}
export function createLanSharedDirSchema(t: TranslateMessage) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t(msg`请输入共享目录名称`)),
    path: z
      .string()
      .trim()
      .min(1, t(msg`请选择共享目录`)),
  });
}
export type LanSettingsFormValues = z.infer<
  ReturnType<typeof createLanSettingsSchema>
>;
export type LanTrustedDeviceFormValues = z.infer<
  ReturnType<typeof createLanTrustedDeviceSchema>
>;
export type LanSharedDirFormValues = z.infer<
  ReturnType<typeof createLanSharedDirSchema>
>;
export function lanSharedDirFormValuesToInput(
  values: LanSharedDirFormValues,
): LanSharedDirInput {
  return {
    name: values.name.trim(),
    path: values.path.trim(),
  };
}
export function lanTrustedDeviceFormValuesToInput(
  values: LanTrustedDeviceFormValues,
): LanTrustedDeviceInput {
  const ip = values.ip.trim();
  const label = values.label.trim();
  return {
    label: label || ip,
    ip,
  };
}
