import { type CircleGeometry, Color, Mesh, ShaderMaterial } from "three";

import type { Resources } from "./resources";

export function createBallRipple(
  geometry: CircleGeometry,
  color: string,
  resources: Resources,
) {
  const material = resources.own(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        color: { value: new Color(color).lerp(new Color("white"), 0.65) },
        progress: { value: 0 },
      },
      vertexShader: `varying vec2 rippleUv;
      void main() {
        rippleUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
      fragmentShader: `varying vec2 rippleUv;
      uniform vec3 color;
      uniform float progress;
      float wave(float radius, float time) {
        if (time < 0.0 || time > 1.0) return 0.0;
        float front = 0.64 + time * 0.32;
        float softness = exp(-pow((radius - front) * 24.0, 2.0));
        return softness * smoothstep(0.0, 0.12, time) * pow(1.0 - time, 1.5);
      }
      void main() {
        float radius = length(rippleUv - 0.5) * 2.0;
        float alpha = (wave(radius, progress) + wave(radius, progress - 0.25) * 0.6) * 0.48;
        gl_FragColor = vec4(color, alpha);
      }`,
    }),
  );
  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  return mesh;
}
