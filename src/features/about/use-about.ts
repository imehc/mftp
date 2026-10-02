import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import * as ipc from "~/lib/ipc";
import { toIpcError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";
import { isDesktopPlatform } from "~/lib/platform";
import { useHostsStore } from "~/store/hosts";
import type {
  AppDataModule,
  AppDataUsage,
  AppError,
  LanTransferStatus,
} from "~/types";
import { resetApplicationData } from "./reset-app-data";

export const DATA_MODULES: AppDataModule[] = [
  "vault",
  "hosts",
  "todo",
  "poetry",
  "activityLogs",
];
export function useAbout() {
  const { t } = useLingui();
  const [usage, setUsage] = useState<AppDataUsage | null>(null);
  const [lan, setLan] = useState<LanTransferStatus | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [lanError, setLanError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState("—");
  const [versionError, setVersionError] = useState<AppError | null>(null);
  const [modulesOpen, setModulesOpen] = useState(false);
  const [target, setTarget] = useState<AppDataModule | "all" | null>(null);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<AppError | null>(null);
  const [resetWarnings, setResetWarnings] = useState<AppError[] | null>(null);
  const mounted = useRef(false),
    generation = useRef(0),
    writing = useRef(false);
  const moduleTitles: Record<AppDataModule, string> = {
    vault: t`密码本`,
    hosts: t`主机和密钥`,
    todo: t`待办`,
    poetry: t`诗词库`,
    activityLogs: t`活动日志`,
  };
  const moduleBytes: Record<AppDataModule, number> | null = usage
    ? {
        vault: usage.vaultBytes,
        hosts: usage.hostsBytes,
        todo: usage.todoBytes,
        poetry: usage.poetryDatabaseBytes,
        activityLogs: usage.activityLogsBytes,
      }
    : null;
  async function read(run: number) {
    const alive = () => mounted.current && generation.current === run;
    await Promise.all([
      getVersion()
        .then((value) => {
          if (alive()) {
            setVersion(value);
            setVersionError(null);
          }
        })
        .catch((cause) => {
          if (alive()) setVersionError(toIpcError(cause).payload);
        }),
      ipc
        .appDataUsage()
        .then((value) => {
          if (alive()) {
            setUsage(value);
            setError(null);
          }
        })
        .catch((cause) => {
          if (alive()) setError(toIpcError(cause).payload);
        }),
      isDesktopPlatform()
        ? ipc
            .lanTransferStatus()
            .then((value) => {
              if (alive()) {
                setLan(value);
                setLanError(null);
              }
            })
            .catch((cause) => {
              if (alive()) setLanError(toIpcError(cause).payload);
            })
        : Promise.resolve(),
    ]);
    if (alive()) setLoading(false);
  }
  function reload() {
    if (writing.current) return;
    setLoading(true);
    return read(++generation.current);
  }
  useEffect(() => {
    mounted.current = true;
    void read(++generation.current);
    return () => {
      mounted.current = false;
    };
  }, []);
  function selectTarget(value: AppDataModule | "all" | null) {
    if (writing.current || resetWarnings) return;
    setWriteError(null);
    setTarget(value);
  }
  async function confirm() {
    if (!target || writing.current || resetWarnings) return;
    writing.current = true;
    generation.current++;
    setBusy(true);
    setLoading(false);
    setWriteError(null);
    try {
      if (target === "all") {
        const warnings = await resetApplicationData();
        if (warnings.length) {
          if (mounted.current) setResetWarnings(warnings);
        } else window.location.assign("/");
      } else {
        const result = await ipc.appDataClear(target);
        if (target === "hosts") useHostsStore.getState().invalidate();
        if (!mounted.current) return;
        const title = moduleTitles[target],
          freed = formatBytes(result.bytesFreed);
        toast.success(
          t({
            comment: "清理某模块成功，title 是模块名，freed 是释放的数据大小",
            message: `${title}已清理，释放 ${freed}`,
          }),
        );
        setTarget(null);
        await read(++generation.current);
      }
    } catch (cause) {
      if (mounted.current) setWriteError(toIpcError(cause).payload);
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
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
    modulesOpen,
    setModulesOpen,
    target,
    selectTarget,
    busy,
    writeError,
    resetWarnings,
    moduleTitles,
    moduleBytes,
    reload,
    confirm,
  };
}
export type AboutController = ReturnType<typeof useAbout>;
