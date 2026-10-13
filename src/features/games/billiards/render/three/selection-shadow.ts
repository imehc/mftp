import { type CircleGeometry, Mesh, ShaderMaterial } from "three";

import type { Resources } from "./resources";

export function createSelectionShadow(
  geometry: CircleGeometry,
  resources: Resources,
) {
  const material = resources.own(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { opacity: { value: 0 } },
      vertexShader: `varying vec2 shadowUv;
      void main() {
        shadowUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
      fragmentShader: `varying vec2 shadowUv;
      uniform float opacity;
      void main() {
        float radius = length(shadowUv - 0.5) * 2.0;
        float alpha = exp(-radius * radius * 4.0) * (1.0 - smoothstep(0.75, 1.0, radius)) * opacity * 0.2;
        gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
      }`,
    }),
  );
  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  return mesh;
}
