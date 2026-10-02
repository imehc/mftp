import type { ReactNode } from "react";

export interface TodoScheduleOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  calendar: ReactNode;
  controls: ReactNode;
  actions: ReactNode;
}
