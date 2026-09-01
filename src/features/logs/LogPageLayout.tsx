import { useState, type ReactNode, type Ref } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowLeft, RefreshCw, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
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
interface LogPageLayoutProps {
  title: string;
  description: string;
  actions?: ReactNode;
  filters: ReactNode;
  children: ReactNode;
}
export function LogPageLayout({
  title,
  description,
  actions,
  filters,
  children,
}: LogPageLayoutProps) {
  const { t } = useLingui();
  return (
    <main className="bg-background text-foreground flex h-full flex-col overflow-hidden">
      <header className="border-border flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to="/" aria-label={t`返回首页`} title={t`返回首页`}>
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            <p className="text-muted-foreground truncate text-xs">
              {description}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4">
        <div className="border-border bg-card flex shrink-0 flex-wrap items-center gap-2 rounded-lg border p-2.5">
          {filters}
        </div>
        {children}
      </div>
    </main>
  );
}
export function LogTableViewport({
  children,
  viewportRef,
}: {
  children: ReactNode;
  viewportRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={viewportRef}
      className="border-border bg-card min-h-0 flex-1 overflow-auto rounded-lg border [&_[data-slot=table-container]]:overflow-visible"
    >
      {children}
    </div>
  );
}
export function LogDeleteButton({
  onDelete,
}: {
  onDelete: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-destructive"
        aria-label={t`删除日志`}
        title={t`删除日志`}
        onClick={() => setOpen(true)}
      >
        <Trash2 />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>删除这条日志？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>删除后无法恢复。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDelete()}>
              <Trans>删除</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
export function LogPageActions({
  loading,
  onRefresh,
  onClear,
}: {
  loading: boolean;
  onRefresh: () => void;
  onClear: () => Promise<void>;
}) {
  const [clearOpen, setClearOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={loading}
      >
        <RefreshCw
          className={loading ? "animate-spin" : undefined}
          data-icon="inline-start"
        />
        <Trans>刷新</Trans>
      </Button>
      <Button variant="outline" size="sm" onClick={() => setClearOpen(true)}>
        <Trash2 data-icon="inline-start" />
        <Trans>清空</Trans>
      </Button>
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>清空日志</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>所有日志记录都会被删除，且无法恢复。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void onClear()}>
              <Trans>确认清空</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
