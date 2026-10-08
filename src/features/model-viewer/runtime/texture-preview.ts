import {
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";

/** 按需生成小尺寸预览，兼容解码后的压缩纹理；临时 GPU 资源立即释放。 */
export function texturePreview(
  renderer: WebGLRenderer,
  texture: Texture,
): string | null {
  if (renderer.getContext().isContextLost()) return null;
  const image = texture.source?.data as
    { width?: number; height?: number } | undefined;
  if (!image?.width || !image.height) return null;
  const scale = Math.min(1, 128 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const target = new WebGLRenderTarget(width, height, { depthBuffer: false });
  target.texture.colorSpace = SRGBColorSpace;
  const geometry = new PlaneGeometry(2, 2);
  const material = new MeshBasicMaterial({ map: texture, toneMapped: false });
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const result = context.createImageData(width, height);
    for (let y = 0; y < height; y++)
      result.data.set(
        pixels.subarray((height - y - 1) * width * 4, (height - y) * width * 4),
        y * width * 4,
      );
    context.putImageData(result, 0, 0);
    return canvas.toDataURL();
  } catch {
    return null;
  } finally {
    renderer.setRenderTarget(previous);
    geometry.dispose();
    material.dispose();
    target.dispose();
  }
}
