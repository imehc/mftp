import { clearQueryData, invalidateData } from "~/lib/query-client";
import type { AppDataModule } from "~/types";

const scopes: Record<AppDataModule, string[]> = {
  vault: ["vault"],
  hosts: ["hosts", "ssh-keys"],
  todo: ["todo"],
  poetry: ["poetry"],
  activityLogs: ["logs"],
  translationModels: ["translation"],
  downloads: ["bt"],
  cache: ["poetry", "model", "bt"],
};

/** 按实际清理分区通知，不通过导入业务模块破坏平台裁剪。 */
export function clearModuleQueries(module: AppDataModule) {
  clearQueryData(scopes[module]);
  void invalidateData(["about"]);
}
