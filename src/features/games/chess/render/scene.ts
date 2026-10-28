import { Chess, type PieceSymbol, type Square } from "chess.js";
import gsap from "gsap";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { prefersReducedMotion } from "~/lib/motion";

import { applyChessMove, seatFor } from "../rules";
import type { ChessState, ChessView } from "../types";
import { loadChessAssets } from "./assets";
import { createPieceLabels } from "./piece-labels";

export function squarePosition(square: Square) {
  return new Vector3(
    square.charCodeAt(0) - 97 - 3.5,
    0,
    8 - Number(square[1]) - 3.5,
  );
}

export interface SceneSettings {
  state: ChessState;
  selected: Square | null;
  targets: Square[];
  focus: Square | null;
  view: ChessView;
  flipped: boolean;
  accent: number;
  labels: Record<PieceSymbol, string> | null;
}

export async function createChessScene(
  host: HTMLElement,
  initial: SceneSettings,
  callbacks: { busy(value: boolean): void; fail(): void },
) {
  const assets = await loadChessAssets();
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
  } catch (error) {
    assets.dispose();
    throw error;
  }
  const scene = new Scene();
  const topCamera = new OrthographicCamera(-6, 6, 6, -6, 0.1, 80);
  const tableCamera = new PerspectiveCamera(36, 1, 0.1, 100);
  let camera: OrthographicCamera | PerspectiveCamera = topCamera;
  const world = new Group();
  scene.add(world);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.setPixelRatio(
    Math.min(devicePixelRatio || 1, host.clientWidth < 768 ? 1.5 : 2),
  );
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.domElement.style.touchAction = "pan-y";
  host.appendChild(renderer.domElement);
  const room = new RoomEnvironment(),
    pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, 0.06);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.5;
  room.dispose();
  pmrem.dispose();
  const sun = new DirectionalLight(0xfff5e7, 2.3);
  // 从画面上方照明，俯视时凸起不会因下方高光被误读成凹槽。
  sun.position.set(-3, 10, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(host.clientWidth < 768 ? 1024 : 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -6;
  sun.shadow.camera.right = sun.shadow.camera.top = 6;
  sun.shadow.camera.far = 30;
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.012;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target, new AmbientLight(0xe4edf7, 0.16));
  world.add(assets.createBoard());
  const floorGeo = new PlaneGeometry(200, 200),
    floorMat = new MeshStandardMaterial({ color: 0xece7df, roughness: 0.95 });
  const floor = new Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.34;
  floor.receiveShadow = true;
  world.add(floor);
  const markerGeo = new RingGeometry(0.1, 0.135, 40),
    selectGeo = new RingGeometry(0.39, 0.415, 48);
  const markerMat = new MeshBasicMaterial({
    color: initial.accent,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  const selectedMat = new MeshBasicMaterial({
    color: initial.accent,
    depthWrite: false,
  });
  const lastMat = new MeshBasicMaterial({
    color: 0xc59a50,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const checkMat = new MeshBasicMaterial({
    color: 0xbb3d32,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const markers = new Group();
  world.add(markers);
  const pieces = new Map<Square, Mesh>();
  const labels = createPieceLabels(host);
  let settings = initial,
    previous: ChessState | null = null,
    released = false,
    busy = false,
    frame = 0;
  let animation: gsap.core.Timeline | null = null;
  const raycaster = new Raycaster(),
    point = new Vector2(),
    plane = new Plane(new Vector3(0, 1, 0), 0);
  const bounds = new Box3(
    new Vector3(-4.7, -0.3, -4.7),
    new Vector3(4.7, 1.5, 4.7),
  );

  function draw() {
    frame = 0;
    if (released || document.hidden) return;
    renderer.render(scene, camera);
    labels.place(camera, pieces, busy, settings.flipped);
  }

  function invalidate() {
    if (!released && !frame && !document.hidden)
      frame = requestAnimationFrame(draw);
  }

  function fit() {
    if (released) return;
    const w = Math.max(host.clientWidth, 1),
      h = Math.max(host.clientHeight, 1);
    const sign = settings.flipped ? -1 : 1;
    // 换到执黑方向时光源一并旋转，避免冠部重新出现下方照明的凹凸错觉。
    sun.position.set(-3 * sign, 10, -4 * sign);
    if (settings.view === "table") {
      // 立体预设使用真正透视，棋盘边线和立体棋子共享同一消失关系。
      camera = tableCamera;
      const direction = new Vector3(0, 13, 9 * sign).normalize();
      tableCamera.aspect = w / h;
      tableCamera.position.copy(direction);
      tableCamera.lookAt(0, 0, 0);
      tableCamera.updateMatrixWorld(true);
      const tangent = Math.tan((tableCamera.fov * Math.PI) / 360);
      let distance = 0;
      for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y])
          for (const z of [bounds.min.z, bounds.max.z]) {
            const v = new Vector3(x, y, z).applyMatrix4(
              tableCamera.matrixWorldInverse,
            );
            distance = Math.max(
              distance,
              v.z + Math.abs(v.x) / (tangent * tableCamera.aspect),
              v.z + Math.abs(v.y) / tangent,
            );
          }
      tableCamera.position.copy(
        direction.multiplyScalar((distance + 1) * 1.045),
      );
      tableCamera.updateMatrixWorld(true);
      tableCamera.updateProjectionMatrix();
      renderer.setSize(w, h);
      invalidate();
      return;
    }
    // 正上方使用零倾角；棋子不能再保留斜视侧面。
    camera = topCamera;
    topCamera.position.set(0, 14, 0);
    topCamera.up.set(0, 0, -sign);
    topCamera.lookAt(0, 0, 0);
    topCamera.updateMatrixWorld(true);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const v = new Vector3(x, y, z).applyMatrix4(
            camera.matrixWorldInverse,
          );
          minX = Math.min(minX, v.x);
          maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
        }
    const width = (maxX - minX) * 1.025,
      height = (maxY - minY) * 1.025,
      aspect = w / h;
    const halfH = Math.max(height / 2, width / 2 / aspect),
      halfW = halfH * aspect;
    const cy = (minY + maxY) / 2;
    topCamera.left = -halfW;
    topCamera.right = halfW;
    topCamera.top = cy + halfH;
    topCamera.bottom = cy - halfH;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    invalidate();
  }

  function rebuild(state: ChessState) {
    for (const piece of pieces.values()) world.remove(piece);
    pieces.clear();
    for (const row of new Chess(state.fen).board())
      for (const piece of row) {
        if (!piece) continue;
        const mesh = assets.createPiece(piece.type, piece.color);
        mesh.position.copy(squarePosition(piece.square));
        world.add(mesh);
        pieces.set(piece.square, mesh);
      }
  }

  function ring(square: Square, material: MeshBasicMaterial, large = false) {
    const mesh = new Mesh(large ? selectGeo : markerGeo, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(squarePosition(square));
    mesh.position.y = 0.006;
    markers.add(mesh);
  }

  function highlight() {
    markers.clear();
    markerMat.color.set(settings.accent);
    selectedMat.color.set(settings.accent);
    if (settings.state.lastAction?.type === "move") {
      ring(settings.state.lastAction.from, lastMat, true);
      ring(settings.state.lastAction.to, lastMat, true);
    }
    for (const target of settings.targets)
      ring(target, markerMat, pieces.has(target));
    if (settings.selected) ring(settings.selected, selectedMat, true);
    if (settings.focus && settings.focus !== settings.selected)
      ring(settings.focus, selectedMat, true);
    const chess = new Chess(settings.state.fen);
    if (chess.isCheck())
      for (const row of chess.board())
        for (const piece of row)
          if (piece?.type === "k" && piece.color === chess.turn())
            ring(piece.square, checkMat, true);
  }

  function stopAnimation() {
    animation?.kill();
    animation = null;
    busy = false;
    callbacks.busy(false);
  }

  function sync(next: SceneSettings) {
    const old = settings;
    settings = next;
    labels.sync(next.state.fen, next.labels);
    if (!previous || previous.fen !== next.state.fen) {
      const before = previous;
      stopAnimation();
      const normal =
        before &&
        next.state.ply === before.ply + 1 &&
        next.state.lastAction?.type === "move";
      if (normal && !prefersReducedMotion()) {
        rebuild(before);
        const presentation = applyChessMove(
          before,
          next.state.lastAction!,
          seatFor(new Chess(before.fen).turn()),
        ).presentation;
        const move = presentation.move,
          mesh = move ? pieces.get(move.from) : null;
        if (mesh && move) {
          busy = true;
          callbacks.busy(true);
          const target = squarePosition(move.to);
          animation = gsap.timeline({
            onUpdate: invalidate,
            onComplete: () => {
              busy = false;
              animation = null;
              rebuild(settings.state);
              highlight();
              callbacks.busy(false);
              invalidate();
            },
          });
          animation.to(
            mesh.position,
            { y: 0.24, duration: 0.09, ease: "power2.out" },
            0,
          );
          animation.to(
            mesh.position,
            { x: target.x, z: target.z, duration: 0.25, ease: "power2.inOut" },
            0.035,
          );
          animation.to(
            mesh.position,
            { y: 0, duration: 0.1, ease: "power2.in" },
            0.25,
          );
          if (presentation.capture) {
            const captured = pieces.get(presentation.capture);
            if (captured)
              animation.to(
                captured.scale,
                { x: 0, y: 0, z: 0, duration: 0.12, ease: "power2.in" },
                0.12,
              );
          }
          if (presentation.rook) {
            const rook = pieces.get(presentation.rook.from),
              end = squarePosition(presentation.rook.to);
            if (rook)
              animation.to(
                rook.position,
                { x: end.x, z: end.z, duration: 0.25, ease: "power2.inOut" },
                0.06,
              );
          }
        } else rebuild(next.state);
      } else rebuild(next.state);
      previous = next.state;
    }
    if (old.view !== next.view || old.flipped !== next.flipped) fit();
    highlight();
    invalidate();
  }

  let dragged: { square: Square; mesh: Mesh } | null = null;

  function drag(square: Square, clientX: number, clientY: number) {
    if (busy || released) return;
    const mesh = pieces.get(square);
    if (!mesh) return;
    dragged = { square, mesh };
    const rect = renderer.domElement.getBoundingClientRect();
    point.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(point, camera);
    const position = raycaster.ray.intersectPlane(plane, new Vector3());
    if (position) mesh.position.set(position.x, 0.25, position.z);
    invalidate();
  }

  function cancelDrag() {
    if (!dragged) return;
    dragged.mesh.position.copy(squarePosition(dragged.square));
    dragged = null;
    invalidate();
  }

  function hit(clientX: number, clientY: number): Square | null {
    const rect = renderer.domElement.getBoundingClientRect();
    point.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(point, camera);
    const hit = raycaster.ray.intersectPlane(plane, new Vector3());
    if (!hit) return null;
    const col = Math.floor(hit.x + 4),
      row = Math.floor(hit.z + 4);
    return col >= 0 && col < 8 && row >= 0 && row < 8
      ? (("abcdefgh"[col] + (8 - row)) as Square)
      : null;
  }

  function theme() {
    const dark = document.documentElement.classList.contains("dark");
    floorMat.color.set(dark ? 0x242321 : 0xece7df);
    scene.environmentIntensity = dark ? 0.38 : 0.4;
    invalidate();
  }

  const observer = new ResizeObserver(fit);
  observer.observe(host);
  const themes = new MutationObserver(theme);
  themes.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });

  const lost = (event: Event) => {
    event.preventDefault();
    stopAnimation();
    callbacks.fail();
  };

  renderer.domElement.addEventListener("webglcontextlost", lost);

  const visibility = () => {
    if (document.hidden) {
      stopAnimation();
      rebuild(settings.state);
    } else invalidate();
  };

  document.addEventListener("visibilitychange", visibility);
  sync(initial);
  theme();
  fit();
  return {
    canvas: renderer.domElement,
    sync,
    hit,
    drag,
    cancelDrag,
    invalidate,
    get busy() {
      return busy;
    },
    dispose() {
      if (released) return;
      released = true;
      animation?.kill();
      cancelAnimationFrame(frame);
      observer.disconnect();
      themes.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      assets.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      markerGeo.dispose();
      selectGeo.dispose();
      markerMat.dispose();
      selectedMat.dispose();
      lastMat.dispose();
      checkMat.dispose();
      environment.dispose();
      sun.shadow.map?.dispose();
      renderer.dispose();
      labels.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

export type ChessScene = Awaited<ReturnType<typeof createChessScene>>;
