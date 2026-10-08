import {
  Box3,
  DirectionalLight,
  Mesh,
  PlaneGeometry,
  ShadowMaterial,
  Vector3,
  type Scene,
  type WebGLRenderer,
} from "three";
import type { ModelCollection } from "../runtime/collection";

export class ViewerShadows {
  private floor = new Mesh(
    new PlaneGeometry(1, 1),
    new ShadowMaterial({ opacity: 0.3 }),
  );
  private originals = new Map<Mesh, [boolean, boolean]>();
  private light: DirectionalLight;
  private enabled = false;
  constructor(
    private scene: Scene,
    private renderer: WebGLRenderer,
    private models: ModelCollection,
  ) {
    this.light = scene.children.find(
      (n) => n instanceof DirectionalLight,
    ) as DirectionalLight;
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.bias = -0.0002;
  }
  set(enabled: boolean) {
    this.enabled = enabled;
    this.renderer.shadowMap.enabled = enabled;
    this.light.castShadow = enabled;
    if (enabled) this.scene.add(this.floor, this.light.target);
    else {
      this.floor.removeFromParent();
      this.light.target.removeFromParent();
      for (const [mesh, [cast, receive]] of this.originals) {
        mesh.castShadow = cast;
        mesh.receiveShadow = receive;
      }
      this.originals.clear();
      this.light.shadow.map?.dispose();
      this.light.shadow.map = null;
    }
    this.sync();
  }
  sync() {
    if (!this.enabled) return;
    const alive = new Set<Mesh>();
    this.models.root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      alive.add(node);
      if (!this.originals.has(node))
        this.originals.set(node, [node.castShadow, node.receiveShadow]);
      node.castShadow = true;
      node.receiveShadow = true;
    });
    for (const mesh of this.originals.keys())
      if (!alive.has(mesh)) this.originals.delete(mesh);
    const box: Box3 = this.models.bounds();
    if (box.isEmpty()) {
      this.floor.visible = false;
      return;
    }
    this.floor.visible = true;
    const center = box.getCenter(new Vector3());
    const radius = Math.max(1, box.getSize(new Vector3()).length());
    this.floor.position.set(center.x, box.min.y - 0.01, center.z);
    this.floor.scale.setScalar(radius * 3);
    this.light.position
      .copy(center)
      .add(new Vector3(1, 2, 1).multiplyScalar(radius));
    this.light.target.position.copy(center);
    const camera = this.light.shadow.camera;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = 0.001;
    camera.far = radius * 8;
    camera.updateProjectionMatrix();
  }
  dispose() {
    this.set(false);
    this.floor.geometry.dispose();
    this.floor.material.dispose();
  }
}
