import { useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import {
  Database,
  FileClock,
  Gamepad2,
  Info,
  PanelsTopLeft,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { Switch } from "~/components/ui/switch";
import { isDesktopPlatform } from "~/lib/platform";
import { checkForUpdateManually } from "~/lib/updater";
import { useSettingsStore } from "~/store/settings";
import { useUpdaterStore } from "~/store/updater";

import AppearanceSettings from "./AppearanceSettings";
import AutostartSettingDesktop from "./AutostartSetting.desktop";
import SettingsControl from "./SettingsControl";
import { SettingsEntry, SettingsGroup } from "./SettingsEntry";
import TransferSetting from "./TransferSetting";

export default function SettingsOverview({ onAi }: { onAi: () => void }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const settings = useSettingsStore();
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
        <SettingsControl
          icon={Gamepad2}
          title={t`小游戏`}
          id="settings-games"
          compact
          description={settings.showGames ? t`已开启` : t`已关闭`}
        >
          <Switch
            id="settings-games"
            checked={settings.showGames}
            onCheckedChange={settings.setShowGames}
          />
        </SettingsControl>
        {isDesktopPlatform() ? (
          <SettingsControl
            icon={PanelsTopLeft}
            title={t`启动页面`}
            id="settings-restore"
            compact
            description={settings.restoreLastTool ? t`恢复上次工具` : t`首页`}
          >
            <Switch
              id="settings-restore"
              aria-label={t({
                message: "恢复上次使用的工具",
                comment: "桌面启动设置开关，关闭后从首页启动",
              })}
              checked={settings.restoreLastTool}
              onCheckedChange={settings.setRestoreLastTool}
            />
          </SettingsControl>
        ) : null}
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
