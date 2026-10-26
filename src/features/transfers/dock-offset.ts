import { create } from "zustand";

/**
 * 传输坞在右下角占用的高度。
 *
 * 全局 `Toaster` 与传输坞同处右下角，靠这个高度把自己往上抬，
 * 不做两套互相遮挡的浮层；坞卸载后归零。
 */
interface DockOffsetState {
  offset: number;
  setOffset: (offset: number) => void;
}

export const useDockOffsetStore = create<DockOffsetState>((set) => ({
  offset: 0,
  setOffset: (offset) => set({ offset }),
}));
