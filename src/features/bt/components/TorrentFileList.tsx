import { Trans, useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "cn";
import {
  File as FileIcon,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
} from "lucide-react";
import { useRef } from "react";

import { Checkbox } from "~/components/ui/checkbox";
import { formatBytes } from "~/lib/format";
import { type PreviewKind, previewKind } from "~/lib/preview-kind";
import type { BtFileMeta } from "~/types";

const KIND_ICONS = {
  video: Film,
  audio: Music,
  image: ImageIcon,
  text: FileText,
  other: FileIcon,
} as const;

/** 预览入口：时序媒体直接播放，其余用查看器。 */
export interface TorrentFileListProps {
  files: BtFileMeta[];
  selected: Set<number>;
  onToggle: (index: number) => void;
  readOnly?: boolean;
}

/** 种子文件列表：虚拟化的行，带选择复选框与可预览
 * 文件的预览入口。 */
const TorrentFileList = function TorrentFileList({
  files,
  selected,
  onToggle,
  readOnly = false,
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
  const allSelected = files.length > 0 && selected.size === files.length;
  const selectedSize = selected.size;
  const filesLength = files.length;
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <label className="text-muted-foreground flex items-center gap-2 px-1 text-xs">
        <Checkbox
          checked={allSelected}
          disabled={readOnly}
          onCheckedChange={() => {
            // 父组件依据当前状态整体重置；-1 作为触发信号。
            onToggle(-1);
          }}
        />
        <span>
          <Trans>
            已选 {selectedSize} / {filesLength}
          </Trans>
        </span>
      </label>
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const file = files[row.index];
            const kind = previewKind(file.path);
            const Icon = KIND_ICONS[kind];
            const checked = selected.has(file.index);
            return (
              <div
                key={file.index}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className={cn(
                  "hover:bg-sidebar-accent flex min-h-[max(44px,2.75rem)] w-full items-center gap-2 rounded-md pr-1 text-left text-xs",
                  checked && "bg-sidebar-accent/60",
                )}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <label className="flex min-h-[max(44px,2.75rem)] min-w-0 flex-1 items-center gap-2 py-2 pl-2">
                  <Checkbox
                    checked={checked}
                    disabled={readOnly}
                    onCheckedChange={() => onToggle(file.index)}
                  />
                  <Icon className="text-muted-foreground size-3.5 shrink-0" />
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={`${file.path} · ${kindLabel(kind)}`}
                  >
                    {file.path}
                  </span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {formatBytes(file.len)}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TorrentFileList;
