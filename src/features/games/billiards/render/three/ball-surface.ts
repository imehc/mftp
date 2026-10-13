import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
} from "three";

/** 球面坐标上的低频抛光差异，跨经度接缝与极点连续，随网格旋转而非灯光移动。 */
export function ballSurfaceVariation(x: number, y: number, z: number) {
  return (
    Math.sin(x * 3.8 + y * 2.1 - z * 1.4) *
      Math.sin(y * 3.4 + z * 2.3 + 0.8) *
      0.75 +
    Math.sin(x * 7.8 - z * 4.6 + y * 2.7) * 0.2 +
    Math.sin(z * 11 + x * 5.3 - y * 4.1) * 0.05
  );
}

export function ballSurfaceAtUV(u: number, v: number) {
  const longitude = (u - 0.5) * Math.PI * 2;
  const latitude = (v - 0.5) * Math.PI;
  const horizontal = Math.cos(latitude);
  return ballSurfaceVariation(
    horizontal * Math.cos(longitude),
    Math.sin(latitude),
    horizontal * Math.sin(longitude),
  );
}

/** 所有球共用粗糙度贴图；红球仅改变朝向，不复制纹理或逐帧绘制。 */
export function buildBallPolishTexture() {
  const width = 256;
  const height = 128;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const variation = ballSurfaceAtUV((x + 0.5) / width, (y + 0.5) / height);
      const value = Math.round(160 + variation * 95);
      const offset = (y * width + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  const texture = new DataTexture(pixels, width, height, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.flipY = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
