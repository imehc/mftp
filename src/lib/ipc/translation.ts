import { commands, type TranslationRequest } from "~/bindings";
import { translationOutputChannel } from "~/lib/events";
import { unwrapCommand, voidCommand } from "~/lib/ipc-result";

export const translationSnapshot = () =>
  unwrapCommand(commands.translationSnapshot());
export const translationSelect = (modelId: string) =>
  voidCommand(commands.translationSelect(modelId));
export const translationDownload = (modelId: string, requestId: string) =>
  voidCommand(commands.translationDownload(modelId, requestId));
export const translationRemove = (modelId: string) =>
  voidCommand(commands.translationRemove(modelId));
export const translationCancel = (requestId: string) =>
  voidCommand(commands.translationCancel(requestId));
export const translationRun = (
  request: TranslationRequest,
  output: Parameters<typeof translationOutputChannel>[0],
) =>
  unwrapCommand(
    commands.translationRun(request, translationOutputChannel(output)),
  );
