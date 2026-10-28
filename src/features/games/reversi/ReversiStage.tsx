import "./reversi.css";

import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";

import {
  type LightNoticeMessage,
  LightNoticeStack,
} from "~/components/LightNotice";
import { Button } from "~/components/ui/button";

import { cellIndex, legalMoves } from "./rules";
import type { ReversiMove, ReversiState } from "./types";
import { useReversiScene } from "./use-reversi-scene";

/** 原生格子提供读屏与键盘路径，棋盘始终整体适配可用空间。 */
export function ReversiStage({
  state,
  notice,
  onlineNotice,
  interactive,
  onPlay,
}: {
  state: ReversiState;
  notice: LightNoticeMessage | null;
  onlineNotice: LightNoticeMessage | null;
  interactive: boolean;
  onPlay(move: ReversiMove): void;
}) {
  const { t } = useLingui();
  const { canvas, status, generation, retry } = useReversiScene(state);
  const viewport = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [size, setSize] = useState(520);
  const [focused, setFocused] = useState(19);
  const legal = new Set(
    legalMoves(state).map((move) => cellIndex(move.row, move.col)),
  );
  const lastIndex = state.lastMove
    ? cellIndex(state.lastMove.row, state.lastMove.col)
    : -1;
  useEffect(() => {
    const host = viewport.current;
    if (!host) return;
    const observer = new ResizeObserver(() =>
      setSize(
        Math.max(
          240,
          Math.min(host.clientWidth - 24, host.clientHeight - 24, 720),
        ),
      ),
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={viewport} className="reversi-viewport">
      {status === "failed" && (
        <div
          role="status"
          className="text-muted-foreground mb-2 flex flex-wrap items-center justify-center gap-2 text-xs"
        >
          <Trans>棋盘渲染暂不可用，已切换为基础棋盘。</Trans>
          <Button variant="outline" size="sm" onClick={retry}>
            <Trans>重试</Trans>
          </Button>
        </div>
      )}
      <div
        className="reversi-board"
        data-webgl={status === "ready"}
        style={{ width: size }}
      >
        <canvas
          key={generation}
          ref={canvas}
          className="reversi-canvas"
          aria-hidden="true"
        />
        <div className="reversi-input-plane">
          <div className="reversi-columns" aria-hidden="true">
            {"ABCDEFGH".split("").map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="reversi-rows" aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => (
              <span key={index}>{index + 1}</span>
            ))}
          </div>
          <div className="reversi-grid" role="grid" aria-label={t`黑白棋棋盘`}>
            {Array.from({ length: 8 }, (_, row) => (
              <div className="reversi-row" role="row" key={row}>
                {Array.from({ length: 8 }, (_, col) => {
                  const index = cellIndex(row, col);
                  const stone = state.board[index];
                  const available = legal.has(index);
                  const coordinate = `${String.fromCharCode(65 + col)}${row + 1}`;
                  const contents =
                    stone === 0
                      ? t`黑棋`
                      : stone === 1
                        ? t`白棋`
                        : available
                          ? t`可落子`
                          : t`空格`;
                  return (
                    <div role="gridcell" className="reversi-cell" key={index}>
                      <button
                        ref={(node) => {
                          buttons.current[index] = node;
                        }}
                        type="button"
                        tabIndex={focused === index ? 0 : -1}
                        aria-label={t({
                          message: `${coordinate}，${contents}`,
                          comment: "黑白棋棋格：字母数字坐标和棋子状态",
                        })}
                        aria-disabled={!interactive || !available}
                        data-legal={available && interactive}
                        className="reversi-square"
                        onFocus={() => setFocused(index)}
                        onClick={() => {
                          if (interactive && available) onPlay({ row, col });
                        }}
                        onKeyDown={(event) => {
                          let next: number;
                          if (event.key === "ArrowRight")
                            next = row * 8 + Math.min(7, col + 1);
                          else if (event.key === "ArrowLeft")
                            next = row * 8 + Math.max(0, col - 1);
                          else if (event.key === "ArrowUp")
                            next = Math.max(0, row - 1) * 8 + col;
                          else if (event.key === "ArrowDown")
                            next = Math.min(7, row + 1) * 8 + col;
                          else if (event.key === "Home") next = row * 8;
                          else if (event.key === "End") next = row * 8 + 7;
                          else return;
                          event.preventDefault();
                          buttons.current[next]?.focus();
                        }}
                      >
                        {stone !== null ? (
                          <span
                            className="reversi-disc"
                            style={{ transform: `rotateY(${stone * 180}deg)` }}
                            aria-hidden="true"
                          >
                            <span className="reversi-face reversi-black" />
                            <span className="reversi-face reversi-white" />
                          </span>
                        ) : available && !state.finished ? (
                          <span className="reversi-legal" aria-hidden="true" />
                        ) : null}
                        {index === lastIndex && (
                          <span className="reversi-last" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <LightNoticeStack notices={[notice, onlineNotice]} />
    </div>
  );
}
