import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector3,
} from "three";
import { expect, it, vi } from "vitest";

import type { InspectionTools } from "../inspection/tools";
import { ModelCollection } from "../runtime/collection";
import { captureModelView, restoreModelPlacement } from "./view";

it.each(["row", "grid", "ring"] as const)(
  "保存并恢复 %s 布局时保留手动位置且不移动其他模型",
  (layout) => {
    const models = new ModelCollection(vi.fn());
    const scene = new Group();
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    const handle = {
      scene,
      name: "model.glb",
      format: "GLB",
      size: 1,
      animations: [],
      hasGeometry: true,
      dispose: vi.fn(),
    };
    const entry = models.prepare("first", handle);
    models.add(entry);
    models.arrange(layout);
    models.move("first", [4, 1, 2]);
    entry.layer.visible = false;
    const tools = {
      snapshot: () => ({
        views: [],
        unit: "m",
        wireframe: false,
        normals: false,
        shadows: false,
        autoRotate: false,
      }),
    } as unknown as InspectionTools;
    const saved = captureModelView(
      new PerspectiveCamera(),
      new Vector3(),
      tools,
      entry,
      models.layout,
    );
    expect(saved.layout).toBe(layout);
    const other = models.prepare("second", handle);
    models.add(other);
    models.move("second", [8, 3, 9]);
    models.layout = "row";
    models.move("first", [0, 0, 0]);
    restoreModelPlacement(models, entry, saved);
    expect(models.layout).toBe(layout);
    expect(entry.layer.position.toArray()).toEqual([4, 1, 2]);
    expect(entry.layer.visible).toBe(false);
    expect(other.layer.position.toArray()).toEqual([8, 3, 9]);
    models.dispose();
  },
);
