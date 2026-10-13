import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EQUIPMENT } from "../../equipment";
import { createTableMaterials } from "./materials";
import { createResources } from "./resources";

const mocks = vi.hoisted(() => {
  const pixels = () => ({ data: new Uint8ClampedArray(4 * 4 * 4) });
  const context = {
    getImageData: pixels,
    createImageData: pixels,
    putImageData: vi.fn(),
  };
  const canvas = () => ({ width: 4, height: 4, getContext: () => context });
  return { canvas };
});

vi.mock("./surface-textures", () => ({
  makeClothTile: mocks.canvas,
  makeWoodCanvas: mocks.canvas,
  makeMetalTile: mocks.canvas,
}));

const resources = createResources();

beforeEach(() => {
  vi.stubGlobal("document", { createElement: mocks.canvas });
});

afterEach(() => {
  resources.dispose();
  vi.unstubAllGlobals();
});

describe("球桌材质高光", () => {
  it("斯诺克木框减弱镜面漆层，保留台呢参数与木纹颜色", () => {
    const materials = createTableMaterials(resources, EQUIPMENT.snooker);
    expect(materials.wood.roughness).toBe(0.6);
    expect(materials.wood.clearcoat).toBe(0.15);
    expect(materials.wood.clearcoatRoughness).toBe(0.45);
    expect(materials.wood.color.getHex()).toBe(0xffffff);
    expect(materials.wood.map).not.toBeNull();
    expect(materials.cloth.roughness).toBe(0.95);
    expect(materials.cloth.normalScale.toArray()).toEqual([0.09, 0.09]);
    expect(materials.cloth.color.getHex()).toBe(0xffffff);
  });

  it.each(["chinese-eight", "american-nine"] as const)(
    "%s 保留原有木框漆面与台呢参数",
    (id) => {
      const materials = createTableMaterials(resources, EQUIPMENT[id]);
      expect(materials.wood.roughness).toBe(0.3);
      expect(materials.wood.clearcoat).toBe(0.65);
      expect(materials.wood.clearcoatRoughness).toBe(0.14);
      expect(materials.cloth.roughness).toBe(0.95);
    },
  );
});
