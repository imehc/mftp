/**
 * 台球游戏界面外壳：顶部栏（音量、重开/退出）、物理引擎加载门，
 * 以及模式切换。击球是桌面上的弹弓手势（在母球后方拖动以瞄准并蓄力，
 * 松手击出）——底栏只放旋转切换与实时力度读数。
 */
import "./billiards.css";

import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { describeError, toIpcError } from "~/lib/errors";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import { useMediaQuery } from "~/lib/use-media-query";
import { useSettingsStore } from "~/store/settings";
import type { AppError } from "~/types";

import { BilliardsHeader } from "./BilliardsHeader";
import { BilliardsMatch } from "./BilliardsMatch";
import { BilliardsModeMenu } from "./BilliardsModeMenu";
import { ensurePhysicsReady } from "./physics";
import { setGameAudioVolume, unlockAudio } from "./render/audio";
import type { BilliardsMode } from "./types";
import { useBilliardsOrientation } from "./use-billiards-orientation";

export default function BilliardsGame() {
  const mobile = !useDesktopLayout();
  const landscape = useMediaQuery("(orientation: landscape)") && mobile;
  const [physicsError, setPhysicsError] = useState<AppError | null>(null);
  const [attempt, setAttempt] = useState(0);
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
    void ensurePhysicsReady()
      .then(() => {
        if (!cancelled) setPhysicsReady(true);
      })
      .catch((error) => {
        if (!cancelled) setPhysicsError(toIpcError(error).payload);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  const rotate = useBilliardsOrientation(mode !== null, landscape);
  return (
    <main
      data-landscape={landscape && mode !== null}
      className="billiards-game ui-density-adaptive bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden"
    >
      <BilliardsHeader
        active={mode !== null}
        finished={matchFinished}
        landscape={landscape}
        mobile={mobile}
        onRotate={() => void rotate()}
        onRestart={restartMatch}
        onExit={exitMatch}
      />
      {!physicsReady ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
          {physicsError ? (
            <div className="flex flex-col items-center gap-3">
              <p role="alert">{describeError(physicsError)}</p>
              <Button
                onClick={() => {
                  setPhysicsError(null);
                  setAttempt((value) => value + 1);
                }}
              >
                <Trans>重试</Trans>
              </Button>
            </div>
          ) : (
            <Trans>正在加载物理引擎…</Trans>
          )}
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
