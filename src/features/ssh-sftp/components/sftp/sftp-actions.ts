import type { LucideIcon } from "lucide-react";

/** 动作只描述展示与回调，读写远端的生命周期仍归控制器。 */
export interface SftpAction {
  label: string;
  icon: LucideIcon;
  run: () => void;
  destructive?: boolean;
}
