import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { AiProviderErrorCode } from "~/bindings";

// 服务错误保留结构化诊断，展示只依据后端生成的稳定错误码。
export const aiProviderErrorMessages = {
  "ai:request_policy_invalid": msg`AI 请求策略与当前服务不兼容`,
  "ai:cancelled": msg`AI 请求已停止`,
  "ai:output_invalid": msg`AI 返回内容不符合要求的格式`,
  "ai:provider_timeout": msg`AI 请求已达到等待上限`,
  "ai:provider_connection_timeout": msg`连接 AI 服务超时`,
  "ai:provider_first_event_timeout": msg({
    message: "AI 服务未在规定时间内开始响应",
    comment: "等待首个有效协议事件超时，并非等待首个正文字符。",
  }),
  "ai:provider_stream_idle": msg`AI 服务长时间未传回数据，连接已中断`,
  "ai:provider_progress_timeout": msg({
    message: "AI 服务长时间未报告生成进展，本次请求已停止",
    comment: "仅有心跳不能证明推理或正文生成有进展；未声称供应商停止计算。",
  }),
  "ai:provider_incomplete": msg`AI 响应未完整结束，请重新请求`,
  "ai:provider_no_text": msg`AI 已完成响应，但没有返回可用正文`,
  "ai:provider_limit_reached": msg`AI 已达到输出或推理预算上限，结果不完整`,
  "ai:provider_protocol": msg`AI 返回的数据不符合所选协议`,
  "ai:provider_status": msg`AI 服务返回 HTTP 错误，请检查服务配置`,
  "ai:provider_failed": msg`AI 服务未能完成本次请求`,
} satisfies Record<AiProviderErrorCode, MessageDescriptor>;
