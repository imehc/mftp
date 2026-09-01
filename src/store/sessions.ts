import { create } from "zustand";
import type { Host, Session } from "~/types";
import * as ipc from "~/lib/ipc";

let counter = 0;
const nextTabId = () => `tab-${++counter}`;

interface SessionsState {
  sessions: Session[];
  activeId: string | null;
  /** 为某个主机打开一个新的终端标签页。返回标签页 id（前端 id）。 */
  openSession: (host: Host, passphrase?: string) => Promise<string>;
  closeSession: (tabId: string) => Promise<void>;
  setActive: (tabId: string) => void;
  setView: (tabId: string, view: Session["view"]) => void;
  patch: (tabId: string, patch: Partial<Session>) => void;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  activeId: null,

  async openSession(host, passphrase) {
    const existing = get().sessions.find(
      (s) =>
        s.hostId === host.id &&
        (s.status === "connecting" || s.status === "connected"),
    );
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }

    const tabId = nextTabId();
    // 乐观地先添加一个连接中（connecting）状态的标签页。默认进入文件视图，
    // 因为它是最常用的流程；终端只需点一下就能切过去。
    const draft: Session = {
      id: tabId,
      hostId: host.id,
      title: host.label,
      status: "connecting",
      view: "terminal",
    };
    set({ sessions: [...get().sessions, draft], activeId: tabId });

    try {
      const sessionId = await ipc.sshConnect(host.id, passphrase);
      const current = get().sessions.find((s) => s.id === tabId);
      if (!current) {
        await ipc.sshDisconnect(sessionId).catch(() => undefined);
        return sessionId;
      }
      const duplicate = get().sessions.find(
        (s) =>
          s.id !== tabId &&
          s.hostId === host.id &&
          (s.status === "connecting" || s.status === "connected"),
      );
      if (duplicate) {
        await ipc.sshDisconnect(sessionId).catch(() => undefined);
        set({
          sessions: get().sessions.filter((s) => s.id !== tabId),
          activeId: duplicate.id,
        });
        return duplicate.id;
      }
      get().patch(tabId, { id: sessionId, status: "connecting" });
      // 若 activeId 仍指向草稿，则重新指向真实会话 id。
      if (get().activeId === tabId) set({ activeId: sessionId });
      return sessionId;
    } catch (e) {
      get().patch(tabId, { status: "error", error: String(e) });
      throw e;
    }
  },

  async closeSession(tabId) {
    const s = get().sessions.find((x) => x.id === tabId);
    if (s && s.status !== "error" && !s.id.startsWith("tab-")) {
      try {
        await ipc.sshDisconnect(s.id);
      } catch {
        /* 忽略该错误 */
      }
    }
    const remaining = get().sessions.filter((x) => x.id !== tabId);
    let activeId = get().activeId;
    if (activeId === tabId) {
      activeId = remaining.length ? remaining[remaining.length - 1].id : null;
    }
    set({ sessions: remaining, activeId });
  },

  setActive(tabId) {
    set({ activeId: tabId });
  },

  setView(tabId, view) {
    get().patch(tabId, { view });
  },

  patch(tabId, patch) {
    set({
      sessions: get().sessions.map((s) =>
        s.id === tabId ? { ...s, ...patch } : s,
      ),
    });
  },
}));
