import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { Download, LoaderCircle, Trash2 } from "lucide-react";
import { type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";
import { TOUCH_TARGET_CLASS } from "~/lib/touch";
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
  // 行内容保持桌面比例，窄屏与粗指针由共享触控类扩大可点区域。
  const rowClass = cn(
    "flex min-h-9 items-center gap-3 rounded-lg px-2 py-1.5",
    TOUCH_TARGET_CLASS,
  );
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
    <label className={cn(rowClass, "hover:bg-accent/50 cursor-pointer")}>
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

/** 标题栏下载入口：窄屏保留图标与数量，宽屏显示文字与数量。 */
export function CollectionDownloadButton({
  count,
  disabled,
  onDownload,
}: {
  count: number;
  disabled: boolean;
  onDownload: () => void;
}) {
  const { t } = useLingui();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      aria-label={t`下载所选`}
      title={t`下载所选`}
      onClick={onDownload}
    >
      <Download data-icon="inline-start" aria-hidden />
      <span className="hidden md:inline">
        <Trans>下载所选</Trans>
      </span>
      <span className="tabular-nums" aria-hidden>
        {count}
      </span>
    </Button>
  );
}
