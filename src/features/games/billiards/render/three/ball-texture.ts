import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

import type { BallDefinition } from "../../ball-definitions";
import { ballSurfaceAtUV } from "./ball-surface";

const TEX_W = 1024;
const TEX_H = 512;

/**
 * 将球表面绘制成等距柱状贴图：整球按经度→u、纬度→v 展开，静止时
 * 朝向相机的“正面”点位于贴图中心（u=0.5, v=0.5）。
 */
export function buildBallTexture(definition: BallDefinition): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d")!;
  const { color: hex, striped } = definition;
  const base = striped ? "#f8f3dd" : hex;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  if (striped) {
    const bandH = TEX_H * 0.44;
    ctx.fillStyle = hex;
    ctx.fillRect(0, TEX_H / 2 - bandH / 2, TEX_W, bandH);
  }

  // 微弱的表面色差为纯色球提供可跟随的滚动线索；号码和圆斑随后绘制，保持边缘清晰。
  const surface = ctx.getImageData(0, 0, TEX_W, TEX_H);
  for (let y = 0; y < TEX_H; y++) {
    for (let x = 0; x < TEX_W; x++) {
      const variation = ballSurfaceAtUV((x + 0.5) / TEX_W, (y + 0.5) / TEX_H);
      const offset = (y * TEX_W + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const value = surface.data[offset + channel];
        surface.data[offset + channel] =
          value * (1 + variation * 0.16) + variation * 2;
      }
    }
  }
  ctx.putImageData(surface, 0, 0);

  const cx = TEX_W / 2;
  const cy = TEX_H / 2;
  if (definition.spottedCue) {
    // 六个球面等大圆斑分别朝向 ±X、±Y、±Z，避免极点与经度接缝拉伸。
    // 纹理只构建一次；滚动沿用球面 UV，不在每帧重绘。
    const pixels = ctx.getImageData(0, 0, TEX_W, TEX_H);
    const edge = Math.cos(0.15);
    for (let y = 0; y < TEX_H; y++) {
      const latitude = ((y + 0.5) / TEX_H - 0.5) * Math.PI;
      for (let x = 0; x < TEX_W; x++) {
        const longitude = ((x + 0.5) / TEX_W - 0.5) * Math.PI * 2;
        const horizontal = Math.cos(latitude);
        const axis = Math.max(
          Math.abs(horizontal * Math.sin(longitude)),
          Math.abs(Math.sin(latitude)),
          Math.abs(horizontal * Math.cos(longitude)),
        );
        const coverage = Math.max(0, Math.min(1, (axis - edge) / 0.003 + 0.5));
        const offset = (y * TEX_W + x) * 4;
        for (const [channel, value] of [217, 48, 37].entries()) {
          pixels.data[offset + channel] +=
            (value - pixels.data[offset + channel]) * coverage;
        }
      }
    }
    ctx.putImageData(pixels, 0, 0);
  } else if (definition.number !== null) {
    const rad = TEX_H * 0.125;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = "#f8f3dd";
    ctx.fill();
    ctx.fillStyle = "#1a1a1a";
    ctx.font = `bold ${Math.round(TEX_H * 0.2)}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(definition.number), cx, cy + 1);
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  // 贴图在水平方向是周期性的（左右边缘是同样的纯色或条纹），因此在 U
  // 方向采用重复寻址，让逐三角形的 UV 可以跨过接缝。
  tex.wrapS = RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
