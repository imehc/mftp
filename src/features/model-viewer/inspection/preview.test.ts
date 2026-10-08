import { expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import { ModelCollection } from "../runtime/collection";
import { MaterialPreview } from "./preview";

it("编辑材质副本，恢复两个共享槽位且绝不释放模型纹理", () => {
  const texture = new Texture(),
    material = new MeshStandardMaterial({ map: texture, roughness: 0.7 });
  const a = new Mesh(new BoxGeometry(), material),
    b = new Mesh(a.geometry, [material, material]);
  const scene = new Group();
  scene.add(a, b);
  const entry = new ModelCollection(vi.fn()).prepare("test", {
    scene,
    name: "test",
    format: "GLB",
    size: 0,
    animations: [],
    hasGeometry: true,
    dispose() {},
  });
  const preview = new MaterialPreview(entry, vi.fn()),
    released = vi.fn();
  texture.addEventListener("dispose", released);
  preview.edit(material.uuid, { roughness: 0.1, color: "#ff0000" });
  expect(material.roughness).toBe(0.7);
  expect(a.material).not.toBe(material);
  const copy = a.material,
    disposed = vi.fn();
  copy.addEventListener("dispose", disposed);
  expect(b.material[0]).toBe(copy);
  expect(copy.roughness).toBe(0.1);
  preview.display(true, true);
  preview.reset();
  expect(a.material).toBe(material);
  expect(b.material).toEqual([material, material]);
  expect(disposed).toHaveBeenCalledTimes(1);
  expect(released).not.toHaveBeenCalled();
  preview.dispose();
  expect(disposed).toHaveBeenCalledTimes(1);
});
