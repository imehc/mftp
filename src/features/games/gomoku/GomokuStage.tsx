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
  CanvasSource,
  Container,
  Graphics,
  Sprite,
  Texture,
  type FederatedPointerEvent,
} from "pixi.js";
import gsap from "gsap";
import type { SeatIndex } from "../engine/types";
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

// --- procedural textures ----------------------------------------------
// Deterministic lattice hash → value noise → fbm; seeded so the grain is
// stable across launches and both locales of the app look identical.
function hash2(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(fx, fy);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

/** Wood square resolution in texture px (upscaled slightly on 2x screens —
 * grain is low-frequency, so the softness reads as natural). */
const WOOD_TEX = 832;
/** Texture-space margin so the baked drop shadow is not clipped. */
const WOOD_PAD = 48;
const WOOD_FULL = WOOD_TEX + WOOD_PAD * 2;
const WOOD_CORNER = 22;

// Kaya tones from dark grain line to sunlit fiber.
const WOOD_DARK: [number, number, number] = [128, 82, 33];
const WOOD_LIGHT: [number, number, number] = [235, 195, 122];

function drawWoodGrain(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Straight vertical grain with gentle waviness — the warp makes the
      // rings drift like a sawn plank instead of ruler-straight stripes.
      const wave = Math.sin(y * 0.011 + fbm(x * 0.015, y * 0.015, 2) * 6) * 4;
      const gx = x + wave + (fbm(x * 0.045, y * 0.006, 2) - 0.5) * 24;

      // Broad tonal zones + fine fiber stripes stretched along y.
      const broad = fbm(gx * 0.006, y * 0.0014, 2);
      const fine = fbm(gx * 0.085, y * 0.004, 3);
      const fiber = valueNoise(x * 0.7, y * 0.09);
      let light =
        0.56 + (broad - 0.5) * 0.42 + (fine - 0.5) * 0.4 + (fiber - 0.5) * 0.07;

      // Thin dark growth lines: distance to a warped ring boundary, broken
      // up along their length so they read as organic rather than printed.
      const ring = gx * 0.055 + fbm(x * 0.02, y * 0.02, 2) * 1.35;
      const f = ring - Math.floor(ring);
      const edge = Math.min(f, 1 - f);
      const presence = 0.3 + 0.7 * valueNoise(x * 0.05, y * 0.018);
      light -= Math.max(0, 0.055 - edge) * 3.2 * presence;

      light = Math.min(1, Math.max(0, light));
      const o = (y * size + x) * 4;
      data[o] = WOOD_DARK[0] + (WOOD_LIGHT[0] - WOOD_DARK[0]) * light;
      data[o + 1] = WOOD_DARK[1] + (WOOD_LIGHT[1] - WOOD_DARK[1]) * light;
      data[o + 2] = WOOD_DARK[2] + (WOOD_LIGHT[2] - WOOD_DARK[2]) * light;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // Sheen from the top-left, like overhead lighting on lacquered wood.
  const sheen = ctx.createLinearGradient(0, 0, size * 0.7, size);
  sheen.addColorStop(0, "rgba(255, 240, 200, 0.12)");
  sheen.addColorStop(0.45, "rgba(255, 240, 200, 0)");
  sheen.addColorStop(1, "rgba(88, 46, 12, 0.10)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, size, size);

  // Soft vignette keeps the center bright and grounds the edges.
  const vignette = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.42,
    size / 2,
    size / 2,
    size * 0.74,
  );
  vignette.addColorStop(0, "rgba(58, 29, 8, 0)");
  vignette.addColorStop(1, "rgba(58, 29, 8, 0.2)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  return canvas;
}

function makeBoardCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WOOD_FULL;
  canvas.height = WOOD_FULL;
  const ctx = canvas.getContext("2d")!;
  const path = new Path2D();
  path.roundRect(WOOD_PAD, WOOD_PAD, WOOD_TEX, WOOD_TEX, WOOD_CORNER);

  ctx.save();
  ctx.shadowColor = "rgba(18, 9, 3, 0.45)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 15;
  ctx.fillStyle = "#241407";
  ctx.fill(path);
  ctx.restore();

  ctx.save();
  ctx.clip(path);
  ctx.drawImage(drawWoodGrain(WOOD_TEX), WOOD_PAD, WOOD_PAD);
  ctx.restore();

  ctx.strokeStyle = "rgba(58, 31, 10, 0.85)";
  ctx.lineWidth = 2;
  ctx.stroke(path);
  const inner = new Path2D();
  inner.roundRect(
    WOOD_PAD + 1.5,
    WOOD_PAD + 1.5,
    WOOD_TEX - 3,
    WOOD_TEX - 3,
    WOOD_CORNER - 1.5,
  );
  ctx.strokeStyle = "rgba(255, 236, 190, 0.16)";
  ctx.lineWidth = 1.5;
  ctx.stroke(inner);

  return canvas;
}

/** Stone texture canvas edge; the stone circle itself has radius STONE_R. */
const STONE_TEX = 176;
const STONE_R = 66;
const STONE_CX = STONE_TEX / 2;
const STONE_CY = STONE_TEX / 2 - 4;

function makeStoneCanvas(seat: SeatIndex): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = STONE_TEX;
  canvas.height = STONE_TEX;
  const ctx = canvas.getContext("2d")!;
  const black = seat === 0;

  // Contact shadow baked under the stone.
  ctx.save();
  ctx.shadowColor = "rgba(20, 10, 3, 0.4)";
  ctx.shadowBlur = 9;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = black ? "#101010" : "#d9cfba";
  ctx.beginPath();
  ctx.arc(STONE_CX, STONE_CY, STONE_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const body = ctx.createRadialGradient(
    STONE_CX - STONE_R * 0.42,
    STONE_CY - STONE_R * 0.46,
    STONE_R * 0.1,
    STONE_CX,
    STONE_CY,
    STONE_R,
  );
  if (black) {
    body.addColorStop(0, "#8d8d8d");
    body.addColorStop(0.3, "#474747");
    body.addColorStop(0.65, "#1b1b1b");
    body.addColorStop(1, "#000000");
  } else {
    body.addColorStop(0, "#ffffff");
    body.addColorStop(0.4, "#f7f0e1");
    body.addColorStop(0.75, "#e6dbc3");
    body.addColorStop(1, "#c2b193");
  }
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(STONE_CX, STONE_CY, STONE_R, 0, Math.PI * 2);
  ctx.fill();

  // Specular highlight — tighter and brighter on the glassy black stone.
  const spec = ctx.createRadialGradient(
    STONE_CX - STONE_R * 0.42,
    STONE_CY - STONE_R * 0.5,
    0,
    STONE_CX - STONE_R * 0.42,
    STONE_CY - STONE_R * 0.5,
    STONE_R * (black ? 0.42 : 0.55),
  );
  spec.addColorStop(0, `rgba(255, 255, 255, ${black ? 0.55 : 0.5})`);
  spec.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = spec;
  ctx.beginPath();
  ctx.arc(STONE_CX, STONE_CY, STONE_R, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

// Textures are cached for the lifetime of the app: generation is the
// expensive part, and v8 TextureSources re-upload themselves to whichever
// renderer needs them, so they survive Application unmounts. The teardown
// therefore must NOT pass `texture: true` to app.destroy.
let boardTexture: Texture | null = null;
let stoneTextures: [Texture, Texture] | null = null;

function textureFrom(canvas: HTMLCanvasElement): Texture {
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

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
  boardTexture ??= textureFrom(makeBoardCanvas());
  stoneTextures ??= [
    textureFrom(makeStoneCanvas(0)),
    textureFrom(makeStoneCanvas(1)),
  ];
  const stoneTexture = stoneTextures;

  const root = new Container();
  app.stage.addChild(root);

  // --- static board ---------------------------------------------------
  const boardSprite = new Sprite(boardTexture);
  boardSprite.anchor.set(0.5);
  const spriteSize = BOARD * (WOOD_FULL / WOOD_TEX);
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
  // whole before the React result overlay covers the board.
  const winLayer = new Graphics();
  const ghost = new Sprite(stoneTexture[0]);
  ghost.anchor.set(0.5, STONE_CY / STONE_TEX);
  ghost.width = STONE_DIAMETER * (STONE_TEX / (STONE_R * 2));
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
    sprite.anchor.set(0.5, STONE_CY / STONE_TEX);
    sprite.width = STONE_DIAMETER * (STONE_TEX / (STONE_R * 2));
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
        // Pulse a few times, ending solid; the result overlay waits for it.
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
