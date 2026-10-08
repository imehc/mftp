import { useEffect, useState } from "react";

import type { AppError, GameRoomSummary } from "~/bindings";
import { toIpcError } from "~/lib/errors";

import { discoverRooms } from "./discovery";

export function useRoomDiscovery(gameId: string, enabled: boolean) {
  const [found, setFound] = useState<{
    gameId: string;
    rooms: GameRoomSummary[];
  }>({ gameId, rooms: [] });
  const [revision, setRevision] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [failure, setFailure] = useState<{
    gameId: string;
    error: AppError;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scan = async () => {
      setScanning(true);
      try {
        const rooms = await discoverRooms(gameId);
        if (!cancelled) {
          setFound({ gameId, rooms });
          setFailure(null);
        }
      } catch (failure) {
        if (!cancelled)
          setFailure({ gameId, error: toIpcError(failure).payload });
      }
      if (!cancelled) {
        setScanning(false);
        timer = setTimeout(scan, 4000);
      }
    };

    void scan();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [gameId, enabled, revision]);
  // 切换游戏时，不能把上一游戏的可加入房间暂时显示在新大厅。
  return {
    rooms: found.gameId === gameId ? found.rooms : [],
    scanning,
    refresh: () => setRevision((value) => value + 1),
    error: failure?.gameId === gameId ? failure.error : null,
  };
}
