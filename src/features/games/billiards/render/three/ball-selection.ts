import gsap from "gsap";
import {
  CircleGeometry,
  Group,
  Mesh,
  type MeshPhysicalMaterial,
  OrthographicCamera,
  Plane,
  Raycaster,
  type SphereGeometry,
  Vector2,
  Vector3,
} from "three";

import { ballDefinition } from "../../ball-definitions";
import type { TableEquipment } from "../../equipment";
import type { BilliardsState } from "../../types";
import type {
  BallSelectionRequest,
  BallSelectionView,
  SceneCallbacks,
} from "../scene-contract";
import { selectionLayout, shortestAngle } from "../selection-layout";
import { createBallRipple } from "./ball-ripple";
import type { createBallLayer } from "./balls";
import type { createTableCamera } from "./camera";
import type { Resources } from "./resources";
import { createSelectionShadow } from "./selection-shadow";

export function createBallSelection({
  ballLayer,
  camera,
  equipment,
  resources,
  callbacks,
  touch,
  reduced,
  redraw,
  getAngle,
  setAngle,
}: {
  ballLayer: Pick<ReturnType<typeof createBallLayer>, "meshes">;
  camera: ReturnType<typeof createTableCamera>;
  equipment: TableEquipment;
  resources: Resources;
  callbacks: SceneCallbacks;
  touch: boolean;
  reduced: boolean;
  redraw(): void;
  getAngle(): number;
  setAngle(angle: number): void;
}) {
  const motionReduced = () =>
    reduced ||
    (typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const layer = new Group();
  const ray = new Raycaster();
  const plane = new Plane(new Vector3(0, 1, 0), -equipment.ballRadius);
  const projected = new Vector3();
  const hit = new Vector3();
  const rings = new Map<number, ReturnType<typeof createBallRipple>>();
  const shadows = new Map<number, ReturnType<typeof createSelectionShadow>>();
  const previews = new Map<
    number,
    Mesh<SphereGeometry, MeshPhysicalMaterial>
  >();
  const geometry = resources.own(
    new CircleGeometry(equipment.ballRadius * 1.55, 48),
  );
  for (const [id, original] of ballLayer.meshes) {
    if (!id || equipment.id !== "snooker") continue;
    const copy = original.clone();
    copy.material = resources.own(original.material.clone());
    copy.material.transparent = true;
    copy.material.roughness = 0.24;
    copy.material.clearcoat = 0.55;
    copy.material.clearcoatRoughness = 0.18;
    copy.material.envMapIntensity = 0.7;
    copy.castShadow = false;
    const shadow = createSelectionShadow(geometry, resources);
    layer.add(shadow);
    shadows.set(id, shadow);
    copy.name = `selection-preview-${id}`;
    copy.visible = false;
    layer.add(copy);
    previews.set(id, copy);
    const ring = createBallRipple(
      geometry,
      ballDefinition(id, equipment.id).color,
      resources,
    );
    ring.name = `selection-ripple-${id}`;
    layer.add(ring);
    rings.set(id, ring);
  }
  let width = 1;
  let height = 1;
  let source: BilliardsState | null = null;
  let requestKey = "";
  let phase: BallSelectionView["phase"] | null = null;
  let originalAngle = 0;
  let ids: number[] = [];
  let options: BallSelectionView["options"] = [];
  let animation: gsap.core.Timeline | null = null;
  let turn: gsap.core.Tween | null = null;
  let wave: gsap.core.Timeline | null = null;
  const angle = { value: 0 };

  const publish = () =>
    callbacks.onSelectionView?.(phase ? { phase, options } : null);

  const screen = (x: number, y: number) => {
    projected.set(x, equipment.ballRadius, y).project(camera.camera);
    return {
      x: ((projected.x + 1) * width) / 2,
      y: ((1 - projected.y) * height) / 2,
    };
  };

  const world = (x: number, y: number, elevation = equipment.ballRadius) => {
    plane.constant = -elevation;
    ray.setFromCamera(
      new Vector2((x / width) * 2 - 1, 1 - (y / height) * 2),
      camera.camera,
    );
    ray.ray.intersectPlane(plane, hit);
    return hit.clone();
  };

  const rotate = (target: number) => {
    turn?.kill();
    angle.value = getAngle();
    turn = gsap.to(angle, {
      value: shortestAngle(angle.value, target),
      duration: motionReduced() ? 0 : 0.2,
      ease: "power2.out",
      onUpdate: () => {
        setAngle(angle.value);
        redraw();
      },
    });
  };

  const preview = (id: number) => {
    if (!source || phase === "returning" || !ids.includes(id)) return;
    const ball = source.balls.find((candidate) => candidate.id === id);
    const cue = source.balls.find(
      (candidate) => candidate.id === 0 && !candidate.potted,
    );
    if (!ball || !cue) return;
    wave?.kill();
    for (const ring of rings.values()) ring.visible = false;
    const ring = rings.get(id);
    if (ring) {
      ring.visible = true;
      ring.material.uniforms.progress.value = motionReduced() ? 0.45 : 0;
      if (!motionReduced()) {
        wave = gsap.timeline({
          onUpdate: redraw,
          onComplete: () => {
            ring.visible = false;
            redraw();
          },
        });
        wave.to(ring.material.uniforms.progress, {
          value: 1.25,
          duration: 0.85,
          ease: "none",
        });
      }
    }
    rotate(Math.atan2(ball.y - cue.y, ball.x - cue.x));
    redraw();
  };

  const restore = () => {
    animation?.kill();
    animation = null;
    turn?.kill();
    turn = null;
    wave?.kill();
    wave = null;
    for (const mesh of previews.values()) mesh.visible = false;
    for (const shadow of shadows.values()) shadow.visible = false;
    for (const ring of rings.values()) ring.visible = false;
    phase = null;
    ids = [];
    source = null;
    publish();
    redraw();
  };

  const arrange = (duration: number) => {
    animation?.kill();
    const corners = [-1, 1].flatMap((horizontal) =>
      [-1, 1].map((vertical) =>
        screen(
          (horizontal * equipment.tableWidth) / 2,
          (vertical * equipment.tableHeight) / 2,
        ),
      ),
    );
    const left = Math.min(...corners.map((point) => point.x));
    const top = Math.min(...corners.map((point) => point.y));
    const layout = selectionLayout(
      ids.length,
      {
        x: left,
        y: top,
        width: Math.max(...corners.map((point) => point.x)) - left,
        height: Math.max(...corners.map((point) => point.y)) - top,
      },
      touch,
    );
    options = layout.map((option, index) => ({ ...option, id: ids[index] }));
    phase = "entering";
    publish();
    animation = gsap.timeline({
      onUpdate: redraw,
      onComplete: () => {
        phase = "selecting";
        animation = null;
        publish();
        redraw();
      },
    });
    options.forEach((option, index) => {
      const mesh = previews.get(option.id);
      if (!mesh) return;
      const ground = world(option.x, option.y, 0);
      const edge = world(option.x + option.diameter / 2, option.y, 0);
      const wantedRadius = ground.distanceTo(edge);
      const heightRatio = 2.2;
      const radius =
        camera.camera instanceof OrthographicCamera
          ? wantedRadius
          : (wantedRadius * camera.camera.position.y) /
            (camera.camera.position.y + wantedRadius * heightRatio);
      const destination = world(option.x, option.y, radius * heightRatio);
      const scale = radius / equipment.ballRadius;
      const shadow = shadows.get(option.id)!;
      shadow.position.copy(world(option.x + 8, option.y + 14, 0.0008));
      shadow.scale.setScalar(scale * 1.15);
      shadow.visible = true;
      const delay = motionReduced() ? 0 : index * 0.035;
      animation?.to(
        shadow.material.uniforms.opacity,
        { value: 1, duration: motionReduced() ? 0 : duration },
        delay,
      );
      animation?.to(
        mesh.material,
        { opacity: 1, duration: motionReduced() ? 0 : duration * 0.7 },
        delay,
      );
      animation?.to(
        mesh.position,
        {
          x: destination.x,
          y: destination.y,
          z: destination.z,
          duration: motionReduced() ? 0 : duration,
          ease: "power3.inOut",
        },
        delay,
      );
      animation?.to(
        mesh.scale,
        {
          x: scale,
          y: scale,
          z: scale,
          duration: motionReduced() ? 0 : duration,
          ease: "power3.inOut",
        },
        delay,
      );
    });
  };

  const leave = (chosen: number | null) => {
    if (!phase || phase === "returning") return;
    animation?.kill();
    if (chosen !== null) preview(chosen);
    else rotate(originalAngle);
    phase = "returning";
    publish();
    animation = gsap.timeline({
      onUpdate: redraw,
      onComplete: () => {
        restore();
        if (chosen !== null) callbacks.onSelectedBall?.(chosen);
      },
    });
    ids.forEach((id, index) => {
      const mesh = previews.get(id);
      const ball = source?.balls.find((candidate) => candidate.id === id);
      if (!mesh || !ball) return;
      const delay = motionReduced() ? 0 : index * 0.02;
      animation?.to(
        shadows.get(id)!.material.uniforms.opacity,
        { value: 0, duration: motionReduced() ? 0 : 0.25 },
        delay,
      );
      animation?.to(
        mesh.material,
        { opacity: 0, duration: motionReduced() ? 0 : 0.3, ease: "power2.in" },
        delay,
      );
      animation?.to(
        mesh.position,
        {
          x: ball.x,
          y: equipment.ballRadius,
          z: ball.y,
          duration: motionReduced() ? 0 : 0.4,
          ease: "power3.inOut",
        },
        delay,
      );
      animation?.to(
        mesh.scale,
        {
          x: 1,
          y: 1,
          z: 1,
          duration: motionReduced() ? 0 : 0.4,
          ease: "power3.inOut",
        },
        delay,
      );
    });
  };

  return {
    layer,
    get active() {
      return phase !== null;
    },
    preview,
    select(id: number) {
      if (phase === "selecting" && ids.includes(id)) leave(id);
    },
    set(request: BallSelectionRequest | null, state: BilliardsState | null) {
      const key = request
        ? `${request.ids.join(",")}:${request.selectedId}`
        : "";
      if (key === requestKey) return;
      requestKey = key;
      if (!request) {
        leave(null);
        return;
      }
      restore();
      if (!state || state.variant !== "snooker" || state.finished) return;
      source = state;
      originalAngle = getAngle();
      ids = request.ids.filter((id) =>
        state.balls.some((ball) => ball.id === id && !ball.potted),
      );
      if (!ids.length) {
        source = null;
        return;
      }
      for (const id of ids) {
        const ball = state.balls.find((candidate) => candidate.id === id)!;
        const ring = rings.get(id)!;
        ring.position.set(ball.x, 0.001, ball.y);
        const mesh = previews.get(id)!;
        mesh.position.set(ball.x, equipment.ballRadius, ball.y);
        mesh.scale.setScalar(1);
        mesh.material.opacity = 0;
        mesh.quaternion.copy(ballLayer.meshes.get(id)!.quaternion);
        mesh.visible = true;
        shadows.get(id)!.material.uniforms.opacity.value = 0;
      }
      arrange(0.46);
      if (request.selectedId !== null) preview(request.selectedId);
    },
    resize(nextWidth: number, nextHeight: number) {
      width = nextWidth;
      height = nextHeight;
      if (phase && phase !== "returning") arrange(0.2);
    },
    reconcile(state: BilliardsState) {
      if (source && source !== state) {
        requestKey = "";
        restore();
      }
    },
    cancel() {
      requestKey = "";
      restore();
    },
    dispose() {
      restore();
      layer.clear();
    },
  };
}
