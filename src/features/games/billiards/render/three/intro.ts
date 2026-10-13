import gsap from "gsap";

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
  camera(value: number): void;
  reveal(value: number): void;
  update(): void;
  ready(): void;
}) {
  const state = {
    camera: options.reduced ? 0 : options.repeat ? 0.5 : 1,
    reveal: 0,
  };
  let disposed = false;

  const update = () => {
    if (disposed) return;
    options.camera(state.camera);
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
  // 先显现完整场景，再完成缓推近，让可见阶段保留收稳过程；减少动态效果只淡入。
  timeline.to(
    state,
    {
      camera: 0,
      duration: options.reduced ? 0.16 : options.repeat ? 0.28 : 0.5,
      ease: "power2.inOut",
    },
    0,
  );
  timeline.to(
    state,
    {
      reveal: 1,
      duration: options.reduced ? 0.16 : options.repeat ? 0.14 : 0.18,
      ease: "power2.out",
    },
    0,
  );
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
