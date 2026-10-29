/**
 * 台球游戏界面外壳：顶部栏（音量、重开/退出）、物理引擎加载门，
 * 以及模式切换。球桌手势同时瞄准与蓄力；力度条沿当前方向蓄力，松手击球。
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

import { GameSessionNotice } from "../engine/GameSessionNotice";
import { useGameLifecycle } from "../engine/use-game-session";
import { BilliardsHeader } from "./BilliardsHeader";
import { BilliardsMatch } from "./BilliardsMatch";
import { BilliardsModeMenu } from "./BilliardsModeMenu";
import { BilliardsRulesDialog } from "./BilliardsRulesDialog";
import {
  prepareBilliardsAudio,
  setGameAudioVolume,
  unlockAudio,
} from "./render/audio";
import { billiardsSessions } from "./session";
import type { BilliardsDiscipline } from "./types";

export default function BilliardsGame() {
  const mobile = !useDesktopLayout();
  const landscape = useMediaQuery("(orientation: landscape)") && mobile;
  const [physicsError, setPhysicsError] = useState<AppError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [physicsReady, setPhysicsReady] = useState(false);
  const [discipline, setDiscipline] =
    useState<BilliardsDiscipline>("eight-ball");
  const lifecycle = useGameLifecycle(billiardsSessions);
  const { mode, matchKey } = lifecycle;
  const [matchFinished, setMatchFinished] = useState(false);
  const gamesVolume = useSettingsStore((s) => s.gamesVolume);

  const exitMatch = () => {
    setMatchFinished(false);
    lifecycle.exit();
  };

  const restartMatch = () => {
    setMatchFinished(false);
    lifecycle.restart();
  };

  // 让 WebAudio 主增益与持久化的设置保持同步。
  useEffect(() => {
    setGameAudioVolume(gamesVolume);
  }, [gamesVolume]);
  useEffect(() => {
    if (mode === null) return;
    let cancelled = false;
    // 物理引擎只在模拟 worker 内初始化：先建会话，再等 worker 就绪；
    // 主线程不再加载 rapier，失败时重试会重新向 worker 请求初始化。
    const session = billiardsSessions.ensureSession();
    void Promise.all([session?.ready?.(), prepareBilliardsAudio()])
      .then(() => {
        if (!cancelled) setPhysicsReady(true);
      })
      .catch((error) => {
        if (!cancelled) setPhysicsError(toIpcError(error).payload);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, attempt]);
  // 只有进入对局才需要等引擎；未选模式时直接显示模式菜单。
  const loading = !physicsReady && mode !== null;
  const headerProps = {
    active: mode !== null,
    finished: matchFinished,
    landscape,
    onRestart: restartMatch,
    onExit: exitMatch,
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <main
        data-landscape={landscape && mode !== null}
        className="billiards-game ui-density-adaptive bg-background text-foreground flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {loading || mode === null ? (
          <>
            <BilliardsHeader
              {...headerProps}
              details={
                mode === null ? (
                  <BilliardsRulesDialog discipline={discipline} />
                ) : null
              }
            />
            <GameSessionNotice
              store={billiardsSessions}
              onRestore={unlockAudio}
            />
          </>
        ) : null}
        {loading ? (
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
          lifecycle.canStart ? (
            <BilliardsModeMenu
              discipline={discipline}
              onDisciplineChange={setDiscipline}
              onStart={(nextMode) => {
                // 进入对局是一次用户手势——正是解锁 WebAudio 的恰当时机
                // （iOS 自动播放策略）。
                unlockAudio();
                setMatchFinished(false);
                lifecycle.start(nextMode);
              }}
            />
          ) : null
        ) : (
          <BilliardsMatch
            key={matchKey}
            mode={mode}
            headerProps={headerProps}
            onRematch={() => {
              // 每次重赛交换开球方，让 AI 与玩家轮流开球。
              lifecycle.rematch((m) =>
                m?.kind === "ai"
                  ? {
                      ...m,
                      playerBreaks: !m.playerBreaks,
                    }
                  : m?.kind === "hotseat"
                    ? { ...m, firstSeat: 1 - (m.firstSeat ?? 0) }
                    : m,
              );
              setMatchFinished(false);
            }}
            onExit={exitMatch}
            onFinishedChange={setMatchFinished}
          />
        )}
      </main>
    </div>
  );
}
