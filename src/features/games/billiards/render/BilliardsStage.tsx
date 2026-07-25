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
 * to fit the viewport and rotated 90° in portrait.
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
  Text,
  TextStyle,
  type FederatedPointerEvent,
  type Ticker,
} from "pixi.js";
import gsap from "gsap";
import {
  BALL_RADIUS,
  CUSHION_THICKNESS,
  FIXED_DT,
  FOOT_SPOT_X,
  HEAD_SPOT_X,
  POCKETS,
  TABLE_H,
  TABLE_W,
} from "../constants";
import { cushionSegments, insidePlayArea, overlapsAnyBall } from "../physics";
import { ballColorNumber } from "../colors";
import type { BallState, BilliardsPresentation } from "../types";
import { playImpactEvent, unlockAudio } from "./audio";
import { computeAimGuide } from "./guides";

/** Pixels per meter at root scale 1 (text stays crisp when downscaled). */
const PPM = 320;
/** Wood frame width beyond the cushions, meters. */
const FRAME = 0.09;

export interface BilliardsStageHandle {
  /** Animate a resolved move; resolves when the table is at rest again. */
  playPresentation(presentation: BilliardsPresentation): Promise<void>;
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
  destroy(): void;
}

const px = (m: number): number => m * PPM;

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

  // --- static table ---------------------------------------------------
  const table = new Graphics();
  const outerW = TABLE_W / 2 + CUSHION_THICKNESS + FRAME;
  const outerH = TABLE_H / 2 + CUSHION_THICKNESS + FRAME;
  table
    .roundRect(px(-outerW), px(-outerH), px(outerW * 2), px(outerH * 2), px(0.07))
    .fill(0x5d4037)
    .roundRect(
      px(-(TABLE_W / 2 + CUSHION_THICKNESS)),
      px(-(TABLE_H / 2 + CUSHION_THICKNESS)),
      px(TABLE_W + CUSHION_THICKNESS * 2),
      px(TABLE_H + CUSHION_THICKNESS * 2),
      px(0.02),
    )
    .fill(0x1e5e40);
  // Cushions reuse the physics hulls so the picture matches the collisions.
  for (const segment of cushionSegments()) {
    table.poly(segment.points.map((v) => px(v))).fill(0x2a7a54);
  }
  // Felt playing surface on top of the cushion band background.
  table
    .rect(px(-TABLE_W / 2), px(-TABLE_H / 2), px(TABLE_W), px(TABLE_H))
    .fill(0x2e8557);
  // Head string + foot spot markings.
  table
    .moveTo(px(HEAD_SPOT_X), px(-TABLE_H / 2))
    .lineTo(px(HEAD_SPOT_X), px(TABLE_H / 2))
    .stroke({ width: 1.5, color: 0xffffff, alpha: 0.14 });
  table.circle(px(FOOT_SPOT_X), 0, 3).fill({ color: 0xffffff, alpha: 0.35 });
  // Rail sights (diamonds).
  const sightRail = TABLE_H / 2 + CUSHION_THICKNESS + FRAME / 2;
  const sightRailX = TABLE_W / 2 + CUSHION_THICKNESS + FRAME / 2;
  const sightXs = [-3, -2, -1, 1, 2, 3].map((k) => (k * TABLE_W) / 8);
  const sightYs = [-1, 0, 1].map((k) => (k * TABLE_H) / 4);
  const drawSight = (x: number, y: number): void => {
    const s = 3.4;
    table
      .poly([x, y - s, x + s, y, x, y + s, x - s, y])
      .fill({ color: 0xe8ddc8, alpha: 0.6 });
  };
  for (const sx of sightXs) {
    drawSight(px(sx), px(-sightRail));
    drawSight(px(sx), px(sightRail));
  }
  for (const sy of sightYs) {
    drawSight(px(-sightRailX), px(sy));
    drawSight(px(sightRailX), px(sy));
  }
  // Cushion inner-face highlight.
  for (const segment of cushionSegments()) {
    table
      .moveTo(px(segment.points[0]), px(segment.points[1]))
      .lineTo(px(segment.points[2]), px(segment.points[3]))
      .stroke({ width: 2, color: 0x5cb283, alpha: 0.5 });
  }
  for (const pocket of POCKETS) {
    table
      .circle(px(pocket.x), px(pocket.y), px(pocket.radius * 0.92))
      .fill(0x0c0c0c)
      .circle(px(pocket.x), px(pocket.y), px(pocket.radius * 0.92))
      .stroke({ width: 3, color: 0x3a2a20, alpha: 0.9 });
  }
  root.addChild(table);

  // --- balls ----------------------------------------------------------
  const ballLayer = new Container();
  root.addChild(ballLayer);
  const ballViews = new Map<number, Container>();
  const r = px(BALL_RADIUS);

  /** Fake-3D rolling state for the number decal on each ball. */
  interface RollState {
    phase: number;
    dirX: number;
    dirY: number;
    lastX: number;
    lastY: number;
  }
  const decals = new Map<number, { decal: Container; roll: RollState }>();

  function buildBall(id: number): Container {
    const view = new Container();
    const color = ballColorNumber(id);
    const striped = id >= 9;
    // Soft contact shadow (two stacked translucent discs).
    const shadow = new Graphics();
    shadow
      .circle(r * 0.16, r * 0.2, r * 1.14)
      .fill({ color: 0x000000, alpha: 0.1 })
      .circle(r * 0.12, r * 0.16, r * 0.98)
      .fill({ color: 0x000000, alpha: 0.16 });
    view.addChild(shadow);
    const g = new Graphics();
    g.circle(0, 0, r).fill(striped ? 0xf6f1e7 : color);
    if (striped) {
      const band = new Graphics();
      band.rect(-r, -r * 0.52, r * 2, r * 1.04).fill(color);
      const bandMask = new Graphics();
      bandMask.circle(0, 0, r).fill(0xffffff);
      band.mask = bandMask;
      view.addChild(g, bandMask, band);
    } else {
      view.addChild(g);
    }
    if (id !== 0) {
      const decal = new Container();
      const dot = new Graphics();
      dot.circle(0, 0, r * 0.46).fill(0xf6f1e7);
      const label = new Text({
        text: String(id),
        style: new TextStyle({
          fontSize: r * 0.62,
          fill: 0x1a1a1a,
          fontWeight: "700",
          fontFamily: "system-ui, sans-serif",
        }),
      });
      label.anchor.set(0.5);
      label.resolution = 3;
      decal.addChild(dot, label);
      const decalMask = new Graphics();
      decalMask.circle(0, 0, r * 0.98).fill(0xffffff);
      decal.mask = decalMask;
      view.addChild(decalMask, decal);
      decals.set(id, {
        decal,
        roll: { phase: 0, dirX: 1, dirY: 0, lastX: 0, lastY: 0 },
      });
    }
    // Sphere shading: darken everything but a top-left crescent.
    const shadeMask = new Graphics();
    shadeMask.circle(0, 0, r).fill(0xffffff);
    const shade = new Graphics();
    shade.circle(r * 0.2, r * 0.24, r).fill({ color: 0x000000, alpha: 0.16 });
    shade.mask = shadeMask;
    view.addChild(shadeMask, shade);
    const shine = new Graphics();
    shine
      .circle(-r * 0.32, -r * 0.36, r * 0.3)
      .fill({ color: 0xffffff, alpha: id === 0 ? 0.5 : 0.38 })
      .circle(-r * 0.28, -r * 0.32, r * 0.14)
      .fill({ color: 0xffffff, alpha: 0.5 });
    view.addChild(shine);
    return view;
  }

  /** Project the decal onto the "sphere": offset by sin, hide on the back. */
  function applyDecal(id: number): void {
    const entry = decals.get(id);
    if (!entry) return;
    const sin = Math.sin(entry.roll.phase);
    const cos = Math.cos(entry.roll.phase);
    entry.decal.position.set(
      entry.roll.dirX * sin * r,
      entry.roll.dirY * sin * r,
    );
    entry.decal.alpha = cos > 0 ? Math.min(1, cos * 1.4) : 0;
  }

  /**
   * Move a ball view; when `rolling`, advance the decal phase by the
   * surface distance traveled so the number appears to roll with the
   * ball instead of sliding. The phase is left wherever the ball stops —
   * no recentering — so resting positions look physical.
   */
  function moveBallView(id: number, x: number, y: number, rolling: boolean): void {
    const view = ballViews.get(id);
    if (!view) return;
    view.position.set(px(x), px(y));
    const entry = decals.get(id);
    if (!entry) return;
    const roll = entry.roll;
    if (rolling) {
      const dx = x - roll.lastX;
      const dy = y - roll.lastY;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-6) {
        roll.dirX = dx / dist;
        roll.dirY = dy / dist;
        roll.phase += dist / BALL_RADIUS;
        if (roll.phase > Math.PI * 4) roll.phase %= Math.PI * 2;
        applyDecal(id);
      }
    }
    roll.lastX = x;
    roll.lastY = y;
  }

  for (let id = 0; id <= 15; id++) {
    const view = buildBall(id);
    view.visible = false;
    ballViews.set(id, view);
    ballLayer.addChild(view);
  }

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

    if (placing) {
      // Ball-in-hand: show the actual cue ball at the provisional spot
      // with a ring that flags invalid positions.
      const cueView = ballViews.get(0);
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
    cueLayer.visible = true;
    cueLayer.position.set(cx, cy);
    cueLayer.rotation = aimAngle + Math.PI;
    cueStick.x = r * 1.4 + cuePull.value * px(0.34);
  }

  function syncBallViews(): void {
    for (const ball of balls) {
      const view = ballViews.get(ball.id);
      if (!view) continue;
      view.visible = !ball.potted;
      view.scale.set(1);
      view.alpha = 1;
      moveBallView(ball.id, ball.x, ball.y, false);
    }
  }

  // --- layout ---------------------------------------------------------
  function relayout(): void {
    const w = app.screen.width;
    const h = app.screen.height;
    const worldW = px(outerW * 2);
    const worldH = px(outerH * 2);
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
    const { frames, events } = presentation;
    playing = true;
    placing = null;
    dragging = false;
    cuePull.value = 0;
    redrawOverlays();
    if (frames.length === 0) {
      playing = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let elapsed = 0;
      let eventIndex = 0;
      const positions = new Map<number, { x: number; y: number }>();

      const applyFrame = (frame: { balls: number[] }): void => {
        for (let i = 0; i < frame.balls.length; i += 3) {
          moveBallView(
            frame.balls[i],
            frame.balls[i + 1],
            frame.balls[i + 2],
            true,
          );
        }
      };

      const tick = (ticker: Ticker): void => {
        elapsed += ticker.deltaMS / 1000;
        while (eventIndex < events.length && events[eventIndex].t <= elapsed) {
          const event = events[eventIndex++];
          playImpactEvent(event);
          if (event.type === "pocket") {
            const view = ballViews.get(event.ball);
            const pocket = POCKETS.find((p) => p.id === event.pocket);
            if (view && pocket) {
              // Drop-in: dive from the capture point to the pocket center
              // while shrinking, like falling below the rim.
              gsap.killTweensOf(view);
              gsap.killTweensOf(view.scale);
              gsap.killTweensOf(view.position);
              gsap.to(view.position, {
                x: px(pocket.x),
                y: px(pocket.y),
                duration: 0.16,
                ease: "power2.in",
              });
              gsap.to(view.scale, {
                x: 0.45,
                y: 0.45,
                duration: 0.22,
                ease: "power2.in",
              });
              gsap.to(view, {
                alpha: 0,
                duration: 0.18,
                delay: 0.08,
                ease: "power1.in",
                onComplete: () => {
                  view.visible = false;
                },
              });
            }
          }
        }
        const index = Math.floor(elapsed / FIXED_DT);
        if (index >= frames.length - 1) {
          applyFrame(frames[frames.length - 1]);
          app.ticker.remove(tick);
          playing = false;
          redrawOverlays();
          resolve();
          return;
        }
        // Linear interpolation between recorded physics frames.
        const a = frames[index];
        const b = frames[index + 1];
        const mix = elapsed / FIXED_DT - index;
        positions.clear();
        for (let i = 0; i < a.balls.length; i += 3) {
          positions.set(a.balls[i], { x: a.balls[i + 1], y: a.balls[i + 2] });
        }
        for (let i = 0; i < b.balls.length; i += 3) {
          const id = b.balls[i];
          const prev = positions.get(id);
          const bx = b.balls[i + 1];
          const by = b.balls[i + 2];
          const x = prev ? prev.x + (bx - prev.x) * mix : bx;
          const y = prev ? prev.y + (by - prev.y) * mix : by;
          moveBallView(id, x, y, true);
        }
      };
      app.ticker.add(tick);
    });
  }

  return {
    setBalls(next) {
      balls = next;
      if (!playing) {
        syncBallViews();
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
      }),
      [],
    );

    return <div ref={containerRef} className="h-full w-full touch-none" />;
  },
);
