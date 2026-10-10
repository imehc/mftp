import { cn } from "cn";
import {
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Select, SelectItem, SelectTrigger } from "~/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";

type Item = { value: string; disabled?: boolean; children: ReactNode };

function inspect(children: ReactNode): {
  items: Item[];
  trigger?: ComponentProps<typeof SelectTrigger>;
} {
  const result: ReturnType<typeof inspect> = { items: [] };
  Children.forEach(children, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return;
    if (child.type === SelectItem) result.items.push(child.props as Item);
    else if (child.type === SelectTrigger) result.trigger = child.props;
    else {
      const nested = inspect(child.props.children);
      result.items.push(...nested.items);
      result.trigger ??= nested.trigger;
    }
  });
  return result;
}

/** 仅供业务显式标记的固定选项；保留原 Select 作为数量和空间不足时的回退。 */
export default function FixedSelect({
  children,
  alignment = "start",
  ...props
}: ComponentProps<typeof Select> & { alignment?: "start" | "end" }) {
  const { items, trigger } = inspect(children);
  const host = useRef<HTMLDivElement>(null);
  const segments = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const [fits, setFits] = useState(false);
  const [label, setLabel] = useState<string>();
  const eligible = items.length >= 2 && items.length <= 5;
  const segmented = eligible && fits;
  const optionsKey = items.map((item) => item.value).join("\0");

  useLayoutEffect(() => {
    const container = host.current;
    const group = segments.current;
    if (!container || !group || !eligible) return;

    const measure = () => {
      const available = container.clientWidth;
      const needed = group.getBoundingClientRect().width;
      const next = available > 0 && needed <= available;
      restoreFocus.current = container.contains(document.activeElement);
      setFits(next);
      const fieldLabel = trigger?.id
        ? Array.from(document.querySelectorAll("label")).find(
            (node) => node.htmlFor === trigger.id,
          )?.textContent
        : undefined;
      setLabel(fieldLabel ?? undefined);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(group);
    return () => observer.disconnect();
  }, [eligible, optionsKey, trigger?.id]);

  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    host.current
      ?.querySelector<HTMLElement>(
        segmented
          ? '[data-state="on"]:not(:disabled), [data-slot="toggle-group-item"]:not(:disabled)'
          : '[role="combobox"]',
      )
      ?.focus();
  }, [segmented]);

  return (
    <div
      ref={host}
      className={cn(
        "relative w-full min-w-0",
        alignment === "end" && "flex justify-end",
      )}
      data-fixed-choice={segmented ? "segments" : "select"}
    >
      {eligible ? (
        <div
          className={
            segmented
              ? "w-max max-w-full"
              : "pointer-events-none invisible absolute top-0 left-0 w-max opacity-0"
          }
          aria-hidden={!segmented || undefined}
          inert={!segmented || undefined}
        >
          <ToggleGroup
            ref={segments}
            type="single"
            variant="segmented"
            spacing={1}
            id={segmented ? trigger?.id : undefined}
            aria-label={trigger?.["aria-label"] ?? label}
            aria-labelledby={trigger?.["aria-labelledby"]}
            aria-describedby={trigger?.["aria-describedby"]}
            aria-invalid={trigger?.["aria-invalid"]}
            value={props.value}
            disabled={props.disabled}
            onValueChange={(value) => {
              // 必选设置不能通过再次点击当前项清空，也不能自动触发业务写入。
              if (value && value !== props.value) props.onValueChange?.(value);
            }}
          >
            {items.map((item) => (
              <ToggleGroupItem
                key={item.value}
                value={item.value}
                disabled={item.disabled}
              >
                {item.children}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ) : null}
      {!segmented ? <Select {...props}>{children}</Select> : null}
    </div>
  );
}
