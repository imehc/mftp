import {
  Color,
  Material,
  Mesh,
  MeshNormalMaterial,
  MeshStandardMaterial,
} from "three";

import type { ModelEntry } from "../runtime/collection";

export type MaterialView = {
  id: string;
  name: string;
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
};

export class MaterialPreview {
  private originals = new Map<Mesh, Material | Material[]>();
  private copies = new Map<Material, Material>();
  private normal = new MeshNormalMaterial();
  private normalMode = false;
  private wireframe = false;
  constructor(
    private entry: ModelEntry,
    private invalidate: () => void,
  ) {}
  private ensure() {
    if (this.originals.size) return;
    this.entry.handle.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      this.originals.set(node, node.material);
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material])
        if (!this.copies.has(material))
          this.copies.set(material, material.clone());
    });
  }
  materials(): MaterialView[] {
    const result = new Map<string, MaterialView>();
    this.entry.handle.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const original = this.originals.get(node) ?? node.material;
      for (const material of Array.isArray(original) ? original : [original]) {
        const current = this.copies.get(material) ?? material;
        if (current instanceof MeshStandardMaterial)
          result.set(material.uuid, {
            id: material.uuid,
            name: material.name || material.type,
            color: `#${current.color.getHexString()}`,
            roughness: current.roughness,
            metalness: current.metalness,
            opacity: current.opacity,
          });
      }
    });
    return [...result.values()];
  }
  edit(id: string, patch: Partial<Omit<MaterialView, "id" | "name">>) {
    this.ensure();
    for (const [original, copy] of this.copies) {
      if (original.uuid !== id || !(copy instanceof MeshStandardMaterial))
        continue;
      if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color))
        copy.color.copy(new Color(patch.color));
      for (const key of ["roughness", "metalness", "opacity"] as const) {
        const value = patch[key];
        if (value !== undefined && Number.isFinite(value))
          copy[key] = Math.max(0, Math.min(1, value));
      }
      copy.transparent = copy.opacity < 1 || original.transparent;
      copy.needsUpdate = true;
    }
    this.apply();
  }
  display(wireframe: boolean, normals: boolean) {
    this.ensure();
    this.wireframe = wireframe;
    this.normalMode = normals;
    this.apply();
  }
  private apply() {
    this.normal.wireframe = this.wireframe;
    for (const copy of this.copies.values())
      if ("wireframe" in copy) copy.wireframe = this.wireframe;
    for (const [mesh, material] of this.originals)
      mesh.material = this.normalMode
        ? this.normal
        : Array.isArray(material)
          ? material.map((m) => this.copies.get(m)!)
          : this.copies.get(material)!;
    this.invalidate();
  }
  reset() {
    for (const [mesh, material] of this.originals) mesh.material = material;
    this.originals.clear();
    // 纹理仍由模型拥有；临时材质副本释放不能连带释放共享纹理。
    for (const copy of this.copies.values()) copy.dispose();
    this.copies.clear();
    this.wireframe = false;
    this.normalMode = false;
    this.invalidate();
  }
  dispose() {
    this.reset();
    this.normal.dispose();
  }
}
