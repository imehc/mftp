import type { ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  downloadBlob,
  formatBytes,
  sizeDeltaPercent,
} from "~/features/media-compress/format";
interface CompressResultCardProps {
  fileName: string;
  size: number;
  originalSize: number;
  blob: Blob;
  preview?: ReactNode;
  onSizeChange?: (actualSize: number) => void;
  /** 卡片标题；默认使用本地化的“压缩结果”标签。 */
  title?: ReactNode;
  /** 在体积徽标前渲染的额外徽标。 */
  extraBadges?: ReactNode;
}
export function CompressResultCard({
  fileName,
  size,
  originalSize,
  blob,
  preview,
  onSizeChange,
  title,
  extraBadges,
}: CompressResultCardProps) {
  const { t } = useLingui();
  const delta = sizeDeltaPercent(originalSize, size);
  async function onDownload() {
    try {
      const saved = await downloadBlob(blob, fileName);
      if (saved !== false) {
        toast.success(t`已保存`);
        if (saved !== size) onSizeChange?.(saved);
      }
    } catch (error) {
      toast.error(String(error));
    }
  }
  return (
    <section className="border-border bg-card flex flex-col rounded-lg border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-muted-foreground min-w-0 text-xs font-medium">
          <h2 className="truncate">{title ?? <Trans>压缩结果</Trans>}</h2>
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap">
          {extraBadges}
          <Badge variant="outline" className="shrink-0">
            {formatBytes(size)}
          </Badge>
          {delta != null && delta >= 0 ? (
            <Badge variant="secondary" className="shrink-0">
              {t`减小 ${delta}%`}
            </Badge>
          ) : null}
          <Button
            size="sm"
            title={fileName}
            className="shrink-0"
            onClick={() => void onDownload()}
          >
            <Download data-icon="inline-start" />
            <Trans>下载</Trans>
          </Button>
        </div>
      </div>
      {preview ? <div className="mt-auto">{preview}</div> : null}
    </section>
  );
}
