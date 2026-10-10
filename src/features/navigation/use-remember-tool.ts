import { useEffect } from "react";

import { type ToolRoute, useSettingsStore } from "~/store/settings";

export function useRememberTool(tool: ToolRoute): void {
  const setLastTool = useSettingsStore((state) => state.setLastTool);

  // 仅在路由组件提交后记录，预加载和未完成的导航不改变上次访问。
  useEffect(() => {
    setLastTool(tool);
  }, [setLastTool, tool]);
}
