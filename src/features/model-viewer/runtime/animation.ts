import {
  AnimationMixer,
  LoopOnce,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from "three";
import type { ModelPlaybackState } from "~/bindings";

export type LoopMode = "once" | "repeat" | "pingpong";
export type AnimationState = {
  clips: { name: string; duration: number }[];
  selected: number;
  time: number;
  duration: number;
  playing: boolean;
  scrubbing: boolean;
  speed: number;
  loop: LoopMode;
};

/** 播放头独立于 mixer 的循环计数，暂停定位和往返边界使用同一套时间语义。 */
export class ModelAnimation {
  poseVersion = 0;
  private mixer: AnimationMixer;
  private action: AnimationAction | null = null;
  private listeners = new Set<() => void>();
  private elapsed = 0;
  private sincePublish = 0;
  private disposed = false;
  private state: AnimationState;
  private published: AnimationState;

  constructor(
    private root: Object3D,
    private clips: AnimationClip[],
    private invalidate: () => void,
  ) {
    this.mixer = new AnimationMixer(root);
    this.state = {
      clips: clips.map((clip) => ({
        name: clip.name,
        duration: Number.isFinite(clip.duration)
          ? Math.max(0, clip.duration)
          : 0,
      })),
      selected: -1,
      time: 0,
      duration: 0,
      playing: false,
      scrubbing: false,
      speed: 1,
      loop: "repeat",
    };
    this.published = this.state;
    if (clips.length) this.select(0);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.published;
  persist(): ModelPlaybackState {
    return {
      selected: this.state.selected,
      time: this.state.time,
      phase: this.elapsed,
      playing: this.state.playing,
      speed: this.state.speed,
      loopMode: this.state.loop,
    };
  }
  restore(value: ModelPlaybackState) {
    this.select(value.selected);
    this.setSpeed(value.speed);
    this.setLoop(value.loopMode as LoopMode);
    this.seek(value.time);
    // 往返动画需要保留循环相位，否则重启后会改变播放方向。
    this.elapsed = Math.min(this.state.duration * 2, value.phase);
    if (value.playing) this.play();
  }
  get running() {
    return !this.disposed && this.state.playing && !this.state.scrubbing;
  }

  private publish() {
    this.published = { ...this.state };
    this.sincePublish = 0;
    this.listeners.forEach((listener) => listener());
  }
  private evaluate(time: number) {
    this.poseVersion++;
    this.state = { ...this.state, time };
    if (this.action) {
      this.action.enabled = true;
      this.action.paused = true;
      this.action.time = time;
      this.mixer.update(0);
      this.root.updateMatrixWorld(true);
    }
  }
  select(index: number) {
    if (this.disposed || !Number.isInteger(index) || !this.clips[index]) return;
    this.mixer.stopAllAction();
    this.action = this.mixer.clipAction(this.clips[index]);
    this.action.reset().setLoop(LoopOnce, 1).play();
    this.action.clampWhenFinished = true;
    this.elapsed = 0;
    this.state = {
      ...this.state,
      selected: index,
      duration: this.state.clips[index].duration,
      playing: false,
      scrubbing: false,
    };
    this.evaluate(0);
    this.publish();
    this.invalidate();
  }
  play() {
    if (this.disposed || !this.state.duration) return;
    if (this.state.loop === "once" && this.state.time >= this.state.duration)
      this.seek(0);
    this.state = { ...this.state, playing: true };
    this.publish();
    this.invalidate();
  }
  pause() {
    this.state = { ...this.state, playing: false };
    this.publish();
  }
  stop() {
    this.state = { ...this.state, playing: false, scrubbing: false };
    this.seek(0);
  }
  seek(time: number) {
    if (this.disposed || !Number.isFinite(time)) return;
    this.elapsed = Math.max(0, Math.min(this.state.duration, time));
    this.evaluate(this.elapsed);
    this.publish();
    this.invalidate();
  }
  beginScrub() {
    this.state = { ...this.state, scrubbing: true };
    this.publish();
  }
  endScrub() {
    if (!this.state.scrubbing) return;
    this.state = { ...this.state, scrubbing: false };
    this.publish();
    this.invalidate();
  }
  setSpeed(speed: number) {
    if (![0.25, 0.5, 1, 1.5, 2].includes(speed)) return;
    this.state = { ...this.state, speed };
    this.publish();
  }
  setLoop(loop: LoopMode) {
    this.elapsed = this.state.time;
    this.state = { ...this.state, loop };
    this.publish();
  }
  update(delta: number) {
    if (!this.running || delta <= 0 || !Number.isFinite(delta)) return;
    const { duration, speed, loop } = this.state;
    this.elapsed += delta * speed;
    let time: number;
    if (loop === "once") {
      time = Math.min(duration, this.elapsed);
      if (time === duration) this.state = { ...this.state, playing: false };
    } else {
      const phase = this.elapsed % (duration * (loop === "pingpong" ? 2 : 1));
      time = phase > duration ? duration * 2 - phase : phase;
      // 保持长时间播放的数值精度，不依赖累计循环次数。
      this.elapsed = phase;
    }
    this.evaluate(time);
    this.sincePublish += delta;
    if (this.sincePublish >= 0.1 || !this.running) this.publish();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.action = null;
    this.listeners.clear();
  }
}
