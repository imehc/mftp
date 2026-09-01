import { createFileRoute } from "@tanstack/react-router";
import BtPreviewScreen from "~/features/bt/BtPreviewScreen";
import PreviewScreen from "~/features/preview/PreviewScreen";
import { desktopOnlyGuard } from "~/lib/platform";
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
  /** BT 流：种子 infohash 以及其中的文件索引。 */
  hash?: string;
  index?: number;
}

/**
 * 通用预览页面。任何模块都可以带上 `url` 链接到这里；BT 模块则改为
 * 传入 `hash` + `index`，由本页解析出流地址（并启动引擎）。
 */
function PreviewRoute() {
  const { name, kind, url, hash, index } = Route.useSearch();
  const resolved = kind ?? previewKind(name);

  if (hash) {
    return (
      <BtPreviewScreen
        infoHash={hash}
        fileIndex={index ?? 0}
        name={name}
        kind={resolved}
      />
    );
  }
  return <PreviewScreen name={name} kind={resolved} url={url ?? null} />;
}

export const Route = createFileRoute("/preview")({
  validateSearch: (search: Record<string, unknown>): PreviewSearch => ({
    name: typeof search.name === "string" ? search.name : "",
    kind: toPreviewKind(search.kind),
    url: typeof search.url === "string" ? search.url : undefined,
    hash: typeof search.hash === "string" ? search.hash : undefined,
    index: Number.isFinite(Number(search.index))
      ? Number(search.index)
      : undefined,
  }),
  beforeLoad: desktopOnlyGuard,
  component: PreviewRoute,
});
