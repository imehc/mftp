import type { PieceSymbol } from "chess.js";
import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const modelUrl = new URL("../assets/staunton.glb", import.meta.url).href;
const grainUrl = new URL("../assets/wood-grain.png", import.meta.url).href;
const roughUrl = new URL("../assets/wood-roughness.png", import.meta.url).href;
const names: Record<PieceSymbol, string> = {
  p: "pawn",
  r: "rook",
  n: "knight",
  b: "bishop",
  q: "queen",
  k: "king",
};

export async function loadChessAssets() {
  const jobs = await Promise.allSettled([
    new GLTFLoader().loadAsync(modelUrl),
    new TextureLoader().loadAsync(grainUrl),
    new TextureLoader().loadAsync(roughUrl),
  ]);
  const geometries = new Set<BufferGeometry>(),
    textures = new Set<Texture>();
  const gltf = jobs[0].status === "fulfilled" ? jobs[0].value : null;
  gltf?.scene.traverse((object) => {
    if (object instanceof Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        material.dispose();
    }
  });
  for (const job of jobs.slice(1))
    if (job.status === "fulfilled") textures.add(job.value as Texture);

  const disposeRaw = () => {
    for (const item of geometries) item.dispose();
    for (const item of textures) item.dispose();
  };

  if (jobs.some((job) => job.status === "rejected") || !gltf) {
    disposeRaw();
    throw new Error("Chess asset loading failed");
  }
  const grain = (jobs[1] as PromiseFulfilledResult<Texture>).value;
  const rough = (jobs[2] as PromiseFulfilledResult<Texture>).value;
  grain.colorSpace = SRGBColorSpace;
  grain.wrapS = grain.wrapT = rough.wrapS = rough.wrapT = RepeatWrapping;
  grain.anisotropy = 4;
  const white = new MeshPhysicalMaterial({
    color: 0xe2cdb2,
    vertexColors: true,
    map: grain,
    roughness: 0.72,
    roughnessMap: rough,
    clearcoat: 0.1,
    clearcoatRoughness: 0.55,
    bumpMap: rough,
    bumpScale: 0.006,
  });
  const black = new MeshPhysicalMaterial({
    color: 0x3b3630,
    vertexColors: true,
    map: grain,
    roughness: 0.68,
    roughnessMap: rough,
    clearcoat: 0.12,
    clearcoatRoughness: 0.5,
    bumpMap: rough,
    bumpScale: 0.006,
  });
  const boardLight = new MeshStandardMaterial({
    color: 0xcfb88f,
    map: grain,
    roughness: 0.78,
    roughnessMap: rough,
  });
  const boardDark = new MeshStandardMaterial({
    color: 0x765740,
    map: grain,
    roughness: 0.75,
    roughnessMap: rough,
  });
  const frame = new MeshPhysicalMaterial({
    color: 0x493222,
    map: grain,
    roughness: 0.62,
    clearcoat: 0.1,
  });
  const materials = [white, black, boardLight, boardDark, frame];

  const createPiece = (kind: PieceSymbol, color: "w" | "b") => {
    const template = gltf.scene.getObjectByName(names[kind]);
    if (!(template instanceof Mesh))
      throw new Error("Missing chess model: " + kind);
    const mesh = new Mesh(template.geometry, color === "w" ? white : black);
    mesh.castShadow = mesh.receiveShadow = true;
    if (color === "b") mesh.rotation.y = Math.PI;
    return mesh;
  };

  // 提前校验，失败由同一个生命周期释放加载到一半的资源。
  try {
    for (const kind of Object.keys(names) as PieceSymbol[])
      createPiece(kind, "w");
  } catch (error) {
    materials.forEach((item) => item.dispose());
    disposeRaw();
    throw error;
  }

  function createBoard() {
    const board = new Group();
    const baseGeo = new RoundedBoxGeometry(9.1, 0.28, 9.1, 3, 0.055);
    geometries.add(baseGeo);
    const base = new Mesh(baseGeo, frame);
    base.position.y = -0.19;
    base.receiveShadow = base.castShadow = true;
    board.add(base);
    const trimGeo = new BoxGeometry(8.12, 0.035, 8.12);
    geometries.add(trimGeo);
    const trim = new Mesh(trimGeo, boardLight);
    trim.position.y = -0.047;
    board.add(trim);
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 8; col++) {
        // 每块木片从纹理的不同位置取样，避免整盘出现重复的印刷图案。
        const squareGeo = new BoxGeometry(0.998, 0.025, 0.998);
        const uv = squareGeo.getAttribute("uv");
        for (let index = 0; index < uv.count; index++) {
          uv.setXY(
            index,
            uv.getX(index) * 0.45 + col * 0.137 + row * 0.19,
            uv.getY(index) * 0.6 + row * 0.173,
          );
        }
        geometries.add(squareGeo);
        const square = new Mesh(
          squareGeo,
          (row + col) % 2 === 0 ? boardLight : boardDark,
        );
        square.position.set(col - 3.5, -0.0175, row - 3.5);
        square.receiveShadow = true;
        board.add(square);
      }
    // 坐标属于棋盘刻字，用真实文字栅格化；四边都能读取。
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.font = "500 22px Georgia";
      ctx.fillStyle = "#dfc6a1";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const margin = 1024 * 0.5,
        unit = 1024 / 9.1;
      for (let index = 0; index < 8; index++) {
        const coordinate = margin + (index - 3.5) * unit;
        ctx.fillText("abcdefgh"[index], coordinate, margin + 4.28 * unit);
        ctx.save();
        ctx.translate(coordinate, margin - 4.28 * unit);
        ctx.rotate(Math.PI);
        ctx.fillText("abcdefgh"[index], 0, 0);
        ctx.restore();
        ctx.fillText(String(8 - index), margin - 4.28 * unit, coordinate);
        ctx.save();
        ctx.translate(margin + 4.28 * unit, coordinate);
        ctx.rotate(Math.PI);
        ctx.fillText(String(8 - index), 0, 0);
        ctx.restore();
      }
      const map = new CanvasTexture(canvas);
      map.colorSpace = SRGBColorSpace;
      textures.add(map);
      const mat = new MeshStandardMaterial({
        map,
        transparent: true,
        roughness: 0.7,
        depthWrite: false,
      });
      materials.push(mat);
      const geo = new PlaneGeometry(9.1, 9.1);
      geometries.add(geo);
      // 只让顶面承载字图，其余侧面由木框负责。
      const label = new Mesh(geo, mat);
      label.rotation.x = -Math.PI / 2;
      label.position.y = -0.049;
      board.add(label);
    }
    return board;
  }

  return {
    createPiece,
    createBoard,
    dispose: () => {
      materials.forEach((item) => item.dispose());
      disposeRaw();
    },
  };
}

export type ChessAssets = Awaited<ReturnType<typeof loadChessAssets>>;
