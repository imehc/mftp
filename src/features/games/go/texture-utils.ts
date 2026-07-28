/**
 * Procedural Pixi textures for the go board: a seeded kaya-wood surface
 * (identical every launch) and the two stone sprites. Board-size
 * independent — grid/star points are drawn as Graphics in GoStage.
 */
import { CanvasSource, Texture } from "pixi.js";
import type { SeatIndex } from "../engine/types";

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

/** Wood square resolution in texture px. */
export const WOOD_TEX = 832;
/** Texture-space margin so the baked drop shadow is not clipped. */
export const WOOD_PAD = 48;
export const WOOD_FULL = WOOD_TEX + WOOD_PAD * 2;
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

export function makeBoardCanvas(): HTMLCanvasElement {
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
export const STONE_TEX = 176;
export const STONE_R = 66;
export const STONE_CX = STONE_TEX / 2;
export const STONE_CY = STONE_TEX / 2 - 4;

export function makeStoneCanvas(seat: SeatIndex): HTMLCanvasElement {
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

export function getBoardTexture(): Texture {
  boardTexture ??= textureFrom(makeBoardCanvas());
  return boardTexture;
}

export function getStoneTextures(): [Texture, Texture] {
  stoneTextures ??= [
    textureFrom(makeStoneCanvas(0)),
    textureFrom(makeStoneCanvas(1)),
  ];
  return stoneTextures;
}
