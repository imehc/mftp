import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BilliardsVictory } from "./BilliardsVictory";
import type { BilliardsDiscipline, BilliardsMode } from "./types";

vi.mock("../engine/VictoryConfetti", () => ({
  VictoryConfetti: () => <span data-testid="shared-victory-confetti" />,
}));

function markup(
  discipline: BilliardsDiscipline,
  kind: BilliardsMode["kind"],
  winnerSeat: number | null,
  finished = true,
) {
  const mode = {
    kind,
    discipline,
    difficulty: "medium",
    playerBreaks: true,
    reds: 15,
  } as BilliardsMode;

  return renderToStaticMarkup(
    <BilliardsVictory
      state={{
        finished,
        variant: kind === "practice" ? "practice" : discipline,
      }}
      mode={mode}
      winnerSeat={winnerSeat}
    />,
  );
}

describe.each(["eight-ball", "nine-ball", "snooker"] as const)(
  "%s 胜利结算庆祝",
  (discipline) => {
    it("玩家战胜电脑时接入共享胜利动画", () => {
      expect(markup(discipline, "ai", 0)).toContain(
        'data-testid="shared-victory-confetti"',
      );
    });

    it.each([0, 1])("同屏对战座位 %s 获胜时接入共享胜利动画", (seat) => {
      expect(markup(discipline, "hotseat", seat)).toContain(
        'data-testid="shared-victory-confetti"',
      );
    });

    it("电脑获胜不庆祝", () => {
      expect(markup(discipline, "ai", 1)).toBe("");
    });

    it.each(["ai", "hotseat"] as const)("%s 无胜者时不庆祝", (kind) => {
      expect(markup(discipline, kind, null)).toBe("");
    });

    it.each(["ai", "hotseat", "practice"] as const)(
      "%s 对局未结束时不提前庆祝",
      (kind) => {
        expect(markup(discipline, kind, 0, false)).toBe("");
      },
    );

    it("练习清台即使没有胜者座位也庆祝", () => {
      expect(markup(discipline, "practice", null)).toContain(
        'data-testid="shared-victory-confetti"',
      );
    });
  },
);
