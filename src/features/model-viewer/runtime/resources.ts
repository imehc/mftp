import { BufferGeometry, Material, Object3D, Skeleton, Texture } from "three";

// 跨解析所有者按对象身份计数；同名文件不代表相同资源。
const owners = new WeakMap<object, number>();

function retain(value: object) {
  owners.set(value, (owners.get(value) ?? 0) + 1);
}

function release(value: object, dispose: () => void) {
  const count = owners.get(value) ?? 0;
  if (count > 1) owners.set(value, count - 1);
  else {
    owners.delete(value);
    dispose();
  }
}

/** 解析持有资源所有权；共享资源最后一个所有者退出后释放。 */
export class ModelResources {
  private geometries = new Set<BufferGeometry>();
  private materials = new Set<Material>();
  private textures = new Set<Texture>();
  private skeletons = new Set<Skeleton>();
  private images = new Set<ImageBitmap>();
  private disposed = false;

  private add<T extends object>(set: Set<T>, value: T) {
    if (set.has(value)) return;
    set.add(value);
    retain(value);
  }

  track(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach((item) => this.track(item));
      return;
    }
    if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap)
      this.add(this.images, value);
    else if (value instanceof BufferGeometry) this.add(this.geometries, value);
    else if (value instanceof Texture) {
      this.add(this.textures, value);
      const data: unknown = value.source?.data;
      const images = Array.isArray(data) ? data : [data];
      for (const image of images)
        if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
          this.add(this.images, image);
    } else if (value instanceof Material) {
      this.add(this.materials, value);
      Object.values(value).forEach((item) => {
        if (item instanceof Texture) this.track(item);
      });
    } else if (value instanceof Object3D) {
      value.traverse((node) => {
        const mesh = node as Object3D & {
          geometry?: BufferGeometry;
          material?: Material | Material[];
          skeleton?: Skeleton;
        };
        if (mesh.geometry) this.track(mesh.geometry);
        if (mesh.material) this.track(mesh.material);
        if (mesh.skeleton) this.add(this.skeletons, mesh.skeleton);
      });
    }
    // 已取消的解析仍可能回传资源；它们也必须立即释放。
    if (this.disposed) this.release();
  }

  private release() {
    this.textures.forEach((texture) =>
      release(texture, () => texture.dispose()),
    );
    this.images.forEach((image) => release(image, () => image.close()));
    this.skeletons.forEach((skeleton) =>
      release(skeleton, () => skeleton.dispose()),
    );
    this.materials.forEach((material) =>
      release(material, () => material.dispose()),
    );
    this.geometries.forEach((geometry) =>
      release(geometry, () => geometry.dispose()),
    );
    this.textures.clear();
    this.skeletons.clear();
    this.images.clear();
    this.materials.clear();
    this.geometries.clear();
  }

  dispose() {
    this.disposed = true;
    this.release();
  }
}
