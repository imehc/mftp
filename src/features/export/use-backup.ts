import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import { format } from "date-fns";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { dataExport, dataImport, dataInspect } from "~/lib/ipc";
import { baseName, downloadBlob, pickFilePathNative } from "~/lib/files";
import { isDesktopPlatform } from "~/lib/platform";
import { toIpcError } from "~/lib/errors";
import { useHostsStore } from "~/store/hosts";
import type {
  AppError,
  ExportSection,
  ImportMode,
  ImportPreview,
  ImportReport,
} from "~/types";
import { exportSections } from "./sections";

interface PickedBackup {
  name: string;
  raw: string;
  preview: ImportPreview;
}
export function useBackup() {
  const { t } = useLingui();
  const available = exportSections.filter(
    (s) => s.id !== "lan" || isDesktopPlatform(),
  );
  const [tab, setTab] = useState("export");
  const [selected, setSelected] = useState<Set<ExportSection>>(
    () => new Set(available.map((s) => s.id)),
  );
  const [encrypted, setEncrypted] = useState(false);
  const [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState("");
  const [file, setFile] = useState<PickedBackup | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const [mode, setMode] = useState<ImportMode>("merge");
  const [busy, setBusy] = useState(false),
    [picking, setPicking] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const mounted = useRef(false),
    working = useRef(false),
    pickGeneration = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function changeTab(next: string) {
    if (working.current || next === tab) return;
    // 标签切换保留数据选择，只清除无需跨表单保留的明文密码。
    pickGeneration.current++;
    setPicking(false);
    setTab(next);
    setPassword("");
    setConfirmPassword("");
    setImportPassword("");
    setError(null);
  }
  function toggle(id: ExportSection) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const passwordInvalid =
    encrypted && (!password || password !== confirmPassword);
  async function exportBackup() {
    if (working.current || !selected.size || passwordInvalid) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      const sections = available
        .map((s) => s.id)
        .filter((id) => selected.has(id));
      const raw = await dataExport(sections, encrypted ? password : null);
      if (!mounted.current) return;
      const result = await downloadBlob(
        new Blob([raw], { type: "application/json" }),
        `mftp-export-${format(new Date(), "yyyyMMdd")}.json`,
      );
      if (mounted.current && result !== false) {
        setPassword("");
        setConfirmPassword("");
        toast.success(t`已导出`);
      }
    } catch (cause) {
      if (mounted.current) setError(toIpcError(cause).payload);
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function pick() {
    if (working.current) return;
    const generation = ++pickGeneration.current;
    const alive = () =>
      mounted.current && pickGeneration.current === generation;
    setPicking(true);
    setError(null);
    try {
      const path = await pickFilePathNative({
        title: t`选择备份文件`,
        filterName: "JSON",
        extensions: ["json"],
        allowMobile: true,
      });
      if (!path || !alive()) return;
      const raw = await readTextFile(path);
      if (!alive()) return;
      const preview = await dataInspect(raw);
      if (alive()) {
        setFile({ name: baseName(path), raw, preview });
        setImportPassword("");
        setReport(null);
      }
    } catch (cause) {
      if (alive()) setError(toIpcError(cause).payload);
    } finally {
      if (alive()) setPicking(false);
    }
  }
  async function importBackup() {
    if (
      working.current ||
      picking ||
      !file ||
      (file.preview.encrypted && !importPassword)
    )
      return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await dataImport(
        file.raw,
        file.preview.encrypted ? importPassword : null,
        mode,
      );
      // 写入已经成功，缓存刷新不能使用户误以为导入失败而再次执行写入。
      useHostsStore.getState().invalidate();
      if (mounted.current) {
        setReport(next);
        setImportPassword("");
        setConfirmOverwrite(false);
      }
    } catch (cause) {
      if (mounted.current) setError(toIpcError(cause).payload);
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function submitImport() {
    if (mode === "overwrite") setConfirmOverwrite(true);
    else void importBackup();
  }
  return {
    available,
    tab,
    changeTab,
    selected,
    toggle,
    encrypted,
    setEncrypted,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    passwordInvalid,
    file,
    importPassword,
    setImportPassword,
    mode,
    setMode,
    busy,
    picking,
    error,
    report,
    confirmOverwrite,
    setConfirmOverwrite,
    exportBackup,
    pick,
    importBackup,
    submitImport,
  };
}
export type BackupController = ReturnType<typeof useBackup>;
