import type { AppError, CustomErrorCode } from "~/bindings";
import { translate } from "~/i18n/translate";
import {
  appDataSectionNames,
  customErrorMessages,
  dataBusyParticipantNames,
  frontendErrorMessages,
  unknownErrorMessage,
  type FrontendErrorCode,
} from "./errors/messages";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPayload(value: unknown): AppError | null {
  if (!isRecord(value)) return null;
  const { kind, code, message, args } = value;
  if (
    (kind !== "custom" && kind !== "external") ||
    typeof code !== "string" ||
    !code.trim() ||
    typeof message !== "string" ||
    !message.trim() ||
    !isRecord(args) ||
    !Object.values(args).every((arg) => typeof arg === "string")
  ) {
    return null;
  }
  // 拷贝协议字段，避免上游对象的后续修改影响已记录的错误。
  return { kind, code, message, args: { ...args } as AppError["args"] };
}

function fallback(code: string, message: string): AppError {
  return { kind: "external", code, message, args: {} };
}

function readUnknown(value: unknown): AppError {
  const payload = readPayload(value);
  if (payload) return payload;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = readPayload(JSON.parse(value));
      if (parsed) return parsed;
    } catch {
      // 旧版 IPC 的普通字符串不是 JSON，原样保留诊断。
    }
    return fallback("legacy:raw", value);
  }
  if (value instanceof Error && value.message.trim()) {
    return fallback("frontend:error", value.message);
  }
  // 不枚举未知对象内容，避免对象字符串、循环引用和敏感字段外泄。
  return fallback("frontend:unknown", "Unknown error");
}

export class IpcError extends Error {
  readonly payload: AppError;

  constructor(payload: AppError) {
    super(payload.message);
    this.name = "IpcError";
    this.payload = payload;
  }

  toString(): string {
    return describeError(this);
  }
}

/**
 * 构造前端自产的 external 错误。
 *
 * 只在拿不到后端错误、又必须向用户解释时使用；`message` 是安全的英文
 * 诊断，展示时按 code 本地化（见 `frontendErrorMessages`）。
 */
export function frontendError(
  code: FrontendErrorCode,
  message: string,
): AppError {
  return { kind: "external", code, message, args: {} };
}

export function toIpcError(value: unknown): IpcError {
  if (value instanceof IpcError) return value;
  try {
    return new IpcError(readUnknown(value));
  } catch {
    // 第三方异常可能包含抛错的属性 getter，归一化本身不能再次失败。
    return new IpcError(fallback("frontend:unknown", "Unknown error"));
  }
}

// 个别 custom code 的 args 携带后端稳定标识，展示前先在公共层翻译为名称。
function resolveValues(code: string, args: AppError["args"]): AppError["args"] {
  if (code === "app:data_busy") {
    const name = dataBusyParticipantNames[args.participant];
    if (name) return { ...args, participant: translate(name) };
  }
  if (code === "appdata:section_invalid") {
    const name = appDataSectionNames[args.section];
    if (name) return { ...args, section: translate(name) };
  }
  return args;
}

export function describeError(value: unknown): string {
  const { payload } = toIpcError(value);
  if (
    payload.kind === "custom" &&
    Object.hasOwn(customErrorMessages, payload.code)
  ) {
    const descriptor = customErrorMessages[payload.code as CustomErrorCode];
    return translate({
      ...descriptor,
      values: resolveValues(payload.code, payload.args),
    });
  }
  if (payload.code === "frontend:unknown")
    return translate(unknownErrorMessage);
  if (
    payload.kind === "external" &&
    Object.hasOwn(frontendErrorMessages, payload.code)
  ) {
    return translate(frontendErrorMessages[payload.code as FrontendErrorCode]);
  }
  return payload.message;
}

/**
 * 判断错误是否为指定 custom code。
 *
 * 领域分支只能依据 kind/code 决策，禁止对 message 做 substring 或
 * 文案相等比较（文案会随语言和措辞变化）。
 */
export function hasCustomCode(value: unknown, code: AppError["code"]): boolean {
  const { payload } = toIpcError(value);
  return payload.kind === "custom" && payload.code === code;
}
