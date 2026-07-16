import { useState, type ReactNode } from "react";
import { ArrowLeft, RefreshCw, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "~/components/ui/alert-dialog";
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
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to="/" aria-label="返回首页" title="返回首页">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4">
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2.5">
          {filters}
        </div>
        {children}
      </div>
    </main>
  );
}

export function LogTableViewport({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card [&_[data-slot=table-container]]:overflow-visible">
      {children}
    </div>
  );
}

export function LogDeleteButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-destructive"
        aria-label="删除日志"
        title="删除日志"
        onClick={() => setOpen(true)}
      >
        <Trash2 />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条日志？</AlertDialogTitle>
            <AlertDialogDescription>删除后无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDelete()}>删除</AlertDialogAction>
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
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
        <RefreshCw className={loading ? "animate-spin" : undefined} data-icon="inline-start" />
        刷新
      </Button>
      <Button variant="outline" size="sm" onClick={() => setClearOpen(true)}>
        <Trash2 data-icon="inline-start" />
        清空
      </Button>
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空日志</AlertDialogTitle>
            <AlertDialogDescription>所有日志记录都会被删除，且无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onClear()}>确认清空</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
