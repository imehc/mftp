import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

import { toIpcError } from "~/lib/errors";
import type { AppError } from "~/types";

import {
  createNoteImageCache,
  type LoadedNoteImage,
  type NoteImageCache,
  type NoteImageScope,
} from "./note-image-cache";

const NoteImageContext = createContext<NoteImageCache | null>(null);

export function TodoNoteImages({ children }: { children: ReactNode }) {
  const [cache] = useState(createNoteImageCache);
  useEffect(() => {
    return () => cache.dispose();
  }, [cache]);
  return <NoteImageContext value={cache}>{children}</NoteImageContext>;
}

export function useNoteImage(
  assetId: string,
  { itemId, draftId }: NoteImageScope,
  thumbnail = false,
) {
  const cache = useContext(NoteImageContext);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    value: LoadedNoteImage | null;
    error: AppError | null;
  }>({ key: "", value: null, error: null });
  const key = JSON.stringify([itemId, draftId, assetId, thumbnail, attempt]);
  useEffect(() => {
    if (!cache) return;
    let active = true;
    const lease = cache.acquire(assetId, { itemId, draftId }, thumbnail);
    void lease.promise.then(
      (value) => {
        if (active) setState({ key, value, error: null });
      },
      (error: unknown) => {
        if (active)
          setState({ key, value: null, error: toIpcError(error).payload });
      },
    );
    return () => {
      active = false;
      lease.release();
    };
  }, [cache, assetId, itemId, draftId, thumbnail, key]);
  return {
    value: state.key === key ? state.value : null,
    error: state.key === key ? state.error : null,
    retry: () => setAttempt((value) => value + 1),
  };
}
