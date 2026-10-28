import { Chess, type PieceSymbol, type Square } from "chess.js";
import { type Camera, type Mesh, Vector3 } from "three";

/** 名称是阅读辅助，投影到格内留白；不改变实体模型，也不占布局空间。 */
export function createPieceLabels(host: HTMLElement) {
  const layer = document.createElement("div");
  layer.className = "chess-piece-labels";
  layer.setAttribute("aria-hidden", "true");
  host.appendChild(layer);
  const labels = new Map<Square, HTMLSpanElement>();
  let signature = "";

  function sync(fen: string, names: Record<PieceSymbol, string> | null) {
    const next = JSON.stringify([fen, names]);
    if (next === signature) return;
    signature = next;
    layer.replaceChildren();
    labels.clear();
    if (!names) return;
    for (const row of new Chess(fen).board())
      for (const piece of row) {
        if (!piece) continue;
        const label = document.createElement("span");
        label.className = "chess-piece-label";
        label.textContent = names[piece.type];
        const file = piece.square.charCodeAt(0) - 97;
        label.dataset.squareTone =
          (file + Number(piece.square[1])) % 2 === 0 ? "light" : "dark";
        labels.set(piece.square, label);
        layer.appendChild(label);
      }
  }

  function place(
    camera: Camera,
    pieces: Map<Square, Mesh>,
    hidden: boolean,
    flipped: boolean,
  ) {
    layer.hidden = hidden;
    if (hidden || !labels.size) return;
    const width = host.clientWidth,
      height = host.clientHeight;
    const centre = new Vector3(0, 0, 0).project(camera);
    const edge = new Vector3(1, 0, 0).project(camera);
    const squareSize = (Math.abs(edge.x - centre.x) * width) / 2;
    layer.style.fontSize = `${Math.max(9, Math.min(13, squareSize * 0.23))}px`;
    for (const [square, label] of labels) {
      const mesh = pieces.get(square);
      if (!mesh) {
        label.hidden = true;
        continue;
      }
      label.hidden = false;
      const point = new Vector3(
        mesh.position.x,
        0.015,
        mesh.position.z + (flipped ? -0.41 : 0.41),
      ).project(camera);
      label.style.left = `${((point.x + 1) * width) / 2}px`;
      label.style.top = `${((1 - point.y) * height) / 2}px`;
    }
  }

  return { sync, place, dispose: () => layer.remove() };
}
