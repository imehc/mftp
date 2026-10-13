import { PMREMGenerator, Scene, SpotLight, type WebGLRenderer } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import type { TableEquipment } from "../../equipment";

export function createLighting(
  renderer: WebGLRenderer,
  scene: Scene,
  equipment: TableEquipment,
  mobile: boolean,
) {
  const room = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  const environment = (() => {
    try {
      return pmrem.fromScene(room, 0.04);
    } finally {
      room.dispose();
      pmrem.dispose();
    }
  })();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.35;
  // 斯诺克按台长抬高主光，避免角袋落在锥体边缘。
  const height = equipment.tableWidth * 0.85;
  const light = new SpotLight(
    0xfff5e7,
    height * height * 3.8,
    height * 4,
    Math.PI / 3,
    0.4,
    2,
  );
  light.position.set(
    -equipment.tableWidth * 0.35,
    height,
    -equipment.tableHeight * 0.5,
  );
  light.castShadow = true;
  light.shadow.mapSize.setScalar(mobile ? 1024 : 2048);
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = height * 3;
  light.shadow.bias = -0.00005;
  light.shadow.normalBias = 0.001;
  light.shadow.radius = 2;
  scene.add(light, light.target);
  const intensity = light.intensity;
  return {
    entrance(value: number) {
      light.intensity = intensity * value;
      scene.environmentIntensity = 0.35 * value;
    },
    dispose() {
      scene.environment = null;
      environment.dispose();
      light.dispose();
    },
  };
}
