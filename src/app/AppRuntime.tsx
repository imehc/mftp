import { useEffect } from "react";

import { installBtRuntime } from "~/features/bt/runtime/btRuntime";
import { installPoetrySyncRuntime } from "~/features/poetry/sync-progress";
import { installTransferRuntime } from "~/features/transfers/runtime/transferRuntime";
import {
  applyColorTheme,
  applyFontPreset,
  resolveColorTheme,
  resolveFontPreset,
} from "~/lib/color-theme";
import { useSettingsStore } from "~/store/settings";

/**
 * 应用运行期：装配需要跨页面存活的后台同步（传输进度、BT 任务快照）。
 *
 * 具体订阅和状态变换归各自模块；这里只负责安装与清理，不实现业务逻辑。
 * 安装函数自身幂等，StrictMode 的重复挂载不会产生重复订阅。
 */
export function AppRuntime() {
  const colorTheme = useSettingsStore((state) => state.colorTheme);
  const fontPreset = useSettingsStore((state) => state.fontPreset);
  // 外观由根运行期应用，不依赖旧设置菜单是否挂载。
  useEffect(() => {
    applyColorTheme(resolveColorTheme(colorTheme));
  }, [colorTheme]);
  useEffect(() => {
    applyFontPreset(resolveFontPreset(fontPreset));
  }, [fontPreset]);
  useEffect(() => {
    const disposeTransfers = installTransferRuntime();
    const disposeBt = installBtRuntime();
    const disposePoetry = installPoetrySyncRuntime();
    return () => {
      // 逆序清理；单个模块的清理失败不应阻止其他模块释放资源。
      disposePoetry();
      disposeBt();
      disposeTransfers();
    };
  }, []);

  return null;
}
