import { useLingui } from "@lingui/react/macro";
import { MapPin, PanelsTopLeft } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  homeCategoryLabels,
  orderedHomeEntries,
} from "~/features/home/entries";
import { startupPages } from "~/features/navigation/startup";
import { isModuleId } from "~/lib/module-metadata";
import { useSettingsStore } from "~/store/settings";

import SettingChoice from "./SettingChoice";
import SettingsControl from "./SettingsControl";

export default function StartupPageSettings() {
  const { t } = useLingui();
  const settings = useSettingsStore();
  const pages = startupPages({
    visibility: settings.homeEntryVisibility,
    hiddenCategories: settings.hiddenHomeCategories,
    showGames: settings.showGames,
  });
  const selected = pages.find((entry) => entry.id === settings.manualPage);
  const pageTitle = t({
    message: "自定义页面",
    comment: "启动页面设置中，手动选择下次启动时打开的功能页面",
  });
  return (
    <>
      <SettingChoice
        id="settings-startup-mode"
        icon={PanelsTopLeft}
        title={t`启动页面`}
        value={settings.startupMode}
        onChange={(value) => {
          if (value === "home" || value === "manual" || value === "last")
            settings.setStartupMode(value);
        }}
        options={[
          { value: "home", label: t`首页` },
          {
            value: "manual",
            label: t({
              message: "自定义页面",
              comment: "启动模式选项，每次启动打开用户指定的功能页面",
            }),
          },
          {
            value: "last",
            label: t({
              message: "恢复上次页面",
              comment: "启动模式选项，恢复上次访问的工具、文库或小游戏页面",
            }),
          },
        ]}
      />
      {settings.startupMode === "manual" ? (
        <SettingsControl
          id="settings-startup-page"
          icon={MapPin}
          title={pageTitle}
          description={
            selected
              ? undefined
              : pages.length === 0
                ? t`当前没有可用页面，将进入首页。`
                : settings.manualPage
                  ? t`所选页面已隐藏或当前平台不支持，将进入首页。`
                  : t`未选择页面时将进入首页。`
          }
        >
          <Select
            value={selected?.id ?? ""}
            disabled={pages.length === 0}
            onValueChange={(value) => {
              if (isModuleId(value)) settings.setManualPage(value);
            }}
          >
            <SelectTrigger
              id="settings-startup-page"
              aria-label={pageTitle}
              wrapValue
              className="w-40 max-w-full"
            >
              <SelectValue
                placeholder={t({
                  message: "选择页面",
                  comment: "手动指定启动页面的下拉框占位文字",
                })}
              />
            </SelectTrigger>
            <SelectContent>
              {(["tools", "library", "games"] as const).map((category) => {
                const entries = orderedHomeEntries(
                  category,
                  settings.homeEntryOrder[category],
                  pages,
                );
                return entries.length ? (
                  <SelectGroup key={category}>
                    <SelectLabel>{homeCategoryLabels[category]}</SelectLabel>
                    {entries.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null;
              })}
            </SelectContent>
          </Select>
        </SettingsControl>
      ) : null}
    </>
  );
}
