import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { createStore } from "zustand/vanilla";

import {
  type PoetryReadingView,
  type PoetryReferenceView,
  resolvePoetryReadingView,
  resolvePoetryReferenceView,
} from "./reading-view";

export interface PoetryReadingLocation {
  page: "library" | "detail";
  uid?: string;
  q?: string;
  view?: PoetryReadingView;
}

export type ReadingPositionKey =
  `mobile-${PoetryReadingView}` | `desktop-${PoetryReferenceView}`;

export interface PoetryReadingSnapshot {
  uid: string;
  view?: PoetryReadingView;
  referenceView?: PoetryReferenceView;
  strainsOpen?: boolean;
  positions: Partial<Record<ReadingPositionKey, number>>;
}

interface ReadingSessionState {
  entries: PoetryReadingSnapshot[];
  location: PoetryReadingLocation | null;
  rememberLocation: (location: PoetryReadingLocation) => void;
  update: (
    uid: string,
    patch: Partial<Omit<PoetryReadingSnapshot, "uid">>,
  ) => void;
  begin: (
    uid: string,
    view: PoetryReadingView,
    referenceView: PoetryReferenceView,
  ) => void;
}

export const MAX_READING_SNAPSHOTS = 32;
const positionKeys: ReadingPositionKey[] = [
  "mobile-original",
  "mobile-annotations",
  "mobile-translation",
  "desktop-annotations",
  "desktop-translation",
];

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, limit: number): string | undefined {
  return typeof value === "string" && value.length <= limit ? value : undefined;
}

function restoreSession(value: unknown) {
  const saved = object(value);
  const entries = (Array.isArray(saved.entries) ? saved.entries : [])
    .slice(-MAX_READING_SNAPSHOTS)
    .flatMap((item): PoetryReadingSnapshot[] => {
      const entry = object(item);
      const uid = text(entry.uid, 1024);
      if (!uid) return [];
      const positions: PoetryReadingSnapshot["positions"] = {};
      const source = object(entry.positions);
      for (const key of positionKeys) {
        const position = source[key];
        if (
          typeof position === "number" &&
          Number.isFinite(position) &&
          position >= 0 &&
          position <= 10_000_000
        )
          positions[key] = position;
      }
      return [
        {
          uid,
          positions,
          view: resolvePoetryReadingView(entry.view),
          referenceView: resolvePoetryReferenceView(entry.referenceView),
          strainsOpen: entry.strainsOpen === true,
        },
      ];
    });
  const source = object(saved.location);
  const uid = text(source.uid, 1024);
  const location: PoetryReadingLocation | null =
    source.page === "library" || (source.page === "detail" && uid)
      ? {
          page: source.page,
          uid,
          q: text(source.q, 8192),
          view: resolvePoetryReadingView(source.view),
        }
      : null;
  return { entries, location };
}

// 阅读会话是可丢弃的界面状态；存储不可用时仍可在当前页面正常阅读。
const browserSessionStorage: StateStorage = {
  getItem: (key) => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* 存储受限时保留内存快照。 */
    }
  },
  removeItem: (key) => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* 存储受限时无需影响阅读。 */
    }
  },
};

export function createReadingSessionStore(
  storage: StateStorage = browserSessionStorage,
) {
  return createStore<ReadingSessionState>()(
    persist(
      (set) => ({
        entries: [],
        location: null,
        rememberLocation: (location) => set({ location }),
        update: (uid, patch) =>
          set((state) => {
            const previous = state.entries.find((entry) => entry.uid === uid);
            const next = {
              ...previous,
              ...patch,
              uid,
              positions: { ...previous?.positions, ...patch.positions },
            };
            return {
              entries: [
                ...state.entries.filter((entry) => entry.uid !== uid),
                next,
              ].slice(-MAX_READING_SNAPSHOTS),
            };
          }),
        begin: (uid, view, referenceView) =>
          set((state) => ({
            entries: [
              ...state.entries.filter((entry) => entry.uid !== uid),
              { uid, view, referenceView, positions: {} },
            ].slice(-MAX_READING_SNAPSHOTS),
          })),
      }),
      {
        name: "mftp-poetry-reading-session",
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: ({ entries, location }) => ({ entries, location }),
        merge: (saved, current) => ({ ...current, ...restoreSession(saved) }),
      },
    ),
  );
}

export const poetryReadingSession = createReadingSessionStore();

export function readingSnapshot(uid: string) {
  return poetryReadingSession
    .getState()
    .entries.find((entry) => entry.uid === uid);
}
