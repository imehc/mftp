import { OrthographicCamera, PerspectiveCamera } from "three";

import type { TableEquipment } from "../../equipment";
import { tableLayout } from "../layout";
import type { BilliardsViewport } from "../viewport";

export interface CameraFocus {
  x: number;
  z: number;
  halfWidth: number;
  halfHeight: number;
  ceiling: number;
}

/** 正俯视机位从球堆近景拉回全桌，resize 不重置当前过渡进度。 */
export function createTableCamera(equipment: TableEquipment) {
  const camera =
    equipment.id === "snooker"
      ? new OrthographicCamera(-1, 1, 1, -1, 0.01, 40)
      : new PerspectiveCamera(35, 1, 0.01, 40);
  const renderCamera = camera.clone();
  const { OUTER_W, OUTER_H } = tableLayout(equipment);
  let intro = 0;
  let portrait = false;
  let aspect = 1;
  let focus: CameraFocus | null = null;
  let viewport: BilliardsViewport | undefined;

  function apply() {
    camera.up.set(portrait ? 1 : 0, 0, portrait ? 0 : -1);
    const tanV = Math.tan((35 * Math.PI) / 360);
    const tanH = tanV * aspect;
    const halfWidth = (portrait ? OUTER_H : OUTER_W) + 0.015;
    const halfHeight = (portrait ? OUTER_W : OUTER_H) + 0.015;
    const fullDistance =
      (0.06 + Math.max(halfWidth / tanH, halfHeight / tanV)) * 1.055;
    const nearDistance = focus
      ? focus.ceiling +
        Math.max(
          (portrait ? focus.halfHeight : focus.halfWidth) / tanH,
          (portrait ? focus.halfWidth : focus.halfHeight) / tanV,
        ) *
          1.1
      : fullDistance;
    const distance = fullDistance + (nearDistance - fullDistance) * intro;
    const targetX = (focus?.x ?? 0) * intro;
    const targetZ = (focus?.z ?? 0) * intro;
    camera.position.set(targetX, distance, targetZ);
    if (camera instanceof OrthographicCamera) {
      camera.left = -distance * tanH;
      camera.right = distance * tanH;
      camera.top = distance * tanV;
      camera.bottom = -distance * tanV;
    } else camera.aspect = aspect;
    camera.far = fullDistance * 4;
    camera.updateProjectionMatrix();
    camera.lookAt(targetX, 0, targetZ);
    camera.updateMatrixWorld();
    if (
      camera instanceof OrthographicCamera &&
      renderCamera instanceof OrthographicCamera
    )
      renderCamera.copy(camera);
    if (
      camera instanceof PerspectiveCamera &&
      renderCamera instanceof PerspectiveCamera
    )
      renderCamera.copy(camera);
    if (viewport) {
      const { table, width, height } = viewport;
      // 扩展原取景四周，所有台面点在页面上的像素位置保持不变。
      renderCamera.setViewOffset(
        table.width,
        table.height,
        -table.x,
        -table.y,
        width,
        height,
      );
    }
  }

  return {
    camera,
    renderCamera,
    resize(
      width: number,
      height: number,
      nextPortrait: boolean,
      nextViewport?: BilliardsViewport,
    ) {
      aspect = Math.max(1, width) / Math.max(1, height);
      portrait = nextPortrait;
      viewport = nextViewport;
      apply();
    },
    entrance(value: number) {
      intro = Math.max(0, Math.min(1, value));
      apply();
    },
    focus(next: CameraFocus | null) {
      focus = next;
      apply();
    },
  };
}
