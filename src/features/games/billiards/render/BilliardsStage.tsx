/**
 * Pixi rendering + interaction for the billiards table.
 *
 * React only mounts/unmounts the Pixi Application and forwards props;
 * all per-frame work (aiming, charging, shot playback) happens directly
 * in Pixi so the React tree never renders at animation rate. Shooting is
 * a slingshot gesture: drag behind the cue ball to aim + charge (the cue
 * pulls back), release to fire; releasing inside the dead zone re-aims.
 *
 * Layout: world units are meters with the table centered at the origin,
 * multiplied by a fixed pixels-per-meter; the root container is scaled
 * to fit the viewport and rotated 90° in portrait. Static table drawing
 * lives in ./table, ball views in ./balls, frame playback in ./playback.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
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

export interface BilliardsStageHandle {
  /** Animate a resolved move; resolves when the table is at rest again. */
  playPresentation(presentation: BilliardsPresentation): Promise<void>;
  /**
   * Show and swing the cue stick for a non-interactive (AI) shot: aim,
   * pull back to the shot power, then strike. Resolves after the strike.
   */
  animateAiCue(angle: number, power: number): Promise<void>;
}

export interface BilliardsStageProps {
  balls: BallState[];
  /** Local player may aim/shoot right now. */
  interactive: boolean;
  /** Local player must place the cue ball (drag on the table). */
  ballInHand: boolean;
  /** Live charge preview (0..1) while dragging, 0 on release/cancel. */
  onPowerPreview(power: number): void;
  /** Fired when a drag is released with enough charge. */
  onShot(angle: number, power: number): void;
  onPlaceCue(x: number, y: number): void;
}

interface Scene {
  setBalls(balls: BallState[]): void;
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

  // --- overlays -------------------------------------------------------
  const guideLayer = new Graphics();
  const cueLayer = new Container();
  const cueStick = new Graphics();
  // Tapered stick pointing in +x; pivot at the tip.
  const stickLen = px(1.05);
  cueStick
    .poly([0, -3.4, stickLen, -6.5, stickLen, 6.5, 0, 3.4])
    .fill(0x9a6b45)
    .poly([0, -3.4, px(0.12), -3.9, px(0.12), 3.9, 0, 3.4])
    .fill(0xd9c6a5);
  cueLayer.addChild(cueStick);
  cueLayer.visible = false;
  const ghostLayer = new Graphics();
  root.addChild(guideLayer, cueLayer, ghostLayer);

  // --- mutable scene state -------------------------------------------
  let balls: BallState[] = [];
  let interactive = false;
  let ballInHand = false;
  let aimAngle = Math.PI; // default: facing the rack from the head spot
  const cuePull = { value: 0 };
  let playing = false;
  /** AI shot in progress: show the cue stick even though not interactive. */
  let aiAiming = false;
  /** Slingshot drag in progress (aim + charge in one gesture). */
  let dragging = false;
  /** Ball-in-hand: provisional cue position, shown as the real ball. */
  let placing: { x: number; y: number; valid: boolean } | null = null;
  let placingDrag = false;

  /** Drag distances (meters): dead zone before charging starts, full range. */
  const PULL_DEADZONE = 0.07;
  const PULL_RANGE = 0.55;
  /** Below this charge a release just re-aims instead of shooting. */
  const FIRE_THRESHOLD = 0.05;

  function cuePos(): { x: number; y: number } | null {
    const cue = balls.find((b) => b.id === 0 && !b.potted);
    return cue ? { x: cue.x, y: cue.y } : null;
  }

  /** Starting spot for ball-in-hand: where it lies if legal, else respot. */
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
    const dash = 9;
    const gap = 7;
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
    g.stroke({ width: 2, color, alpha });
  }

  function redrawOverlays(): void {
    guideLayer.clear();
    ghostLayer.clear();
    cueLayer.visible = false;

    if (playing) return;

    if (aiAiming) {
      // AI turn: no aim guides, just the cue stick swinging at the ball.
      const cue = cuePos();
      if (cue) drawCueStick(px(cue.x), px(cue.y));
      return;
    }

    if (placing) {
      // Ball-in-hand: show the actual cue ball at the provisional spot
      // with a ring that flags invalid positions.
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
      ghostLayer
        .circle(px(placing.x), px(placing.y), r * 1.55)
        .stroke({
          width: 2,
          color: placing.valid ? 0x9fe8bd : 0xd93025,
          alpha: 0.9,
        });
      return;
    }
    if (!interactive || ballInHand) return;

    const guide = computeAimGuide(balls, aimAngle);
    if (!guide) return;

    const cx = px(guide.cue.x);
    const cy = px(guide.cue.y);
    const ix = px(guide.contact.x);
    const iy = px(guide.contact.y);
    drawDashedLine(guideLayer, cx, cy, ix, iy, 0xffffff, 0.75);
    guideLayer.circle(ix, iy, r).stroke({ width: 2, color: 0xffffff, alpha: 0.85 });

    if (guide.target) {
      const len = px(0.16 + 0.4 * guide.target.fullness);
      guideLayer
        .moveTo(px(guide.target.center.x), px(guide.target.center.y))
        .lineTo(
          px(guide.target.center.x) + guide.target.dir.x * len,
          px(guide.target.center.y) + guide.target.dir.y * len,
        )
        .stroke({ width: 3, color: 0xffe57f, alpha: 0.9 });
    }
    if (guide.cueDeflection && guide.target) {
      const len = px(0.1 + 0.28 * (1 - guide.target.fullness));
      guideLayer
        .moveTo(ix, iy)
        .lineTo(ix + guide.cueDeflection.x * len, iy + guide.cueDeflection.y * len)
        .stroke({ width: 2, color: 0xffffff, alpha: 0.4 });
    }

    // Cue stick behind the ball, pulled back with power.
    drawCueStick(cx, cy);
  }

  /** Position the cue stick behind (cx, cy), aimed along aimAngle. */
  function drawCueStick(cx: number, cy: number): void {
    cueLayer.visible = true;
    cueLayer.position.set(cx, cy);
    cueLayer.rotation = aimAngle + Math.PI;
    cueStick.x = r * 1.4 + cuePull.value * px(0.34);
  }

  // --- layout ---------------------------------------------------------
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

  // --- input ----------------------------------------------------------
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
      // Shoot away from the finger — pulling the cue back behind the ball.
      aimAngle = Math.atan2(-dy, -dx);
    }
    const pull = Math.max(
      0,
      Math.min(1, (dist - PULL_DEADZONE) / PULL_RANGE),
    );
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
      // Strike: snap the cue forward, then the shot takes over.
      gsap.to(cuePull, {
        value: 0,
        duration: 0.09,
        ease: "power4.in",
        onUpdate: redrawOverlays,
      });
      callbacks.onPowerPreview(0);
      callbacks.onShot(aimAngle, Math.max(0.06, pull));
    } else {
      // Released inside the dead zone: keep the aim, spring the cue back.
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
    const valid = insidePlayArea(p.x, p.y) && !overlapsAnyBall(balls, p.x, p.y, 0);
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

  // --- playback -------------------------------------------------------
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
      // Pull back over 0.4 s, then strike forward in 0.09 s.
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

export const BilliardsStage = forwardRef<BilliardsStageHandle, BilliardsStageProps>(
  function BilliardsStage(props, ref) {
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
  },
);
