import type { ColumnDef, ColumnSizingState } from "@tanstack/react-table";
import { msg } from "@lingui/core/macro";
import { translate } from "~/i18n/translate";
import type { SftpEntry, SftpFileInfo } from "~/types";
import type { ConflictResolution } from "~/features/ssh-sftp/components/sftp/ConflictDialog";

import { formatBytes } from "~/lib/format";

// Aliased so existing callers (SftpRow) keep their import name.
export const formatSize = formatBytes;

export function nextTransferId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function formatMtime(seconds: number): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString();
}

export function formatInfoTime(seconds: number | null | undefined): string {
  if (!seconds) return translate(msg`不可用`);
  return new Date(seconds * 1000).toLocaleString();
}

export function formatInfoSize(entry: Pick<SftpEntry, "isDir" | "size">): string {
  return entry.isDir ? translate(msg`不可用`) : formatSize(entry.size);
}

export interface FileModePermissions {
  raw: string;
  owner: number;
  group: number;
  others: number;
  setUserId: boolean;
  setGroupId: boolean;
  sticky: boolean;
}

export function parseFileMode(mode: number): FileModePermissions | null {
  if (!mode) return null;
  const permissionBits = mode & 0o7777;
  return {
    raw: `0${permissionBits.toString(8).padStart(3, "0")}`,
    owner: (permissionBits >> 6) & 0o7,
    group: (permissionBits >> 3) & 0o7,
    others: permissionBits & 0o7,
    setUserId: (permissionBits & 0o4000) !== 0,
    setGroupId: (permissionBits & 0o2000) !== 0,
    sticky: (permissionBits & 0o1000) !== 0,
  };
}

export function formatOwner(info: Pick<SftpFileInfo, "uid" | "gid">): string {
  if (info.uid == null && info.gid == null) return "—";
  if (info.uid == null) return `gid ${info.gid}`;
  if (info.gid == null) return `uid ${info.uid}`;
  return `${info.uid}:${info.gid}`;
}

export function entryType(entry: SftpEntry): string {
  if (entry.isDir) return translate(msg`文件夹`);
  if (entry.isSymlink) return translate(msg`链接`);
  const dot = entry.name.lastIndexOf(".");
  if (dot <= 0 || dot === entry.name.length - 1) return translate(msg`文件`);
  return entry.name.slice(dot + 1).toLowerCase();
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

export function normalizeRemotePath(path: string): string {
  if (!path) return "/";
  const normalized = path.replace(/\/+/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

export function isSameOrChildPath(path: string, parent: string): boolean {
  const p = normalizeRemotePath(path);
  const base = normalizeRemotePath(parent);
  return p === base || (base !== "/" && p.startsWith(`${base}/`));
}

export function parentPath(p: string): string {
  if (p === "/" || p === "") return "/";
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}
export function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

const ARCHIVE_RE = /\.(zip|tar|tar\.gz|tgz|tar\.bz2|tbz2)$/i;
export function isArchive(name: string): boolean {
  return ARCHIVE_RE.test(name);
}
/** The directory name an archive is expected to produce once extracted. */
export function archiveStem(name: string): string {
  return name.replace(ARCHIVE_RE, "");
}
export function validPlainName(name: string): boolean {
  return name.trim() !== "" && !/[\\/]/.test(name.trim());
}
export function joinLocalPath(parent: string, name: string): string {
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return parent.endsWith("/") || parent.endsWith("\\")
    ? `${parent}${name}`
    : `${parent}${separator}${name}`;
}

export type PromptState =
  | { kind: "mkdir" }
  | { kind: "rename"; entry: SftpEntry }
  | { kind: "uploadDir"; localDir: string; initialName: string }
  | { kind: "downloadDir"; entry: SftpEntry; initialName: string }
  | null;

export type InfoState = {
  entry: SftpEntry;
  details: SftpFileInfo | null;
  loading: boolean;
} | null;

export type ExtractState = {
  entry: SftpEntry;
  outName: string;
  remoteParent: string;
} | null;

export type DirectoryPickerState = {
  title: string;
  initialPath: string;
  disabledPath?: string;
  onSelect: (path: string) => void;
} | null;

/** A pending action blocked on resolving a remote name conflict. */
export type ConflictState =
  | {
      name: string; // the conflicting existing name
      incomingLabel: string;
      initialIncomingName?: string;
      initialExistingName?: string;
      run: (resolution: ConflictResolution) => Promise<void>;
    }
  | null;

export type LoadingAction = "home" | "parent" | "refresh" | "list" | `enter:${string}`;
export type SortKey = "name" | "mtime" | "type" | "size";
export type SortDirection = "asc" | "desc";

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export const sftpColumns: ColumnDef<SftpEntry>[] = [
  { id: "name", size: 360, minSize: 20, maxSize: 720 },
  { id: "mtime", size: 160, minSize: 20, maxSize: 280 },
  { id: "type", size: 72, minSize: 20, maxSize: 160 },
  { id: "size", size: 80, minSize: 20, maxSize: 160 },
  { id: "actions", size: 64, minSize: 20, maxSize: 96, enableResizing: false },
];

export function sftpColumnLabel(id: string): string {
  if (id === "name") return translate(msg`名称`);
  if (id === "mtime") return translate(msg`修改日期`);
  if (id === "type") return translate(msg`类型`);
  if (id === "size") return translate(msg`大小`);
  if (id === "actions") return translate(msg`操作`);
  return id;
}

export const sftpHeaderHeight = 32;
const sftpRowPaddingX = 24;
const sftpDefaultColumnSizing: Record<string, number> = {
  name: 360,
  mtime: 160,
  type: 72,
  size: 80,
  actions: 64,
};

export function computeInitialSftpColumnSizing(width: number): ColumnSizingState {
  // ResizeObserver can report fractional CSS pixels. Keep the distribution
  // arithmetic integral so the remainder loop cannot oscillate forever around
  // zero (for example 0.33 -> -0.67 -> 0.33).
  const available = Math.max(0, Math.round(width - sftpRowPaddingX));
  if (available === 0) return sftpDefaultColumnSizing;

  const totalDefault = Object.values(sftpDefaultColumnSizing).reduce(
    (sum, value) => sum + value,
    0,
  );
  const scaled: ColumnSizingState = {};
  for (const [key, value] of Object.entries(sftpDefaultColumnSizing)) {
    scaled[key] = Math.round((value / totalDefault) * available);
  }

  const minSizes: Record<string, number> = {
    name: 20,
    mtime: 20,
    type: 20,
    size: 20,
    actions: 20,
  };
  const maxSizes: Record<string, number> = {
    name: 720,
    mtime: 280,
    type: 160,
    size: 160,
    actions: 96,
  };

  for (const key of Object.keys(scaled)) {
    scaled[key] = Math.min(maxSizes[key] ?? scaled[key], Math.max(minSizes[key] ?? 0, scaled[key]));
  }

  let diff = Math.round(
    available - Object.values(scaled).reduce((sum, value) => sum + value, 0),
  );
  const order = ["name", "mtime", "type", "size", "actions"];
  while (diff !== 0) {
    let adjusted = false;
    for (const key of order) {
      const next = (scaled[key] ?? 0) + Math.sign(diff);
      if (next < (minSizes[key] ?? 0) || next > (maxSizes[key] ?? Infinity)) continue;
      scaled[key] = next;
      diff -= Math.sign(diff);
      adjusted = true;
      if (diff === 0) break;
    }
    if (!adjusted) break;
  }

  return scaled;
}

export function sameColumnSizing(
  current: ColumnSizingState,
  next: ColumnSizingState,
): boolean {
  const keys = Object.keys(next);
  return (
    keys.length === Object.keys(current).length &&
    keys.every((key) => current[key] === next[key])
  );
}

export const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function loadingLabel(action: LoadingAction | null): string {
  if (!action) return translate(msg`加载中…`);
  if (action === "home") return translate(msg`正在打开主目录…`);
  if (action === "parent") return translate(msg`正在打开上级目录…`);
  if (action === "refresh") return translate(msg`正在刷新…`);
  if (action.startsWith("enter:")) return translate(msg`正在打开文件夹…`);
  return translate(msg`加载中…`);
}

export function defaultSortDirection(key: SortKey): SortDirection {
  return key === "mtime" || key === "size" ? "desc" : "asc";
}

export function entrySortType(entry: SftpEntry): string {
  if (entry.isDir) return "0:folder";
  if (entry.isSymlink) return "1:symlink";
  const type = entryType(entry);
  return type === translate(msg`文件`) ? "2:file" : `3:${type}`;
}

export function compareEntries(a: SftpEntry, b: SftpEntry, sort: SortState): number {
  // Keep directories grouped first for navigation, then sort inside each group.
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;

  let result = 0;
  if (sort.key === "name") {
    result = nameCollator.compare(a.name, b.name);
  } else if (sort.key === "mtime") {
    result = a.mtime - b.mtime;
  } else if (sort.key === "size") {
    result = a.size - b.size;
  } else {
    result = nameCollator.compare(entrySortType(a), entrySortType(b));
  }

  if (result === 0) {
    result = nameCollator.compare(a.name, b.name);
  }

  return sort.direction === "asc" ? result : -result;
}
