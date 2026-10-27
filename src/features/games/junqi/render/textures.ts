import { createRng } from "../../engine/ai";
import { BOARD_EDGES, isCamp, isHeadquarters } from "../board";
import { BOARD_HEIGHT, BOARD_WIDTH, cellPosition } from "./geometry";

function canvas2d(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("junqi: canvas unavailable");
  return { canvas, ctx };
}

export function boardTexture(
  camp: string,
  headquarters: string,
  font: string,
  landscape: boolean,
): HTMLCanvasElement {
  const worldWidth = landscape ? BOARD_HEIGHT : BOARD_WIDTH;
  const worldHeight = landscape ? BOARD_WIDTH : BOARD_HEIGHT;
  const width = Math.round(worldWidth * 180),
    height = Math.round(worldHeight * 180);
  const { canvas, ctx } = canvas2d(width, height);
  const rng = createRng(713);
  ctx.fillStyle = "#cdc9b8";
  ctx.fillRect(0, 0, width, height);
  const surface = ctx.createLinearGradient(0, 0, width * 0.3, height);
  surface.addColorStop(0, "#e0dfd0");
  surface.addColorStop(0.6, "#d8d7c5");
  surface.addColorStop(1, "#cdcbb8");
  ctx.fillStyle = surface;
  ctx.fillRect(8, 8, width - 16, height - 20);
  for (let n = 0; n < 45000; n++) {
    ctx.fillStyle =
      rng() > 0.5 ? "rgba(255,255,241,.10)" : "rgba(55,62,37,.035)";
    ctx.fillRect(rng() * width, rng() * height, 1 + rng() * 3, 1 + rng() * 3);
  }
  ctx.strokeStyle = "#526655";
  ctx.lineWidth = 2.3;
  ctx.strokeRect(24, 24, width - 48, height - 52);
  ctx.strokeStyle = "#8d9981";
  ctx.lineWidth = 1;
  ctx.strokeRect(32, 32, width - 64, height - 68);

  const point = (index: number) => {
    const p = cellPosition(index, false, landscape);
    return {
      x: (p.x / worldWidth + 0.5) * width,
      y: (0.5 - p.y / worldHeight) * height,
    };
  };

  for (const { from, to, rail } of BOARD_EDGES) {
    const a = point(from),
      b = point(to);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const dx = (b.x - a.x) / length,
      dy = (b.y - a.y) / length;
    ctx.strokeStyle = rail ? "#354f44" : "#798772";
    ctx.lineWidth = rail ? 3 : 1.8;
    if (rail) {
      for (const offset of [-5, 5]) {
        ctx.beginPath();
        ctx.moveTo(a.x - dy * offset, a.y + dx * offset);
        ctx.lineTo(b.x - dy * offset, b.y + dx * offset);
        ctx.stroke();
      }
      ctx.lineWidth = 1.8;
      for (let distance = 0; distance < length; distance += 12) {
        const x = a.x + dx * distance,
          y = a.y + dy * distance;
        ctx.beginPath();
        ctx.moveTo(x - dy * 8, y + dx * 8);
        ctx.lineTo(x + dy * 8, y - dx * 8);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  for (let index = 0; index < 60; index++) {
    const p = point(index);
    ctx.fillStyle = "#d9d9c8";
    ctx.strokeStyle = isHeadquarters(index) ? "#815c4c" : "#546b52";
    ctx.lineWidth = isCamp(index) ? 2.8 : 2;
    ctx.beginPath();
    if (isCamp(index)) ctx.arc(p.x, p.y, 64, 0, Math.PI * 2);
    else
      ctx.roundRect(
        p.x - (landscape ? 43 : 75),
        p.y - (landscape ? 75 : 43),
        landscape ? 86 : 150,
        landscape ? 150 : 86,
        4,
      );
    ctx.fill();
    ctx.stroke();
    if (isCamp(index) || isHeadquarters(index)) {
      ctx.fillStyle = isCamp(index) ? "#465e45" : "#805343";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `500 24px ${font}`;
      const label = isCamp(index) ? camp : headquarters;
      if (landscape && isHeadquarters(index) && /\p{Script=Han}/u.test(label)) {
        [...label].forEach((char, n) =>
          ctx.fillText(char, p.x, p.y + (n - (label.length - 1) / 2) * 30),
        );
      } else
        ctx.fillText(
          label,
          p.x,
          p.y,
          landscape && isHeadquarters(index) ? 75 : 120,
        );
    }
  }
  // 折痕只出现在中界；几何和点击映射与横竖屏共用同一套坐标。
  const center = landscape ? width / 2 : height / 2;
  const fold = landscape
    ? ctx.createLinearGradient(center - 8, 0, center + 8, 0)
    : ctx.createLinearGradient(0, center - 8, 0, center + 8);
  fold.addColorStop(0, "rgba(0,0,0,0)");
  fold.addColorStop(0.47, "rgba(48,50,31,.16)");
  fold.addColorStop(0.53, "rgba(255,255,244,.35)");
  fold.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fold;
  if (landscape) ctx.fillRect(center - 8, 8, 16, height - 20);
  else ctx.fillRect(8, center - 8, width - 16, 16);
  return canvas;
}

export function boardShadow(landscape: boolean): HTMLCanvasElement {
  const w = (landscape ? BOARD_HEIGHT : BOARD_WIDTH) * 100;
  const h = (landscape ? BOARD_WIDTH : BOARD_HEIGHT) * 100;
  const pad = 12;
  const { canvas, ctx } = canvas2d(w + pad * 2, h + pad * 2);
  ctx.shadowColor = "rgba(31,34,23,.24)";
  ctx.shadowBlur = 9;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = "#aca997";
  ctx.fillRect(pad, pad, w, h);
  return canvas;
}
