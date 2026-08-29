import { memo, useMemo, useRef } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  File as FileIcon,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Play,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { BtFileMeta } from "~/types";
import { cn } from "~/lib/utils";
import { formatBytes } from "~/lib/format";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { isPreviewable, previewKind, type PreviewKind } from "~/lib/preview-kind";

const KIND_ICONS = {
  video: Film,
  audio: Music,
  image: ImageIcon,
  text: FileText,
  other: FileIcon,
} as const;

/** Preview affordance: playback for time-based media, viewer for the rest. */
const PREVIEW_ICONS = {
  video: Play,
  audio: Play,
  image: ImageIcon,
  text: FileText,
  other: FileIcon,
} as const;

export interface TorrentFileListProps {
  files: BtFileMeta[];
  selected: Set<number>;
  onToggle: (index: number) => void;
  /** Preview button click on a previewable file. */
  onPreview: (file: BtFileMeta) => void;
}

/** Torrent file list: virtualized rows with selection checkboxes and preview
 * entry points for previewable files. */
const TorrentFileList = memo(function TorrentFileList({
  files,
  selected,
  onToggle,
  onPreview,
}: TorrentFileListProps) {
  const { t } = useLingui();
  const kindLabel = (kind: PreviewKind) => {
    if (kind === "video") return t`视频`;
    if (kind === "audio") return t`音频`;
    if (kind === "image") return t`图片`;
    if (kind === "text") return t`文本`;
    return t`文件`;
  };
  const viewportRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  const allSelected = useMemo(
    () => files.length > 0 && selected.size === files.length,
    [files.length, selected.size],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Checkbox
          checked={allSelected}
          onCheckedChange={() => {
            // Parent resets wholesale based on current state; -1 acts as the signal.
            onToggle(-1);
          }}
        />
        <span>
          <Trans>
            已选 {selected.size} / {files.length}
          </Trans>
        </span>
      </label>
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const file = files[row.index];
            const kind = previewKind(file.path);
            const Icon = KIND_ICONS[kind];
            const checked = selected.has(file.index);
            const canPreview = isPreviewable(kind);
            const PreviewIcon = PREVIEW_ICONS[kind];
            return (
              <div
                key={file.index}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md pr-1 text-left text-xs hover:bg-sidebar-accent",
                  checked && "bg-sidebar-accent/60",
                )}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  height: row.size,
                  width: "100%",
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2"
                  onClick={() => onToggle(file.index)}
                >
                  <Checkbox checked={checked} tabIndex={-1} className="pointer-events-none" />
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={`${file.path} · ${kindLabel(kind)}`}
                  >
                    {file.path}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatBytes(file.len)}
                  </span>
                </button>
                {canPreview ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={t`在线预览`}
                    aria-label={t`在线预览`}
                    onClick={() => onPreview(file)}
                  >
                    <PreviewIcon />
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default TorrentFileList;
