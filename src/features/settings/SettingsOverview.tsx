import { useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { Database, FileClock, Info, LayoutGrid, Sparkles } from "lucide-react";

import { McpSettingsEntry } from "~/features/mcp/integration";
import {
  DesktopAutostartSettings,
  DesktopStartupSettings,
} from "~/features/settings/DesktopSettings";
import { UpdateSettingsEntry } from "~/features/updater/integration";
import { isDesktopPlatform } from "~/lib/platform";

import AppearanceSettings from "./AppearanceSettings";
import { SettingsEntry, SettingsGroup } from "./SettingsEntry";
import TransferSetting from "./TransferSetting";

export default function SettingsOverview({ onAi }: { onAi: () => void }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <AppearanceSettings />
      <SettingsGroup title={t`功能`}>
        <SettingsEntry
          icon={Sparkles}
          title={t`AI 服务`}
          description={t`连接与模型设置`}
          onClick={onAi}
        />
        <SettingsEntry
          icon={LayoutGrid}
          title={t`功能入口`}
          description={t`调整首页功能的显示顺序`}
          onClick={() =>
            void navigate({ to: "/settings", search: { panel: "features" } })
          }
        />
        <DesktopStartupSettings />
        <McpSettingsEntry />
      </SettingsGroup>
      <SettingsGroup title={t`数据与运行`}>
        <SettingsEntry
          icon={Database}
          title={t`数据导入与导出`}
          onClick={() =>
            void navigate({ to: "/settings", search: { panel: "data" } })
          }
        />
        <TransferSetting />
        <DesktopAutostartSettings />
      </SettingsGroup>
      <SettingsGroup title={t`应用`}>
        {/* 日志目录入口在日志页的更多菜单中，设置页只保留一个合并入口。 */}
        <SettingsEntry
          icon={FileClock}
          title={t`日志`}
          description={isDesktopPlatform() ? undefined : t`查看操作和失败原因`}
          onClick={() =>
            void navigate({ to: "/activity", search: { tab: "logs" } })
          }
        />
        <UpdateSettingsEntry />
        <SettingsEntry
          icon={Info}
          title={t`关于与本地数据`}
          onClick={() => void navigate({ to: "/about" })}
        />
      </SettingsGroup>
    </div>
  );
}
