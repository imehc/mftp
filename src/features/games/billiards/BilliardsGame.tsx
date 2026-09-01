/**
 * 台球游戏界面外壳：顶部栏（音量、重开/退出）、物理引擎加载门，
 * 以及模式切换。击球是桌面上的弹弓手势（在母球后方拖动以瞄准并蓄力，
 * 松手击出）——底栏只放旋转切换与实时力度读数。
 */
import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { CircleDot } from "lucide-react";
import { useSettingsStore } from "~/store/settings";
import { GameHomeButton, GameMatchActions } from "../engine/GameHeaderControls";
import { GameVolumeControl } from "../engine/GameVolumeControl";
import { BilliardsMatch } from "./BilliardsMatch";
import { BilliardsModeMenu } from "./BilliardsModeMenu";
import { ensurePhysicsReady } from "./physics";
import { setGameAudioVolume, unlockAudio } from "./render/audio";
import type { BilliardsMode } from "./types";
export default function BilliardsGame() {
  const [physicsReady, setPhysicsReady] = useState(false);
  const [mode, setMode] = useState<BilliardsMode | null>(null);
  const [matchKey, setMatchKey] = useState(0);
  const [matchFinished, setMatchFinished] = useState(false);
  const gamesVolume = useSettingsStore((s) => s.gamesVolume);
  const exitMatch = () => {
    setMatchFinished(false);
    setMode(null);
  };
  const restartMatch = () => {
    setMatchFinished(false);
    setMatchKey((key) => key + 1);
  };

  // 让 WebAudio 主增益与持久化的设置保持同步。
  useEffect(() => {
    setGameAudioVolume(gamesVolume);
  }, [gamesVolume]);
  useEffect(() => {
    let cancelled = false;
    void ensurePhysicsReady().then(() => {
      if (!cancelled) setPhysicsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <main className="bg-background text-foreground flex h-full flex-col overflow-hidden">
      <header className="border-border flex items-center justify-between gap-2 border-b px-2 py-1.5">
        <div className="flex items-center gap-1">
          <GameHomeButton
            matchActive={mode !== null}
            matchFinished={matchFinished}
          />
          <div className="bg-border h-4 w-px" />
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <CircleDot className="size-3.5" />
            <Trans>台球</Trans>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <GameVolumeControl />
          {mode ? (
            <GameMatchActions
              matchFinished={matchFinished}
              canRestart
              onRestart={restartMatch}
              onExit={exitMatch}
            />
          ) : null}
        </div>
      </header>
      {!physicsReady ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
          <Trans>正在加载物理引擎…</Trans>
        </div>
      ) : mode === null ? (
        <BilliardsModeMenu
          onStart={(nextMode) => {
            // 进入对局是一次用户手势——正是解锁 WebAudio 的恰当时机
            // （iOS 自动播放策略）。
            unlockAudio();
            setMatchFinished(false);
            setMode(nextMode);
          }}
        />
      ) : (
        <BilliardsMatch
          key={`${JSON.stringify(mode)}-${matchKey}`}
          mode={mode}
          onRematch={() => {
            // 每次重赛交换开球方，让 AI 与玩家轮流开球。
            setMode((m) =>
              m?.kind === "ai"
                ? {
                    ...m,
                    playerBreaks: !m.playerBreaks,
                  }
                : m,
            );
            setMatchFinished(false);
            setMatchKey((k) => k + 1);
          }}
          onExit={exitMatch}
          onFinishedChange={setMatchFinished}
        />
      )}
    </main>
  );
}
