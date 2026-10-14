import type { SeatIndex } from "../engine/types";
import { VictoryConfetti } from "../engine/VictoryConfetti";
import type { BilliardsMode, BilliardsState } from "./types";

export function BilliardsVictory({
  state,
  mode,
  winnerSeat,
}: {
  state: Pick<BilliardsState, "finished" | "variant">;
  mode: BilliardsMode;
  winnerSeat: SeatIndex | null;
}) {
  const celebrate =
    state.finished &&
    (state.variant === "practice" ||
      (winnerSeat !== null &&
        (mode.kind === "hotseat" || (mode.kind === "ai" && winnerSeat === 0))));

  return celebrate ? <VictoryConfetti /> : null;
}
