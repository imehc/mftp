import type { ReactNode } from "react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Download, LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";
import type { PoetryCollectionStatus } from "~/types";
import type { usePoetryCollectionsManage } from "../hooks/use-poetry-collections-manage";

type Controller = ReturnType<typeof usePoetryCollectionsManage>;

export function CollectionSection({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-card flex flex-col gap-2 rounded-xl border p-3 md:p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function CollectionRow({
  item,
  controller,
}: {
  item: PoetryCollectionStatus;
  controller: Controller;
}) {
  const { t } = useLingui();
  const name = item.name;
  const count = item.poemCount;
  const tier =
    item.tier === "recommended"
      ? t`推荐`
      : item.tier === "default"
        ? t`默认`
        : t`可选`;
  const contents = (
    <>
      <span className="min-w-0 flex-1 md:flex md:items-baseline md:justify-between md:gap-3">
        <span className="block truncate text-sm">{name}</span>
        <span className="text-muted-foreground block text-xs">
          {item.installed ? (
            <Plural value={count} one="# 篇" other="# 篇" />
          ) : (
            [item.dynasty, tier].filter(Boolean).join(" · ")
          )}
          {item.installed
            ? ` · ${formatBytes(Math.max(0, item.bytesUsed))}`
            : null}
        </span>
      </span>
    </>
  );
  const rowClass =
    "flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 md:min-h-9";
  return item.installed ? (
    <div className={rowClass}>
      {contents}
      <Button
        variant="ghost"
        size="icon-sm"
        density="adaptive"
        disabled={controller.busy}
        aria-label={t`卸载 ${name}`}
        onClick={() => controller.setPendingDelete(item)}
      >
        <Trash2 />
      </Button>
    </div>
  ) : (
    <label className={`${rowClass} hover:bg-accent/50 cursor-pointer`}>
      <Checkbox
        checked={controller.selected.has(item.id)}
        disabled={controller.busy || controller.loading || !!controller.error}
        onCheckedChange={() => controller.toggle(item.id)}
        aria-label={name}
      />
      {contents}
    </label>
  );
}

export function CollectionGroups({ controller }: { controller: Controller }) {
  const { error, loading, pending, installed, refresh } = controller;
  return (
    <>
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"
        >
          <div className="min-w-0 text-sm">
            <p>
              <Trans>读取失败</Trans>
            </p>
            <p className="text-muted-foreground text-xs break-words">
              {describeError(error)}
            </p>
          </div>
          <Button
            variant="outline"
            density="adaptive"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <Trans comment="重新读取诗词合集列表">重试</Trans>
          </Button>
        </div>
      ) : null}
      {loading ? (
        <p
          role="status"
          className="text-muted-foreground flex items-center gap-2 text-sm"
        >
          <LoaderCircle className="size-4 animate-spin" />
          <Trans>加载中…</Trans>
        </p>
      ) : null}
      <CollectionSection title={<Trans>可下载合集</Trans>}>
        {pending.map((item) => (
          <CollectionRow key={item.id} item={item} controller={controller} />
        ))}
        {!loading && !error && pending.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            <Trans>全部合集均已安装。</Trans>
          </p>
        ) : null}
      </CollectionSection>
      <CollectionSync controller={controller} />
      <CollectionSection title={<Trans>已安装</Trans>}>
        {installed.map((item) => (
          <CollectionRow key={item.id} item={item} controller={controller} />
        ))}
        {!loading && !error && installed.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            <Trans>尚未安装合集</Trans>
          </p>
        ) : null}
      </CollectionSection>
    </>
  );
}

function CollectionSync({ controller }: { controller: Controller }) {
  const { t } = useLingui();
  const { progress, starting, collections, cancelSync } = controller;
  if (!progress.active && !starting && progress.phase !== "error") return null;
  const label = progress.stale
    ? t`等待确认`
    : starting
      ? t`正在启动`
      : progress.phase === "verifying"
        ? t`正在校验`
        : progress.phase === "importing" || progress.phase === "indexing"
          ? t`正在导入`
          : t`正在下载`;
  const importing =
    progress.phase === "importing" || progress.phase === "indexing";
  const total = importing ? progress.total : progress.bytesTotal;
  const done = importing ? progress.imported : progress.bytesDone;
  const percent =
    total && total > 0
      ? Math.min(100, Math.max(0, (done / total) * 100))
      : undefined;
  return (
    <CollectionSection title={<Trans>正在同步</Trans>}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="truncate">
            {
              collections.find((item) => item.id === progress.collectionId)
                ?.name
            }
          </p>
          <p role="status" className="text-muted-foreground text-xs">
            {progress.phase === "error" ? t`同步失败` : label}
          </p>
        </div>
        {progress.active ? (
          <Button
            variant="outline"
            density="adaptive"
            onClick={() => void cancelSync()}
          >
            <Trans>取消同步</Trans>
          </Button>
        ) : null}
      </div>
      {progress.error ? (
        <p role="alert" className="text-destructive text-xs break-words">
          {describeError(progress.error)}
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-xs tabular-nums">
            {importing ? done.toLocaleString() : formatBytes(done)}
            {total
              ? ` / ${importing ? total.toLocaleString() : formatBytes(total)}`
              : ""}
          </p>
          <div
            role="progressbar"
            aria-label={t`同步进度`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="bg-muted h-1.5 overflow-hidden rounded-full"
          >
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: percent === undefined ? "0%" : `${percent}%` }}
            />
          </div>
        </>
      )}
    </CollectionSection>
  );
}

export function CollectionDownloadFooter({
  controller,
}: {
  controller: Controller;
}) {
  const count = controller.selectedPendingIds.length;
  return (
    <footer className="bg-background shrink-0 border-t px-3 pt-2 pb-[calc(0.5rem+var(--safe-bottom,0px))] md:px-5">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs">
          <Plural value={count} one="已选择 # 个合集" other="已选择 # 个合集" />
        </span>
        <Button
          disabled={
            controller.busy ||
            controller.loading ||
            !!controller.error ||
            count === 0
          }
          onClick={() => void controller.startSync()}
        >
          {controller.starting ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <Download data-icon="inline-start" />
          )}
          <Trans>下载所选</Trans>
        </Button>
      </div>
    </footer>
  );
}
