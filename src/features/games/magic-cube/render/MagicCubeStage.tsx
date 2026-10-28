import { useLingui } from "@lingui/react/macro";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import type { CubeMove, CubeState } from "../types";
import { installCubeInput } from "./input";
import { createCubeScene, type CubeScene } from "./scene";

export interface CubeStageHandle {
  play(move: CubeMove): Promise<void>;
  resetCamera(): void;
}

interface Props {
  cube: CubeState;
  enabled: boolean;
  busy: boolean;
  observe: boolean;
  labels: boolean;
  selection: CubeMove | null;
  onTurn(move: CubeMove): void;
  onReady(): void;
  onError(): void;
}

export const MagicCubeStage = forwardRef<CubeStageHandle, Props>(
  function MagicCubeStage(props, ref) {
    const { t } = useLingui();
    const host = useRef<HTMLDivElement>(null);
    const scene = useRef<CubeScene | null>(null);
    const input = useRef<ReturnType<typeof installCubeInput> | null>(null);
    const current = useRef(props);
    current.current = props;
    const label = t`三维魔方。拖拽面片转层，拖拽空白旋转视角，滚轮缩放。键盘 R、L、U、D、F、B 转面，Shift 反向，方向键旋转视角。`;

    useImperativeHandle(
      ref,
      () => ({
        play: (move) => scene.current?.play(move) ?? Promise.resolve(),
        resetCamera: () => scene.current?.resetCamera(),
      }),
      [],
    );

    useEffect(() => {
      const container = host.current;
      if (!container) return;
      let view: CubeScene | null = null;
      let controls: ReturnType<typeof installCubeInput> | null = null;
      let failed = false;

      const fail = () => {
        if (failed) return;
        failed = true;
        current.current.onError();
      };

      try {
        view = createCubeScene(container, current.current.cube, fail);
        scene.current = view;
        view.canvas.tabIndex = 0;
        view.canvas.setAttribute("role", "application");
        view.setLabels(current.current.labels);
        view.setActive(!document.hidden);
        controls = installCubeInput(view, {
          enabled: () => current.current.enabled && !document.hidden,
          busy: () => current.current.busy,
          observe: () => current.current.observe,
          order: () => current.current.cube.order,
          turn: (move) => current.current.onTurn(move),
        });
        input.current = controls;
        current.current.onReady();
      } catch {
        fail();
      }

      const visibility = () => {
        controls?.cancel();
        view?.setActive(!document.hidden);
      };

      document.addEventListener("visibilitychange", visibility);
      return () => {
        document.removeEventListener("visibilitychange", visibility);
        controls?.dispose();
        view?.dispose();
        scene.current = null;
        input.current = null;
      };
    }, [props.cube.order]);

    useEffect(() => {
      scene.current?.sync(props.cube);
    }, [props.cube]);
    useEffect(() => {
      if (!props.enabled) input.current?.cancel();
      scene.current?.setActive(!document.hidden);
    }, [props.enabled]);
    useEffect(() => {
      scene.current?.setLabels(props.labels);
    }, [props.labels]);
    useEffect(() => {
      scene.current?.select(props.selection);
    }, [props.selection]);
    useEffect(() => {
      scene.current?.canvas.setAttribute("aria-label", label);
    }, [label, props.cube.order]);

    return <div ref={host} className="magic-cube-canvas absolute inset-0" />;
  },
);
