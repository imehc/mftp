import { Trans } from "@lingui/react/macro";
import { FlagIcon } from "lucide-react";

import { Button } from "~/components/ui/button";

import { BoardGameHeader } from "../engine/BoardGameHeader";
import { GameInfoPopover } from "../engine/GameInfoPopover";
import { BilliardsAimOnlyControl } from "./BilliardsAimOnlyControl";
import { BilliardsHelp } from "./BilliardsHelp";
import { BilliardsInfo } from "./BilliardsInfo";
import type { BilliardsMode, BilliardsState } from "./types";

/** 台球页面外壳传给对局页的标题栏状态。 */
export interface BilliardsHeaderProps {
  active: boolean;
  finished: boolean;
  landscape: boolean;
  onRestart(): void;
  onExit(): void;
  onMenuOpenChange?(open: boolean): void;
}

/** 对局页标题栏：帮助与信息入口和其它小游戏同源，比分明细进信息弹层。 */
export function BilliardsMatchHeader({
  mode,
  state,
  panel,
  onPanel,
  active,
  finished,
  landscape,
  onRestart,
  onExit,
  onMenuOpenChange,
  canConcede = false,
  onConcede,
}: {
  mode: BilliardsMode;
  state: BilliardsState;
  panel: "details" | null;
  onPanel(panel: "details" | null): void;
  active: boolean;
  finished: boolean;
  landscape: boolean;
  onRestart(): void;
  onExit(): void;
  onMenuOpenChange?(open: boolean): void;
  canConcede?: boolean;
  onConcede?(): void;
}) {
  return (
    <>
      <BoardGameHeader
        title={<Trans>台球</Trans>}
        active={active}
        finished={finished}
        canRestart
        onRestart={onRestart}
        onExit={onExit}
        landscape={landscape}
        onMenuOpenChange={onMenuOpenChange}
        help={<BilliardsHelp discipline={mode.discipline ?? "eight-ball"} />}
        extraActions={(closeThen) => (
          <>
            <BilliardsAimOnlyControl />
            {onConcede ? (
              <Button
                variant="ghost"
                size="sm"
                density="adaptive"
                disabled={!canConcede}
                className="justify-start"
                onClick={() => closeThen(onConcede)}
              >
                <FlagIcon data-icon="inline-start" />
                <Trans comment="斯诺克主动认输本局">认输</Trans>
              </Button>
            ) : null}
          </>
        )}
      />
      <GameInfoPopover
        open={panel === "details"}
        onOpenChange={(next) => onPanel(next ? "details" : null)}
      >
        <BilliardsInfo state={state} mode={mode} />
      </GameInfoPopover>
    </>
  );
}
