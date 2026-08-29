import { createFileRoute } from "@tanstack/react-router";
import BtPreviewScreen from "~/features/bt/BtPreviewScreen";
import PreviewScreen from "~/features/preview/PreviewScreen";
import { desktopOnlyGuard } from "~/lib/platform";
import { previewKind, toPreviewKind, type PreviewKind } from "~/lib/preview-kind";

interface PreviewSearch {
  /** File name shown in the header; also drives kind detection as fallback. */
  name: string;
  kind?: PreviewKind;
  /** Ready-to-load URL for non-BT callers (blob:, asset:, http:). */
  url?: string;
  /** BT stream: torrent infohash plus the file index inside it. */
  hash?: string;
  index?: number;
}

/**
 * Shared preview page. Any module can link here with a `url`; the BT module
 * passes `hash` + `index` instead so the stream URL is resolved (and the
 * engine started) on this page.
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
