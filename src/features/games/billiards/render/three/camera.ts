import { OrthographicCamera, PerspectiveCamera } from "three";

import type { TableEquipment } from "../../equipment";
import { tableLayout } from "../layout";

/** 固定正俯视机位；按当前视口完整取景，resize 保留微推近的剩余进度。 */
export function createTableCamera(equipment: TableEquipment) {
  const camera =
    equipment.id === "snooker"
      ? new OrthographicCamera(-1, 1, 1, -1, 0.01, 40)
      : new PerspectiveCamera(35, 1, 0.01, 40);
  const { OUTER_W, OUTER_H } = tableLayout(equipment);
  let intro = 0;
  let portrait = false;
  let aspect = 1;

  function apply() {
    camera.up.set(portrait ? 1 : 0, 0, portrait ? 0 : -1);
    const tanV = Math.tan((35 * Math.PI) / 360);
    const tanH = tanV * aspect;
    const halfWidth = (portrait ? OUTER_H : OUTER_W) + 0.015;
    const halfHeight = (portrait ? OUTER_W : OUTER_H) + 0.015;
    // 预留桌框厚度与边距；入场只改变 8% 距离，桌面朝向与最终取景保持一致。
    const distance =
      (0.06 + Math.max(halfWidth / tanH, halfHeight / tanV)) *
      1.055 *
      (1 + intro * 0.08);
    camera.position.set(0, distance, 0);
    if (camera instanceof OrthographicCamera) {
      camera.left = -distance * tanH;
      camera.right = distance * tanH;
      camera.top = distance * tanV;
      camera.bottom = -distance * tanV;
    } else camera.aspect = aspect;
    camera.far = distance * 4;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
  }

  return {
    camera,
    resize(width: number, height: number, nextPortrait: boolean) {
      aspect = Math.max(1, width) / Math.max(1, height);
      portrait = nextPortrait;
      apply();
    },
    entrance(value: number) {
      intro = Math.max(0, Math.min(1, value));
      apply();
    },
  };
}
