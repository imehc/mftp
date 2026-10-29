import { CanvasSource, Texture } from "pixi.js";

import {
  makeBoardCanvas,
  makeStoneCanvas,
  WOOD_FULL,
  WOOD_TEX,
} from "../engine/board-textures";

export {
  STONE_TEX as STONE_TEXTURE_SIZE,
  STONE_R as STONE_RADIUS,
  STONE_CY as STONE_CENTER_Y,
} from "../engine/board-textures";

export const BOARD_TEXTURE_SCALE = WOOD_FULL / WOOD_TEX;

// 纹理生成开销大。模块级缓存能存活于舞台卸载，并在新建渲染器时
// 由 Pixi 再次上传其来源。
let boardTexture: Texture | null = null;
let stoneTextures: [Texture, Texture] | null = null;

function textureFrom(canvas: HTMLCanvasElement): Texture {
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

export function getGomokuTextures(): {
  boardTexture: Texture;
  stoneTextures: [Texture, Texture];
} {
  boardTexture ??= textureFrom(makeBoardCanvas());
  stoneTextures ??= [
    textureFrom(makeStoneCanvas(0)),
    textureFrom(makeStoneCanvas(1)),
  ];
  return { boardTexture, stoneTextures };
}
