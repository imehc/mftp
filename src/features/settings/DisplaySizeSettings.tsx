import { Trans, useLingui } from "@lingui/react/macro";

import { Button } from "~/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { displayScales, resolveDisplaySize } from "~/lib/display-size";
import { useSettingsStore } from "~/store/settings";

export default function DisplaySizeSettings() {
  const { t, i18n } = useLingui();
  const size = resolveDisplaySize(
    useSettingsStore((state) => state.displaySize),
  );
  const setSize = useSettingsStore((state) => state.setDisplaySize);
  return (
    <FieldGroup>
      <Field>
        <FieldLabel id="display-size-mode-label">
          <Trans>显示大小</Trans>
        </FieldLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          value={size.mode}
          className="w-full flex-wrap"
          aria-labelledby="display-size-mode-label"
          onValueChange={(mode) => {
            if (mode === "system" || mode === "manual")
              setSize({ ...size, mode });
          }}
        >
          <ToggleGroupItem value="system">
            <Trans>跟随系统</Trans>
          </ToggleGroupItem>
          <ToggleGroupItem value="manual">
            <Trans comment="手动调整整个应用界面显示大小。">手动调整</Trans>
          </ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>
          <Trans>
            跟随系统时不额外调整大小。手动调整会立即应用到整个界面。
          </Trans>
        </FieldDescription>
      </Field>
      {size.mode === "manual" ? (
        <Field>
          <FieldLabel id="display-size-scale-label">
            <Trans>界面比例</Trans>
          </FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={String(size.scale)}
            className="w-full flex-wrap"
            aria-labelledby="display-size-scale-label"
            onValueChange={(value) => {
              const scale = displayScales.find(
                (scale) => String(scale) === value,
              );
              if (scale !== undefined) setSize({ mode: "manual", scale });
            }}
          >
            {displayScales.map((scale) => (
              <ToggleGroupItem key={scale} value={String(scale)}>
                {new Intl.NumberFormat(i18n.locale, {
                  style: "percent",
                  maximumFractionDigits: 1,
                }).format(scale)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
      ) : null}
      <Field>
        <FieldLabel>
          <Trans comment="显示大小设置中即时预览界面文字的示例。">预览</Trans>
        </FieldLabel>
        <FieldDescription>
          <Trans>文字、按钮与间距将一起调整。</Trans>
        </FieldDescription>
        <Button
          variant="outline"
          density="adaptive"
          onClick={() => setSize({ mode: "system", scale: 1 })}
          disabled={size.mode === "system" && size.scale === 1}
          aria-label={t({
            message: "恢复默认显示大小",
            comment: "清除手动界面比例，恢复跟随系统。",
          })}
        >
          <Trans>恢复默认</Trans>
        </Button>
      </Field>
    </FieldGroup>
  );
}
