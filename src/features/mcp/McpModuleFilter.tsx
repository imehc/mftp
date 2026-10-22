import { Trans, useLingui } from "@lingui/react/macro";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

import type { PresentedModule } from "./catalog-presentation";

export default function McpModuleFilter({
  modules,
  value,
  onChange,
}: {
  modules: PresentedModule[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLingui();
  if (modules.length < 2) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={t`筛选 MCP 模块`} className="w-40 max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">
          <Trans>全部模块</Trans>
        </SelectItem>
        {modules.map((module) => (
          <SelectItem key={module.id} value={module.id}>
            {module.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
