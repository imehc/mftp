import { useLingui } from "@lingui/react/macro";

import { isAndroidPlatform } from "~/lib/platform";
import { useUpdaterStore } from "~/store/updater";

export function useUpdaterLabel() {
  const { t } = useLingui();
  const status = useUpdaterStore((state) => state.status);
  const phase = useUpdaterStore((state) => state.phase);
  const failed = useUpdaterStore((state) => state.error !== null);
  switch (status) {
    case "checking":
      return t`正在检查更新…`;
    case "current":
      // 头部已显示「当前版本 x」，正文不再重复“当前”。
      return t`已是最新版本`;
    case "available":
      return t`发现新版本`;
    case "downloading":
      // 操作栏里的紧凑标签，和旁边的字节数同排，不用完整句子。
      if (phase === "connecting") return t`连接中`;
      if (phase === "verifying") return t`校验中`;
      return t`下载中`;
    case "ready":
      return failed ? t`更新未完成` : t`更新已准备好`;
    case "restarting":
      // Android 交给系统安装器，应用会被替换，不存在“重启并应用”。
      return isAndroidPlatform() ? t`安装中` : t`正在安装并重启…`;
    case "error":
      return t`更新未完成`;
    default:
      return t`检查更新`;
  }
}

/** 头部一行摘要：左侧是结果状态，右侧是版本口径。 */
export interface UpdaterSummary {
  lead: string | null;
  detail: string | null;
}

/**
 * 检查、下载等进行中的进度文案由 UpdaterProgress 独占，这里返回 null，
 * 避免同一阶段在一行摘要和进度块里各说一遍。
 */
export function useUpdaterSummary(): UpdaterSummary {
  const { t } = useLingui();
  const status = useUpdaterStore((state) => state.status);
  const version = useUpdaterStore((state) => state.version);
  const currentVersion = useUpdaterStore((state) => state.currentVersion);
  const installed = useUpdaterStore((state) => state.installed);
  const failed = useUpdaterStore((state) => state.error !== null);
  // 标题已经是「更新」，不再重复“版本”二字。
  const versions =
    version && currentVersion
      ? t`${version} · 当前 ${currentVersion}`
      : currentVersion
        ? t`当前版本 ${currentVersion}`
        : null;
  switch (status) {
    case "available":
      return { lead: t`发现新版本`, detail: versions };
    case "ready":
      if (failed) return { lead: t`更新未完成`, detail: versions };
      if (isAndroidPlatform())
        return {
          lead: installed ? t`更新已安装` : t`更新已准备好`,
          detail: installed
            ? t`重新打开应用后生效`
            : t`交给系统安装器，请先保存工作`,
        };
      return {
        lead: installed ? t`更新已安装` : t`更新已准备好`,
        detail: installed ? t`重启应用后生效` : t`重启时安装，请先保存工作`,
      };
    case "error":
      return { lead: t`更新未完成`, detail: versions };
    default:
      return { lead: null, detail: versions };
  }
}
