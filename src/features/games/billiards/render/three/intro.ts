import gsap from "gsap";

import type { RackPose } from "./rack-intro";

const entered = new WeakSet<Element>();

/** 用仍存活的游戏页区分首次进入与重开，切页后不保留页面或场景引用。 */
export function hasEntered(host: Element) {
  return entered.has(host);
}

export function markEntered(host: Element) {
  entered.add(host);
}

export function createIntro(options: {
  repeat: boolean;
  reduced: boolean;
  resume?: boolean;
  camera(value: number): void;
  rack?(pose: RackPose): void;
  reveal(value: number): void;
  update(): void;
  ready(): void;
}) {
  const state = {
    camera: options.reduced || options.resume ? 0 : 1,
    reveal: 0,
    push: 0,
    lift: 0,
    exit: 0,
    opacity: 1,
  };
  let disposed = false;

  const update = () => {
    if (disposed) return;
    options.camera(state.camera);
    options.rack?.(state);
    options.reveal(state.reveal);
    options.update();
  };

  const timeline = gsap.timeline({
    paused: true,
    onUpdate: update,
    onComplete() {
      if (disposed) return;
      update();
      options.ready();
    },
  });
  if (options.reduced || options.resume) {
    timeline.to(state, { reveal: 1, duration: 0.16, ease: "power2.out" });
  } else {
    const duration = (options.repeat ? 1.3 : 2.2) / 1.55;
    timeline
      .to(
        state,
        { reveal: 1, duration: 0.12 * duration, ease: "power2.out" },
        0,
      )
      .to(
        state,
        { push: 1, duration: 0.58 * duration, ease: "power2.inOut" },
        0.12 * duration,
      )
      .to(
        state,
        { lift: 1, duration: 0.24 * duration, ease: "power2.inOut" },
        0.7 * duration,
      )
      .to(
        state,
        { exit: 1, duration: 0.32 * duration, ease: "power2.inOut" },
        0.94 * duration,
      )
      .to(
        state,
        { opacity: 0, duration: 0.18 * duration, ease: "power2.out" },
        1.08 * duration,
      )
      .to(
        state,
        { camera: 0, duration: 0.85 * duration, ease: "power2.inOut" },
        0.7 * duration,
      );
  }
  update();
  timeline.play();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      timeline.kill();
    },
  };
}
