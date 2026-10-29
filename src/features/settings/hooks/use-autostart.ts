import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { describeError } from "~/lib/errors";
import { ipcQuery, queryScopeGuard } from "~/lib/query-client";

/** 只由桌面入口挂载，读取失败不能伪装成开关已关闭。 */
export function useAutostart() {
  const { t } = useLingui();
  const client = useQueryClient();
  const query = useQuery(ipcQuery(["settings", "autostart"], isEnabled));
  const [pending, setPending] = useState(false);
  const writing = useRef(false);
  const enabled = query.data ?? false;
  const busy = pending || query.isLoading;
  const error = query.error?.payload ?? null;

  async function update(value: boolean) {
    if (writing.current || busy) return;
    const current = queryScopeGuard(client, "settings");
    writing.current = true;
    setPending(true);
    try {
      if (value) await enable();
      else await disable();
      await client.cancelQueries({ queryKey: ["settings", "autostart"] });
      if (current()) client.setQueryData(["settings", "autostart"], value);
      toast.success(value ? t`已开启开机自启` : t`已关闭开机自启`);
    } catch (reason) {
      toast.error(describeError(reason, t));
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  return {
    enabled,
    busy,
    error,
    update,
    retry: () => {
      void query.refetch({ cancelRefetch: false });
    },
  };
}
