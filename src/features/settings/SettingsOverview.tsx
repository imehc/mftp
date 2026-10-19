import { useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import {
  Database,
  FileClock,
  Info,
  LayoutGrid,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { isDesktopPlatform } from "~/lib/platform";
import { checkForUpdateManually } from "~/lib/updater";
import { useUpdaterStore } from "~/store/updater";

import AppearanceSettings from "./AppearanceSettings";
import AutostartSettingDesktop from "./AutostartSetting.desktop";
import { SettingsEntry, SettingsGroup } from "./SettingsEntry";
import StartupPageSettings from "./StartupPageSettings";
import TransferSetting from "./TransferSetting";

export default function SettingsOverview({ onAi }: { onAi: () => void }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const status = useUpdaterStore((state) => state.status);
  return (
    <div className="grid items-start gap-4 md:grid-cols-2">
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
        {isDesktopPlatform() ? <StartupPageSettings /> : null}
      </SettingsGroup>
      <SettingsGroup title={t`数据与运行`}>
        <SettingsEntry
          icon={Database}
          title={t`数据导入与导出`}
          description={t`备份本机数据`}
          onClick={() =>
            void navigate({ to: "/settings", search: { panel: "data" } })
          }
        />
        <TransferSetting />
        {isDesktopPlatform() ? <AutostartSettingDesktop /> : null}
      </SettingsGroup>
      <SettingsGroup title={t`应用`}>
        <SettingsEntry
          icon={FileClock}
          title={t`活动日志`}
          description={t`查看操作和失败原因`}
          onClick={() => void navigate({ to: "/logs" })}
        />
        {isDesktopPlatform() ? (
          <SettingsEntry
            icon={RefreshCw}
            title={
              status === "ready" ||
              status === "available" ||
              status === "downloading" ||
              status === "restarting"
                ? t`查看更新`
                : status === "checking"
                  ? t`正在检查`
                  : t`检查更新`
            }
            onClick={() => void checkForUpdateManually()}
          />
        ) : null}
        <SettingsEntry
          icon={Info}
          title={t`关于与本地数据`}
          description={t`存储、清理与项目帮助`}
          onClick={() => void navigate({ to: "/about" })}
        />
      </SettingsGroup>
    </div>
  );
}
