import { todoNoteDetails } from "~/lib/ipc";
import { ipcQuery } from "~/lib/query-client";

export const todoKeys = {
  items: ["todo", "items"] as const,
  summaries: ["todo", "summaries"] as const,
  details: ["todo", "details"] as const,
};

export const todoDetailsQuery = (id?: string, updatedAt?: number) => ({
  ...ipcQuery([...todoKeys.details, id ?? null, updatedAt ?? null], () =>
    todoNoteDetails(id!),
  ),
  enabled: !!id,
  gcTime: 60_000,
});
