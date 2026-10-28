import type { AppError } from "~/bindings";
import { frontendError, IpcError } from "~/lib/errors";

import type { AiStrategy } from "../engine/ai";
import { parseChessMove } from "./checkpoint";
import type { ChessMove, ChessState } from "./types";

export const chessAiStrategy: AiStrategy<ChessState, ChessMove> = {
  chooseMove(state, _seat, difficulty, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./ai.worker.ts", import.meta.url), {
        type: "module",
      });
      let settled = false;

      const finish = (error?: unknown, move?: ChessMove) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        if (error) reject(error);
        else if (move) resolve(move);
      };

      const failed = () =>
        finish(new IpcError(frontendError("chess:ai", "Chess worker failed")));
      const cancel = () =>
        finish(signal.reason ?? new DOMException("Aborted", "AbortError"));
      const timer = setTimeout(failed, 8000);
      worker.onmessage = (
        event: MessageEvent<{ move?: unknown; error?: AppError }>,
      ) => {
        if (event.data.error) {
          finish(new IpcError(event.data.error));
          return;
        }
        const move = parseChessMove(event.data.move);
        if (move) finish(undefined, move);
        else failed();
      };
      worker.onerror = (event) => {
        event.preventDefault();
        failed();
      };
      worker.onmessageerror = failed;
      signal.addEventListener("abort", cancel, { once: true });
      try {
        worker.postMessage({ state, difficulty });
      } catch (error) {
        finish(error);
      }
    });
  },
};
