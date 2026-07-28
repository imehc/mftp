/** Pixi-rendered xiangqi board, pieces, markers, and pointer interaction. */
import { useEffect, useRef, useState } from "react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  type FederatedPointerEvent,
} from "pixi.js";
import gsap from "gsap";
import { boardCoordinate } from "./rules";
import {
  BOARD_SURFACE_HEIGHT,
  BOARD_SURFACE_WIDTH,
  BOARD_TEXTURE_HEIGHT,
  BOARD_TEXTURE_WIDTH,
  getXiangqiBoardTexture,
  getXiangqiPieceTexture,
  PIECE_CENTER,
  PIECE_RADIUS,
  PIECE_TEXTURE_SIZE,
} from "./texture-utils";
import type { XiangqiMove, XiangqiPiece } from "./types";

const CELL = 72;
const GRID_WIDTH = CELL * 8;
const GRID_HEIGHT = CELL * 9;
const BOARD_WIDTH = GRID_WIDTH + CELL * 1.55;
const BOARD_HEIGHT = GRID_HEIGHT + CELL * 1.55;
const FIT_WIDTH = BOARD_WIDTH + CELL * 1.25;
const FIT_HEIGHT = BOARD_HEIGHT + CELL * 1.35;
const PIECE_DIAMETER = CELL * 0.86;
const FALLBACK_ACCENT = 0x1d7561;

const PIECE_SYMBOL: Record<number, Record<XiangqiPiece["kind"], string>> = {
  0: { general: "帅", advisor: "仕", elephant: "相", horse: "马", rook: "车", cannon: "炮", soldier: "兵" },
  1: { general: "将", advisor: "士", elephant: "象", horse: "马", rook: "车", cannon: "炮", soldier: "卒" },
};

export interface XiangqiStageProps {
  board: readonly (XiangqiPiece | null)[];
  turnSeat: number;
  legalMoves: readonly XiangqiMove[];
  lastMove: XiangqiMove | null;
  inCheck: boolean;
  interactive: boolean;
  flipped: boolean;
  onPlay(move: XiangqiMove): void;
}

interface SceneState extends Omit<XiangqiStageProps, "onPlay"> {
  accentColor: number;
}

interface PieceView {
  container: Container;
  identity: string;
}

interface Scene {
  setState(state: SceneState): void;
  destroy(): void;
}

function displayCoordinate(index: number, flipped: boolean): { x: number; y: number } {
  const { row, col } = boardCoordinate(index);
  const displayRow = flipped ? 9 - row : row;
  const displayCol = flipped ? 8 - col : col;
  return {
    x: displayCol * CELL - GRID_WIDTH / 2,
    y: displayRow * CELL - GRID_HEIGHT / 2,
  };
}

function resolvePrimaryColor(): number {
  if (typeof document === "undefined") return FALLBACK_ACCENT;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || !value) return FALLBACK_ACCENT;
  context.fillStyle = "#1d7561";
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return (red << 16) | (green << 8) | blue;
}

function drawGrid(): Graphics {
  const highlight = new Graphics();
  const dark = new Graphics();
  const halfWidth = GRID_WIDTH / 2;
  const halfHeight = GRID_HEIGHT / 2;

  const drawLines = (graphics: Graphics, offset: number): void => {
    for (let row = 0; row < 10; row++) {
      const y = row * CELL - halfHeight + offset;
      graphics.moveTo(-halfWidth + offset, y).lineTo(halfWidth + offset, y);
    }
    for (let col = 0; col < 9; col++) {
      const x = col * CELL - halfWidth + offset;
      if (col === 0 || col === 8) {
        graphics.moveTo(x, -halfHeight + offset).lineTo(x, halfHeight + offset);
      } else {
        graphics.moveTo(x, -halfHeight + offset).lineTo(x, -CELL / 2 + offset);
        graphics.moveTo(x, CELL / 2 + offset).lineTo(x, halfHeight + offset);
      }
    }
    graphics
      .moveTo(-CELL + offset, -halfHeight + offset)
      .lineTo(CELL + offset, -halfHeight + CELL * 2 + offset)
      .moveTo(CELL + offset, -halfHeight + offset)
      .lineTo(-CELL + offset, -halfHeight + CELL * 2 + offset)
      .moveTo(-CELL + offset, halfHeight - CELL * 2 + offset)
      .lineTo(CELL + offset, halfHeight + offset)
      .moveTo(CELL + offset, halfHeight - CELL * 2 + offset)
      .lineTo(-CELL + offset, halfHeight + offset);
  };

  drawLines(highlight, 1.5);
  highlight.stroke({ width: 2.2, color: 0xf5ce87, alpha: 0.28 });
  drawLines(dark, 0);
  dark.stroke({ width: 2.15, color: 0x3d1e0b, alpha: 0.9 });

  const marks = new Graphics();
  const markPoints: Array<[number, number]> = [
    [2, 1], [2, 7], [7, 1], [7, 7],
    [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
    [6, 0], [6, 2], [6, 4], [6, 6], [6, 8],
  ];
  const gap = 7;
  const arm = 10;
  for (const [row, col] of markPoints) {
    const x = col * CELL - halfWidth;
    const y = row * CELL - halfHeight;
    for (const side of [-1, 1]) {
      if ((col === 0 && side < 0) || (col === 8 && side > 0)) continue;
      const innerX = x + side * gap;
      const outerX = x + side * (gap + arm);
      marks
        .moveTo(innerX, y - gap - arm)
        .lineTo(innerX, y - gap)
        .lineTo(outerX, y - gap)
        .moveTo(innerX, y + gap + arm)
        .lineTo(innerX, y + gap)
        .lineTo(outerX, y + gap);
    }
  }
  marks.stroke({ width: 2.1, color: 0x3d1e0b, alpha: 0.88 });

  const group = new Graphics();
  group.addChild(highlight, dark, marks);
  return group;
}

function createRiverLabel(text: string, x: number): Text {
  const label = new Text({
    text,
    style: new TextStyle({
      fontFamily: '"STKaiti", "KaiTi", "FangSong", serif',
      fontSize: 28,
      fontWeight: "600",
      fill: 0x4b2610,
      letterSpacing: 7,
      stroke: { color: 0xdcae64, width: 1 },
    }),
  });
  label.anchor.set(0.5);
  label.position.set(x, 0);
  label.alpha = 0.88;
  return label;
}

function createScene(
  app: Application,
  labels: { riverChu: string; riverHan: string; board: string },
  callbacks: { onPlay(move: XiangqiMove): void },
): Scene {
  app.canvas.setAttribute("role", "application");
  app.canvas.setAttribute("aria-label", labels.board);
  const root = new Container();
  app.stage.addChild(root);

  const board = new Sprite(getXiangqiBoardTexture());
  board.anchor.set(0.5);
  board.width = BOARD_WIDTH * (BOARD_TEXTURE_WIDTH / BOARD_SURFACE_WIDTH);
  board.height = BOARD_HEIGHT * (BOARD_TEXTURE_HEIGHT / BOARD_SURFACE_HEIGHT);
  root.addChild(board, drawGrid());
  root.addChild(
    createRiverLabel(labels.riverChu, -GRID_WIDTH * 0.25),
    createRiverLabel(labels.riverHan, GRID_WIDTH * 0.25),
  );

  const lastMoveLayer = new Graphics();
  const targetLayer = new Graphics();
  const selectionLayer = new Graphics();
  const checkLayer = new Graphics();
  const pieceLayer = new Container();
  root.addChild(lastMoveLayer, targetLayer, pieceLayer, selectionLayer, checkLayer);

  const pieces = new Map<number, PieceView>();
  let selected: number | null = null;
  let synced = false;
  let state: SceneState = {
    board: [],
    turnSeat: 0,
    legalMoves: [],
    lastMove: null,
    inCheck: false,
    interactive: false,
    flipped: false,
    accentColor: FALLBACK_ACCENT,
  };

  function moveForTarget(index: number): XiangqiMove | undefined {
    if (selected === null) return undefined;
    return state.legalMoves.find((move) => move.from === selected && move.to === index);
  }

  function createPiece(
    piece: XiangqiPiece,
    index: number,
    animate: boolean,
  ): PieceView {
    const container = new Container();
    const base = new Sprite(getXiangqiPieceTexture());
    base.anchor.set(0.5, PIECE_CENTER / PIECE_TEXTURE_SIZE);
    base.width = PIECE_DIAMETER * (PIECE_TEXTURE_SIZE / (PIECE_RADIUS * 2));
    base.height = base.width;
    const glyph = new Text({
      text: PIECE_SYMBOL[piece.side][piece.kind],
      style: new TextStyle({
        fontFamily: '"STKaiti", "KaiTi", "FangSong", serif',
        fontSize: 42,
        fontWeight: "700",
        fill: piece.side === 0 ? 0x9f241f : 0x211a14,
        stroke: { color: piece.side === 0 ? 0x5e160f : 0x080706, width: 1.2 },
        dropShadow: {
          color: 0xffe7aa,
          alpha: 0.5,
          blur: 0,
          distance: 1,
          angle: -Math.PI / 4,
        },
      }),
    });
    glyph.anchor.set(0.5);
    glyph.position.y = -3;
    container.addChild(base, glyph);
    const position = displayCoordinate(index, state.flipped);
    container.position.set(position.x, position.y);
    pieceLayer.addChild(container);
    if (animate) {
      container.scale.set(0.58);
      gsap.to(container.scale, { x: 1, y: 1, duration: 0.2, ease: "back.out(2)" });
    }
    return { container, identity: `${piece.side}:${piece.kind}` };
  }

  function redrawMarkers(): void {
    lastMoveLayer.clear();
    targetLayer.clear();
    selectionLayer.clear();
    checkLayer.clear();
    gsap.killTweensOf(checkLayer);
    checkLayer.alpha = 1;

    if (state.lastMove) {
      for (const index of [state.lastMove.from, state.lastMove.to]) {
        const position = displayCoordinate(index, state.flipped);
        lastMoveLayer
          .roundRect(position.x - CELL * 0.38, position.y - CELL * 0.38, CELL * 0.76, CELL * 0.76, 5)
          .stroke({ width: 3, color: 0xe7a42c, alpha: 0.95 });
      }
    }
    if (selected !== null) {
      const selectedPosition = displayCoordinate(selected, state.flipped);
      selectionLayer
        .circle(selectedPosition.x, selectedPosition.y, CELL * 0.47)
        .stroke({ width: 4, color: state.accentColor, alpha: 0.98 });
      for (const move of state.legalMoves) {
        if (move.from !== selected) continue;
        const position = displayCoordinate(move.to, state.flipped);
        if (state.board[move.to]) {
          targetLayer
            .circle(position.x, position.y, CELL * 0.45)
            .stroke({ width: 4, color: state.accentColor, alpha: 0.9 });
        } else {
          targetLayer
            .circle(position.x, position.y, CELL * 0.12)
            .fill({ color: state.accentColor, alpha: 0.95 });
        }
      }
    }
    if (state.inCheck) {
      const general = state.board.findIndex(
        (piece) => piece?.side === state.turnSeat && piece.kind === "general",
      );
      if (general >= 0) {
        const position = displayCoordinate(general, state.flipped);
        checkLayer
          .circle(position.x, position.y, CELL * 0.49)
          .stroke({ width: 5, color: 0xc8322c, alpha: 1 });
        gsap.to(checkLayer, { alpha: 0.28, duration: 0.48, repeat: -1, yoyo: true });
      }
    }
  }

  function relayout(): void {
    root.position.set(app.screen.width / 2, app.screen.height / 2);
    root.scale.set(Math.min(app.screen.width / FIT_WIDTH, app.screen.height / FIT_HEIGHT));
  }
  relayout();
  app.renderer.on("resize", relayout);

  app.stage.eventMode = "static";
  app.stage.hitArea = { contains: () => true };
  const toIntersection = (event: FederatedPointerEvent): number | null => {
    const point = root.toLocal(event.global);
    let col = Math.round((point.x + GRID_WIDTH / 2) / CELL);
    let row = Math.round((point.y + GRID_HEIGHT / 2) / CELL);
    if (col < 0 || col > 8 || row < 0 || row > 9) return null;
    if (Math.abs(point.x - (col * CELL - GRID_WIDTH / 2)) > CELL * 0.5) return null;
    if (Math.abs(point.y - (row * CELL - GRID_HEIGHT / 2)) > CELL * 0.5) return null;
    if (state.flipped) {
      col = 8 - col;
      row = 9 - row;
    }
    return row * 9 + col;
  };

  app.stage.on("pointermove", (event: FederatedPointerEvent) => {
    const index = toIntersection(event);
    const piece = index === null ? null : state.board[index];
    app.canvas.style.cursor =
      state.interactive && index !== null && (piece?.side === state.turnSeat || moveForTarget(index))
        ? "pointer"
        : "default";
  });
  app.stage.on("pointerleave", () => {
    app.canvas.style.cursor = "default";
  });
  app.stage.on("pointertap", (event: FederatedPointerEvent) => {
    if (!state.interactive) return;
    const index = toIntersection(event);
    if (index === null) return;
    const move = moveForTarget(index);
    if (move) {
      selected = null;
      redrawMarkers();
      callbacks.onPlay(move);
      return;
    }
    selected = state.board[index]?.side === state.turnSeat ? index : null;
    redrawMarkers();
  });

  return {
    setState(next) {
      const boardChanged = next.board !== state.board;
      state = next;
      if (boardChanged) selected = null;
      for (const [index, view] of pieces) {
        const piece = next.board[index];
        const identity = piece ? `${piece.side}:${piece.kind}` : "";
        if (!piece || identity !== view.identity) {
          gsap.killTweensOf(view.container.scale);
          view.container.destroy({ children: true });
          pieces.delete(index);
        }
      }
      next.board.forEach((piece, index) => {
        if (piece && !pieces.has(index)) {
          pieces.set(
            index,
            createPiece(piece, index, synced && next.lastMove?.to === index),
          );
        }
      });
      for (const [index, view] of pieces) {
        const position = displayCoordinate(index, next.flipped);
        view.container.position.set(position.x, position.y);
      }
      synced = true;
      redrawMarkers();
    },
    destroy() {
      for (const view of pieces.values()) gsap.killTweensOf(view.container.scale);
      gsap.killTweensOf(checkLayer);
      app.renderer.off("resize", relayout);
    },
  };
}

export function XiangqiStage(props: XiangqiStageProps) {
  const { i18n } = useLingui();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [accentColor, setAccentColor] = useState(resolvePrimaryColor);
  const accentRef = useRef(accentColor);
  accentRef.current = accentColor;
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const root = document.documentElement;
    const syncColor = () => setAccentColor(resolvePrimaryColor());
    const observer = new MutationObserver(syncColor);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => observer.disconnect();
  }, []);

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
      const scene = createScene(
        nextApp,
        {
          riverChu: i18n._(msg`楚 河`),
          riverHan: i18n._(msg`汉 界`),
          board: i18n._(msg`中国象棋棋盘`),
        },
        { onPlay: (move) => propsRef.current.onPlay(move) },
      );
      sceneRef.current = scene;
      const current = propsRef.current;
      scene.setState({
        board: current.board,
        turnSeat: current.turnSeat,
        legalMoves: current.legalMoves,
        lastMove: current.lastMove,
        inCheck: current.inCheck,
        interactive: current.interactive,
        flipped: current.flipped,
        accentColor: accentRef.current,
      });
    })();

    return () => {
      disposed = true;
      sceneRef.current?.destroy();
      sceneRef.current = null;
      app?.destroy(true, { children: true });
    };
    // The app language and match orientation are fixed for this mounted screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setState({
      board: props.board,
      turnSeat: props.turnSeat,
      legalMoves: props.legalMoves,
      lastMove: props.lastMove,
      inCheck: props.inCheck,
      interactive: props.interactive,
      flipped: props.flipped,
      accentColor,
    });
  }, [
    props.board,
    props.turnSeat,
    props.legalMoves,
    props.lastMove,
    props.inCheck,
    props.interactive,
    props.flipped,
    accentColor,
  ]);

  return <div ref={containerRef} className="size-full touch-none overflow-hidden" />;
}
