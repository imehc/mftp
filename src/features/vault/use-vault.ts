import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import { arrayMove } from "@dnd-kit/sortable";
import {
  vaultEntriesList,
  vaultEntriesReorder,
  vaultEntryCreate,
  vaultEntryDelete,
  vaultEntryUpdate,
} from "~/lib/ipc";
import { describeError, toIpcError } from "~/lib/errors";
import type { VaultEntry, VaultEntryInput, AppError } from "~/types";
import { ALL_CATEGORIES, filterVaultEntries } from "./vault-utils";

export function useVault() {
  const { t } = useLingui();
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [sorting, setSorting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VaultEntry | null>(null);
  const [deleting, setDeleting] = useState<VaultEntry | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const writing = useRef(false);
  async function read(run: number) {
    try {
      const next = await vaultEntriesList();
      if (mounted.current && generation.current === run) setEntries(next);
    } catch (cause) {
      if (mounted.current && generation.current === run)
        setError(toIpcError(cause).payload);
    } finally {
      if (mounted.current && generation.current === run) setLoading(false);
    }
  }
  function reload() {
    if (writing.current) return;
    setLoading(true);
    setError(null);
    return read(++generation.current);
  }
  useEffect(() => {
    mounted.current = true;
    void read(++generation.current);
    return () => {
      mounted.current = false;
    };
  }, []);
  const categories = [
    ...new Set(entries.map((e) => e.category).filter((x): x is string => !!x)),
  ].sort((a, b) => a.localeCompare(b));
  const filtered = filterVaultEntries(entries, search, category);
  const canSort =
    sorting && !search.trim() && category === ALL_CATEGORIES && !busy;
  // 写操作串行准入，避免重复提交或排序回滚覆盖刚刚完成的编辑。
  async function mutate(action: () => Promise<void>) {
    if (writing.current) return;
    writing.current = true;
    generation.current++;
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      if (mounted.current) toast.error(describeError(cause));
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function submit(input: VaultEntryInput) {
    await mutate(async () => {
      const entry = editing
        ? await vaultEntryUpdate(editing.id, input)
        : await vaultEntryCreate(input);
      if (!mounted.current) return;
      setEntries((previous) =>
        editing
          ? previous.map((e) => (e.id === entry.id ? entry : e))
          : [entry, ...previous],
      );
      setDialogOpen(false);
      setEditing(null);
      toast.success(t`已保存`);
    });
  }
  async function remove() {
    if (!deleting) return;
    const id = deleting.id;
    await mutate(async () => {
      await vaultEntryDelete(id);
      if (!mounted.current) return;
      setEntries((previous) => previous.filter((e) => e.id !== id));
      setDeleting(null);
      toast.success(t`已删除`);
    });
  }
  async function reorder(active: string, over: string) {
    if (!canSort) return;
    const from = entries.findIndex((e) => e.id === active),
      to = entries.findIndex((e) => e.id === over);
    if (from < 0 || to < 0 || from === to) return;
    const previous = entries,
      next = arrayMove(entries, from, to);
    await mutate(async () => {
      setEntries(next);
      try {
        const saved = await vaultEntriesReorder(next.map((e) => e.id));
        if (mounted.current) setEntries(saved);
      } catch (cause) {
        if (mounted.current) setEntries(previous);
        throw cause;
      }
    });
  }
  function edit(entry: VaultEntry | null) {
    if (!busy) {
      setEditing(entry);
      setDialogOpen(true);
    }
  }
  return {
    entries,
    filtered,
    categories,
    search,
    setSearch,
    category,
    setCategory,
    sorting,
    setSorting,
    loading,
    error,
    busy,
    canSort,
    reload,
    editing,
    edit,
    dialogOpen,
    setDialogOpen,
    deleting,
    setDeleting,
    submit,
    remove,
    reorder,
  };
}
export type VaultController = ReturnType<typeof useVault>;
