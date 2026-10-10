import { useLingui } from "@lingui/react/macro";
import { Scaling } from "lucide-react";

import { displayScales, resolveDisplaySize } from "~/lib/display-size";
import { useSettingsStore } from "~/store/settings";

import SettingChoice from "./SettingChoice";

export default function DisplaySizeSettings() {
  const { t, i18n } = useLingui();
  const size = resolveDisplaySize(
    useSettingsStore((state) => state.displaySize),
  );
  const setSize = useSettingsStore((state) => state.setDisplaySize);
  const selected = size.mode === "system" ? "system" : String(size.scale);
  const legacy =
    size.mode === "manual" &&
    !displayScales.some((scale) => scale === size.scale);
  const percent = i18n.number(size.scale, {
    style: "percent",
    maximumFractionDigits: 1,
  });
  return (
    <SettingChoice
      id="settings-display"
      icon={Scaling}
      title={t`显示大小`}
      segmented
      value={selected}
      description={
        legacy
          ? t({
              message: `当前比例：${percent}`,
              comment: "显示旧版本保存的界面比例；新选项不包含此历史值",
            })
          : undefined
      }
      onChange={(value) => {
        if (value === "system") setSize({ mode: "system", scale: 1 });
        else {
          const scale = displayScales.find((item) => String(item) === value);
          if (scale !== undefined) setSize({ mode: "manual", scale });
        }
      }}
      options={[
        { value: "system", label: t`跟随系统` },
        ...displayScales.map((scale) => ({
          value: String(scale),
          label: i18n.number(scale, { style: "percent" }),
        })),
      ]}
    />
  );
}
