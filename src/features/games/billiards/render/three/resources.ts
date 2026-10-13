import { BufferGeometry, Material, Texture } from "three";

/** 所有权集中登记，初始化中途失败也可释放已创建的资源。 */
export function createResources() {
  const resources = new Set<BufferGeometry | Material | Texture>();
  return {
    own<T extends BufferGeometry | Material | Texture>(resource: T): T {
      resources.add(resource);
      return resource;
    },
    dispose() {
      for (const resource of resources) resource.dispose();
      resources.clear();
    },
  };
}

export type Resources = ReturnType<typeof createResources>;
