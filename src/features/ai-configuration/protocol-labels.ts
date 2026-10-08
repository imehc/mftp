import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { AiProtocol } from "~/bindings";

export const protocolLabels = {
  responses: msg({
    comment: "AI 上游接口格式名称，保留英文名称",
    message: "Responses",
  }),
  chatCompletions: msg({
    comment: "AI 上游接口格式名称，保留英文名称",
    message: "Chat Completions",
  }),
  anthropicMessages: msg({
    comment: "AI 上游接口格式名称，保留英文名称",
    message: "Anthropic Messages",
  }),
} satisfies Record<AiProtocol, MessageDescriptor>;
