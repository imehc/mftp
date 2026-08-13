import { create } from "zustand";
import type { Host, Session } from "~/types";
import * as ipc from "~/lib/ipc";

let counter = 0;
const nextTabId = () => `tab-${++counter}`;

interface SessionsState {
  sessions: Session[];
  activeId: string | null;
  /** Open a new terminal tab for a host. Returns the tab id (frontend id). */
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
    // Optimistically add a connecting tab. Default to the file view since it
    // is the most used workflow; the terminal is one click away.
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
      // Re-point activeId if it was the draft.
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
        /* ignore */
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
