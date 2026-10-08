import {
  OrthographicCamera,
  type PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector4,
  type WebGLRenderer,
} from "three";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";

import { axisDirections, type ViewAxis } from "./orientation";

/** 复用 Three.js 官方坐标轴；视口和拾取共用 rem 容器尺寸，不使用其固定 128px 布局。 */
export class OrientationGizmo {
  private helper: ViewHelper;
  private camera = new OrthographicCamera(-2, 2, 2, -2, 0, 4);
  private raycaster = new Raycaster();
  private viewport = new Vector4();
  host: HTMLElement | null = null;

  constructor(
    private viewCamera: PerspectiveCamera,
    private canvas: HTMLCanvasElement,
  ) {
    this.helper = new ViewHelper(viewCamera, canvas);
    this.helper.setLabels("X", "Y", "Z");
    this.camera.position.z = 2;
    this.camera.updateMatrixWorld();
  }

  render(renderer: WebGLRenderer) {
    if (!this.host) return;
    const rect = this.host.getBoundingClientRect();
    const canvas = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.helper.quaternion.copy(this.viewCamera.quaternion).invert();
    this.helper.updateMatrixWorld(true);
    const autoClear = renderer.autoClear;
    renderer.getViewport(this.viewport);
    try {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.setViewport(
        rect.left - canvas.left,
        canvas.bottom - rect.bottom,
        rect.width,
        rect.height,
      );
      renderer.render(this.helper, this.camera);
    } finally {
      renderer.autoClear = autoClear;
      renderer.setViewport(this.viewport);
    }
  }

  pick(clientX: number, clientY: number): ViewAxis | null {
    if (!this.host) return null;
    const rect = this.host.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.raycaster.setFromCamera(
      new Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((clientY - rect.top) / rect.height) * 2,
      ),
      this.camera,
    );
    const targets = this.helper.children.filter(
      (child) => child.userData.type in axisDirections,
    );
    const type: unknown = this.raycaster.intersectObjects(targets, false)[0]
      ?.object.userData.type;
    return typeof type === "string" && type in axisDirections
      ? (type as ViewAxis)
      : null;
  }

  dispose() {
    this.host = null;
    this.helper.dispose();
  }
}
