/**
 * Procedural canvas textures for the billiards renderer: oak grain for the
 * frame, woven cloth for the playing surface, and a lit-sphere overlay for
 * the balls. Everything is generated once at mount and cached, so the cost
 * is paid on the first frame and never again.
 *
 * The noise kernel mirrors ../../go/texture-utils — a seeded lattice hash
 * feeding value noise and fbm — so the surface is identical on every launch
 * (no Math.random, nothing that could drift between two online peers).
 */
import { Texture } from "pixi.js";

// --- seeded noise ------------------------------------------------------

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

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext("2d")!];
}

// --- wood --------------------------------------------------------------

/** Rail hardwood, from the dark grain line to the lit fiber between rings. */
const WOOD_DARK: [number, number, number] = [46, 25, 14];
const WOOD_LIGHT: [number, number, number] = [134, 82, 45];

/**
 * Plank grain running along +x (the length of the long rails). Generated at
 * a reduced resolution and upscaled when painted — grain is smooth, so the
 * interpolation reads as polished wood rather than as blur.
 */
export function makeWoodCanvas(w: number, h: number): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(w, h);
  const image = ctx.createImageData(w, h);
  const data = image.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Waviness warps the rings so they drift like a sawn board instead of
      // running ruler-straight down the rail.
      const wave = Math.sin(x * 0.014 + fbm(x * 0.012, y * 0.012, 2) * 6) * 5;
      const gy = y + wave + (fbm(x * 0.005, y * 0.04, 2) - 0.5) * 20;

      const broad = fbm(x * 0.0016, gy * 0.007, 2);
      const fine = fbm(x * 0.004, gy * 0.09, 3);
      const fiber = valueNoise(x * 0.09, y * 0.75);
      let light =
        0.52 + (broad - 0.5) * 0.4 + (fine - 0.5) * 0.36 + (fiber - 0.5) * 0.08;

      // Thin dark growth rings, broken along their length so they read as
      // organic rather than printed.
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

// --- cloth -------------------------------------------------------------

/**
 * Worsted cloth base; the weave modulates around this. Exported because the
 * cushion jaw facings at a pocket mouth are the same cloth as the bed and
 * have to resolve to exactly this colour.
 */
export const CLOTH_BASE: [number, number, number] = [26, 104, 66];

const wrap = (v: number, period: number): number => ((v % period) + period) % period;

/** Value noise on a lattice that repeats every `period` cells. */
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

function periodicFbm(x: number, y: number, period: number, octaves: number): number {
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
 * One seamless tile of billiard cloth: a fine directional weave (warp over
 * weft) on a slow tonal drift from the nap. Every term repeats over the tile
 * so it can be laid down as a repeating pattern with no visible seam, which
 * keeps the weave at native resolution instead of upscaling one big bitmap.
 */
export function makeClothTile(size = 256): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(size, size);
  const image = ctx.createImageData(size, size);
  const data = image.data;
  /** Thread pairs across the tile — must divide `size` to stay seamless. */
  const THREADS = 128;
  /** Lattice cells across the tile for the low-frequency terms. */
  const CELLS = 8;
  const k = (Math.PI * 2 * THREADS) / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * CELLS;
      const v = (y / size) * CELLS;
      // Jitter is itself periodic, so the threads still meet at the seam.
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

// --- ball shading ------------------------------------------------------

/** Resolution of the shared sphere-shading overlay. */
const SHADE_TEX = 192;

let ballShading: Texture | null = null;

/**
 * A lit sphere painted per-pixel, drawn over every ball as a fixed view-space
 * overlay (the ball's own texture rolls beneath it; a real sphere's shading
 * does not move when it spins).
 *
 * Per pixel: Lambert diffuse from an overhead key light, a Blinn-Phong
 * specular for the phenolic gloss, and a soft bounce off the cloth along the
 * lower rim. It is generated per-pixel rather than stacked as translucent
 * circles because stacked circles band at the terminator.
 */
export function getBallShadingTexture(): Texture {
  if (ballShading) return ballShading;

  const size = SHADE_TEX;
  const [canvas, ctx] = makeCanvas(size, size);
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const c = (size - 1) / 2;

  // Key light (upper-left, in front) and the cloth bounce (lower-right).
  const kl = 1 / Math.hypot(-0.42, -0.54, 0.73);
  const lx = -0.42 * kl;
  const ly = -0.54 * kl;
  const lz = 0.73 * kl;
  // Half-vector for a viewer straight down the +z axis.
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

      // Darkening: how far this point falls short of full illumination.
      const diff = Math.max(0, nx * lx + ny * ly + nz * lz);
      const dark = clamp01(1 - AMBIENT - DIFFUSE * diff);

      // Gloss: a tight primary glint plus a broad sheen.
      const ndh = Math.max(0, nx * hx + ny * hy + nz * hz);
      const spec = Math.pow(ndh, 42) * 0.9 + Math.pow(ndh, 5) * 0.09;

      // Cloth bounce along the shadowed rim keeps the edge from going flat.
      const ndb = Math.max(0, nx * bx + ny * by + nz * bz);
      const bounce = Math.pow(ndb, 3) * (1 - nz) * 0.5;

      // Composite the light over the dark so a glint stays white at the core.
      const lightA = clamp01(spec + bounce);
      const darkA = dark * (1 - lightA);
      const alpha = clamp01(lightA + darkA);
      if (alpha <= 0.002) {
        data[o + 3] = 0;
        continue;
      }
      // Bounce carries a little cloth green; the key glint stays neutral.
      const mix = lightA > 0 ? clamp01(bounce / lightA) : 0;
      data[o] = (255 * (1 - mix) + 186 * mix) * (lightA / alpha);
      data[o + 1] = (255 * (1 - mix) + 226 * mix) * (lightA / alpha);
      data[o + 2] = (255 * (1 - mix) + 200 * mix) * (lightA / alpha);
      // Feather the last texel ring so the overlay edge is not stair-stepped.
      data[o + 3] = 255 * alpha * clamp01((1 - Math.sqrt(rr)) * c * 0.9);
    }
  }
  ctx.putImageData(image, 0, 0);
  ballShading = Texture.from(canvas);
  return ballShading;
}
