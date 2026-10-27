import { Graphics } from "pixi.js";

import { isCamp } from "../board";
import type { ViewBoard } from "../view-types";
import { cellPosition } from "./geometry";

export interface BoardMarks {
  accentColor: number;
  selected: number | null;
  targets: number[];
  hovered: number | null;
  focused: number | null;
  deployment: boolean;
  lastMove: { from: number; to: number } | null;
}

export function drawMarks(
  layer: Graphics,
  marks: BoardMarks,
  board: ViewBoard,
  flipped: boolean,
  landscape: boolean,
) {
  layer.clear();
  const color = marks.accentColor;

  const position = (index: number) => {
    const p = cellPosition(index, flipped, landscape);
    return { x: p.x, y: -p.y };
  };

  const corners = (
    index: number,
    alpha: number,
    ink = color,
    width = 0.021,
  ) => {
    const { x, y } = position(index);
    const dx = landscape ? 0.35 : 0.53,
      dy = landscape ? 0.54 : 0.34;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        layer.moveTo(x + sx * (dx - 0.12), y + sy * dy);
        layer.lineTo(x + sx * dx, y + sy * dy);
        layer.lineTo(x + sx * dx, y + sy * (dy - 0.12));
      }
    layer.stroke({ color: ink, width, alpha, cap: "round", join: "round" });
  };

  const ring = (x: number, y: number, radius: number) => {
    // 世界坐标小于 1；显式细分避免 Pixi 按本地尺度将圆降为菱形。
    for (let step = 0; step < 48; step++) {
      const angle = (step / 48) * Math.PI * 2;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (step === 0) layer.moveTo(px, py);
      else layer.lineTo(px, py);
    }
    layer.closePath();
    return layer;
  };

  if (marks.lastMove && marks.selected === null) {
    const p = position(marks.lastMove.from);
    ring(p.x, p.y, 0.075).stroke({ color, width: 0.02, alpha: 0.7 });
    corners(marks.lastMove.to, 0.5, color, 0.017);
  }
  // 布阵时不为每个可交换棋子叠加标记，只提示当前指向的目标。
  if (!marks.deployment)
    for (const index of marks.targets) {
      if (board[index]) corners(index, 0.75);
      else {
        const p = position(index);
        ring(p.x, p.y, isCamp(index) ? 0.27 : 0.15).stroke({
          color,
          width: 0.022,
          alpha: 0.85,
        });
      }
    }
  if (marks.hovered !== null && marks.hovered !== marks.selected)
    corners(marks.hovered, marks.targets.includes(marks.hovered) ? 0.9 : 0.4);
  if (marks.selected !== null && marks.selected !== marks.focused)
    corners(marks.selected, 1, color, 0.027);
  if (marks.focused !== null) {
    const p = position(marks.focused);
    // 键盘焦点使用完整细轮廓，与鼠标选择的四角形状区分。
    layer
      .roundRect(p.x - 0.47, p.y - 0.49, 0.94, 0.98, 0.05)
      .stroke({ color, width: 0.019, alpha: 0.95 });
  }
}
