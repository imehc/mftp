import { createStore } from "zustand/vanilla";

import type {
  AppError,
  McpCredentialInput,
  McpIssuedCredential,
  McpModuleInfo,
  McpSnapshot,
} from "~/bindings";
import { toIpcError } from "~/lib/errors";
import {
  mcpConfigure,
  mcpCredentialCreate,
  mcpCredentialRevoke,
  mcpCredentialRotate,
  mcpCredentialUpdate,
  mcpModuleCatalog,
  mcpSnapshot,
  mcpStart,
  mcpStop,
} from "~/lib/ipc";

const defaultApi = {
  snapshot: mcpSnapshot,
  catalog: mcpModuleCatalog,
  configure: mcpConfigure,
  start: mcpStart,
  stop: mcpStop,
  create: mcpCredentialCreate,
  update: mcpCredentialUpdate,
  rotate: mcpCredentialRotate,
  revoke: mcpCredentialRevoke,
};

interface State {
  snapshot: McpSnapshot | null;
  modules: McpModuleInfo[];
  busy: boolean;
  pending: "start" | "stop" | "configure" | "credential" | null;
  loading: boolean;
  readFailed: boolean;
  error: AppError | null;
  notice: number;
  issued: McpIssuedCredential | null;
}

export function createMcpController(api = defaultApi) {
  const store = createStore<State>(() => ({
    snapshot: null,
    modules: [],
    busy: false,
    pending: null,
    loading: true,
    readFailed: false,
    error: null,
    notice: 0,
    issued: null,
  }));
  let active = false;
  let lifetime = 0;
  let reading = 0;
  let writing = false;
  let lastReadFailure: string | null = null;

  function reportError(cause: unknown) {
    if (!active) return;
    store.setState((state) => ({
      error: toIpcError(cause).payload,
      notice: state.notice + 1,
    }));
  }

  async function refresh(inWrite = false) {
    if (!active || (writing && !inWrite)) return;
    const version = ++reading;
    const life = lifetime;
    try {
      const [snapshot, modules] = await Promise.all([
        api.snapshot(),
        api.catalog(),
      ]);
      if (!active || life !== lifetime || version !== reading) return;
      lastReadFailure = null;
      store.setState({ snapshot, modules, loading: false, readFailed: false });
    } catch (cause) {
      if (!active || life !== lifetime || version !== reading) return;
      const error = toIpcError(cause).payload;
      const identity = JSON.stringify([error.kind, error.code, error.args]);
      store.setState({ loading: false, readFailed: true });
      if (identity !== lastReadFailure) reportError(error);
      lastReadFailure = identity;
    }
  }

  async function write(
    pending: NonNullable<State["pending"]>,
    operation: () => Promise<unknown>,
  ) {
    const state = store.getState();
    if (
      !active ||
      writing ||
      state.loading ||
      state.readFailed ||
      !state.snapshot
    )
      return false;
    const life = lifetime;
    writing = true;
    reading++;
    store.setState({ busy: true, pending, issued: null });
    let success = false;
    try {
      const result = await operation();
      success = true;
      if (
        active &&
        life === lifetime &&
        result &&
        typeof result === "object" &&
        "token" in result
      )
        store.setState({ issued: result as McpIssuedCredential });
    } catch (cause) {
      if (active && life === lifetime) reportError(cause);
    } finally {
      if (success && active && life === lifetime) await refresh(true);
      writing = false;
      store.setState({ busy: false, pending: null });
    }
    return success && active && life === lifetime;
  }

  return {
    store,
    refresh: () => refresh(),
    start() {
      active = true;
      return refresh();
    },
    close() {
      active = false;
      lifetime++;
      reading++;
      lastReadFailure = null;
      store.setState({ issued: null });
    },
    dismissIssued() {
      store.setState({ issued: null });
    },
    configure: (port: number) => write("configure", () => api.configure(port)),
    startServer: () => write("start", api.start),
    stopServer: () => write("stop", api.stop),
    create: (input: McpCredentialInput) =>
      write("credential", () => api.create(input)),
    update: (id: string, input: McpCredentialInput) =>
      write("credential", () => api.update(id, input)),
    rotate: (id: string, input: McpCredentialInput) =>
      write("credential", () => api.rotate(id, input)),
    revoke: (id: string) => write("credential", () => api.revoke(id)),
    reportError,
  };
}

export type McpController = ReturnType<typeof createMcpController>;
