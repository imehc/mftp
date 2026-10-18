import { commands, type SpeechAction, type SpeechRequest } from "~/bindings";
import { unwrapCommand } from "~/lib/ipc-result";

export const speechCatalog = () => unwrapCommand(commands.speechCatalog());
export const speechSnapshot = () => commands.speechSnapshot();
export const speechStart = (request: SpeechRequest) =>
  unwrapCommand(commands.speechStart(request));
export const speechControl = (sessionId: string, action: SpeechAction) =>
  unwrapCommand(commands.speechControl(sessionId, action));
export const speechStop = (sessionId: string) =>
  unwrapCommand(commands.speechStop(sessionId));
