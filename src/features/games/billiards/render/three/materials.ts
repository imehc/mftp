import {
  CanvasTexture,
  DoubleSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
} from "three";

import type { TableEquipment } from "../../equipment";
import { tableAppearance } from "./appearance";
import type { Resources } from "./resources";
import {
  makeClothTile,
  makeMetalTile,
  makeWoodCanvas,
} from "./surface-textures";

export function createTableMaterials(
  resources: Resources,
  equipment: TableEquipment,
) {
  const appearance = tableAppearance(equipment.id);
  const snooker = equipment.id === "snooker";
  const clothCanvas = makeClothTile(512, appearance.cloth);
  const ctx = clothCanvas.getContext("2d")!;
  const { width, height } = clothCanvas;
  const source = ctx.getImageData(0, 0, width, height);
  const normal = ctx.createImageData(width, height);
  const sample = (x: number, y: number) =>
    source.data[
      (((y + height) % height) * width + ((x + width) % width)) * 4 + 1
    ] / 255;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n = (y * width + x) * 4;
      normal.data[n] = 128 + (sample(x - 1, y) - sample(x + 1, y)) * 600;
      normal.data[n + 1] = 128 + (sample(x, y - 1) - sample(x, y + 1)) * 600;
      normal.data[n + 2] = 255;
      normal.data[n + 3] = 255;
    }
  }
  const normalCanvas = document.createElement("canvas");
  normalCanvas.width = width;
  normalCanvas.height = height;
  normalCanvas.getContext("2d")!.putImageData(normal, 0, 0);
  const clothMap = resources.own(new CanvasTexture(clothCanvas));
  clothMap.colorSpace = SRGBColorSpace;
  clothMap.wrapS = clothMap.wrapT = RepeatWrapping;
  clothMap.repeat.set(8, 8);
  clothMap.anisotropy = 8;
  const normalMap = resources.own(new CanvasTexture(normalCanvas));
  normalMap.wrapS = normalMap.wrapT = RepeatWrapping;
  normalMap.repeat.set(8, 8);
  normalMap.anisotropy = 8;
  const cloth = resources.own(
    new MeshStandardMaterial({
      map: clothMap,
      normalMap,
      normalScale: new Vector2(0.09, 0.09),
      roughness: 0.95,
    }),
  );
  const woodMap = resources.own(
    new CanvasTexture(
      makeWoodCanvas(1024, 512, appearance.woodDark, appearance.woodLight),
    ),
  );
  woodMap.colorSpace = SRGBColorSpace;
  woodMap.wrapS = woodMap.wrapT = RepeatWrapping;
  woodMap.repeat.set(0.7, 3);
  woodMap.anisotropy = 8;
  const wood = resources.own(
    new MeshPhysicalMaterial({
      map: woodMap,
      roughness: snooker ? 0.6 : 0.3,
      clearcoat: snooker ? 0.15 : 0.65,
      clearcoatRoughness: snooker ? 0.45 : 0.14,
    }),
  );
  const pocket = resources.own(
    new MeshStandardMaterial({
      color: 0x08090a,
      roughness: 0.6,
      side: DoubleSide,
    }),
  );
  const pocketFloor = resources.own(
    new MeshStandardMaterial({ color: 0x010101, roughness: 1 }),
  );
  const metalMap = resources.own(new CanvasTexture(makeMetalTile()));
  metalMap.colorSpace = SRGBColorSpace;
  metalMap.wrapS = metalMap.wrapT = RepeatWrapping;
  metalMap.repeat.set(8, 8);
  metalMap.anisotropy = 8;
  const metal = resources.own(
    new MeshPhysicalMaterial({
      map: metalMap,
      color: appearance.metal,
      metalness: 0.8,
      roughness: 0.4,
      clearcoat: 0.22,
      clearcoatRoughness: 0.3,
    }),
  );
  const rim = metal;
  const slate = resources.own(
    new MeshStandardMaterial({ color: 0x363a3c, roughness: 0.96 }),
  );
  const net = resources.own(
    new MeshStandardMaterial({ color: appearance.net, roughness: 1 }),
  );
  const inlay = resources.own(
    new MeshStandardMaterial({
      color: 0xeee2cb,
      metalness: 0.1,
      roughness: 0.4,
    }),
  );
  return { cloth, wood, pocket, pocketFloor, rim, metal, slate, net, inlay };
}
