import { useEffect, useState, useSyncExternalStore } from "react";
import { RoomOwner } from "./roomOwner";

export function useOnlineRoom<M>(gameId: string) {
  const [entry, setEntry] = useState(() => ({
    gameId,
    owner: new RoomOwner<M>(),
  }));
  // 游戏/棋盘规格改变时换所有者，旧实例由自己的 effect 清理。
  if (entry.gameId !== gameId) setEntry({ gameId, owner: new RoomOwner<M>() });
  const { owner } = entry;
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  useEffect(() => {
    owner.activate();
    return () => owner.dispose();
  }, [owner]);
  // 大厅和对局共用一个所有者，交接同步发生，不依赖 effect 同步 ref。
  return { owner, ...snapshot };
}
