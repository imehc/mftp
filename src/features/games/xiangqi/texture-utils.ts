/** Pixi 中国象棋舞台的缓存程序化材质。 */
import { CanvasSource, Texture } from "pixi.js";

export const BOARD_TEXTURE_WIDTH = 864;
export const BOARD_TEXTURE_HEIGHT = 960;
export const BOARD_TEXTURE_PAD = 52;
export const BOARD_SURFACE_WIDTH = BOARD_TEXTURE_WIDTH - BOARD_TEXTURE_PAD * 2;
export const BOARD_SURFACE_HEIGHT =
  BOARD_TEXTURE_HEIGHT - BOARD_TEXTURE_PAD * 2;

export const PIECE_TEXTURE_SIZE = 184;
export const PIECE_CENTER = PIECE_TEXTURE_SIZE / 2;
export const PIECE_RADIUS = 69;

function hash2(ix: number, iy: number): number {
  let hash = (ix * 374761393 + iy * 668265263) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
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
  let amplitude = 0.5;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += valueNoise(x, y) * amplitude;
    norm += amplitude;
    x *= 2;
    y *= 2;
    amplitude *= 0.5;
  }
  return sum / norm;
}

function drawElmSurface(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(width, height);
  const pixels = image.data;
  const dark = [92, 52, 24];
  const light = [211, 153, 80];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const wave = Math.sin(y * 0.012 + fbm(x * 0.014, y * 0.012, 2) * 6) * 5;
      const grainX = x + wave + (fbm(x * 0.035, y * 0.004, 2) - 0.5) * 34;
      const broad = fbm(grainX * 0.006, y * 0.0015, 2);
      const fine = fbm(grainX * 0.072, y * 0.003, 3);
      const ring = grainX * 0.047 + fbm(x * 0.018, y * 0.016, 2) * 1.6;
      const edge = Math.min(
        ring - Math.floor(ring),
        1 - (ring - Math.floor(ring)),
      );
      let tone = 0.57 + (broad - 0.5) * 0.5 + (fine - 0.5) * 0.28;
      tone -=
        Math.max(0, 0.05 - edge) *
        3.5 *
        (0.4 + valueNoise(x * 0.04, y * 0.02) * 0.6);
      tone = Math.min(1, Math.max(0, tone));
      const offset = (y * width + x) * 4;
      pixels[offset] = dark[0] + (light[0] - dark[0]) * tone;
      pixels[offset + 1] = dark[1] + (light[1] - dark[1]) * tone;
      pixels[offset + 2] = dark[2] + (light[2] - dark[2]) * tone;
      pixels[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);

  for (const seamY of [height * 0.26, height * 0.51, height * 0.76]) {
    const seam = context.createLinearGradient(0, seamY - 2, 0, seamY + 3);
    seam.addColorStop(0, "rgba(255,225,166,0.12)");
    seam.addColorStop(0.45, "rgba(61,29,11,0.23)");
    seam.addColorStop(1, "rgba(255,218,148,0.07)");
    context.fillStyle = seam;
    context.fillRect(0, seamY - 2, width, 5);
  }

  const sheen = context.createLinearGradient(0, 0, width, height);
  sheen.addColorStop(0, "rgba(255,235,190,0.2)");
  sheen.addColorStop(0.42, "rgba(255,235,190,0)");
  sheen.addColorStop(1, "rgba(48,21,7,0.18)");
  context.fillStyle = sheen;
  context.fillRect(0, 0, width, height);

  const vignette = context.createRadialGradient(
    width / 2,
    height / 2,
    width * 0.28,
    width / 2,
    height / 2,
    height * 0.62,
  );
  vignette.addColorStop(0, "rgba(46,20,6,0)");
  vignette.addColorStop(1, "rgba(46,20,6,0.24)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
  return canvas;
}

function makeBoardCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = BOARD_TEXTURE_WIDTH;
  canvas.height = BOARD_TEXTURE_HEIGHT;
  const context = canvas.getContext("2d")!;
  const x = BOARD_TEXTURE_PAD;
  const y = BOARD_TEXTURE_PAD;
  const width = BOARD_SURFACE_WIDTH;
  const height = BOARD_SURFACE_HEIGHT;
  const outer = new Path2D();
  outer.roundRect(x, y, width, height, 18);

  context.save();
  context.shadowColor = "rgba(20,9,3,0.58)";
  context.shadowBlur = 34;
  context.shadowOffsetY = 18;
  context.fillStyle = "#2d1709";
  context.fill(outer);
  context.restore();

  context.save();
  context.clip(outer);
  context.drawImage(drawElmSurface(width, height), x, y);
  const edgeShade = context.createLinearGradient(x, y, x + 28, y);
  edgeShade.addColorStop(0, "rgba(38,15,4,0.38)");
  edgeShade.addColorStop(1, "rgba(38,15,4,0)");
  context.fillStyle = edgeShade;
  context.fillRect(x, y, 30, height);
  context.restore();

  context.strokeStyle = "rgba(48,22,7,0.92)";
  context.lineWidth = 6;
  context.stroke(outer);
  context.strokeStyle = "rgba(255,224,164,0.2)";
  context.lineWidth = 2;
  context.strokeRect(x + 7, y + 7, width - 14, height - 14);
  return canvas;
}

function makePieceCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PIECE_TEXTURE_SIZE;
  canvas.height = PIECE_TEXTURE_SIZE;
  const context = canvas.getContext("2d")!;
  const center = PIECE_CENTER;
  const radius = PIECE_RADIUS;

  context.save();
  context.shadowColor = "rgba(24,10,3,0.56)";
  context.shadowBlur = 12;
  context.shadowOffsetY = 8;
  context.fillStyle = "#8d5826";
  context.beginPath();
  context.arc(center, center - 3, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();

  const body = context.createRadialGradient(
    center - radius * 0.38,
    center - radius * 0.48,
    radius * 0.08,
    center,
    center,
    radius,
  );
  body.addColorStop(0, "#fff1bd");
  body.addColorStop(0.34, "#e9c27b");
  body.addColorStop(0.72, "#c7934b");
  body.addColorStop(1, "#754317");
  context.fillStyle = body;
  context.beginPath();
  context.arc(center, center - 3, radius, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.beginPath();
  context.arc(center, center - 3, radius - 2, 0, Math.PI * 2);
  context.clip();
  context.globalAlpha = 0.14;
  context.strokeStyle = "#6a3510";
  for (let i = 0; i < 28; i++) {
    const offset = (i - 14) * 5.2;
    context.lineWidth = 0.8 + hash2(i, 7) * 1.2;
    context.beginPath();
    context.moveTo(center - radius, center + offset * 0.22);
    context.bezierCurveTo(
      center - radius * 0.28,
      center + offset + Math.sin(i) * 5,
      center + radius * 0.34,
      center + offset - Math.cos(i) * 6,
      center + radius,
      center + offset * 0.18,
    );
    context.stroke();
  }
  context.restore();

  for (const [ringRadius, color, lineWidth] of [
    [radius - 5, "rgba(75,37,11,0.72)", 2.4],
    [radius - 10, "rgba(255,234,179,0.42)", 1.5],
    [radius - 18, "rgba(88,44,13,0.46)", 2],
  ] as const) {
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.arc(center, center - 3, ringRadius, 0, Math.PI * 2);
    context.stroke();
  }
  return canvas;
}

function textureFrom(canvas: HTMLCanvasElement): Texture {
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

let boardTexture: Texture | null = null;
let pieceTexture: Texture | null = null;

export function getXiangqiBoardTexture(): Texture {
  boardTexture ??= textureFrom(makeBoardCanvas());
  return boardTexture;
}

export function getXiangqiPieceTexture(): Texture {
  pieceTexture ??= textureFrom(makePieceCanvas());
  return pieceTexture;
}
