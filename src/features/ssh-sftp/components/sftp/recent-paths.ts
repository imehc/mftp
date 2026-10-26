import { create } from "zustand";

/** 高亮时长；只负责把用户视线引到新行，不承担结果结论。 */
const HIGHLIGHT_MS = 1800;

interface RecentPathsState {
  /** 路径 → 标记时刻，用于让后一次标记覆盖同一个文件的高亮。 */
  marks: ReadonlyMap<string, number>;
  mark: (path: string) => void;
}

/**
 * 上传落地后短暂高亮远端列表里的对应行。
 *
 * 传输坞给出的是"这个任务怎么样"，行高亮回答的是"它落在哪一行"，
 * 两者冗余但指向不同问题：用户传完后视线本来就在列表上。
 */
export const useRecentPathsStore = create<RecentPathsState>((set, get) => ({
  marks: new Map<string, number>(),
  mark(path) {
    const at = performance.now();
    const next = new Map(get().marks);
    next.set(path, at);
    set({ marks: next });
    setTimeout(() => {
      const current = new Map(get().marks);
      // 期间同一个文件被再次上传时，旧定时器不能清掉新标记。
      if (current.get(path) !== at) return;
      current.delete(path);
      set({ marks: current });
    }, HIGHLIGHT_MS);
  },
}));

export function markRecentPath(path: string): void {
  useRecentPathsStore.getState().mark(path);
}

export function useRecentPath(path: string): boolean {
  return useRecentPathsStore((state) => state.marks.has(path));
}
