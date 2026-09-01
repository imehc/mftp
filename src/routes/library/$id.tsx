import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import PoemDetailPage from "~/features/poetry/PoemDetailPage";
import { desktopOnlyGuard } from "~/lib/platform";
import { useSettingsStore } from "~/store/settings";

/**
 * 独立详情路由：桌面端 UI 在 `/library` 右侧面板展示详情，但直接链接
 *（例如某个合集重新同步后）仍必须能渲染出完整页面。
 */
function LibraryPoemRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);
  const uid = Route.useParams().id;

  useEffect(() => {
    setLastTool("library");
  }, [setLastTool]);

  return <PoemDetailPage uid={uid} />;
}

export const Route = createFileRoute("/library/$id")({
  beforeLoad: desktopOnlyGuard,
  component: LibraryPoemRoute,
});
