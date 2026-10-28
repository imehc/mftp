import type { AppError } from "~/bindings";

import type { Difficulty } from "../engine/ai";
import { searchChess } from "./ai-search";
import type { ChessMove, ChessState } from "./types";

self.onmessage = (
  event: MessageEvent<{ state: ChessState; difficulty: Difficulty }>,
) => {
  try {
    const move = searchChess(event.data.state, event.data.difficulty);
    self.postMessage({ move } satisfies { move: ChessMove });
  } catch (error) {
    self.postMessage({
      error: {
        kind: "external",
        code: "chess:ai",
        message: error instanceof Error ? error.message : "Chess search failed",
        args: {},
      } satisfies AppError,
    });
  }
};
