import { Trans, useLingui } from "@lingui/react/macro";

import type { AiProtocol } from "~/bindings";
import { Field, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

import { protocolLabels } from "./protocol-labels";

interface Props {
  value: AiProtocol;
  onChange: (value: AiProtocol) => void;
  disabled: boolean;
}

export function AiProtocolField({ value, onChange, disabled }: Props) {
  const { t } = useLingui();
  return (
    <Field>
      <FieldLabel htmlFor="ai-protocol">
        <Trans comment="添加或编辑 AI 服务商时选择上游 API 协议">
          接口格式
        </Trans>
      </FieldLabel>
      <Select
        value={value}
        onValueChange={(next) => {
          if (
            next === "responses" ||
            next === "chatCompletions" ||
            next === "anthropicMessages"
          )
            onChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger id="ai-protocol" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(protocolLabels).map(([protocol, label]) => (
            <SelectItem key={protocol} value={protocol}>
              {t(label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
