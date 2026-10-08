import type { ModelThermalState } from "~/bindings";

type State = {
  level: number;
  thermal: ModelThermalState;
  frameMs: number;
  workMs: number;
};

/** 仅统计实际连续渲染的帧间隔和 JS/渲染提交耗时，不将其称为 GPU 时间或温度。 */
export class RenderBudget {
  private state: State = {
    level: 0,
    thermal: "unknown",
    frameMs: 0,
    workMs: 0,
  };
  private listeners = new Set<() => void>();
  private lastRender = -Infinity;
  private elapsed = 0;
  private count = 0;
  private frames = 0;
  private work = 0;
  private slow = 0;
  private stable = 0;
  constructor(private resize: () => void) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get pixelRatio() {
    return [2, 1.5, 1][this.state.level];
  }
  get interval() {
    return [0, 1000 / 30, 1000 / 20][this.state.level];
  }
  shouldRender(time: number) {
    if (time - this.lastRender + 0.5 < this.interval) return false;
    this.lastRender = time;
    return true;
  }
  private publish(patch: Partial<State>) {
    const old = this.state.level;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
    if (old !== this.state.level) this.resize();
  }
  setThermal(thermal: ModelThermalState) {
    const floor = thermal === "critical" ? 2 : thermal === "serious" ? 1 : 0;
    if (thermal !== this.state.thermal)
      this.publish({ thermal, level: Math.max(floor, this.state.level) });
  }
  sample(frameMs: number, workMs: number) {
    if (frameMs <= 0 || frameMs > 250 || !Number.isFinite(frameMs + workMs))
      return;
    this.elapsed += frameMs;
    this.frames += frameMs;
    this.work += workMs;
    this.count++;
    if (this.elapsed < 2000) return;
    const average = this.frames / this.count;
    const work = this.work / this.count;
    const target = this.interval || 1000 / 60;
    const slow = average > target * 1.65 || work > target * 0.9;
    this.slow = slow ? this.slow + 1 : 0;
    this.stable = !slow && work < 12 ? this.stable + this.elapsed : 0;
    const floor =
      this.state.thermal === "critical"
        ? 2
        : this.state.thermal === "serious"
          ? 1
          : 0;
    let level = this.state.level;
    if (this.slow >= 2) {
      level = Math.min(2, level + 1);
      this.slow = 0;
      this.stable = 0;
    } else if (this.stable >= 30000) {
      level = Math.max(floor, level - 1);
      this.stable = 0;
    }
    this.publish({
      level,
      frameMs: Math.round(average),
      workMs: Math.round(work),
    });
    this.elapsed = 0;
    this.count = 0;
    this.frames = 0;
    this.work = 0;
  }
  pause() {
    this.lastRender = -Infinity;
    this.elapsed = 0;
    this.count = 0;
    this.frames = 0;
    this.work = 0;
    this.slow = 0;
    this.stable = 0;
  }
  dispose() {
    this.listeners.clear();
  }
}
