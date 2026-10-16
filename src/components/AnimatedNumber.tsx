import { cn } from "cn";
import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";

import { prefersReducedMotion } from "~/lib/motion";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * 单个数字位：在 1 行高的窗口里竖直排列 0-9，通过平移内层滚轮展示当前
 * 数字，数值变化时平滑滚动，形成类似里程表的过渡。
 *
 * 变换只由 gsap 维护（React 渲染产物不含该样式），因此父组件频繁重渲染
 * 也不会把滚轮位置重置回目标值；`prefers-reduced-motion` 时直接落位。
 */
function DigitSlot({ digit, duration }: { digit: number; duration: number }) {
  const strip = useRef<HTMLSpanElement | null>(null);
  const shown = useRef(digit);

  useLayoutEffect(() => {
    const node = strip.current;
    if (!node) return;
    const from = shown.current;
    shown.current = digit;
    if (from === digit) {
      // 初次挂载或同值：直接落位，不播放滚动。
      gsap.set(node, { yPercent: -digit * 10 });
      return;
    }
    gsap.killTweensOf(node);
    if (prefersReducedMotion()) {
      gsap.set(node, { yPercent: -digit * 10 });
      return;
    }
    gsap.fromTo(
      node,
      { yPercent: -from * 10 },
      { yPercent: -digit * 10, duration, ease: "power3.out" },
    );
  }, [digit, duration]);

  return (
    <span className="inline-block h-[1em] overflow-hidden">
      <span ref={strip} className="flex flex-col will-change-transform">
        {DIGITS.map((value) => (
          <span key={value} className="h-[1em] leading-[1em]">
            {value}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * 比分等数字的平滑滚动动画：逐位滚动 0-9，类似 MotionNumber。
 *
 * 以「从右往左」的位序作为 key，位数变化（如 9 → 10）时低位保持同一实例，
 * 继续滚动做进位，新出现的高位直接补位。视觉数字对辅助技术隐藏，另以
 * `sr-only` 文本读出真实数值。
 */
export function AnimatedNumber({
  value,
  className,
  duration = 0.5,
}: {
  value: number;
  className?: string;
  duration?: number;
}) {
  const rounded = Math.max(0, Math.round(value));
  const digits = String(rounded);
  return (
    <span className={cn("inline-flex tabular-nums", className)}>
      <span className="sr-only">{rounded}</span>
      <span aria-hidden="true" className="inline-flex items-center">
        {[...digits].map((digit, index) => (
          <DigitSlot
            key={digits.length - index}
            digit={Number(digit)}
            duration={duration}
          />
        ))}
      </span>
    </span>
  );
}
