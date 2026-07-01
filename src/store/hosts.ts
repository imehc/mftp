import { create } from "zustand";
import type { Host, HostInput, SshKey } from "~/types";
import * as ipc from "~/lib/ipc";

interface HostsState {
  hosts: Host[];
  keys: SshKey[];
  loading: boolean;
  loadAll: () => Promise<void>;
  createHost: (input: HostInput) => Promise<Host>;
  updateHost: (id: string, input: HostInput) => Promise<Host>;
  deleteHost: (id: string) => Promise<void>;
  importKey: (
    label: string,
    sourcePath: string,
    hasPassphrase: boolean,
  ) => Promise<SshKey>;
  deleteKey: (id: string) => Promise<void>;
}

export const useHostsStore = create<HostsState>((set, get) => ({
  hosts: [],
  keys: [],
  loading: false,

  async loadAll() {
    set({ loading: true });
    try {
      const [hosts, keys] = await Promise.all([
        ipc.hostsList(),
        ipc.keysList(),
      ]);
      set({ hosts, keys });
    } finally {
      set({ loading: false });
    }
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

  async importKey(label, sourcePath, hasPassphrase) {
    const key = await ipc.keyImport(label, sourcePath, hasPassphrase);
    set({ keys: [...get().keys, key] });
    return key;
  },

  async deleteKey(id) {
    await ipc.keyDelete(id);
    set({ keys: get().keys.filter((k) => k.id !== id) });
  },
}));
