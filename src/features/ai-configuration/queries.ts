import { aiConfigurationGet } from "~/lib/ipc";
import { ipcQuery } from "~/lib/query-client";

export const aiConfigurationKey = ["ai", "configuration"] as const;
export const aiConfigurationQuery = () =>
  ipcQuery(aiConfigurationKey, aiConfigurationGet);
