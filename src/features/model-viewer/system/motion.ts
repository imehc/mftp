import { Euler, type PerspectiveCamera, Quaternion, Vector3 } from "three";

type Phase = "off" | "requesting" | "active" | "denied" | "unsupported";

export function deviceQuaternion(
  alpha: number,
  beta: number,
  gamma: number,
  angle: number,
) {
  const radians = Math.PI / 180;
  return new Quaternion()
    .setFromEuler(
      new Euler(beta * radians, alpha * radians, -gamma * radians, "YXZ"),
    )
    .multiply(
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2),
    )
    .multiply(
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -angle * radians),
    );
}

export class MotionControl {
  private phase: Phase = "off";
  private generation = 0;
  private listeners = new Set<() => void>();
  private initial: Quaternion | null = null;
  private base = new Quaternion();
  private distance = 1;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private canvas: HTMLCanvasElement,
    private camera: PerspectiveCamera,
    private target: Vector3,
    private changed: () => void,
    private invalidate: () => void,
  ) {
    canvas.addEventListener("pointerdown", this.stop);
    canvas.addEventListener("keydown", this.stop);
  }
  snapshot = () => this.phase;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get active() {
    return this.phase === "active";
  }
  private publish(phase: Phase) {
    this.phase = phase;
    this.listeners.forEach((listener) => listener());
    this.changed();
  }
  async start() {
    this.stop();
    const generation = this.generation;
    const api = (
      globalThis as typeof globalThis & {
        DeviceOrientationEvent?: typeof DeviceOrientationEvent & {
          requestPermission?: () => Promise<string>;
        };
      }
    ).DeviceOrientationEvent;
    if (!api) {
      this.publish("unsupported");
      return;
    }
    this.publish("requesting");
    try {
      const permission = api.requestPermission
        ? await api.requestPermission()
        : "granted";
      if (generation !== this.generation) return;
      if (permission !== "granted") {
        this.publish("denied");
        return;
      }
      this.recenter();
      window.addEventListener("deviceorientation", this.orientation);
      window.addEventListener("orientationchange", this.recenter);
      this.timer = setTimeout(() => {
        if (!this.active) {
          this.stop();
          this.publish("unsupported");
        }
      }, 5000);
    } catch {
      if (generation === this.generation) this.publish("denied");
    }
  }
  private recenter = () => {
    this.initial = null;
    this.base.copy(this.camera.quaternion);
    this.distance = Math.max(
      0.001,
      this.camera.position.distanceTo(this.target),
    );
  };
  private orientation = (event: DeviceOrientationEvent) => {
    const { alpha, beta, gamma } = event;
    if (
      alpha === null ||
      beta === null ||
      gamma === null ||
      ![alpha, beta, gamma].every(Number.isFinite)
    )
      return;
    const value = deviceQuaternion(
      alpha,
      beta,
      gamma,
      screen.orientation?.angle ?? 0,
    );
    if (!this.initial) {
      this.initial = value.clone().invert();
      clearTimeout(this.timer);
      this.publish("active");
    }
    if (!this.initial) return;
    this.camera.quaternion
      .copy(this.base)
      .multiply(this.initial)
      .multiply(value)
      .normalize();
    this.target
      .copy(this.camera.position)
      .addScaledVector(
        this.camera.getWorldDirection(new Vector3()),
        this.distance,
      );
    this.invalidate();
  };
  stop = () => {
    this.generation++;
    clearTimeout(this.timer);
    window.removeEventListener("deviceorientation", this.orientation);
    window.removeEventListener("orientationchange", this.recenter);
    this.initial = null;
    if (this.phase !== "off") this.publish("off");
  };
  dispose() {
    this.stop();
    this.canvas.removeEventListener("pointerdown", this.stop);
    this.canvas.removeEventListener("keydown", this.stop);
    this.listeners.clear();
  }
}
