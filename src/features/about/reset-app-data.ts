import type { AppDataResetResult } from "~/bindings";
import { clearGameCheckpoints } from "~/features/games/engine/checkpoint-storage";
import { disposeGameResources } from "~/features/games/engine/session-registry";
import { toIpcError } from "~/lib/errors";
import {
  appDataReset,
  appDataResetFinish,
  appDataResetResume,
} from "~/lib/ipc";
import { isDesktopPlatform } from "~/lib/platform";
import type { AppError } from "~/types";

export async function resetApplicationData(
  preferences: Pick<Storage, "removeItem"> = localStorage,
  resumeId?: string,
) {
  // 只有用户确认才调用；恢复入口只继续已有操作，不重新清空主数据库。
  const result = resumeId
    ? await appDataResetResume(resumeId)
    : await appDataReset();
  return finishClientReset(result, preferences);
}

async function finishClientReset(
  result: AppDataResetResult,
  preferences: Pick<Storage, "removeItem">,
) {
  const warnings: AppError[] = [];
  if (result.progress.pending.length)
    return { result, warnings, finished: false };
  disposeGameResources();
  try {
    await clearGameCheckpoints();
  } catch {
    warnings.push({
      kind: "external",
      code: "games:checkpoint_delete",
      message: "Game checkpoint reset failed",
      args: {},
    });
  }
  if (isDesktopPlatform()) {
    try {
      const { disable } = await import("@tauri-apps/plugin-autostart");
      await disable();
    } catch (cause) {
      warnings.push(toIpcError(cause).payload);
    }
  }
  // 根级恢复边界已卸载业务页面；清理期间旧状态不能重新持久化。
  for (const key of [
    "mftp-settings",
    "mftp-games-history",
    "mftp-poetry",
    "theme",
  ]) {
    try {
      preferences.removeItem(key);
    } catch (cause) {
      warnings.push(toIpcError(cause).payload);
    }
  }
  let finished = false;
  if (!warnings.length) {
    try {
      await appDataResetFinish(result.progress.id);
      finished = true;
    } catch (cause) {
      warnings.push(toIpcError(cause).payload);
    }
  }
  // 容量统计失败只是诊断，不把已清理的数据重新纳入恢复任务。
  if (result.usageError) warnings.push(result.usageError);
  return { result, warnings, finished };
}
