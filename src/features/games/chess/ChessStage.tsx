import { Trans, useLingui } from "@lingui/react/macro";
import { Chess, type Square } from "chess.js";
import { useEffect, useRef, useState } from "react";

import { LightNotice, type LightNoticeMessage } from "~/components/LightNotice";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { describeError, frontendError } from "~/lib/errors";

import { pieceNames } from "./labels";
import { bindChessInput } from "./render/input";
import {
  type ChessScene,
  createChessScene,
  type SceneSettings,
} from "./render/scene";

interface Props extends SceneSettings {
  interactive: boolean;
  notice?: LightNoticeMessage | null;
  onSquare(square: Square): void;
  onDrop(from: Square, to: Square): void;
  onBusy(busy: boolean): void;
}

export function ChessStage(props: Props) {
  const { t } = useLingui();
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<ChessScene | null>(null),
    current = useRef(props);
  const [retry, setRetry] = useState(0),
    [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState<Square>("e2");
  const [keyboardFocus, setKeyboardFocus] = useState<Square | null>(null);
  useEffect(() => {
    current.current = props;
  });
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let alive = true,
      view: ChessScene | null = null;

    let detach = () => {};

    void createChessScene(container, current.current, {
      busy: (busy) => {
        if (alive) current.current.onBusy(busy);
      },
      fail: () => {
        if (alive) {
          setFailed(true);
          current.current.onBusy(false);
        }
      },
    })
      .then((created) => {
        if (!alive) {
          created.dispose();
          return;
        }
        view = created;
        scene.current = created;
        created.sync(current.current);
        setReady(true);
        detach = bindChessInput(created, () => current.current);
      })
      .catch(() => {
        if (alive) {
          setFailed(true);
          current.current.onBusy(false);
        }
      });
    return () => {
      alive = false;
      detach();
      view?.dispose();
      scene.current = null;
    };
  }, [retry]);
  useEffect(() => {
    scene.current?.sync({ ...props, focus: keyboardFocus });
  }, [props, keyboardFocus]);
  const chess = new Chess(props.state.fen);
  const squares = Array.from(
    { length: 64 },
    (_, i) => ("abcdefgh"[i % 8] + (8 - Math.floor(i / 8))) as Square,
  );
  if (props.flipped) squares.reverse();
  return (
    <div className="chess-stage relative min-h-0 flex-1">
      <div ref={host} className="absolute inset-0 overflow-hidden" />
      {!ready && !failed && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm"
          role="status"
        >
          <Spinner />
          <Trans>正在准备棋盘…</Trans>
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <Alert className="max-w-sm" variant="destructive">
            <AlertDescription>
              {describeError(
                frontendError("chess:render", "Chess renderer unavailable"),
                t,
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFailed(false);
                  setReady(false);
                  setRetry((value) => value + 1);
                }}
              >
                <Trans>重新加载棋盘</Trans>
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}
      <div
        role="group"
        aria-label={t`国际象棋棋盘`}
        className="pointer-events-none absolute inset-0"
      >
        {squares.map((square, index) => {
          const piece = chess.get(square);
          const side = piece?.color === "w" ? t`白方` : t`黑方`;
          const pieceName = piece ? t(pieceNames[piece.type]) : "";
          const description = piece
            ? t({
                comment: "国际象棋格子的读屏描述，含阵营和棋子名称",
                message: `${side}的${pieceName}`,
              })
            : t`空格`;
          const legal = props.targets.includes(square);
          return (
            <button
              key={square}
              type="button"
              className="sr-only"
              tabIndex={focused === square ? 0 : -1}
              aria-label={
                legal
                  ? t`${square}，${description}，可走位置`
                  : t`${square}，${description}`
              }
              aria-pressed={props.selected === square}
              aria-disabled={!props.interactive || !ready || failed}
              data-chess-square={square}
              onFocus={() => {
                setFocused(square);
                setKeyboardFocus(square);
              }}
              onBlur={() => setKeyboardFocus(null)}
              onClick={() => {
                if (
                  props.interactive &&
                  ready &&
                  !failed &&
                  !scene.current?.busy
                )
                  props.onSquare(square);
              }}
              onKeyDown={(event) => {
                const delta =
                  event.key === "ArrowLeft"
                    ? -1
                    : event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowUp"
                        ? -8
                        : event.key === "ArrowDown"
                          ? 8
                          : 0;
                if (!delta) return;
                event.preventDefault();
                const next = index + delta;
                if (
                  next >= 0 &&
                  next < 64 &&
                  (Math.abs(delta) === 8 ||
                    Math.floor(next / 8) === Math.floor(index / 8))
                ) {
                  const target = squares[next];
                  setFocused(target);
                  event.currentTarget.parentElement
                    ?.querySelector<HTMLButtonElement>(
                      '[data-chess-square="' + target + '"]',
                    )
                    ?.focus({ preventScroll: true });
                }
              }}
            />
          );
        })}
      </div>
      <LightNotice notice={props.notice ?? null} />
    </div>
  );
}
