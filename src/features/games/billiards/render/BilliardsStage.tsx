/**
 * 台球桌的 Pixi 渲染与交互。
 *
 * React 只负责挂载/卸载 Pixi 应用并透传 props；所有逐帧工作（瞄准、
 * 蓄力、击球回放）直接在 Pixi 中进行，因此 React 树不会以动画帧率
 * 重渲染。击球是一个弹弓手势：在母球后方拖动以瞄准并蓄力（球杆后拉），
 * 松手击出；在死区内松手则重新瞄准。
 *
 * 布局：世界单位为米，球桌以原点为中心，乘以固定的每米像素数；根容器
 * 缩放以适配视口，并在竖屏时旋转 90°。静态球桌绘制在 ./table，球视图
 * 在 ./balls，帧回放在 ./playback。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  Application,
  Container,
  Graphics,
  type FederatedPointerEvent,
} from "pixi.js";
import gsap from "gsap";
import { BALL_RADIUS, HEAD_SPOT_X } from "../constants";
import { insidePlayArea, overlapsAnyBall } from "../physics";
import type { BallState, BilliardsPresentation } from "../types";
import { unlockAudio } from "./audio";
import { createBallLayer } from "./balls";
import { computeAimGuide } from "./guides";
import { runPresentation } from "./playback";
import { buildTable, OUTER_H, OUTER_W, PPM, px } from "./table";
import { createCueView } from "./cue";

export interface BilliardsStageHandle {
  /** 播放已结算的走子；当球桌再次静止时 resolve。 */
  playPresentation(presentation: BilliardsPresentation): Promise<void>;
  /**
   * 为非交互（AI）的一杆展示并挥动球杆：瞄准，后拉到击球力度，然后
   * 击出。击出后 resolve。
   */
  animateAiCue(angle: number, power: number): Promise<void>;
}

export interface BilliardsStageProps {
  balls: BallState[];
  /** 本地玩家此时可以瞄准/击球。 */
  interactive: boolean;
  /** 本地玩家需要放置母球（在桌面上拖动）。 */
  ballInHand: boolean;
  /** 跟杆/缩杆旋转：-0.7 缩杆，0 中性，+0.7 跟杆。 */
  followDraw: number;
  /** 拖动时实时蓄力预览（0..1），松开/取消时为 0。 */
  onPowerPreview(power: number): void;
  /** 拖动在蓄力足够时松手触发。 */
  onShot(angle: number, power: number): void;
  onPlaceCue(x: number, y: number): void;
}

interface Scene {
  setBalls(balls: BallState[]): void;
  setFollowDraw(followDraw: number): void;
  setInteraction(interactive: boolean, ballInHand: boolean): void;
  playPresentation(presentation: BilliardsPresentation): Promise<void>;
  animateAiCue(angle: number, power: number): Promise<void>;
  destroy(): void;
}

function createScene(
  app: Application,
  callbacks: {
    onPowerPreview(power: number): void;
    onShot(angle: number, power: number): void;
    onPlaceCue(x: number, y: number): void;
  },
): Scene {
  const root = new Container();
  app.stage.addChild(root);

  root.addChild(buildTable());
  const ballLayer = createBallLayer();
  root.addChild(ballLayer.layer);
  const r = px(BALL_RADIUS);

  // --- 叠加层 -----------------------------------------------------
  const guideLayer = new Graphics();
  const { layer: cueLayer, stick: cueStick } = createCueView();
  const ghostLayer = new Graphics();
  root.addChild(guideLayer, cueLayer, ghostLayer);

  // --- 可变场景状态 -----------------------------------------------
  let balls: BallState[] = [];
  let interactive = false;
  let ballInHand = false;
  let followDraw = 0;
  let aimAngle = Math.PI; // 默认：从头顶线朝向球堆
  const cuePull = { value: 0 };
  let playing = false;
  /** AI 击球进行中：即使非交互也显示球杆。 */
  let aiAiming = false;
  /** 弹弓拖动进行中（一次手势完成瞄准 + 蓄力）。 */
  let dragging = false;
  /** 自由球：临时母球位置，以真实球显示。 */
  let placing: { x: number; y: number; valid: boolean } | null = null;
  let placingDrag = false;

  /** 拖动距离（米）：开始蓄力前的死区，以及完整行程。 */
  const PULL_DEADZONE = 0.07;
  const PULL_RANGE = 0.55;
  /** 蓄力低于此值时松手只是重新瞄准而非击球。 */
  const FIRE_THRESHOLD = 0.05;

  function cuePos(): { x: number; y: number } | null {
    const cue = balls.find((b) => b.id === 0 && !b.potted);
    return cue ? { x: cue.x, y: cue.y } : null;
  }

  /** 自由球的起始落点：合法则取当前位置，否则重置。 */
  function defaultCueSpot(): { x: number; y: number } {
    const cue = balls.find((b) => b.id === 0);
    if (
      cue &&
      !cue.potted &&
      insidePlayArea(cue.x, cue.y) &&
      !overlapsAnyBall(balls, cue.x, cue.y, 0)
    ) {
      return { x: cue.x, y: cue.y };
    }
    const candidates: Array<[number, number]> = [[HEAD_SPOT_X, 0]];
    for (let d = 1; d <= 30; d++) {
      candidates.push(
        [HEAD_SPOT_X - d * BALL_RADIUS, 0],
        [HEAD_SPOT_X + d * BALL_RADIUS, 0],
        [HEAD_SPOT_X, d * BALL_RADIUS],
        [HEAD_SPOT_X, -d * BALL_RADIUS],
      );
    }
    const hit = candidates.find(
      ([x, y]) => insidePlayArea(x, y) && !overlapsAnyBall(balls, x, y, 0),
    );
    return hit ? { x: hit[0], y: hit[1] } : { x: 0, y: 0 };
  }

  function drawDashedLine(
    g: Graphics,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: number,
    alpha: number,
  ): void {
    const dash = 8;
    const gap = 5;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(d + dash, len);
      g.moveTo(x0 + ux * d, y0 + uy * d).lineTo(x0 + ux * e, y0 + uy * e);
    }
    g.stroke({ width: 1.5, color, alpha });
  }

  function redrawOverlays(): void {
    guideLayer.clear();
    ghostLayer.clear();
    cueLayer.visible = false;

    if (playing) return;

    if (aiAiming) {
      // AI 回合：不画瞄准辅助，只挥动球杆击球。
      const cue = cuePos();
      if (cue) drawCueStick(px(cue.x), px(cue.y));
      return;
    }

    if (placing) {
      // 自由球：在临时落点显示真实母球，并叠加一个环标记非法位置。
      const cueView = ballLayer.view(0);
      if (cueView) {
        gsap.killTweensOf(cueView);
        gsap.killTweensOf(cueView.scale);
        gsap.killTweensOf(cueView.position);
        cueView.visible = true;
        cueView.scale.set(1);
        cueView.alpha = placing.valid ? 1 : 0.55;
        cueView.position.set(px(placing.x), px(placing.y));
      }
      ghostLayer.circle(px(placing.x), px(placing.y), r * 1.5).stroke({
        width: 1.5,
        color: placing.valid ? 0x9fe8bd : 0xd93025,
        alpha: 0.85,
      });
      return;
    }
    if (!interactive || ballInHand) return;

    const guide = computeAimGuide(balls, aimAngle, followDraw);
    if (!guide) return;

    const cx = px(guide.cue.x);
    const cy = px(guide.cue.y);
    const ix = px(guide.contact.x);
    const iy = px(guide.contact.y);
    drawDashedLine(guideLayer, cx, cy, ix, iy, 0xffffff, 0.65);
    // 虚拟球：细环加极淡填充，让它看起来是位置而非另一颗球。
    guideLayer
      .circle(ix, iy, r)
      .fill({ color: 0xffffff, alpha: 0.06 })
      .circle(ix, iy, r)
      .stroke({ width: 1.2, color: 0xffffff, alpha: 0.75 });

    if (guide.target) {
      const len = px(0.16 + 0.4 * guide.target.fullness);
      guideLayer
        .moveTo(px(guide.target.center.x), px(guide.target.center.y))
        .lineTo(
          px(guide.target.center.x) + guide.target.dir.x * len,
          px(guide.target.center.y) + guide.target.dir.y * len,
        )
        .stroke({ width: 1.8, color: 0xffe57f, alpha: 0.85 });
    }
    if (guide.cueDeflection && guide.target) {
      const len = px(0.1 + 0.28 * (1 - guide.target.fullness));
      guideLayer
        .moveTo(ix, iy)
        .lineTo(
          ix + guide.cueDeflection.x * len,
          iy + guide.cueDeflection.y * len,
        )
        .stroke({ width: 1.2, color: 0xffffff, alpha: 0.35 });
    }

    // 球后方的球杆，随力度后拉。
    drawCueStick(cx, cy);
  }

  /** 将球杆摆到 (cx, cy) 后方，沿 aimAngle 方向瞄准。 */
  function drawCueStick(cx: number, cy: number): void {
    cueLayer.visible = true;
    cueLayer.position.set(cx, cy);
    cueLayer.rotation = aimAngle + Math.PI;
    cueStick.x = r * 1.4 + cuePull.value * px(0.34);
  }

  // --- 布局 -------------------------------------------------------
  function relayout(): void {
    const w = app.screen.width;
    const h = app.screen.height;
    const worldW = px(OUTER_W * 2);
    const worldH = px(OUTER_H * 2);
    const portrait = h > w;
    const fitW = portrait ? worldH : worldW;
    const fitH = portrait ? worldW : worldH;
    const scale = Math.min(w / fitW, h / fitH) * 0.98;
    root.position.set(w / 2, h / 2);
    root.scale.set(scale);
    root.rotation = portrait ? -Math.PI / 2 : 0;
  }
  relayout();
  app.renderer.on("resize", relayout);

  // --- 输入 -------------------------------------------------------
  app.stage.eventMode = "static";
  app.stage.hitArea = { contains: () => true };

  function toTable(e: FederatedPointerEvent): { x: number; y: number } {
    const p = root.toLocal(e.global);
    return { x: p.x / PPM, y: p.y / PPM };
  }

  function updateDrag(e: FederatedPointerEvent): void {
    const cue = cuePos();
    if (!cue) return;
    const p = toTable(e);
    const dx = p.x - cue.x;
    const dy = p.y - cue.y;
    const dist = Math.hypot(dx, dy);
    if (dist > PULL_DEADZONE * 0.5) {
      // 朝手指反方向击出——把球杆拉到球后方。
      aimAngle = Math.atan2(-dy, -dx);
    }
    const pull = Math.max(0, Math.min(1, (dist - PULL_DEADZONE) / PULL_RANGE));
    gsap.killTweensOf(cuePull);
    cuePull.value = pull;
    callbacks.onPowerPreview(pull);
    redrawOverlays();
  }

  function releaseDrag(): void {
    if (!dragging) return;
    dragging = false;
    const pull = cuePull.value;
    if (pull >= FIRE_THRESHOLD) {
      // 击打：球杆快速前送，随后由击球接管。
      gsap.to(cuePull, {
        value: 0,
        duration: 0.09,
        ease: "power4.in",
        onUpdate: redrawOverlays,
      });
      callbacks.onPowerPreview(0);
      callbacks.onShot(aimAngle, Math.max(0.06, pull));
    } else {
      // 在死区内松手：保留瞄准，球杆弹性回位。
      gsap.to(cuePull, {
        value: 0,
        duration: 0.45,
        ease: "elastic.out(1, 0.4)",
        onUpdate: redrawOverlays,
      });
      callbacks.onPowerPreview(0);
    }
  }

  function updatePlacement(e: FederatedPointerEvent, commit: boolean): void {
    const p = toTable(e);
    const valid =
      insidePlayArea(p.x, p.y) && !overlapsAnyBall(balls, p.x, p.y, 0);
    placing = { x: p.x, y: p.y, valid };
    if (commit && valid) {
      callbacks.onPlaceCue(p.x, p.y);
    }
    redrawOverlays();
  }

  app.stage.on("pointerdown", (e: FederatedPointerEvent) => {
    unlockAudio();
    if (playing || !interactive) return;
    if (ballInHand) {
      placingDrag = true;
      updatePlacement(e, false);
      return;
    }
    dragging = true;
    updateDrag(e);
  });
  app.stage.on("pointermove", (e: FederatedPointerEvent) => {
    if (playing || !interactive) return;
    if (ballInHand) {
      if (placingDrag) updatePlacement(e, false);
      return;
    }
    if (dragging) updateDrag(e);
  });
  const endPointer = (e: FederatedPointerEvent) => {
    if (ballInHand && placingDrag) {
      placingDrag = false;
      updatePlacement(e, true);
      return;
    }
    releaseDrag();
  };
  app.stage.on("pointerup", endPointer);
  app.stage.on("pointerupoutside", endPointer);

  // --- 回放 -------------------------------------------------------
  function playPresentation(
    presentation: BilliardsPresentation,
  ): Promise<void> {
    playing = true;
    placing = null;
    dragging = false;
    cuePull.value = 0;
    redrawOverlays();
    if (presentation.frames.length === 0) {
      playing = false;
      return Promise.resolve();
    }
    return runPresentation(app, presentation, {
      moveBall: ballLayer.move,
      ballView: ballLayer.view,
      onDone: () => {
        playing = false;
        redrawOverlays();
      },
    });
  }

  function animateAiCue(angle: number, power: number): Promise<void> {
    aimAngle = angle;
    cuePull.value = 0;
    aiAiming = true;
    redrawOverlays();
    return new Promise((resolve) => {
      // 后拉耗时 0.4 秒，再以 0.09 秒前送击出。
      gsap.to(cuePull, {
        value: power,
        duration: 0.4,
        ease: "power2.inOut",
        onUpdate: redrawOverlays,
        onComplete: () => {
          gsap.to(cuePull, {
            value: 0,
            duration: 0.09,
            ease: "power4.in",
            onUpdate: redrawOverlays,
            onComplete: () => {
              aiAiming = false;
              redrawOverlays();
              resolve();
            },
          });
        },
      });
    });
  }

  return {
    setBalls(next) {
      balls = next;
      if (!playing) {
        ballLayer.sync(balls);
        redrawOverlays();
      }
    },
    setFollowDraw(nextFollowDraw) {
      followDraw = nextFollowDraw;
      redrawOverlays();
    },
    setInteraction(nextInteractive, nextBallInHand) {
      interactive = nextInteractive;
      ballInHand = nextBallInHand;
      if (ballInHand && interactive) {
        placing ??= { ...defaultCueSpot(), valid: true };
      } else {
        placing = null;
        placingDrag = false;
      }
      if (!interactive) {
        dragging = false;
        cuePull.value = 0;
      }
      redrawOverlays();
    },
    playPresentation,
    animateAiCue,
    destroy() {
      gsap.killTweensOf(cuePull);
      app.renderer.off("resize", relayout);
    },
  };
}

export const BilliardsStage = forwardRef<
  BilliardsStageHandle,
  BilliardsStageProps
>(function BilliardsStage(props, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    let disposed = false;
    let app: Application | null = null;

    void (async () => {
      const nextApp = new Application();
      await nextApp.init({
        antialias: true,
        backgroundAlpha: 0,
        resolution: Math.min(window.devicePixelRatio || 1, 3),
        autoDensity: true,
        resizeTo: host,
      });
      if (disposed) {
        nextApp.destroy(true);
        return;
      }
      app = nextApp;
      host.appendChild(nextApp.canvas);
      const scene = createScene(nextApp, {
        onPowerPreview: (power) => propsRef.current.onPowerPreview(power),
        onShot: (angle, power) => propsRef.current.onShot(angle, power),
        onPlaceCue: (x, y) => propsRef.current.onPlaceCue(x, y),
      });
      sceneRef.current = scene;
      scene.setBalls(propsRef.current.balls);
      scene.setFollowDraw(propsRef.current.followDraw);
      scene.setInteraction(
        propsRef.current.interactive,
        propsRef.current.ballInHand,
      );
    })();

    return () => {
      disposed = true;
      sceneRef.current?.destroy();
      sceneRef.current = null;
      app?.destroy(true, { children: true, texture: true });
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setBalls(props.balls);
  }, [props.balls]);
  useEffect(() => {
    sceneRef.current?.setFollowDraw(props.followDraw);
  }, [props.followDraw]);
  useEffect(() => {
    sceneRef.current?.setInteraction(props.interactive, props.ballInHand);
  }, [props.interactive, props.ballInHand]);

  useImperativeHandle(
    ref,
    () => ({
      playPresentation: (presentation) =>
        sceneRef.current?.playPresentation(presentation) ?? Promise.resolve(),
      animateAiCue: (angle, power) =>
        sceneRef.current?.animateAiCue(angle, power) ?? Promise.resolve(),
    }),
    [],
  );

  return <div ref={containerRef} className="h-full w-full touch-none" />;
});
