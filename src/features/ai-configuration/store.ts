import { create } from "zustand";

import type { AiConfigurationView, AppError } from "~/bindings";
import { toIpcError } from "~/lib/errors";
import { aiConfigurationGet, aiModelSwitch } from "~/lib/ipc";

type Operation = () => Promise<AiConfigurationView | void>;

interface ConfigurationState {
  view: AiConfigurationView | null;
  loading: boolean;
  busy: boolean;
  error: AppError | null;
  refresh: () => Promise<boolean>;
  execute: (operation: Operation) => Promise<boolean>;
  clearError: () => void;
  switchModel: (input: Parameters<typeof aiModelSwitch>[0]) => Promise<boolean>;
}

/** 仅持有后端公开快照；不持久化副本，也不缓存写入密钥或页面回调。 */
export function createAiConfigurationStore(
  read = aiConfigurationGet,
  switchModel = aiModelSwitch,
) {
  let generation = 0;
  let reading: Promise<boolean> | null = null;
  return create<ConfigurationState>((set, get) => ({
    view: null,
    loading: false,
    busy: false,
    error: null,
    clearError: () => set({ error: null }),
    switchModel: async (input) => {
      const { view, busy, loading } = get();
      const provider = view?.providers.find(
        (item) => item.id === input.expectedActiveProviderId,
      );
      // 菜单旧回调不能切换新地址；后端仍以版本和当前地址做最终准入。
      if (
        busy ||
        loading ||
        !view ||
        view.revision !== input.expectedRevision ||
        view.activeProviderId !== provider?.id ||
        !provider ||
        provider.requiresAddressRepair ||
        !provider.models.some((item) => item.id === input.modelId)
      )
        return false;
      if (provider.currentModelId === input.modelId) return true;
      return get().execute(() => switchModel(input));
    },
    refresh: () => {
      if (reading) return reading;
      const request = generation;
      set({ loading: true });
      const pending = Promise.resolve().then(async () => {
        try {
          const view = await read();
          // 写操作开始前发出的读取不能覆盖写操作返回的完整快照。
          if (request !== generation) return false;
          set({ view, error: null });
          return true;
        } catch (error) {
          if (request === generation) set({ error: toIpcError(error).payload });
          return false;
        } finally {
          if (reading === pending) {
            reading = null;
            set({ loading: false });
          }
        }
      });
      reading = pending;
      return pending;
    },
    execute: async (operation) => {
      // 同一事件循环中的重复点击也必须被挡住，不能只依赖按钮重渲染。
      if (get().busy) return false;
      generation += 1;
      reading = null;
      set({ busy: true, loading: false, error: null });
      try {
        const view = await operation();
        generation += 1;
        if (view) set({ view });
        return true;
      } catch (error) {
        generation += 1;
        const payload = toIpcError(error).payload;
        // 刷新公开数据供用户比较，绝不自动重放写入或重复触发原生认证。
        {
          reading = null;
          await get().refresh();
        }
        set({ error: payload });
        return false;
      } finally {
        set({ busy: false });
      }
    },
  }));
}

export const useAiConfiguration = createAiConfigurationStore();
