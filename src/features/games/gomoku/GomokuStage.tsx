/**
 * Pixi rendering + interaction for the gomoku board.
 *
 * The board lives entirely in canvas so line spacing, margins and cell
 * geometry are computed in one place from CELL/MARGIN — every gap is
 * mathematically identical, unlike the previous CSS grid where percentage
 * padding resolved against the parent width and fr-tracks rounded to
 * different pixel sizes.
 *
 * The kaya wood surface is a procedurally generated canvas texture
 * (seeded value-noise grain, so it renders the same every launch) with
 * rounded corners and a baked drop shadow. Stones are two pre-rendered
 * radial-gradient textures shared by all sprites.
 *
 * React only mounts/unmounts the Application and forwards props; taps,
 * hover ghosts and the placement pop happen directly in Pixi.
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
  BOARD_TEXTURE_SCALE,
  getGomokuTextures,
  STONE_CENTER_Y,
  STONE_RADIUS,
  STONE_TEXTURE_SIZE,
} from "./GomokuStage.textures";
import { BOARD_SIZE, type GomokuMove, type Stone } from "./types";

// --- board geometry (world units) -------------------------------------
const N = BOARD_SIZE;
/** Distance between two lines. Everything else derives from this. */
const CELL = 48;
/** Span of the line grid (outer line to outer line). */
const GRID = CELL * (N - 1);
/** Wood visible beyond the outer lines, identical on all four sides. */
const MARGIN = CELL * 0.75;
/** Full wooden board edge length. */
const BOARD = GRID + MARGIN * 2;
/** World-space extent used to fit the board (leaves room for the shadow). */
const FIT_EXTENT = BOARD + CELL * 1.6;

const STONE_DIAMETER = CELL * 0.94;
const STAR_POINTS: Array<[number, number]> = [
  [3, 3],
  [3, 11],
  [7, 7],
  [11, 3],
  [11, 11],
];

/** Intersection center in world coordinates (board centered at origin). */
const lineAt = (i: number): number => i * CELL - GRID / 2;

// --- scene ------------------------------------------------------------
export interface GomokuStageProps {
  board: Stone[];
  lastMove: GomokuMove | null;
  winningLine: number[];
  /** Seat whose stone the hover ghost previews. */
  ghostSeat: SeatIndex;
  /** Local player may place a stone right now. */
  interactive: boolean;
  onPlay(move: GomokuMove): void;
}

interface SceneState {
  board: Stone[];
  lastMove: GomokuMove | null;
  winningLine: number[];
  ghostSeat: SeatIndex;
  interactive: boolean;
}

interface Scene {
  setState(state: SceneState): void;
  destroy(): void;
}

function createScene(
  app: Application,
  callbacks: { onPlay(move: GomokuMove): void },
): Scene {
  const { boardTexture, stoneTextures: stoneTexture } = getGomokuTextures();

  const root = new Container();
  app.stage.addChild(root);

  // --- static board ---------------------------------------------------
  const boardSprite = new Sprite(boardTexture);
  boardSprite.anchor.set(0.5);
  const spriteSize = BOARD * BOARD_TEXTURE_SCALE;
  boardSprite.width = spriteSize;
  boardSprite.height = spriteSize;
  root.addChild(boardSprite);

  const grid = new Graphics();
  const half = GRID / 2;
  for (let i = 1; i < N - 1; i++) {
    const p = lineAt(i);
    grid.moveTo(-half, p).lineTo(half, p);
    grid.moveTo(p, -half).lineTo(p, half);
  }
  grid.stroke({ width: 1.6, color: 0x45260c, alpha: 0.9 });
  // Traditional boards frame the grid with a heavier boundary line.
  grid
    .rect(-half, -half, GRID, GRID)
    .stroke({ width: 3, color: 0x45260c, alpha: 0.95 });
  for (const [row, col] of STAR_POINTS) {
    grid.circle(lineAt(col), lineAt(row), CELL * 0.09).fill({
      color: 0x38200a,
      alpha: 0.95,
    });
  }
  root.addChild(grid);

  // --- dynamic layers -------------------------------------------------
  const stoneLayer = new Container();
  const markerLayer = new Graphics();
  // Winning-line rings live on their own layer so they can blink as a
  // whole before the React result bar appears below the board.
  const winLayer = new Graphics();
  const ghost = new Sprite(stoneTexture[0]);
  ghost.anchor.set(0.5, STONE_CENTER_Y / STONE_TEXTURE_SIZE);
  ghost.width = STONE_DIAMETER * (STONE_TEXTURE_SIZE / (STONE_RADIUS * 2));
  ghost.height = ghost.width;
  ghost.alpha = 0.35;
  ghost.visible = false;
  root.addChild(stoneLayer, markerLayer, winLayer, ghost);

  const stones = new Map<number, Sprite>();
  let state: SceneState = {
    board: [],
    lastMove: null,
    winningLine: [],
    ghostSeat: 0,
    interactive: false,
  };
  /** Skip the placement pop while syncing the very first snapshot. */
  let synced = false;
  let hoverIndex: number | null = null;
  /** True once the current win has been announced with the blink. */
  let winAnimated = false;

  function addStone(index: number, seat: SeatIndex, animate: boolean): void {
    const sprite = new Sprite(stoneTexture[seat]);
    // Anchor at the stone circle's center so it sits exactly on the
    // intersection while the baked shadow hangs below.
    sprite.anchor.set(0.5, STONE_CENTER_Y / STONE_TEXTURE_SIZE);
    sprite.width = STONE_DIAMETER * (STONE_TEXTURE_SIZE / (STONE_RADIUS * 2));
    sprite.height = sprite.width;
    sprite.position.set(lineAt(index % N), lineAt(Math.floor(index / N)));
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

  function redrawMarkers(): void {
    markerLayer.clear();
    winLayer.clear();
    for (const index of state.winningLine) {
      winLayer
        .circle(lineAt(index % N), lineAt(Math.floor(index / N)), CELL * 0.52)
        .stroke({ width: 3.4, color: 0xf3b73f, alpha: 0.95 });
    }
    if (state.winningLine.length > 0) {
      if (!winAnimated) {
        winAnimated = true;
        // Pulse a few times, ending solid; the result bar waits for it.
        gsap.fromTo(
          winLayer,
          { alpha: 0.1 },
          { alpha: 1, duration: 0.26, repeat: 4, yoyo: true, ease: "power1.inOut" },
        );
      }
    } else {
      winAnimated = false;
      gsap.killTweensOf(winLayer);
      winLayer.alpha = 1;
    }
    const last = state.lastMove;
    if (last) {
      const seat = state.board[last.row * N + last.col];
      if (seat !== null) {
        markerLayer
          .circle(lineAt(last.col), lineAt(last.row), CELL * 0.08)
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
      state.interactive && index !== null && state.board[index] === null;
    ghost.visible = show;
    if (show && index !== null) {
      ghost.texture = stoneTexture[state.ghostSeat] ?? stoneTexture[0];
      ghost.position.set(lineAt(index % N), lineAt(Math.floor(index / N)));
    }
    app.canvas.style.cursor = show ? "pointer" : "default";
  }

  // --- layout ---------------------------------------------------------
  function relayout(): void {
    const w = app.screen.width;
    const h = app.screen.height;
    root.position.set(w / 2, h / 2);
    root.scale.set(Math.min(w, h) / FIT_EXTENT);
  }
  relayout();
  app.renderer.on("resize", relayout);

  // --- input ----------------------------------------------------------
  app.stage.eventMode = "static";
  app.stage.hitArea = { contains: () => true };

  function toIntersection(e: FederatedPointerEvent): number | null {
    const p = root.toLocal(e.global);
    const col = Math.round((p.x + half) / CELL);
    const row = Math.round((p.y + half) / CELL);
    if (col < 0 || col >= N || row < 0 || row >= N) return null;
    if (
      Math.abs(p.x - lineAt(col)) > CELL * 0.55 ||
      Math.abs(p.y - lineAt(row)) > CELL * 0.55
    ) {
      return null;
    }
    return row * N + col;
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
    if (index === null || state.board[index] !== null) return;
    callbacks.onPlay({ row: Math.floor(index / N), col: index % N });
  });

  return {
    setState(next) {
      state = next;
      const lastIndex = next.lastMove
        ? next.lastMove.row * N + next.lastMove.col
        : null;
      for (const [index, sprite] of stones) {
        if (next.board[index] === null) {
          gsap.killTweensOf(sprite.scale);
          sprite.destroy();
          stones.delete(index);
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
      gsap.killTweensOf(winLayer);
      app.renderer.off("resize", relayout);
    },
  };
}

export function GomokuStage(props: GomokuStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

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
      const scene = createScene(nextApp, {
        onPlay: (move) => propsRef.current.onPlay(move),
      });
      sceneRef.current = scene;
      const current = propsRef.current;
      scene.setState({
        board: current.board,
        lastMove: current.lastMove,
        winningLine: current.winningLine,
        ghostSeat: current.ghostSeat,
        interactive: current.interactive,
      });
    })();

    return () => {
      disposed = true;
      sceneRef.current?.destroy();
      sceneRef.current = null;
      // texture: false — board/stone textures are module-cached and reused
      // by the next mount.
      app?.destroy(true, { children: true });
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setState({
      board: props.board,
      lastMove: props.lastMove,
      winningLine: props.winningLine,
      ghostSeat: props.ghostSeat,
      interactive: props.interactive,
    });
  }, [
    props.board,
    props.lastMove,
    props.winningLine,
    props.ghostSeat,
    props.interactive,
  ]);

  return <div ref={containerRef} className="h-full w-full touch-none" />;
}
