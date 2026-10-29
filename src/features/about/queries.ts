import { getVersion } from "@tauri-apps/api/app";

import { appDataUsage } from "~/lib/ipc";
import { ipcQuery } from "~/lib/query-client";

import { readEnvironment } from "./environment";

export const usageQuery = () => ipcQuery(["about", "usage"], appDataUsage);
export const versionQuery = () => ({
  ...ipcQuery(["about", "version"], getVersion),
  staleTime: Infinity,
});
export const environmentQuery = () => ({
  ...ipcQuery(["about", "environment"], readEnvironment),
  staleTime: Infinity,
});
