/** React负责挂载与传递快照，逐帧输入/回放由独立Pixi场景持有。 */
import { Application } from "pixi.js";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { CHINESE_EIGHT, type TableEquipment } from "../equipment";
import type { BilliardsPresentation, BilliardsState } from "../types";
import { type BilliardsScene, createScene } from "./scene";

export interface BilliardsStageHandle {
  /** 播放已结算的走子；当球桌再次静止时 resolve。 */
  playPresentation(presentation: BilliardsPresentation): Promise<void>;
  /**
   * 为非交互（AI）的一杆展示并挥动球杆：瞄准，后拉到击球力度，然后
   * 击出。击出后 resolve。
   */
  animateCue(angle: number, power: number, ai: boolean): Promise<void>;
}

export interface BilliardsStageProps {
  state: BilliardsState;
  equipment?: TableEquipment;
  /** 本地玩家此时可以瞄准/击球。 */
  interactive: boolean;
  /** 跟杆/缩杆旋转：-0.7 缩杆，0 中性，+0.7 跟杆。 */
  followDraw: number;
  /** 拖动时实时蓄力预览（0..1），松开/取消时为 0。 */
  onPowerPreview(power: number): void;
  /** 拖动在蓄力足够时松手触发。 */
  onShot(angle: number, power: number): void;
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
  propsRef.current = props;

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    let disposed = false;
    let app: Application | null = null;
    let observer: ResizeObserver | null = null;

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
      // 容器会因 HUD、界面字号与横屏工具栏变化而改变，不能只监听窗口。
      observer = new ResizeObserver(() => nextApp.resize());
      observer.observe(host);
      host.appendChild(nextApp.canvas);
      const scene = createScene(
        nextApp,
        {
          onPowerPreview: (power) => propsRef.current.onPowerPreview(power),
          onShot: (angle, power) => propsRef.current.onShot(angle, power),
          onPlaceCue: (x, y) => propsRef.current.onPlaceCue(x, y),
        },
        equipment,
        propsRef.current.state.balls.map((ball) => ball.id),
      );
      sceneRef.current = scene;
      scene.setPosition(propsRef.current.state, propsRef.current.interactive);
      scene.setFollowDraw(propsRef.current.followDraw);
      propsRef.current.onReady?.();
    })().catch((error: unknown) => {
      if (!disposed) propsRef.current.onError?.(error);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      sceneRef.current?.destroy();
      sceneRef.current = null;
      app?.destroy(true, { children: true, texture: false });
    };
  }, [equipment]);

  useEffect(() => {
    sceneRef.current?.setPosition(props.state, props.interactive);
  }, [props.state, props.interactive]);
  useEffect(() => {
    sceneRef.current?.setFollowDraw(props.followDraw);
  }, [props.followDraw]);

  useImperativeHandle(
    ref,
    () => ({
      playPresentation: (presentation) =>
        sceneRef.current?.playPresentation(presentation) ?? Promise.resolve(),
      animateCue: (angle, power, ai) =>
        sceneRef.current?.animateCue(angle, power, ai) ?? Promise.resolve(),
    }),
    [],
  );

  return <div ref={containerRef} className="h-full w-full touch-none" />;
});
