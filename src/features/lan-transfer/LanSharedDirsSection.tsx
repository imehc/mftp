import { Plural, Trans, useLingui } from "@lingui/react/macro";
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
    <section className="border-border bg-card flex flex-col rounded-lg border">
      <div className="border-border flex shrink-0 items-center justify-between gap-2 border-b px-2.5 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            <Trans>共享目录</Trans>
          </h2>
          <p className="text-muted-foreground truncate text-xs">
            {running ? (
              <Plural
                value={{
                  sharesCount,
                }}
                one="# 个目录，目录变更需重启服务后完整生效"
                other="# 个目录，目录变更需重启服务后完整生效"
              />
            ) : (
              <Plural
                value={{
                  sharesCount,
                }}
                one="# 个目录"
                other="# 个目录"
              />
            )}
          </p>
        </div>
        <Button size="sm" onClick={openShare}>
          <Plus data-icon="inline-start" />
          <Trans>添加</Trans>
        </Button>
      </div>
      <div className="p-2">
        {shares.length === 0 ? (
          <div className="border-border text-muted-foreground flex min-h-36 items-center justify-center rounded-md border border-dashed text-xs">
            <Trans>暂无共享目录</Trans>
          </div>
        ) : (
          <div className="grid gap-1.5">
            {shares.map((share) => (
              <div
                key={share.id}
                className="border-border grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2.5 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {share.name}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    {share.path}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title={t`删除共享目录`}
                  aria-label={t`删除共享目录`}
                  className="max-sm:min-h-11 max-sm:min-w-11"
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
