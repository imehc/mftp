import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import { toIpcError } from "~/lib/errors";
import { hasAiRequestSelection } from "~/features/ai-configuration/request-readiness";
import {
  poetryPackTranslationsList,
  aiConfigurationGet,
  poetryTranslationDelete,
  poetryTranslationGenerate,
  poetryTranslationsList,
  poetryTranslationUpdate,
} from "~/lib/ipc";
import type {
  AppError,
  PoetryPackTranslation,
  PoetryTranslation,
  PoetryTranslationMode,
} from "~/bindings";

/** 阅读内容切换只改变可见性，本 controller 在同一作品内持续持有请求和草稿。 */
export function usePoetryTranslations(
  uid: string,
  initialMode: PoetryTranslationMode = "literal",
) {
  const { t } = useLingui();
  const [mode, setMode] = useState<PoetryTranslationMode>(initialMode);
  const [translations, setTranslations] = useState<PoetryTranslation[]>([]);
  const [packTranslations, setPackTranslations] = useState<
    PoetryPackTranslation[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<AppError | null>(null);
  const [readRevision, setReadRevision] = useState(0);
  const actionPending = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [editing, setEditing] = useState<PoetryTranslation | null>(null);
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [configurationMissing, setConfigurationMissing] = useState(false);
  const mountedRef = useRef(true);
  // 只解除流式订阅；后端请求（若已开始）不由前端取消。
  const detachGenerationRef = useRef<(() => void) | null>(null);
  const current = translations.find((item) => item.mode === mode) ?? null;
  const currentPackTranslations = packTranslations.filter(
    (item) => item.mode === mode,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      detachGenerationRef.current?.();
      detachGenerationRef.current = null;
    };
  }, [uid]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setReadError(null);
      }
    });
    void Promise.all([
      poetryTranslationsList(uid),
      poetryPackTranslationsList(uid),
    ])
      .then(([items, packItems]) => {
        if (!cancelled) {
          setTranslations(items);
          setPackTranslations(packItems);
        }
      })
      .catch(
        (nextError) =>
          !cancelled && setReadError(toIpcError(nextError).payload),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [uid, readRevision]);

  function replaceTranslation(next: PoetryTranslation) {
    setTranslations((items) => [
      ...items.filter((item) => item.mode !== next.mode),
      next,
    ]);
  }

  async function generate() {
    if (actionPending.current || loading || readError) return;
    actionPending.current = true;
    setGenerating(true);
    setStreamingContent("");
    setError(null);
    setConfigurationMissing(false);
    try {
      const configuration = await aiConfigurationGet();
      if (!mountedRef.current) return;
      if (!hasAiRequestSelection(configuration)) {
        setConfigurationMissing(true);
        return;
      }
      const generation = poetryTranslationGenerate(uid, mode, (delta) =>
        setStreamingContent((content) => content + delta),
      );
      detachGenerationRef.current = generation.detach;
      const translation = await generation.promise;
      // 已离开页面或已解除订阅时不采用结果。
      if (!mountedRef.current || !translation) return;
      replaceTranslation(translation);
      toast.success(t`已生成`);
    } catch (nextError) {
      if (mountedRef.current) setError(toIpcError(nextError).payload);
    } finally {
      actionPending.current = false;
      if (mountedRef.current) {
        setStreamingContent("");
        setGenerating(false);
      }
      detachGenerationRef.current = null;
    }
  }

  function startEdit() {
    if (!current) return;
    setEditing(current);
    setEditContent(current.content);
  }

  async function saveEdit() {
    if (!editing || !editContent.trim() || actionPending.current) return;
    actionPending.current = true;
    setSavingEdit(true);
    setError(null);
    try {
      const translation = await poetryTranslationUpdate(
        uid,
        editing.mode,
        editContent,
      );
      if (!mountedRef.current) return;
      replaceTranslation(translation);
      setEditing(null);
      toast.success(t`已保存`);
    } catch (nextError) {
      if (mountedRef.current) setError(toIpcError(nextError).payload);
    } finally {
      actionPending.current = false;
      if (mountedRef.current) setSavingEdit(false);
    }
  }

  async function remove() {
    if (!current || actionPending.current) return;
    actionPending.current = true;
    setDeleting(true);
    setError(null);
    try {
      await poetryTranslationDelete(uid, current.mode);
      if (!mountedRef.current) return;
      setTranslations((items) =>
        items.filter((item) => item.mode !== current.mode),
      );
      toast.success(t`已删除`);
    } catch (nextError) {
      if (mountedRef.current) setError(toIpcError(nextError).payload);
    } finally {
      actionPending.current = false;
      if (mountedRef.current) setDeleting(false);
    }
  }

  function requestGeneration() {
    if (current?.source === "user") setRegenerateOpen(true);
    else void generate();
  }

  return {
    mode,
    setMode,
    current,
    currentPackTranslations,
    loading,
    readError,
    retryRead: () => setReadRevision((value) => value + 1),
    generating,
    streamingContent,
    deleting,
    error,
    setError,
    editing,
    setEditing,
    editContent,
    setEditContent,
    savingEdit,
    deleteOpen,
    setDeleteOpen,
    regenerateOpen,
    setRegenerateOpen,
    configurationMissing,
    setConfigurationMissing,
    generate,
    startEdit,
    saveEdit,
    remove,
    requestGeneration,
  };
}
