import { Trans } from "@lingui/react/macro";
import { Power } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "~/components/ui/field";
import { Switch } from "~/components/ui/switch";
import { describeError } from "~/lib/errors";

import { useAutostart } from "./hooks/use-autostart";

/** 平台专属入口；移动端不挂载，也不调用自启插件。 */
export default function AutostartSettingDesktop() {
  const { enabled, busy, error, update, retry } = useAutostart();
  return (
    <Field
      orientation="horizontal"
      className="min-h-[max(44px,4rem)] gap-3 px-1 py-2"
    >
      <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Power className="size-4" />
      </span>
      <FieldContent>
        <FieldLabel htmlFor="settings-autostart" data-slot="touch-label">
          <Trans>开机自启</Trans>
        </FieldLabel>
        {!error ? (
          <FieldDescription>
            {enabled ? <Trans>已开启</Trans> : <Trans>已关闭</Trans>}
          </FieldDescription>
        ) : null}
        {error ? (
          <FieldDescription role="alert">
            {describeError(error)}
          </FieldDescription>
        ) : null}
      </FieldContent>
      {error ? (
        <Button variant="outline" onClick={retry}>
          <Trans comment="重新读取桌面开机自启状态">重试</Trans>
        </Button>
      ) : (
        <Switch
          id="settings-autostart"
          checked={enabled}
          disabled={busy}
          onCheckedChange={(value) => void update(value)}
        />
      )}
    </Field>
  );
}
