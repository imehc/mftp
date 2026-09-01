/**
 * 球的视图：真正的 3D 球面。
 *
 * 每个球是一张带纹理的 `Mesh`，其表面是球的等距柱状投影贴图
 * （颜色、条纹、数字）。数字固定在球面材质上的某一点；滚动时旋转真实的
 * 3×3 朝向矩阵 `R`（局部→视图），网格逐顶点 UV 重新计算为 `Rᵀ · N`，
 * 使数字在固定俯视相机下随球真正滚动。球面明暗是一层静态叠加
 * （受固定光照的球体在自转时外观不变）。
 */
import {
  Container,
  Graphics,
  Mesh,
  MeshGeometry,
  Sprite,
  Texture,
} from "pixi.js";
import { BALL_HEX } from "../colors";
import { BALL_RADIUS } from "../constants";
import type { BallState } from "../types";
import { px } from "./layout";
import { getBallShadingTexture } from "./textures";

/** 根缩放为 1 时球的像素半径。 */
const r = px(BALL_RADIUS);
/** 等距柱状贴图分辨率（2:1）。 */
const TEX_W = 256;
const TEX_H = 128;

/** 3×3 矩阵，行主序。 */
type Mat3 = number[];

const IDENT: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const clamp = (v: number, a: number, b: number): number =>
  Math.min(b, Math.max(a, v));

/** 两个行主序 3×3 矩阵相乘 (a · b)。 */
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

/** 绕单位向量 `axis` 旋转 `angle` 的罗德里格斯矩阵（行主序）。 */
function rodrigues(axis: [number, number, number], angle: number): Mat3 {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
}

/**
 * 将球表面绘制成等距柱状贴图：整球按经度→u、纬度→v 展开，静止时
 * 朝向相机的“正面”点位于贴图中心（u=0.5, v=0.5）。
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
    // 母球：一个小红点。
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
  // 贴图在水平方向是周期性的（左右边缘是同样的纯色或条纹），因此在 U
  // 方向采用重复寻址，让逐三角形的 UV 可以跨过接缝。
  tex.source.style.addressModeU = "repeat";
  tex.source.style.addressModeV = "clamp-to-edge";
  return tex;
}

/**
 * 构建覆盖球前半球的一张圆盘几何。关键在于：三角形之间不共享顶点，
 * 每个三角形独占它的三个顶点。这样 `updateUVs` 可以各自独立地包裹每个
 * 三角形的经度，使等距柱状接缝（lon = ±π）绝不会把一个三角形抹到
 * 整个贴图上。位置以像素为单位（半径 `r`）；每个顶点携带固定的视图空间
 * 单位法线 `N`，用于每帧推导 UV。
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

  // 可复用的环顶点描述（位置 + 法线）。
  const ringData: Array<
    Array<{ nx: number; ny: number; z: number; px: number; py: number }>
  > = [];
  for (let ring = 1; ring <= rings; ring++) {
    const f = ring / rings;
    const z = Math.sqrt(Math.max(0, 1 - f * f));
    const arr: Array<{
      nx: number;
      ny: number;
      z: number;
      px: number;
      py: number;
    }> = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const nx = f * Math.cos(a);
      const ny = f * Math.sin(a);
      arr.push({ nx, ny, z, px: nx * radius, py: ny * radius });
    }
    ringData.push(arr);
  }

  // 中心扇形。
  for (let i = 0; i < seg; i++) {
    const a0 = ringData[0][i];
    const a1 = ringData[0][(i + 1) % seg];
    const c = pushVert(0, 0, 1, 0, 0);
    const v0 = pushVert(a0.nx, a0.ny, a0.z, a0.px, a0.py);
    const v1 = pushVert(a1.nx, a1.ny, a1.z, a1.px, a1.py);
    indices.push(c, v0, v1);
  }
  // 环形四边形，每个拆成两个各自拥有顶点的三角形。
  for (let ring = 0; ring < rings - 1; ring++) {
    const inner = ringData[ring];
    const outer = ringData[ring + 1];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const i0 = pushVert(
        inner[i].nx,
        inner[i].ny,
        inner[i].z,
        inner[i].px,
        inner[i].py,
      );
      const i1 = pushVert(
        inner[j].nx,
        inner[j].ny,
        inner[j].z,
        inner[j].px,
        inner[j].py,
      );
      const o0 = pushVert(
        outer[i].nx,
        outer[i].ny,
        outer[i].z,
        outer[i].px,
        outer[i].py,
      );
      const o1 = pushVert(
        outer[j].nx,
        outer[j].ny,
        outer[j].z,
        outer[j].px,
        outer[j].py,
      );
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
 * 为当前朝向重算 UV：localN = Rᵀ · N。将每个三角形三个顶点的经度包裹到
 * 以首顶点为中心的单一 ±π 窗口内，使三角形内部连续，这样 lon = ±π 处
 * 的接缝绝不会被插值到整个贴图上。数字绘制在 lon = 0（与接缝相对的另一
 * 极），因此永远不会被切开。
 */
function updateUVs(entry: BallEntry): void {
  const { R, normals, uvData, indexList } = entry;
  for (let t = 0; t < indexList.length; t += 3) {
    const i0 = indexList[t];
    const i1 = indexList[t + 1];
    const i2 = indexList[t + 2];
    const verts = [i0, i1, i2];
    // 每个角点：localN = Rᵀ · N。
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
  /** 三角形顶点索引（逐三角形，非共享顶点）。 */
  indexList: Uint32Array;
  /** 朝向矩阵 局部→视图（真正的 3D 滚动）。 */
  R: Mat3;
  dirty: boolean;
  lastX: number;
  lastY: number;
}

export interface BallLayer {
  layer: Container;
  /** 单个球 id（0–15）的视图。 */
  view(id: number): Container | undefined;
  /** 移动球视图；`rolling` 会随之推进 3D 滚动。 */
  move(id: number, x: number, y: number, rolling: boolean): void;
  /** 把所有视图对齐到结算状态（位置、可见性）。 */
  sync(balls: BallState[]): void;
  /** 空操作：贴花已反映球的真实滚动。 */
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

    // 接触阴影——留在台呢上，而非球上。
    const shadow = new Graphics();
    shadow
      .circle(r * 0.13, r * 0.17, r * 1.02)
      .fill({ color: 0x000000, alpha: 0.13 })
      .circle(r * 0.1, r * 0.14, r * 0.8)
      .fill({ color: 0x000000, alpha: 0.16 });
    view.addChild(shadow);

    // 3D 球面（带纹理网格，UV 由滚动矩阵驱动）。
    const disc = buildDisc(r, RINGS, SEG);
    const geometry = new MeshGeometry({
      positions: disc.positions,
      uvs: disc.uvs,
      indices: disc.indices,
    });
    const mesh = new Mesh({ geometry, texture: buildBallTexture(id) });
    view.addChild(mesh);

    // 固定球面明暗：一层共享的受光球面叠加（漫反射衰减、高光、台呢
    // 反射）。它不随球自转——受固定光照的球体无论怎么滚外观都一样。
    const shading = new Sprite(getBallShadingTexture());
    shading.anchor.set(0.5);
    shading.width = r * 2;
    shading.height = r * 2;
    // 母球无数字且纯白，因此看起来更亮。
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
    // 初始 UV（静止朝向）。
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
        // 滚动轴垂直于运动方向：顶面朝前滚动。
        const axis: [number, number, number] = [-dy / dist, dx / dist, 0];
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
      /* 数字已反映球的真实滚动——无需重新居中 */
    },
  };
}
