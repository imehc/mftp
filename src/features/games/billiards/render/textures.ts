/**
 * 台球渲染器的程序化画布纹理：木框的橡木纹理、台面的编织台呢，以及
 * 球的受光球面叠加。全部在挂载时生成一次并缓存，因此开销只付在首帧，
 * 之后不再重复。
 *
 * 噪声内核镜像自 ../../go/texture-utils——由带种子的栅格哈希驱动值噪声
 * 与 fbm——因此每次启动表面都完全一致（不用 Math.random，也就不会在
 * 两个联机对手间出现漂移）。
 */
import { Texture } from "pixi.js";

// --- 带种子噪声 --------------------------------------------------

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
const WOOD_DARK: [number, number, number] = [46, 25, 14];
const WOOD_LIGHT: [number, number, number] = [134, 82, 45];

/**
 * 沿 +x 方向（长 rails 的长度方向）延伸的木板纹理。以较低分辨率生成，
 * 绘制时再放大——纹理平滑，因此插值看起来像打磨过的木面而非模糊。
 */
export function makeWoodCanvas(w: number, h: number): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(w, h);
  const image = ctx.createImageData(w, h);
  const data = image.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 波纹让环纹扭曲，使其像锯开的木板而非沿 rail 笔直如尺。
      const wave = Math.sin(x * 0.014 + fbm(x * 0.012, y * 0.012, 2) * 6) * 5;
      const gy = y + wave + (fbm(x * 0.005, y * 0.04, 2) - 0.5) * 20;

      const broad = fbm(x * 0.0016, gy * 0.007, 2);
      const fine = fbm(x * 0.004, gy * 0.09, 3);
      const fiber = valueNoise(x * 0.09, y * 0.75);
      let light =
        0.52 + (broad - 0.5) * 0.4 + (fine - 0.5) * 0.36 + (fiber - 0.5) * 0.08;

      // 细密的深色年轮，沿其长度被打破，使其看起来自然而非印刷。
      const ring = gy * 0.06 + fbm(x * 0.018, y * 0.018, 2) * 1.3;
      const f = ring - Math.floor(ring);
      const edge = Math.min(f, 1 - f);
      const presence = 0.3 + 0.7 * valueNoise(x * 0.016, y * 0.05);
      light -= Math.max(0, 0.05 - edge) * 3.4 * presence;

      light = clamp01(light);
      const o = (y * w + x) * 4;
      data[o] = WOOD_DARK[0] + (WOOD_LIGHT[0] - WOOD_DARK[0]) * light;
      data[o + 1] = WOOD_DARK[1] + (WOOD_LIGHT[1] - WOOD_DARK[1]) * light;
      data[o + 2] = WOOD_DARK[2] + (WOOD_LIGHT[2] - WOOD_DARK[2]) * light;
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
export const CLOTH_BASE: [number, number, number] = [26, 104, 66];

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
export function makeClothTile(size = 256): HTMLCanvasElement {
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

      const shade = 1 + weave * 0.045 + drift * 0.14 + fiber * 0.06;
      const o = (y * size + x) * 4;
      data[o] = Math.min(255, CLOTH_BASE[0] * shade);
      data[o + 1] = Math.min(255, CLOTH_BASE[1] * shade);
      data[o + 2] = Math.min(255, CLOTH_BASE[2] * shade);
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// --- 球面明暗 --------------------------------------------------

/** 共用球面明暗叠加的分辨率。 */
const SHADE_TEX = 192;

let ballShading: Texture | null = null;

/**
 * 逐像素绘制的受光球面，作为固定视图空间叠加画在每个球上（球自身纹理
 * 在其下滚动；真实球面的明暗在自转时并不移动）。
 *
 * 逐像素：来自上方主光的 Lambert 漫反射、用于酚醛高光的 Blinn-Phong
 * 镜面反射，以及沿下缘从台呢反射的柔和反弹光。它逐像素生成而非叠加
 * 半透明圆，因为叠加圆会在明暗分界处出现条带。
 */
export function getBallShadingTexture(): Texture {
  if (ballShading) return ballShading;

  const size = SHADE_TEX;
  const [canvas, ctx] = makeCanvas(size, size);
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const c = (size - 1) / 2;

  // 主光（左上方、靠前）与台呢反弹光（右下方）。
  const kl = 1 / Math.hypot(-0.42, -0.54, 0.73);
  const lx = -0.42 * kl;
  const ly = -0.54 * kl;
  const lz = 0.73 * kl;
  // 视线沿 +z 轴直下的半程向量。
  const hn = 1 / Math.hypot(lx, ly, lz + 1);
  const hx = lx * hn;
  const hy = ly * hn;
  const hz = (lz + 1) * hn;
  const kb = 1 / Math.hypot(0.48, 0.62, 0.2);
  const bx = 0.48 * kb;
  const by = 0.62 * kb;
  const bz = 0.2 * kb;

  const AMBIENT = 0.62;
  const DIFFUSE = 0.38;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - c) / c;
      const ny = (y - c) / c;
      const rr = nx * nx + ny * ny;
      const o = (y * size + x) * 4;
      if (rr >= 1) {
        data[o + 3] = 0;
        continue;
      }
      const nz = Math.sqrt(1 - rr);

      // 变暗量：该点距完全照明的不足程度。
      const diff = Math.max(0, nx * lx + ny * ly + nz * lz);
      const dark = clamp01(1 - AMBIENT - DIFFUSE * diff);

      // 光泽：一束锐利的主高光加一层宽泛的光泽。
      const ndh = Math.max(0, nx * hx + ny * hy + nz * hz);
      const spec = Math.pow(ndh, 42) * 0.9 + Math.pow(ndh, 5) * 0.09;

      // 沿阴影边缘的台呢反弹光，避免边缘发死。
      const ndb = Math.max(0, nx * bx + ny * by + nz * bz);
      const bounce = Math.pow(ndb, 3) * (1 - nz) * 0.5;

      // 把光叠在暗之上，使高光核心保持白色。
      const lightA = clamp01(spec + bounce);
      const darkA = dark * (1 - lightA);
      const alpha = clamp01(lightA + darkA);
      if (alpha <= 0.002) {
        data[o + 3] = 0;
        continue;
      }
      // 反弹光带一点台呢绿；主高光保持中性。
      const mix = lightA > 0 ? clamp01(bounce / lightA) : 0;
      data[o] = (255 * (1 - mix) + 186 * mix) * (lightA / alpha);
      data[o + 1] = (255 * (1 - mix) + 226 * mix) * (lightA / alpha);
      data[o + 2] = (255 * (1 - mix) + 200 * mix) * (lightA / alpha);
      // 柔化最外圈像素，使叠加边缘不出现阶梯。
      data[o + 3] = 255 * alpha * clamp01((1 - Math.sqrt(rr)) * c * 0.9);
    }
  }
  ctx.putImageData(image, 0, 0);
  ballShading = Texture.from(canvas);
  return ballShading;
}
