/** React负责挂载与传递快照，逐帧输入/回放由独立 three 场景持有。 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";

import { frontendError } from "~/lib/errors";

import { CHINESE_EIGHT, type TableEquipment } from "../equipment";
import type { BilliardsPresentation, BilliardsState } from "../types";
import { stopBilliardsAudio } from "./audio";
import { BallSelectionOverlay } from "./BallSelectionOverlay";
import type { BilliardsScene, SceneCallbacks } from "./scene-contract";
import type { BallSelectionRequest, BallSelectionView } from "./scene-contract";
import type { PowerShotControls } from "./shot-input";
import { hasEntered, markEntered } from "./three/intro";
import { createScene } from "./three/scene";
import { observeBilliardsViewport } from "./viewport";

export interface BilliardsStageHandle extends PowerShotControls {
  cancelInput(): void;
  /** 播放已结算的走子；当球桌再次静止时 resolve。 */
  playPresentation(presentation: BilliardsPresentation): Promise<void>;
  /**
   * 为非交互（AI）的一杆展示并挥动球杆：瞄准，后拉到击球力度，然后
   * 击出。击出后 resolve。
   */
  animateCue(angle: number, power: number, ai: boolean): Promise<void>;
}

export interface BilliardsStageProps {
  selection?: BallSelectionRequest | null;
  onSelectionActive?(
    active: boolean,
    phase: BallSelectionView["phase"] | null,
  ): void;
  onSelectedBall?(id: number): void;
  onDismissSelection?(): void;
  onAimTarget?: SceneCallbacks["onAimTarget"];
  state: BilliardsState;
  resume?: boolean;
  equipment?: TableEquipment;
  /** 本地玩家此时可以瞄准/击球。 */
  interactive: boolean;
  /** 只限制球桌拖动，力度条仍可沿当前角度击球。 */
  aimOnly?: boolean;
  /** 跟杆/缩杆旋转：-0.7 缩杆，0 中性，+0.7 跟杆。 */
  followDraw: number;
  /** 拖动时实时蓄力预览（0..1），松开/取消时为 0。 */
  onPowerPreview(power: number): void;
  /** 拖动在蓄力足够时松手触发。 */
  onShot(angle: number, power: number): boolean;
  onPlaceCue(x: number, y: number): void;
  onReady?(): void;
  onError?(error: unknown): void;
}

export const BilliardsStage = forwardRef<
  BilliardsStageHandle,
  BilliardsStageProps
>(function BilliardsStage(props, ref) {
  const equipment = props.equipment ?? CHINESE_EIGHT;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<BilliardsScene | null>(null);
  const propsRef = useRef(props);
  const [selectionView, setSelectionView] = useState<BallSelectionView | null>(
    null,
  );
  propsRef.current = props;

  useEffect(() => {
    const stopHidden = () => {
      if (document.hidden) {
        sceneRef.current?.cancelInput();
        stopBilliardsAudio();
      }
    };

    document.addEventListener("visibilitychange", stopHidden);
    return () => document.removeEventListener("visibilitychange", stopHidden);
  }, []);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    let disposed = false;
    let renderer: WebGLRenderer | null = null;
    let viewport: ReturnType<typeof observeBilliardsViewport> | null = null;
    let scene: ReturnType<typeof createScene> | null = null;

    let removeContextListener = () => {};

    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      viewport?.dispose();
      removeContextListener();
      scene?.destroy();
      sceneRef.current = null;
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
    };

    const fail = (error: unknown) => {
      if (disposed) return;
      cleanup();
      propsRef.current.onError?.(error);
    };

    try {
      const mobile = window.matchMedia("(pointer: coarse)").matches;
      const next = new WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
      renderer = next;
      next.outputColorSpace = SRGBColorSpace;
      next.toneMapping = ACESFilmicToneMapping;
      next.toneMappingExposure = 1;
      next.shadowMap.enabled = true;
      next.shadowMap.type = PCFShadowMap;
      next.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, mobile ? 2 : 3),
      );
      const canvas = next.domElement;
      canvas.className = "billiards-canvas";
      // 球杆可以跨过控件显示，整个绘制层必须让点击落到原控件。
      canvas.style.pointerEvents = "none";
      canvas.setAttribute("aria-hidden", "true");

      const contextLost = (event: Event) => {
        event.preventDefault();
        fail(
          frontendError(
            "billiards:context_lost",
            "Billiards WebGL context lost",
          ),
        );
      };

      canvas.addEventListener("webglcontextlost", contextLost);
      removeContextListener = () =>
        canvas.removeEventListener("webglcontextlost", contextLost);
      const entryHost =
        host.closest<HTMLElement>(".billiards-game") ??
        host.parentElement ??
        host;
      // 脱离页面的裁剪与层叠上下文，才能跨过应用导航和标题分隔线。
      document.body.append(canvas);
      scene = createScene(
        next,
        host,
        {
          onPowerPreview: (power) => propsRef.current.onPowerPreview(power),
          onAimTarget: (target) => propsRef.current.onAimTarget?.(target),
          onSelectionView: (view) => {
            if (disposed) return;
            setSelectionView(view);
            propsRef.current.onSelectionActive?.(
              view !== null,
              view?.phase ?? null,
            );
          },
          onSelectedBall: (id) => {
            if (!disposed) propsRef.current.onSelectedBall?.(id);
          },
          onDismissSelection: () => propsRef.current.onDismissSelection?.(),
          onShot: (angle, power) => propsRef.current.onShot(angle, power),
          onPlaceCue: (x, y) => propsRef.current.onPlaceCue(x, y),
          onReady: () => {
            if (!disposed) {
              markEntered(entryHost);
              propsRef.current.onReady?.();
            }
          },
          onError: fail,
        },
        equipment,
        propsRef.current.state.balls.map((ball) => ball.id),
        mobile,
        hasEntered(entryHost),
        propsRef.current.resume === true,
      );
      sceneRef.current = scene;

      viewport = observeBilliardsViewport(host, (bounds) => {
        if (disposed) return;
        try {
          next.setSize(bounds.width, bounds.height);
          scene?.resize(bounds);
        } catch (error) {
          fail(error);
        }
      });

      viewport.measure();
      if (!disposed) {
        scene.setPosition(propsRef.current.state, propsRef.current.interactive);
        scene.setFollowDraw(propsRef.current.followDraw);
        scene.setAimOnly(propsRef.current.aimOnly === true);
        scene.setSelection(propsRef.current.selection ?? null);
      }
    } catch (error) {
      fail(error);
    }
    return cleanup;
  }, [equipment]);

  useEffect(() => {
    sceneRef.current?.setPosition(props.state, props.interactive);
  }, [props.state, props.interactive]);
  useEffect(() => {
    sceneRef.current?.setFollowDraw(props.followDraw);
  }, [props.followDraw]);
  useEffect(() => {
    sceneRef.current?.setAimOnly(props.aimOnly === true);
  }, [props.aimOnly]);
  useEffect(() => {
    sceneRef.current?.setSelection(props.selection ?? null);
  }, [props.selection]);

  useImperativeHandle(
    ref,
    () => ({
      cancelInput: () => sceneRef.current?.cancelInput(),
      beginPowerShot: () => sceneRef.current?.beginPowerShot() ?? false,
      updateShotPower: (power) =>
        sceneRef.current?.updateShotPower(power) ?? false,
      releasePowerShot: () => sceneRef.current?.releasePowerShot(),
      cancelPowerShot: () => sceneRef.current?.cancelPowerShot(),
      playPresentation: (presentation) =>
        sceneRef.current?.playPresentation(presentation) ?? Promise.resolve(),
      animateCue: (angle, power, ai) =>
        sceneRef.current?.animateCue(angle, power, ai) ?? Promise.resolve(),
    }),
    [],
  );

  return (
    <div className="relative h-full w-full touch-none">
      <div ref={containerRef} data-billiards-input className="h-full w-full" />
      {selectionView ? (
        <BallSelectionOverlay
          view={selectionView}
          onPreview={(id) => sceneRef.current?.previewSelection(id)}
          onSelect={(id) => sceneRef.current?.selectBall(id)}
          onDismiss={() => propsRef.current.onDismissSelection?.()}
        />
      ) : null}
    </div>
  );
});
