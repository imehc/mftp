import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Download,
  type LucideIcon,
  RefreshCw,
  Trash2,
} from "lucide-react";

import type { TransferKind } from "~/store/transfers";

/** 图标动效只有两种，避免每种操作各编一套动画。 */
export type TransferMotion = "bob" | "spin" | null;

export interface TransferIconSpec {
  icon: LucideIcon;
  motion: TransferMotion;
}

const SPECS: Record<TransferKind, TransferIconSpec> = {
  upload: { icon: ArrowUp, motion: "bob" },
  download: { icon: ArrowDown, motion: "bob" },
  bt: { icon: Download, motion: "bob" },
  sync: { icon: RefreshCw, motion: "spin" },
  delete: { icon: Trash2, motion: null },
  other: { icon: ArrowLeftRight, motion: null },
};

/**
 * 按操作类型取图标。
 *
 * 动效只在运行中播放：完成后的箭头再上下浮动会读成"还在传"。
 */
export function transferIcon(
  kind: TransferKind,
  running: boolean,
): TransferIconSpec {
  const spec = SPECS[kind];
  return running ? spec : { icon: spec.icon, motion: null };
}
