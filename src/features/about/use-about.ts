import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { translationSnapshotQuery } from "~/features/translation/queries";
import { buildInfo } from "~/lib/build-info";
import { describeError, toIpcError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";
import * as ipc from "~/lib/ipc";
import { isDesktopPlatform } from "~/lib/platform";
import { useHostsStore } from "~/store/hosts";
import type { AppDataModule, AppError, LanTransferStatus } from "~/types";

import { environmentQuery, usageQuery, versionQuery } from "./queries";
import { clearModuleQueries } from "./query-cleanup";
import { startReset } from "./reset-runtime";

/** 存储明细一行；`module` 为空表示该项只能展示，不能就地清理。 */
export interface StorageRow {
  key: string;
  label: string;
  bytes: number | null;
  module?: AppDataModule;
}

/** 一条环境信息；`wide` 表示在网格中独占整行，例如构建工具链。 */
export interface EnvironmentFieldEntry {
  label: string;
  value: string;
}

export function useAbout() {
  const { t } = useLingui();
  const usageRead = useQuery(usageQuery());
  const versionRead = useQuery(versionQuery());
  const environmentRead = useQuery(environmentQuery());
  const translationRead = useQuery({
    ...translationSnapshotQuery(),
    refetchInterval: (query) => (query.state.data?.task ? 500 : false),
  });
  const usage = usageRead.data ?? null;
  const version = versionRead.data ?? "—";
  const environment = environmentRead.data ?? null;
  const translation = translationRead.data ?? null;
  const error = usageRead.error?.payload ?? null;
  const versionError = versionRead.error?.payload ?? null;
  const [lan, setLan] = useState<LanTransferStatus | null>(null);
  const [lanError, setLanError] = useState<AppError | null>(null);
  const [lanLoading, setLanLoading] = useState(isDesktopPlatform);
  const loading = usageRead.isLoading || lanLoading;
  const [modulesOpen, setModulesOpen] = useState(false);
  const [target, setTarget] = useState<AppDataModule | "all" | null>(null);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<AppError | null>(null);
  const mounted = useRef(false),
    generation = useRef(0),
    writing = useRef(false);
  const moduleTitles: Record<AppDataModule, string> = {
    vault: t`密码本`,
    hosts: t`主机和密钥`,
    todo: t`待办`,
    poetry: t`诗词库`,
    activityLogs: t`活动日志`,
    translationModels: t`翻译模型`,
    downloads: t`下载数据`,
    cache: t`缓存与临时`,
  };
  const moduleBytes: Record<AppDataModule, number> | null = usage
    ? {
        vault: usage.vaultBytes,
        hosts: usage.hostsBytes,
        todo: usage.todoBytes,
        poetry: usage.poetryDatabaseBytes,
        activityLogs: usage.activityLogsBytes,
        translationModels: usage.translationModelBytes,
        downloads: usage.downloadBytes,
        cache: usage.cacheBytes,
      }
    : null;
  const storageRows: StorageRow[] = usage
    ? [
        { key: "main", label: t`主数据库`, bytes: usage.mainDatabaseBytes },
        {
          key: "poetry",
          label: t`诗词数据库`,
          bytes: usage.poetryDatabaseBytes,
          module: "poetry",
        },
        {
          key: "translationModels",
          label: t`翻译模型`,
          bytes: usage.translationModelBytes,
          module: "translationModels",
        },
        {
          key: "downloads",
          label: t`下载数据`,
          bytes: usage.downloadBytes,
          module: "downloads",
        },
        { key: "keys", label: t`密钥文件`, bytes: usage.keysBytes },
        {
          key: "cache",
          label: t`缓存与临时`,
          bytes: usage.cacheBytes,
          module: "cache",
        },
      ]
    : [];

  async function readLan(run: number) {
    if (!isDesktopPlatform()) return;
    try {
      const value = await ipc.lanTransferStatus();
      if (mounted.current && generation.current === run) {
        setLan(value);
        setLanError(null);
      }
    } catch (cause) {
      if (mounted.current && generation.current === run)
        setLanError(toIpcError(cause).payload);
    } finally {
      if (mounted.current && generation.current === run) setLanLoading(false);
    }
  }

  async function read() {
    await Promise.all([
      usageRead.refetch({ cancelRefetch: false }),
      versionRead.refetch({ cancelRefetch: false }),
      environmentRead.refetch({ cancelRefetch: false }),
      translationRead.refetch({ cancelRefetch: false }),
      readLan(++generation.current),
    ]);
  }

  function reload() {
    if (writing.current) return;
    return read();
  }

  useEffect(() => {
    mounted.current = true;
    void readLan(++generation.current);
    return () => {
      mounted.current = false;
    };
  }, []);

  function selectTarget(value: AppDataModule | "all" | null) {
    if (writing.current) return;
    setWriteError(null);
    setTarget(value);
  }

  async function confirm() {
    if (!target || writing.current) return;
    writing.current = true;
    generation.current++;
    setBusy(true);
    setWriteError(null);
    try {
      if (target === "all") {
        await startReset();
      } else {
        const result = await ipc.appDataClear(target);
        clearModuleQueries(target);
        if (target === "hosts") useHostsStore.getState().invalidate();
        if (!mounted.current) return;
        const title = moduleTitles[target];
        if (result.bytesFreed === null) {
          toast.success(
            t({
              comment: "模块清理成功但容量统计不可用，title 是模块名",
              message: `${title}已清理`,
            }),
            result.usageError
              ? { description: describeError(result.usageError, t) }
              : undefined,
          );
        } else {
          const freed = formatBytes(result.bytesFreed);
          toast.success(
            t({
              comment: "清理某模块成功，title 是模块名，freed 是释放的数据大小",
              message: `${title}已清理，释放 ${freed}`,
            }),
          );
        }
        setTarget(null);
        await read();
      }
    } catch (cause) {
      if (mounted.current) setWriteError(toIpcError(cause).payload);
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  /** 页面展示与复制共用同一份字段，避免两处标签或顺序走散。 */
  const environmentFields: EnvironmentFieldEntry[] = [
    { label: t`应用版本`, value: version },
    { label: t`运行模式`, value: buildInfo?.mode || "—" },
    { label: t`操作系统`, value: environment?.system ?? "—" },
    { label: t`系统架构`, value: environment?.arch ?? "—" },
    { label: t`区域`, value: environment?.locale ?? "—" },
    { label: t`构建编号`, value: buildInfo?.buildNumber || "—" },
    { label: t`构建日期`, value: buildInfo?.buildDate || "—" },
    { label: t`Git Commit`, value: buildInfo?.commit || "—" },
    { label: "Node", value: buildInfo?.node ? `v${buildInfo.node}` : "—" },
    { label: "Rust", value: buildInfo?.rustc || "—" },
    { label: t`Tauri 版本`, value: buildInfo?.tauriVersion || "—" },
  ];

  /** 反馈问题时需要把环境一次性贴进对话，字段顺序与页面一致。 */
  async function copyEnvironmentInfo() {
    if (!environment) return;
    const lines = environmentFields.map(
      (field) => `${field.label}: ${field.value}`,
    );
    try {
      await writeText(lines.join("\n"));
      toast.success(t`环境信息已复制`);
    } catch (cause) {
      toast.error(describeError(cause, t));
    }
  }

  return {
    usage,
    lan,
    error,
    lanError,
    loading,
    version,
    versionError,
    environment,
    environmentFields,
    storageRows,
    translationStatus: (() => {
      if (!translation) return null;
      if (translation.task) return t`翻译中`;
      const selected = translation.models.find(
        (model) => model.id === translation.selectedId,
      );
      return selected?.installed ? t`就绪` : t`未安装`;
    })(),
    copyEnvironmentInfo,
    modulesOpen,
    setModulesOpen,
    target,
    selectTarget,
    busy,
    writeError,
    moduleTitles,
    moduleBytes,
    reload,
    confirm,
  };
}

export type AboutController = ReturnType<typeof useAbout>;
