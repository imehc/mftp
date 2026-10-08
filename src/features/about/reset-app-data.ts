import { toIpcError } from "~/lib/errors";
import { appDataReset } from "~/lib/ipc";
import { isDesktopPlatform } from "~/lib/platform";
import type { AppError } from "~/types";

export async function resetApplicationData(
  preferences: Pick<Storage, "removeItem"> = localStorage,
) {
  // 后端可能因在途任务拒绝重置；成功之前不能更改启动设置或客户端偏好。
  await appDataReset();
  const warnings: AppError[] = [];
  if (isDesktopPlatform()) {
    try {
      const { disable } = await import("@tauri-apps/plugin-autostart");
      await disable();
    } catch (cause) {
      warnings.push(toIpcError(cause).payload);
    }
  }
  // 仅清除此应用的既有持久化键；单项失败不阻止其他偏好的清理。
  for (const key of ["mftp-settings", "mftp-games-history", "mftp-poetry"]) {
    try {
      preferences.removeItem(key);
    } catch (cause) {
      warnings.push(toIpcError(cause).payload);
    }
  }
  return warnings;
}
