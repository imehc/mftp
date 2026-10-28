import { useEffect, useRef, useState } from "react";

import type { ReversiScene } from "./scene";
import type { ReversiState } from "./types";

export function useReversiScene(state: ReversiState) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<ReversiScene | null>(null);
  const latest = useRef(state);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    latest.current = state;
    scene.current?.sync(state);
  }, [state]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let canceled = false;
    let failed = false;
    let observer: ResizeObserver | undefined;
    let instance: ReversiScene | null = null;

    const fail = (event?: Event) => {
      failed = true;
      event?.preventDefault();
      observer?.disconnect();
      instance?.dispose();
      instance = null;
      scene.current = null;
      if (!canceled) setStatus("failed");
    };

    element.addEventListener("webglcontextlost", fail);
    void import("./scene")
      .then(async ({ createReversiScene }) => {
        if (canceled) return;
        const created = await createReversiScene(element);
        if (canceled || failed) {
          created.dispose();
          return;
        }
        instance = created;
        scene.current = instance;
        instance.resize(element.clientWidth);
        instance.sync(latest.current);
        observer = new ResizeObserver(() => {
          instance?.resize(element.clientWidth);
        });
        observer.observe(element);
        setStatus("ready");
      })
      .catch(() => fail());
    return () => {
      canceled = true;
      observer?.disconnect();
      element.removeEventListener("webglcontextlost", fail);
      instance?.dispose();
      scene.current = null;
    };
  }, [generation]);
  return {
    canvas,
    status,
    generation,
    retry: () => {
      setStatus("loading");
      setGeneration((value) => value + 1);
    },
  };
}
