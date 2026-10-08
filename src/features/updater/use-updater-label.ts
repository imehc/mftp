import { useLingui } from "@lingui/react/macro";

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
      return t`当前已是最新版本`;
    case "available":
      return t`发现新版本`;
    case "downloading":
      if (phase === "connecting") return t`正在连接更新源…`;
      if (phase === "verifying") return t`正在校验更新…`;
      return t`正在下载更新`;
    case "ready":
      return failed ? t`更新未完成` : t`更新已准备好`;
    case "restarting":
      return t`正在安装并重启…`;
    case "error":
      return t`更新未完成`;
    default:
      return t`检查更新`;
  }
}
