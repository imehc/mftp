import { CanvasSource, Texture } from "pixi.js";

import { valueNoise } from "../engine/noise";

const SIZE = 896;
const INSET = SIZE * 0.06;
const FIELD = SIZE * 0.88;

function canvas(size: number) {
  const element = document.createElement("canvas");
  element.width = element.height = size;
  const context = element.getContext("2d");
  if (!context) throw new Error("reversi: texture canvas unavailable");
  return { element, context };
}

function boardCanvas() {
  const { element, context: ctx } = canvas(SIZE);
  const pixels = ctx.createImageData(SIZE, SIZE);
  let seed = 4826;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const fiber = ((seed % 17) - 8) * 0.45;
      const field =
        x >= INSET && x <= SIZE - INSET && y >= INSET && y <= SIZE - INSET;
      const light = 1 - ((x / SIZE) * 0.07 + (y / SIZE) * 0.13);
      const grain = (valueNoise(x * 0.02, y * 0.025) - 0.5) * (field ? 4 : 1.5);
      const color = field ? [34, 103, 72] : [43, 49, 44];
      const offset = (y * SIZE + x) * 4;
      for (let channel = 0; channel < 3; channel++)
        pixels.data[offset + channel] =
          color[channel] * light + fiber * (field ? 1 : 0.35) + grain;
      pixels.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  // 模压框的圆角和两道倒角仍保持正俯视，不通过倾斜制造厚度。
  ctx.globalCompositeOperation = "destination-in";
  ctx.beginPath();
  ctx.roundRect(0, 0, SIZE, SIZE, SIZE * 0.03);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  const bevel = ctx.createLinearGradient(0, 0, SIZE * 0.5, SIZE);
  bevel.addColorStop(0, "#828a7e");
  bevel.addColorStop(0.15, "#3d493e");
  bevel.addColorStop(0.55, "#243128");
  bevel.addColorStop(1, "#0d1710");
  ctx.strokeStyle = bevel;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(3, 3, SIZE - 6, SIZE - 6, SIZE * 0.027);
  ctx.stroke();
  ctx.strokeStyle = "rgba(8,20,12,0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(8, 8, SIZE - 16, SIZE - 16, SIZE * 0.024);
  ctx.stroke();
  ctx.strokeStyle = "#122c1e";
  ctx.lineWidth = 4;
  ctx.strokeRect(INSET - 1, INSET - 1, FIELD + 2, FIELD + 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(INSET, INSET, FIELD, FIELD);
  ctx.clip();
  // 凹入盘面只在内沿形成窄阴影，保留织物纹理和清晰格线。
  ctx.shadowColor = "rgba(0,15,7,0.5)";
  ctx.shadowBlur = 9;
  ctx.shadowOffsetY = 3;
  ctx.strokeStyle = "#14261a";
  ctx.lineWidth = 5;
  ctx.strokeRect(INSET - 3, INSET - 3, FIELD + 6, FIELD + 6);
  ctx.restore();
  for (let i = 1; i < 8; i++) {
    const at = INSET + (FIELD * i) / 8;
    ctx.beginPath();
    ctx.moveTo(at, INSET);
    ctx.lineTo(at, SIZE - INSET);
    ctx.moveTo(INSET, at);
    ctx.lineTo(SIZE - INSET, at);
    ctx.strokeStyle = "rgba(8,40,24,0.65)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  return element;
}

function discCanvas(seat: number) {
  const { element, context: ctx } = canvas(256);
  const black = seat === 0;
  const path = new Path2D();
  path.arc(128, 128, 112, 0, Math.PI * 2);
  const edge = ctx.createLinearGradient(40, 20, 200, 244);
  edge.addColorStop(0, black ? "#68716b" : "#faf8ee");
  edge.addColorStop(0.25, black ? "#323b34" : "#e3e3d8");
  edge.addColorStop(1, black ? "#070d09" : "#969f92");
  ctx.fillStyle = edge;
  ctx.fill(path);
  const face = ctx.createRadialGradient(93, 70, 15, 128, 128, 112);
  if (black) {
    face.addColorStop(0, "#3d453f");
    face.addColorStop(0.45, "#252d27");
    face.addColorStop(0.82, "#151d17");
    face.addColorStop(1, "#0d140f");
  } else {
    face.addColorStop(0, "#faf8ef");
    face.addColorStop(0.48, "#edeee4");
    face.addColorStop(0.85, "#d9ddd1");
    face.addColorStop(1, "#b9c2b3");
  }
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(128, 127, 107, 0, Math.PI * 2);
  ctx.fill();
  // 宽而柔和的灯箱反射，避免把黑白棋扁圆棋子画成围棋的高光半球。
  ctx.save();
  ctx.clip(path);
  ctx.translate(106, 66);
  ctx.scale(1, 0.5);
  const reflection = ctx.createRadialGradient(0, 0, 0, 0, 0, 94);
  reflection.addColorStop(
    0,
    black ? "rgba(215,232,220,0.16)" : "rgba(255,255,255,0.3)",
  );
  reflection.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = reflection;
  ctx.fillRect(-100, -100, 200, 200);
  ctx.restore();
  return element;
}

function shadowCanvas() {
  const { element, context } = canvas(128);
  const gradient = context.createRadialGradient(64, 64, 35, 64, 64, 63);
  gradient.addColorStop(0, "rgba(0,10,4,0.5)");
  gradient.addColorStop(0.6, "rgba(0,10,4,0.22)");
  gradient.addColorStop(1, "rgba(0,10,4,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return element;
}

export function createReversiTextures() {
  const from = (source: HTMLCanvasElement) =>
    new Texture({ source: new CanvasSource({ resource: source }) });
  return {
    board: from(boardCanvas()),
    black: from(discCanvas(0)),
    white: from(discCanvas(1)),
    shadow: from(shadowCanvas()),
  };
}
