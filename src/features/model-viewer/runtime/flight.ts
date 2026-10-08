import { Euler, Vector3, type PerspectiveCamera } from "three";

export function flightDisplacement(
  camera: PerspectiveCamera,
  x: number,
  forward: number,
  up: number,
  distance: number,
) {
  const direction = camera.getWorldDirection(new Vector3());
  const right = new Vector3().crossVectors(direction, camera.up).normalize();
  return direction
    .multiplyScalar(forward)
    .addScaledVector(right, x)
    .addScaledVector(camera.up, up)
    .clampLength(0, 1)
    .multiplyScalar(distance);
}

/** 自由移动只接收画布焦点和显式触控输入，表单键盘不会驱动相机。 */
export class FlightControls {
  enabled = false;
  speed = 1;
  setSpeed(value: number) {
    if (Number.isFinite(value)) this.speed = Math.max(0.1, Math.min(10, value));
  }
  private keys = new Set<string>();
  private stick = [0, 0, 0];
  private pointer: { id: number; x: number; y: number } | null = null;
  private locked = false;
  private lockGeneration = 0;
  constructor(
    private canvas: HTMLCanvasElement,
    private camera: PerspectiveCamera,
    private target: Vector3,
    private invalidate: () => void,
    private exit: () => void,
  ) {
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", this.clear);
    document.addEventListener("pointerlockchange", this.lockChange);
    canvas.addEventListener("pointerdown", this.down, true);
    canvas.addEventListener("pointermove", this.move, true);
    canvas.addEventListener("pointerup", this.up, true);
    canvas.addEventListener("pointercancel", this.up, true);
    canvas.addEventListener("lostpointercapture", this.up, true);
  }
  private keyDown = (event: KeyboardEvent) => {
    if (!this.enabled) return;
    if (event.code === "Escape") {
      this.exit();
      return;
    }
    const focused = document.activeElement;
    if (
      focused !== this.canvas &&
      focused !== this.canvas.parentElement &&
      document.pointerLockElement !== this.canvas
    )
      return;
    if (
      [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "KeyQ",
        "KeyE",
        "ShiftLeft",
        "ShiftRight",
      ].includes(event.code)
    ) {
      this.keys.add(event.code);
      event.preventDefault();
      this.invalidate();
    }
  };
  private keyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };
  private lockChange = () => {
    const locked = document.pointerLockElement === this.canvas;
    if (this.locked && !locked) this.exit();
    this.locked = locked;
  };
  async lock() {
    if (!this.enabled || !this.canvas.requestPointerLock) return false;
    const generation = ++this.lockGeneration;
    try {
      await this.canvas.requestPointerLock();
      if (!this.enabled || generation !== this.lockGeneration) {
        this.unlock();
        return false;
      }
      return document.pointerLockElement === this.canvas;
    } catch {
      return false;
    }
  }
  private unlock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
  private down = (event: PointerEvent) => {
    if (!this.enabled || this.pointer || event.button !== 0) return;
    this.canvas.parentElement?.focus();
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    if (!this.locked) this.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  private move = (event: PointerEvent) => {
    if (!this.enabled || (!this.locked && this.pointer?.id !== event.pointerId))
      return;
    const x = this.locked ? event.movementX : event.clientX - this.pointer!.x;
    const y = this.locked ? event.movementY : event.clientY - this.pointer!.y;
    if (this.pointer) {
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
    }
    this.look(x * 0.003, y * 0.003);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  look(x: number, y: number) {
    if (!this.enabled) return;
    const angles = new Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    angles.y -= x;
    angles.x = Math.max(
      -Math.PI / 2 + 0.01,
      Math.min(Math.PI / 2 - 0.01, angles.x - y),
    );
    this.camera.quaternion.setFromEuler(angles);
    this.syncTarget();
    this.invalidate();
  }
  private up = (event: PointerEvent) => {
    if (this.pointer?.id !== event.pointerId) return;
    this.pointer = null;
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
  };
  input(x: number, forward: number, up = this.stick[2]) {
    this.stick = [x, forward, up];
    this.invalidate();
  }
  vertical(up: number) {
    this.stick[2] = up;
    this.invalidate();
  }
  nudge(x: number, forward: number, up = 0) {
    if (!this.enabled) return;
    this.camera.position.add(
      flightDisplacement(this.camera, x, forward, up, this.speed * 0.15),
    );
    this.syncTarget();
    this.invalidate();
  }
  private syncTarget() {
    this.target
      .copy(this.camera.position)
      .add(this.camera.getWorldDirection(new Vector3()));
  }
  update(delta: number) {
    if (!this.enabled) return false;
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    const x = k("KeyD") - k("KeyA") + this.stick[0];
    const forward = k("KeyW") - k("KeyS") + this.stick[1];
    const up = k("KeyE") - k("KeyQ") + this.stick[2];
    if (!x && !forward && !up) return false;
    const distance =
      Math.min(delta, 0.05) *
      this.speed *
      (k("ShiftLeft") || k("ShiftRight") ? 4 : 1);
    this.camera.position.add(
      flightDisplacement(this.camera, x, forward, up, distance),
    );
    this.syncTarget();
    return true;
  }
  clear = () => {
    this.keys.clear();
    this.stick = [0, 0, 0];
    const id = this.pointer?.id;
    this.pointer = null;
    if (id !== undefined && this.canvas.hasPointerCapture(id))
      this.canvas.releasePointerCapture(id);
    this.lockGeneration++;
    this.unlock();
  };
  dispose() {
    this.enabled = false;
    this.clear();
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.clear);
    document.removeEventListener("pointerlockchange", this.lockChange);
    this.canvas.removeEventListener("pointerdown", this.down, true);
    this.canvas.removeEventListener("pointermove", this.move, true);
    this.canvas.removeEventListener("pointerup", this.up, true);
    this.canvas.removeEventListener("pointercancel", this.up, true);
    this.canvas.removeEventListener("lostpointercapture", this.up, true);
  }
}
