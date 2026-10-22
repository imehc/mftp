import { create } from "zustand";

import { toIpcError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import type { AppError, RsyncCapabilities } from "~/types";

export interface RsyncCapabilityEntry {
  capabilities: RsyncCapabilities | null;
  loading: boolean;
  error: AppError | null;
}

interface RsyncCapabilityState {
  entries: Record<string, RsyncCapabilityEntry>;
}

const EMPTY_ENTRY: RsyncCapabilityEntry = {
  capabilities: null,
  loading: false,
  error: null,
};

export const useRsyncCapabilityStore = create<RsyncCapabilityState>(() => ({
  entries: {},
}));

// 代数用于丢弃已关闭会话或已被刷新请求取代的迟到结果。
const generations = new Map<string, number>();
const inflight = new Map<string, Promise<RsyncCapabilities | null>>();

function patchEntry(
  sessionId: string,
  patch: Partial<RsyncCapabilityEntry>,
): void {
  useRsyncCapabilityStore.setState((state) => ({
    entries: {
      ...state.entries,
      [sessionId]: {
        ...(state.entries[sessionId] ?? EMPTY_ENTRY),
        ...patch,
      },
    },
  }));
}

/**
 * 读取会话的 rsync 能力。并发请求共用一次探测；刷新会取代在途结果，
 * 以便安装 rsync 后重新检测能拿到新状态。
 */
export function loadRsyncCapabilities(
  sessionId: string,
  refresh = false,
): Promise<RsyncCapabilities | null> {
  const cached = useRsyncCapabilityStore.getState().entries[sessionId];
  if (!refresh && cached?.capabilities) {
    return Promise.resolve(cached.capabilities);
  }
  if (!refresh) {
    const pending = inflight.get(sessionId);
    if (pending) return pending;
  }

  const generation = (generations.get(sessionId) ?? 0) + 1;
  generations.set(sessionId, generation);
  patchEntry(sessionId, { loading: true, error: null });

  const request = ipc
    .rsyncCapabilities(sessionId, refresh)
    .then((capabilities) => {
      if (generations.get(sessionId) === generation) {
        patchEntry(sessionId, { capabilities, loading: false });
      }
      return capabilities;
    })
    .catch((error: unknown) => {
      if (generations.get(sessionId) === generation) {
        patchEntry(sessionId, {
          loading: false,
          error: toIpcError(error).payload,
        });
      }
      return null;
    })
    .finally(() => {
      if (inflight.get(sessionId) === request) inflight.delete(sessionId);
    });

  inflight.set(sessionId, request);
  return request;
}

/** 会话关闭后释放缓存，并让在途探测结果失效。 */
export function forgetRsyncCapabilities(sessionId: string): void {
  generations.set(sessionId, (generations.get(sessionId) ?? 0) + 1);
  inflight.delete(sessionId);
  useRsyncCapabilityStore.setState((state) => {
    if (!(sessionId in state.entries)) return state;
    const entries = { ...state.entries };
    delete entries[sessionId];
    return { entries };
  });
}

export function useRsyncCapability(sessionId: string): RsyncCapabilityEntry {
  return useRsyncCapabilityStore(
    (state) => state.entries[sessionId] ?? EMPTY_ENTRY,
  );
}
