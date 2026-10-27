import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type {
  AppError,
  PoetryPackTranslation,
  PoetryTranslation,
} from "~/bindings";
import { hasAiRequestSelection } from "~/features/ai-configuration/request-readiness";
import { describeError, toIpcError } from "~/lib/errors";
import {
  aiConfigurationGet,
  poetryPackTranslationsList,
  poetryTranslationDelete,
  poetryTranslationGenerate,
  poetryTranslationsList,
  poetryTranslationUpdate,
} from "~/lib/ipc";

import {
  selectPoetryPackTranslations,
  selectPoetryTranslation,
} from "../translation-selection";

/** 阅读内容切换只改变可见性，本 controller 在同一作品内持续持有请求和草稿。 */
export function usePoetryTranslations(uid: string) {
  const { t } = useLingui();
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
  const [editing, setEditing] = useState<PoetryTranslation | null>(null);
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [configurationMissing, setConfigurationMissing] = useState(false);
  const mountedRef = useRef(true);
  // 离开页面只解除流式订阅；用户显式取消才打断后端请求。
  const detachGenerationRef = useRef<(() => void) | null>(null);
  const cancelGenerationRef = useRef<(() => Promise<void>) | null>(null);
  // 取消与「完成」可能同时发生：先点取消的一方决定结果不被采用。
  const cancelRequestedRef = useRef(false);
  const current = selectPoetryTranslation(translations);
  const currentPackTranslations =
    selectPoetryPackTranslations(packTranslations);
  const replacesManualTranslation = translations.some(
    (item) => item.mode === "literal" && item.source === "user",
  );

  /** 失败统一走 toast：页面里不再常驻错误条，避免把后端原文堆在正文中。 */
  function reportError(payload: AppError) {
    toast.error(t`操作失败`, { description: describeError(payload, t) });
  }

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
    cancelRequestedRef.current = false;
    setGenerating(true);
    setStreamingContent("");
    setConfigurationMissing(false);
    try {
      const configuration = await aiConfigurationGet();
      if (!mountedRef.current || cancelRequestedRef.current) return;
      if (!hasAiRequestSelection(configuration)) {
        setConfigurationMissing(true);
        return;
      }
      const generation = poetryTranslationGenerate(uid, "literal", (delta) =>
        setStreamingContent((content) => content + delta),
      );
      detachGenerationRef.current = generation.detach;
      cancelGenerationRef.current = generation.cancel;
      const translation = await generation.promise;
      // 已离开页面或已解除订阅时不采用结果。
      if (!mountedRef.current || !translation || cancelRequestedRef.current) {
        return;
      }
      replaceTranslation(translation);
      toast.success(t`已生成`);
    } catch (nextError) {
      const payload = toIpcError(nextError).payload;
      // 用户主动取消：不是失败，不弹错误，也不写库。
      if (payload.code === "ai:cancelled") {
        if (mountedRef.current) toast(t`已取消生成`);
      } else if (mountedRef.current) {
        reportError(payload);
      }
    } finally {
      actionPending.current = false;
      cancelGenerationRef.current = null;
      if (mountedRef.current) {
        setStreamingContent("");
        setGenerating(false);
      }
      detachGenerationRef.current = null;
    }
  }

  /** 用户点「取消生成」：中断后端请求，留下原有译文。 */
  function cancelGeneration() {
    // 配置查询尚未结束时也接受取消，避免取消后才真正发送生成请求。
    cancelRequestedRef.current = true;
    const cancel = cancelGenerationRef.current;
    if (!cancel) return;
    cancelGenerationRef.current = null;
    void cancel().catch(() => {
      // 请求已经结束（取消只是迟到），无需额外提示。
    });
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
      if (mountedRef.current) reportError(toIpcError(nextError).payload);
    } finally {
      actionPending.current = false;
      if (mountedRef.current) setSavingEdit(false);
    }
  }

  async function remove() {
    if (!current || actionPending.current) return;
    actionPending.current = true;
    setDeleting(true);
    try {
      await poetryTranslationDelete(uid, current.mode);
      if (!mountedRef.current) return;
      setTranslations((items) =>
        items.filter((item) => item.mode !== current.mode),
      );
      toast.success(t`已删除`);
    } catch (nextError) {
      if (mountedRef.current) reportError(toIpcError(nextError).payload);
    } finally {
      actionPending.current = false;
      if (mountedRef.current) setDeleting(false);
    }
  }

  function requestGeneration() {
    if (current?.source === "user" || replacesManualTranslation)
      setRegenerateOpen(true);
    else void generate();
  }

  return {
    current,
    currentPackTranslations,
    loading,
    readError,
    retryRead: () => setReadRevision((value) => value + 1),
    generating,
    streamingContent,
    deleting,
    editing,
    setEditing,
    editContent,
    setEditContent,
    savingEdit,
    deleteOpen,
    setDeleteOpen,
    regenerateOpen,
    setRegenerateOpen,
    replacesManualTranslation,
    configurationMissing,
    setConfigurationMissing,
    generate,
    cancelGeneration,
    startEdit,
    saveEdit,
    remove,
    requestGeneration,
  };
}
