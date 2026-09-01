/**
 * 用户是否要求操作系统减少动画。
 *
 * 这段三行的 `matchMedia` 检查原本在每个带动画的组件里重复；AGENTS.md
 * 要求在第三次出现时抽取。在动画播放时读取而非缓存 —— 该设置可能在
 * 应用运行期间改变。
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
