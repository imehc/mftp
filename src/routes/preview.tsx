import { createFileRoute } from "@tanstack/react-router";
import FilePreviewPage from "~/features/preview/FilePreviewPage";
import {
  previewKind,
  toPreviewKind,
  type PreviewKind,
} from "~/lib/preview-kind";

interface PreviewSearch {
  /** 在标题栏显示的文件名；同时也作为类型识别的兜底依据。 */
  name: string;
  kind?: PreviewKind;
  /** 给非 BT 调用方的可直接加载 URL（blob:、asset:、http:）。 */
  url?: string;
}

/**
 * 通用预览页面。任何模块都可以带上 `url` 链接到这里；BT 模块则改为
 * 传入 `url` 加载可直接访问的媒体资源。
 */
function PreviewRoute() {
  const { name, kind, url } = Route.useSearch();
  return (
    <FilePreviewPage name={name} kind={kind ?? previewKind(name)} url={url} />
  );
}

export const Route = createFileRoute("/preview")({
  validateSearch: (search: Record<string, unknown>): PreviewSearch => ({
    name: typeof search.name === "string" ? search.name : "",
    kind: toPreviewKind(search.kind),
    url: typeof search.url === "string" ? search.url : undefined,
  }),
  component: PreviewRoute,
});
