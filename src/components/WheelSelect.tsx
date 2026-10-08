import "@ncdai/react-wheel-picker/style.css";

import { WheelPicker, WheelPickerWrapper } from "@ncdai/react-wheel-picker";
import { useEffect, useLayoutEffect, useRef } from "react";

import { useMediaQuery } from "~/lib/use-media-query";

/** 第三方滚轮的主题、无障碍和减少动态效果适配，不持有业务状态。 */
export default function WheelSelect({
  id,
  label,
  value,
  options,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    active.current = true;
    // 关闭弹层后不接受第三方惯性动画的迟到回调。
    return () => {
      active.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    // 该库未透传 DOM 属性；在唯一可聚焦节点补齐语义，隐藏重复的视觉列表。
    const wheel = container.current?.querySelector<HTMLElement>("[data-rwp]");
    if (!wheel) return;
    wheel.id = id;
    wheel.setAttribute("role", "spinbutton");
    wheel.setAttribute("aria-label", label);
    wheel.setAttribute("aria-valuemin", "0");
    wheel.setAttribute("aria-valuemax", String(options.length - 1));
    wheel.setAttribute("aria-valuenow", String(options.indexOf(value)));
    wheel.setAttribute("aria-valuetext", value);
    wheel.setAttribute("aria-invalid", String(invalid));
    wheel
      .querySelectorAll("ul")
      .forEach((list) => list.setAttribute("aria-hidden", "true"));
  }, [id, label, value, options, invalid]);

  return (
    <div ref={container} className="min-w-0 flex-1">
      <WheelPickerWrapper className="[&_[data-rwp]:focus-visible]:ring-ring rounded-lg border [&_[data-rwp]:focus-visible]:ring-2 [&_[data-rwp]:focus-visible]:ring-inset">
        <WheelPicker
          value={value}
          options={options.map((option) => ({ value: option, label: option }))}
          infinite
          visibleCount={8}
          optionItemHeight={44}
          // 库按灵敏度反比计算动画时长；减少动态效果时在下一帧完成吸附。
          dragSensitivity={reducedMotion ? 1_000_000 : 3}
          scrollSensitivity={reducedMotion ? 1_000_000 : 12}
          onValueChange={(next) => {
            if (active.current) onChange(next);
          }}
          classNames={{
            optionItem: "text-muted-foreground tabular-nums",
            highlightWrapper: "border-y border-border bg-accent",
            highlightItem: "text-accent-foreground tabular-nums",
          }}
        />
      </WheelPickerWrapper>
    </div>
  );
}
