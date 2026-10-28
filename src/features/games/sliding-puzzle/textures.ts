import { fbm, valueNoise } from "../engine/noise";

/** 复用棋类的确定性噪声生成本地木纹，只在挂载时绘制一次。 */
export function createPuzzleWood(): string | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const wave = x + fbm(x * 0.015, y * 0.01, 2) * 12;
      const fiber = valueNoise(wave * 0.7, y * 0.025);
      const shade = fbm(wave * 0.06, y * 0.006, 3) * 0.65 + fiber * 0.35;
      const i = (y * 256 + x) * 4;
      image.data[i] = 59 + shade * 42;
      image.data[i + 1] = 39 + shade * 30;
      image.data[i + 2] = 26 + shade * 22;
      image.data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}
