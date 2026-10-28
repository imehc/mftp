import gsap from "gsap";
import { Application, Container, Graphics, Sprite } from "pixi.js";

import { createReversiTextures } from "./textures";
import type { ReversiState, Stone } from "./types";

const BOARD = 800;
const CELL = (BOARD * 0.88) / 8;
const RADIUS = CELL * 0.395;
const at = (index: number) => BOARD * 0.06 + (index + 0.5) * CELL;

interface Disc {
  root: Container;
  face: Sprite;
  side: Graphics;
  shadow: Sprite;
  angle: number;
  lift: number;
  seat: Stone;
  tween?: gsap.core.Tween;
}

/** 与五子棋共用 PixiJS 路径；静态纹理只生成一次，翻转期间按需重绘。 */
export async function createReversiScene(canvas: HTMLCanvasElement) {
  const app = new Application();
  await app.init({
    canvas,
    preference: "webgl",
    antialias: true,
    backgroundAlpha: 0,
    resolution: Math.min(devicePixelRatio || 1, 2),
    autoDensity: false,
    autoStart: false,
  });
  let textures: ReturnType<typeof createReversiTextures> | undefined;
  try {
    textures = createReversiTextures();
    return initialize(textures);
  } catch (error) {
    if (textures)
      Object.values(textures).forEach((texture) => texture.destroy(true));
    app.destroy(false, { children: true });
    throw error;
  }

  function initialize(images: ReturnType<typeof createReversiTextures>) {
    const root = new Container();
    root.eventMode = "none";
    app.stage.addChild(root);
    const board = new Sprite(images.board);
    board.width = board.height = BOARD;
    root.addChild(board);
    const shadowLayer = new Container();
    const discLayer = new Container();
    const marker = new Graphics();
    root.addChild(shadowLayer, discLayer, marker);
    const discs: Disc[] = [];
    let previous: ReversiState | null = null;
    let frame: number | null = null;
    let disposed = false;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const render = () => {
      frame = null;
      if (!disposed && !document.hidden) app.render();
    };

    const invalidate = () => {
      if (frame === null && !disposed && !document.hidden)
        frame = requestAnimationFrame(render);
    };

    for (let index = 0; index < 64; index++) {
      const body = new Container();
      body.position.set(at(index % 8), at(Math.floor(index / 8)));
      body.visible = false;
      const side = new Graphics();
      const face = new Sprite(images.black);
      face.anchor.set(0.5);
      const shadow = new Sprite(images.shadow);
      shadow.anchor.set(0.5);
      shadow.position.set(body.x + 1.5, body.y + 4);
      shadow.visible = false;
      shadowLayer.addChild(shadow);
      body.addChild(side, face);
      discLayer.addChild(body);
      discs.push({
        root: body,
        face,
        side,
        shadow,
        angle: 0,
        lift: 0,
        seat: null,
      });
    }

    const paintDisc = (disc: Disc) => {
      const cosine = Math.cos(disc.angle);
      const sine = Math.abs(Math.sin(disc.angle));
      const visibleSeat = cosine >= 0 ? 0 : 1;
      const radiusY = Math.max(0.003, Math.abs(cosine)) * RADIUS;
      const thickness = 2 + sine * RADIUS * 0.18;
      const top = -sine * RADIUS * 0.09 - disc.lift;
      disc.face.texture = visibleSeat === 0 ? images.black : images.white;
      disc.face.width = (RADIUS * 2 * 256) / 224;
      disc.face.height = (radiusY * 2 * 256) / 224;
      disc.face.y = top;
      // 正面转到侧面时显示双面棋子的实体侧壁，而不是把整张图压成一条线。
      disc.side.clear();
      disc.side
        .ellipse(0, top + thickness, RADIUS, radiusY)
        .fill(visibleSeat === 0 ? 0x9ba596 : 0x101b13);
      disc.side
        .rect(-RADIUS, top, RADIUS * 2, thickness)
        .fill(visibleSeat === 0 ? 0x39443a : 0xa9b3a1);
      disc.side
        .ellipse(0, top, RADIUS, radiusY)
        .fill(visibleSeat === 0 ? 0x1c291f : 0xc2cab9);
      disc.shadow.width = disc.shadow.height = RADIUS * (2.8 + sine * 0.35);
      disc.shadow.alpha = 0.9 - sine * 0.3;
      invalidate();
    };

    const finishAnimations = () => {
      for (const disc of discs) disc.tween?.progress(1).kill();
      invalidate();
    };

    const visibilityChanged = () => {
      if (document.hidden) finishAnimations();
      else invalidate();
    };

    document.addEventListener("visibilitychange", visibilityChanged);
    motion.addEventListener("change", finishAnimations);
    return {
      resize(size: number) {
        const edge = Math.max(1, size);
        app.renderer.resize(edge, edge);
        root.scale.set(edge / BOARD);
        invalidate();
      },
      sync(state: ReversiState) {
        const animate =
          previous !== null && !motion.matches && !document.hidden;
        discs.forEach((disc, index) => {
          const seat = state.board[index];
          if (seat === disc.seat) return;
          disc.tween?.kill();
          const wasEmpty = disc.seat === null;
          disc.seat = seat;
          disc.root.visible = disc.shadow.visible = seat !== null;
          if (seat === null) return;
          const targetAngle = seat * Math.PI;
          const from = wasEmpty ? targetAngle : disc.angle;
          const fromLift = wasEmpty ? 5 : disc.lift;
          const progress = { value: animate ? 0 : 1 };

          const update = () => {
            const p = progress.value;
            disc.angle = from + (targetAngle - from) * p;
            disc.lift =
              fromLift * (1 - p) + (wasEmpty ? 0 : Math.sin(Math.PI * p) * 5);
            paintDisc(disc);
          };

          update();
          const distance = state.lastMove
            ? Math.max(
                Math.abs((index % 8) - state.lastMove.col),
                Math.abs(Math.floor(index / 8) - state.lastMove.row),
              )
            : 0;
          if (animate)
            disc.tween = gsap.to(progress, {
              value: 1,
              duration: wasEmpty ? 0.18 : 0.34,
              delay: wasEmpty ? 0 : Math.min(0.1, distance * 0.025),
              ease: wasEmpty ? "power2.out" : "power2.inOut",
              onUpdate: update,
            });
        });
        marker.clear();
        if (state.lastMove)
          marker
            .circle(
              at(state.lastMove.col),
              at(state.lastMove.row),
              CELL * 0.047,
            )
            .fill(0xcbaa62);
        previous = state;
        invalidate();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        if (frame !== null) cancelAnimationFrame(frame);
        for (const disc of discs) disc.tween?.kill();
        document.removeEventListener("visibilitychange", visibilityChanged);
        motion.removeEventListener("change", finishAnimations);
        app.destroy(false, { children: true });
        Object.values(images).forEach((texture) => texture.destroy(true));
      },
    };
  }
}

export type ReversiScene = Awaited<ReturnType<typeof createReversiScene>>;
