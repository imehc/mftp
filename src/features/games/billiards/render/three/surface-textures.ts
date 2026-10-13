import { fbm, hash2, valueNoise } from "../../../engine/noise";

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function makeCanvas(
  w: number,
  h: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext("2d")!];
}

// --- 木面纹理 --------------------------------------------------------------

/** 库边硬木：从深色纹理线到环纹之间受光的木纤维。 */
const WOOD_DARK: [number, number, number] = [20, 5, 2];
const WOOD_LIGHT: [number, number, number] = [106, 40, 18];

/**
 * 沿 +x 方向（长 rails 的长度方向）延伸的木板纹理。以较低分辨率生成，
 * 绘制时再放大——纹理平滑，因此插值看起来像打磨过的木面而非模糊。
 */
export function makeWoodCanvas(
  w: number,
  h: number,
  dark: readonly number[] = WOOD_DARK,
  lightColor: readonly number[] = WOOD_LIGHT,
): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(w, h);
  const image = ctx.createImageData(w, h);
  const data = image.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 波纹让环纹扭曲，使其像锯开的木板而非沿 rail 笔直如尺。
      const wave = Math.sin(x * 0.014 + fbm(x * 0.012, y * 0.012, 2) * 10) * 12;
      const gy = y + wave + (fbm(x * 0.005, y * 0.04, 2) - 0.5) * 48;

      const broad = fbm(x * 0.0016, gy * 0.007, 2);
      const fine = fbm(x * 0.014, gy * 0.16, 3);
      const fiber = valueNoise(x * 0.09, y * 0.75);
      let light =
        0.52 +
        (broad - 0.5) * 0.85 +
        (fine - 0.5) * 0.55 +
        (fiber - 0.5) * 0.08;

      // 细密的深色年轮，沿其长度被打破，使其看起来自然而非印刷。
      const ring = gy * 0.06 + fbm(x * 0.018, y * 0.018, 2) * 1.3;
      const f = ring - Math.floor(ring);
      const edge = Math.min(f, 1 - f);
      const presence = 0.3 + 0.7 * valueNoise(x * 0.016, y * 0.05);
      light -= Math.max(0, 0.05 - edge) * 3.4 * presence;

      light = clamp01(light);
      const o = (y * w + x) * 4;
      data[o] = dark[0] + (lightColor[0] - dark[0]) * light;
      data[o + 1] = dark[1] + (lightColor[1] - dark[1]) * light;
      data[o + 2] = dark[2] + (lightColor[2] - dark[2]) * light;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// --- 台呢 -------------------------------------------------------

/**
 * 精纺台呢基色；编织纹理围绕它波动。导出是因为袋口处的库边颚面与台面
 * 是同一种台呢，必须正好落到这个颜色。
 */
export const CLOTH_BASE: [number, number, number] = [3, 80, 60];

const wrap = (v: number, period: number): number =>
  ((v % period) + period) % period;

/** 在每隔 `period` 个格点重复一次的栅格上的值噪声。 */
function periodicNoise(x: number, y: number, period: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = wrap(ix, period);
  const y0 = wrap(iy, period);
  const x1 = wrap(ix + 1, period);
  const y1 = wrap(iy + 1, period);
  const a = hash2(x0, y0);
  const b = hash2(x1, y0);
  const c = hash2(x0, y1);
  const d = hash2(x1, y1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function periodicFbm(
  x: number,
  y: number,
  period: number,
  octaves: number,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const f = 1 << i;
    sum += amp * periodicNoise(x * f, y * f, period * f);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * 一块无缝的台呢贴图：在绒毛缓慢色调漂移之上叠一层细密的方向性织纹
 * （经线压纬线）。每一项在贴图内重复，因此可作为重复图案平铺而看不到
 * 接缝，也让织纹保持原始分辨率，而非放大一整张大位图。
 */
export function makeClothTile(
  size = 256,
  color: readonly number[] = CLOTH_BASE,
): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(size, size);
  const image = ctx.createImageData(size, size);
  const data = image.data;
  /** 贴图内的线对——必须能整除 `size` 才能保持无缝。 */
  const THREADS = 128;
  /** 贴图内用于低频项的栅格格点数。 */
  const CELLS = 8;
  const k = (Math.PI * 2 * THREADS) / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * CELLS;
      const v = (y / size) * CELLS;
      // 抖动本身也是周期的，因此线在接缝处仍能对齐。
      const jx = periodicNoise((x / size) * 64, (y / size) * 64, 64) - 0.5;
      const jy = periodicNoise((y / size) * 64, (x / size) * 64, 64) - 0.5;
      const warp = Math.sin((x + jx * 1.5) * k);
      const weft = Math.sin((y + jy * 1.5) * k);
      const weave = warp * weft * 0.5;

      const drift = periodicFbm(u, v, CELLS, 3) - 0.5;
      const fiber = periodicNoise((x / size) * 96, (y / size) * 96, 96) - 0.5;

      const nap = hash2(x, y) - 0.5;
      const shade = 1 + weave * 0.08 + drift * 0.045 + fiber * 0.15 + nap * 0.2;
      const o = (y * size + x) * 4;
      data[o] = Math.min(255, color[0] * shade);
      data[o + 1] = Math.min(255, color[1] * shade);
      data[o + 2] = Math.min(255, color[2] * shade);
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** 银色护角的细磨砂，不与木纹或台呢织纹混用。 */
export function makeMetalTile(size = 256): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(size, size);
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain = periodicNoise((x / size) * 128, (y / size) * 128, 128);
      const value = 148 + (grain - 0.5) * 12;
      const offset = (y * size + x) * 4;
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value;
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
