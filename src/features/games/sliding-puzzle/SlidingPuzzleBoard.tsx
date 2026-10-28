import { useLingui } from "@lingui/react/macro";
import gsap from "gsap";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "~/lib/motion";

import { canMove, focusNeighbor } from "./engine";
import { createPuzzleWood } from "./textures";
import type { PuzzleBoard } from "./types";

const GAP = 3;
const RIM = 8;

export function SlidingPuzzleBoard({
  board,
  disabled,
  onMove,
}: {
  board: PuzzleBoard;
  disabled: boolean;
  onMove(tile: number): void;
}) {
  const { t } = useLingui();
  const host = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [wood] = useState(createPuzzleWood);
  const [pixels, setPixels] = useState(304);
  const [focused, setFocused] = useState(
    board.tiles.find((tile) => canMove(board, tile)) ?? 1,
  );
  const previousWidth = useRef(0);
  const cell = (pixels - RIM * 2 - GAP * (board.size - 1)) / board.size;

  useLayoutEffect(() => {
    const container = host.current;
    if (!container) return;

    const measure = () => {
      const parent = container.parentElement;
      const font = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      const minimum =
        board.size * Math.max(44, font * 2.75) +
        RIM * 2 +
        GAP * (board.size - 1);
      setPixels(
        Math.min(
          container.clientWidth,
          Math.max(minimum, Math.min(600, (parent?.clientHeight ?? 600) - 40)),
        ),
      );
    };

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (container.parentElement) observer.observe(container.parentElement);
    const settings = new MutationObserver(measure);
    settings.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    measure();
    return () => {
      observer.disconnect();
      settings.disconnect();
    };
  }, [board.size]);

  useLayoutEffect(() => {
    const nodes =
      surface.current?.querySelectorAll<HTMLButtonElement>("[data-tile]");
    if (!nodes) return;
    const instant =
      pixels !== previousWidth.current ||
      prefersReducedMotion() ||
      document.hidden;
    previousWidth.current = pixels;
    nodes.forEach((node) => {
      const index = board.tiles.indexOf(Number(node.dataset.tile));
      const position = {
        x: (index % board.size) * (cell + GAP),
        y: Math.floor(index / board.size) * (cell + GAP),
      };
      if (instant || node.dataset.tile === "0") gsap.set(node, position);
      else
        gsap.to(node, {
          ...position,
          duration: 0.14,
          ease: "power2.out",
          overwrite: true,
        });
    });

    const settle = () => {
      if (!document.hidden) return;
      nodes.forEach((node) => {
        gsap.killTweensOf(node);
        const index = board.tiles.indexOf(Number(node.dataset.tile));
        gsap.set(node, {
          x: (index % board.size) * (cell + GAP),
          y: Math.floor(index / board.size) * (cell + GAP),
        });
      });
    };

    document.addEventListener("visibilitychange", settle);
    return () => {
      document.removeEventListener("visibilitychange", settle);
      // 保留当前插值位置供下一次位移衔接，退出页面则直接释放动画。
      nodes.forEach((node) => gsap.killTweensOf(node));
    };
  }, [board, cell, pixels]);

  return (
    <div ref={host} className="sliding-puzzle-centre">
      <div
        ref={surface}
        role="group"
        aria-label={t`数字华容道棋盘`}
        className="sliding-puzzle-board"
        style={
          {
            width: pixels,
            height: pixels,
            "--puzzle-cell": `${cell}px`,
            "--puzzle-wood": wood ? `url(${wood})` : undefined,
          } as CSSProperties
        }
      >
        {Array.from({ length: board.size ** 2 }, (_, tile) => {
          const index = board.tiles.indexOf(tile);
          const row = Math.floor(index / board.size) + 1,
            column = (index % board.size) + 1;
          const movable = !disabled && canMove(board, tile);
          const label =
            tile === 0
              ? t`空位，第 ${row} 行，第 ${column} 列`
              : movable
                ? t`数字 ${tile}，第 ${row} 行，第 ${column} 列，可移动`
                : t`数字 ${tile}，第 ${row} 行，第 ${column} 列，不可移动`;
          return (
            // 数字块属于实物棋盘内容，其格子本身承担不重叠的触控热区。
            <button
              key={tile}
              type="button"
              data-tile={tile}
              data-movable={movable}
              className="sliding-puzzle-tile"
              aria-label={label}
              aria-disabled={!movable}
              tabIndex={focused === tile ? 0 : -1}
              onFocus={() => setFocused(tile)}
              onClick={() => {
                if (movable) onMove(tile);
              }}
              onKeyDown={(event) => {
                if (!event.key.startsWith("Arrow")) return;
                event.preventDefault();
                const next = focusNeighbor(index, board.size, event.key);
                surface.current
                  ?.querySelector<HTMLButtonElement>(
                    `[data-tile="${board.tiles[next]}"]`,
                  )
                  ?.focus();
              }}
            >
              {tile === 0 ? null : <span aria-hidden="true">{tile}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
