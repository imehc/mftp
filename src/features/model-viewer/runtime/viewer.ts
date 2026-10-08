import {
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Sphere,
  Spherical,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import type { ModelViewState } from "~/bindings";

import { modelError } from "../domain/errors";
import type { ModelHandle } from "../domain/types";
import { ViewerEnvironment } from "../inspection/environment";
import { ViewerShadows } from "../inspection/shadows";
import type { Unit } from "../inspection/tools";
import { InspectionTools, type InteractionMode } from "../inspection/tools";
import { captureModelView } from "../library/view";
import { ModelCollection, type ModelLayout } from "./collection";
import { FlightControls } from "./flight";
import { fitCamera } from "./framing";
import { OrientationGizmo } from "./gizmo";
import { MemoryHistory } from "./memory";
import { orientCamera, type ViewAxis } from "./orientation";
import { ModelPlacement } from "./placement";
import { texturePreview } from "./texture-preview";

function litScene() {
  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0x777777, 2));
  const light = new DirectionalLight(0xffffff, 3);
  light.position.set(3, 5, 4);
  scene.add(light);
  return scene;
}

async function waitUntilVisible(signal: AbortSignal) {
  signal.throwIfAborted();
  if (!document.hidden) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      document.removeEventListener("visibilitychange", visible);
      signal.removeEventListener("abort", abort);
    };

    const visible = () => {
      if (!document.hidden) {
        cleanup();
        resolve();
      }
    };

    const abort = () => {
      cleanup();
      reject(signal.reason);
    };

    document.addEventListener("visibilitychange", visible);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export class ModelViewerRuntime {
  readonly renderer: WebGLRenderer;
  private recovery: WEBGL_lose_context | null;
  private scene = litScene();
  private camera = new PerspectiveCamera(45, 1, 0.001, 1000);
  private controls: OrbitControls;
  private observer: ResizeObserver;
  private frame: number | null = null;
  private disposed = false;
  private lost = false;
  readonly models = new ModelCollection(() => this.invalidate());
  readonly memory = new MemoryHistory();
  private placement: ModelPlacement;
  private interactive = true;
  placing = false;
  readonly tools: InspectionTools;
  readonly flight: FlightControls;
  readonly environment: ViewerEnvironment;
  private shadows: ViewerShadows;
  private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private gizmo: OrientationGizmo;
  private lastFrame: number | null = null;
  get animation() {
    return this.models.current?.animation ?? null;
  }

  constructor(
    private canvas: HTMLCanvasElement,
    private onContext: (lost: boolean) => void,
    private onModels: () => void = () => {},
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.gizmo = new OrientationGizmo(this.camera, canvas);
    // 上下文丢失后 getExtension 会返回 null，必须在初始化时保留恢复句柄。
    this.recovery = this.renderer
      .getContext()
      .getExtension("WEBGL_lose_context");
    this.controls = new OrbitControls(this.camera, canvas);
    this.tools = new InspectionTools(
      canvas,
      this.camera,
      () => this.models.current,
      this.invalidate,
    );
    this.flight = new FlightControls(
      canvas,
      this.camera,
      this.controls.target,
      this.invalidate,
      () => this.setMode("orbit"),
    );
    this.environment = new ViewerEnvironment(
      this.scene,
      this.renderer,
      this.invalidate,
    );
    this.shadows = new ViewerShadows(this.scene, this.renderer, this.models);
    this.reducedMotion.addEventListener("change", this.motionChanged);
    this.placement = new ModelPlacement(
      canvas,
      this.camera,
      this.models,
      () => {
        this.tools.selectionChanged();
        this.onModels();
        this.invalidate();
      },
    );
    this.scene.add(this.models.root);
    this.memory.start();
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.02;
    this.controls.maxDistance = 200;
    this.controls.addEventListener("change", this.invalidate);
    fitCamera(this.camera);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas.parentElement!);
    document.addEventListener("visibilitychange", this.visibility);
    window.addEventListener("resize", this.resize);
    canvas.addEventListener("webglcontextlost", this.contextLost);
    canvas.addEventListener("webglcontextrestored", this.contextRestored);
    this.resize();
  }

  private resize = () => {
    if (this.disposed) return;
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(rect.width, rect.height, false);
    this.invalidate();
  };

  invalidate = () => {
    if (this.frame !== null || this.disposed || this.lost || document.hidden)
      return;
    this.frame = requestAnimationFrame((time) => {
      this.frame = null;
      if (this.disposed || this.lost || document.hidden) return;
      const delta =
        this.lastFrame === null ? 0 : (time - this.lastFrame) / 1000;
      this.lastFrame = time;
      const animating = this.models.update(delta);
      this.tools.syncPose();
      const flying = this.flight.update(delta);
      const moving = this.controls.enabled && this.controls.update(delta);
      this.shadows.sync();
      this.renderer.render(this.scene, this.camera);
      if (this.models.entries.size) this.gizmo.render(this.renderer);
      if (moving || animating || flying) this.invalidate();
      else this.lastFrame = null;
    });
  };

  private stop() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.lastFrame = null;
  }
  private visibility = () => {
    if (document.hidden) {
      this.stop();
      this.placement.cancel();
      this.flight.clear();
    } else this.invalidate();
  };
  private contextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.setMode("orbit");
    this.flight.clear();
    this.tools.diagnostics.cancel();
    this.environment.cancel();
    this.placement.cancel();
    this.placement.enabled = false;
    this.stop();
    this.onContext(true);
  };
  private contextRestored = () => {
    this.lost = false;
    this.setInteractive(this.interactive);
    this.onContext(false);
    this.resize();
  };

  async show(model: ModelHandle, signal: AbortSignal, id = model.scene.uuid) {
    if (this.disposed || this.lost) throw modelError("webgl");
    const scene = litScene();
    const entry = this.models.prepare(id, model);
    scene.add(entry.layer);
    const camera = this.camera.clone();
    fitCamera(camera);
    // 先让上传状态绘制；同步提交 shader，避免上下文丢失后异步编译轮询悬挂。
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await waitUntilVisible(signal);
      signal.throwIfAborted();
      if (this.disposed || this.lost) throw modelError("webgl");
      this.renderer.compile(scene, camera);
      // 上传成功后才交接所有权；失败时旧场景与视角仍然有效。
      this.renderer.render(scene, camera);
      if (this.renderer.getContext().isContextLost()) throw modelError("webgl");
      signal.throwIfAborted();
      this.placement.cancel();
      this.models.add(entry);
      this.setMode("orbit");
      this.tools.selectionChanged();
      this.refreshMemory();
      this.fit();
      return entry.inspection.snapshot;
    } catch (error) {
      entry.animation.dispose();
      entry.layer.removeFromParent();
      throw error;
    } finally {
      this.invalidate();
    }
  }

  private refreshMemory() {
    this.memory.refresh(
      [...this.models.entries].map(([id, entry]) => [id, entry.handle]),
    );
  }
  select(id: string) {
    if (!this.models.entries.has(id) || this.models.selected === id) return;
    this.placement.cancel();
    this.models.selected = id;
    this.setMode("orbit");
    this.tools.selectionChanged();
    this.onModels();
    this.invalidate();
  }
  remove(id: string) {
    this.placement.cancel();
    const selected = this.models.selected === id;
    // 先恢复临时副本，模型释放才能看到其原始材质和资源所有权。
    if (selected) {
      this.setMode("orbit");
      this.tools.detach();
    }
    this.models.remove(id);
    if (selected) this.tools.selectionChanged();
    this.renderer.renderLists.dispose();
    this.refreshMemory();
    this.onModels();
  }
  visible(id: string, visible: boolean) {
    this.placement.cancel();
    const entry = this.models.entries.get(id);
    if (entry) entry.layer.visible = visible;
    this.onModels();
    this.invalidate();
  }
  arrange(layout: ModelLayout) {
    this.placement.cancel();
    this.models.arrange(layout);
    this.fit();
    this.onModels();
  }
  move(id: string, position: number[]) {
    this.placement.cancel();
    this.models.move(id, position);
    this.onModels();
  }
  reset(id: string) {
    this.placement.cancel();
    this.models.reset(id);
    this.onModels();
  }
  setPlacing(value: boolean) {
    this.setMode(value ? "place" : "orbit");
  }
  focusCanvas() {
    this.canvas.parentElement?.focus();
  }
  setMode(mode: InteractionMode) {
    this.placement.cancel();
    this.flight.clear();
    this.placing = mode === "place";
    this.tools.measurement.clear();
    if (mode === "measure") this.models.current?.animation.pause();
    this.tools.publish({ mode, autoRotate: false });
    this.controls.autoRotate = false;
    this.setInteractive(this.interactive);
    this.onModels();
    this.invalidate();
  }
  setAutoRotate(value: boolean) {
    if (value && this.tools.snapshot().mode !== "orbit") this.setMode("orbit");
    const enabled = value && !this.reducedMotion.matches;
    this.tools.publish({ autoRotate: enabled });
    this.controls.autoRotate = enabled && this.interactive;
    this.invalidate();
  }
  private motionChanged = () => {
    if (this.reducedMotion.matches) this.setAutoRotate(false);
  };
  setShadows(value: boolean) {
    this.shadows.set(value);
    this.tools.publish({ shadows: value });
    this.invalidate();
  }
  saveView(name: string) {
    this.tools.saveView(name, this.camera, this.controls.target);
  }
  captureState(id = this.models.selected) {
    const entry = id ? this.models.entries.get(id) : undefined;
    return entry
      ? captureModelView(this.camera, this.controls.target, this.tools, entry)
      : null;
  }
  restoreState(id: string, value: ModelViewState) {
    const entry = this.models.entries.get(id);
    if (!entry || value.version !== 1) return;
    this.setMode("orbit");
    entry.layer.position.fromArray(value.position);
    entry.layer.visible = value.visible;
    entry.animation.restore(value.animation);
    this.tools.publish({
      unit: value.unit as Unit,
      views: value.views.map(({ id, name, camera }) => ({
        id,
        name,
        ...camera,
      })),
    });
    this.tools.display(value.wireframe, value.normals);
    this.setShadows(value.shadows);
    this.controls.enableDamping = false;
    this.controls.update();
    this.camera.position.fromArray(value.camera.position);
    this.controls.target.fromArray(value.camera.target);
    this.camera.near = value.camera.near;
    this.camera.far = value.camera.far;
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = Math.max(
      200,
      this.camera.position.distanceTo(this.controls.target) * 20,
    );
    this.controls.update();
    this.controls.enableDamping = true;
    this.setAutoRotate(value.autoRotate);
    this.onModels();
    this.invalidate();
  }
  thumbnail() {
    if (this.disposed || this.lost || !this.models.current) return null;
    // 同一任务内读取新渲染帧，不启用常驻 preserveDrawingBuffer。
    this.renderer.render(this.scene, this.camera);
    const image = document.createElement("canvas");
    const scale = Math.min(
      256 / this.canvas.width,
      256 / this.canvas.height,
      1,
    );
    image.width = Math.max(1, Math.round(this.canvas.width * scale));
    image.height = Math.max(1, Math.round(this.canvas.height * scale));
    image
      .getContext("2d")
      ?.drawImage(this.canvas, 0, 0, image.width, image.height);
    return new Promise<Blob | null>((resolve) =>
      image.toBlob(resolve, "image/png"),
    );
  }
  restoreView(id: string) {
    const view = this.tools.snapshot().views.find((v) => v.id === id);
    if (!view) return;
    this.setMode("orbit");
    this.controls.enableDamping = false;
    this.controls.update();
    this.camera.position.fromArray(view.position);
    this.controls.target.fromArray(view.target);
    this.camera.near = view.near;
    this.camera.far = view.far;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.controls.enableDamping = true;
    this.invalidate();
  }

  previewTexture(id: string) {
    const texture = this.models.current?.inspection.textures.get(id);
    return texture && !this.disposed
      ? texturePreview(this.renderer, texture)
      : null;
  }

  fit(id?: string) {
    this.setMode("orbit");
    if (id) {
      const entry = this.models.entries.get(id);
      if (entry) entry.layer.visible = true;
    }
    fitCamera(this.camera);
    const box = this.models.bounds(id);
    const sphere = box.getBoundingSphere(new Sphere());
    const center = box.isEmpty() ? new Vector3() : sphere.center;
    const radius = Math.max(0.001, box.isEmpty() ? 1 : sphere.radius);
    this.controls.enableDamping = false;
    this.controls.update();
    fitCamera(this.camera);
    this.camera.position.multiplyScalar(radius).add(center);
    this.camera.near = Math.max(0.00001, radius / 10000);
    this.camera.far = Math.max(1000, radius * 100);
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = Math.max(200, radius * 20);
    this.controls.target.copy(center);
    this.controls.update();
    this.controls.enableDamping = true;
    this.controls.saveState();
    this.onModels();
    this.invalidate();
  }
  attachGizmo(host: HTMLElement | null) {
    if (this.disposed) return;
    if (this.gizmo.host) this.observer.unobserve(this.gizmo.host);
    this.gizmo.host = host;
    if (host) this.observer.observe(host);
    this.invalidate();
  }
  pickAxis(x: number, y: number) {
    const axis = this.gizmo.pick(x, y);
    if (axis) this.viewAxis(axis);
  }
  viewAxis(axis: ViewAxis) {
    if (!this.models.entries.size) return;
    this.setMode("orbit");
    // 消耗旧手势的阻尼余量，避免轴向定位后又被上一轮拖动带偏。
    this.controls.enableDamping = false;
    this.controls.update();
    orientCamera(this.camera, this.controls.target, axis);
    this.controls.update();
    this.controls.enableDamping = true;
    this.invalidate();
  }
  setInteractive(enabled: boolean) {
    this.interactive = enabled;
    const mode = this.tools.snapshot().mode;
    this.controls.enabled = enabled && mode === "orbit" && !this.lost;
    this.placement.enabled = enabled && this.placing && !this.lost;
    this.flight.enabled = enabled && mode === "fly" && !this.lost;
    this.tools.measurement.enabled =
      enabled && mode === "measure" && !this.lost;
    this.controls.autoRotate =
      this.controls.enabled && this.tools.snapshot().autoRotate;
    if (!enabled) this.flight.clear();
    if (!enabled) this.placement.cancel();
  }
  restoreContext() {
    this.recovery?.restoreContext();
  }

  step(x: number, y: number, pan = false) {
    if (!pan) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const spherical = new Spherical().setFromVector3(offset);
      spherical.theta += x * 0.15;
      spherical.phi += y * 0.15;
      spherical.makeSafe();
      this.camera.position
        .copy(this.controls.target)
        .add(new Vector3().setFromSpherical(spherical));
    } else {
      const distance =
        this.camera.position.distanceTo(this.controls.target) * 0.08;
      const delta = new Vector3()
        .setFromMatrixColumn(this.camera.matrix, 0)
        .multiplyScalar(x * distance);
      delta.add(
        new Vector3()
          .setFromMatrixColumn(this.camera.matrix, 1)
          .multiplyScalar(-y * distance),
      );
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    }
    this.controls.update();
    this.invalidate();
  }

  zoom(factor: number) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(
      Math.min(
        this.controls.maxDistance,
        Math.max(0.02, offset.length() * factor),
      ),
    );
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.invalidate();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.observer.disconnect();
    this.controls.dispose();
    this.placement.dispose();
    this.flight.dispose();
    this.tools.dispose();
    this.environment.dispose();
    this.shadows.dispose();
    this.reducedMotion.removeEventListener("change", this.motionChanged);
    this.gizmo.dispose();
    document.removeEventListener("visibilitychange", this.visibility);
    window.removeEventListener("resize", this.resize);
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.contextRestored,
    );
    this.models.dispose();
    this.memory.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.scene.clear();
  }
}
