import gsap from "gsap";
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";

import { prefersReducedMotion } from "~/lib/motion";

import type { PieceKind } from "../types";
import type { ViewBoard } from "../view-types";
import { BOARD_HEIGHT, BOARD_WIDTH, cellPosition, viewSize } from "./geometry";
import { type BoardMarks, drawMarks } from "./marks";
import { pieceTexture } from "./piece-texture";
import { boardShadow, boardTexture } from "./textures";

export interface SceneLabels {
  pieces: Record<PieceKind, string>;
  camp: string;
  headquarters: string;
  font: string;
}

export async function createJunqiScene(
  canvas: HTMLCanvasElement,
  labels: SceneLabels,
  landscape: boolean,
) {
  const app = new Application();
  await app.init({
    canvas,
    antialias: true,
    backgroundAlpha: 0,
    resolution: Math.min(window.devicePixelRatio, 2),
    autoDensity: false,
    autoStart: false,
    preference: "webgl",
  });
  // 输入由可访问的 DOM 棋位处理，画布不截获移动端滚动。
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.touchAction = "auto";
  app.stage.eventMode = "none";
  const size = viewSize(landscape);
  const root = new Container();
  app.stage.addChild(root);
  const textures: Texture[] = [];

  const makeTexture = (source: HTMLCanvasElement) => {
    const tex = Texture.from(source);
    textures.push(tex);
    return tex;
  };

  const width = landscape ? BOARD_HEIGHT : BOARD_WIDTH;
  const height = landscape ? BOARD_WIDTH : BOARD_HEIGHT;
  const shadow = new Sprite(makeTexture(boardShadow(landscape)));
  shadow.anchor.set(0.5);
  shadow.width = width + 0.24;
  shadow.height = height + 0.24;
  root.addChild(shadow);
  const board = new Sprite(
    makeTexture(
      boardTexture(labels.camp, labels.headquarters, labels.font, landscape),
    ),
  );
  board.anchor.set(0.5);
  board.width = width;
  board.height = height;
  root.addChild(board);
  const pieceLayer = new Container();
  const marksLayer = new Graphics();
  root.addChild(pieceLayer, marksLayer);
  const cache = new Map<string, Texture>();
  const pieces = new Map<string, Sprite>();
  const appearances = new Map<string, string>();
  let disposed = false,
    frame = 0,
    visible = !document.hidden;

  function draw() {
    frame = 0;
    if (!disposed && visible) app.render();
  }

  function invalidate() {
    if (!frame && !disposed && visible) frame = requestAnimationFrame(draw);
  }

  function setBoard(position: ViewBoard, flipped: boolean, animate: boolean) {
    const present = new Set<string>();
    position.forEach((piece, index) => {
      if (!piece) return;
      present.add(piece.id);
      const p = cellPosition(index, flipped, landscape);
      const cacheKey = `${piece.side}:${piece.face === "known" ? piece.kind : "covered"}`;
      let sprite = pieces.get(piece.id);
      if (sprite && appearances.get(piece.id) !== cacheKey) {
        gsap.killTweensOf(sprite.position);
        sprite.destroy();
        pieces.delete(piece.id);
        sprite = undefined;
      }
      if (!sprite) {
        let texture = cache.get(cacheKey);
        if (!texture) {
          texture = makeTexture(
            pieceTexture(
              piece.face === "known" ? labels.pieces[piece.kind] : "",
              piece.side,
              labels.font,
              123 + index * 41,
              landscape,
            ),
          );
          cache.set(cacheKey, texture);
        }
        sprite = new Sprite(texture);
        sprite.anchor.set(0.5, landscape ? 179 / 384 : 115 / 256);
        sprite.width = landscape ? 0.8 : 1.2;
        sprite.height = landscape ? 1.2 : 0.8;
        sprite.position.set(p.x, -p.y);
        pieceLayer.addChild(sprite);
        pieces.set(piece.id, sprite);
        appearances.set(piece.id, cacheKey);
      }
      gsap.killTweensOf(sprite.position);
      if (
        animate &&
        visible &&
        !prefersReducedMotion() &&
        (sprite.x !== p.x || sprite.y !== -p.y)
      ) {
        pieceLayer.setChildIndex(sprite, pieceLayer.children.length - 1);
        gsap.to(sprite.position, {
          x: p.x,
          y: -p.y,
          duration: 0.16,
          ease: "power2.out",
          onUpdate: invalidate,
        });
      } else sprite.position.set(p.x, -p.y);
    });
    for (const [id, sprite] of pieces)
      if (!present.has(id)) {
        gsap.killTweensOf(sprite.position);
        sprite.destroy();
        pieces.delete(id);
        appearances.delete(id);
      }
    invalidate();
  }

  return {
    setBoard,
    setMarks(marks: BoardMarks, position: ViewBoard, flipped: boolean) {
      drawMarks(marksLayer, marks, position, flipped, landscape);
      invalidate();
    },
    resize(width: number, height: number) {
      app.renderer.resize(width, height);
      root.position.set(width / 2, height / 2);
      root.scale.set(width / size.width, height / size.height);
      invalidate();
    },
    foreground(next: boolean) {
      visible = next;
      if (!next && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else invalidate();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      for (const sprite of pieces.values()) gsap.killTweensOf(sprite.position);
      app.destroy(false, { children: true });
      for (const texture of textures) texture.destroy(true);
      pieces.clear();
      cache.clear();
      appearances.clear();
    },
  };
}
