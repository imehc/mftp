import { useEffect, useRef, useSyncExternalStore } from "react";

import type { GameSessionStore } from "./game-session-store";
import type { MoveResolvedInfo } from "./match";

export function useGameLifecycle<Mode, State, Move, Presentation>(
  store: GameSessionStore<Mode, State, Move, Presentation>,
) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.load();
  }, [store]);
  const mode = snapshot.active?.mode ?? null;
  return {
    mode,
    matchKey: snapshot.active?.id ?? "none",
    canStart:
      snapshot.status === "ready" && !snapshot.saved && !snapshot.transitioning,
    start: store.start,
    exit: () => {
      void store.exit();
    },
    restart: () => {
      if (mode) void store.replace(mode);
    },
    rematch: (next: (mode: Mode) => Mode) => {
      if (mode) void store.replace(next(mode));
    },
  };
}

export function useLocalGameSession<Mode, State, Move, Presentation>(
  store: GameSessionStore<Mode, State, Move, Presentation>,
  present: (
    info: MoveResolvedInfo<State, Move, Presentation>,
  ) => void | Promise<void>,
  startOnAttach = true,
) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const presentation = useRef(present);
  useEffect(() => {
    presentation.current = present;
  });
  const id = snapshot.active?.id;
  const session = snapshot.active?.session ?? null;
  useEffect(() => {
    store.ensureSession();
  }, [store, id]);
  useEffect(() => {
    if (!session) return;
    return store.attach((info) => presentation.current(info), startOnAttach);
  }, [store, session, startOnAttach]);
  return session;
}
