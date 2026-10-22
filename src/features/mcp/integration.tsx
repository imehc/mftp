import { useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { Plug } from "lucide-react";

import { SettingsEntry } from "~/features/settings/SettingsEntry";
import { isDesktopPlatform } from "~/lib/platform";

import McpSettings from "./McpSettings";

export function McpSettingsEntry() {
  const { t } = useLingui();
  const navigate = useNavigate();
  if (!isDesktopPlatform()) return null;
  return (
    <SettingsEntry
      icon={Plug}
      title={t`MCP 服务`}
      description={t`授权本机模型访问应用模块`}
      onClick={() =>
        void navigate({ to: "/settings", search: { panel: "mcp" } })
      }
    />
  );
}

export function McpSettingsPanel() {
  return isDesktopPlatform() ? <McpSettings /> : null;
}
