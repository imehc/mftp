import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  Copy,
  Eye,
  EyeOff,
  Globe,
  Home,
  KeyRound,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
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
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import VaultEntryDialog from "~/features/vault/VaultEntryDialog";
import {
  vaultEntriesList,
  vaultEntryCreate,
  vaultEntryDelete,
  vaultEntryUpdate,
} from "~/lib/ipc";
import type { VaultEntry, VaultEntryInput } from "~/types";

const ALL_CATEGORIES = "__all__";

function formatError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export default function VaultTool() {
  const { t } = useLingui();
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VaultEntry | null>(null);
  const [deleting, setDeleting] = useState<VaultEntry | null>(null);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    vaultEntriesList()
      .then(setEntries)
      .catch((error) => toast.error(formatError(error)));
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const entry of entries) {
      if (entry.category) set.add(entry.category);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (category !== ALL_CATEGORIES && entry.category !== category) {
        return false;
      }
      if (!keyword) return true;
      return [entry.title, entry.username, entry.url, entry.notes]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(keyword));
    });
  }, [entries, search, category]);

  async function copyText(value: string, successMessage: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch (error) {
      toast.error(formatError(error));
    }
  }

  function toggleVisible(id: string) {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(input: VaultEntryInput) {
    try {
      if (editing) {
        const updated = await vaultEntryUpdate(editing.id, input);
        setEntries((prev) =>
          [updated, ...prev.filter((e) => e.id !== updated.id)],
        );
      } else {
        const created = await vaultEntryCreate(input);
        setEntries((prev) => [created, ...prev]);
      }
      setDialogOpen(false);
      setEditing(null);
      toast.success(t`已保存`);
    } catch (error) {
      toast.error(formatError(error));
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await vaultEntryDelete(deleting.id);
      setEntries((prev) => prev.filter((e) => e.id !== deleting.id));
      toast.success(t`已删除`);
    } catch (error) {
      toast.error(formatError(error));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <main className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button variant="ghost" size="xs" asChild>
            <Link to="/">
              <Home data-icon="inline-start" />
              <Trans>首页</Trans>
            </Link>
          </Button>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="hidden truncate text-xs font-medium text-muted-foreground sm:block">
            <Trans>密码本</Trans>
          </div>
        </div>
        <Badge variant="outline">
          <Trans>本地</Trans>
        </Badge>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-2 overflow-auto p-2.5 sm:p-3">
        <section className="rounded-lg border border-border bg-card p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <KeyRound className="size-4" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold">
                  <Trans>密码本</Trans>
                </h1>
                <p className="truncate text-xs text-muted-foreground">
                  <Trans>本地保存账号密码，点击即可复制</Trans>
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus data-icon="inline-start" />
              <Trans>新增</Trans>
            </Button>
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t`搜索标题、账号、网址`}
                className="h-8 pl-7"
                aria-label={t`搜索`}
              />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger
                className="h-8 w-full sm:w-40"
                aria-label={t`分类`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CATEGORIES}>
                  <Trans>全部分类</Trans>
                </SelectItem>
                {categories.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        {filtered.length === 0 ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyTitle>
                <Trans>暂无账号</Trans>
              </EmptyTitle>
              <EmptyDescription>
                {entries.length === 0 ? (
                  <Trans>点击“新增”保存第一条账号密码</Trans>
                ) : (
                  <Trans>没有匹配的结果</Trans>
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((entry) => {
              const visible = visibleIds.has(entry.id);
              return (
                <section
                  key={entry.id}
                  className="rounded-lg border border-border bg-card p-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <h2 className="truncate text-sm font-semibold">
                        {entry.title}
                      </h2>
                      {entry.category ? (
                        <Badge variant="outline">{entry.category}</Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      {entry.url ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={t`打开网址`}
                          onClick={() => {
                            void openUrl(entry.url!).catch((error) =>
                              toast.error(formatError(error)),
                            );
                          }}
                        >
                          <Globe />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t`编辑`}
                        onClick={() => {
                          setEditing(entry);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t`删除`}
                        onClick={() => setDeleting(entry)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  {entry.username || entry.password ? (
                    <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                      {entry.username ? (
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="shrink-0 text-xs text-muted-foreground">
                            <Trans>账号</Trans>
                          </span>
                          <span className="min-w-0 truncate font-mono text-xs">
                            {entry.username}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={t`复制账号`}
                            onClick={() =>
                              void copyText(entry.username!, t`已复制账号`)
                            }
                          >
                            <Copy />
                          </Button>
                        </div>
                      ) : null}
                      {entry.password ? (
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="shrink-0 text-xs text-muted-foreground">
                            <Trans>密码</Trans>
                          </span>
                          <span className="min-w-0 truncate font-mono text-xs">
                            {visible ? entry.password : "••••••••"}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={visible ? t`隐藏密码` : t`显示密码`}
                            onClick={() => toggleVisible(entry.id)}
                          >
                            {visible ? <EyeOff /> : <Eye />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={t`复制密码`}
                            onClick={() =>
                              void copyText(entry.password!, t`已复制密码`)
                            }
                          >
                            <Copy />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {entry.url || entry.notes ? (
                    <div className="mt-1 flex flex-col gap-0.5">
                      {entry.url ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {entry.url}
                        </p>
                      ) : null}
                      {entry.notes ? (
                        <p className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                          {entry.notes}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <VaultEntryDialog
        open={dialogOpen}
        entry={editing}
        categories={categories}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>删除该账号？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.title ?? ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>
              <Trans>删除</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
