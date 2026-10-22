import { Trans } from "@lingui/react/macro";
import { Power } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { describeError } from "~/lib/errors";

import { useAutostart } from "./hooks/use-autostart";
import SettingsControl from "./SettingsControl";

/** 平台专属入口；移动端不挂载，也不调用自启插件。 */
export default function AutostartSettingDesktop() {
  const { enabled, busy, error, update, retry } = useAutostart();
  return (
    <SettingsControl
      icon={Power}
      title={<Trans>开机自启</Trans>}
      id="settings-autostart"
      compact
      error={!!error}
      description={error ? describeError(error) : undefined}
    >
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
    </SettingsControl>
  );
}
