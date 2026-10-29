import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { AppError, BtFileEntry } from "~/bindings";
import { describeError, toIpcError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import { previewKind } from "~/lib/preview-kind";

import { filesQuery } from "./queries";

export function useBtFileBrowser(infoHash: string) {
  const { t } = useLingui();
  const [path, setPath] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const listing = useQuery(filesQuery(infoHash, path));
  const current = listing.data?.current;
  const [opening, setOpening] = useState(false);
  const [preview, setPreview] = useState<{
    key: string;
    url: string | null;
    error: AppError | null;
  } | null>(null);
  const filePath =
    current && !current.isDir && previewKind(current.name) !== "other"
      ? current.path
      : null;
  const key = JSON.stringify([
    infoHash,
    filePath,
    listing.dataUpdatedAt,
    revision,
  ]);
  const ready = preview?.key === key ? preview : null;

  useEffect(() => {
    if (filePath === null || listing.isFetching || listing.isError) return;
    let cancelled = false;
    // 能力 URL 只留在当前页面；旧目录、旧任务和关闭后的结果不能覆盖它。
    void ipc.btPreviewFile(infoHash, filePath).then(
      (value) => {
        if (!cancelled)
          setPreview({
            key,
            url: `${value.url}&attempt=${revision}`,
            error: null,
          });
      },
      (error) => {
        if (!cancelled)
          setPreview({ key, url: null, error: toIpcError(error).payload });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [infoHash, filePath, key, revision, listing.isFetching, listing.isError]);

  async function openExternal(entry: BtFileEntry) {
    setOpening(true);
    try {
      await ipc.btOpenFile(infoHash, entry.path);
    } catch (error) {
      toast.error(t`无法使用系统应用打开`, {
        description: describeError(error, t),
      });
    } finally {
      setOpening(false);
    }
  }

  function reload() {
    setPreview(null);
    setRevision((value) => value + 1);
    void listing.refetch({ cancelRefetch: false });
  }

  return {
    current,
    entries: listing.data?.entries ?? [],
    url: ready?.url ?? null,
    error: listing.error?.payload ?? ready?.error ?? null,
    loading:
      listing.isPending ||
      listing.isFetching ||
      (filePath !== null && !listing.isError && !ready),
    opening,
    openExternal,
    reload,
    navigate(next: string) {
      setPreview(null);
      setPath(next);
    },
    parent: (current?.path ?? path ?? "").split("/").slice(0, -1).join("/"),
  };
}
