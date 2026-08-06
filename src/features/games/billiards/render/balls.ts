/**
 * Ball views: real 3D spheres.
 *
 * Each ball is a textured `Mesh` whose surface is an equirectangular painting
 * of the ball (color, stripe, number). The number is a fixed material point on
 * the sphere; rolling rotates a real 3×3 orientation matrix `R` (local→view),
 * and the mesh's per-vertex UVs are recomputed as `Rᵀ · N` so the number truly
 * rolls with the ball under a fixed top-down camera. Sphere shading is a static
 * overlay (a lit sphere under a fixed light does not change as it spins).
 */
import { Container, Graphics, Mesh, MeshGeometry, Sprite, Texture } from "pixi.js";
import { BALL_HEX } from "../colors";
import { BALL_RADIUS } from "../constants";
import type { BallState } from "../types";
import { px } from "./layout";
import { getBallShadingTexture } from "./textures";

/** Ball radius in pixels at root scale 1. */
const r = px(BALL_RADIUS);
/** Equirectangular texture resolution (2:1). */
const TEX_W = 256;
const TEX_H = 128;

/** 3×3 matrix, row-major. */
type Mat3 = number[];

const IDENT: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const clamp = (v: number, a: number, b: number): number =>
  Math.min(b, Math.max(a, v));

/** Multiply two row-major 3×3 matrices (a · b). */
function mat3mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 3 + j] =
        a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return out;
}

/** Rodrigues rotation matrix about unit `axis` by `angle` (row-major). */
function rodrigues(
  axis: [number, number, number],
  angle: number,
): Mat3 {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

/**
 * Paint the ball surface as an equirectangular texture: the whole sphere is
 * laid out with longitude→u, latitude→v, and the "front" point (facing the
 * camera at rest) at the texture center (u=0.5, v=0.5).
 */
function buildBallTexture(id: number): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d")!;
  const hex = BALL_HEX[id] ?? "#ffffff";
  const striped = id >= 9 && id <= 15;
  const base = striped || id === 0 ? "#f6f1e7" : hex;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  if (striped) {
    const bandH = TEX_H * 0.36;
    ctx.fillStyle = hex;
    ctx.fillRect(0, TEX_H / 2 - bandH / 2, TEX_W, bandH);
  }

  const cx = TEX_W / 2;
  const cy = TEX_H / 2;
  if (id === 0) {
    // Cue ball: small red dot.
    ctx.beginPath();
    ctx.arc(cx, cy, TEX_H * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = "#d93025";
    ctx.fill();
  } else {
    const rad = TEX_H * 0.2;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = "#f6f1e7";
    ctx.fill();
    ctx.fillStyle = "#1a1a1a";
    ctx.font = `bold ${Math.round(TEX_H * 0.26)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(id), cx, cy + 1);
  }

  const tex = Texture.from(canvas);
  // The texture is horizontally periodic (left/right edges are the same solid
  // color or stripe), so wrap in U to let per-triangle UVs cross the seam.
  tex.source.style.addressModeU = "repeat";
  tex.source.style.addressModeV = "clamp-to-edge";
  return tex;
}

/**
 * Build a disc geometry covering the front hemisphere of the ball. Crucially,
 * vertices are NOT shared between triangles: every triangle owns its three
 * vertices. That lets `updateUVs` wrap each triangle's longitude independently
 * so the equirectangular seam (lon = ±π) never smears a triangle across the
 * whole texture. Positions are in pixels (radius `r`); each vertex carries its
 * view-space unit normal `N` (fixed), used to derive UVs every frame.
 */
function buildDisc(radius: number, rings: number, seg: number) {
  const positions: number[] = [];
  const normals: Array<[number, number, number]> = [];
  const indices: number[] = [];

  const pushVert = (
    nx: number,
    ny: number,
    z: number,
    px: number,
    py: number,
  ): number => {
    positions.push(px, py);
    normals.push([nx, ny, z]);
    return normals.length - 1;
  };

  // Reusable ring vertex descriptors (position + normal).
  const ringData: Array<Array<{ nx: number; ny: number; z: number; px: number; py: number }>> =
    [];
  for (let ring = 1; ring <= rings; ring++) {
    const f = ring / rings;
    const z = Math.sqrt(Math.max(0, 1 - f * f));
    const arr: Array<{ nx: number; ny: number; z: number; px: number; py: number }> = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const nx = f * Math.cos(a);
      const ny = f * Math.sin(a);
      arr.push({ nx, ny, z, px: nx * radius, py: ny * radius });
    }
    ringData.push(arr);
  }

  // Center fan.
  for (let i = 0; i < seg; i++) {
    const a0 = ringData[0][i];
    const a1 = ringData[0][(i + 1) % seg];
    const c = pushVert(0, 0, 1, 0, 0);
    const v0 = pushVert(a0.nx, a0.ny, a0.z, a0.px, a0.py);
    const v1 = pushVert(a1.nx, a1.ny, a1.z, a1.px, a1.py);
    indices.push(c, v0, v1);
  }
  // Ring quads, each split into two triangles with their own vertices.
  for (let ring = 0; ring < rings - 1; ring++) {
    const inner = ringData[ring];
    const outer = ringData[ring + 1];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const i0 = pushVert(inner[i].nx, inner[i].ny, inner[i].z, inner[i].px, inner[i].py);
      const i1 = pushVert(inner[j].nx, inner[j].ny, inner[j].z, inner[j].px, inner[j].py);
      const o0 = pushVert(outer[i].nx, outer[i].ny, outer[i].z, outer[i].px, outer[i].py);
      const o1 = pushVert(outer[j].nx, outer[j].ny, outer[j].z, outer[j].px, outer[j].py);
      indices.push(i0, o0, i1, i1, o0, o1);
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(positions.length),
    indices: new Uint32Array(indices),
    normals,
  };
}

/**
 * Recompute UVs for the current orientation: localN = Rᵀ · N. Each triangle is
 * made internally continuous by wrapping its three vertices' longitudes into a
 * single ±π window around the triangle's first vertex, so the seam at lon = ±π
 * is never interpolated across the whole texture. The number is painted at
 * lon = 0, antipodal to the seam, so it is never split.
 */
function updateUVs(entry: BallEntry): void {
  const { R, normals, uvData, indexList } = entry;
  for (let t = 0; t < indexList.length; t += 3) {
    const i0 = indexList[t];
    const i1 = indexList[t + 1];
    const i2 = indexList[t + 2];
    const verts = [i0, i1, i2];
    // localN = Rᵀ · N for each corner.
    const ln = verts.map((vi) => {
      const n = normals[vi];
      const lx = R[0] * n[0] + R[3] * n[1] + R[6] * n[2];
      const ly = R[1] * n[0] + R[4] * n[1] + R[7] * n[2];
      const lz = R[2] * n[0] + R[5] * n[1] + R[8] * n[2];
      return { lx, ly, lz };
    });
    const refLon = Math.atan2(ln[0].lx, ln[0].lz);
    for (let q = 0; q < 3; q++) {
      let lon = Math.atan2(ln[q].lx, ln[q].lz);
      while (lon - refLon > Math.PI) lon -= Math.PI * 2;
      while (lon - refLon < -Math.PI) lon += Math.PI * 2;
      const lat = Math.asin(clamp(ln[q].ly, -1, 1));
      const vi = verts[q];
      uvData[vi * 2] = 0.5 + lon / (Math.PI * 2);
      uvData[vi * 2 + 1] = 0.5 + lat / Math.PI;
    }
  }
  entry.geometry.getBuffer("aUV").update();
}

interface BallEntry {
  mesh: Mesh;
  geometry: MeshGeometry;
  normals: Array<[number, number, number]>;
  uvData: Float32Array;
  /** Triangle vertex indices (per-triangle, non-shared vertices). */
  indexList: Uint32Array;
  /** Orientation matrix local→view (true 3D roll). */
  R: Mat3;
  dirty: boolean;
  lastX: number;
  lastY: number;
}

export interface BallLayer {
  layer: Container;
  /** View for one ball id (0–15). */
  view(id: number): Container | undefined;
  /** Move a ball view; `rolling` advances the 3D roll with it. */
  move(id: number, x: number, y: number, rolling: boolean): void;
  /** Snap every view to the resolved state (position, visibility). */
  sync(balls: BallState[]): void;
  /** No-op: the decal reflects the ball's true roll. */
  settleAll(): void;
}

export function createBallLayer(): BallLayer {
  const layer = new Container();
  const ballViews = new Map<number, Container>();
  const entries = new Map<number, BallEntry>();
  const RINGS = 10;
  const SEG = 48;

  function buildBall(id: number): Container {
    const view = new Container();

    // Contact shadow — stays on the cloth, not on the ball.
    const shadow = new Graphics();
    shadow
      .circle(r * 0.13, r * 0.17, r * 1.02)
      .fill({ color: 0x000000, alpha: 0.13 })
      .circle(r * 0.1, r * 0.14, r * 0.8)
      .fill({ color: 0x000000, alpha: 0.16 });
    view.addChild(shadow);

    // 3D sphere surface (textured mesh, UVs driven by the roll matrix).
    const disc = buildDisc(r, RINGS, SEG);
    const geometry = new MeshGeometry({
      positions: disc.positions,
      uvs: disc.uvs,
      indices: disc.indices,
    });
    const mesh = new Mesh({ geometry, texture: buildBallTexture(id) });
    view.addChild(mesh);

    // Fixed sphere shading: one shared lit-sphere overlay (diffuse falloff,
    // gloss, cloth bounce). It does not spin with the ball — a lit sphere
    // under a fixed light looks the same however it rolls.
    const shading = new Sprite(getBallShadingTexture());
    shading.anchor.set(0.5);
    shading.width = r * 2;
    shading.height = r * 2;
    // The cue ball is unnumbered and pure white, so it reads glossier.
    shading.alpha = id === 0 ? 1 : 0.92;
    view.addChild(shading);

    const entry: BallEntry = {
      mesh,
      geometry,
      normals: disc.normals,
      uvData: geometry.uvs,
      indexList: disc.indices,
      R: IDENT.slice(),
      dirty: true,
      lastX: 0,
      lastY: 0,
    };
    // Initial UVs (rest orientation).
    updateUVs(entry);
    entries.set(id, entry);
    return view;
  }

  function moveBallView(
    id: number,
    x: number,
    y: number,
    rolling: boolean,
  ): void {
    const view = ballViews.get(id);
    if (!view) return;
    view.position.set(px(x), px(y));
    const entry = entries.get(id);
    if (!entry) return;
    if (rolling) {
      const dx = x - entry.lastX;
      const dy = y - entry.lastY;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-6) {
        // Roll axis is perpendicular to travel: top surface moves forward.
        const axis: [number, number, number] = [
          -dy / dist,
          dx / dist,
          0,
        ];
        const dR = rodrigues(axis, dist / BALL_RADIUS);
        entry.R = mat3mul(dR, entry.R);
        entry.dirty = true;
      }
    }
    if (entry.dirty) {
      updateUVs(entry);
      entry.dirty = false;
    }
    entry.lastX = x;
    entry.lastY = y;
  }

  for (let id = 0; id <= 15; id++) {
    const view = buildBall(id);
    view.visible = false;
    ballViews.set(id, view);
    layer.addChild(view);
  }

  return {
    layer,
    view: (id) => ballViews.get(id),
    move: moveBallView,
    sync(balls) {
      for (const ball of balls) {
        const view = ballViews.get(ball.id);
        if (!view) continue;
        view.visible = !ball.potted;
        view.scale.set(1);
        view.alpha = 1;
        moveBallView(ball.id, ball.x, ball.y, false);
      }
    },
    settleAll() {
      /* number reflects the ball's true roll — nothing to recenter */
    },
  };
}
