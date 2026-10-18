import "../speech-follow.css";

import { type RefObject, useEffect, useEffectEvent, useRef } from "react";

import type { SpeechSnapshot } from "~/bindings";

import type { PoetrySpeechDocument } from "../speech-document";
import { PoetrySpeechFollow } from "../speech-follow";

export function usePoetrySpeechFollow(
  root: RefObject<HTMLElement | null>,
  viewport: RefObject<HTMLDivElement | null>,
  text: PoetrySpeechDocument,
  snapshot: SpeechSnapshot | null,
  suspended: boolean,
) {
  const controller = useRef<PoetrySpeechFollow | null>(null);
  const readText = useEffectEvent(() => text);

  useEffect(() => {
    if (!root.current || !viewport.current || !text.key) return;
    const follow = new PoetrySpeechFollow(
      root.current,
      viewport.current,
      readText(),
    );
    controller.current = follow;
    return () => {
      follow.dispose();
      controller.current = null;
    };
  }, [root, viewport, text.key]);

  useEffect(() => {
    controller.current?.update(snapshot, suspended);
  }, [snapshot, suspended, text.key]);
}
