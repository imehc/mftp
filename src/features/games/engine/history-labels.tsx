import { Trans } from "@lingui/react/macro";

import type { Difficulty } from "./ai";

interface HistoryMode {
  mode: "hotseat" | "online" | "ai";
  difficulty?: Difficulty;
}

export function historyModeLabel(payload: HistoryMode) {
  if (payload.mode === "hotseat")
    return <Trans comment="棋类对局模式：两人在同一设备对战。">双人</Trans>;
  if (payload.mode === "online")
    return (
      <Trans comment="棋类对局模式：通过网络与另一位玩家对战。">联机</Trans>
    );
  return (
    <span>
      <Trans>电脑</Trans>
      {" · "}
      {payload.difficulty === "easy" ? (
        <Trans>简单</Trans>
      ) : payload.difficulty === "hard" ? (
        <Trans>困难</Trans>
      ) : (
        <Trans>中等</Trans>
      )}
    </span>
  );
}

export function formatHistoryTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
