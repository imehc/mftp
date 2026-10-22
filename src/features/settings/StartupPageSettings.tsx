import { useLingui } from "@lingui/react/macro";
import { Check, PanelsTopLeft } from "lucide-react";
import { useEffect, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  homeCategoryLabels,
  orderedHomeEntries,
} from "~/features/home/entries";
import { startupPages } from "~/features/navigation/startup";
import { type StartupMode, useSettingsStore } from "~/store/settings";

import SettingMenuTrigger from "./SettingMenuTrigger";
import SettingsControl from "./SettingsControl";

export default function StartupPageSettings() {
  const { t } = useLingui();
  const settings = useSettingsStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [customPagesOpen, setCustomPagesOpen] = useState(false);
  const pages = startupPages({
    visibility: settings.homeEntryVisibility,
    hiddenCategories: settings.hiddenHomeCategories,
    showGames: settings.showGames,
  });
  const selected = pages.find((entry) => entry.id === settings.manualPage);
  const title = t`启动页面`;
  const modeLabels: Record<StartupMode, string> = {
    home: t`首页`,
    manual: t({
      message: "自定义页面",
      comment: "启动模式选项，每次启动打开用户指定的功能页面",
    }),
    last: t({
      message: "恢复上次页面",
      comment: "启动模式选项，恢复上次访问的工具、文库或小游戏页面",
    }),
  };
  let description: string | undefined;
  if (settings.startupMode === "manual" && !selected) {
    description =
      pages.length === 0
        ? t`当前没有可用页面，将进入首页。`
        : settings.manualPage
          ? t`所选页面已隐藏或当前平台不支持，将进入首页。`
          : t`未选择页面时将进入首页。`;
  }
  // 手动模式直接显示二级选项里选中的页面，避免收起菜单后还要再展开确认。
  const triggerLabel =
    settings.startupMode === "manual"
      ? (selected?.title ?? modeLabels.manual)
      : modeLabels[settings.startupMode];
  // Radix 的 Sub 在 StrictMode 挂载清理时会补发一次关闭；延后到挂载稳定后再展开，
  // 避免默认展开状态被这次清理覆盖。
  useEffect(() => {
    if (!menuOpen || settings.startupMode !== "manual") return;
    const timer = window.setTimeout(() => setCustomPagesOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [menuOpen, settings.startupMode]);
  return (
    <SettingsControl
      id="settings-startup-mode"
      icon={PanelsTopLeft}
      title={title}
      description={description}
    >
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          // 非手动模式不沿用上次的二级展开状态，但仍允许用户手动展开。
          if (open && settings.startupMode !== "manual")
            setCustomPagesOpen(false);
        }}
      >
        <DropdownMenuTrigger asChild>
          <SettingMenuTrigger
            id="settings-startup-mode"
            label={triggerLabel}
            aria-label={title}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          collisionPadding={8}
          className="ui-density-adaptive min-w-40"
        >
          <DropdownMenuItem onSelect={() => settings.setStartupMode("home")}>
            <span className="flex-1 whitespace-nowrap">{modeLabels.home}</span>
            {settings.startupMode === "home" ? <Check aria-hidden /> : null}
          </DropdownMenuItem>
          <DropdownMenuSub
            open={menuOpen && customPagesOpen}
            onOpenChange={setCustomPagesOpen}
          >
            <DropdownMenuSubTrigger>
              <span className="flex-1 whitespace-nowrap">
                {modeLabels.manual}
              </span>
              {settings.startupMode === "manual" ? <Check aria-hidden /> : null}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="ui-density-adaptive max-h-80 min-w-40 overflow-y-auto">
              {pages.length === 0 ? (
                <DropdownMenuLabel>
                  {t`当前没有可用页面，将进入首页。`}
                </DropdownMenuLabel>
              ) : (
                (["tools", "library", "games"] as const).map((category) => {
                  const entries = orderedHomeEntries(
                    category,
                    settings.homeEntryOrder[category],
                    pages,
                  );
                  if (!entries.length) return null;
                  return (
                    <DropdownMenuGroup key={category}>
                      <DropdownMenuLabel>
                        {homeCategoryLabels[category]}
                      </DropdownMenuLabel>
                      {entries.map((entry) => (
                        <DropdownMenuItem
                          key={entry.id}
                          onSelect={() => {
                            settings.setManualPage(entry.id);
                            settings.setStartupMode("manual");
                          }}
                        >
                          <span className="flex-1 whitespace-nowrap">
                            {entry.title}
                          </span>
                          {entry.id === selected?.id ? (
                            <Check aria-hidden />
                          ) : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  );
                })
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onSelect={() => settings.setStartupMode("last")}>
            <span className="flex-1 whitespace-nowrap">{modeLabels.last}</span>
            {settings.startupMode === "last" ? <Check aria-hidden /> : null}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsControl>
  );
}
