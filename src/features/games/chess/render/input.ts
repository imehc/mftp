import { Chess, type Square } from "chess.js";

import type { ChessState } from "../types";
import type { ChessScene } from "./scene";

interface InputState {
  state: ChessState;
  interactive: boolean;
  onSquare(square: Square): void;
  onDrop(from: Square, to: Square): void;
}

/** 鼠标拖子与触屏点选分开；触屏仍把纵向手势交给页面滚动。 */
export function bindChessInput(scene: ChessScene, current: () => InputState) {
  let start: {
    square: Square;
    x: number;
    y: number;
    id: number;
    fen: string;
    draggable: boolean;
    dragged: boolean;
  } | null = null;
  const canvas = scene.canvas;

  function cancel() {
    if (start && canvas.hasPointerCapture(start.id))
      canvas.releasePointerCapture(start.id);
    start = null;
    canvas.style.cursor = "";
    scene.cancelDrag();
  }

  function down(event: PointerEvent) {
    const props = current();
    if (
      event.button !== 0 ||
      !props.interactive ||
      scene.busy ||
      document.querySelector(
        '[data-slot="dialog-overlay"],[data-slot="alert-dialog-overlay"],[data-slot="popover-content"]',
      )
    )
      return;
    const square = scene.hit(event.clientX, event.clientY);
    if (!square) return;
    const chess = new Chess(props.state.fen);
    start = {
      square,
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      fen: props.state.fen,
      draggable:
        event.pointerType === "mouse" &&
        chess.get(square)?.color === chess.turn(),
      dragged: false,
    };
    if (event.pointerType === "mouse")
      canvas.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent) {
    if (!start || start.id !== event.pointerId || !start.draggable) return;
    if (
      !current().interactive ||
      current().state.fen !== start.fen ||
      scene.busy
    ) {
      cancel();
      return;
    }
    if (
      Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 6 &&
      !start.dragged
    )
      return;
    start.dragged = true;
    canvas.style.cursor = "grabbing";
    scene.drag(start.square, event.clientX, event.clientY);
  }

  function up(event: PointerEvent) {
    const first = start;
    const end = scene.hit(event.clientX, event.clientY);
    cancel();
    const props = current();
    if (
      !first ||
      first.id !== event.pointerId ||
      !end ||
      scene.busy ||
      !props.interactive ||
      props.state.fen !== first.fen
    )
      return;
    if (first.dragged && end !== first.square) props.onDrop(first.square, end);
    else if (Math.hypot(event.clientX - first.x, event.clientY - first.y) <= 6)
      props.onSquare(end);
  }

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
  return () => {
    cancel();
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel);
  };
}
