import { useEffect, useState, useSyncExternalStore } from "react";

import type { OnlineGame } from "./matchTypes";
import { onlineRoomSession } from "./online-session-store";

export function useOnlineRoom<S, M, P>(
  gameId: string,
  definition: OnlineGame<S, M, P>,
) {
  const [entry, setEntry] = useState(() => ({
    gameId,
    session: onlineRoomSession(gameId, definition),
  }));
  if (entry.gameId !== gameId)
    setEntry({ gameId, session: onlineRoomSession(gameId, definition) });
  const { session } = entry;
  const { owner } = session;
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  useEffect(() => {
    session.activate();
  }, [session]);
  // 大厅和对局共用一个所有者，交接同步发生，不依赖 effect 同步 ref。
  return { owner, ...snapshot };
}
