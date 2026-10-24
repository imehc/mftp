import { useTheme } from "next-themes";
import { useEffect } from "react";

import { installBtRuntime } from "~/features/bt/integration";
import { installGameSessionRuntime } from "~/features/games/engine/session-registry";
import { installModelSystemRuntime } from "~/features/model-viewer/system/inbox";
import { installPoetrySyncRuntime } from "~/features/poetry/sync-progress";
import { installTransferRuntime } from "~/features/transfers/runtime/transferRuntime";
import { applyAppIcon } from "~/lib/app-icon";
import {
  applyCjkFont,
  applyColorTheme,
  resolveCjkFont,
  resolveColorTheme,
} from "~/lib/color-theme";
import { applyDisplaySize } from "~/lib/display-size";
import { router } from "~/router";
import { useSettingsStore } from "~/store/settings";

/**
 * 应用运行期：装配需要跨页面存活的后台同步（传输进度、BT 任务快照）。
 *
 * 具体订阅和状态变换归各自模块；这里只负责安装与清理，不实现业务逻辑。
 * 安装函数自身幂等，StrictMode 的重复挂载不会产生重复订阅。
 */
export function AppRuntime() {
  const { resolvedTheme } = useTheme();
  const colorTheme = useSettingsStore((state) => state.colorTheme);
  const displaySize = useSettingsStore((state) => state.displaySize);
  const cjkFont = useSettingsStore((state) => state.cjkFont);
  useEffect(() => {
    const theme = resolvedTheme === "dark" ? "dark" : "light";
    applyAppIcon(theme);
  }, [resolvedTheme]);
  useEffect(() => {
    applyDisplaySize(displaySize);
  }, [displaySize]);
  // 外观由根运行期应用，不依赖旧设置菜单是否挂载。
  useEffect(() => {
    applyColorTheme(resolveColorTheme(colorTheme));
  }, [colorTheme]);
  useEffect(() => {
    applyCjkFont(resolveCjkFont(cjkFont));
  }, [cjkFont]);
  useEffect(() => {
    const disposeModels = installModelSystemRuntime(() =>
      router.navigate({ to: "/tools/model-viewer" }),
    );
    const disposeTransfers = installTransferRuntime();
    const disposeBt = installBtRuntime();
    const disposePoetry = installPoetrySyncRuntime();
    const disposeGames = installGameSessionRuntime();
    return () => {
      // 逆序清理；单个模块的清理失败不应阻止其他模块释放资源。
      disposeModels();
      disposeGames();
      disposePoetry();
      disposeBt();
      disposeTransfers();
    };
  }, []);

  return null;
}
