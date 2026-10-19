import { useEffect } from "react";

import { type ModuleId } from "~/lib/module-metadata";
import { type ToolRoute, useSettingsStore } from "~/store/settings";

export function useRememberPage(page: ModuleId): void {
  const setLastPage = useSettingsStore((state) => state.setLastPage);

  useEffect(() => {
    setLastPage(page);
  }, [page, setLastPage]);
}

export function useRememberTool(tool: ToolRoute): void {
  const setLastTool = useSettingsStore((state) => state.setLastTool);
  // 仅在路由组件提交后记录，预加载和未完成的导航不改变上次访问。
  useEffect(() => {
    setLastTool(tool);
  }, [setLastTool, tool]);
}
