/**
 * 围棋棋盘的 Pixi 渲染与交互。
 *
 * 架构与 gomoku 舞台相同：棋盘完全在画布内，几何由 CELL 推导，纹理
 * 模块级缓存，React 只透传 props。与 gomoku 不同的是网格尺寸 N 是个
 * 属性（9/13/19），因此所有几何都在 createScene 内按场景计算。被提的
 * 棋子先缩小再移除。
 */
import { useEffect, useRef } from "react";
import {
  Application,
  Container,
  Graphics,
  Sprite,
  type FederatedPointerEvent,
} from "pixi.js";
import gsap from "gsap";
import type { SeatIndex } from "../engine/types";
import {
  getBoardTexture,
  getStoneTextures,
  STONE_CY,
  STONE_R,
  STONE_TEX,
  WOOD_FULL,
  WOOD_TEX,
} from "./texture-utils";
import type { BoardSize, GoMove, Stone } from "./types";

/** 相邻两线之间的距离。其余几何都由它推导。 */
const CELL = 40;

export interface GoStageProps {
  boardSize: BoardSize;
  board: Stone[];
  lastMove: GoMove | null;
  /** 悬停虚影预览的棋子所属座位。 */
  ghostSeat: SeatIndex;
  /** 本地玩家此时可以落子。 */
  interactive: boolean;
  /** 当前玩家的合法交叉点，按行主序索引。 */
  legalPoints: readonly boolean[];
  onPlay(move: GoMove): void;
}

interface SceneState {
  board: Stone[];
  lastMove: GoMove | null;
  ghostSeat: SeatIndex;
  interactive: boolean;
  legalPoints: readonly boolean[];
}

interface Scene {
  setState(state: SceneState): void;
  destroy(): void;
}

/** 各棋盘尺寸对应的传统星位。 */
function starPoints(n: BoardSize): Array<[number, number]> {
  if (n === 9) {
    return [
      [2, 2],
      [2, 6],
      [4, 4],
      [6, 2],
      [6, 6],
    ];
  }
  const low = 3;
  const high = n - 4;
  const mid = (n - 1) / 2;
  const points: Array<[number, number]> = [
    [low, low],
    [low, high],
    [high, low],
    [high, high],
  ];
  if (n === 19) {
    points.push([low, mid], [mid, low], [mid, mid], [mid, high], [high, mid]);
  }
  return points;
}

function createScene(
  app: Application,
  n: BoardSize,
  callbacks: { onPlay(move: GoMove): void },
): Scene {
  const GRID = CELL * (n - 1);
  const MARGIN = CELL * 0.85;
  const BOARD = GRID + MARGIN * 2;
  const FIT_EXTENT = BOARD + CELL * 1.6;
  const STONE_DIAMETER = CELL * 0.96;
  const half = GRID / 2;
  const lineAt = (i: number): number => i * CELL - half;

  const stoneTexture = getStoneTextures();

  const root = new Container();
  app.stage.addChild(root);

  // --- 静态棋盘 ---------------------------------------------------
  const boardSprite = new Sprite(getBoardTexture());
  boardSprite.anchor.set(0.5);
  const spriteSize = BOARD * (WOOD_FULL / WOOD_TEX);
  boardSprite.width = spriteSize;
  boardSprite.height = spriteSize;
  root.addChild(boardSprite);

  const grid = new Graphics();
  for (let i = 1; i < n - 1; i++) {
    const p = lineAt(i);
    grid.moveTo(-half, p).lineTo(half, p);
    grid.moveTo(p, -half).lineTo(p, half);
  }
  grid.stroke({
    width: Math.max(1.2, CELL * 0.033),
    color: 0x45260c,
    alpha: 0.9,
  });
  // 传统棋盘用更粗的边线框住网格。
  grid.rect(-half, -half, GRID, GRID).stroke({
    width: Math.max(2.2, CELL * 0.062),
    color: 0x45260c,
    alpha: 0.95,
  });
  for (const [row, col] of starPoints(n)) {
    grid.circle(lineAt(col), lineAt(row), CELL * 0.09).fill({
      color: 0x38200a,
      alpha: 0.95,
    });
  }
  root.addChild(grid);

  // --- 动态图层 -------------------------------------------------
  const stoneLayer = new Container();
  const markerLayer = new Graphics();
  const ghost = new Sprite(stoneTexture[0]);
  ghost.anchor.set(0.5, STONE_CY / STONE_TEX);
  ghost.width = STONE_DIAMETER * (STONE_TEX / (STONE_R * 2));
  ghost.height = ghost.width;
  ghost.alpha = 0.35;
  ghost.visible = false;
  root.addChild(stoneLayer, markerLayer, ghost);

  const stones = new Map<number, Sprite>();
  let state: SceneState = {
    board: [],
    lastMove: null,
    ghostSeat: 0,
    interactive: false,
    legalPoints: [],
  };
  /** 同步首帧快照时跳过落子弹出动画。 */
  let synced = false;
  let hoverIndex: number | null = null;

  function addStone(index: number, seat: SeatIndex, animate: boolean): void {
    const sprite = new Sprite(stoneTexture[seat]);
    // 锚定在棋子圆中心，使其正好落在交叉点上，而烘焙的阴影悬于下方。
    sprite.anchor.set(0.5, STONE_CY / STONE_TEX);
    sprite.width = STONE_DIAMETER * (STONE_TEX / (STONE_R * 2));
    sprite.height = sprite.width;
    sprite.position.set(lineAt(index % n), lineAt(Math.floor(index / n)));
    stoneLayer.addChild(sprite);
    stones.set(index, sprite);
    if (animate) {
      const target = sprite.scale.x;
      sprite.scale.set(target * 0.55);
      gsap.to(sprite.scale, {
        x: target,
        y: target,
        duration: 0.18,
        ease: "back.out(2)",
      });
    }
  }

  function removeStone(index: number, sprite: Sprite, animate: boolean): void {
    stones.delete(index);
    if (!animate) {
      gsap.killTweensOf(sprite.scale);
      sprite.destroy();
      return;
    }
    gsap.to(sprite.scale, {
      x: 0,
      y: 0,
      duration: 0.22,
      ease: "power2.in",
      onComplete: () => sprite.destroy(),
    });
  }

  function redrawMarkers(): void {
    markerLayer.clear();
    const last = state.lastMove;
    if (last?.kind === "play") {
      const seat = state.board[last.row * n + last.col];
      if (seat !== null) {
        markerLayer
          .circle(lineAt(last.col), lineAt(last.row), CELL * 0.1)
          .fill(
            seat === 0
              ? { color: 0xffffff, alpha: 0.85 }
              : { color: 0x000000, alpha: 0.6 },
          );
      }
    }
  }

  function redrawGhost(): void {
    const index = hoverIndex;
    const show =
      state.interactive && index !== null && state.legalPoints[index] === true;
    ghost.visible = show;
    if (show && index !== null) {
      ghost.texture = stoneTexture[state.ghostSeat] ?? stoneTexture[0];
      ghost.position.set(lineAt(index % n), lineAt(Math.floor(index / n)));
    }
    app.canvas.style.cursor = show ? "pointer" : "default";
  }

  // --- 布局 -------------------------------------------------------
  function relayout(): void {
    const w = app.screen.width;
    const h = app.screen.height;
    root.position.set(w / 2, h / 2);
    root.scale.set(Math.min(w, h) / FIT_EXTENT);
  }
  relayout();
  app.renderer.on("resize", relayout);

  // --- 输入 -------------------------------------------------------
  app.stage.eventMode = "static";
  app.stage.hitArea = { contains: () => true };

  function toIntersection(e: FederatedPointerEvent): number | null {
    const p = root.toLocal(e.global);
    const col = Math.round((p.x + half) / CELL);
    const row = Math.round((p.y + half) / CELL);
    if (col < 0 || col >= n || row < 0 || row >= n) return null;
    if (
      Math.abs(p.x - lineAt(col)) > CELL * 0.55 ||
      Math.abs(p.y - lineAt(row)) > CELL * 0.55
    ) {
      return null;
    }
    return row * n + col;
  }

  app.stage.on("pointermove", (e: FederatedPointerEvent) => {
    hoverIndex = toIntersection(e);
    redrawGhost();
  });
  const clearHover = (): void => {
    hoverIndex = null;
    redrawGhost();
  };
  app.stage.on("pointerleave", clearHover);
  app.stage.on("pointercancel", clearHover);
  app.stage.on("pointertap", (e: FederatedPointerEvent) => {
    if (!state.interactive) return;
    const index = toIntersection(e);
    if (index === null || state.legalPoints[index] !== true) return;
    callbacks.onPlay({
      kind: "play",
      row: Math.floor(index / n),
      col: index % n,
    });
  });

  return {
    setState(next) {
      state = next;
      const lastIndex =
        next.lastMove?.kind === "play"
          ? next.lastMove.row * n + next.lastMove.col
          : null;
      for (const [index, sprite] of stones) {
        if (next.board[index] === null) {
          // 被提的棋子缩小消失；悔掉的棋子立即消失。
          removeStone(index, sprite, synced);
        }
      }
      next.board.forEach((seat, index) => {
        if (seat === null || stones.has(index)) return;
        addStone(index, seat, synced && index === lastIndex);
      });
      synced = true;
      redrawMarkers();
      redrawGhost();
    },
    destroy() {
      for (const sprite of stones.values()) gsap.killTweensOf(sprite.scale);
      app.renderer.off("resize", relayout);
    },
  };
}

export function GoStage(props: GoStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const propsRef = useRef(props);
  // 最新值 ref 在 effect 中同步，而非渲染期间。
  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    let disposed = false;
    let app: Application | null = null;

    void (async () => {
      const nextApp = new Application();
      await nextApp.init({
        antialias: true,
        backgroundAlpha: 0,
        resolution: Math.min(window.devicePixelRatio || 1, 3),
        autoDensity: true,
        resizeTo: host,
      });
      if (disposed) {
        nextApp.destroy(true);
        return;
      }
      app = nextApp;
      host.appendChild(nextApp.canvas);
      const scene = createScene(nextApp, propsRef.current.boardSize, {
        onPlay: (move) => propsRef.current.onPlay(move),
      });
      sceneRef.current = scene;
      const current = propsRef.current;
      scene.setState({
        board: current.board,
        lastMove: current.lastMove,
        ghostSeat: current.ghostSeat,
        interactive: current.interactive,
        legalPoints: current.legalPoints,
      });
    })();

    return () => {
      disposed = true;
      sceneRef.current?.destroy();
      sceneRef.current = null;
      app?.destroy(true, { children: true });
    };
    // boardSize 在每个已挂载舞台内固定（缩放会更换 match key）。
  }, []);

  useEffect(() => {
    sceneRef.current?.setState({
      board: props.board,
      lastMove: props.lastMove,
      ghostSeat: props.ghostSeat,
      interactive: props.interactive,
      legalPoints: props.legalPoints,
    });
  }, [
    props.board,
    props.lastMove,
    props.ghostSeat,
    props.interactive,
    props.legalPoints,
  ]);

  return <div ref={containerRef} className="h-full w-full touch-none" />;
}
