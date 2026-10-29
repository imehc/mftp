import { toIpcError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import { queryClient, queryScopeGuard } from "~/lib/query-client";
import { createQueryResource } from "~/lib/query-resource";
import { createQueryStore } from "~/lib/query-store";
import type { AppError, Host, HostInput, SshKey } from "~/types";

/** 并发的 ensureLoaded 共享同一次读取，避免重复请求。 */
let pendingLoad: Promise<void> | null = null;
let loadGeneration = 0;

interface HostsState {
  hosts: Host[];
  keys: SshKey[];
  loading: boolean;
  loadError: AppError | null;
  /** 是否已经成功读取过一次；`ensureLoaded` 据此跳过重复读取。 */
  loaded: boolean;
  loadAll: () => Promise<void>;
  invalidate: () => void;
  /** 按需加载一次；并发调用共享同一次读取。 */
  ensureLoaded: () => Promise<void>;
  createHost: (input: HostInput) => Promise<Host>;
  updateHost: (id: string, input: HostInput) => Promise<Host>;
  deleteHost: (id: string) => Promise<void>;
  reorderHosts: (orderedIds: string[]) => Promise<void>;
  importKey: (
    label: string,
    sourcePath: string,
    hasPassphrase: boolean,
  ) => Promise<SshKey>;
  deleteKey: (id: string) => Promise<void>;
}

const keysResource = createQueryResource(["ssh-keys"], ipc.keysList);

export const useHostsStore = createQueryStore<HostsState>(
  (set, get) => ({
    hosts: [],
    keys: [],
    loading: false,
    loadError: null,
    loaded: false,

    invalidate() {
      // 清理后拒绝晚到的旧快照，防止已删除的主机或密钥重新出现在缓存。
      loadGeneration++;
      keysResource.cancel();
      pendingLoad = null;
      set({
        hosts: [],
        keys: [],
        loaded: false,
        loading: false,
        loadError: null,
      });
    },

    async loadAll() {
      const generation = ++loadGeneration;
      set({ loading: true, loadError: null });
      try {
        const [hosts] = await Promise.all([
          ipc.hostsList(),
          keysResource.fetch(true),
        ]);
        if (generation === loadGeneration) set({ hosts, loaded: true });
      } catch (error) {
        if (generation !== loadGeneration) return;
        set({ loadError: toIpcError(error).payload });
        throw error;
      } finally {
        if (generation === loadGeneration) set({ loading: false });
      }
    },

    async ensureLoaded() {
      if (get().loaded && keysResource.get() !== undefined) return;
      if (pendingLoad) return pendingLoad;
      const pending = get()
        .loadAll()
        .finally(() => {
          if (pendingLoad === pending) pendingLoad = null;
        });
      pendingLoad = pending;
      return pending;
    },

    async createHost(input) {
      const host = await ipc.hostCreate(input);
      set({ hosts: [...get().hosts, host] });
      return host;
    },

    async updateHost(id, input) {
      const updated = await ipc.hostUpdate(id, input);
      set({ hosts: get().hosts.map((h) => (h.id === id ? updated : h)) });
      return updated;
    },

    async deleteHost(id) {
      await ipc.hostDelete(id);
      set({ hosts: get().hosts.filter((h) => h.id !== id) });
    },

    async reorderHosts(orderedIds) {
      const order = new Map(orderedIds.map((id, index) => [id, index]));
      const previous = get().hosts;
      set({
        hosts: [
          ...previous.filter((host) => order.has(host.id)),
          ...previous.filter((host) => !order.has(host.id)),
        ].sort((a, b) => {
          const aOrder = order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const bOrder = order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          return aOrder - bOrder;
        }),
      });
      try {
        const hosts = await ipc.hostsReorder(orderedIds);
        set({ hosts });
      } catch (error) {
        set({ hosts: previous });
        throw error;
      }
    },

    async importKey(label, sourcePath, hasPassphrase) {
      const current = queryScopeGuard(queryClient, "ssh-keys");
      keysResource.cancel();
      const key = await ipc.keyImport(label, sourcePath, hasPassphrase);
      if (current()) set({ keys: [...get().keys, key] });
      return key;
    },

    async deleteKey(id) {
      const current = queryScopeGuard(queryClient, "ssh-keys");
      keysResource.cancel();
      await ipc.keyDelete(id);
      if (current()) set({ keys: get().keys.filter((k) => k.id !== id) });
    },
  }),
  { keys: keysResource },
);
