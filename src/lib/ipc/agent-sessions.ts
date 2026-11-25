import { type AgentSessionQuery, commands } from "~/bindings";
import { unwrapCommand } from "~/lib/ipc-result";

export const agentSessionsSnapshot = (refresh: boolean, requestId: string) =>
  unwrapCommand(commands.agentSessionsSnapshot(refresh, requestId));
export const agentSessionsQuery = (
  input: AgentSessionQuery,
  requestId: string,
) => unwrapCommand(commands.agentSessionsQuery(input, requestId));
export const agentSessionDetail = (
  generation: string,
  key: string,
  offset: number,
  requestId: string,
) =>
  unwrapCommand(
    commands.agentSessionDetail(generation, key, offset, 100, requestId),
  );

export const agentSessionsStorage = (generation: string, requestId: string) =>
  unwrapCommand(commands.agentSessionsStorage(generation, requestId));
export const agentSessionsCancel = (requestId: string) =>
  commands.agentSessionsCancel(requestId);

export const agentSessionImage = (
  generation: string,
  key: string,
  messageIndex: number,
  imageIndex: number,
  requestId: string,
) =>
  unwrapCommand(
    commands.agentSessionImage(
      generation,
      key,
      messageIndex,
      imageIndex,
      requestId,
    ),
  );
