import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { TOUCH_TARGET_CLASS } from "~/lib/touch";
import type { LanSharedDir } from "~/types";

import LanConfirmDialog from "./LanConfirmDialog";

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
  const [pending, setPending] = useState<LanSharedDir | null>(null);
  const sharesCount = shares.length;
  const pendingName = pending?.name ?? "";
  const pendingPath = pending?.path ?? "";
  return (
    <>
      <section className="border-border bg-card flex flex-col rounded-xl border">
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
                  one="# 个目录，需重启服务生效"
                  other="# 个目录，需重启服务生效"
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
            <Empty className="min-h-36 gap-0 border border-dashed p-3">
              <EmptyHeader>
                <EmptyTitle className="text-muted-foreground text-xs font-normal">
                  <Trans>暂无共享目录</Trans>
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
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
                    className={TOUCH_TARGET_CLASS}
                    onClick={() => setPending(share)}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      <LanConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={t`删除共享目录`}
        description={
          <>
            {t`确定删除共享目录“${pendingName}”？`}
            <span className="mt-2 block font-mono text-xs break-all">
              {pendingPath}
            </span>
            {running ? (
              <span className="mt-2 block">
                <Trans comment="服务运行时删除共享目录的生效条件">
                  需重启服务生效。
                </Trans>
              </span>
            ) : null}
          </>
        }
        confirmLabel={t`删除`}
        onConfirm={() => {
          if (pending) void deleteShare(pending.id);
        }}
      />
    </>
  );
}
