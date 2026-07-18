import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { LanSharedDir } from "~/types";

interface Props {
  shares: LanSharedDir[];
  running: boolean;
  openShare: () => void;
  deleteShare: (id: string) => void;
}

export default function LanSharedDirsSection({
  shares,
  running,
  openShare,
  deleteShare,
}: Props) {
  const { t } = useLingui();
  const sharesCount = shares.length;
  return (
    <section className="flex flex-col rounded-lg border border-border bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2.5 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            <Trans>共享目录</Trans>
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            <Trans>{sharesCount} 个目录</Trans>
            {running ? t`，目录变更需重启服务后完整生效` : ""}
          </p>
        </div>
        <Button size="sm" onClick={openShare}>
          <Plus data-icon="inline-start" />
          <Trans>添加</Trans>
        </Button>
      </div>
      <div className="p-2">
        {shares.length === 0 ? (
          <div className="flex min-h-36 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            <Trans>暂无共享目录</Trans>
          </div>
        ) : (
          <div className="grid gap-1.5">
            {shares.map((share) => (
              <div
                key={share.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border px-2.5 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{share.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {share.path}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void deleteShare(share.id)}
                >
                  <Trash2 className="text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
