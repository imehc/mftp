import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useLingui } from "@lingui/react/macro";
import { useLingui as useRuntimeLingui } from "@lingui/react";
import { useTheme } from "next-themes";
import {
  Database,
  FileClock,
  FolderTree,
  Gamepad2,
  Info,
  Languages,
  Monitor,
  Palette,
  PanelsTopLeft,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useSettingsStore } from "~/store/settings";
import { useUpdaterStore } from "~/store/updater";
import { isDesktopPlatform } from "~/lib/platform";
import { checkForUpdateManually, restartToApplyUpdate } from "~/lib/updater";
import { localeLabels } from "~/i18n/locales";
import { SettingsEntry, SettingsGroup } from "./SettingsEntry";
import SettingsChoicesDialog, {
  type SettingsChoice,
} from "./SettingsChoicesDialog";
import AutostartSettingDesktop from "./AutostartSetting.desktop";

export default function SettingsOverview({ onAi }: { onAi: () => void }) {
  const { t } = useLingui();
  const { _ } = useRuntimeLingui();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const settings = useSettingsStore();
  const status = useUpdaterStore((state) => state.status);
  const [choice, setChoice] = useState<SettingsChoice | null>(null);
  return (
    <>
      <div className="grid items-start gap-3 md:grid-cols-2">
        <SettingsGroup title={t`外观与语言`}>
          <SettingsEntry
            icon={Monitor}
            title={t`外观`}
            description={
              theme === "dark"
                ? t`深色`
                : theme === "light"
                  ? t`浅色`
                  : t`跟随系统`
            }
            onClick={() => setChoice("appearance")}
          />
          <SettingsEntry
            icon={Palette}
            title={t`主题与字体`}
            description={
              settings.colorTheme === "default" ? t`默认` : settings.colorTheme
            }
            onClick={() => setChoice("theme")}
          />
          <SettingsEntry
            icon={Languages}
            title={t`语言`}
            description={_(localeLabels[settings.locale])}
            onClick={() => setChoice("language")}
          />
        </SettingsGroup>
        <SettingsGroup title={t`功能`}>
          <SettingsEntry
            icon={Sparkles}
            title={t`AI 服务`}
            description={t`连接与模型设置`}
            onClick={onAi}
          />
          <SettingsEntry
            icon={Gamepad2}
            title={t`小游戏`}
            description={settings.showGames ? t`已开启` : t`已关闭`}
            onClick={() => setChoice("games")}
          />
          <SettingsEntry
            icon={PanelsTopLeft}
            title={t`启动页面`}
            description={isDesktopPlatform() ? t`恢复上次工具` : t`首页`}
            onClick={() => setChoice("startup")}
          />
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
          <SettingsEntry
            icon={FolderTree}
            title={t`文件夹传输`}
            description={
              settings.directoryTransferMode === "archive" ? t`压缩包` : t`直连`
            }
            onClick={() => setChoice("transfer")}
          />
          {isDesktopPlatform() ? (
            <div>
              <AutostartSettingDesktop />
            </div>
          ) : null}
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
                status === "ready"
                  ? t`重启更新`
                  : status === "checking"
                    ? t`正在检查`
                    : t`检查更新`
              }
              disabled={status === "checking" || status === "restarting"}
              onClick={() => {
                if (status === "ready") void restartToApplyUpdate();
                else void checkForUpdateManually();
              }}
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
      <SettingsChoicesDialog choice={choice} onClose={() => setChoice(null)} />
    </>
  );
}
