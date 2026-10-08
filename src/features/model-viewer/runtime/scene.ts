import { DirectionalLight, HemisphereLight, Scene } from "three";

export function litScene() {
  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0x777777, 2));
  const light = new DirectionalLight(0xffffff, 3);
  light.position.set(3, 5, 4);
  scene.add(light);
  return scene;
}
