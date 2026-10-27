import { useEffect } from "react";
import { useStore } from "zustand";

import {
  type PoetryReadingLocation,
  poetryReadingSession,
} from "../reading-session";
import { type PoetryReadingView } from "../reading-view";
import { usePoetryStore } from "../store/poetry-store";

/** 路由只转交参数；作品快照与偏好的优先级统一在功能层处理。 */
export function usePoetryReadingRoute(location: PoetryReadingLocation) {
  const preferredView = usePoetryStore((state) => state.readingView);
  const savedView = useStore(
    poetryReadingSession,
    (state) => state.entries.find((entry) => entry.uid === location.uid)?.view,
  );
  const view = location.view ?? savedView ?? preferredView;
  const { page, uid, q } = location;
  useEffect(() => {
    poetryReadingSession.getState().rememberLocation({ page, uid, q, view });
    if (uid) {
      poetryReadingSession.getState().update(uid, {
        view,
        ...(view !== "original" ? { referenceView: view } : {}),
      });
      usePoetryStore.getState().setReadingView(view);
    }
  }, [page, uid, q, view]);
  return view;
}

export function beginPoetryReading(uid: string): PoetryReadingView {
  const { readingView, referenceView } = usePoetryStore.getState();
  poetryReadingSession.getState().begin(uid, readingView, referenceView);
  return readingView;
}
