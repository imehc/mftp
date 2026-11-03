import { useLingui } from "@lingui/react/macro";

export type GamePlayerIdentity =
  "you" | "computer" | "opponent" | "player1" | "player2";

export type GamePlayerColor = "black" | "white" | "red";

/** 玩家身份与棋色明确绑定，不由当前回合或棋盘朝向推断。 */
export function GamePlayerLabel({
  identity,
  color,
}: {
  identity: GamePlayerIdentity;
  color?: GamePlayerColor | null;
}) {
  const { t } = useLingui();
  const playerName =
    identity === "you"
      ? t({ message: "你", comment: "对局状态栏的本地玩家身份。" })
      : identity === "computer"
        ? t({ message: "电脑", comment: "对局状态栏的本地算法对手身份。" })
        : identity === "opponent"
          ? t({ message: "对方", comment: "对局状态栏的远程玩家身份。" })
          : identity === "player1"
            ? t({
                message: "玩家 1",
                comment: "同屏双人对局的第一位玩家，状态栏左侧。",
              })
            : t({
                message: "玩家 2",
                comment: "同屏双人对局的第二位玩家，状态栏右侧。",
              });
  const colorName =
    color === "black"
      ? t({ message: "黑", comment: "小游戏玩家所执棋子的颜色。" })
      : color === "white"
        ? t({ message: "白", comment: "小游戏玩家所执棋子的颜色。" })
        : t({ message: "红", comment: "小游戏玩家所执棋子的颜色。" });
  const compactPlayerName =
    identity === "computer"
      ? t({
          message: "电脑",
          context: "紧凑玩家身份",
          comment: "窄屏身份，英文用 CPU。",
        })
      : identity === "opponent"
        ? t({
            message: "对方",
            context: "紧凑玩家身份",
            comment: "窄屏远程玩家身份，英文用 Peer。",
          })
        : identity === "player1"
          ? t({
              message: "玩家 1",
              context: "紧凑玩家身份",
              comment: "窄屏第一位玩家，英文用 P1。",
            })
          : identity === "player2"
            ? t({
                message: "玩家 2",
                context: "紧凑玩家身份",
                comment: "窄屏第二位玩家，英文用 P2。",
              })
            : playerName;
  const compactColorName =
    color === "black"
      ? t({
          message: "黑",
          context: "紧凑棋色",
          comment: "窄屏棋色，英文用 B。",
        })
      : color === "white"
        ? t({
            message: "白",
            context: "紧凑棋色",
            comment: "窄屏棋色，英文用 W。",
          })
        : t({
            message: "红",
            context: "紧凑棋色",
            comment: "窄屏棋色，英文用 R。",
          });
  const fullLabel = color
    ? t({
        message: `${playerName}执${colorName}`,
        comment: "玩家身份与完整棋色，亦供辅助技术读取。",
      })
    : playerName;
  const compactLabel = color
    ? t({
        message: `${compactPlayerName}·${compactColorName}`,
        comment: "窄屏玩家与棋色的简短标签，保持单行。",
      })
    : compactPlayerName;
  return (
    <>
      <span className="hidden md:inline" aria-hidden="true">
        {fullLabel}
      </span>
      <span className="md:hidden" aria-hidden="true">
        {compactLabel}
      </span>
      <span className="sr-only">{fullLabel}</span>
    </>
  );
}
