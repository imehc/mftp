import type { GameRoomSummary } from "~/bindings";
import { gameRoomDiscover } from "~/lib/ipc";

let flight: { gameId: string; result: Promise<GameRoomSummary[]> } | null =
  null;
export async function discoverRooms(
  gameId: string,
): Promise<GameRoomSummary[]> {
  // StrictMode 或页面切换不能启动重叠的本机扫描；相同游戏复用在途结果。
  while (flight) {
    if (flight.gameId === gameId) return flight.result;
    try {
      await flight.result;
    } catch {
      /* 上一次扫描的错误由其调用者处理。 */
    }
  }
  const current = { gameId, result: gameRoomDiscover(gameId) };
  flight = current;
  try {
    return await current.result;
  } finally {
    if (flight === current) flight = null;
  }
}
