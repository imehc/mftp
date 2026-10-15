import gsap from "gsap";
import { Scene, type WebGLRenderer } from "three";

import type { TableEquipment } from "../../equipment";
import { legalCuePlacement } from "../../placement";
import { findDPlacement } from "../../snooker-visibility";
import type {
  BallState,
  BilliardsPresentation,
  BilliardsState,
} from "../../types";
import { createAimPreview } from "../aim-preview";
import { playCueImpact, stopBilliardsAudio } from "../audio";
import { createDefaultAim } from "../default-aim";
import { runPresentation } from "../playback";
import type { BilliardsScene, SceneCallbacks } from "../scene-contract";
import { createAimTargetPublisher } from "./aim-target";
import { createBallSelection } from "./ball-selection";
import { createBallLayer } from "./balls";
import { createTableCamera } from "./camera";
import { createRenderClock } from "./clock";
import { createCue } from "./cue";
import { CUE_CONTACT_PULL, CUE_FOLLOW_THROUGH } from "./cue-clearance";
import { createHud } from "./hud";
import { createTableInput } from "./input";
import { createIntro } from "./intro";
import { createLighting } from "./lighting";
import { createRackIntro } from "./rack-intro";
import { createResources } from "./resources";
import { buildTable } from "./table";

export function createScene(
  renderer: WebGLRenderer,
  callbacks: SceneCallbacks,
  equipment: TableEquipment,
  ballIds: readonly number[],
  mobile: boolean,
  repeatIntro = false,
  resumeIntro = false,
): BilliardsScene & { resize(width: number, height: number): void } {
  const resources = createResources();

  let releaseLighting = () => {};

  try {
    return initialize();
  } catch (error) {
    releaseLighting();
    resources.dispose();
    throw error;
  }

  function initialize(): BilliardsScene & {
    resize(width: number, height: number): void;
  } {
    const BALL_RADIUS = equipment.ballRadius;
    const HEAD_SPOT_X = -equipment.tableWidth / 4;
    const world = new Scene();
    const camera = createTableCamera(equipment);
    world.add(buildTable(equipment, resources));
    const ballLayer = createBallLayer(equipment, ballIds, mobile, resources);
    const hud = createHud(equipment, resources);
    const cueView = createCue(equipment, resources);
    const rack = createRackIntro(equipment, ballLayer, camera, resources);
    world.add(ballLayer.layer, hud.layer, cueView.layer, rack.layer);
    const lighting = createLighting(renderer, world, equipment, mobile);
    releaseLighting = lighting.dispose;
    renderer.domElement.style.opacity = "0";
    const clock = createRenderClock(() => {
      if (playing && aiAiming) {
        const cue = cuePos();
        if (cue) drawCueStick(cue.x, cue.y);
      }
      renderer.render(world, camera.camera);
    }, callbacks.onError);
    // --- 可变场景状态 -----------------------------------------------
    let balls: BallState[] = [];
    let position: BilliardsState | null = null;
    let interactive = false;
    let requestedInteractive = false;
    let ready = false;
    let introStarted = false;
    let intro: ReturnType<typeof createIntro> | null = null;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let ballInHand = false;
    let followDraw = 0;
    let aimAngle = 0;
    const defaultAiming = createDefaultAim(equipment);
    const cuePull = { value: 0 };
    let playing = false;
    /** AI 击球进行中：即使非交互也显示球杆。 */
    let aiAiming = false;
    /** 弹弓拖动进行中（一次手势完成瞄准 + 蓄力）。 */
    let dragging = false;
    /** 自由球：临时母球位置，以真实球显示。 */
    let placing: { x: number; y: number; valid: boolean } | null = null;
    let placingDrag = false;
    let shotPending = false;
    let disposed = false;
    let cancelPlayback: (() => void) | null = null;
    let cancelCue: (() => void) | null = null;
    const preview = createAimPreview(redrawOverlays, equipment.id);
    const publishAim = createAimTargetPublisher(camera, callbacks.onAimTarget);
    const selection = createBallSelection({
      ballLayer,
      camera,
      equipment,
      resources,
      callbacks,
      touch: mobile,
      reduced,
      redraw: redrawOverlays,
      getAngle: () => aimAngle,
      setAngle: (angle) => {
        aimAngle = angle;
      },
    });
    world.add(selection.layer);

    const dismissSelection = () => {
      if (selection.active) callbacks.onDismissSelection?.();
    };

    renderer.domElement.addEventListener("pointerdown", dismissSelection);

    function updateAimTarget() {
      publishAim(
        position,
        aimAngle,
        ready &&
          interactive &&
          !playing &&
          !aiAiming &&
          !placing &&
          !shotPending &&
          !selection.active,
      );
    }

    /** 拖动距离（米）：开始蓄力前的死区，以及完整行程。 */
    const PULL_DEADZONE = 0.07;
    const PULL_RANGE = 0.55;
    /** 蓄力低于此值时松手只是重新瞄准而非击球。 */
    const FIRE_THRESHOLD = 0.05;

    function refreshDefaultAim() {
      if (!position || dragging || selection.active) return;
      const angle = defaultAiming.update(
        position,
        (!ready || interactive) && !playing && !shotPending,
      );
      if (angle !== null) {
        aimAngle = angle;
        preview.invalidate();
      }
    }

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
        position &&
        legalCuePlacement(position, cue.x, cue.y)
      ) {
        return { x: cue.x, y: cue.y };
      }
      if (position?.variant === "snooker" && position.placementRegion === "d") {
        const spot = findDPlacement(balls);
        if (spot) return spot;
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
        ([x, y]) => position && legalCuePlacement(position, x, y),
      );
      return hit ? { x: hit[0], y: hit[1] } : { x: 0, y: 0 };
    }

    function redrawOverlays(): void {
      if (disposed) return;
      updateAimTarget();
      hud.clear();
      cueView.layer.visible = false;
      clock.invalidate();

      if (!ready) {
        rack.update();
        if (rack.active && rack.layer.visible) return;
        const cue = cuePos();
        if (cue) {
          drawCueStick(cue.x, cue.y);
          const guide = preview.get(balls, aimAngle, 0.5, followDraw);
          if (guide) hud.guide(guide);
        }
        return;
      }
      if (playing) {
        if (aiAiming) {
          const cue = cuePos();
          if (cue) drawCueStick(cue.x, cue.y);
        }
        return;
      }

      if (aiAiming) {
        // AI 回合：不画瞄准辅助，只挥动球杆击球。
        const cue = cuePos();
        if (cue) drawCueStick(cue.x, cue.y);
        return;
      }

      if (selection.active) {
        const cue = cuePos();
        if (cue && !position?.ballInHand) {
          drawCueStick(cue.x, cue.y);
          const guide = preview.get(balls, aimAngle, 0.5, followDraw);
          if (guide) hud.guide(guide);
        }
        return;
      }
      if (placing) {
        // 自由球：在临时落点显示真实母球，并叠加一个环标记非法位置。
        ballLayer.place(placing.x, placing.y, placing.valid);
        hud.placement(placing.x, placing.y, placing.valid);
        return;
      }
      if (!interactive || ballInHand) return;

      const cue = cuePos();
      if (!cue) return;
      const guide = preview.get(
        balls,
        aimAngle,
        dragging ? Math.max(0.06, cuePull.value) : 0.5,
        followDraw,
      );
      if (guide) hud.guide(guide);
      drawCueStick(cue.x, cue.y);
    }

    /** 将球杆摆到 (cx, cy) 后方，沿 aimAngle 方向瞄准。 */
    function drawCueStick(cx: number, cy: number): void {
      const obstacles = playing
        ? balls.map((ball) => {
            const mesh = ballLayer.meshes.get(ball.id);
            return mesh
              ? {
                  ...ball,
                  x: mesh.position.x,
                  y: mesh.position.z,
                  potted: !mesh.visible,
                }
              : ball;
          })
        : balls;
      cueView.pose(cx, cy, aimAngle, cuePull.value, obstacles);
    }

    function updateDrag(p: { x: number; y: number }): void {
      const cue = cuePos();
      if (!cue) return;
      const dx = p.x - cue.x;
      const dy = p.y - cue.y;
      const dist = Math.hypot(dx, dy);
      if (dist > PULL_DEADZONE * 0.5) {
        // 朝手指反方向击出——把球杆拉到球后方。
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
        shotPending = true;
        aiAiming = true;
        // 先锁定本杆，worker 结算后由统一挥杆时间线呈现触球。
        callbacks.onPowerPreview(0);
        callbacks.onShot(aimAngle, Math.max(0.06, pull));
      } else {
        // 在死区内松手：保留瞄准，球杆弹性回位。
        gsap.to(cuePull, {
          value: 0,
          duration: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? 0
            : 0.18,
          ease: "power2.out",
          onUpdate: redrawOverlays,
        });
        callbacks.onPowerPreview(0);
      }
    }

    function updatePlacement(
      p: { x: number; y: number },
      commit: boolean,
    ): void {
      const valid = position !== null && legalCuePlacement(position, p.x, p.y);
      placing = { x: p.x, y: p.y, valid };
      if (commit && valid) {
        callbacks.onPlaceCue(p.x, p.y);
      }
      redrawOverlays();
    }

    const input = createTableInput(renderer.domElement, camera.camera, {
      enabled: () =>
        !disposed &&
        !playing &&
        !shotPending &&
        interactive &&
        !selection.active,
      down(p) {
        if (ballInHand) {
          placingDrag = true;
          updatePlacement(p, false);
        } else {
          dragging = true;
          updateDrag(p);
        }
      },
      move(p) {
        if (placingDrag) updatePlacement(p, false);
        else if (dragging) updateDrag(p);
      },
      up(p) {
        if (placingDrag) {
          placingDrag = false;
          updatePlacement(p, true);
        } else releaseDrag();
      },
      cancel() {
        dragging = false;
        placingDrag = false;
        if (!shotPending) cuePull.value = 0;
        callbacks.onPowerPreview(0);
        redrawOverlays();
      },
    });

    // --- 回放 -------------------------------------------------------
    function playPresentation(
      presentation: BilliardsPresentation,
    ): Promise<void> {
      cancelPlayback?.();
      selection.cancel();
      input.cancel();
      playing = true;
      placing = null;
      dragging = false;
      redrawOverlays();
      if (presentation.frames.length === 0) {
        playing = false;
        refreshDefaultAim();
        return Promise.resolve();
      }
      const playback = runPresentation(clock, presentation, {
        dropDuration: reduced ? 0.16 : 0.42,
        moveBall: ballLayer.move,
        ballView: ballLayer.view,
        maskPocket: ballLayer.maskPocket,
        onDone: () => {
          playing = false;
          cancelPlayback = null;
          if (!disposed) {
            refreshDefaultAim();
            redrawOverlays();
          }
        },
      });
      cancelPlayback = playback.cancel;
      return playback.done;
    }

    function animateCue(
      angle: number,
      power: number,
      ai: boolean,
    ): Promise<void> {
      cancelCue?.();
      aimAngle = angle;
      cuePull.value = ai ? 0 : power;
      aiAiming = true;
      shotPending = true;
      redrawOverlays();
      return new Promise((resolve) => {
        let complete = false;

        const done = () => {
          if (complete) return;
          complete = true;
          cancelCue = null;
          aiAiming = false;
          shotPending = false;
          gsap.killTweensOf(cuePull);
          if (!disposed) {
            refreshDefaultAim();
            redrawOverlays();
          }
          resolve();
        };

        cancelCue = done;
        const strike = () =>
          gsap.to(cuePull, {
            value: CUE_CONTACT_PULL,
            duration: reduced ? 0.05 : 0.09,
            ease: "power2.in",
            onUpdate: redrawOverlays,
            onComplete: () => {
              if (disposed) {
                done();
                return;
              }
              playCueImpact(power);
              // 触球时兑现等待，回放和声音同帧起步；球杆继续短随挥。
              resolve();
              gsap.to(cuePull, {
                value: CUE_FOLLOW_THROUGH,
                duration: reduced ? 0.04 : 0.08,
                ease: "power2.out",
                onUpdate: redrawOverlays,
                onComplete: done,
              });
            },
          });
        if (ai)
          gsap.to(cuePull, {
            value: power,
            duration: reduced ? 0.1 : 0.3,
            ease: "power2.inOut",
            onUpdate: redrawOverlays,
            onComplete: strike,
          });
        else strike();
      });
    }

    function startIntro() {
      if (introStarted) return;
      introStarted = true;
      const resume =
        resumeIntro ||
        reduced ||
        equipment.id === "snooker" ||
        !position ||
        !rack.prepare(position);
      // 先预热实际球桌着色器；异步完成前退出不再创建动画或触发 runner。
      void renderer
        .compileAsync(world, camera.camera)
        .then(() => {
          if (disposed) return;
          intro = createIntro({
            repeat: repeatIntro,
            reduced,
            resume,
            camera: camera.entrance,
            rack: rack.update,
            reveal(value) {
              renderer.domElement.style.opacity = String(value);
            },
            update: redrawOverlays,
            ready() {
              if (disposed || ready) return;
              rack.finish();
              ready = true;
              if (position) setPosition(position, requestedInteractive);
              callbacks.onReady();
            },
          });
        })
        .catch((error) => {
          if (!disposed) callbacks.onError(error);
        });
    }

    function setPosition(state: BilliardsState, nextInteractive: boolean) {
      if (!nextInteractive) input.cancel();
      selection.reconcile(state);
      position = state;
      balls = state.balls;
      requestedInteractive = nextInteractive;
      interactive = nextInteractive && ready;
      ballInHand = interactive && state.ballInHand;
      if (!playing && !selection.active && !rack.active) ballLayer.sync(balls);
      if (ballInHand) {
        if (!placing) {
          const spot = defaultCueSpot();
          placing = {
            ...spot,
            valid: legalCuePlacement(state, spot.x, spot.y),
          };
        }
      } else {
        placing = null;
        placingDrag = false;
      }
      if (!interactive && !shotPending) {
        dragging = false;
        cuePull.value = 0;
      }
      refreshDefaultAim();
      redrawOverlays();
      startIntro();
    }

    return {
      resize(width: number, height: number) {
        camera.resize(
          width,
          height,
          window.matchMedia("(orientation: portrait)").matches,
        );
        hud.resize(width, height);
        selection.resize(width, height);
        updateAimTarget();
        clock.invalidate();
      },
      setSelection(request) {
        input.cancel();
        selection.set(request, position);
        redrawOverlays();
      },
      previewSelection: selection.preview,
      selectBall: selection.select,
      setPosition,
      cancelInput: () => input.cancel(),
      setFollowDraw(nextFollowDraw) {
        followDraw = nextFollowDraw;
        redrawOverlays();
      },
      playPresentation,
      animateCue,
      destroy() {
        if (disposed) return;
        disposed = true;
        intro?.dispose();
        rack.finish();
        renderer.domElement.style.opacity = "1";
        renderer.domElement.removeEventListener(
          "pointerdown",
          dismissSelection,
        );
        selection.dispose();
        input.dispose();
        preview.dispose();
        clock.dispose();
        cancelPlayback?.();
        cancelCue?.();
        gsap.killTweensOf(cuePull);
        stopBilliardsAudio();
        lighting.dispose();
        resources.dispose();
        world.clear();
      },
    };
  }
}
