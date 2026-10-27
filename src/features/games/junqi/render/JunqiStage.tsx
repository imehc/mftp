import { Trans, useLingui } from "@lingui/react/macro";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { describeError, frontendError } from "~/lib/errors";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import { useSettingsStore } from "~/store/settings";

import { useBoardAccentColor } from "../../engine/use-board-accent";
import { colOf, isCamp, isHeadquarters, rowOf } from "../board";
import { PIECE_FACE_LABELS, PIECE_LABELS } from "../labels";
import type { PieceKind } from "../types";
import type { ViewBoard } from "../view-types";
import { cellPosition, viewSize } from "./geometry";
import { createJunqiScene } from "./scene";

export function JunqiStage({
  board,
  flipped,
  selected,
  targets,
  interactive,
  deployment,
  selectable,
  lastMove,
  onCell,
  onCancel,
}: {
  board: ViewBoard;
  flipped: boolean;
  selected: number | null;
  targets: number[];
  interactive: boolean;
  deployment: boolean;
  selectable: number[];
  lastMove: { from: number; to: number } | null;
  onCell(index: number): void;
  onCancel(): void;
}) {
  const { t, i18n } = useLingui();
  const landscape = useDesktopLayout();
  const accentColor = useBoardAccentColor();
  const size = viewSize(landscape);
  const cjkFont = useSettingsStore((state) => state.cjkFont);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Awaited<ReturnType<typeof createJunqiScene>> | null>(
    null,
  );
  const [hovered, setHovered] = useState<number | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState<number | null>(null);
  const positionRef = useRef({
    board,
    flipped,
    marks: {
      accentColor,
      selected,
      targets,
      hovered: null as number | null,
      focused: null as number | null,
      deployment,
      lastMove,
    },
  });
  const [error, setError] = useState<unknown>(null);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [focused, setFocused] = useState(30);
  useEffect(() => {
    positionRef.current.board = board;
    positionRef.current.flipped = flipped;
    sceneRef.current?.setBoard(board, flipped, true);
  }, [board, flipped]);
  useEffect(() => {
    const marks = {
      accentColor,
      selected,
      targets,
      hovered:
        interactive &&
        hovered !== null &&
        (selectable.includes(hovered) || targets.includes(hovered))
          ? hovered
          : null,
      focused: keyboardFocus,
      deployment,
      lastMove,
    };
    positionRef.current.marks = marks;
    sceneRef.current?.setMarks(marks, board, flipped);
  }, [
    accentColor,
    selected,
    targets,
    hovered,
    interactive,
    selectable,
    keyboardFocus,
    deployment,
    lastMove,
    board,
    flipped,
  ]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let scene: Awaited<ReturnType<typeof createJunqiScene>> | undefined;
    let observer: ResizeObserver | undefined;

    const lost = (event: Event) => {
      event.preventDefault();
      scene?.foreground(false);
      setError(frontendError("junqi:context_lost", "Junqi WebGL context lost"));
      setReady(false);
    };

    const foreground = () => scene?.foreground(!document.hidden);
    canvas.addEventListener("webglcontextlost", lost);
    document.addEventListener("visibilitychange", foreground);
    void document.fonts.ready.then(async () => {
      if (cancelled) return;
      try {
        const family = getComputedStyle(canvas).fontFamily;
        const font =
          cjkFont === "system"
            ? `"STKaiti", "KaiTi", "LXGW WenKai App", ${family}`
            : family;
        const pieces = Object.fromEntries(
          Object.entries(PIECE_FACE_LABELS).map(([kind, label]) => [
            kind,
            t(label),
          ]),
        ) as Record<PieceKind, string>;
        await document.fonts.load(
          `600 32px ${font}`,
          Object.values(pieces).join(""),
        );
        if (cancelled) return;
        scene = await createJunqiScene(
          canvas,
          {
            pieces,
            camp: t`行营`,
            headquarters: t`大本营`,
            font,
          },
          landscape,
        );
        if (cancelled) {
          scene.dispose();
          return;
        }
        sceneRef.current = scene;
        scene.setBoard(
          positionRef.current.board,
          positionRef.current.flipped,
          false,
        );
        scene.setMarks(
          positionRef.current.marks,
          positionRef.current.board,
          positionRef.current.flipped,
        );
        const resize = () =>
          scene?.resize(canvas.clientWidth, canvas.clientHeight);
        observer = new ResizeObserver(resize);
        observer.observe(canvas);
        resize();
        setReady(true);
        setError(null);
      } catch {
        if (cancelled) return;
        setError(
          frontendError("junqi:render", "Unable to initialize Junqi renderer"),
        );
      }
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      scene?.dispose();
      sceneRef.current = null;
      canvas.removeEventListener("webglcontextlost", lost);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [t, i18n.locale, cjkFont, retry, landscape]);
  return (
    <div className="junqi-board-viewport app-scroll-safe-end relative min-h-0 min-w-0 flex-1 overflow-auto">
      {error ? (
        <Alert variant="destructive" className="mx-auto w-fit">
          <AlertDescription>
            {describeError(error, t)}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null);
                setReady(false);
                setRetry((value) => value + 1);
              }}
            >
              <Trans>重试</Trans>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div
        className="junqi-board relative"
        style={
          {
            "--board-ratio": size.width / size.height,
            "--board-columns": size.width,
          } as CSSProperties
        }
        data-landscape={landscape}
        aria-busy={!ready && !error}
      >
        <canvas
          key={`${landscape}:${i18n.locale}:${cjkFont}:${retry}`}
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 size-full"
          aria-hidden="true"
        />
        {!ready && !error ? (
          <div
            role="status"
            className="absolute inset-0 flex items-center justify-center gap-2 text-sm"
          >
            <Spinner />
            <Trans>正在准备棋盘…</Trans>
          </div>
        ) : null}
        {ready ? (
          <div
            role="group"
            aria-label={t`陆战棋棋盘`}
            className="absolute inset-0"
            onPointerDown={() => setKeyboardFocus(null)}
            onClick={(event) => {
              if (event.target === event.currentTarget) onCancel();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onCancel();
                return;
              }
              const offsets: Record<string, number> = {
                ArrowUp: landscape ? -1 : -5,
                ArrowDown: landscape ? 1 : 5,
                ArrowLeft: landscape ? 5 : -1,
                ArrowRight: landscape ? -5 : 1,
              };
              const offset = offsets[event.key];
              if (!offset) return;
              event.preventDefault();
              const display = flipped ? 59 - focused : focused;
              const next = display + offset;
              if (
                next < 0 ||
                next >= 60 ||
                (Math.abs(offset) === 1 && rowOf(next) !== rowOf(display))
              )
                return;
              const target = flipped ? 59 - next : next;
              setFocused(target);
              setKeyboardFocus(target);
              event.currentTarget
                .querySelector<HTMLButtonElement>(`[data-cell="${target}"]`)
                ?.focus();
            }}
          >
            {board.map((piece, index) => {
              const p = cellPosition(index, flipped, landscape);
              const row = rowOf(index) + 1,
                column = colOf(index) + 1;
              const location = t`第 ${row} 行第 ${column} 列`;
              const name = piece
                ? piece.face === "covered"
                  ? piece.side === null
                    ? t({
                        message: "未翻棋子",
                        comment: "翻棋中尚未揭示身份和阵营的棋子",
                      })
                    : `${piece.side === 0 ? t`红方` : t`黑方`} ${t({ message: "未知棋子", comment: "暗棋中对手尚未公开身份的棋子" })}`
                  : `${piece.side === 0 ? t`红方` : t`黑方`} ${t(PIECE_LABELS[piece.kind])}`
                : isCamp(index)
                  ? t`行营`
                  : isHeadquarters(index)
                    ? t`大本营`
                    : t`空位`;
              return (
                <button
                  type="button"
                  key={index}
                  data-cell={index}
                  tabIndex={focused === index ? 0 : -1}
                  aria-label={`${location} · ${name}${targets.includes(index) ? ` · ${t`可选位置`}` : ""}`}
                  aria-pressed={selected === index}
                  aria-disabled={!interactive}
                  data-target={targets.includes(index)}
                  data-actionable={
                    interactive &&
                    (selectable.includes(index) || targets.includes(index))
                  }
                  onPointerEnter={(event) => {
                    if (
                      event.pointerType === "mouse" &&
                      interactive &&
                      (selectable.includes(index) || targets.includes(index))
                    )
                      setHovered(index);
                  }}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={(event) => {
                    setFocused(index);
                    setKeyboardFocus(
                      event.currentTarget.matches(":focus-visible")
                        ? index
                        : null,
                    );
                  }}
                  onBlur={() => setKeyboardFocus(null)}
                  onClick={() => {
                    if (interactive) onCell(index);
                  }}
                  className="junqi-cell"
                  style={{
                    left: `${(0.5 + p.x / size.width) * 100}%`,
                    top: `${(0.5 - p.y / size.height) * 100}%`,
                    width: `${100 / size.width}%`,
                    height: `${100 / size.height}%`,
                  }}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
