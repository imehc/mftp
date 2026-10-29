import { useQuery } from "@tanstack/react-query";

import { ipcQuery } from "~/lib/query-client";

import { discoverRooms } from "./discovery";

export function useRoomDiscovery(gameId: string, enabled: boolean) {
  const query = useQuery({
    ...ipcQuery(["games", "rooms", gameId], () => discoverRooms(gameId)),
    enabled,
    staleTime: 0,
    gcTime: 30_000,
    refetchInterval: enabled ? 4000 : false,
  });
  return {
    rooms: query.data ?? [],
    scanning: enabled && query.isFetching,
    refresh: () => {
      if (enabled) void query.refetch({ cancelRefetch: false });
    },
    error: query.error?.payload ?? null,
  };
}
