import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";

export default function SortableHostRow({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn("group relative", isDragging && "z-10 opacity-80")}
    >
      <button
        type="button"
        className="text-muted-foreground hover:bg-sidebar-accent absolute top-1/2 left-0 z-10 flex h-7 w-5 -translate-y-1/2 items-center justify-center rounded-md before:absolute before:inset-0 before:content-[''] pointer-coarse:before:-inset-x-3 pointer-coarse:before:-inset-y-2"
        aria-label={t`拖动排序`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      <div className="pl-5 pointer-coarse:pl-11">{children}</div>
    </li>
  );
}
