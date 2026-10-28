import gsap from "gsap";
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Vector2,
  Vector3,
  VSMShadowMap,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { prefersReducedMotion } from "~/lib/motion";

import { type CubeMove, type CubeState, NORMALS } from "../types";
import { createCubeGeometry } from "./geometry";

export function createCubeScene(
  host: HTMLElement,
  initial: CubeState,
  onError: () => void,
) {
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  let released = false;
  const cleanups: (() => void)[] = [
    () => {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  ];
  try {
    return initialize();
  } catch (error) {
    for (const cleanup of [...cleanups].reverse()) cleanup();
    throw error;
  }

  function initialize() {
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = VSMShadowMap;
    host.appendChild(canvas);
    const world = new Scene();
    const camera = new PerspectiveCamera(36, 1, 0.1, 60);
    const geometry = createCubeGeometry(initial);
    cleanups.push(geometry.dispose);
    world.add(geometry.group);
    const room = new RoomEnvironment();
    const generator = new PMREMGenerator(renderer);
    try {
      const environment = generator.fromScene(room, 0.04);
      world.environment = environment.texture;
      world.environmentIntensity = 0.55;
      cleanups.push(() => environment.dispose());
    } finally {
      room.dispose();
      generator.dispose();
    }
    const light = new SpotLight(0xfff4e4, 100, 25, Math.PI / 4, 0.8, 2);
    light.position.set(-3, 7, 5);
    light.castShadow = true;
    light.shadow.mapSize.setScalar(1024);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.025;
    light.shadow.radius = 5;
    light.shadow.blurSamples = 6;
    cleanups.push(() => light.dispose());
    world.add(
      light,
      light.target,
      new HemisphereLight(0xe1edff, 0x696057, 1.1),
    );
    // 柔和接触阴影采用本地解析纹理，避免移动端用多遍后处理模糊整个场景。
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 128;
    const shadowContext = shadowCanvas.getContext("2d");
    if (shadowContext) {
      const gradient = shadowContext.createRadialGradient(
        64,
        64,
        8,
        64,
        64,
        62,
      );
      gradient.addColorStop(0, "rgba(0,0,0,0.24)");
      gradient.addColorStop(0.4, "rgba(0,0,0,0.16)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      shadowContext.fillStyle = gradient;
      shadowContext.fillRect(0, 0, 128, 128);
    }
    const shadowTexture = new CanvasTexture(shadowCanvas);
    const planeGeometry = new PlaneGeometry(5.2, 5.2);
    const shadowMaterial = new MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const floor = new Mesh(planeGeometry, shadowMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.85;
    world.add(floor);
    cleanups.push(() => {
      planeGeometry.dispose();
      shadowMaterial.dispose();
      shadowTexture.dispose();
    });
    let state = initial;
    let latest = initial;
    let preview: { move: CubeMove; angle: number } | null = null;
    let selected: CubeMove | null = null;
    let frame = 0;
    let active = true;
    let playing = false;
    let finish: (() => void) | null = null;
    let tween: gsap.core.Tween | null = null;
    let yaw = 0.64,
      pitch = 0.43,
      zoom = 1;

    function invalidate(): void {
      if (frame || released || !active) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (released || !active) return;
        try {
          renderer.render(world, camera);
        } catch {
          onError();
        }
      });
    }

    function updateCamera(): void {
      const distance = 9.2 * Math.max(1, 1 / camera.aspect) * zoom;
      camera.position
        .set(
          Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          Math.cos(yaw) * Math.cos(pitch),
        )
        .multiplyScalar(distance);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      invalidate();
    }

    function resize(): void {
      const width = Math.max(1, host.clientWidth),
        height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      updateCamera();
    }

    function redraw(): void {
      geometry.update(state, preview);
      invalidate();
    }

    function cancel(): void {
      tween?.kill();
      tween = null;
      playing = false;
      preview = null;
      state = latest;
      geometry.select(selected);
      redraw();
      const resolve = finish;
      finish = null;
      resolve?.();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    cleanups.push(() => observer.disconnect());

    const lost = (event: Event) => {
      event.preventDefault();
      cancel();
      onError();
    };

    canvas.addEventListener("webglcontextlost", lost);
    cleanups.push(() => canvas.removeEventListener("webglcontextlost", lost));
    resize();
    const raycaster = new Raycaster();
    const pointer = new Vector2();

    return {
      canvas,
      sync(next: CubeState) {
        latest = next;
        if (!playing) {
          state = next;
          preview = null;
          redraw();
        }
      },
      setActive(value: boolean) {
        active = value;
        if (!active) cancel();
        else invalidate();
      },
      setLabels(value: boolean) {
        geometry.labels.visible = value;
        invalidate();
      },
      select(move: CubeMove | null) {
        selected = move;
        if (!preview) geometry.select(move);
        invalidate();
      },
      orbit(dx: number, dy: number) {
        yaw -= dx * 0.007;
        pitch = Math.max(-1.35, Math.min(1.35, pitch + dy * 0.007));
        updateCamera();
      },
      zoom(factor: number) {
        zoom = Math.max(0.65, Math.min(1.65, zoom * factor));
        updateCamera();
      },
      resetCamera() {
        yaw = 0.64;
        pitch = 0.43;
        zoom = 1;
        updateCamera();
      },
      pick(x: number, y: number) {
        const rect = canvas.getBoundingClientRect();
        pointer.set(
          ((x - rect.left) / rect.width) * 2 - 1,
          (-(y - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointer, camera);
        geometry.group.updateMatrixWorld(true);
        const hit = raycaster.intersectObject(geometry.stickers)[0];
        if (!hit || hit.instanceId === undefined) return null;
        const item = geometry.hits[hit.instanceId];
        return {
          point: hit.point,
          normal: NORMALS[item.face],
          position: state.cubies[item.cubie].position,
        };
      },
      project(vector: Vector3): Vector2 {
        const p = vector.clone().project(camera);
        return new Vector2(
          (p.x * canvas.clientWidth) / 2,
          (-p.y * canvas.clientHeight) / 2,
        );
      },
      preview(move: CubeMove, angle: number) {
        if (playing) return;
        preview = { move, angle };
        geometry.select(move);
        redraw();
      },
      cancel,
      play(move: CubeMove): Promise<void> {
        if (!active || released) return Promise.resolve();
        playing = true;
        const angle =
          preview?.move.axis === move.axis && preview.move.layer === move.layer
            ? preview.angle
            : 0;
        preview = { move, angle };
        geometry.select(null);
        return new Promise((resolve) => {
          finish = resolve;
          tween = gsap.to(preview, {
            angle:
              move.turns === 2 && angle < 0
                ? -Math.PI
                : (move.turns * Math.PI) / 2,
            duration: prefersReducedMotion() ? 0 : 0.19,
            ease: "power2.out",
            onUpdate: redraw,
            onComplete: cancel,
          });
        });
      },
      dispose() {
        if (released) return;
        released = true;
        cancel();
        if (frame) cancelAnimationFrame(frame);
        for (const cleanup of [...cleanups].reverse()) cleanup();
      },
    };
  }
}

export type CubeScene = ReturnType<typeof createCubeScene>;
