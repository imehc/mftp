import { createRng } from "../../engine/ai";
import { valueNoise } from "../../engine/noise";
import type { Side } from "../types";

export function pieceTexture(
  label: string,
  side: Side | null,
  font: string,
  seed: number,
  landscape: boolean,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = landscape ? 256 : 384;
  canvas.height = landscape ? 384 : 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("junqi: canvas unavailable");
  const { width, height } = canvas;
  const x = 26,
    y = 20,
    w = width - 52,
    h = height - 66;
  const rng = createRng(seed);

  const shape = (offset: number, inset = 0) => {
    ctx.beginPath();
    ctx.roundRect(
      x + inset,
      y + offset + inset,
      w - inset * 2,
      h - inset * 2,
      9,
    );
  };

  // 阴影与厚度朝向固定光源；横竖屏只改变木块比例，不旋转烘焙光照。
  ctx.save();
  ctx.shadowColor = "rgba(39,30,18,.3)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#806344";
  shape(10);
  ctx.fill();
  ctx.restore();
  const edge = ctx.createLinearGradient(x, y, x + w, y + h + 12);
  edge.addColorStop(0, "#b49260");
  edge.addColorStop(0.8, "#ad8753");
  edge.addColorStop(1, "#88613a");
  ctx.fillStyle = edge;
  shape(9);
  ctx.fill();
  const bevel = ctx.createLinearGradient(x, y, x + w, y + h);
  bevel.addColorStop(0, "#f5e6c9");
  bevel.addColorStop(0.45, "#d7bd8e");
  bevel.addColorStop(1, "#b99561");
  ctx.fillStyle = bevel;
  shape(0);
  ctx.fill();
  ctx.save();
  shape(0, 5);
  ctx.clip();
  const face = ctx.createLinearGradient(x, y, x + w, y + h);
  face.addColorStop(0, "#eddbb8");
  face.addColorStop(0.6, "#e5cfaa");
  face.addColorStop(1, "#d9bf94");
  ctx.fillStyle = face;
  ctx.fillRect(x, y, w, h);
  // 稀疏、低对比的顺纹纹理，避免旧棋面上的密集条纹压住刻字。
  for (let n = 0; n < 90; n++) {
    const along = rng() * (landscape ? w : h);
    ctx.strokeStyle = `rgba(112,77,35,${0.015 + rng() * 0.035})`;
    ctx.lineWidth = 0.4 + rng() * 1.1;
    ctx.beginPath();
    for (let distance = 0; distance <= (landscape ? h : w); distance += 8) {
      const bend = (valueNoise(n * 0.25 + seed, distance * 0.008) - 0.5) * 12;
      const px = x + (landscape ? along + bend : distance);
      const py = y + (landscape ? distance : along + bend);
      if (distance === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,249,226,.7)";
  ctx.lineWidth = 1.5;
  shape(0, 4);
  ctx.stroke();

  if (!label) {
    // 暗棋以阵营色的窄框识别棋背，翻棋使用中性色；所有盖子共用相同纹理。
    ctx.strokeStyle = side === 0 ? "#922c23" : "#4d5148";
    ctx.lineWidth = 4;
    shape(0, 17);
    ctx.stroke();
    ctx.lineWidth = 2;
    shape(0, 24);
    ctx.stroke();
    return canvas;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const vertical = landscape && /\p{Script=Han}/u.test(label);
  const lines = vertical ? [...label] : [label];
  let size = vertical ? 108 : 104;
  const maxWidth = w - 24;
  ctx.font = `600 ${size}px ${font}`;
  while (
    lines.some((line) => ctx.measureText(line).width > maxWidth) &&
    size > 32
  ) {
    size -= 2;
    ctx.font = `600 ${size}px ${font}`;
  }
  lines.forEach((line, index) => {
    const cx = width / 2;
    const cy = y + h / 2 + (index - (lines.length - 1) / 2) * (size + 15);
    ctx.fillStyle = "rgba(255,249,223,.85)";
    ctx.fillText(line, cx + 0.7, cy + 1.6);
    ctx.fillStyle = side === 0 ? "#922c23" : "#2e3530";
    ctx.fillText(line, cx, cy);
  });
  return canvas;
}
