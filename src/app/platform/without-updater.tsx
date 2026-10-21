/** 移动产物的空装配入口，不导入更新器实现或插件。 */
export interface UpdaterActivitySummary {
  running: boolean;
  pending: boolean;
  error: boolean;
}

export function useUpdaterActivitySummary(): UpdaterActivitySummary {
  return { running: false, pending: false, error: false };
}

export function UpdaterActivity() {
  return null;
}

export function UpdaterDialog() {
  return null;
}

export function UpdateMenuItem() {
  return null;
}

export function UpdateSettingsEntry() {
  return null;
}

export function checkForUpdateOnLaunch() {}
