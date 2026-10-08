import { expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import { ModelResources } from "./resources";

it("只释放一次共享几何体、材质和纹理，包括延迟结果", () => {
  const geometry = new BoxGeometry();
  const texture = new Texture();
  const material = new MeshStandardMaterial({
    map: texture,
    normalMap: texture,
  });
  const scene = new Group();
  scene.add(new Mesh(geometry, material), new Mesh(geometry, material));
  const releases = [geometry, material, texture].map((resource) =>
    vi.spyOn(resource, "dispose"),
  );
  const resources = new ModelResources();
  resources.track(scene);
  resources.dispose();
  resources.dispose();
  releases.forEach((release) => expect(release).toHaveBeenCalledTimes(1));
  const late = new Texture();
  const releaseLate = vi.spyOn(late, "dispose");
  resources.track(late);
  expect(releaseLate).toHaveBeenCalledTimes(1);
});

it("共享资源的生命周期超过任一模型持有者的移除", () => {
  const geometry = new BoxGeometry();
  const texture = new Texture();
  const material = new MeshStandardMaterial({ map: texture });
  const first = new ModelResources(),
    second = new ModelResources();
  const a = new Group(),
    b = new Group();
  a.add(new Mesh(geometry, material));
  b.add(new Mesh(geometry, material));
  first.track(a);
  second.track(b);
  const releases = [geometry, material, texture].map((value) =>
    vi.spyOn(value, "dispose"),
  );
  first.dispose();
  releases.forEach((release) => expect(release).not.toHaveBeenCalled());
  second.dispose();
  releases.forEach((release) => expect(release).toHaveBeenCalledOnce());
});

it("共享 ImageBitmap 的不同纹理对象仅在最后一个持有者结束后关闭", () => {
  class Bitmap {
    close = vi.fn();
  }
  vi.stubGlobal("ImageBitmap", Bitmap);
  try {
    const bitmap = new Bitmap();
    const a = new Texture(bitmap),
      b = new Texture(bitmap);
    const first = new ModelResources(),
      second = new ModelResources();
    first.track(a);
    second.track(b);
    first.dispose();
    expect(bitmap.close).not.toHaveBeenCalled();
    second.dispose();
    expect(bitmap.close).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});
