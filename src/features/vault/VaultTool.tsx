import { Trans, useLingui } from "@lingui/react/macro";
import { ListFilter, Plus, Search } from "lucide-react";

import AppPageLayout from "~/components/AppPageLayout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "~/components/ui/input-group";
import { describeError } from "~/lib/errors";

import { useVault } from "./use-vault";
import { ALL_CATEGORIES } from "./vault-utils";
import VaultEntryDialog from "./VaultEntryDialog";
import VaultEntryList from "./VaultEntryList";

export default function VaultTool() {
  const { t } = useLingui();
  const c = useVault();
  return (
    <AppPageLayout
      title={<Trans>密码本</Trans>}
      adaptiveDensity
      scroll="content"
      bottomInset="scroll"
      contentClassName="gap-3"
      actions={
        c.sorting ? (
          <Button
            variant="ghost"
            size="sm"
            density="adaptive"
            disabled={c.busy}
            onClick={() => c.setSorting(false)}
          >
            <Trans>完成</Trans>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            aria-label={t`新建账号`}
            disabled={c.busy || c.loading || !!c.error}
            onClick={() => c.edit(null)}
          >
            <Plus />
          </Button>
        )
      }
    >
      <div className="flex shrink-0 items-center gap-2">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={c.search}
            onChange={(e) => {
              c.setSearch(e.target.value);
              c.setSorting(false);
            }}
            placeholder={t`搜索标题、账号、网址`}
            aria-label={t`搜索`}
          />
        </InputGroup>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={c.category === ALL_CATEGORIES ? "ghost" : "secondary"}
              size="icon-sm"
              density="adaptive"
              aria-label={t`筛选和排序`}
            >
              <ListFilter />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="ui-density-adaptive">
            <DropdownMenuRadioGroup
              value={c.category}
              onValueChange={(v) => {
                c.setCategory(v);
                c.setSorting(false);
              }}
            >
              <DropdownMenuRadioItem value={ALL_CATEGORIES}>
                <Trans>全部分类</Trans>
              </DropdownMenuRadioItem>
              {c.categories.map((x) => (
                <DropdownMenuRadioItem key={x} value={x}>
                  {x}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={c.busy || c.loading || c.entries.length < 2}
                onSelect={() => {
                  c.setSearch("");
                  c.setCategory(ALL_CATEGORIES);
                  c.setSorting(true);
                }}
              >
                <Trans>调整顺序</Trans>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {c.error ? (
        <div
          role="status"
          className="border-destructive/30 text-destructive flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
        >
          <span>{describeError(c.error)}</span>
          <Button
            variant="outline"
            density="adaptive"
            onClick={() => void c.reload()}
            disabled={c.loading}
          >
            <Trans>重试</Trans>
          </Button>
        </div>
      ) : null}
      {c.loading && c.entries.length === 0 ? (
        <p role="status" className="text-muted-foreground p-3 text-sm">
          <Trans>正在加载账号…</Trans>
        </p>
      ) : c.error && c.entries.length === 0 ? null : c.filtered.length ? (
        <VaultEntryList controller={c} />
      ) : (
        <Empty className="app-scroll-safe-end flex-1">
          <EmptyHeader>
            <EmptyTitle>
              {c.entries.length ? (
                <Trans>无匹配结果</Trans>
              ) : (
                <Trans>暂无账号</Trans>
              )}
            </EmptyTitle>
            <EmptyDescription>
              {c.entries.length ? (
                <Trans>调整搜索内容或分类后重试</Trans>
              ) : (
                <Trans>点击“新建”保存第一条账号密码</Trans>
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <VaultEntryDialog
        open={c.dialogOpen}
        entry={c.editing}
        categories={c.categories}
        busy={c.busy}
        onOpenChange={(open) => {
          if (!c.busy) c.setDialogOpen(open);
        }}
        onSubmit={c.submit}
      />
      <AlertDialog
        open={!!c.deleting}
        onOpenChange={(open) => {
          if (!open && !c.busy) c.setDeleting(null);
        }}
      >
        <AlertDialogContent className="ui-density-adaptive">
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>删除该账号？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>{c.deleting?.title}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={c.busy}>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={c.busy}
              onClick={(event) => {
                event.preventDefault();
                void c.remove();
              }}
            >
              <Trans>删除</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppPageLayout>
  );
}
