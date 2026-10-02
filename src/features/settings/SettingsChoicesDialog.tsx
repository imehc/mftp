import { Trans, useLingui } from "@lingui/react/macro";
import { useLingui as useRuntimeLingui } from "@lingui/react";
import { useTheme } from "next-themes";
import { Check } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutContent,
  DialogLayoutHeader,
  DialogLayoutBody,
} from "~/components/ui/dialog-layout";
import { colorThemes, fontPresets } from "~/lib/color-theme";
import { localeLabels, localeOptions } from "~/i18n/locales";
import { useSettingsStore } from "~/store/settings";
import { useTransfersStore } from "~/store/transfers";
import { isDesktopPlatform } from "~/lib/platform";

export type SettingsChoice =
  "appearance" | "theme" | "language" | "games" | "startup" | "transfer";
export default function SettingsChoicesDialog({
  choice,
  onClose,
}: {
  choice: SettingsChoice | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useRuntimeLingui();
  const { theme, setTheme } = useTheme();
  const settings = useSettingsStore();
  const running = useTransfersStore((state) =>
    state.transfers.some((item) => item.status === "running"),
  );
  const titles = {
    appearance: t`外观`,
    theme: t`主题与字体`,
    language: t`语言`,
    games: t`小游戏`,
    startup: t`启动页面`,
    transfer: t`文件夹传输`,
  };
  const option = (
    value: string,
    label: string,
    selected: boolean,
    action: () => void,
    disabled = false,
  ) => (
    <Button
      key={value}
      variant="ghost"
      fullWidth
      className="justify-between"
      disabled={disabled}
      aria-pressed={selected}
      onClick={action}
    >
      {label}
      {selected ? <Check /> : null}
    </Button>
  );
  return (
    <Dialog
      open={choice !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogLayoutContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="ui-density-adaptive md:max-w-md"
      >
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>{choice ? titles[choice] : ""}</DialogTitle>
        </DialogLayoutHeader>
        <DialogLayoutBody className="flex flex-col gap-2">
          {choice === "appearance"
            ? ["system", "light", "dark"].map((value) =>
                option(
                  value,
                  value === "system"
                    ? t`跟随系统`
                    : value === "light"
                      ? t`浅色`
                      : t`深色`,
                  theme === value,
                  () => setTheme(value),
                ),
              )
            : null}
          {choice === "language"
            ? localeOptions.map((value) =>
                option(
                  value,
                  _(localeLabels[value]),
                  settings.locale === value,
                  () => settings.setLocale(value),
                ),
              )
            : null}
          {choice === "theme" ? (
            <>
              <h3 className="text-muted-foreground text-xs">
                <Trans>主题</Trans>
              </h3>
              {colorThemes.map((item) =>
                option(
                  item.value,
                  item.value === "default"
                    ? t`默认`
                    : item.value === "cyberpunk"
                      ? t`赛博朋克`
                      : item.value,
                  settings.colorTheme === item.value,
                  () => settings.setColorTheme(item.value),
                ),
              )}
              <h3 className="text-muted-foreground mt-2 text-xs">
                <Trans>字体</Trans>
              </h3>
              {fontPresets.map((value) =>
                option(
                  value,
                  value === "theme"
                    ? t`跟随主题`
                    : value === "jakarta"
                      ? "Plus Jakarta"
                      : value[0].toUpperCase() + value.slice(1),
                  settings.fontPreset === value,
                  () => settings.setFontPreset(value),
                ),
              )}
            </>
          ) : null}
          {choice === "games" ? (
            <>
              {option("on", t`显示小游戏`, settings.showGames, () =>
                settings.setShowGames(true),
              )}
              {option("off", t`隐藏小游戏`, !settings.showGames, () =>
                settings.setShowGames(false),
              )}
            </>
          ) : null}
          {choice === "startup" ? (
            <p className="text-muted-foreground text-sm">
              {isDesktopPlatform()
                ? t`桌面启动时恢复上次使用的工具。`
                : t`移动端从首页启动，保留系统返回首页的行为。`}
            </p>
          ) : null}
          {choice === "transfer" ? (
            <>
              {option(
                "archive",
                t`压缩包`,
                settings.directoryTransferMode === "archive",
                () => settings.setDirectoryTransferMode("archive"),
                running,
              )}
              {option(
                "direct",
                t`直连`,
                settings.directoryTransferMode === "direct",
                () => settings.setDirectoryTransferMode("direct"),
                running,
              )}
              {running ? (
                <p className="text-muted-foreground text-xs">
                  <Trans>传输进行中，暂不可修改。</Trans>
                </p>
              ) : null}
            </>
          ) : null}
        </DialogLayoutBody>
      </DialogLayoutContent>
    </Dialog>
  );
}
