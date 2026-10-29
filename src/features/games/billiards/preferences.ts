import { create } from "zustand";
import { persist } from "zustand/middleware";

interface BilliardsPreferences {
  aimOnly: boolean;
  setAimOnly(value: boolean): void;
}

/** 操作偏好独立于对局存档，重开、切换玩法和重新进入时保留。 */
export const useBilliardsPreferences = create<BilliardsPreferences>()(
  persist(
    (set) => ({
      aimOnly: false,
      setAimOnly: (aimOnly) => set({ aimOnly }),
    }),
    {
      name: "mftp-billiards-preferences",
      version: 1,
      partialize: ({ aimOnly }) => ({ aimOnly }),
    },
  ),
);
