import { useLingui } from "@lingui/react/macro";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { AppError } from "~/bindings";
import { describeError, toIpcError } from "~/lib/errors";

/** 只由桌面入口挂载，读取失败不能伪装成开关已关闭。 */
export function useAutostart() {
  const { t } = useLingui();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void isEnabled()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch((reason) => {
        if (active) setError(toIpcError(reason).payload);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  async function update(value: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (value) await enable();
      else await disable();
      setEnabled(value);
      toast.success(value ? t`已开启开机自启` : t`已关闭开机自启`);
    } catch (reason) {
      toast.error(describeError(reason));
    } finally {
      setBusy(false);
    }
  }

  return {
    enabled,
    busy,
    error,
    update,
    retry: () => {
      setBusy(true);
      setError(null);
      setAttempt((value) => value + 1);
    },
  };
}
