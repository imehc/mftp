import { CanvasSource, Texture } from "pixi.js";

import { makeBoardCanvas, makeStoneCanvas } from "../engine/board-textures";

export {
  makeBoardCanvas,
  makeStoneCanvas,
  STONE_CX,
  STONE_CY,
  STONE_R,
  STONE_TEX,
  WOOD_FULL,
  WOOD_PAD,
  WOOD_TEX,
} from "../engine/board-textures";

// 纹理在应用的整个生命周期内缓存：生成是开销最大的部分，而 v8 的
// TextureSource 会自行重新上传到需要的渲染器，因此能存活于 Application
// 卸载。因此销毁时务必不要向 app.destroy 传入 `texture: true`。
let boardTexture: Texture | null = null;
let stoneTextures: [Texture, Texture] | null = null;

function textureFrom(canvas: HTMLCanvasElement): Texture {
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

export function getBoardTexture(): Texture {
  boardTexture ??= textureFrom(makeBoardCanvas());
  return boardTexture;
}

export function getStoneTextures(): [Texture, Texture] {
  stoneTextures ??= [
    textureFrom(makeStoneCanvas(0)),
    textureFrom(makeStoneCanvas(1)),
  ];
  return stoneTextures;
}
