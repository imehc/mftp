import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import {
  ArrowUp,
  Folder,
  FolderOpen,
  Home,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { FieldDescription } from "~/components/ui/field";
import { firstFormError } from "~/lib/form-errors";
import * as ipc from "~/lib/ipc";
import type { SftpEntry } from "~/types";
import {
  isSameOrChildPath,
  nameCollator,
  normalizeRemotePath,
  parentPath,
} from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";
import { cn } from "~/lib/utils";

interface RemoteDirectoryPickerProps {
  open: boolean;
  title: string;
  sessionId: string;
  initialPath: string;
  disabledPath?: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
}

export default function RemoteDirectoryPicker({
  open,
  title,
  sessionId,
  initialPath,
  disabledPath,
  onOpenChange,
  onSelect,
}: RemoteDirectoryPickerProps) {
  const [path, setPath] = useState(initialPath);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const pathForm = useForm({
    defaultValues: { path: initialPath },
    validators: {
      onSubmit: z.object({
        path: z.string().trim().min(1, "请输入路径"),
      }),
    },
    onSubmit: async ({ value }) => {
      await loadPath(value.path);
    },
  });

  const directories = useMemo(
    () =>
      entries
        .filter((entry) => entry.isDir)
        .sort((a, b) => nameCollator.compare(a.name, b.name)),
    [entries],
  );
  const cannotSelect =
    !!disabledPath && isSameOrChildPath(path, disabledPath);

  const loadPath = useCallback(
    async (nextPath: string) => {
      const normalized = normalizeRemotePath(nextPath.trim());
      setLoading(true);
      try {
        const list = await ipc.sftpList(sessionId, normalized);
        setEntries(list);
        setPath(normalized);
        pathForm.reset({ path: normalized });
      } catch (e) {
        toast.error(String(e));
      } finally {
        setLoading(false);
      }
    },
    [pathForm, sessionId],
  );

  useEffect(() => {
    if (open) void loadPath(initialPath);
  }, [open, initialPath, loadPath]);

  async function goHome() {
    setLoading(true);
    try {
      const home = await ipc.sftpHome(sessionId);
      await loadPath(home);
    } catch (e) {
      toast.error(String(e));
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogLayoutContent className="sm:max-w-xl">
        <DialogLayoutHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogLayoutHeader>

        <DialogLayoutBody className="flex flex-col gap-3 pr-1">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              title="主目录"
              onClick={goHome}
              disabled={loading}
            >
              <Home />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="上级目录"
              onClick={() => void loadPath(parentPath(path))}
              disabled={loading || path === "/"}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="刷新"
              onClick={() => void loadPath(path)}
              disabled={loading}
            >
              <RefreshCw className={cn(loading && "animate-spin")} />
            </Button>
            <form
              autoComplete="off"
              className="flex min-w-0 flex-1 items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                void pathForm.handleSubmit();
              }}
            >
              <pathForm.Field name="path">
                {(field) => {
                  const error = firstFormError(field.state.meta.errors);
                  return (
                    <div className="min-w-0 flex-1">
                      <Input
                        className="font-mono text-xs"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={!!error}
                      />
                      {error ? (
                        <FieldDescription className="text-destructive">
                          {error}
                        </FieldDescription>
                      ) : null}
                    </div>
                  );
                }}
              </pathForm.Field>
              <Button type="submit" variant="outline" disabled={loading}>
                <FolderOpen data-icon="inline-start" /> 打开
              </Button>
            </form>
          </div>
          <div className="min-h-64 rounded-md border border-border">
            {loading && directories.length === 0 ? (
              <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                加载中…
              </div>
            ) : directories.length === 0 ? (
              <Empty className="h-64">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FolderOpen />
                  </EmptyMedia>
                  <EmptyTitle>没有子文件夹</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              directories.map((entry) => {
                const disabled =
                  !!disabledPath && isSameOrChildPath(entry.path, disabledPath);
                return (
                  <button
                    key={entry.path}
                    type="button"
                    className="flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={loading || disabled}
                    onClick={() => void loadPath(entry.path)}
                  >
                    <Folder className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0 truncate">{entry.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </DialogLayoutBody>

        <DialogLayoutFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={cannotSelect} onClick={() => onSelect(path)}>
            选择当前文件夹
          </Button>
        </DialogLayoutFooter>
      </DialogLayoutContent>
    </Dialog>
  );
}
