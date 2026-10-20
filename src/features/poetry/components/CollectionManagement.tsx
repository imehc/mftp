import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { CircleAlert, Download, LoaderCircle, Trash2, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { describeError, hasCustomCode } from "~/lib/errors";
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
    <section className="bg-card flex flex-col gap-2 rounded-xl border p-3">
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
            <p className="text-muted-foreground text-xs wrap-break-word">
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

/**
 * 页面底栏合并了下载入口与同步状态：同步时同一行显示进度和取消，
 * 行高按 SSH/SFTP 的传输条收窄，合集列表再长也不用来回滚动查看进度。
 */
export function CollectionFooter({ controller }: { controller: Controller }) {
  const { t } = useLingui();
  const { progress, starting, collections, cancelSync } = controller;
  // 失败只提示一次：关闭后等下一条进度事件再重新出现。进入页面时已经存在的
  // 终态属于上一次任务，默认视为已读，否则页面一挂载就会重现旧的失败提示。
  const [dismissedAt, setDismissedAt] = useState(() =>
    progress.phase === "error" ? progress.updatedAt : 0,
  );
  // 主动取消不算失败：不占底栏、不显示红色告警。
  const cancelled = hasCustomCode(progress.error, "poetry:sync_cancelled");
  const failed =
    progress.phase === "error" && !progress.active && !starting && !cancelled;
  const showSync =
    progress.active ||
    starting ||
    (failed && dismissedAt !== progress.updatedAt);
  const label = progress.stale
    ? t`等待确认`
    : starting
      ? t`正在启动`
      : failed
        ? t`同步失败`
        : progress.phase === "verifying"
          ? t`正在校验`
          : progress.phase === "importing" || progress.phase === "indexing"
            ? t`正在导入`
            : progress.phase === "downloading"
              ? t`正在下载`
              : t`正在同步`;
  const importing =
    progress.phase === "importing" || progress.phase === "indexing";
  const total = importing ? progress.total : progress.bytesTotal;
  const done = importing ? progress.imported : progress.bytesDone;
  const percent =
    total && total > 0
      ? Math.min(100, Math.max(0, (done / total) * 100))
      : undefined;
  const doneLabel = importing ? done.toLocaleString() : formatBytes(done);
  const totalLabel = total
    ? importing
      ? total.toLocaleString()
      : formatBytes(total)
    : null;
  const name = collections.find(
    (item) => item.id === progress.collectionId,
  )?.name;
  const errorText = progress.error ? describeError(progress.error, t) : null;
  const count = controller.selectedPendingIds.length;
  return (
    <footer className="bg-background shrink-0 border-t pb-(--safe-bottom)">
      <div className="app-page-width app-bottom-bar relative mx-auto flex w-full flex-wrap items-center gap-x-2 gap-y-1">
        {/* 进度条贴住底栏上沿，不额外占高度，滚动时也能看出前进。 */}
        {showSync && percent !== undefined && !failed ? (
          <div
            aria-hidden
            className="bg-muted absolute inset-x-0 top-0 h-0.5 overflow-hidden"
          >
            <div
              className="bg-primary h-full transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : null}
        {showSync ? (
          <>
            {failed ? (
              <CircleAlert
                className="text-destructive size-3.5 shrink-0"
                aria-hidden
              />
            ) : (
              <LoaderCircle
                className="text-muted-foreground size-3.5 shrink-0 animate-spin"
                aria-hidden
              />
            )}
            <span role="status" className="shrink-0 text-sm font-medium">
              {label}
            </span>
            {name ? (
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                {name}
              </span>
            ) : null}
            {failed && errorText ? (
              <span
                role="alert"
                title={errorText}
                className="text-destructive min-w-0 flex-1 truncate text-xs"
              >
                {errorText}
              </span>
            ) : (
              <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                {doneLabel}
                {totalLabel ? ` / ${totalLabel}` : ""}
              </span>
            )}
            {progress.active ? (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => void cancelSync()}
              >
                <Trans>取消同步</Trans>
              </Button>
            ) : failed ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                aria-label={t`关闭`}
                title={t`关闭`}
                onClick={() => setDismissedAt(progress.updatedAt)}
              >
                <X />
              </Button>
            ) : null}
          </>
        ) : (
          <>
            {count > 0 ? (
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                <Plural
                  value={count}
                  one="已选择 # 个合集"
                  other="已选择 # 个合集"
                />
              </span>
            ) : null}
            <Button
              variant="outline"
              size="icon-sm"
              className="ml-auto shrink-0"
              disabled={
                controller.busy ||
                controller.loading ||
                !!controller.error ||
                count === 0
              }
              aria-label={t`下载所选`}
              title={t`下载所选`}
              onClick={() => void controller.startSync()}
            >
              <Download />
            </Button>
          </>
        )}
      </div>
    </footer>
  );
}
