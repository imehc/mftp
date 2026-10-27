import { useEffect } from "react";
import { create } from "zustand";

/** 原生预览不能先离页再回滚；业务忙碌时保留显式按钮的原有拦截。 */
export const useNativeBackGuards = create(() => ({
  active: new Set<symbol>(),
}));

export function useNativeBackGuard(blocked: boolean) {
  useEffect(() => {
    if (!blocked) return;
    const id = Symbol();
    useNativeBackGuards.setState(({ active }) => ({
      active: new Set(active).add(id),
    }));
    return () => {
      useNativeBackGuards.setState(({ active }) => {
        const next = new Set(active);
        next.delete(id);
        return { active: next };
      });
    };
  }, [blocked]);
}
